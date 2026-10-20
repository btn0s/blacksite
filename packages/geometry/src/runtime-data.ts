import { Matrix4, StorageBufferAttribute } from 'three/webgpu'
import type { MeshStandardMaterial, MeshStandardNodeMaterial, WebGPURenderer } from 'three/webgpu'
import { Fn, storage } from 'three/tsl'
import type { MeshletAssetSource } from './load'

export interface MeshletSceneEntry {
  asset: MeshletAssetSource
  instances: readonly Matrix4[]
  materials: readonly (MeshStandardMaterial | MeshStandardNodeMaterial)[]
}

export interface ResidentMeshletGeometry {
  vertices: StorageBufferAttribute
  vertexReferences: StorageBufferAttribute
  indices: StorageBufferAttribute
}

export interface PackedMeshletScene {
  batches: { material: MeshletSceneEntry['materials'][number]; geometry: ResidentMeshletGeometry; capacity: number; offset: number; triangles: number }[]
  clusterCount: number
  instanceCount: number
  candidateCount: number
  totalTriangles: number
  residentGeometryBytes: number
  clusters: StorageBufferAttribute
  instances: StorageBufferAttribute
  candidates: StorageBufferAttribute
}

export const DRAW_ARGUMENT_OFFSET = 16

export async function uploadAttributes(renderer: WebGPURenderer, attributes: readonly StorageBufferAttribute[]) {
  const buffers = attributes.map(attribute => storage(attribute, 'uint', attribute.array.length))
  const upload = Fn(() => {
    for (const buffer of buffers) buffer.element(0).assign(buffer.element(0))
  })().compute(1).setName('Geometry resident upload')
  try {
    await renderer.compileComputeAsync(upload)
    const sources = new Set(attributes.map(attribute => attribute.array.buffer))
    for (const attribute of attributes) attribute.array = attribute.array instanceof Float32Array ? new Float32Array(0) : new Uint32Array(0)
    for (const source of sources) {
      if (!(source instanceof ArrayBuffer)) throw new Error('Geometry upload requires transferable buffers')
      source.transfer(0)
    }
  } finally {
    upload.dispose()
  }
}

export function transformScale(matrix: Matrix4) {
  const e = matrix.elements
  if (!e.every(Number.isFinite) || Math.abs(matrix.determinant()) < 1e-12 || e[3] !== 0 || e[7] !== 0 || e[11] !== 0 || e[15] !== 1) throw new Error('Geometry transforms must be finite, affine and invertible')
  const xx = e[0]! ** 2 + e[1]! ** 2 + e[2]! ** 2
  const yy = e[4]! ** 2 + e[5]! ** 2 + e[6]! ** 2
  const zz = e[8]! ** 2 + e[9]! ** 2 + e[10]! ** 2
  const xy = Math.abs(e[0]! * e[4]! + e[1]! * e[5]! + e[2]! * e[6]!)
  const xz = Math.abs(e[0]! * e[8]! + e[1]! * e[9]! + e[2]! * e[10]!)
  const yz = Math.abs(e[4]! * e[8]! + e[5]! * e[9]! + e[6]! * e[10]!)
  return Math.sqrt(Math.max(xx + xy + xz, yy + xy + yz, zz + xz + yz))
}

