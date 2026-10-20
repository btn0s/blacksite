import { Box3, Matrix4, Vector3 } from 'three'
import { MeshStandardNodeMaterial, type WebGPURenderer } from 'three/webgpu'
import { GEOMETRY_ARENA_BYTES, loadGeometryPageSource, MeshletScene, type GeometryPageSource, type MeshletSceneEntry } from '@blacksite/geometry'
import { loadScanMaterials, scanTextureFeedback, type ScanSurface } from '../../shared/scan-material'
import { createRuinsHome, type RuinsLandmarks } from './views'
import type { CollisionDirectory } from './collision'

const root = '/owned/dark-ruins/'
type EnvironmentComponent = { class: string; transform: { matrix: number[]; position: number[] }; properties: Record<string, unknown> }
type FullManifest = {
  version: number; placements: number; minimumWorldError: number
  directory: string; surfaces: string; environment: string; collision: string
  materialPaths: string[]; geometries: { id: string; url: string }[]
  untranslated: { path: string; reason?: string }[]; excluded: { path: string; reason: string }[]
}

async function fetchBytes(file: string) {
  const response = await fetch(root + file)
  if (!response.ok) throw new Error(`Full-level asset unavailable: ${file} (${response.status})`)
  return response
}

export async function loadRuins(progress: (detail: string) => void) {
  performance.mark('ruins-directory-start')
  const manifest: FullManifest = await (await fetchBytes('full.json')).json()
  if (manifest.version !== 5 || manifest.placements !== 20430) throw new Error('Full level requires all 20,430 version 5 placements')
  const [directory, surfaces, environment, collision] = await Promise.all([
    fetchBytes(manifest.directory).then(response => response.arrayBuffer()),
    fetchBytes(manifest.surfaces).then(response => response.json()) as Promise<{ surfaces: ScanSurface[] }>,
    fetchBytes(manifest.environment).then(response => response.json()) as Promise<{ components: EnvironmentComponent[] }>,
    fetchBytes(manifest.collision).then(response => response.json()) as Promise<CollisionDirectory>,
  ])
  const header = new Uint32Array(directory, 0, 24)
  if (header[0] !== 0x4c475342 || header[1] !== 5 || header[2] !== 4 || header[3] !== 20430 || header[4] !== manifest.geometries.length || header[5] !== manifest.materialPaths.length) throw new Error('Full-level directory header disagrees')
  const placementWords = new Uint32Array(directory, header[9], header[10]! / 4), placementFloats = new Float32Array(placementWords.buffer, placementWords.byteOffset, placementWords.length)
  const materialMap = new Uint32Array(directory, header[13], header[14]! / 4)
  const placements = Array.from({ length: manifest.placements }, (_, id) => ({
    id, geometry: placementWords[id * 44 + 36]!, matrix: new Matrix4().fromArray(placementFloats, id * 44),
    firstMaterial: placementWords[id * 44 + 34]!, materials: placementWords[id * 44 + 35]!, visible: !!placementWords[id * 44 + 38],
  }))
  const assets: GeometryPageSource[] = []
  let cursor = 0
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (cursor < manifest.geometries.length) { const id = cursor++; assets[id] = await loadGeometryPageSource(root + manifest.geometries[id]!.url) }
  }))
  performance.measure('ruins-directories', 'ruins-directory-start')
  const bounds = new Box3()
  const landmarks: RuinsLandmarks = { archway: new Box3(), pits: new Box3(), cliffs: new Box3() }
  const excluded = new Set([...manifest.untranslated, ...manifest.excluded].map(surface => surface.path))
  const size = new Vector3()
  const volumes = { archway: 0, cliffs: 0 }
  for (const placement of placements) {
    if (!placement.visible) continue
    const surfaces = Array.from(materialMap.subarray(placement.firstMaterial, placement.firstMaterial + placement.materials), id => manifest.materialPaths[id]!)
    if (surfaces.every(path => excluded.has(path))) continue
    const local = assets[placement.geometry]!.metadata.bounds
    const world = new Box3(new Vector3(...local.min), new Vector3(...local.max))
    world.getSize(size)
    const volume = size.x * size.y * size.z * Math.abs(placement.matrix.determinant())
    world.applyMatrix4(placement.matrix)
    bounds.union(world)
    const name = manifest.geometries[placement.geometry]!.id
    if (name.includes('/SM_ArchWay_') && volume > volumes.archway) {
      landmarks.archway.copy(world)
      volumes.archway = volume
    }
    if (name.includes('/SM_Pit_')) landmarks.pits.union(world)
    if (name.includes('Coastal_Cliff_') && surfaces.some(path => path.includes('Beach')) && volume > volumes.cliffs) {
      landmarks.cliffs.copy(world)
      volumes.cliffs = volume
    }
  }
  if (bounds.isEmpty() || Object.values(landmarks).some(box => box.isEmpty())) throw new Error('The level is missing its landmark geometry')
  const home = createRuinsHome(landmarks.archway)
  return {
    manifest, placements, bounds, landmarks, home, environment, collision,
    collisionRoot: new URL(root + manifest.collision.slice(0, manifest.collision.lastIndexOf('/') + 1), location.href).href,
    largestBuffer: GEOMETRY_ARENA_BYTES,
    sourceTriangles: assets.reduce((sum, asset) => sum + asset.metadata.sourceTriangles, 0),
    cappedTriangles: assets.reduce((sum, asset) => sum + asset.metadata.residentTriangles, 0),
    async createGeometry(renderer: WebGPURenderer) {
      performance.mark('ruins-materials-start')
      progress('Loading minimum texture tails')
      const surfaceRoot = root + manifest.surfaces.slice(0, manifest.surfaces.lastIndexOf('/') + 1)
      const materials = await loadScanMaterials(surfaces.surfaces, surfaceRoot, renderer)
      const invisible = new MeshStandardNodeMaterial({ name: 'Non-rendering exported surfaces', visible: false })
      for (const surface of [...manifest.untranslated, ...manifest.excluded]) if (!materials.has(surface.path)) materials.set(surface.path, invisible)
      performance.measure('ruins-materials', 'ruins-materials-start')
      const grouped = new Map<string, MeshletSceneEntry & { instances: Matrix4[] }>()
      for (const placement of placements) {
        const mapping = materialMap.subarray(placement.firstMaterial, placement.firstMaterial + placement.materials)
        const id = `${placement.geometry}:${Number(placement.visible)}:${mapping.join(',')}`
        if (!grouped.has(id)) {
          const slots = Array.from(mapping, material => {
            if (!placement.visible) return invisible
            const path = manifest.materialPaths[material]!, value = materials.get(path)
            if (!value) throw new Error(`Full-level surface has no authored descriptor: ${path}`)
            return value
          })
          grouped.set(id, { asset: assets[placement.geometry]!, materials: slots, instances: [] })
        }
        grouped.get(id)!.instances.push(placement.matrix)
      }
      progress('Loading the pinned coarse geometry')
      performance.mark('ruins-geometry-start')
      const geometry = await MeshletScene.create(renderer, [...grouped.values()], { materialIds: materials.materialIds, pixelError: 2, occlusion: true, shadowLayer: 2, shadowPixelError: 4, textureFeedback: scanTextureFeedback(renderer) })
      performance.measure('ruins-geometry', 'ruins-geometry-start')
      return geometry
    },
  }
}

export type RuinsAsset = Awaited<ReturnType<typeof loadRuins>>
