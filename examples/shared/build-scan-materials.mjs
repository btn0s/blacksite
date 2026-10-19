import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { FloatType } from 'three'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'

export async function buildScanMaterials(sourceFile, output) {
  const source = JSON.parse(await readFile(sourceFile, 'utf8'))
  if (source.version !== 1 || !source.surfaces?.length) throw new Error('A complete material source descriptor is required')
  await mkdir(output, { recursive: true })
  const surfaces = []
  for (const [index, surface] of source.surfaces.entries()) {
    if (surface.family !== 'custom-general') throw new Error(`Unsupported material family: ${surface.family}`)
    const maps = {}
    for (const name of ['Albedo', 'Normal', 'Packed', 'Metalness', 'RGBNoise']) {
      const imageSource = surface.maps[name]
      if (!imageSource?.file || typeof imageSource.srgb !== 'boolean') throw new Error(`Missing image metadata for ${surface.path}: ${name}`)
      const file = resolve(dirname(sourceFile), imageSource.file)
      const destination = `${index}-${name.toLowerCase()}.webp`
      if (file.toLowerCase().endsWith('.exr')) {
        const bytes = await readFile(file)
        const image = new EXRLoader().setDataType(FloatType).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
        const pixels = new Uint8Array(image.width * image.height * 4)
        for (let i = 0; i < pixels.length; i++) pixels[i] = Math.round(Math.max(0, Math.min(1, image.data[i])) * 255)
        await sharp(pixels, { raw: { width: image.width, height: image.height, channels: 4 } }).flip().webp({ lossless: true, effort: 6 }).toFile(join(output, destination))
      } else {
        await sharp(file).webp({ lossless: true, effort: 6 }).toFile(join(output, destination))
      }
      maps[name] = { file: destination, srgb: imageSource.srgb }
    }
    surfaces.push({ family: surface.family, path: surface.path, parameters: surface.parameters, channels: surface.channels, maps })
  }
  await writeFile(join(output, 'surfaces.json'), JSON.stringify({ version: 1, surfaces }, null, 2))
  return surfaces
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Provide the material source descriptor and owned output directory')
  const surfaces = await buildScanMaterials(resolve(process.argv[2]), resolve(process.argv[3]))
  console.log(`Built ${surfaces.length} source material surfaces`)
}
