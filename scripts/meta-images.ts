import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'
import opentype, { type Command, type Font } from 'opentype.js'
import { imageSpecs, type ImageSpec } from '../site/src/meta-images'
import { imageSize, themeColor } from '../site/src/seo'

const root = resolve(import.meta.dirname, '..')
const publicDir = resolve(root, 'site/public')
const font = (file: string) => { const data = readFileSync(resolve(root, 'node_modules/@fontsource', file)); return opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) }
const display = font('inter/files/inter-latin-500-normal.woff')
const body = font('inter/files/inter-latin-400-normal.woff')
const accent = '#e0a64e'

export function thumbnailsFromMeta(): Map<string, string> {
  const dir = resolve(root, 'site/src/showcases'), entries: { id: string; tool: string; thumbnail: string; order: number }[] = []
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue
    const source = readFileSync(resolve(dir, name.name, 'meta.ts'), 'utf8')
    const tool = source.match(/tool:\s*'([^']+)'/)?.[1], thumbnail = source.match(/thumbnail:\s*'([^']+)'/)?.[1]
    const order = Number(source.match(/order:\s*(-?[\d.]+)/)?.[1] ?? 0)
    if (tool && thumbnail) entries.push({ id: name.name, tool, thumbnail, order })
  }
  entries.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const found = new Map<string, string>()
  for (const entry of entries) if (!found.has(entry.tool)) found.set(entry.tool, entry.thumbnail)
  return found
}

export const specHash = (spec: ImageSpec) => spec.images.reduce((hash, image) => hash.update(readFileSync(resolve(publicDir, image))), createHash('sha256').update(JSON.stringify(spec))).digest('hex')

type Outline = { advance: number; commands: Command[] }
const outlines = new WeakMap<Font, Map<string, Outline>>()

function outline(face: Font, char: string): Outline {
  const cache = outlines.get(face) ?? new Map<string, Outline>()
  outlines.set(face, cache)
  let known = cache.get(char)
  if (!known) {
    const glyph = face.charToGlyph(char)
    known = { advance: glyph.advanceWidth ?? 0, commands: structuredClone(glyph.path.commands) }
    cache.set(char, known)
  }
  return known
}

function layout(face: Font, value: string, size: number, spacing: number) {
  const scale = size / face.unitsPerEm, chars = [...value], offsets: number[] = []
  let x = 0
  chars.forEach((char, index) => {
    if (index) { const kerning = face.getKerningValue(face.charToGlyph(chars[index - 1]!), face.charToGlyph(char)); x += (Number.isFinite(kerning) ? kerning : 0) * scale }
    offsets.push(x)
    x += outline(face, char).advance * scale + spacing * size
  })
  return { chars, offsets, scale, width: x - spacing * size }
}

function pathData(commands: Command[], x: number, y: number, scale: number): string {
  const px = (value: number) => (x + value * scale).toFixed(2), py = (value: number) => (y - value * scale).toFixed(2)
  return commands.map(command => {
    if (command.type === 'Z') return 'Z'
    if (command.type === 'Q') return `Q${px(command.x1!)} ${py(command.y1!)} ${px(command.x!)} ${py(command.y!)}`
    if (command.type === 'C') return `C${px(command.x1!)} ${py(command.y1!)} ${px(command.x2!)} ${py(command.y2!)} ${px(command.x!)} ${py(command.y!)}`
    return `${command.type}${px(command.x!)} ${py(command.y!)}`
  }).join('')
}

const measure = (face: Font, value: string, size: number, spacing: number) => layout(face, value, size, spacing).width

function wrap(face: Font, text: string, size: number, width: number, spacing: number): string[] {
  const lines: string[] = []
  for (const word of text.split(' ')) {
    const line = lines.length ? `${lines[lines.length - 1]} ${word}` : word
    if (lines.length && measure(face, line, size, spacing) <= width) lines[lines.length - 1] = line
    else lines.push(word)
  }
  return lines
}

function text(face: Font, value: string, x: number, y: number, size: number, fill: string, spacing = 0) {
  const { chars, offsets, scale } = layout(face, value, size, spacing)
  return `<path d="${chars.map((char, index) => pathData(outline(face, char).commands, x + offsets[index]!, y, scale)).join('')}" fill="${fill}"/>`
}

const left = 72, top = 72, inner = imageSize.width - left * 2

