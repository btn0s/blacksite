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

export const specHash = (spec: ImageSpec) => createHash('sha256').update(JSON.stringify(spec)).update(readFileSync(resolve(publicDir, spec.source))).digest('hex')

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

function overlay(spec: ImageSpec): string {
  const { width, height } = imageSize, left = 72
  const titleSize = spec.subtitle && spec.title.length <= 40 ? 76 : 60, titleLeading = titleSize * 1.12, titleLines = wrap(display, spec.title, titleSize, 1000, -0.02)
  const subtitleLines = spec.subtitle ? wrap(body, spec.subtitle, 32, 900, 0) : []
  let y = height - 72 - (subtitleLines.length - 1) * 44
  const parts: string[] = []
  for (const line of subtitleLines) { parts.push(text(body, line, left, y, 32, '#c4c4c8')); y += 44 }
  y = height - 72 - (subtitleLines.length ? subtitleLines.length * 44 + 20 : 0) - (titleLines.length - 1) * titleLeading
  for (const line of titleLines) { parts.push(text(display, line, left, y, titleSize, '#ececec', -0.02)); y += titleLeading }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="foot" x1="0" x2="0" y1="1" y2="0"><stop offset="0" stop-color="${themeColor}" stop-opacity="0.92"/><stop offset="0.85" stop-color="${themeColor}" stop-opacity="0"/></linearGradient>
      <linearGradient id="head" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${themeColor}" stop-opacity="0.75"/><stop offset="0.3" stop-color="${themeColor}" stop-opacity="0"/></linearGradient>
    </defs>
    ${spec.card ? '' : `<rect width="${width}" height="${height}" fill="url(#foot)"/><rect width="${width}" height="${height}" fill="url(#head)"/>`}
    <rect x="${left}" y="70" width="22" height="22" rx="4" fill="${accent}"/>
    ${text(display, 'Blacksite', left + 36, 90, 30, '#ececec')}
    ${parts.join('\n    ')}
  </svg>`
}

async function render(spec: ImageSpec): Promise<Buffer> {
  const { width, height } = imageSize
  const photo = spec.card ? sharp({ create: { width, height, channels: 3, background: themeColor } }) : sharp(resolve(publicDir, spec.source)).resize(width, height, { fit: 'cover', position: 'centre' })
  const svg = overlay(spec)
  if (svg.includes('NaN')) throw new Error(`${spec.file}: text layout produced NaN`)
  return photo.composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 84, mozjpeg: true, chromaSubsampling: '4:2:0' }).toBuffer()
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
