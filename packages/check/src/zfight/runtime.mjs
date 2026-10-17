import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pageScript } from './page-script.mjs'

const round = (value, digits = 2) => value === null || value === undefined ? null : Math.round(value * 10 ** digits) / 10 ** digits

export async function ringImage(scratch, base, source, regions, scale, file) {
  await scratch.goto(`${base}_check.html`)
  const url = await scratch.evaluate(async ([src, items, factor]) => {
    const image = await new Promise((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = reject; element.src = src })
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    context.lineWidth = Math.max(3, image.width / 400)
    context.strokeStyle = '#ff2bd6'
    context.fillStyle = 'rgba(255, 43, 214, 0.18)'
    for (const region of items) {
      const pad = Math.max(10, image.width / 120)
      const x = region.x * factor - pad
      const y = region.y * factor - pad
      const w = region.w * factor + pad * 2
      const h = region.h * factor + pad * 2
      context.beginPath()
      context.ellipse(x + w / 2, y + h / 2, Math.max(w / 2 * 1.1, 14), Math.max(h / 2 * 1.1, 14), 0, 0, Math.PI * 2)
      context.fill()
      context.stroke()
    }
    return canvas.toDataURL('image/png')
  }, [source, regions, scale])
  await writeFile(file, Buffer.from(url.split(',')[1], 'base64'))
}

export const zfightSeconds = (contract, options = {}, plan) => (contract?.bookmarks?.length || 1) * (plan.frames(24 + (options.frames ?? 6) + 5) + plan.shot(2) + 0.5)

export async function runZFight({ page, scratch, files, out, profile, contract, options = {}, log = () => {}, setPose, shoot }) {
  await mkdir(path.join(out, 'zfight'), { recursive: true })
  await page.addScriptTag({ content: pageScript() })
  const world = await page.evaluate(() => {
    const found = window.__bsZ.world()
    return found ? { meshes: found.meshes, depth: window.__bsZ.depth() } : null
  })
  if (!world) return { pass: false, skipped: 'no three.js WebGLRenderer scene was rendered, so there is no object-ID pass to take' }
  const bookmarks = contract?.bookmarks?.length ? contract.bookmarks : [null]
  const results = []
  const viewport = page.viewportSize()
  for (const bookmark of bookmarks) {
    const label = bookmark?.name ?? 'play'
    if (bookmark) await setPose(page, bookmark, 24)
    else await page.waitForTimeout(500)
    const probe = await page.evaluate(settings => window.__bsZ.probe(settings), { frames: options.frames ?? 6, jitter: options.jitter ?? 0.4, nudge: options.nudge ?? 0.0007 })
    const floor = options.noise ?? Math.max(32, Math.round(probe.width * probe.height * 3e-5))
    const raw = await shoot(page, out, `zfight/${profile}-${label}-raw.png`, false)
    const scale = viewport ? (viewport.width * (profile === 'phone' ? 3 : 1)) / probe.width : 1
    const ringed = probe.pixels > floor ? `zfight/${profile}-${label}.png` : null
    const file = ringed ?? `zfight/${profile}-${label}.png`
    await ringImage(scratch, files.url, `${files.url}${raw}`, probe.pixels > floor ? probe.regions.filter(region => region.pixels >= 3) : [], scale, path.join(out, file))
    const pairs = probe.pairs.slice(0, 6).map(entry => ({ a: probe.names[entry.pair[0]], b: probe.names[entry.pair[1]], pixels: entry.pixels }))
    results.push({
      bookmark: label,
      pixels: probe.pixels,
      unstable: probe.unstable,
      edgeFlicker: probe.edgeFlicker,
      noiseFloor: floor,
      covered: round(probe.covered, 3),
      pass: probe.pixels <= floor && probe.covered >= 0.02,
      regions: probe.regions.length,
      worst: probe.regions.slice(0, 6).map(region => ({ x: region.x, y: region.y, w: region.w, h: region.h, pixels: region.pixels, distance: region.distance })),
      pairs,
      file,
      depth: probe.depth,
      target: `${probe.width}x${probe.height}${probe.floats ? ' float' : ''}`,
    })
    log(`${profile}: zfight ${label} ${probe.pixels} px (floor ${floor}), edge flicker ${probe.edgeFlicker} px`)
  }
  if (contract) await page.evaluate(() => window.__blacksite.camera(null))
  const total = results.reduce((sum, item) => sum + item.pixels, 0)
  const edgeFlicker = results.reduce((sum, item) => sum + item.edgeFlicker, 0)
  return {
    pass: results.every(item => item.pass),
    total,
    edgeFlicker,
    bookmarks: results,
    depth: results[0]?.depth ?? world.depth,
    files: results.map(item => item.file),
    method: 'object-ID buffer per bookmark, 6 renders with sub-pixel projection jitter and 0.7 mm camera nudges plus 5 renders with the nudges alone, through the game own materials; a pixel counts when its winning ID flips between renders, at least three quarters of the 5x5 pixels around it flip too, and it also flips under the nudges alone; pixels that pass the first two tests but only flip under jitter are edge aliasing and are reported as edgeFlicker',
  }
}

export function zfightDetail(result) {
  const empty = result.bookmarks.find(item => item.covered < 0.02)
  if (empty) return `the object-ID pass at ${empty.bookmark} covered ${(empty.covered * 100).toFixed(1)}% of the frame, so nothing was measured`
  const worst = [...result.bookmarks].sort((a, b) => b.pixels - a.pixels)[0]
  const depth = result.depth
  const where = worst && worst.pixels > 0 ? `; worst ${worst.bookmark} ${worst.pixels} px${worst.pairs[0] ? ` between ${worst.pairs[0].a?.name} and ${worst.pairs[0].b?.name}` : ''}` : ''
  return `${result.total} z-fighting pixels over ${result.bookmarks.length} views, ${result.edgeFlicker ?? 0} px edge flicker (${depth ? `${depth.float ? 'float ' : ''}${depth.bits}-bit ${depth.orthographic ? 'orthographic' : depth.logarithmic ? 'logarithmic' : depth.reversed ? 'reversed' : 'standard'} depth, near ${round(depth.near)}` : 'depth unknown'})${where}`
}
