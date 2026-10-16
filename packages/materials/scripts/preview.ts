import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { compile } from '../src/graph'
import { evaluate, type Img } from '../src/cpu'
import { loadGraphImages, readGraph, readImage } from '../src/node'

const args = process.argv.slice(2)
const flag = (name: string, fallback: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1]! : fallback }
const res = Number(flag('--res', '512'))
const out = flag('--out', '/tmp/materials-preview')
const window = Number(flag('--window', '2'))
const view = Number(flag('--view', '512'))
await mkdir(out, { recursive: true })
const here = path.dirname(new URL(import.meta.url).pathname)
const scans = JSON.parse(await readFile(path.join(here, '../scans/scans.json'), 'utf8')) as Array<{ id: string; size: [number, number] }>

const light = [-0.5, 0.6, 0.62]
const norm = Math.hypot(...light)

function render(color: Img, normal: Img | null, ao: Img | null, size: number, metres: number, lit: boolean, mode: 'color' | 'lit' | 'channel', channel = 0) {
  const bytes = Buffer.alloc(view * view * 3)
  for (let y = 0; y < view; y++) for (let x = 0; x < view; x++) {
    const u = ((x + 0.5) / view * metres / size) % 1
    const v = (1 - (y + 0.5) / view) * metres / size % 1
    const sx = Math.min(color.w - 1, Math.floor(u * color.w)), sy = Math.min(color.h - 1, Math.floor(v * color.h))
    const i = (sy * color.w + sx) * 4
    let shade = 1
    if (lit && normal) {
      const nx = normal.data[i]! * 2 - 1, ny = normal.data[i + 1]! * 2 - 1, nz = normal.data[i + 2]! * 2 - 1
      shade = 0.35 + 0.85 * Math.max(0, (nx * light[0]! + ny * light[1]! + nz * light[2]!) / norm)
      if (ao) shade *= 0.4 + 0.6 * ao.data[i]!
    }
    for (let c = 0; c < 3; c++) {
      const value = mode === 'channel' ? color.data[i + channel]! : color.data[i + c]! * shade
      bytes[(y * view + x) * 3 + c] = Math.max(0, Math.min(255, Math.round(value * 255)))
    }
  }
  return sharp(bytes, { raw: { width: view, height: view, channels: 3 } }).png().toBuffer()
}

for (const file of args) {
  const graph = await readGraph(file)
  const start = performance.now()
  const program = compile(graph, res)
  const images = await loadGraphImages(graph, file, program.images)
  const result = evaluate(program, images)
  const ms = performance.now() - start
  const id = graph.name.replace(/-image$/, '')
  const scan = scans.find(entry => entry.id === id)
  const tiles: Buffer[] = [
    await render(result.color, result.normal, result.orm, graph.size, window, true, 'lit'),
    await render(result.color, null, null, graph.size, window, false, 'color'),
    await render(result.normal, null, null, graph.size, window, false, 'channel', 3),
    await render(result.orm, null, null, graph.size, window, false, 'channel', 1),
  ]
  if (scan) {
    const dir = path.join(here, '../scans', id)
    const color = await readImage(path.join(dir, 'color.webp'))
    const normal = await readImage(path.join(dir, 'normal.webp'))
    let ao: Img | null = null
    try { ao = await readImage(path.join(dir, 'ao.webp')) } catch { ao = null }
    tiles.push(await render(color, normal, ao, scan.size[0], window, true, 'lit'))
  }
  const composite = sharp({ create: { width: view * tiles.length + 8 * (tiles.length - 1), height: view, channels: 3, background: '#111' } })
    .composite(tiles.map((input, i) => ({ input, left: i * (view + 8), top: 0 })))
  const target = path.join(out, `${graph.name}.png`)
  await composite.png().toFile(target)
  const slow = [...result.timings].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, t]) => `${k} ${t.toFixed(0)}ms`).join(', ')
  console.log(`${graph.name}: ${program.steps.length} steps, ${ms.toFixed(0)} ms at ${res}px (${slow}) → ${target}`)
}
