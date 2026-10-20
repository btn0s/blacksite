import { MeshoptDecoder } from 'meshoptimizer/decoder'

export const pageCodecReady = MeshoptDecoder.ready
const align = value => Math.ceil(value / 16) * 16
const check = (value, message) => { if (!value) throw new Error(message) }

export function decodeGeometryPage(source) {
  const wire = source instanceof Uint8Array ? source : new Uint8Array(source)
  check(wire.byteLength >= 96 && wire.byteLength <= 262144, 'Invalid encoded page size')
  const view = new DataView(wire.buffer, wire.byteOffset, wire.byteLength)
  const h = Array.from({ length: 24 }, (_, i) => view.getUint32(i * 4, true))
  check(h[0] === 0x574d5342 && h[1] === 5 && h[3] === wire.length && h[4] >= 64 && h[4] <= 131072, 'Invalid encoded page header')
  check(h[6] >= 16 && h[6] <= 28 && h[6] % 4 === 0 && h[5] * h[6] <= h[4] && h[7] * 4 <= h[4] && h[8] <= h[4] && h[9] * 160 <= h[4] && h[13] <= h[8] && h[13] % 3 === 0, 'Page counts exceed physical capacity')
  check(96 + h[14] + h[15] + h[16] + h[17] === wire.length && h.slice(18).every(value => value === 0), 'Encoded page streams disagree')
  const minDepth = h[10] & 65535, maxDepth = h[10] >>> 16
  check(maxDepth - minDepth <= 1 && h[11] <= 1 && h[12] > 0 && h[12] <= h[9], 'Invalid page depth range or group count')
  const vertexOffset = 64, referenceOffset = align(vertexOffset + h[5] * h[6]), indexOffset = align(referenceOffset + h[7] * 4), clusterOffset = align(indexOffset + h[8])
  check(clusterOffset + h[9] * 160 === h[4], 'Decoded page sections disagree')
  const page = new Uint8Array(h[4]), words = new Uint32Array(page.buffer)
  words.set([0x504d5342, 5, h[2], h[4], h[10], h[11], h[5], h[7], h[8], h[9], vertexOffset, referenceOffset, indexOffset, clusterOffset, h[6], h[12]])
  let cursor = 96
  const stream = bytes => { const result = wire.subarray(cursor, cursor + bytes); cursor += bytes; return result }
  MeshoptDecoder.decodeVertexBuffer(page.subarray(vertexOffset, vertexOffset + h[5] * h[6]), h[5], h[6], stream(h[14]))
  MeshoptDecoder.decodeIndexSequence(page.subarray(referenceOffset, referenceOffset + h[7] * 4), h[7], 4, stream(h[15]))
  const triangles = new Uint16Array(h[13])
  MeshoptDecoder.decodeIndexBuffer(new Uint8Array(triangles.buffer), h[13], 2, stream(h[16]))
  MeshoptDecoder.decodeVertexBuffer(page.subarray(clusterOffset), h[9], 160, stream(h[17]))
  for (let i = referenceOffset / 4; i < referenceOffset / 4 + h[7]; i++) check(words[i] < h[5], 'Decoded reference exceeds page vertex pool')
  let triangleCursor = 0, expectedIndex = indexOffset, expectedReference = referenceOffset
  for (let i = 0; i < h[9]; i++) {
    const c = clusterOffset / 4 + i * 40, offset = words[c + 16], count = words[c + 17]
    const reference = words[c + 19] * 4, referenceEnd = i + 1 < h[9] ? words[c + 40 + 19] * 4 : referenceOffset + h[7] * 4
    const vertices = (referenceEnd - reference) / 4
    check(reference === expectedReference && vertices > 0 && vertices <= 128 && referenceEnd <= referenceOffset + h[7] * 4, 'Decoded meshlet references exceed page')
    check(count > 0 && count <= 384 && count % 3 === 0 && offset === expectedIndex && offset + count <= indexOffset + h[8] && triangleCursor + count <= triangles.length, 'Decoded cluster indices exceed page')
    check(words[c + 18] >= minDepth && words[c + 18] <= maxDepth && words[c + 32] * 4 === vertexOffset && words[c + 33] * 4 === h[6], 'Decoded cluster page addressing disagrees')
    check((words[c + 23] === 0 || words[c + 23] === 4) && words[c + 23] < h[6] / 4 && words[c + 34] < h[6] / 4 && words[c + 35] < h[6] / 4, 'Decoded vertex attribute slots exceed stride')
    for (let j = 0; j < count; j++) {
      const index = triangles[triangleCursor++]
      check(index < vertices, 'Decoded triangle index exceeds meshlet vertices')
      page[offset + j] = index
    }
    expectedIndex += Math.ceil(count / 4) * 4
    expectedReference = referenceEnd
  }
  check(triangleCursor === triangles.length && expectedIndex === indexOffset + h[8] && expectedReference === referenceOffset + h[7] * 4, 'Decoded section totals disagree')
  return page
}
