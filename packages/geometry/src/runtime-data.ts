import { Matrix4, StorageBufferAttribute, Vector3 } from 'three/webgpu'
import type { MeshStandardMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import type { MeshletAsset } from './format'

export interface MeshletSceneEntry {
  asset: MeshletAsset
  instances: readonly Matrix4[]
  materials: readonly (MeshStandardMaterial | MeshStandardNodeMaterial)[]
}

export const DRAW_ARGUMENT_OFFSET = 16

export function validateTransform(matrix: Matrix4) {
  const e = matrix.elements
  if (!e.every(Number.isFinite) || Math.abs(matrix.determinant()) < 1e-12) throw new Error('Geometry transforms must be finite and invertible')
  const x = new Vector3(e[0], e[1], e[2]).normalize()
  const y = new Vector3(e[4], e[5], e[6]).normalize()
  const z = new Vector3(e[8], e[9], e[10]).normalize()
  if (Math.max(Math.abs(x.dot(y)), Math.abs(y.dot(z)), Math.abs(z.dot(x))) > 1e-5) throw new Error('Geometry transforms must not contain shear')
}

export function packScene(entries: readonly MeshletSceneEntry[]) {
  const assets = new Map<MeshletAsset, { vertex: number; index: number; cluster: number }>()
  const batches: { material: MeshletSceneEntry['materials'][number]; capacity: number; offset: number; triangles: number }[] = []
  const materialIndices = new Map<MeshletSceneEntry['materials'][number], number>()
  let vertexCount = 0
  let indexCount = 0
  let clusterCount = 0
  let instanceCount = 0
  let candidateCount = 0
  let totalTriangles = 0
  for (const entry of entries) {
    if (entry.instances.length === 0) throw new Error('Geometry entries require at least one instance')
    if (entry.materials.length !== entry.asset.metadata.materials.length) throw new Error('Geometry material slots must match the asset')
    const asset = entry.asset
    if (!assets.has(asset)) {
      assets.set(asset, { vertex: vertexCount, index: indexCount, cluster: clusterCount })
      vertexCount += asset.positions.length / 3
      indexCount += asset.indices.length
      clusterCount += asset.metadata.clusterCount
    }
    for (let i = 0; i < asset.metadata.clusterCount; i++) {
      const material = entry.materials[asset.clusterData[i * 8 + 5]!]
      if (!material) throw new Error('Geometry cluster references a missing material slot')
      if (!materialIndices.has(material)) {
        materialIndices.set(material, batches.length)
        batches.push({ material, capacity: 0, offset: 0, triangles: 0 })
      }
      const batch = batches[materialIndices.get(material)!]!
      batch.capacity += entry.instances.length
      batch.triangles = Math.max(batch.triangles, asset.clusterData[i * 8 + 1]! / 3)
    }
    instanceCount += entry.instances.length
    candidateCount += asset.metadata.clusterCount * entry.instances.length
    totalTriangles += asset.metadata.sourceTriangles * entry.instances.length
  }
  if (candidateCount === 0) throw new Error('Geometry requires at least one cluster')
  let visibleOffset = 0
  for (const batch of batches) {
    batch.offset = visibleOffset
    visibleOffset += batch.capacity
  }
  const clusterData = new ArrayBuffer(clusterCount * 80)
  const clusterFloats = new Float32Array(clusterData)
  const clusterIntegers = new Uint32Array(clusterData)
  const vertexData = new Float32Array(vertexCount * 8)
  const indexData = new Uint32Array(indexCount)
  for (const [asset, base] of assets) {
    for (let i = 0; i < asset.positions.length / 3; i++) {
      const offset = (base.vertex + i) * 8
      vertexData.set(asset.positions.subarray(i * 3, i * 3 + 3), offset)
      vertexData[offset + 3] = asset.uvs[i * 2]!
      vertexData.set(asset.normals.subarray(i * 3, i * 3 + 3), offset + 4)
      vertexData[offset + 7] = asset.uvs[i * 2 + 1]!
    }
    for (let i = 0; i < asset.indices.length; i++) indexData[base.index + i] = asset.indices[i]! + base.vertex
    for (let i = 0; i < asset.metadata.clusterCount; i++) {
      const offset = (base.cluster + i) * 20
      clusterFloats.set(asset.clusterBounds.subarray(i * 4, i * 4 + 4), offset)
      clusterFloats.set(asset.clusterLod.subarray(i * 12, i * 12 + 12), offset + 4)
      clusterIntegers[offset + 16] = asset.clusterData[i * 8]! + base.index
      clusterIntegers[offset + 17] = asset.clusterData[i * 8 + 1]!
      clusterIntegers[offset + 18] = asset.clusterData[i * 8 + 4]!
      clusterIntegers[offset + 19] = base.cluster + i
    }
  }
  const instanceData = new Float32Array(instanceCount * 36)
  const candidateData = new Uint32Array(candidateCount * 4)
  const inverseTranspose = new Matrix4()
  let instanceIndex = 0
  let candidateIndex = 0
  for (const entry of entries) {
    const asset = entry.asset
    const base = assets.get(asset)!
    for (const matrix of entry.instances) {
      validateTransform(matrix)
      instanceData.set(matrix.elements, instanceIndex * 36)
      inverseTranspose.copy(matrix).invert().transpose()
      instanceData.set(inverseTranspose.elements, instanceIndex * 36 + 16)
      instanceData[instanceIndex * 36 + 32] = matrix.getMaxScaleOnAxis()
      instanceData[instanceIndex * 36 + 33] = Math.sign(matrix.determinant())
      for (let cluster = 0; cluster < asset.metadata.clusterCount; cluster++) {
        const batchIndex = materialIndices.get(entry.materials[asset.clusterData[cluster * 8 + 5]!]!)!
        candidateData.set([base.cluster + cluster, instanceIndex, DRAW_ARGUMENT_OFFSET + batchIndex * 4, batches[batchIndex]!.offset], candidateIndex * 4)
        candidateIndex++
      }
      instanceIndex++
    }
  }
  return {
    batches, vertexCount, indexCount, clusterCount, instanceCount, candidateCount, totalTriangles,
    clusters: new StorageBufferAttribute(clusterIntegers, 20),
    vertices: new StorageBufferAttribute(vertexData, 8),
    indices: new StorageBufferAttribute(indexData, 1),
    instances: new StorageBufferAttribute(instanceData, 36),
    candidates: new StorageBufferAttribute(candidateData, 4),
  }
}
