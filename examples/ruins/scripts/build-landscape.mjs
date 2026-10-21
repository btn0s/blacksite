import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import sharp from 'sharp'
import { smoothstep } from '../../../packages/landscape/src/random.ts'
import { rasterizeLevelGround } from './level-ground.mjs'
import { hills, levelSurface, macro, relaxMembrane, surfaceMasks, world } from './landscape-shape.mjs'

const [collisionDirectory, materialsDirectory, output] = process.argv.slice(2).map(path => resolve(path))
if (!collisionDirectory || !materialsDirectory || !output) throw new Error('Usage: build-landscape.mjs <collision directory> <materials directory> <output directory>')
await mkdir(join(output, 'layers'), { recursive: true })

const report = message => console.log(message)
const raster = await rasterizeLevelGround(collisionDirectory)
const surface = levelSurface(raster)
const { field } = relaxMembrane(surface, report)

const rasterAt = (x, z) => {
  const i = Math.round((x - surface.x0) / surface.cell), j = Math.round((z - surface.z0) / surface.cell)
  return i < 0 || j < 0 || i >= surface.width || j >= surface.height ? -1 : j * surface.width + i
}

function height(x, z, detail) {
  const slot = rasterAt(x, z)
  if (slot < 0) return macro(x, z) + hills(x, z, detail)
  if (surface.solid[slot]) return surface.under[slot]
  const ramp = smoothstep(20, 180, surface.rimDistance[slot] * surface.cell)
  return field[slot] + hills(x, z, detail) * ramp
}

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
    const slot = rasterAt(x, z)
    const rimDistance = slot < 0 || name === 'far' ? 1e6 : surface.rimDistance[slot] * surface.cell
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
async function layer(name, material) {
  const source = surfaces.find(surface => surface.path.split('/').at(-1).startsWith(`${material}.`))
  if (!source) throw new Error(`Surface ${material} is missing`)
  const tail = map => join(surfaceRoot, source.maps[map].tails.find(entry => entry.size === layerSize).file)
  const colour = await decode(tail('Albedo'))
  await sharp(Buffer.from(colour.pixels), { raw: { width: colour.width, height: colour.height, channels: 4 } }).removeAlpha().webp({ quality: 92 }).toFile(join(output, 'layers', `${name}_c.webp`))
  const normal = await decode(tail('Normal'))
  for (let index = 1; index < normal.pixels.length; index += 4) normal.pixels[index] = 255 - normal.pixels[index]
  await sharp(Buffer.from(normal.pixels), { raw: { width: normal.width, height: normal.height, channels: 4 } }).removeAlpha().webp({ quality: 92 }).toFile(join(output, 'layers', `${name}_n.webp`))
  return { name, material }
}

const layers = [
  await layer('soil', 'MI_Rocky_Soil_Ground_vb2qdgwew'),
  await layer('sand', 'MI_Dry_Sandy_Mud_wdunfjf_1'),
  await layer('rock', 'MI_Massive_Nordic_Coastal_Cliff'),
]
const fields = Object.fromEntries([['near', near], ['far', far]].map(([name, value]) => [name, { file: value.file, size: value.size, extent: value.extent, origin: value.origin, min: value.min, max: value.max, bytes: value.packed.length }]))
await writeFile(join(output, 'landscape.json'), JSON.stringify({ version: 1, band: world.band, seaLevel: world.seaLevel, ...fields, layers }, null, 1))
console.log(`landscape written to ${output}`)
