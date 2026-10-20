import { access, readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { FloatType } from 'three'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { read, write } from 'three/addons/libs/ktx-parse.module.js'

export async function textureLevels(input, output) {
  const source = read(await readFile(input))
  await mkdir(output, { recursive: true })
  const identity = createHash('sha256').update(await readFile(input)).digest('hex').slice(0, 16)
  const tails = []
  for (const size of [256, 512, 1024, 2048]) {
    let first = 0
    while (Math.max(source.pixelWidth >> first, source.pixelHeight >> first) > size) first++
    const width = Math.max(1, source.pixelWidth >> first)
    const height = Math.max(1, source.pixelHeight >> first)
    if (tails.some(tail => tail.width === width && tail.height === height)) continue
    const image = { ...source, pixelWidth: width, pixelHeight: height, levels: source.levels.slice(first) }
    image.levelCount = image.levels.length
    const file = `${identity}.${size}.ktx2`
    const bytes = write(image)
    await writeFile(join(output, file), bytes)
    tails.push({ file, size: Math.max(width, height), width, height, levels: image.levelCount, wireBytes: bytes.byteLength })
  }
  return { file: tails[0].file, tails }
}

export async function buildScanMaterialTails(sourceFile, output) {
  const source = JSON.parse(await readFile(sourceFile, 'utf8'))
  const images = new Map()
  const surfaces = []
  for (const surface of source.surfaces) {
    const maps = {}
    for (const [name, image] of Object.entries(surface.maps)) {
      const input = resolve(dirname(sourceFile), image.detailFile ?? image.file)
      if (!images.has(input)) images.set(input, await textureLevels(input, join(output, 'textures')))
      const encoded = images.get(input)
      maps[name] = { file: `textures/${encoded.file}`, srgb: image.srgb, tails: encoded.tails.map(tail => ({ ...tail, file: `textures/${tail.file}` })) }
    }
    surfaces.push({ ...surface, maps })
  }
  await writeFile(join(output, 'surfaces.json'), JSON.stringify({ version: 2, surfaces }))
  return surfaces
}

export async function buildScanMaterials(sourceFile, output, textureDirectory = output) {
  const source = JSON.parse(await readFile(sourceFile, 'utf8'))
  if (source.version !== 1 || !source.surfaces?.length) throw new Error('A complete material source descriptor is required')
  await mkdir(output, { recursive: true })
  await mkdir(textureDirectory, { recursive: true })
  const surfaces = []
  const images = new Map()
  for (const surface of source.surfaces) {
    if (!['custom-general', 'smart-layers', 'simple-orm', 'candle'].includes(surface.family)) throw new Error(`Unsupported material family: ${surface.family}`)
    const maps = {}
    for (const [name, imageSource] of Object.entries(surface.maps)) {
      if (!imageSource?.file || typeof imageSource.srgb !== 'boolean') throw new Error(`Missing image metadata for ${surface.path}: ${name}`)
      const file = resolve(dirname(sourceFile), imageSource.file)
      const identity = `${file}:${imageSource.srgb}:${name === 'Normal'}:uastc2`
      if (images.has(identity)) {
        maps[name] = { ...images.get(identity), srgb: imageSource.srgb }
        continue
      }
      const destination = `${createHash('sha256').update(identity).digest('hex').slice(0, 16)}.ktx2`
      const exists = await access(join(textureDirectory, destination)).then(() => true, () => false)
      let imageBytes
      if (!images.has(identity) && !exists && file.toLowerCase().endsWith('.exr')) {
        const bytes = await readFile(file)
        const image = new EXRLoader().setDataType(FloatType).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
        const pixels = new Uint8Array(image.width * image.height * 4)
        for (let i = 0; i < pixels.length; i++) pixels[i] = Math.round(Math.max(0, Math.min(1, image.data[i])) * 255)
        imageBytes = await sharp(pixels, { raw: { width: image.width, height: image.height, channels: 4 } }).flip().png().toBuffer()
      } else if (!images.has(identity) && !exists) {
        imageBytes = await readFile(file)
      }
      if (imageBytes) {
        console.log(`Encoding ${surface.path.split('/').at(-1)} ${name}`)
        const work = await mkdtemp(join(tmpdir(), 'blacksite-scan-image-'))
        try {
          const input = join(work, 'image.png')
          await sharp(imageBytes).png().toFile(input)
          const args = ['-uastc', '-uastc_level', '2', '-ktx2', '-mipmap', '-max_threads', '8', '-file', input, '-output_file', join(textureDirectory, destination)]
          if (!imageSource.srgb) args.push('-linear')
          if (name === 'Normal') args.push('-normal_map')
          await new Promise((resolvePromise, reject) => {
            const child = spawn(process.env.BASISU ?? 'basisu', args, { stdio: 'inherit', windowsHide: true })
            child.once('error', reject)
            child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`Basis encoder exited with ${code}`)))
          })
        } finally {
          await rm(work, { recursive: true, force: true })
        }
      }
      const encoded = await textureLevels(join(textureDirectory, destination), join(output, 'textures'))
      const levels = { file: `textures/${encoded.file}`, tails: encoded.tails.map(tail => ({ ...tail, file: `textures/${tail.file}` })) }
      images.set(identity, levels)
      maps[name] = { ...levels, srgb: imageSource.srgb }
    }
    surfaces.push({ family: surface.family, path: surface.path, parameters: surface.parameters, channels: surface.channels, maps })
  }
  await writeFile(join(output, 'surfaces.json'), JSON.stringify({ version: 2, surfaces }, null, 2))
  return surfaces
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Provide the material source descriptor and owned output directory')
  const surfaces = await buildScanMaterials(resolve(process.argv[2]), resolve(process.argv[3]))
  console.log(`Built ${surfaces.length} source material surfaces`)
}
