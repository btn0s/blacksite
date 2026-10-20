import { Matrix4 } from 'three'
import { MeshStandardNodeMaterial, type WebGPURenderer } from 'three/webgpu'
import { loadMeshletAsset, type MeshletAsset, type MeshletMetadata, type MeshletSceneEntry } from '@blacksite/geometry'
import { loadScanMaterial, type ScanSurface } from '../../shared/scan-material'

const root = '/owned/dark-ruins/'
type EnvironmentComponent = { class: string; transform: { position: number[]; matrix: number[] }; properties: Record<string, unknown> }
type CourtyardManifest = {
  centre: [number, number, number]
  surfacesUrl: string
  colliderUrl: string
  geometries: { url: string; metadata: MeshletMetadata; bytes: number }[]
  placements: { name: string; visible: boolean; geometry: number; materials: string[]; matrix: number[]; componentClass: string }[]
  environment: EnvironmentComponent[]
  untranslated: { path: string; parent: string | null; placements: string[] }[]
}

export async function loadArchway() {
  const manifestResponse = await fetch(root + 'courtyard.json')
  if (!manifestResponse.ok) throw new Error('Build the owned courtyard assets before opening this example')
  const manifest: CourtyardManifest = await manifestResponse.json()
  const [surfacesResponse, colliderResponse] = await Promise.all([manifest.surfacesUrl, manifest.colliderUrl].map(file => fetch(root + file)))
  if (!surfacesResponse.ok || !colliderResponse.ok) throw new Error('The published courtyard asset set is incomplete')
  const surfaceSet: { surfaces: ScanSurface[] } = await surfacesResponse.json()
  const surfaceRoot = root + manifest.surfacesUrl.slice(0, manifest.surfacesUrl.lastIndexOf('/') + 1)
  const collider = await colliderResponse.arrayBuffer()
  const header = new Uint32Array(collider, 0, 4)
  if (header[0] !== 0x434c5342 || header[1] !== 1 || header[2] !== manifest.placements.length) throw new Error('Courtyard collision layout is invalid')
  const colliders = []
  let offset = 16
  for (let i = 0; i < header[2]!; i++) {
    const counts = new Uint32Array(collider, offset, 2)
    offset += 8
    const vertices = new Float32Array(collider, offset, counts[0])
    offset += counts[0]! * 4
    const indices = new Uint32Array(collider, offset, counts[1])
    offset += counts[1]! * 4
    colliders.push({ vertices, indices })
  }
  if (offset !== collider.byteLength) throw new Error('Courtyard collision size is invalid')
  const assetsByGeometry = new Map<number, MeshletAsset>()
  for (const index of new Set(manifest.placements.map(placement => placement.geometry))) assetsByGeometry.set(index, await loadMeshletAsset(root + manifest.geometries[index]!.url))
  const assets = [...assetsByGeometry.values()]
  const entries: MeshletSceneEntry[] = []
  const sourceTriangles = assets.reduce((sum, asset) => sum + asset.metadata.sourceTriangles, 0)
  const meshlets = assets.reduce((sum, asset) => sum + asset.metadata.clusterCount, 0)
  return {
    manifest, entries, assets, sourceTriangles, meshlets,
    storageSize: Math.max(assets.reduce((sum, asset) => sum + asset.vertices.byteLength, 0), assets.reduce((sum, asset) => sum + asset.indices.byteLength, 0), assets.reduce((sum, asset) => sum + asset.vertexReferences.byteLength, 0)),
    colliders,
    async prepareMaterials(renderer: WebGPURenderer) {
      const materials = new Map<string, MeshStandardNodeMaterial>()
      for (const surface of surfaceSet.surfaces) materials.set(surface.path, await loadScanMaterial(surface, surfaceRoot, renderer))
      for (const missing of manifest.untranslated) materials.set(missing.path, new MeshStandardNodeMaterial({ name: `Untranslated: ${missing.path}`, visible: false }))
      const materialFor = (path: string | undefined) => {
        const material = path ? materials.get(path) : undefined
        if (!material) throw new Error(`Missing surface: ${path}`)
        return material
      }
      const grouped = new Map<string, MeshletSceneEntry & { instances: Matrix4[] }>()
      for (const placement of manifest.placements) {
        if (!placement.visible) continue
        const id = JSON.stringify([placement.geometry, placement.materials])
        if (!grouped.has(id)) {
          const asset = assetsByGeometry.get(placement.geometry)!
          const slots = asset.metadata.materials.map(() => materialFor(placement.materials[0]))
          for (let i = 0; i < asset.metadata.primitives.length; i++) slots[asset.metadata.primitives[i]!.materialIndex] = materialFor(placement.materials[i])
          grouped.set(id, { asset, materials: slots, instances: [] })
        }
        grouped.get(id)!.instances.push(new Matrix4().fromArray(placement.matrix))
      }
      entries.push(...grouped.values())
    },
  }
}

export type ArchwayAsset = Awaited<ReturnType<typeof loadArchway>>
