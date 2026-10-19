import { Box3, Matrix4, Vector3 } from 'three/webgpu'
import type { Material } from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { MeshletAsset, MeshletGeometryManifest } from './format'
import { loadMeshletAsset } from './load'

export interface MeshletModelInstance {
  name: string
  geometry: number
  matrix: Matrix4
}

export interface MeshletModel {
  materials: Material[]
  geometries: Map<number, MeshletAsset>
  instances: MeshletModelInstance[]
  bounds: Box3
}

export async function loadMeshletModel(manifestUrl: string): Promise<MeshletModel> {
  const manifestLocation = new URL(manifestUrl, typeof location === 'undefined' ? undefined : location.href)
  const response = await fetch(manifestLocation)
  if (!response.ok) throw new Error(`Geometry manifest request failed: ${response.status} ${response.statusText}`)
  const manifest = await response.json() as MeshletGeometryManifest
  if (!Array.isArray(manifest.geometries) || !manifest.geometries.length || !Array.isArray(manifest.instances)) throw new Error('Geometry manifest has no scene geometry')
  if (typeof manifest.materialUrl !== 'string' || !manifest.materialUrl) throw new Error('Geometry manifest has no material library')
  const [materials, entries] = await Promise.all([
    new GLTFLoader().loadAsync(new URL(manifest.materialUrl, manifestLocation).href).then(gltf => gltf.parser.getDependencies('material') as Promise<Material[]>),
    Promise.all(manifest.geometries.map(async geometry => [
      geometry.meshIndex,
      await loadMeshletAsset(new URL(geometry.url, manifestLocation)),
    ] as const)),
  ])
  const geometries = new Map<number, MeshletAsset>(entries)
  if (geometries.size !== entries.length) throw new Error('Geometry manifest contains duplicate mesh indices')
  for (const asset of geometries.values()) {
    if (asset.metadata.primitives.some(primitive => primitive.materialIndex >= materials.length)) throw new Error('Geometry references a missing source material')
  }
  const bounds = new Box3()
  const localBounds = new Box3()
  const instances = manifest.instances.map(instance => {
    const asset = geometries.get(instance.geometry)
    if (!asset || instance.matrix.length !== 16 || !instance.matrix.every(Number.isFinite)) throw new Error('Geometry manifest contains an invalid instance')
    const matrix = new Matrix4().fromArray(instance.matrix)
    localBounds.set(new Vector3().fromArray(asset.metadata.bounds.min), new Vector3().fromArray(asset.metadata.bounds.max)).applyMatrix4(matrix)
    bounds.union(localBounds)
    return { name: instance.name, geometry: instance.geometry, matrix }
  })
  return { materials, geometries, instances, bounds }
}
