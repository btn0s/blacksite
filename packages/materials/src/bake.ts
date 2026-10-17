import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { encodeToKTX2 } from 'ktx2-encoder'
import { compile, type MaterialGraph, type Weather } from './graph'
import { evaluate, type Img } from './cpu'
import { loadGraphImages, writeImage } from './node'

export type BakeOptions = {
  readonly sizes?: readonly number[]
  readonly formats?: readonly ('ktx2' | 'webp')[]
  readonly weather?: Weather | null
  readonly name?: string
  readonly maxAssetBytes?: number
  readonly log?: (line: string) => void
}

export type BakeReport = { readonly name: string; readonly dir: string; readonly files: ReadonlyArray<{ file: string; bytes: number }>; readonly ms: number; readonly errors: readonly string[] }

const MAPS = ['color', 'normal', 'orm', 'masks'] as const
type MapName = (typeof MAPS)[number]

function raw(img: Img) {
  const bytes = new Uint8Array(img.w * img.h * 4)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.max(0, Math.min(255, Math.round(img.data[i]! * 255)))
  return bytes
}

async function ktx2(img: Img, map: MapName) {
  const data = raw(img)
  const color = map === 'color'
  const etc1s = color
  return await encodeToKTX2(new Uint8Array(0), {
    imageDecoder: async () => ({ width: img.w, height: img.h, data }),
      isUASTC: !etc1s,
      qualityLevel: 230,
      compressionLevel: 2,
      needSupercompression: true,
      enableRDO: !etc1s,
      rdoQualityLevel: map === 'normal' ? 1.25 : 2,
      uastcLDRQualityLevel: 2,
      generateMipmap: true,
      isPerceptual: color,
      isSetKTX2SRGBTransferFunc: color,
      isNormalMap: map === 'normal',
      enableDebug: false,
  })
}

const moduleSource = (graph: MaterialGraph, name: string, format: 'ktx2' | 'webp', sizes: readonly number[], hash: string) => {
  const maps = sizes.map(size => `    ${size}: {\n${MAPS.map(map => `      ${map}: new URL('./${size}/${map}.${format}', import.meta.url).href,`).join('\n')}\n    },`).join('\n')
  return `export default {\n  name: ${JSON.stringify(name)},\n  title: ${JSON.stringify(graph.title ?? name)},\n  size: ${graph.size},\n  depth: ${graph.depth},\n  format: '${format}',\n  hash: '${hash}',\n  maps: {\n${maps}\n  },\n} as const\n`
}

export async function bake(graph: MaterialGraph, graphFile: string, outDir: string, options: BakeOptions = {}): Promise<BakeReport> {
  const start = performance.now()
  const sizes = options.sizes ?? [512, 1024]
  const formats = options.formats ?? ['ktx2', 'webp']
  const name = options.name ?? graph.name
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new Error('baked material name must be a filename-safe identifier')
  if (!sizes.length || sizes.some(size => !Number.isInteger(size) || size < 16 || size > 4096 || (size & (size - 1)) !== 0)) throw new Error('bake sizes must be powers of two between 16 and 4096')
  if (!formats.length || formats.some(format => format !== 'ktx2' && format !== 'webp')) throw new Error('formats must contain ktx2 or webp')
  if (options.maxAssetBytes !== undefined && (!Number.isFinite(options.maxAssetBytes) || options.maxAssetBytes <= 0)) throw new Error('maxAssetBytes must be positive')
  const dir = path.join(outDir, name)
  const log = options.log ?? (() => {})
  const files: Array<{ file: string; bytes: number }> = []
  const errors: string[] = []
  const first = compile(graph, sizes[0]!, { weather: options.weather })
  const images = await loadGraphImages(graph, graphFile, first.images)
  const digest = createHash('sha256').update(JSON.stringify({ graph, weather: options.weather }))
  for (const [source, img] of images) digest.update(source).update(`${img.w}:${img.h}`).update(new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength))
  const hash = digest.digest('hex').slice(0, 12)
  for (const size of sizes) {
    const program = compile(graph, size, { weather: options.weather })
    const result = evaluate(program, images)
    await mkdir(path.join(dir, String(size)), { recursive: true })
    for (const map of MAPS) {
      const img = result[map]
      for (const format of formats) {
        const file = path.join(dir, String(size), `${map}.${format}`)
        if (format === 'ktx2') await writeFile(file, await ktx2(img, map))
        else await writeImage(img, file, { alpha: map !== 'color', quality: 88, data: map !== 'color' })
        const bytes = (await stat(file)).size
        files.push({ file: path.relative(outDir, file), bytes })
        if (options.maxAssetBytes && bytes > options.maxAssetBytes) errors.push(`${path.relative(outDir, file)}: ${bytes} > ${options.maxAssetBytes} bytes`)
      }
    }
    log(`${name} ${size}px baked`)
  }
  for (const format of formats) {
    await writeFile(path.join(dir, format === 'ktx2' ? 'index.ts' : 'webp.ts'), moduleSource(graph, name, format, sizes, hash))
    for (const size of sizes) await writeFile(path.join(dir, `${size}${format === 'ktx2' ? '' : '.webp'}.ts`), moduleSource(graph, name, format, [size], hash))
  }
  await writeFile(path.join(dir, 'material.json'), JSON.stringify({ name, title: graph.title, size: graph.size, depth: graph.depth, hash, sizes, formats, files }, null, 2) + '\n')
  return { name, dir, files, ms: performance.now() - start, errors }
}
