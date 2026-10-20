import { Box3, Matrix4, Vector3 } from 'three'
import { MeshStandardNodeMaterial, type WebGPURenderer } from 'three/webgpu'
import { GEOMETRY_ARENA_BYTES, loadGeometryPageSource, MeshletScene, type GeometryPageSource, type MeshletSceneEntry } from '@blacksite/geometry'
import { loadScanMaterials, scanTextureFeedback, type ScanSurface } from '../../shared/scan-material'
import { ScanFlames, type ScanFlameGeometry } from '../../shared/scan-flames'
import { ruinsHome, type RuinsViews } from './views'
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
    fetchBytes(manifest.surfaces).then(response => response.json()) as Promise<{ surfaces: ScanSurface[]; flameGeometry: Record<string, ScanFlameGeometry> }>,
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
  const localBounds = assets.map(asset => new Box3(new Vector3(...asset.metadata.bounds.min), new Vector3(...asset.metadata.bounds.max)))
  const views: RuinsViews = {
    overview: { bounds: new Box3(), placements: [] },
    archway: { bounds: new Box3(), placements: [] },
    pits: { bounds: new Box3(), placements: [] },
    cliffs: { bounds: new Box3(), placements: [] },
  }
  const flamePaths = new Set(surfaces.surfaces.filter(surface => surface.family === 'flame').map(surface => surface.path))
  const excluded = new Set([...manifest.untranslated, ...manifest.excluded].map(surface => surface.path))
  for (const path of flamePaths) excluded.add(path)
  const reasons = new Map([...manifest.untranslated, ...manifest.excluded].map(surface => [surface.path, surface.reason ?? 'untranslated']))
  const describe = (id: number, slot: number) => {
    const placement = placements[id]
    if (!placement) return { placement: id, slot, provenance: 'placement index is outside the level directory' }
    const e = placement.matrix.elements
    const columns = [0, 4, 8].map(offset => new Vector3(e[offset], e[offset + 1], e[offset + 2]))
    const lengths = columns.map(column => column.length())
    const shear = Math.max(Math.abs(columns[0]!.dot(columns[1]!)) / (lengths[0]! * lengths[1]!), Math.abs(columns[0]!.dot(columns[2]!)) / (lengths[0]! * lengths[2]!), Math.abs(columns[1]!.dot(columns[2]!)) / (lengths[1]! * lengths[2]!))
    const material = manifest.materialPaths[materialMap[placement.firstMaterial + slot]!] ?? null
    const requiresFullMatrix = { mirrored: placement.matrix.determinant() < 0, sheared: shear > 1e-3, nonUniform: Math.max(...lengths) / Math.min(...lengths) > 1.001 }
    return {
      placement: id, slot, mesh: manifest.geometries[placement.geometry]!.id, material,
      drawn: placement.visible && (material === null || !excluded.has(material) || flamePaths.has(material)), placementVisible: placement.visible, materialNotDrawn: material !== null && excluded.has(material) ? reasons.get(material) : null,
      requiresFullMatrix, scale: lengths.map(length => Math.round(length * 1000) / 1000), world: placement.matrix.elements.map(value => Math.round(value * 1000) / 1000),
      origin: 'baked from the drawn LOD cut of the mesh at 0.75 m world error',
    }
  }
  const size = new Vector3()
  const volumes = { archway: 0, cliffs: 0 }
  for (const placement of placements) {
    if (!placement.visible) continue
    const surfaces = Array.from(materialMap.subarray(placement.firstMaterial, placement.firstMaterial + placement.materials), id => manifest.materialPaths[id]!)
    if (surfaces.every(path => excluded.has(path))) continue
    const local = localBounds[placement.geometry]!
    const world = local.clone()
    world.getSize(size)
    const volume = size.x * size.y * size.z * Math.abs(placement.matrix.determinant())
    world.applyMatrix4(placement.matrix)
    const framed = { bounds: local, matrix: placement.matrix }
    views.overview.bounds.union(world)
    views.overview.placements.push(framed)
    const name = manifest.geometries[placement.geometry]!.id
    if (name.includes('/SM_ArchWay_') && volume > volumes.archway) {
      views.archway.bounds.copy(world)
      views.archway.placements = [framed]
      volumes.archway = volume
    }
    if (name.includes('/SM_Pit_')) {
      views.pits.bounds.union(world)
      views.pits.placements.push(framed)
    }
    if (name.includes('Coastal_Cliff_') && surfaces.some(path => path.includes('Beach')) && volume > volumes.cliffs) {
      views.cliffs.bounds.copy(world)
      views.cliffs.placements = [framed]
      volumes.cliffs = volume
    }
  }
  if (Object.values(views).some(view => view.bounds.isEmpty())) throw new Error('The level is missing its landmark geometry')
  const bounds = views.overview.bounds
  const home = ruinsHome
  return {
    manifest, placements, bounds, views, home, environment, collision, describe,
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
      const flames = new Map<string, { geometry: ScanFlameGeometry; material: NonNullable<ReturnType<typeof materials.get>>; matrices: Matrix4[] }>()
      for (const placement of placements) {
        const mapping = materialMap.subarray(placement.firstMaterial, placement.firstMaterial + placement.materials)
        const flame = Array.from(mapping, material => manifest.materialPaths[material]!).filter(path => flamePaths.has(path))
        if (flame.length && placement.visible) {
          if (mapping.length !== 1) throw new Error(`Flame surfaces require single-material placements: ${flame[0]}`)
          const geometryId = manifest.geometries[placement.geometry]!.id, key = `${geometryId}|${flame[0]}`
          if (!flames.has(key)) flames.set(key, { geometry: surfaces.flameGeometry[geometryId]!, material: materials.get(flame[0]!)!, matrices: [] })
          flames.get(key)!.matrices.push(placement.matrix)
        }
        const id = `${placement.geometry}:${Number(placement.visible)}:${mapping.join(',')}`
        if (!grouped.has(id)) {
          const slots = Array.from(mapping, material => {
            const path = manifest.materialPaths[material]!
            if (!placement.visible || flamePaths.has(path)) return invisible
            const value = materials.get(path)
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
      return { geometry, flames: new ScanFlames([...flames.values()]) }
    },
  }
}

export type RuinsAsset = Awaited<ReturnType<typeof loadRuins>>
