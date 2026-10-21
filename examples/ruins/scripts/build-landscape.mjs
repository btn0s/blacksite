import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import sharp from 'sharp'
import { rasterizeLevelGround } from './level-ground.mjs'
import { ground, levelGround, surfaceMasks, world } from './landscape-shape.mjs'

const [collisionDirectory, materialsDirectory, output] = process.argv.slice(2).map(path => resolve(path))
if (!collisionDirectory || !materialsDirectory || !output) throw new Error('Usage: build-landscape.mjs <collision directory> <materials directory> <output directory>')
await mkdir(join(output, 'layers'), { recursive: true })

const raster = await rasterizeLevelGround(collisionDirectory)
const level = levelGround(raster)
const height = (x, z, detail) => level.height(x, z, detail)

function bake(name, size, extent, centre, detail) {
  const spacing = extent / (size - 1)
  const origin = [centre[0] - extent / 2, centre[1] - extent / 2]
  const heights = new Float32Array(size * size)
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) heights[row * size + column] = height(origin[0] + column * spacing, origin[1] + row * spacing, detail)
  let min = Infinity, max = -Infinity
  for (const value of heights) { if (value < min) min = value; if (value > max) max = value }
  const packed = new Uint8Array(size * size * 2 + size * size * 4)
  const quantized = new Uint16Array(packed.buffer, 0, size * size)
  const at = (column, row) => heights[Math.min(size - 1, Math.max(0, row)) * size + Math.min(size - 1, Math.max(0, column))]
  const colours = packed.subarray(size * size * 2)
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const index = row * size + column
    const value = heights[index]
    quantized[index] = Math.round((value - min) / (max - min) * 65535)
    const dx = at(column + 1, row) - at(column - 1, row), dz = at(column, row + 1) - at(column, row - 1)
    const length = Math.hypot(dx, 2 * spacing, dz)
    const x = origin[0] + column * spacing, z = origin[1] + row * spacing
    const rimDistance = name === 'far' ? 1e6 : level.rimDistance(x, z)
    const [soil, sand] = surfaceMasks(x, z, value, Math.hypot(dx, dz) / (2 * spacing), rimDistance)
    colours[index * 4] = Math.round((-dx / length * 0.5 + 0.5) * 255)
    colours[index * 4 + 1] = Math.round((-dz / length * 0.5 + 0.5) * 255)
    colours[index * 4 + 2] = Math.round(soil * 255)
    colours[index * 4 + 3] = Math.round(sand * 255)
  }
  const file = `${name}.bin`
  return { file, size, extent, origin, min, max, packed: deflateSync(packed, { level: 9 }) }
}

const near = bake('near', world.nearSize, world.nearExtent, world.centre, true)
const far = bake('far', world.farSize, world.farExtent, world.centre, false)
for (const field of [near, far]) await writeFile(join(output, field.file), field.packed)

const edge = new Uint8Array(near.size * near.size)
const spacing = near.extent / (near.size - 1)
for (let row = 0; row < near.size; row++) for (let column = 0; column < near.size; column++) {
  const signed = Math.max(-ground.edgeRange, Math.min(ground.edgeRange, level.edge(near.origin[0] + column * spacing, near.origin[1] + row * spacing)))
  edge[row * near.size + column] = Math.round((signed / ground.edgeRange * 0.5 + 0.5) * 255)
}
await writeFile(join(output, 'edge.bin'), deflateSync(edge, { level: 9 }))

const basisDirectory = join(dirname(fileURLToPath(import.meta.resolve('three'))), '../examples/jsm/libs/basis/')
const transcoder = new Function('require', 'module', '__dirname', `${await readFile(join(basisDirectory, 'basis_transcoder.js'), 'utf8')}\nreturn BASIS`)(createRequire(pathToFileURL(basisDirectory)), {}, basisDirectory)
const basis = await new Promise(resolve => { const module = { wasmBinary: undefined, onRuntimeInitialized: () => resolve(module) }; readFile(join(basisDirectory, 'basis_transcoder.wasm')).then(bytes => { module.wasmBinary = bytes; transcoder(module) }) })
basis.initializeBasis()

async function decode(file) {
  const texture = new basis.KTX2File(new Uint8Array(await readFile(file)))
  if (!texture.isValid()) throw new Error(`Invalid texture ${file}`)
  const width = texture.getWidth(), height = texture.getHeight()
  texture.startTranscoding()
  const pixels = new Uint8Array(texture.getImageTranscodedSizeInBytes(0, 0, 0, 13))
  if (!texture.transcodeImage(pixels, 0, 0, 0, 13, 0, -1, -1)) throw new Error(`Cannot transcode ${file}`)
  texture.close(); texture.delete()
  return { width, height, pixels }
}

const surfaces = JSON.parse(await readFile(join(materialsDirectory, 'surfaces.json'), 'utf8')).surfaces
const surfaceRoot = materialsDirectory
const layerSize = 1024
const linear = value => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
function average(pixels) {
  let r = 0, g = 0, b = 0, count = 0
  for (let offset = 0; offset < pixels.length; offset += 4 * 97) { r += linear(pixels[offset]); g += linear(pixels[offset + 1]); b += linear(pixels[offset + 2]); count++ }
  return [r / count, g / count, b / count]
}
async function layer(name, material) {
  const source = surfaces.find(surface => surface.path.split('/').at(-1).startsWith(`${material}.`))
  if (!source) throw new Error(`Surface ${material} is missing`)
  const tail = map => join(surfaceRoot, source.maps[map].tails.find(entry => entry.size === layerSize).file)
  const colour = await decode(tail('Albedo'))
  await sharp(Buffer.from(colour.pixels), { raw: { width: colour.width, height: colour.height, channels: 4 } }).removeAlpha().webp({ quality: 92 }).toFile(join(output, 'layers', `${name}_c.webp`))
  const normal = await decode(tail('Normal'))
  for (let index = 1; index < normal.pixels.length; index += 4) normal.pixels[index] = 255 - normal.pixels[index]
  await sharp(Buffer.from(normal.pixels), { raw: { width: normal.width, height: normal.height, channels: 4 } }).removeAlpha().webp({ quality: 92 }).toFile(join(output, 'layers', `${name}_n.webp`))
  return { name, material, average: average(colour.pixels) }
}

const grass = await sharp(join(dirname(fileURLToPath(import.meta.url)), '../../../packages/look/assets/world/grass_c.webp')).resize(layerSize, layerSize).removeAlpha().ensureAlpha().raw().toBuffer()
const layers = [
  await layer('soil', 'MI_Rocky_Soil_Ground_vb2qdgwew'),
  await layer('sand', 'MI_Dry_Sandy_Mud_wdunfjf_1'),
  await layer('rock', 'MI_Massive_Nordic_Coastal_Cliff'),
]
const fields = Object.fromEntries([['near', near], ['far', far]].map(([name, value]) => [name, { file: value.file, size: value.size, extent: value.extent, origin: value.origin, min: value.min, max: value.max, bytes: value.packed.length }]))
await writeFile(join(output, 'landscape.json'), JSON.stringify({ version: 2, band: world.band, seaLevel: world.seaLevel, ...fields, edge: { file: 'edge.bin', range: ground.edgeRange }, averages: [average(grass), ...layers.map(entry => entry.average)], layers: layers.map(({ name, material }) => ({ name, material })) }, null, 1))
console.log(`landscape written to ${output}`)
