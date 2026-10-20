import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { Matrix4, Vector3 } from 'three'
import { MeshoptSimplifier } from 'meshoptimizer'
import { readPageDirectory } from '../../../packages/geometry/scripts/pages.mjs'
import { decodeGeometryPage, pageCodecReady } from '../../../packages/geometry/src/page-codec.mjs'
import { conservativeScale } from './directory.mjs'

const pageBuild = resolve(process.argv[2])
const output = resolve(process.argv[3])
const surfaces = JSON.parse(await readFile(resolve(process.argv[4]), 'utf8'))
const excluded = new Set(surfaces.excluded.map(surface => surface.path))
const worldError = 0.75, cellSize = 32, chunkSize = 8, triangleLimit = 4096
await mkdir(output)
await mkdir(join(output, 'regions'))
await pageCodecReady
await MeshoptSimplifier.ready
const level = JSON.parse(await readFile(join(pageBuild, 'level.json'), 'utf8'))
const directory = await readFile(join(pageBuild, level.directory))
if (directory.readUInt32LE(0) !== 0x4c475342 || directory.readUInt32LE(4) !== 5 || directory.readUInt32LE(12) !== 20430) throw new Error('Collision requires the complete version 5 placement directory')
const placementStart = directory.readUInt32LE(36)
const materialStart = directory.readUInt32LE(52)
const byGeometry = Array.from({ length: level.geometries.length }, () => [])
for (let i = 0; i < 20430; i++) {
  const offset = placementStart + i * 176
  if (!directory.readUInt32LE(offset + 152)) continue
  const matrix = Array.from({ length: 16 }, (_, j) => directory.readFloatLE(offset + j * 4))
  const first = directory.readUInt32LE(offset + 136), count = directory.readUInt32LE(offset + 140)
  const slots = Array.from({ length: count }, (_, slot) => !excluded.has(level.materialPaths[directory.readUInt32LE(materialStart + (first + slot) * 4)]))
  if (slots.some(Boolean)) byGeometry[directory.readUInt32LE(offset + 144)].push({ matrix, slots })
}
const chunks = [], cells = new Map(), point = new Vector3()
let triangleCount = 0, processedPlacements = 0, decodedPages = 0
async function flush(cell) {
  if (!cell.values.length) return
  const positions = [], indices = [], welded = new Map()
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity]
  const values = new Float32Array(cell.values)
  for (let i = 0; i < values.length; i += 3) {
    const vertex = `${values[i]},${values[i + 1]},${values[i + 2]}`
    let id = welded.get(vertex)
    if (id === undefined) {
      id = positions.length / 3; welded.set(vertex, id)
      for (let axis = 0; axis < 3; axis++) { const value = values[i + axis]; positions.push(value); low[axis] = Math.min(low[axis], value); high[axis] = Math.max(high[axis], value) }
    }
    indices.push(id)
  }
  const sourceVertices = new Float32Array(positions)
  const [simplified, error] = MeshoptSimplifier.simplify(new Uint32Array(indices), sourceVertices, 3, 3, worldError / 2, ['LockBorder', 'ErrorAbsolute'])
  if (error > worldError / 2 + 0.000001) throw new Error('Collision simplification exceeded the world error budget')
  const remap = new Map(), compact = []
  const triangles = simplified.map(index => {
    if (!remap.has(index)) { remap.set(index, compact.length / 3); compact.push(...sourceVertices.subarray(index * 3, index * 3 + 3)) }
    return remap.get(index)
  })
  const vertices = new Float32Array(compact)
  const header = new Uint32Array([0x52435342, 1, vertices.length, triangles.length, 0, 0, 0, 0])
  const bytes = Buffer.concat([Buffer.from(header.buffer), Buffer.from(vertices.buffer), Buffer.from(triangles.buffer)])
  const file = `regions/${cell.x}_${cell.y}_${cell.z}_${cell.part++}.bin`
  await writeFile(join(output, file), bytes)
  chunks.push({ file, cell: [Math.floor(cell.x * chunkSize / cellSize), Math.floor(cell.z * chunkSize / cellSize)], bounds: { min: low, max: high }, triangles: triangles.length / 3, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  cell.values.length = 0
}
async function triangle(vertices) {
  const x = Math.floor((vertices[0] + vertices[3] + vertices[6]) / (3 * chunkSize)), y = Math.floor((vertices[1] + vertices[4] + vertices[7]) / (3 * chunkSize)), z = Math.floor((vertices[2] + vertices[5] + vertices[8]) / (3 * chunkSize))
  const id = `${x},${y},${z}`
  if (!cells.has(id)) cells.set(id, { x, y, z, part: 0, values: [] })
  const cell = cells.get(id)
  cell.values.push(...vertices)
  triangleCount++
  if (cell.values.length === triangleLimit * 9) await flush(cell)
}
for (const [geometryIndex, geometry] of level.geometries.entries()) {
  const placements = byGeometry[geometryIndex]
  if (!placements.length) continue
  const { metadata: m, arrays: a } = await readPageDirectory(join(pageBuild, geometry.url))
  const minimum = worldError / (2 * geometry.maxScale)
  const pageIds = new Set()
  for (let node = 0; node < m.nodeCount; node++) if (a.nodeData[node * 4] !== 0xffffffff && a.nodeBounds[node * 8 + 4] > minimum) pageIds.add(a.groups[a.nodeData[node * 4] * 8 + 5])
  const source = await open(join(pageBuild, dirname(geometry.url), m.pagePack), 'r')
  const clusters = []
  try {
    for (const id of pageIds) {
      const range = m.pages[id], wire = Buffer.alloc(range.bytes)
      const result = await source.read(wire, 0, wire.length, range.offset)
      if (result.bytesRead !== wire.length || createHash('sha256').update(wire).digest('hex') !== range.sha256) throw new Error('Collision source page is corrupt')
      const page = decodeGeometryPage(wire), words = new Uint32Array(page.buffer), floats = new Float32Array(page.buffer)
      decodedPages++
      const first = words[13] / 4
      for (let i = 0; i < words[9]; i++) {
        const c = first + i * 40
        if (floats[c + 13] <= minimum) continue
        const start = words[c + 19], end = i + 1 < words[9] ? words[c + 59] : words[11] / 4 + words[7]
        const positions = new Float32Array((end - start) * 3)
        for (let vertex = 0; vertex < end - start; vertex++) {
          const offset = words[c + 32] + words[start + vertex] * words[c + 33]
          const quantized = [words[offset] & 65535, words[offset] >>> 16, words[offset + 1] & 65535]
          for (let axis = 0; axis < 3; axis++) positions[vertex * 3 + axis] = quantized[axis] * floats[c + 24 + axis] + floats[c + 20 + axis]
        }
        clusters.push({ self: floats[c + 12], parent: floats[c + 13], material: words[c + 14], positions, indices: page.slice(words[c + 16], words[c + 16] + words[c + 17]) })
      }
    }
  } finally { await source.close() }
  for (const { matrix: transform, slots } of placements) {
    const matrix = new Matrix4().fromArray(transform), threshold = worldError / (2 * conservativeScale(transform)), reverse = matrix.determinant() < 0
    for (const cluster of clusters) {
      if (!slots[cluster.material] || cluster.self > threshold || cluster.parent <= threshold) continue
      const positions = cluster.positions.slice()
      for (let i = 0; i < positions.length; i += 3) point.fromArray(positions, i).applyMatrix4(matrix).toArray(positions, i)
      for (let corner = 0; corner < cluster.indices.length; corner += 3) {
        const vertices = []
        for (const local of [0, reverse ? 2 : 1, reverse ? 1 : 2]) { const id = cluster.indices[corner + local] * 3; vertices.push(positions[id], positions[id + 1], positions[id + 2]) }
        await triangle(vertices)
      }
    }
    processedPlacements++
  }
  console.log(JSON.stringify({ geometry: geometryIndex + 1, geometries: level.geometries.length, processedPlacements, triangleCount, decodedPages, chunks: chunks.length }))
}
for (const cell of cells.values()) await flush(cell)
const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity]
const index = new Map()
for (const [id, chunk] of chunks.entries()) {
  for (let axis = 0; axis < 3; axis++) { low[axis] = Math.min(low[axis], chunk.bounds.min[axis]); high[axis] = Math.max(high[axis], chunk.bounds.max[axis]) }
  for (let x = Math.floor(chunk.bounds.min[0] / cellSize); x <= Math.floor(chunk.bounds.max[0] / cellSize); x++) {
    for (let z = Math.floor(chunk.bounds.min[2] / cellSize); z <= Math.floor(chunk.bounds.max[2] / cellSize); z++) {
      const idCell = `${x},${z}`
      if (!index.has(idCell)) index.set(idCell, [])
      index.get(idCell).push(id)
    }
  }
}
const manifest = { version: 1, cellSize, chunkSize, worldError, triangleLimit, placements: processedPlacements, inputTriangles: triangleCount, triangles: chunks.reduce((sum, chunk) => sum + chunk.triangles, 0), bytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0), bounds: { min: low, max: high }, chunks, cells: Object.fromEntries(index) }
await writeFile(join(output, 'collision.json'), JSON.stringify(manifest))
console.log(JSON.stringify({ complete: true, output, placements: processedPlacements, inputTriangles: triangleCount, triangles: manifest.triangles, bytes: manifest.bytes, chunks: chunks.length, cells: index.size }))
