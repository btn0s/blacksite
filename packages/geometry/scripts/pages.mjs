import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const names = ['groups', 'childOffsets', 'children', 'parentOffsets', 'parents', 'nodeData', 'nodeBounds', 'pages', 'roots']
const fields = ['magic', 'version', 'clusterCount', 'groupCount', 'packedIndexWords', 'edgeCount', 'rootCount', 'residentVertices', 'residentIndices', 'meshletVertices', 'nodeCount', 'vertexWords', 'pageCount', 'rootGroupCount', 'pageVertices', 'referenceBytes', 'indexBytes', 'maxGroupClusters', 'maxGroupBytes', 'coarseClusters', 'coarseTriangles', 'coarseReferences', 'coarseVertices', 'coarsePayloadBytes', 'pinnedPages', 'pinnedWireBytes', 'packBytes', 'payloadBytes', 'uniquePayloadBytes', 'alignmentBytes', 'maxClusterVertices', 'maxClusterTriangles']
const align = value => Math.ceil(value / 16) * 16
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }

export function readNativePages(data) {
  const stats = Object.fromEntries(fields.map((name, i) => [name, Number(data.readBigUInt64LE(i * 8))]))
  requireValue(stats.magic === 0x50475342 && stats.version === 4, 'Invalid native page directory')
  let offset = fields.length * 8
  const arrays = {}
  const counts = [stats.groupCount * 8, stats.groupCount + 1, stats.edgeCount, stats.groupCount + 1, stats.edgeCount, stats.nodeCount * 4, stats.nodeCount * 8, stats.pageCount * 4, stats.rootGroupCount]
  for (let i = 0; i < names.length; i++) {
    const Type = names[i] === 'nodeBounds' ? Float32Array : Uint32Array
    arrays[names[i]] = new Type(data.buffer, data.byteOffset + offset, counts[i])
    offset += counts[i] * 4
  }
  requireValue(offset === data.byteLength, 'Native page directory length mismatch')
  return { stats, arrays }
}

export function packPageDirectory(metadata, arrays) {
  const json = Buffer.from(JSON.stringify(metadata))
  let cursor = align(32 + names.length * 16 + json.length)
  const entries = names.map((name, id) => {
    const array = arrays[name]
    const entry = { id, offset: cursor, array }
    cursor = align(cursor + array.byteLength)
    return entry
  })
  const output = Buffer.alloc(cursor)
  ;[0x44475342, 4, names.length, json.length, cursor, 0, 0, 0].forEach((word, i) => output.writeUInt32LE(word, i * 4))
  json.copy(output, 32 + names.length * 16)
  for (const { id, offset, array } of entries) {
    ;[id, offset, array.length, array instanceof Float32Array ? 0 : 1].forEach((word, i) => output.writeUInt32LE(word, 32 + id * 16 + i * 4))
    Buffer.from(array.buffer, array.byteOffset, array.byteLength).copy(output, offset)
  }
  return output
}

export async function readPageDirectory(path) {
  const bytes = await readFile(path)
  requireValue(bytes.readUInt32LE(0) === 0x44475342 && bytes.readUInt32LE(4) === 4 && bytes.readUInt32LE(8) === names.length && bytes.readUInt32LE(16) === bytes.length, `Invalid page directory: ${path}`)
  const metadata = JSON.parse(bytes.subarray(32 + names.length * 16, 32 + names.length * 16 + bytes.readUInt32LE(12)).toString())
  const arrays = {}
  let previousEnd = align(32 + names.length * 16 + bytes.readUInt32LE(12))
  for (let i = 0; i < names.length; i++) {
    const id = bytes.readUInt32LE(32 + i * 16), offset = bytes.readUInt32LE(36 + i * 16), count = bytes.readUInt32LE(40 + i * 16), type = bytes.readUInt32LE(44 + i * 16)
    requireValue(id === i && offset === previousEnd && offset + count * 4 <= bytes.length && type === Number(names[i] !== 'nodeBounds'), 'Invalid directory section')
    arrays[names[i]] = new (type ? Uint32Array : Float32Array)(bytes.buffer, bytes.byteOffset + offset, count)
    previousEnd = align(offset + count * 4)
  }
  requireValue(previousEnd === bytes.length, 'Unexpected directory trailing bytes')
  return { metadata, arrays, bytes: bytes.length, gpuBytes: Object.values(arrays).reduce((sum, array) => sum + array.byteLength, 0), sha256: digest(bytes) }
}

