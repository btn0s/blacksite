import { access, readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { FloatType } from 'three'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'

export async function buildScanMaterials(sourceFile, output) {
  const source = JSON.parse(await readFile(sourceFile, 'utf8'))
  if (source.version !== 1 || !source.surfaces?.length) throw new Error('A complete material source descriptor is required')
  await mkdir(output, { recursive: true })
  const surfaces = []
  const images = new Map()
  for (const surface of source.surfaces) {
    if (surface.family !== 'custom-general') throw new Error(`Unsupported material family: ${surface.family}`)
    const maps = {}
    for (const name of ['Albedo', 'Normal', 'Packed', 'Metalness', 'RGBNoise']) {
      const imageSource = surface.maps[name]
      if (!imageSource?.file || typeof imageSource.srgb !== 'boolean') throw new Error(`Missing image metadata for ${surface.path}: ${name}`)
      const file = resolve(dirname(sourceFile), imageSource.file)
      const identity = `${file}:${imageSource.srgb}:${name === 'Normal'}:uastc2`
      const destination = `${createHash('sha256').update(identity).digest('hex').slice(0, 16)}.ktx2`
      const exists = await access(join(output, destination)).then(() => true, () => false)
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
          const args = ['-uastc', '-uastc_level', '2', '-ktx2', '-mipmap', '-max_threads', '8', '-file', input, '-output_file', join(output, destination)]
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
      images.set(identity, destination)
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
