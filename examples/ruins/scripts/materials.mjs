import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { FloatType } from 'three'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'

const source = resolve(process.argv[2] ?? 'D:/Archive/dark-ruins-export')
const output = resolve(process.argv[3] ?? 'D:/dev/owned-assets/dark-ruins/level')
const materials = JSON.parse(await readFile(join(source, 'materials.json'), 'utf8')).materials
const textures = JSON.parse(await readFile(join(source, 'textures.json'), 'utf8')).textures
const placements = JSON.parse(await readFile(join(source, 'placements.json'), 'utf8')).instances
const used = new Set(placements.flatMap(instance => instance.materials))
const generalSource = resolve(process.argv[4] ?? 'D:/dev/owned-assets/dark-ruins-source/materials.json')
const general = JSON.parse(await readFile(generalSource, 'utf8')).surfaces[0]
const noise = general.maps.RGBNoise.asset
const fixedTextures = new Map([[noise, { ...general.maps.RGBNoise, files: [resolve(dirname(generalSource), general.maps.RGBNoise.file)] }]])
await mkdir(join(output, 'textures'), { recursive: true })
const built = new Map()
async function image(path) {
  if (built.has(path)) return built.get(path)
  const info = textures[path] ?? fixedTextures.get(path)
  if (!info?.files?.length) throw new Error(`Missing source texture ${path}`)
  const file = `textures/${createHash('sha256').update(path).digest('hex').slice(0, 16)}.webp`
  const destination = join(output, file)
  try { await stat(destination) } catch {
    const input = resolve(source, info.files[0])
    let pipeline
    if (input.toLowerCase().endsWith('.exr')) {
      const bytes = await readFile(input)
      const image = new EXRLoader().setDataType(FloatType).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const pixels = new Uint8Array(image.width * image.height * 4)
      for (let i = 0; i < pixels.length; i++) pixels[i] = Math.round(Math.max(0, Math.min(1, image.data[i])) * 255)
      pipeline = sharp(pixels, { raw: { width: image.width, height: image.height, channels: 4 } }).flip()
    } else pipeline = sharp(input)
    await pipeline.resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).webp({ lossless: true, effort: 3 }).toFile(destination)
  }
  const value = { file, srgb: info.srgb }
  built.set(path, value)
  return value
}
const surfaces = []
for (const path of used) {
  const sourceMaterial = materials[path]
  if (!sourceMaterial) throw new Error(`Missing source material ${path}`)
  const parameters = sourceMaterial.parameters
  const textures = parameters.texture
  const general = Object.hasOwn(parameters.scalar, 'Specular Min') && textures.Albedo && textures.Packed
  const maps = {}
  if (general) {
    for (const name of ['Albedo', 'Normal', 'Packed', 'Metalness']) if (textures[name]) maps[name] = await image(textures[name])
    if (!maps.Metalness) maps.Metalness = await image('/Game/MSPresets/MSVTTextures/T_BlackPlaceholder.T_BlackPlaceholder')
    maps.RGBNoise = await image(noise)
  } else {
    for (const [name, texture] of Object.entries(textures)) maps[name] = await image(texture)
  }
  surfaces.push({ family: general ? 'custom-general' : 'untranslated', path, parameters, channels: { roughness: 'g', metalness: 'b' }, maps, properties: sourceMaterial.properties })
  console.log(JSON.stringify({ surfaces: surfaces.length, total: used.size, textures: built.size }))
}
await writeFile(join(output, 'surfaces.json'), JSON.stringify({ version: 1, textureLimit: 1024, surfaces }))
