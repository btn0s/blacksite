import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { buildGltfMeshes } from '../../../packages/geometry/scripts/build.mjs'
import { tsImport } from 'tsx/esm/api'

const source = resolve(process.argv[2] ?? 'D:/Archive/dark-ruins-export')
const output = resolve(process.argv[3] ?? 'D:/dev/owned-assets/dark-ruins/level')
const minimumWorldError = Number(process.argv[4] ?? 0.03)
const json = async file => JSON.parse(await readFile(join(source, file), 'utf8'))
const instances = (await json('placements.json')).instances
const meshes = (await json('meshes.json')).meshes
const { parseMeshletAsset } = await tsImport('../../../packages/geometry/src/load.ts', import.meta.url)
const groups = new Map()
const scaleOf = matrix => {
  const column = [0, 4, 8].map(offset => matrix.slice(offset, offset + 3))
  return Math.sqrt(Math.max(...column.map(a => column.reduce((sum, b) => sum + Math.abs(a.reduce((dot, value, i) => dot + value * b[i], 0)), 0))))
}
for (const instance of instances) {
  const id = `${instance.geometry.file}:${instance.geometry.mesh_index}`
  if (!groups.has(id)) groups.set(id, { file: instance.geometry.file, meshIndex: instance.geometry.mesh_index, maxScale: 0, placements: [] })
  const group = groups.get(id)
  group.maxScale = Math.max(group.maxScale, scaleOf(instance.transform.matrix))
  group.placements.push(instance)
}
await mkdir(output, { recursive: true })
const geometries = []
let bytes = 0, sourceTriangles = 0, residentTriangles = 0, clusterCount = 0, vertexBytes = 0, indexBytes = 0, hierarchyBytes = 0
for (const [id, group] of groups) {
  const name = createHash('sha256').update(id).digest('hex').slice(0, 16)
  const directory = join(output, name)
  const minimumError = minimumWorldError / group.maxScale
  let manifest
  try {
    manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
    const file = manifest.geometries.find(item => item.meshIndex === group.meshIndex)
    const data = await readFile(join(directory, file.url))
    const asset = parseMeshletAsset(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
    if (Math.abs(asset.metadata.minimumError - minimumError) > 1e-9) manifest = null
  } catch { manifest = null }
  if (!manifest) manifest = await buildGltfMeshes(join(source, group.file), directory, { minimumError })
  const record = manifest.geometries.find(item => item.meshIndex === group.meshIndex)
  if (!record) throw new Error(`Missing component-local mesh: ${id}`)
  const data = await readFile(join(directory, record.url))
  const asset = parseMeshletAsset(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
  const remap = new Map(), positions = [], indices = []
  const collisionError = Math.max(0.1, minimumWorldError) / group.maxScale
  for (let cluster = 0; cluster < asset.metadata.clusterCount; cluster++) {
    if (asset.clusterLod[cluster * 12 + 8] > collisionError || asset.clusterLod[cluster * 12 + 9] <= collisionError) continue
    const offset = asset.clusterData[cluster * 8], count = asset.clusterData[cluster * 8 + 1]
    for (let i = offset; i < offset + count; i++) {
      const vertex = asset.indices[i]
      if (!remap.has(vertex)) { remap.set(vertex, positions.length / 3); positions.push(...asset.positions.subarray(vertex * 3, vertex * 3 + 3)) }
      indices.push(remap.get(vertex))
    }
  }
  const collision = Buffer.alloc(8 + positions.length * 4 + indices.length * 4)
  collision.writeUInt32LE(positions.length, 0)
  collision.writeUInt32LE(indices.length, 4)
  Buffer.from(Float32Array.from(positions).buffer).copy(collision, 8)
  Buffer.from(Uint32Array.from(indices).buffer).copy(collision, 8 + positions.length * 4)
  await writeFile(join(directory, 'collision.bin'), collision)
  geometries.push({ id, url: `${name}/${record.url}`, collision: `${name}/collision.bin`, mesh: group.placements[0].mesh, primitiveSlots: meshes[group.placements[0].mesh].primitive_material_slots, maxScale: group.maxScale, ...asset.metadata })
  vertexBytes += asset.positions.length / 3 * 32
  indexBytes += asset.indices.byteLength
  hierarchyBytes += asset.metadata.clusterCount * 80 + asset.metadata.nodeCount * 48
  bytes += data.byteLength
  sourceTriangles += asset.metadata.sourceTriangles
  residentTriangles += asset.metadata.residentTriangles
  clusterCount += asset.metadata.clusterCount
  console.log(JSON.stringify({ built: geometries.length, total: groups.size, bytes, vertexBytes, indexBytes, hierarchyBytes, sourceTriangles, residentTriangles, clusterCount, minimumWorldError }))
  await writeFile(join(output, 'build-progress.json'), JSON.stringify({ built: geometries.length, total: groups.size, bytes, vertexBytes, indexBytes, hierarchyBytes, sourceTriangles, residentTriangles, clusterCount, minimumWorldError }))
}
await writeFile(join(output, 'level.json'), JSON.stringify({ version: 1, minimumWorldError, bytes, vertexBytes, indexBytes, hierarchyBytes, sourceTriangles, residentTriangles, clusterCount, geometries, instances: instances.map(instance => ({ geometry: `${instance.geometry.file}:${instance.geometry.mesh_index}`, matrix: instance.transform.matrix, materials: instance.materials })) }))
await writeFile(join(output, 'environment.json'), JSON.stringify(await json('environment.json')))
