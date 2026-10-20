import { Matrix4 } from 'three'
import { MeshStandardNodeMaterial, type WebGPURenderer } from 'three/webgpu'
import type { RapierContext } from '@react-three/rapier'
import { loadMeshletAsset, meshletStorageSize, MeshletScene, type MeshletAssetSource, type MeshletMetadata, type MeshletSceneEntry } from '@blacksite/geometry'
import { loadScanMaterials, scanTextureFeedback, type ScanSurface } from '../../shared/scan-material'

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
  excluded: { path: string; reason: string; placements: string[] }[]
}

async function loadCourtyardColliders(url: string, { world, rapier }: Pick<RapierContext, 'world' | 'rapier'>, signal: AbortSignal) {
  const response = await fetch(url, { signal })
  if (!response.ok || !response.body) throw new Error('The published courtyard collision is unavailable')
  const reader = response.body.getReader()
  let chunk: Uint8Array = new Uint8Array(0)
  let cursor = 0
  const read = async (target: Uint8Array) => {
    let offset = 0
    while (offset < target.length) {
      signal.throwIfAborted()
      if (cursor === chunk.length) {
        const next = await reader.read()
        if (next.done) throw new Error('Courtyard collision is truncated')
        chunk = next.value
        cursor = 0
      }
      const length = Math.min(target.length - offset, chunk.length - cursor)
      target.set(chunk.subarray(cursor, cursor + length), offset)
      cursor += length
      offset += length
    }
  }
  let remove = () => {}
  try {
    const header = new Uint32Array(4)
    await read(new Uint8Array(header.buffer))
    if (header[0] !== 0x434c5342 || header[1] !== 2 || header[2] !== 1) throw new Error('Courtyard collision layout is invalid')
    const body = world.createRigidBody(rapier.RigidBodyDesc.fixed())
    remove = () => {
      if (world.getRigidBody(body.handle)) world.removeRigidBody(body)
    }
    const counts = new Uint32Array(2)
    await read(new Uint8Array(counts.buffer))
    if (counts[0]! % 3 || counts[1]! % 3) throw new Error('Courtyard collider counts are invalid')
    const vertices = new Float32Array(counts[0]!)
    const indices = new Uint32Array(counts[1]!)
    await read(new Uint8Array(vertices.buffer))
    await read(new Uint8Array(indices.buffer))
    signal.throwIfAborted()
    world.createCollider(rapier.ColliderDesc.trimesh(vertices, indices), body).clearShapeCache()
    vertices.buffer.transfer(0)
    indices.buffer.transfer(0)
    if (cursor !== chunk.length) throw new Error('Courtyard collision size is invalid')
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (next.value.length) throw new Error('Courtyard collision size is invalid')
    }
    signal.throwIfAborted()
    return remove
  } catch (error) {
    remove()
    throw error
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function loadArchway() {
  const manifestResponse = await fetch(root + 'courtyard.json')
  if (!manifestResponse.ok) throw new Error('Build the owned courtyard assets before opening this example')
  const manifest: CourtyardManifest = await manifestResponse.json()
  const surfacesResponse = await fetch(root + manifest.surfacesUrl)
  if (!surfacesResponse.ok) throw new Error('The published courtyard asset set is incomplete')
  const surfaceSet: { surfaces: ScanSurface[] } = await surfacesResponse.json()
  const surfaceRoot = root + manifest.surfacesUrl.slice(0, manifest.surfacesUrl.lastIndexOf('/') + 1)
  const assetsByGeometry = new Map<number, MeshletAssetSource>()
  for (const index of new Set(manifest.placements.map(placement => placement.geometry))) {
    const source = manifest.geometries[index]!
    assetsByGeometry.set(index, { metadata: source.metadata, load: () => loadMeshletAsset(root + source.url) })
  }
  const assets = [...assetsByGeometry.values()]
  const sourceTriangles = assets.reduce((sum, asset) => sum + asset.metadata.sourceTriangles, 0)
  const meshlets = assets.reduce((sum, asset) => sum + asset.metadata.clusterCount, 0)
  return {
    manifest, sourceTriangles, meshlets,
    uniqueMeshes: assets.length,
    levels: Math.max(...assets.map(asset => asset.metadata.levelCount)),
    storageSize: Math.max(meshletStorageSize(assets.map(asset => asset.metadata)), 16_000_000 * 6),
    createColliders: (context: Pick<RapierContext, 'world' | 'rapier'>, signal: AbortSignal) => loadCourtyardColliders(root + manifest.colliderUrl, context, signal),
    async createGeometry(renderer: WebGPURenderer) {
      const materials = await loadScanMaterials(surfaceSet.surfaces, surfaceRoot, renderer)
      for (const missing of manifest.untranslated) materials.set(missing.path, new MeshStandardNodeMaterial({ name: `Untranslated: ${missing.path}`, visible: false }))
      for (const excluded of manifest.excluded) materials.set(excluded.path, new MeshStandardNodeMaterial({ name: excluded.reason, visible: false }))
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
      return MeshletScene.create(renderer, [...grouped.values()], { pixelError: 2, occlusion: true, shadowLayer: 2, shadowPixelError: 4, textureFeedback: scanTextureFeedback(renderer) })
    },
  }
}

export type ArchwayAsset = Awaited<ReturnType<typeof loadArchway>>