function lines(face: Font, value: string, x: number, y: number, size: number, leading: number, width: number, fill: string, spacing = 0) {
  const count = wrap(face, value, size, width, spacing).length
  let fit = width
  while (count > 1 && fit > size * 4 && wrap(face, value, size, fit - 8, spacing).length === count) fit -= 8
  return wrap(face, value, size, fit, spacing).map((line, index) => text(face, line, x, y + index * leading, size, fill, spacing))
}

function overlay(spec: ImageSpec, slots: Slot[]): string {
  const { width, height } = imageSize, parts: string[] = []
  if (spec.images.length > 1) parts.push(...lines(display, spec.title, left, 222, 76, 86, inner, '#ececec', -0.02))
  else if (spec.images.length === 1) {
    const column = slots[0]!.x - left - 48
    const titleLines = wrap(display, spec.title, 68, column, -0.02).length
    parts.push(...lines(display, spec.title, left, 250, 68, 78, column, '#ececec', -0.02))
    if (spec.subtitle) parts.push(...lines(body, spec.subtitle, left, 250 + (titleLines - 1) * 78 + 64, 34, 46, column, '#a3a3a8'))
  } else {
    parts.push(...lines(display, spec.title, left, 330, 88, 96, inner, '#ececec', -0.02))
    if (spec.subtitle) parts.push(...lines(body, spec.subtitle, left, 330 + (wrap(display, spec.title, 88, inner, -0.02).length - 1) * 96 + 76, 38, 50, inner, '#a3a3a8'))
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect x="${left}" y="${top}" width="22" height="22" rx="4" fill="${accent}"/>
    ${text(display, 'Blacksite', left + 36, top + 20, 30, '#ececec')}
    ${parts.join('\n    ')}
  </svg>`
}

type Slot = { x: number; y: number; w: number; h: number }

function slotsFor(spec: ImageSpec): Slot[] {
  const { width, height } = imageSize
  if (spec.images.length > 1) {
    const gap = 24, w = Math.round((inner - gap * (spec.images.length - 1)) / spec.images.length), h = Math.round(w * 9 / 16)
    return spec.images.map((_, index) => ({ x: left + index * (w + gap), y: height - top - h, w, h }))
  }
  if (spec.images.length === 1) { const w = 520, h = 292; return [{ x: width - left - w, y: Math.round((height - h) / 2) + 20, w, h }] }
  return []
}

async function rounded(file: string, slot: Slot) {
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${slot.w}" height="${slot.h}"><rect width="${slot.w}" height="${slot.h}" rx="14" fill="#fff"/></svg>`)
  return sharp(resolve(publicDir, file)).resize(slot.w, slot.h, { fit: 'cover', position: 'centre' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
}

async function render(spec: ImageSpec): Promise<Buffer> {
  const { width, height } = imageSize, slots = slotsFor(spec)
  const svg = overlay(spec, slots)
  if (svg.includes('NaN')) throw new Error(`${spec.file}: text layout produced NaN`)
  const pictures = await Promise.all(spec.images.map(async (file, index) => ({ input: await rounded(file, slots[index]!), left: slots[index]!.x, top: slots[index]!.y })))
  return sharp({ create: { width, height, channels: 3, background: themeColor } }).composite([...pictures, { input: Buffer.from(svg) }]).jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer()
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${accent}"/></svg>\n`
const touchIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><rect width="180" height="180" fill="${themeColor}"/><rect x="50" y="50" width="80" height="80" rx="14" fill="${accent}"/></svg>`

async function main() {
  const thumbnails = thumbnailsFromMeta(), specs = imageSpecs(tool => thumbnails.get(tool))
  mkdirSync(resolve(publicDir, 'og'), { recursive: true })
  const sources: Record<string, string> = {}
  for (const spec of specs) {
    const image = await render(spec)
    writeFileSync(resolve(publicDir, spec.file), image)
    sources[spec.file] = specHash(spec)
    console.log(`${spec.file} ${Math.round(image.length / 1024)} KB`)
  }
  writeFileSync(resolve(publicDir, 'og/sources.json'), `${JSON.stringify(sources, null, 2)}\n`)
  writeFileSync(resolve(publicDir, 'favicon.svg'), favicon)
  await sharp(Buffer.from(favicon)).resize(32, 32).png().toFile(resolve(publicDir, 'favicon-32.png'))
  await sharp(Buffer.from(touchIcon)).resize(180, 180).png().toFile(resolve(publicDir, 'apple-touch-icon.png'))
  await sharp(Buffer.from(touchIcon)).resize(512, 512).png().toFile(resolve(publicDir, 'icon-512.png'))
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.dirname, 'meta-images.ts')) await main()
