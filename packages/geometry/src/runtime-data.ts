import { Matrix4, StorageBufferAttribute } from 'three/webgpu'
import type { MeshStandardMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import type { MeshletAsset } from './format'

export interface MeshletSceneEntry {
  asset: MeshletAsset
  instances: readonly Matrix4[]
  materials: readonly (MeshStandardMaterial | MeshStandardNodeMaterial)[]
}

export const DRAW_ARGUMENT_OFFSET = 16

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

export function packScene(entries: readonly MeshletSceneEntry[]) {
  const assets = new Map<MeshletAsset, { vertex: number; index: number; cluster: number; reference: number }>()
  const batches: { material: MeshletSceneEntry['materials'][number]; capacity: number; offset: number; triangles: number }[] = []
  const materialIndices = new Map<MeshletSceneEntry['materials'][number], number>()
  let vertexCount = 0
  let referenceCount = 0
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
      assets.set(asset, { vertex: vertexCount, index: indexCount, cluster: clusterCount, reference: referenceCount })
      referenceCount += asset.vertexReferences.length
      vertexCount += asset.metadata.residentVertices
      indexCount += asset.indices.length
      clusterCount += asset.metadata.clusterCount
    }
    let visibleClusters = 0
    for (let i = 0; i < asset.metadata.clusterCount; i++) {
      const material = entry.materials[asset.clusterData[i * 8 + 5]!]
      if (!material) throw new Error('Geometry cluster references a missing material slot')
      if (!material.visible) continue
      visibleClusters++
      if (!materialIndices.has(material)) {
        materialIndices.set(material, batches.length)
        batches.push({ material, capacity: 0, offset: 0, triangles: 0 })
      }
      const batch = batches[materialIndices.get(material)!]!
      batch.capacity += entry.instances.length
      batch.triangles = Math.max(batch.triangles, asset.clusterData[i * 8 + 1]! / 3)
    }
    instanceCount += entry.instances.length
    candidateCount += visibleClusters * entry.instances.length
    totalTriangles += asset.metadata.sourceTriangles * entry.instances.length
  }
  if (candidateCount === 0) throw new Error('Geometry requires at least one cluster')
  let visibleOffset = 0
  for (const batch of batches) {
    batch.offset = visibleOffset
    visibleOffset += batch.capacity
  }
  const clusterData = new ArrayBuffer(clusterCount * 128)
  const clusterFloats = new Float32Array(clusterData)
  const clusterIntegers = new Uint32Array(clusterData)
  const vertexData = new Uint32Array(vertexCount * 5)
  const indexData = new Uint32Array(indexCount)
  const referenceData = new Uint32Array(referenceCount)
  for (const [asset, base] of assets) {
    vertexData.set(asset.vertices, base.vertex * 5)
    indexData.set(asset.indices, base.index)
    for (let i = 0; i < asset.vertexReferences.length; i++) referenceData[base.reference + i] = asset.vertexReferences[i]! + base.vertex
    for (let i = 0; i < asset.metadata.clusterCount; i++) {
      const offset = (base.cluster + i) * 32
      clusterFloats.set(asset.clusterBounds.subarray(i * 4, i * 4 + 4), offset)
      clusterFloats.set(asset.clusterLod.subarray(i * 12, i * 12 + 12), offset + 4)
      clusterIntegers[offset + 16] = asset.clusterData[i * 8]! + base.index * 4
      clusterIntegers[offset + 17] = asset.clusterData[i * 8 + 1]!
      clusterIntegers[offset + 18] = asset.clusterData[i * 8 + 4]!
      clusterIntegers[offset + 19] = asset.clusterData[i * 8 + 7]! + base.reference
      clusterFloats.set(asset.clusterQuantization.subarray(i * 12, i * 12 + 12), offset + 20)
      const quantizationRadius = Math.hypot(asset.clusterQuantization[i * 12 + 4]!, asset.clusterQuantization[i * 12 + 5]!, asset.clusterQuantization[i * 12 + 6]!) * 0.5
      for (const radius of [3, 7, 11]) clusterFloats[offset + radius] = clusterFloats[offset + radius]! + quantizationRadius
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
        candidateData.set([base.cluster + cluster, instanceIndex, DRAW_ARGUMENT_OFFSET + batchIndex * 4, batches[batchIndex]!.offset], candidateIndex * 4)
        candidateIndex++
      }
      instanceIndex++
    }
  }
  return {
    batches, vertexCount, indexCount, clusterCount, instanceCount, candidateCount, totalTriangles,
    clusters: new StorageBufferAttribute(clusterIntegers, 4),
    vertices: new StorageBufferAttribute(vertexData, 1),
    vertexReferences: new StorageBufferAttribute(referenceData, 1),
    indices: new StorageBufferAttribute(indexData, 1),
    instances: new StorageBufferAttribute(instanceData, 4),
    candidates: new StorageBufferAttribute(candidateData, 4),
  }
}
