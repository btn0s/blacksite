import { Box3, Matrix4, Vector3 } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { loadMeshletAsset, MeshletScene, type MeshletAssetSource, type MeshletMetadata, type MeshletSceneEntry } from '@blacksite/geometry'
import { loadScanMaterials, scanTextureFeedback, type ScanSurface } from '../../shared/scan-material'

const root = '/owned/dark-ruins/level/'
type GeometryRecord = MeshletMetadata & { id: string; url: string; bytes: number; collision: string; mesh: string; primitiveSlots: number[] }
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
  const assets = new Map<string, MeshletAssetSource>()
  const collisions = new Map<string, { vertices: Float32Array; indices: Uint32Array }>()
  for (const record of manifest.geometries) {
    progress(`Loading collision ${assets.size + 1} / ${manifest.geometries.length}`)
    assets.set(record.id, { metadata: record, load: () => loadMeshletAsset(root + record.url) })
    const response = await fetch(root + record.collision)
    if (!response.ok) throw new Error(`Missing collision: ${record.collision}`)
    const buffer = await response.arrayBuffer()
    const counts = new Uint32Array(buffer, 0, 2)
    collisions.set(record.id, { vertices: new Float32Array(buffer, 8, counts[0]), indices: new Uint32Array(buffer, 8 + counts[0]! * 4, counts[1]) })
  }
  const records = new Map(manifest.geometries.map(record => [record.id, record]))
  const bounds = new Box3()
  const placements = manifest.instances.map((placement, id) => {
    const record = records.get(placement.geometry)!
    const matrix = new Matrix4().fromArray(placement.matrix)
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
  const clusterCount = manifest.geometries.reduce((sum, record) => sum + record.clusterCount, 0)
  const nodeCount = manifest.geometries.reduce((sum, record) => sum + record.nodeCount, 0)
  const candidateCount = manifest.instances.reduce((sum, instance) => sum + records.get(instance.geometry)!.clusterCount, 0)
  const nodeInstances = manifest.instances.reduce((sum, instance) => sum + records.get(instance.geometry)!.nodeCount, 0)
  const largestBuffer = Math.max(clusterCount * 128, nodeCount * 48, candidateCount * 8, nodeInstances * 8, placements.length * 144, ...manifest.geometries.map(record => record.bytes))
  return {
    placements, collisions, bounds, home, largestBuffer, environment, manifest,
    async createGeometry(renderer: WebGPURenderer) {
      progress(`Loading ${surfaces.surfaces.length} surfaces`)
      const materials = await loadScanMaterials(surfaces.surfaces, root, renderer)
      const grouped = new Map<string, MeshletSceneEntry & { instances: Matrix4[] }>()
      for (const [index, placement] of manifest.instances.entries()) {
        const id = JSON.stringify([placement.geometry, placement.materials])
        if (!grouped.has(id)) {
          const record = records.get(placement.geometry)!
          const asset = assets.get(placement.geometry)!
          const slots = asset.metadata.materials.map((_, materialIndex) => {
            const primitive = asset.metadata.primitives.findIndex(item => item.materialIndex === materialIndex)
            if (primitive < 0) throw new Error(`Unused source material slot in ${record.id}`)
            const sourceSlot = record.primitiveSlots[primitive]!
            const material = materials.get(placement.materials[sourceSlot]!)
            if (!material) throw new Error(`Missing placement material: ${placement.materials[sourceSlot]}`)
            return material
          })
          grouped.set(id, { asset, materials: slots, instances: [] })
        }
        grouped.get(id)!.instances.push(placements[index]!.matrix)
      }
      progress(`Uploading ${assets.size} resident geometries`)
      return MeshletScene.create(renderer, [...grouped.values()], { pixelError: 2, occlusion: true, shadowLayer: 2, shadowPixelError: 1, textureFeedback: scanTextureFeedback(renderer) })
    },
  }
}

export type RuinsAsset = Awaited<ReturnType<typeof loadRuins>>