export async function packScene(renderer: WebGPURenderer, entries: readonly MeshletSceneEntry[]): Promise<PackedMeshletScene> {
  const sources = new Map<MeshletAssetSource, MeshletSceneEntry[]>()
  const batches: PackedMeshletScene['batches'] = []
  let clusterCount = 0
  let instanceCount = 0
  let candidateCapacity = 0
  let totalTriangles = 0
  let residentGeometryBytes = 0
  for (const entry of entries) {
    if (entry.instances.length === 0) throw new Error('Geometry entries require at least one instance')
    if (entry.materials.length !== entry.asset.metadata.materials.length) throw new Error('Geometry material slots must match the asset')
    if (!sources.has(entry.asset)) {
      sources.set(entry.asset, [])
      clusterCount += entry.asset.metadata.clusterCount
    }
    sources.get(entry.asset)!.push(entry)
    instanceCount += entry.instances.length
    candidateCapacity += entry.asset.metadata.clusterCount * entry.instances.length
    totalTriangles += entry.asset.metadata.sourceTriangles * entry.instances.length
  }
  const clusterData = new ArrayBuffer(clusterCount * 128)
  const clusterFloats = new Float32Array(clusterData)
  const clusterIntegers = new Uint32Array(clusterData)
  const instanceData = new Float32Array(instanceCount * 36)
  const candidateData = new Uint32Array(candidateCapacity * 4)
  const inverseTranspose = new Matrix4()
  let clusterBase = 0
  let instanceIndex = 0
  let candidateCount = 0
  for (const [source, sourceEntries] of sources) {
    const asset = await source.load()
    if (asset.metadata.clusterCount !== source.metadata.clusterCount || asset.metadata.residentVertices !== source.metadata.residentVertices || asset.metadata.source.sha256 !== source.metadata.source.sha256) throw new Error('Geometry source changed after metadata was loaded')
    const geometry: ResidentMeshletGeometry = {
      vertices: new StorageBufferAttribute(asset.vertices, 1),
      vertexReferences: new StorageBufferAttribute(asset.vertexReferences, 1),
      indices: new StorageBufferAttribute(asset.indices, 1),
    }
    residentGeometryBytes += asset.vertices.byteLength + asset.vertexReferences.byteLength + asset.indices.byteLength + asset.metadata.clusterCount * 128
    const materialIndices = new Map<MeshletSceneEntry['materials'][number], number>()
    for (let i = 0; i < asset.metadata.clusterCount; i++) {
      const offset = (clusterBase + i) * 32
      clusterFloats.set(asset.clusterBounds.subarray(i * 4, i * 4 + 4), offset)
      clusterFloats.set(asset.clusterLod.subarray(i * 12, i * 12 + 12), offset + 4)
      clusterIntegers[offset + 16] = asset.clusterData[i * 8]!
      clusterIntegers[offset + 17] = asset.clusterData[i * 8 + 1]!
      clusterIntegers[offset + 18] = asset.clusterData[i * 8 + 4]!
      clusterIntegers[offset + 19] = asset.clusterData[i * 8 + 7]!
      clusterFloats.set(asset.clusterQuantization.subarray(i * 12, i * 12 + 12), offset + 20)
      const quantizationRadius = Math.hypot(asset.clusterQuantization[i * 12 + 4]!, asset.clusterQuantization[i * 12 + 5]!, asset.clusterQuantization[i * 12 + 6]!) * 0.5
      for (const radius of [3, 7, 11]) clusterFloats[offset + radius] = clusterFloats[offset + radius]! + quantizationRadius
    }
    for (const entry of sourceEntries) {
      for (let cluster = 0; cluster < asset.metadata.clusterCount; cluster++) {
        const material = entry.materials[asset.clusterData[cluster * 8 + 5]!]
        if (!material) throw new Error('Geometry cluster references a missing material slot')
        if (!material.visible) continue
        if (!materialIndices.has(material)) {
          materialIndices.set(material, batches.length)
          batches.push({ material, geometry, capacity: 0, offset: 0, triangles: 0 })
        }
        const batch = batches[materialIndices.get(material)!]!
        batch.capacity += entry.instances.length
        batch.triangles = Math.max(batch.triangles, asset.clusterData[cluster * 8 + 1]! / 3)
      }
      for (const matrix of entry.instances) {
        const scale = transformScale(matrix)
        instanceData.set(matrix.elements, instanceIndex * 36)
        inverseTranspose.copy(matrix).invert().transpose()
        instanceData.set(inverseTranspose.elements, instanceIndex * 36 + 16)
        instanceData[instanceIndex * 36 + 32] = scale
        instanceData[instanceIndex * 36 + 33] = Math.sign(matrix.determinant())
        for (let cluster = 0; cluster < asset.metadata.clusterCount; cluster++) {
          const material = entry.materials[asset.clusterData[cluster * 8 + 5]!]!
          if (!material.visible) continue
          const batchIndex = materialIndices.get(material)!
          const offset = candidateCount * 4
          candidateData[offset] = clusterBase + cluster
          candidateData[offset + 1] = instanceIndex
          candidateData[offset + 2] = DRAW_ARGUMENT_OFFSET + batchIndex * 4
          candidateData[offset + 3] = batchIndex
          candidateCount++
        }
        instanceIndex++
      }
    }
    clusterBase += asset.metadata.clusterCount
    await uploadAttributes(renderer, [geometry.vertices, geometry.vertexReferences, geometry.indices])
  }
  if (candidateCount === 0) throw new Error('Geometry requires at least one cluster')
  let visibleOffset = 0
  for (const batch of batches) {
    batch.offset = visibleOffset
    visibleOffset += batch.capacity
  }
  for (let i = 0; i < candidateCount; i++) candidateData[i * 4 + 3] = batches[candidateData[i * 4 + 3]!]!.offset
  const packed: PackedMeshletScene = {
    batches, clusterCount, instanceCount, candidateCount, totalTriangles, residentGeometryBytes,
    clusters: new StorageBufferAttribute(clusterIntegers, 4),
    instances: new StorageBufferAttribute(instanceData, 4),
    candidates: new StorageBufferAttribute(candidateData.subarray(0, candidateCount * 4), 4),
  }
  await uploadAttributes(renderer, [packed.clusters, packed.instances, packed.candidates])
  return packed
}
