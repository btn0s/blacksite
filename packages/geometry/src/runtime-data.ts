import { BackSide, DoubleSide, FrontSide, Matrix4, StorageBufferAttribute, Vector3 } from 'three/webgpu'
import type { MeshStandardMaterial, MeshStandardNodeMaterial, Side, WebGPURenderer } from 'three/webgpu'
import { Fn, storage } from 'three/tsl'
import type { MeshletAssetSource } from './load'
import type { MeshletMetadata } from './format'
import { geometryUsesCoverage } from './runtime-material'
import { MaterialCoverage } from './runtime-submission'

export interface MeshletSceneEntry {
  asset: MeshletAssetSource
  instances: readonly Matrix4[]
  materials: readonly (MeshStandardMaterial | MeshStandardNodeMaterial)[]
}

export interface PackedMeshletScene {
  batches: { material: MeshletSceneEntry['materials'][number]; capacity: number }[]
  depthBatches: { material: MeshletSceneEntry['materials'][number] | null; argument: number; firstMaterial: number; materialCount: number; side: Side; shadowSide: Side }[]
  drawCount: number
  clusterCount: number
  instanceCount: number
  candidateCount: number
  totalTriangles: number
  residentGeometryBytes: number
  residentBytes: number
  hierarchyDepth: number
  coarsest: { slots: number; frontier: number; groups: number; work: number }
  rootTriangles: number
  maximumError: number
  coverage: MaterialCoverage
  clusters: StorageBufferAttribute
  instances: StorageBufferAttribute
  nodes: StorageBufferAttribute
  instanceInfo: StorageBufferAttribute
  instanceBounds: StorageBufferAttribute
  materialMap: StorageBufferAttribute
  vertices: StorageBufferAttribute
  vertexReferences: StorageBufferAttribute
  indices: StorageBufferAttribute
}

export const CLUSTER_RECORD_WORDS = 40
export const DRAW_ARGUMENT_OFFSET = 32
export const DRAW_ARGUMENT_STRIDE = 5
export const INDEX_BUDGET_OFFSET = 24
export const SELECTED_CAPACITY = 1_048_576
export const FRONTIER_CAPACITY = 1_048_576
export const GROUP_CAPACITY = 524_288
export const SELECTION_WORK_BUDGET = 4_194_304

function shadowSide(material: MeshletSceneEntry['materials'][number]) {
  return material.shadowSide ?? (material.side === FrontSide ? BackSide : material.side === BackSide ? FrontSide : DoubleSide)
}

function depthState(material: MeshletSceneEntry['materials'][number]) {
  return geometryUsesCoverage(material) ? 9 : material.side * 3 + shadowSide(material)
}

function geometryPoolLayout(metadata: readonly MeshletMetadata[]) {
  return metadata.reduce((pool, asset) => ({
    vertices: pool.vertices + asset.residentVertices * asset.vertexStride / 4,
    references: pool.references + asset.meshletVertices,
    indices: pool.indices + asset.clusterCount * Math.ceil(asset.maxClusterTriangles * 3 / 4),
    clusters: pool.clusters + asset.clusterCount * CLUSTER_RECORD_WORDS,
  }), { vertices: 0, references: 0, indices: 0, clusters: 0 })
}

