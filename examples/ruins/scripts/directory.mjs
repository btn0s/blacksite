import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Matrix4, Vector3 } from 'three'

export function conservativeScale(matrix) {
  const transform = new Matrix4().fromArray(matrix)
  if (!matrix.every(Number.isFinite) || Math.abs(transform.determinant()) < 1e-12 || matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1) throw new Error('Placement must be finite, affine and invertible')
  const columns = [0, 4, 8].map(offset => matrix.slice(offset, offset + 3))
  return Math.sqrt(Math.max(...columns.map(a => columns.reduce((sum, b) => sum + Math.abs(a.reduce((dot, value, i) => dot + value * b[i], 0)), 0))))
}

function outward(value, upper) {
  const array = new Float32Array([value]), bits = new Uint32Array(array.buffer)
  if ((upper && array[0] < value) || (!upper && array[0] > value)) bits[0] += (value >= 0) === upper ? 1 : -1
  return array[0]
}

export async function buildLevelDirectory(output, geometries, instances, meshes, materialPaths) {
  const byId = new Map(geometries.map((geometry, index) => [geometry.id, { geometry, index }]))
  const materialIndices = new Map(materialPaths.map((path, index) => [path, index]))
  const placements = Buffer.alloc(instances.length * 176), materialMap = [], bounds = []
  const placed = { triangles: 0, clusters: 0, groups: 0 }, visible = { triangles: 0, clusters: 0, groups: 0 }
  for (const [index, instance] of instances.entries()) {
    const { geometry, index: geometryIndex } = byId.get(`${instance.geometry.file}:${instance.geometry.mesh_index}`)
    const m = geometry.metadata, matrix = new Matrix4().fromArray(instance.transform.matrix), inverse = matrix.clone().invert().transpose()
    const scale = conservativeScale(instance.transform.matrix), offset = index * 176
    const active = instance.visible && !instance.hidden_in_game && !instance.actor_hidden_in_game && !instance.actor_editor_only && !instance.component_editor_only
    for (let i = 0; i < 16; i++) { placements.writeFloatLE(matrix.elements[i], offset + i * 4); placements.writeFloatLE(inverse.elements[i], offset + 64 + i * 4) }
    placements.writeFloatLE(scale, offset + 128)
    placements.writeFloatLE(Math.sign(matrix.determinant()), offset + 132)
    placements.writeUInt32LE(materialMap.length, offset + 136)
    placements.writeUInt32LE(m.materials.length, offset + 140)
    placements.writeUInt32LE(geometryIndex, offset + 144)
    placements.writeUInt32LE(m.rootCount, offset + 148)
    placements.writeUInt32LE(Number(active), offset + 152)
    const slots = meshes[instance.mesh].primitive_material_slots
    const mapping = new Array(m.materials.length).fill(0xffffffff)
    for (const [primitive, slot] of slots.entries()) {
      const material = m.primitives[primitive].materialIndex, target = materialIndices.get(instance.materials[slot])
      if (mapping[material] !== 0xffffffff && mapping[material] !== target) throw new Error('Shared source material has conflicting primitive overrides')
      mapping[material] = target
    }
    if (mapping.some(value => value === undefined)) throw new Error('Placement has a missing material mapping')
    materialMap.push(...mapping)
    const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity]
    const center = new Vector3(...m.bounds.min).add(new Vector3(...m.bounds.max)).multiplyScalar(0.5).applyMatrix4(matrix)
    const radius = new Vector3(...m.bounds.min).distanceTo(new Vector3(...m.bounds.max)) * 0.5 * scale
    for (let i = 0; i < 3; i++) placements.writeFloatLE(center.getComponent(i), offset + 160 + i * 4)
    placements.writeFloatLE(outward(radius, true), offset + 172)
    for (let corner = 0; corner < 8; corner++) {
      const point = new Vector3(...[0, 1, 2].map(axis => (corner & (1 << axis) ? m.bounds.max : m.bounds.min)[axis])).applyMatrix4(matrix)
      for (let axis = 0; axis < 3; axis++) { low[axis] = Math.min(low[axis], point.getComponent(axis)); high[axis] = Math.max(high[axis], point.getComponent(axis)) }
    }
    bounds.push({ low, high, index, materials: active ? [...new Set(mapping.filter(value => value !== 0xffffffff))] : [] })
    for (const target of [placed, ...(active ? [visible] : [])]) { target.triangles += m.coarseTriangles; target.clusters += m.coarseClusters; target.groups += m.rootGroupCount }
  }
  const nodes = [], bitWords = Math.ceil(materialPaths.length / 32)
  const build = entries => {
    const index = nodes.length, low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity], bits = new Uint32Array(bitWords)
    for (const entry of entries) {
      for (let axis = 0; axis < 3; axis++) { low[axis] = Math.min(low[axis], entry.low[axis]); high[axis] = Math.max(high[axis], entry.high[axis]) }
      for (const material of entry.materials) bits[material >>> 5] |= 1 << (material & 31)
    }
    const node = { low, high, bits, left: entries[0].index, right: 0xffffffff }
    nodes.push(node)
    if (entries.length > 1) {
      const axis = [0, 1, 2].sort((a, b) => (high[b] - low[b]) - (high[a] - low[a]))[0]
      entries.sort((a, b) => (a.low[axis] + a.high[axis]) - (b.low[axis] + b.high[axis]) || a.index - b.index)
      const middle = Math.floor(entries.length / 2)
      node.left = build(entries.slice(0, middle)); node.right = build(entries.slice(middle))
    }
    return index
  }
  build(bounds)
  const spatial = Buffer.alloc(nodes.length * 32), bitsets = Buffer.alloc(nodes.length * bitWords * 4)
  for (const [index, node] of nodes.entries()) {
    for (let axis = 0; axis < 3; axis++) { spatial.writeFloatLE(outward(node.low[axis], false), index * 32 + axis * 4); spatial.writeFloatLE(outward(node.high[axis], true), index * 32 + 16 + axis * 4) }
    spatial.writeUInt32LE(node.left, index * 32 + 12); spatial.writeUInt32LE(node.right, index * 32 + 28)
    Buffer.from(node.bits.buffer).copy(bitsets, index * bitWords * 4)
  }
  const maps = Buffer.from(Uint32Array.from(materialMap).buffer)
  const arrays = [placements, maps, spatial, bitsets]
  const header = Buffer.alloc(96)
  ;[0x4c475342, 4, 4, instances.length, geometries.length, materialPaths.length, nodes.length, bitWords].forEach((word, i) => header.writeUInt32LE(word, i * 4))
  let cursor = header.length
  for (const [id, array] of arrays.entries()) {
    ;[id, cursor, array.length, 0].forEach((word, i) => header.writeUInt32LE(word, 32 + id * 16 + i * 4))
    cursor += array.length
  }
  const binary = Buffer.concat([header, ...arrays])
  await writeFile(join(output, 'level.directory'), binary)
  const readback = await readFile(join(output, 'level.directory'))
  if (!readback.equals(binary)) throw new Error('Level directory readback mismatch')
  const limits = { triangles: 16000000, selected: 1048576, frontier: 1048576, reachedGroups: 524288, arenaPages: 10240, controlBytes: 256 * 1048576, fixedScratchBytes: 88 * 1048576 }
  const coarse = { allPlacements: placed, visiblePlacements: visible, spatialNodeVisits: nodes.length, selectedSlots: placed.clusters, frontierSlots: instances.length + placed.groups, reachedGroupInstances: placed.groups, nodeGroupClusterWorkPerPass: nodes.length + placed.groups + placed.clusters, fourPassWork: 4 * (nodes.length + placed.groups + placed.clusters), limits }
  coarse.capacityFits = placed.triangles <= limits.triangles && coarse.selectedSlots <= limits.selected && coarse.frontierSlots <= limits.frontier && coarse.reachedGroupInstances <= limits.reachedGroups
  if (!coarse.capacityFits) throw new Error(`Coarsest full-level cut exceeds fixed capacities: ${JSON.stringify(coarse)}`)
  return { bytes: { header: header.length, placements: placements.length, materialMaps: maps.length, spatialNodes: spatial.length, materialBitsets: bitsets.length, gpu: cursor - header.length, wire: cursor }, coarse }
}
