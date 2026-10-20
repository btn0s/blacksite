import { BackSide, DoubleSide, FrontSide, Matrix4, StorageBufferAttribute, Vector3 } from 'three/webgpu'
import type { MeshStandardMaterial, MeshStandardNodeMaterial, Side, WebGPURenderer } from 'three/webgpu'
import { Fn, storage } from 'three/tsl'
import type { GeometryPageSource } from './load-pages'
import { geometryUsesCoverage } from './runtime-material'
import { MaterialCoverage } from './runtime-submission'
import { GEOMETRY_ARENA_BYTES, GEOMETRY_STAGING_BYTES } from './page-residency'
import type { ResidencyLedger } from './residency'
import type { PageSourceRange } from './page-residency'
import { GeometryPageArena } from './runtime-pages'

export interface MeshletSceneEntry {
  asset: GeometryPageSource
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
  arena: GeometryPageArena
  groups: StorageBufferAttribute
  instances: StorageBufferAttribute
  nodes: StorageBufferAttribute
  instanceInfo: StorageBufferAttribute
  instanceBounds: StorageBufferAttribute
  materialMap: StorageBufferAttribute
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

export async function uploadAttributes(renderer: WebGPURenderer, attributes: readonly StorageBufferAttribute[]) {
  const buffers = attributes.map(attribute => storage(attribute, 'uint', attribute.array.length))
  const upload = Fn(() => { for (const buffer of buffers) buffer.element(0).assign(buffer.element(0)) })().compute(1).setName('Geometry directory allocation')
  try {
    await renderer.compileComputeAsync(upload)
    const sources = new Set(attributes.map(attribute => attribute.array.buffer))
    for (const attribute of attributes) attribute.array = attribute.array instanceof Float32Array ? new Float32Array(0) : new Uint32Array(0)
    for (const source of sources) {
      if (!(source instanceof ArrayBuffer)) throw new Error('Geometry upload requires transferable buffers')
      source.transfer(0)
    }
  } finally { upload.dispose() }
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

export async function packScene(renderer: WebGPURenderer, entries: readonly MeshletSceneEntry[], arenaBytes = GEOMETRY_ARENA_BYTES, cpuStaging?: ResidencyLedger): Promise<PackedMeshletScene> {
  const sources = new Map<GeometryPageSource, MeshletSceneEntry[]>()
  let clusterCount = 0, instanceCount = 0, nodeCount = 0, groupCount = 0, pageCount = 0, totalTriangles = 0
  for (const entry of entries) {
    if (!entry.instances.length || entry.materials.length !== entry.asset.metadata.materials.length) throw new Error('Geometry placements and material slots disagree with the page directory')
    if (!sources.has(entry.asset)) {
      sources.set(entry.asset, [])
      clusterCount += entry.asset.metadata.clusterCount
      nodeCount += entry.asset.metadata.nodeCount
      groupCount += entry.asset.metadata.groupCount
      pageCount += entry.asset.metadata.pageCount
    }
    sources.get(entry.asset)!.push(entry)
    instanceCount += entry.instances.length
    totalTriangles += entry.asset.metadata.sourceTriangles * entry.instances.length
  }
  const groups = new Uint32Array(groupCount * 8)
  const nodes = new Uint32Array(nodeCount * 12), nodeFloats = new Float32Array(nodes.buffer)
  const instances = new Float32Array(instanceCount * 36)
  const instanceInfo = new Uint32Array(instanceCount * 4), instanceBounds = new Float32Array(instanceCount * 4)
  const materialMap: number[] = [], slots: number[] = [], coarseWidths: number[] = [], widths: number[] = []
  const batches: PackedMeshletScene['batches'] = [], materialIndices = new Map<MeshletSceneEntry['materials'][number], number>()
  const ranges: PageSourceRange[] = []
  const coarsest = { slots: 0, frontier: 0, groups: 0, work: instanceCount }
  let nodeBase = 0, groupBase = 0, pageBase = 0, instanceIndex = 0, rootTriangles = 0, maximumError = 0
  const inverse = new Matrix4(), center = new Vector3()
  for (const [asset, placements] of sources) {
    const m = asset.metadata
    ranges.push({ source: asset, pageBase, groupBase })
    groups.set(asset.groups, groupBase * 8)
    let sourceError = 0
    const bounds = new Float32Array(asset.groups.buffer, asset.groups.byteOffset, asset.groups.length)
    for (let group = 0; group < m.groupCount; group++) {
      groups[(groupBase + group) * 8 + 5] = pageBase + asset.groups[group * 8 + 5]!
      if (bounds[group * 8 + 4]! < 1e30) sourceError = Math.max(sourceError, bounds[group * 8 + 4]!)
    }
    for (let node = 0; node < m.nodeCount; node++) {
      const offset = (nodeBase + node) * 12, group = asset.nodeData[node * 4]!
      nodeFloats.set(asset.nodeBounds.subarray(node * 8, node * 8 + 8), offset)
      nodes.set(group === 0xffffffff
        ? [group, nodeBase + asset.nodeData[node * 4 + 1]!, asset.nodeData[node * 4 + 2]!, 0]
        : [groupBase + group, asset.groups[group * 8 + 7]!, 0, 0], offset + 8)
    }
    const count = placements.reduce((sum, entry) => sum + entry.instances.length, 0)
    coarsest.slots += m.coarseClusters * count
    coarsest.groups += m.rootGroupCount * count
    rootTriangles += m.coarseTriangles * count
    let frontier = Array.from({ length: m.rootCount }, (_, i) => i)
    for (let depth = 0; frontier.length; depth++) {
      widths[depth] = (widths[depth] ?? 0) + frontier.length * count
      const next: number[] = []
      for (const node of frontier) if (asset.nodeData[node * 4] === 0xffffffff) {
        const first = asset.nodeData[node * 4 + 1]!, size = asset.nodeData[node * 4 + 2]!
        for (let i = 0; i < size; i++) next.push(first + i)
      }
      frontier = next
    }
    frontier = Array.from({ length: m.rootCount }, (_, i) => i)
    for (let depth = 0; frontier.length; depth++) {
      coarseWidths[depth] = (coarseWidths[depth] ?? 0) + frontier.length * count
      coarsest.work += frontier.length * count
      const next: number[] = []
      for (const node of frontier) if (asset.nodeBounds[node * 8 + 4]! > sourceError && asset.nodeData[node * 4] === 0xffffffff) {
        const first = asset.nodeData[node * 4 + 1]!, size = asset.nodeData[node * 4 + 2]!
        for (let i = 0; i < size; i++) next.push(first + i)
      }
      frontier = next
    }
    coarsest.work += m.coarseClusters * count
    const low = new Vector3(...m.bounds.min), high = new Vector3(...m.bounds.max)
    const localCenter = low.clone().add(high).multiplyScalar(0.5), radius = low.distanceTo(high) * 0.5
    for (const entry of placements) {
      const materialOffset = materialMap.length
      for (const material of entry.materials) {
        if (!material.visible) { materialMap.push(0xffffffff); continue }
        if (!materialIndices.has(material)) { materialIndices.set(material, batches.length); batches.push({ material, capacity: 0 }) }
        const index = materialIndices.get(material)!
        batches[index]!.capacity += m.clusterCount * entry.instances.length
        materialMap.push(index)
      }
      for (const matrix of entry.instances) {
        const scale = transformScale(matrix)
        maximumError = Math.max(maximumError, sourceError * scale)
        slots.push(entry.materials.length)
        instances.set(matrix.elements, instanceIndex * 36)
        inverse.copy(matrix).invert().transpose()
        instances.set(inverse.elements, instanceIndex * 36 + 16)
        instances.set([scale, Math.sign(matrix.determinant()), materialOffset, 0], instanceIndex * 36 + 32)
        instanceInfo.set([nodeBase, m.rootCount, groupBase, 0], instanceIndex * 4)
        center.copy(localCenter).applyMatrix4(matrix)
        instanceBounds.set([center.x, center.y, center.z, radius * scale], instanceIndex * 4)
        instanceIndex++
      }
    }
    nodeBase += m.nodeCount; groupBase += m.groupCount; pageBase += m.pageCount
  }
  batches.sort((a, b) => depthState(a.material) - depthState(b.material))
  const remap = new Uint32Array(batches.length)
  batches.forEach((batch, i) => { remap[materialIndices.get(batch.material)!] = i })
  for (let i = 0; i < materialMap.length; i++) if (materialMap[i] !== 0xffffffff) materialMap[i] = remap[materialMap[i]!]!
  const depthBatches: PackedMeshletScene['depthBatches'] = []
  let drawCount = batches.length
  for (let first = 0; first < batches.length;) {
    const material = batches[first]!.material, coverage = geometryUsesCoverage(material)
    let end = first + 1
    if (!coverage) while (end < batches.length && depthState(batches[end]!.material) === depthState(material)) end++
    depthBatches.push({ material: coverage ? material : null, argument: coverage ? first : drawCount++, firstMaterial: first, materialCount: end - first, side: material.side, shadowSide: shadowSide(material) })
    first = end
  }
  coarsest.frontier = Math.max(...coarseWidths)
  if (!batches.length) throw new Error('Geometry requires at least one visible material')
  const coverage = new MaterialCoverage(instanceBounds, instances, materialMap, batches.length, slots)
  coarsest.work += coverage.spatial.count / 2
  if (coarsest.slots > SELECTED_CAPACITY || coarsest.frontier > FRONTIER_CAPACITY || coarsest.groups > GROUP_CAPACITY || coarsest.work > SELECTION_WORK_BUDGET) throw new Error('Geometry pinned cut exceeds fixed traversal capacity')
  const attributes = {
    groups: new StorageBufferAttribute(groups, 4), nodes: new StorageBufferAttribute(nodes, 4),
    instances: new StorageBufferAttribute(instances, 4), instanceInfo: new StorageBufferAttribute(instanceInfo, 4),
    instanceBounds: new StorageBufferAttribute(instanceBounds, 4), materialMap: new StorageBufferAttribute(new Uint32Array(materialMap), 1),
  }
  const arena = new GeometryPageArena(ranges, arenaBytes, cpuStaging)
  const spatial = [coverage.spatial, coverage.spatialRoots, coverage.placements]
  const residentBytes = arenaBytes + 3 * GEOMETRY_STAGING_BYTES + arena.table.count * 16 + arena.activity.count * 4 + 16 + [...Object.values(attributes), ...spatial].reduce((sum, attribute) => sum + attribute.array.byteLength, 0)
  const packed: PackedMeshletScene = {
    ...attributes, arena, batches, depthBatches, drawCount, clusterCount, instanceCount,
    candidateCount: batches.reduce((sum, batch) => sum + batch.capacity, 0), totalTriangles,
    residentGeometryBytes: arenaBytes, residentBytes, hierarchyDepth: widths.length, coarsest, rootTriangles, maximumError,
    coverage,
  }
  await uploadAttributes(renderer, [...Object.values(attributes), ...spatial])
  return packed
}
