import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { image, type Img } from './cpu'
import { parseGraph, type MaterialGraph } from './graph'

export async function readImage(file: string): Promise<Img> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const out = image(info.width, info.height)
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const s = ((info.height - 1 - y) * info.width + x) * 4
    const d = (y * info.width + x) * 4
    for (let c = 0; c < 4; c++) out.data[d + c] = data[s + c]! / 255
  }
  return out
}

export function toRgba8(img: Img, alpha = true) {
  const bytes = new Uint8Array(img.w * img.h * 4)
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const s = ((img.h - 1 - y) * img.w + x) * 4
    const d = (y * img.w + x) * 4
    for (let c = 0; c < 4; c++) bytes[d + c] = c === 3 && !alpha ? 255 : Math.max(0, Math.min(255, Math.round(img.data[s + c]! * 255)))
  }
  return bytes
}

export async function writeImage(img: Img, file: string, options: { alpha?: boolean; quality?: number; data?: boolean } = {}) {
  const pipeline = sharp(Buffer.from(toRgba8(img, options.alpha ?? true)), { raw: { width: img.w, height: img.h, channels: 4 } })
  const target = options.alpha === false ? pipeline.removeAlpha() : pipeline
  if (file.endsWith('.webp') && options.data) {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'blacksite-material-data-'))
    try {
      const input = path.join(temporary, 'data.png')
      await target.png().toFile(input)
      try { await promisify(execFile)('cwebp', ['-quiet', '-lossless', '-exact', '-m', '6', input, '-o', path.resolve(file)]) }
      catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') throw new Error('Exact WebP data baking requires cwebp on PATH; install the WebP command-line tools or bake --formats ktx2', { cause: error })
        throw error
      }
    } finally { await rm(temporary, { recursive: true, force: true }) }
  } else if (file.endsWith('.webp')) await target.webp({ quality: options.quality ?? 90, alphaQuality: 100, effort: 5 }).toFile(file)
  else await target.png().toFile(file)
}

export async function readGraph(file: string): Promise<MaterialGraph> {
  return parseGraph(JSON.parse(await readFile(file, 'utf8')))
}

export async function loadGraphImages(graph: MaterialGraph, file: string, sources: readonly string[]) {
  const images = new Map<string, Img>()
  for (const src of sources) images.set(src, await readImage(path.resolve(path.dirname(file), src)))
  void graph
  return images
}
