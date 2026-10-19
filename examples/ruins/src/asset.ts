import { Box3, Matrix4, Vector3 } from 'three'
import { loadMeshletAsset, type MeshletSceneEntry } from '@blacksite/geometry'
import { loadScanMaterial, type ScanSurface } from '../../shared/scan-material'

const root = '/owned/dark-ruins/level/'
type GeometryRecord = { id: string; url: string; collision: string; mesh: string; primitiveSlots: number[]; bounds: { min: [number, number, number]; max: [number, number, number] } }
type Placement = { geometry: string; matrix: number[]; materials: string[] }
type EnvironmentComponent = { class: string; transform: { matrix: number[]; position: number[] }; properties: Record<string, unknown> }

async function json(file: string) {
  const response = await fetch(root + file)
  if (!response.ok) throw new Error(`The full-level build is not ready: ${file} (${response.status})`)
  return response.json()
}

export async function loadRuins(progress: (detail: string) => void) {
  const [manifest, surfaces, environment] = await Promise.all([json('level.json'), json('surfaces.json'), json('environment.json')]) as [
    { instances: Placement[]; geometries: GeometryRecord[]; minimumWorldError: number; bytes: number; sourceTriangles: number; residentTriangles: number },
    { surfaces: ScanSurface[] }, { components: EnvironmentComponent[] },
  ]
  if (manifest.instances.length !== 20430) throw new Error(`Every placement is required; found ${manifest.instances.length}`)
  const unsupported = surfaces.surfaces.filter(surface => surface.family !== 'custom-general')
  if (unsupported.length) throw new Error(`${unsupported.length} source surfaces need authored translation before this level can render. First: ${unsupported[0]!.path}`)
  const materials = new Map()
  for (const surface of surfaces.surfaces) {
    progress(`Loading surface ${materials.size + 1} / ${surfaces.surfaces.length}`)
    materials.set(surface.path, await loadScanMaterial(surface, root))
  }
  const assets = new Map()
  const collisions = new Map<string, { vertices: Float32Array; indices: Uint32Array }>()
  for (const record of manifest.geometries) {
    progress(`Loading geometry ${assets.size + 1} / ${manifest.geometries.length}`)
    assets.set(record.id, await loadMeshletAsset(root + record.url))
    const response = await fetch(root + record.collision)
    if (!response.ok) throw new Error(`Missing collision: ${record.collision}`)
    const buffer = await response.arrayBuffer()
    const counts = new Uint32Array(buffer, 0, 2)
    collisions.set(record.id, { vertices: new Float32Array(buffer, 8, counts[0]), indices: new Uint32Array(buffer, 8 + counts[0]! * 4, counts[1]) })
  }
  const records = new Map(manifest.geometries.map(record => [record.id, record]))
  const grouped = new Map<string, MeshletSceneEntry>()
  const bounds = new Box3()
  const placements = manifest.instances.map((placement, id) => {
    const record = records.get(placement.geometry)!
    const matrix = new Matrix4().fromArray(placement.matrix)
    const key = JSON.stringify([placement.geometry, placement.materials])
    if (!grouped.has(key)) {
      const asset = assets.get(placement.geometry)
      const slots = asset.metadata.materials.map((_: unknown, materialIndex: number) => {
        const primitive = asset.metadata.primitives.findIndex((item: { materialIndex: number }) => item.materialIndex === materialIndex)
        if (primitive < 0) throw new Error(`Unused source material slot in ${record.id}`)
        const sourceSlot = record.primitiveSlots[primitive]!
        const material = materials.get(placement.materials[sourceSlot])
        if (!material) throw new Error(`Missing placement material: ${placement.materials[sourceSlot]}`)
        return material
      })
      grouped.set(key, { asset, materials: slots, instances: [] })
    }
    ;(grouped.get(key)!.instances as Matrix4[]).push(matrix)
    const box = new Box3(new Vector3(...record.bounds.min), new Vector3(...record.bounds.max)).applyMatrix4(matrix)
    bounds.union(box)
    return { id, geometry: placement.geometry, matrix, bounds: box }
  })
  const arch = manifest.geometries.find(record => record.mesh.includes('SM_ArchWay_01_N1.'))!
  const placement = placements.find(item => item.geometry === arch.id)!
  const center = new Vector3().addVectors(new Vector3(...arch.bounds.min), new Vector3(...arch.bounds.max)).multiplyScalar(0.5)
  const spawn = new Vector3(center.x, arch.bounds.min[1] + 1, arch.bounds.max[2] + 5).applyMatrix4(placement.matrix)
  const target = center.applyMatrix4(placement.matrix)
  const home = { id: 1, name: 'Archway', position: spawn.toArray() as [number, number, number], target: target.toArray() as [number, number, number], note: '' }
  const vertexBytes = [...assets.values()].reduce((sum, asset) => sum + asset.positions.length / 3 * 32, 0)
  const indexBytes = [...assets.values()].reduce((sum, asset) => sum + asset.indices.byteLength, 0)
  const largestBuffer = Math.max(vertexBytes, indexBytes)
  return { entries: [...grouped.values()], placements, collisions, bounds, home, largestBuffer, environment, manifest }
}

export type RuinsAsset = Awaited<ReturnType<typeof loadRuins>>