export async function verifyGeometryPages(path) {
  const directory = await readPageDirectory(path)
  const { metadata: m, arrays: a } = directory
  const pack = await readFile(join(dirname(path), m.pagePack))
  requireValue(pack.length === m.packBytes && a.groups.length === m.groupCount * 8 && a.pages.length === m.pageCount * 4 && a.roots.length === m.rootGroupCount, 'Page directory counts disagree')
  requireValue(a.childOffsets.length === m.groupCount + 1 && a.parentOffsets.length === m.groupCount + 1 && a.children.length === m.edgeCount && a.parents.length === m.edgeCount && a.nodeData.length === m.nodeCount * 4 && a.nodeBounds.length === m.nodeCount * 8, 'Hierarchy section counts disagree')
  const groupNodes = new Uint8Array(m.groupCount)
  for (let i = 0; i < m.nodeCount; i++) {
    const group = a.nodeData[i * 4]
    if (group !== 0xffffffff) {
      requireValue(group < m.groupCount && !groupNodes[group], 'Hierarchy group is missing or repeated')
      groupNodes[group] = 1
    } else requireValue(a.nodeData[i * 4 + 1] + a.nodeData[i * 4 + 2] <= m.nodeCount && a.nodeData[i * 4 + 2] <= 8, 'Invalid eight-wide hierarchy')
  }
  requireValue(groupNodes.every(Boolean), 'Hierarchy omits a group')
  const roots = new Set(a.roots), byPage = Array.from({ length: m.pageCount }, () => [])
  for (let group = 0; group < m.groupCount; group++) {
    requireValue(a.groups[group * 8 + 5] < m.pageCount, 'Group references a missing page')
    byPage[a.groups[group * 8 + 5]].push(group)
    const parentStart = a.parentOffsets[group], parentEnd = a.parentOffsets[group + 1]
    requireValue(parentStart <= parentEnd && parentEnd <= m.edgeCount && roots.has(group) === (parentStart === parentEnd), 'Invalid root closure')
    const start = a.childOffsets[group], end = a.childOffsets[group + 1]
    requireValue(start <= end && end <= m.edgeCount, 'Invalid child range')
    for (let i = start; i < end; i++) {
      const child = a.children[i]
      requireValue(child < m.groupCount && child < group && a.parents.subarray(a.parentOffsets[child], a.parentOffsets[child + 1]).includes(group), 'Invalid reverse dependency')
    }
  }
  let cursor = 0, payload = 0, vertices = 0, pinned = 0, pinnedWire = 0, coarseClusters = 0, coarseTriangles = 0
  for (let id = 0; id < m.pageCount; id++) {
    const p = m.pages[id], bytes = pack.subarray(p.offset, p.offset + p.bytes), h = Array.from({ length: 16 }, (_, i) => bytes.readUInt32LE(i * 4))
    requireValue(p.offset === cursor && p.offset === a.pages[id * 4] + a.pages[id * 4 + 1] * 4294967296 && p.bytes === a.pages[id * 4 + 2] && Number(p.pinned) === a.pages[id * 4 + 3], 'Page ranges disagree')
    requireValue(digest(bytes) === p.sha256 && h[0] === 0x504d5342 && h[1] === 4 && h[2] === id && h[3] === bytes.length && h[3] <= m.pageCapacity && h[5] === Number(p.pinned) && h[14] === m.vertexStride && h[15] === byPage[id].length, 'Page header/hash mismatch')
    requireValue(h[10] === 64 && h[11] === align(64 + h[6] * h[14]) && h[12] === align(h[11] + h[7] * 4) && h[13] === align(h[12] + h[8]) && h[3] === h[13] + h[9] * 160, 'Page sections disagree')
    let clusterCursor = 0
    for (const group of byPage[id]) {
      requireValue(a.groups[group * 8 + 6] === clusterCursor && roots.has(group) === p.pinned, 'Group split, reorder or pin mismatch')
      const count = a.groups[group * 8 + 7]
      requireValue(count <= 21, 'Group exceeds cluster contract')
      for (let i = 0; i < count; i++, clusterCursor++) {
        const c = h[13] + clusterCursor * 160
        const indexOffset = bytes.readUInt32LE(c + 64), indexCount = bytes.readUInt32LE(c + 68), referenceOffset = bytes.readUInt32LE(c + 76) * 4
        const referenceEnd = clusterCursor + 1 < h[9] ? bytes.readUInt32LE(c + 160 + 76) * 4 : h[11] + h[7] * 4
        const vertexCount = (referenceEnd - referenceOffset) / 4
        requireValue(bytes.readUInt32LE(c + 72) === h[4] && bytes.readUInt32LE(c + 128) * 4 === h[10] && bytes.readUInt32LE(c + 132) * 4 === h[14], 'Cluster has wrong page/depth addressing')
        requireValue(indexCount > 0 && indexCount % 3 === 0 && indexCount <= 384 && vertexCount > 0 && vertexCount <= 128 && indexOffset >= h[12] && indexOffset + indexCount <= h[12] + h[8] && referenceOffset >= h[11] && referenceEnd <= h[11] + h[7] * 4, 'Cluster range exceeds page')
        const refined = bytes.readUInt32LE(c + 60)
        requireValue(refined === 0xffffffff || a.children.subarray(a.childOffsets[group], a.childOffsets[group + 1]).includes(refined), 'Cluster refinement is absent from directory')
        for (let j = 0; j < indexCount; j++) requireValue(bytes[indexOffset + j] < vertexCount, 'Packed index exceeds meshlet vertices')
        for (let j = referenceOffset; j < referenceEnd; j += 4) requireValue(bytes.readUInt32LE(j) < h[6], 'Reference exceeds page-local vertex pool')
        if (p.pinned) { coarseClusters++; coarseTriangles += indexCount / 3 }
      }
    }
    requireValue(clusterCursor === h[9], 'Page has unowned clusters')
    cursor += bytes.length
    payload += h[6] * h[14] + h[7] * 4 + h[8] + h[9] * 160
    vertices += h[6]
    if (p.pinned) { pinned++; pinnedWire += bytes.length }
  }
  requireValue(cursor === pack.length && payload === m.payloadBytes && vertices === m.pageVertices && pinned === m.pinnedPages && pinnedWire === m.pinnedWireBytes && coarseClusters === m.coarseClusters && coarseTriangles === m.coarseTriangles, 'Page census disagrees with payload')
  return { ...directory, packSha256: digest(pack) }
}
