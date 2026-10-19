import { Matrix4, StorageBufferAttribute, Vector3 } from 'three/webgpu'
import type { MeshStandardMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import type { MeshletAsset } from './format'

export interface MeshletSceneEntry {
  asset: MeshletAsset
  instances: readonly Matrix4[]
  materials: readonly (MeshStandardMaterial | MeshStandardNodeMaterial)[]
}

export const DRAW_ARGUMENT_OFFSET = 32

export function validateTransform(matrix: Matrix4) {
  const e = matrix.elements
  if (!e.every(Number.isFinite) || Math.abs(matrix.determinant()) < 1e-12) throw new Error('Geometry transforms must be finite and invertible')
  if (e[3] !== 0 || e[7] !== 0 || e[11] !== 0 || e[15] !== 1) throw new Error('Geometry transforms must be affine')
}

export function transformScale(matrix: Matrix4) {
  const e = matrix.elements
  const columns = [new Vector3(e[0], e[1], e[2]), new Vector3(e[4], e[5], e[6]), new Vector3(e[8], e[9], e[10])]
  return Math.sqrt(Math.max(...columns.map(a => columns.reduce((sum, b) => sum + Math.abs(a.dot(b)), 0))))
}

export function packScene(entries: readonly MeshletSceneEntry[]) {
  const assets = new Map<MeshletAsset, { vertex: number; index: number; cluster: number; node: number }>()
  const batches: { material: MeshletSceneEntry['materials'][number]; triangles: number }[] = []
  const materialIndices = new Map<MeshletSceneEntry['materials'][number], number>()
  let vertexCount = 0, indexCount = 0, clusterCount = 0, instanceCount = 0, nodeCount = 0, totalTriangles = 0, candidateCount = 0, hierarchyDepth = 0
  for (const entry of entries) {
    if (!entry.instances.length || entry.materials.length !== entry.asset.metadata.materials.length) throw new Error('Geometry entries require instances and matching material slots')
    const asset = entry.asset
    if (!assets.has(asset)) {
      assets.set(asset, { vertex: vertexCount, index: indexCount, cluster: clusterCount, node: nodeCount })
      vertexCount += asset.positions.length / 3
      indexCount += asset.indices.length
      clusterCount += asset.metadata.clusterCount
      nodeCount += asset.metadata.nodeCount
      const depth = (node: number): number => {
        const first = asset.nodeData[node * 4 + 1]!, count = asset.nodeData[node * 4 + 2]!
        let result = 1
        for (let i = 0; i < count; i++) result = Math.max(result, 1 + depth(first + i))
        return result
      }
      for (let i = 0; i < asset.metadata.rootCount; i++) hierarchyDepth = Math.max(hierarchyDepth, depth(i))
    }
    for (const material of entry.materials) if (!materialIndices.has(material)) {
      materialIndices.set(material, batches.length)
      batches.push({ material, triangles: asset.metadata.maxClusterTriangles })
    }
    instanceCount += entry.instances.length
    candidateCount += asset.metadata.clusterCount * entry.instances.length
    totalTriangles += asset.metadata.sourceTriangles * entry.instances.length
  }
  if (!clusterCount) throw new Error('Geometry requires at least one cluster')
  const clusterIntegers = new Uint32Array(clusterCount * 20)
  const clusterFloats = new Float32Array(clusterIntegers.buffer)
  const vertexData = new Float32Array(vertexCount * 8)
  const indexData = new Uint32Array(indexCount)
  const nodes = new Uint32Array(nodeCount * 12)
  const nodeFloats = new Float32Array(nodes.buffer)
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
      clusterIntegers[offset + 19] = asset.clusterData[i * 8 + 5]!
    }
    for (let i = 0; i < asset.metadata.nodeCount; i++) {
      const offset = (base.node + i) * 12
      nodeFloats.set(asset.nodeBounds.subarray(i * 8, i * 8 + 8), offset)
      const group = asset.nodeData[i * 4]!
      nodes.set(group === 0xffffffff ? [group, base.node + asset.nodeData[i * 4 + 1]!, asset.nodeData[i * 4 + 2]!, 0] : [base.cluster + asset.groupData[group * 4]!, asset.groupData[group * 4 + 1]!, 0, 0], offset + 8)
    }
  }
  const instanceData = new Float32Array(instanceCount * 36)
  const instanceInfo = new Uint32Array(instanceCount * 4)
  const instanceBounds = new Float32Array(instanceCount * 4)
  const materialMap: number[] = []
  const inverseTranspose = new Matrix4()
  let instanceIndex = 0
  for (const entry of entries) {
    const asset = entry.asset, base = assets.get(asset)!
    const materialOffset = materialMap.length
    materialMap.push(...entry.materials.map(material => materialIndices.get(material)!))
    const low = new Vector3(...asset.metadata.bounds.min), high = new Vector3(...asset.metadata.bounds.max)
    const center = low.clone().add(high).multiplyScalar(0.5), radius = low.distanceTo(high) * 0.5
    for (const matrix of entry.instances) {
      validateTransform(matrix)
      const scale = transformScale(matrix)
      instanceData.set(matrix.elements, instanceIndex * 36)
      inverseTranspose.copy(matrix).invert().transpose()
      instanceData.set(inverseTranspose.elements, instanceIndex * 36 + 16)
      instanceData[instanceIndex * 36 + 32] = scale
      instanceData[instanceIndex * 36 + 33] = Math.sign(matrix.determinant())
      instanceData[instanceIndex * 36 + 34] = materialOffset
      instanceInfo.set([base.node, asset.metadata.rootCount, materialOffset, 0], instanceIndex * 4)
      const transformed = center.clone().applyMatrix4(matrix)
      instanceBounds.set([transformed.x, transformed.y, transformed.z, radius * scale], instanceIndex * 4)
      instanceIndex++
    }
  }
  const attributes = {
    clusters: new StorageBufferAttribute(clusterIntegers, 4), vertices: new StorageBufferAttribute(vertexData, 4), indices: new StorageBufferAttribute(indexData, 1),
    instances: new StorageBufferAttribute(instanceData, 4), nodes: new StorageBufferAttribute(nodes, 4),
    instanceInfo: new StorageBufferAttribute(instanceInfo, 4), instanceBounds: new StorageBufferAttribute(instanceBounds, 4), materialMap: new StorageBufferAttribute(Uint32Array.from(materialMap), 1),
  }
  return { batches, vertexCount, indexCount, clusterCount, instanceCount, candidateCount, totalTriangles, hierarchyDepth,
    residentBytes: Object.values(attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0), ...attributes }
}
