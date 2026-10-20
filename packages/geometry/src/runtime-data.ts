import { Matrix4, StorageBufferAttribute, Vector3 } from 'three/webgpu'
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
  residentBytes: number
  hierarchyDepth: number
  queueCapacity: number
  leafCapacity: number
  rootTriangles: number
  maximumError: number
  clusters: StorageBufferAttribute
  instances: StorageBufferAttribute
  nodes: StorageBufferAttribute
  instanceInfo: StorageBufferAttribute
  instanceBounds: StorageBufferAttribute
  materialMap: StorageBufferAttribute
}

export const DRAW_ARGUMENT_OFFSET = 32
export const DRAW_ARGUMENT_STRIDE = 8
export const INDEX_BUDGET_OFFSET = 24

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
  let nodeCount = 0
  let leafCapacity = 0
  let totalTriangles = 0
  let residentGeometryBytes = 0
  let rootTriangles = 0
  let maximumError = 0
  for (const entry of entries) {
    if (entry.instances.length === 0) throw new Error('Geometry entries require at least one instance')
    if (entry.materials.length !== entry.asset.metadata.materials.length) throw new Error('Geometry material slots must match the asset')
    if (!sources.has(entry.asset)) {
      sources.set(entry.asset, [])
      clusterCount += entry.asset.metadata.clusterCount
      nodeCount += entry.asset.metadata.nodeCount
    }
    sources.get(entry.asset)!.push(entry)
    instanceCount += entry.instances.length
    leafCapacity += entry.asset.metadata.clusterCount * entry.instances.length
    totalTriangles += entry.asset.metadata.sourceTriangles * entry.instances.length
  }
  const clusterIntegers = new Uint32Array(clusterCount * 32)
  const clusterFloats = new Float32Array(clusterIntegers.buffer)
  const nodes = new Uint32Array(nodeCount * 12)
  const nodeFloats = new Float32Array(nodes.buffer)
  const instanceData = new Float32Array(instanceCount * 36)
  const instanceInfo = new Uint32Array(instanceCount * 4)
  const instanceBounds = new Float32Array(instanceCount * 4)
  const materialMap: number[] = []
  const frontierWidths: number[] = []
  const inverseTranspose = new Matrix4()
  const transformed = new Vector3()
  let clusterBase = 0
  let nodeBase = 0
  let instanceIndex = 0
  for (const [source, sourceEntries] of sources) {
    const asset = await source.load()
    if (asset.metadata.clusterCount !== source.metadata.clusterCount || asset.metadata.nodeCount !== source.metadata.nodeCount || asset.metadata.rootCount !== source.metadata.rootCount || asset.metadata.residentVertices !== source.metadata.residentVertices || asset.metadata.source.sha256 !== source.metadata.source.sha256) throw new Error('Geometry source changed after metadata was loaded')
    const geometry: ResidentMeshletGeometry = {
      vertices: new StorageBufferAttribute(asset.vertices, 1),
      vertexReferences: new StorageBufferAttribute(asset.vertexReferences, 1),
      indices: new StorageBufferAttribute(asset.indices, 1),
    }
    residentGeometryBytes += asset.vertices.byteLength + asset.vertexReferences.byteLength + asset.indices.byteLength + asset.metadata.clusterCount * 128
    const materialIndices = new Map<MeshletSceneEntry['materials'][number], number>()
    const materialCounts = new Uint32Array(asset.metadata.materials.length)
    const materialTriangles = new Uint32Array(asset.metadata.materials.length)
    const materialRoots = new Uint32Array(asset.metadata.materials.length)
    const refinedGroups = new Set<number>()
    for (let i = 0; i < asset.metadata.clusterCount; i++) refinedGroups.add(asset.clusterData[i * 8 + 3]!)
    let sourceError = 0
    let quantizationRadius = 0
    for (let i = 0; i < asset.metadata.clusterCount; i++) {
      const offset = (clusterBase + i) * 32
      const material = asset.clusterData[i * 8 + 5]!
      if (material >= materialCounts.length) throw new Error('Geometry cluster references a missing material slot')
      materialCounts[material] = materialCounts[material]! + 1
      materialTriangles[material] = Math.max(materialTriangles[material]!, asset.clusterData[i * 8 + 1]! / 3)
      if (!refinedGroups.has(asset.clusterData[i * 8 + 2]!)) materialRoots[material] = materialRoots[material]! + asset.clusterData[i * 8 + 1]! / 3
      sourceError = Math.max(sourceError, asset.clusterLod[i * 12 + 8]!)
      clusterFloats.set(asset.clusterBounds.subarray(i * 4, i * 4 + 4), offset)
      clusterFloats.set(asset.clusterLod.subarray(i * 12, i * 12 + 12), offset + 4)
      clusterIntegers[offset + 14] = material
      clusterIntegers[offset + 15] = asset.clusterData[i * 8 + 3]!
      clusterIntegers[offset + 16] = asset.clusterData[i * 8]!
      clusterIntegers[offset + 17] = asset.clusterData[i * 8 + 1]!
      clusterIntegers[offset + 18] = asset.clusterData[i * 8 + 4]!
      clusterIntegers[offset + 19] = asset.clusterData[i * 8 + 7]!
      clusterFloats.set(asset.clusterQuantization.subarray(i * 12, i * 12 + 12), offset + 20)
      const radius = Math.hypot(asset.clusterQuantization[i * 12 + 4]!, asset.clusterQuantization[i * 12 + 5]!, asset.clusterQuantization[i * 12 + 6]!) * 0.5
      quantizationRadius = Math.max(quantizationRadius, radius)
      for (const field of [3, 7, 11]) clusterFloats[offset + field] = clusterFloats[offset + field]! + radius
    }
    for (let i = 0; i < asset.metadata.nodeCount; i++) {
      const offset = (nodeBase + i) * 12
      nodeFloats.set(asset.nodeBounds.subarray(i * 8, i * 8 + 8), offset)
      nodeFloats[offset + 3] = nodeFloats[offset + 3]! + quantizationRadius
      const group = asset.nodeData[i * 4]!
      nodes.set(group === 0xffffffff
        ? [group, nodeBase + asset.nodeData[i * 4 + 1]!, asset.nodeData[i * 4 + 2]!, 0]
        : [clusterBase + asset.groupData[group * 4]!, asset.groupData[group * 4 + 1]!, 0, 0], offset + 8)
    }
    const placements = sourceEntries.reduce((sum, entry) => sum + entry.instances.length, 0)
    let frontier = Array.from({ length: asset.metadata.rootCount }, (_, index) => index)
    for (let depth = 0; frontier.length; depth++) {
      frontierWidths[depth] = (frontierWidths[depth] ?? 0) + frontier.length * placements
      const next: number[] = []
      for (const node of frontier) {
        const group = asset.nodeData[node * 4]!
        if (group === 0xffffffff) {
          const first = asset.nodeData[node * 4 + 1]!
          const count = asset.nodeData[node * 4 + 2]!
          for (let i = 0; i < count; i++) next.push(first + i)
        }
      }
      frontier = next
    }
    const low = new Vector3(...asset.metadata.bounds.min)
    const high = new Vector3(...asset.metadata.bounds.max)
    const center = low.clone().add(high).multiplyScalar(0.5)
    const radius = low.distanceTo(high) * 0.5 + quantizationRadius
    for (const entry of sourceEntries) {
      const materialOffset = materialMap.length
      for (let slot = 0; slot < entry.materials.length; slot++) {
        const material = entry.materials[slot]!
        if (!material.visible || materialCounts[slot] === 0) {
          materialMap.push(0xffffffff)
          continue
        }
        if (!materialIndices.has(material)) {
          materialIndices.set(material, batches.length)
          batches.push({ material, geometry, capacity: 0, offset: 0, triangles: 0 })
        }
        const batchIndex = materialIndices.get(material)!
        const batch = batches[batchIndex]!
        batch.capacity += materialCounts[slot]! * entry.instances.length
        batch.triangles = Math.max(batch.triangles, materialTriangles[slot]!)
        rootTriangles += materialRoots[slot]! * entry.instances.length
        materialMap.push(batchIndex)
      }
      for (const matrix of entry.instances) {
        const scale = transformScale(matrix)
        maximumError = Math.max(maximumError, sourceError * scale)
        instanceData.set(matrix.elements, instanceIndex * 36)
        inverseTranspose.copy(matrix).invert().transpose()
        instanceData.set(inverseTranspose.elements, instanceIndex * 36 + 16)
        instanceData[instanceIndex * 36 + 32] = scale
        instanceData[instanceIndex * 36 + 33] = Math.sign(matrix.determinant())
        instanceData[instanceIndex * 36 + 34] = materialOffset
        instanceInfo.set([nodeBase, asset.metadata.rootCount, 0, 0], instanceIndex * 4)
        transformed.copy(center).applyMatrix4(matrix)
        instanceBounds.set([transformed.x, transformed.y, transformed.z, radius * scale], instanceIndex * 4)
        instanceIndex++
      }
    }
    clusterBase += asset.metadata.clusterCount
    nodeBase += asset.metadata.nodeCount
    await uploadAttributes(renderer, [geometry.vertices, geometry.vertexReferences, geometry.indices])
  }
  let candidateCount = 0
  const bindings = new Uint32Array(batches.length * 2 + materialMap.length)
  bindings.set(materialMap, batches.length * 2)
  for (let i = 0; i < instanceCount; i++) instanceData[i * 36 + 34] = instanceData[i * 36 + 34]! + batches.length * 2
  for (const [index, batch] of batches.entries()) {
    batch.offset = candidateCount
    candidateCount += batch.capacity
    bindings.set([batch.offset, batch.capacity], index * 2)
  }
  if (candidateCount === 0) throw new Error('Geometry requires at least one visible cluster')
  if (candidateCount > 0x1000000) throw new Error('Indexed geometry supports at most 16,777,216 visible cluster slots')
  const attributes = {
    clusters: new StorageBufferAttribute(clusterIntegers, 4),
    instances: new StorageBufferAttribute(instanceData, 4),
    nodes: new StorageBufferAttribute(nodes, 4),
    instanceInfo: new StorageBufferAttribute(instanceInfo, 4),
    instanceBounds: new StorageBufferAttribute(instanceBounds, 4),
    materialMap: new StorageBufferAttribute(bindings, 1),
  }
  const residentBytes = residentGeometryBytes + Object.entries(attributes).reduce((sum, [name, attribute]) => sum + (name === 'clusters' ? 0 : attribute.array.byteLength), 0)
  const packed: PackedMeshletScene = {
    batches, clusterCount, instanceCount, candidateCount, totalTriangles, residentGeometryBytes, residentBytes,
    hierarchyDepth: frontierWidths.length,
    queueCapacity: Math.max(...frontierWidths),
    leafCapacity, rootTriangles, maximumError,
    ...attributes,
  }
  await uploadAttributes(renderer, Object.values(attributes))
  return packed
}