export function meshletStorageSize(metadata: readonly MeshletMetadata[]) {
  return Math.max(...Object.values(geometryPoolLayout(metadata))) * 4
}

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
    totalTriangles += entry.asset.metadata.sourceTriangles * entry.instances.length
  }
  const layout = geometryPoolLayout([...sources.keys()].map(source => source.metadata))
  const clusterIntegers = new Uint32Array(layout.clusters)
  const vertices = new Uint32Array(layout.vertices)
  const references = new Uint32Array(layout.references)
  const indices = new Uint32Array(layout.indices)
  const clusterFloats = new Float32Array(clusterIntegers.buffer)
  const nodes = new Uint32Array(nodeCount * 12)
  const nodeFloats = new Float32Array(nodes.buffer)
  const instanceData = new Float32Array(instanceCount * 36)
  const instanceInfo = new Uint32Array(instanceCount * 4)
  const instanceBounds = new Float32Array(instanceCount * 4)
  const materialMap: number[] = []
  const instanceSlots: number[] = []
  const frontierWidths: number[] = []
  const coarseWidths: number[] = []
  const coarsest = { slots: 0, frontier: 0, groups: 0, work: instanceCount }
  const inverseTranspose = new Matrix4()
  const transformed = new Vector3()
  let clusterBase = 0
  let nodeBase = 0
  let instanceIndex = 0
  let indexBase = 0
  let vertexBase = 0
  let referenceBase = 0
  const materialIndices = new Map<MeshletSceneEntry['materials'][number], number>()
  for (const [source, sourceEntries] of sources) {
    const asset = await source.load()
    if (asset.metadata.clusterCount !== source.metadata.clusterCount || asset.metadata.nodeCount !== source.metadata.nodeCount || asset.metadata.rootCount !== source.metadata.rootCount || asset.metadata.residentVertices !== source.metadata.residentVertices || asset.metadata.source.sha256 !== source.metadata.source.sha256) throw new Error('Geometry source changed after metadata was loaded')
    vertices.set(asset.vertices, vertexBase)
    references.set(asset.vertexReferences, referenceBase)
    indices.set(asset.indices, indexBase)
    residentGeometryBytes += asset.vertices.byteLength + asset.vertexReferences.byteLength + asset.indices.byteLength + asset.metadata.clusterCount * CLUSTER_RECORD_WORDS * 4
    const materialCounts = new Uint32Array(asset.metadata.materials.length)
    const materialRoots = new Uint32Array(asset.metadata.materials.length)
    const refinedGroups = new Set<number>()
    for (let i = 0; i < asset.metadata.clusterCount; i++) refinedGroups.add(asset.clusterData[i * 8 + 3]!)
    let sourceError = 0
    let quantizationRadius = 0
    for (let i = 0; i < asset.metadata.clusterCount; i++) {
      const offset = (clusterBase + i) * CLUSTER_RECORD_WORDS
      const material = asset.clusterData[i * 8 + 5]!
      if (material >= materialCounts.length) throw new Error('Geometry cluster references a missing material slot')
      materialCounts[material] = materialCounts[material]! + 1
      if (!refinedGroups.has(asset.clusterData[i * 8 + 2]!)) materialRoots[material] = materialRoots[material]! + asset.clusterData[i * 8 + 1]! / 3
      sourceError = Math.max(sourceError, asset.clusterLod[i * 12 + 8]!)
      clusterFloats.set(asset.clusterBounds.subarray(i * 4, i * 4 + 4), offset)
      clusterFloats.set(asset.clusterLod.subarray(i * 12, i * 12 + 12), offset + 4)
      clusterIntegers[offset + 14] = material
      clusterIntegers[offset + 15] = asset.clusterData[i * 8 + 3]!
      clusterIntegers[offset + 16] = indexBase * 4 + asset.clusterData[i * 8]!
      clusterIntegers[offset + 17] = asset.clusterData[i * 8 + 1]!
      clusterIntegers[offset + 18] = asset.clusterData[i * 8 + 4]!
      clusterIntegers[offset + 19] = referenceBase + asset.clusterData[i * 8 + 7]!
      clusterFloats.set(asset.clusterQuantization.subarray(i * 12, i * 12 + 12), offset + 20)
      clusterIntegers.set([vertexBase, asset.metadata.vertexStride / 4, asset.metadata.vertexAttributes?.color ?? 0, asset.metadata.vertexAttributes?.uv1 ?? 0], offset + 32)
      clusterFloats.set(asset.metadata.secondaryUvBounds ?? [0, 0, 0, 0], offset + 36)
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
    let coarse = Array.from({ length: asset.metadata.rootCount }, (_, index) => index)
    for (let depth = 0; coarse.length; depth++) {
      coarseWidths[depth] = (coarseWidths[depth] ?? 0) + coarse.length * placements
      coarsest.work += coarse.length * placements
      const next: number[] = []
      for (const node of coarse) {
        if (asset.nodeBounds[node * 8 + 4]! <= sourceError) continue
        const group = asset.nodeData[node * 4]!
        if (group === 0xffffffff) {
          const first = asset.nodeData[node * 4 + 1]!
          const count = asset.nodeData[node * 4 + 2]!
          for (let i = 0; i < count; i++) next.push(first + i)
        } else {
          const count = asset.groupData[group * 4 + 1]!
          coarsest.groups += placements
          coarsest.slots += count * placements
          coarsest.work += count * placements
        }
      }
      coarse = next
    }
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
          batches.push({ material, capacity: 0 })
        }
        const batchIndex = materialIndices.get(material)!
        const batch = batches[batchIndex]!
        batch.capacity += materialCounts[slot]! * entry.instances.length
        rootTriangles += materialRoots[slot]! * entry.instances.length
        materialMap.push(batchIndex)
      }
      for (const matrix of entry.instances) {
        instanceSlots.push(entry.materials.length)
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
    indexBase += asset.indices.length
    vertexBase += asset.vertices.length
    referenceBase += asset.vertexReferences.length
    if (!(asset.vertices.buffer instanceof ArrayBuffer)) throw new Error('Geometry sources require transferable buffers')
    asset.vertices.buffer.transfer(0)
  }
  batches.sort((a, b) => depthState(a.material) - depthState(b.material))
  const remap = new Uint32Array(batches.length)
  batches.forEach((batch, index) => { remap[materialIndices.get(batch.material)!] = index })
  for (let i = 0; i < materialMap.length; i++) if (materialMap[i] !== 0xffffffff) materialMap[i] = remap[materialMap[i]!]!
  const depthBatches: PackedMeshletScene['depthBatches'] = []
  let drawCount = batches.length
  for (let first = 0; first < batches.length;) {
    const material = batches[first]!.material
    const coverage = geometryUsesCoverage(material)
    let end = first + 1
    if (!coverage) while (end < batches.length && depthState(batches[end]!.material) === depthState(material)) end++
    depthBatches.push({ material: coverage ? material : null, argument: coverage ? first : drawCount++, firstMaterial: first, materialCount: end - first, side: material.side, shadowSide: shadowSide(material) })
    first = end
  }
  let candidateCount = 0
  for (const batch of batches) candidateCount += batch.capacity
  if (candidateCount === 0) throw new Error('Geometry requires at least one visible cluster')
  coarsest.frontier = Math.max(...coarseWidths)
  if (coarsest.slots > SELECTED_CAPACITY || coarsest.frontier > FRONTIER_CAPACITY || coarsest.groups > GROUP_CAPACITY || coarsest.work > SELECTION_WORK_BUDGET) {
    throw new Error(`Geometry cannot cover its certified coarsest cut within fixed traversal capacity: ${JSON.stringify(coarsest)}`)
  }
  const attributes = {
    clusters: new StorageBufferAttribute(clusterIntegers, 4),
    instances: new StorageBufferAttribute(instanceData, 4),
    nodes: new StorageBufferAttribute(nodes, 4),
    instanceInfo: new StorageBufferAttribute(instanceInfo, 4),
    instanceBounds: new StorageBufferAttribute(instanceBounds, 4),
    materialMap: new StorageBufferAttribute(new Uint32Array(materialMap), 1),
    vertices: new StorageBufferAttribute(vertices, 1),
    vertexReferences: new StorageBufferAttribute(references, 1),
    indices: new StorageBufferAttribute(indices.subarray(0, indexBase), 1),
  }
  const residentBytes = Object.values(attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0)
  const packed: PackedMeshletScene = {
    batches, depthBatches, drawCount,
    clusterCount, instanceCount, candidateCount, totalTriangles, residentGeometryBytes, residentBytes,
    hierarchyDepth: frontierWidths.length,
    coarsest, rootTriangles, maximumError,
    coverage: new MaterialCoverage(instanceBounds, instanceData, materialMap, batches.length, instanceSlots),
    ...attributes,
  }
  await uploadAttributes(renderer, [attributes.vertices, attributes.vertexReferences, attributes.indices])
  await uploadAttributes(renderer, [attributes.clusters, attributes.instances, attributes.nodes, attributes.instanceInfo, attributes.instanceBounds, attributes.materialMap])
  return packed
}
