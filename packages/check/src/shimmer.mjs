import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const SHIMMER_DEFAULTS = { shimmerStill: 0.01, shimmerMotion: 0.03 }

const OFFSETS = [[0.25, 0], [0.5, 0], [0.75, 0], [0, 0.25], [0, 0.5], [0, 0.75]]

async function measure({ pose, still, offsets, settle, border, heat, sign }) {
  const check = window.__blacksite
  const canvas = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
  const width = canvas.width
  const height = canvas.height
  const size = width * height
  const work = new OffscreenCanvas(width, height)
  const context = work.getContext('2d', { willReadFrequently: true })
  const grab = () => new Promise((resolve, reject) => {
    let tries = 0
    const step = () => requestAnimationFrame(() => {
      context.clearRect(0, 0, width, height)
      context.drawImage(canvas, 0, 0)
      const data = context.getImageData(0, 0, width, height).data
      let alpha = 0
      for (let index = 3; index < data.length; index += 388) alpha += data[index]
      if (!alpha) { if (++tries > 20) reject(new Error('the canvas could not be read inside requestAnimationFrame')); else step(); return }
      const luma = new Float32Array(size)
      for (let index = 0, pixel = 0; pixel < size; index += 4, pixel++) luma[pixel] = (0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) / 255
      resolve(luma)
    })
    step()
  })
  const histogram = () => {
    const bins = new Float64Array(4096)
    let sum = 0
    let count = 0
    let max = 0
    return {
      add(value) { bins[Math.min(4095, Math.floor(value * 4096))]++; sum += value; count++; if (value > max) max = value },
      result() {
        let seen = 0
        let p99 = 0
        for (let bin = 0; bin < 4096; bin++) { seen += bins[bin]; if (seen >= count * 0.99) { p99 = bin / 4096; break } }
        return { mean: count ? sum / count : 0, p99, max }
      },
    }
  }
  const inside = pixel => { const x = pixel % width; const y = (pixel - x) / width; return x >= border && y >= border && x < width - border && y < height - border }
  const blur = source => {
    const across = new Float32Array(size)
    const result = new Float32Array(size)
    const taps = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16]
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let total = 0
      for (let tap = -2; tap <= 2; tap++) total += taps[tap + 2] * source[y * width + Math.min(width - 1, Math.max(0, x + tap))]
      across[y * width + x] = total
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let total = 0
      for (let tap = -2; tap <= 2; tap++) total += taps[tap + 2] * across[Math.min(height - 1, Math.max(0, y + tap)) * width + x]
      result[y * width + x] = total
    }
    return result
  }
  const shift = (source, dx, dy) => {
    const result = new Float32Array(size)
    const ix = Math.floor(dx)
    const iy = Math.floor(dy)
    const fx = dx - ix
    const fy = dy - iy
    for (let y = 0; y < height; y++) {
      const y0 = Math.min(height - 1, Math.max(0, y + iy)) * width
      const y1 = Math.min(height - 1, Math.max(0, y + iy + 1)) * width
      for (let x = 0; x < width; x++) {
        const x0 = Math.min(width - 1, Math.max(0, x + ix))
        const x1 = Math.min(width - 1, Math.max(0, x + ix + 1))
        result[y * width + x] = (1 - fy) * ((1 - fx) * source[y0 + x0] + fx * source[y0 + x1]) + fy * ((1 - fx) * source[y1 + x0] + fx * source[y1 + x1])
      }
    }
    return result
  }

  check.camera(pose)
  await window.__check.frame(settle)
  const frames = []
  for (let index = 0; index < still; index++) frames.push(await grab())
  const stillMap = new Float32Array(size)
  const stillStats = histogram()
  for (let index = 1; index < frames.length; index++) {
    const a = frames[index - 1]
    const b = frames[index]
    for (let pixel = 0; pixel < size; pixel++) {
      if (!inside(pixel)) continue
      const delta = Math.abs(b[pixel] - a[pixel])
      stillStats.add(delta)
      if (delta > stillMap[pixel]) stillMap[pixel] = delta
    }
  }
  const reference = new Float32Array(size)
  for (const frame of frames) for (let pixel = 0; pixel < size; pixel++) reference[pixel] += frame[pixel] / frames.length

  const motionMap = new Float32Array(size)
  const motionStats = histogram()
  const perOffset = []
  for (const [dx, dy] of offsets) {
    check.camera({ ...pose, view: { x: dx / width, y: dy / height, scale: 1 } })
    await window.__check.frame(settle)
    const actual = blur(await grab())
    const predicted = blur(shift(reference, sign[0] * dx, sign[1] * dy))
    const local = histogram()
    for (let pixel = 0; pixel < size; pixel++) {
      if (!inside(pixel)) continue
      const residual = Math.abs(actual[pixel] - predicted[pixel])
      motionStats.add(residual)
      local.add(residual)
      if (residual > motionMap[pixel]) motionMap[pixel] = residual
    }
    perOffset.push({ offset: [dx, dy], ...local.result() })
  }
  check.camera(pose)

  const sheet = new OffscreenCanvas(width * 2 + 8, height)
  const paint = sheet.getContext('2d')
  paint.fillStyle = '#000'
  paint.fillRect(0, 0, sheet.width, sheet.height)
  for (const [panel, map] of [[0, stillMap], [1, motionMap]]) {
    const image = paint.createImageData(width, height)
    for (let pixel = 0; pixel < size; pixel++) {
      const base = reference[pixel] * 255 * 0.35
      const t = Math.min(1, Math.max(0, (map[pixel] - heat[0]) / (heat[1] - heat[0])))
      const alpha = map[pixel] > heat[0] ? Math.min(1, 0.45 + t) : 0
      image.data[pixel * 4] = base + (255 - base) * alpha
      image.data[pixel * 4 + 1] = base + (235 * (1 - t) - base) * alpha
      image.data[pixel * 4 + 2] = base + (40 * (1 - t) - base) * alpha
      image.data[pixel * 4 + 3] = 255
    }
    paint.putImageData(image, panel * (width + 8), 0)
  }
  paint.font = `${Math.max(12, Math.round(height / 45))}px ui-monospace, monospace`
  paint.textBaseline = 'top'
  const stillResult = stillStats.result()
  const motionResult = motionStats.result()
  const caption = (text, x) => { const w = paint.measureText(text).width; paint.fillStyle = '#000c'; paint.fillRect(x + 4, 4, w + 8, parseInt(paint.font) + 6); paint.fillStyle = '#fff'; paint.fillText(text, x + 8, 7) }
  caption(`still  mean ${stillResult.mean.toFixed(4)} p99 ${stillResult.p99.toFixed(4)}`, 0)
  caption(`sub-pixel motion  mean ${motionResult.mean.toFixed(4)} p99 ${motionResult.p99.toFixed(4)}`, width + 8)
  const blob = await sheet.convertToBlob({ type: 'image/png' })
  const png = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob) })
  return { width, height, still: stillResult, motion: { ...motionResult, perOffset }, png }
}

export async function runShimmer({ page, scratch, base, out, name, profile, contract, options, setPose, contactSheet, round }) {
  if (!contract?.bookmarks.length) return { pass: false, skipped: 'needs at least one bookmark in window.__blacksite' }
  const quality = { ...SHIMMER_DEFAULTS, ...(contract.model?.quality ?? {}) }
  const scripts = contract.scripts ?? []
  const still = options.shimmerFrames ?? 8
  const views = []
  if (scripts.includes('freeze')) await page.evaluate(() => window.__blacksite.scripts.freeze())
  try {
    for (const bookmark of contract.bookmarks) {
      await setPose(page, bookmark, 30)
      const result = await page.evaluate(measure, { pose: bookmark, still, offsets: OFFSETS, settle: 4, border: 4, heat: [0.02, 0.12], sign: [1, 1] })
      const file = `shimmer/${name}-${bookmark.name}.png`
      await mkdir(path.join(out, 'shimmer'), { recursive: true })
      await writeFile(path.join(out, file), Buffer.from(result.png.split(',')[1], 'base64'))
      const view = {
        name: bookmark.name,
        still: { mean: round(result.still.mean, 4), p99: round(result.still.p99, 4), max: round(result.still.max, 4) },
        motion: { mean: round(result.motion.mean, 4), p99: round(result.motion.p99, 4), max: round(result.motion.max, 4), offsets: result.motion.perOffset.map(item => ({ offset: item.offset, mean: round(item.mean, 4), p99: round(item.p99, 4) })) },
        file,
      }
      view.pass = view.still.mean <= quality.shimmerStill && view.motion.mean <= quality.shimmerMotion
      views.push({ ...view, size: [result.width, result.height] })
    }
  } finally {
    if (scripts.includes('unfreeze')) await page.evaluate(() => window.__blacksite.scripts.unfreeze())
    await page.evaluate(() => window.__blacksite.camera(null))
  }
  const wide = views[0].size[0] > views[0].size[1]
  const sheet = `shimmer-${name}.png`
  await contactSheet(scratch, base, out, views.map(view => ({ src: view.file, flag: !view.pass, label: `${view.name} still ${view.still.mean}/${view.still.p99} motion ${view.motion.mean}/${view.motion.p99}` })), sheet, wide ? { columns: 1, width: Math.min(1600, views[0].size[0] * 2) } : { columns: 4, width: Math.round(Math.min(560, profile.viewport.width * 1.25)) })
  return {
    pass: views.every(view => view.pass),
    budget: { shimmerStill: quality.shimmerStill, shimmerMotion: quality.shimmerMotion },
    frames: still,
    views: views.map(({ size, ...view }) => view),
    files: [sheet, ...views.map(view => view.file)],
    method: 'luminance 0..1 at render resolution, read from the canvas inside requestAnimationFrame with wind frozen; still is the per-pixel delta between consecutive frames with the camera held; motion is the per-pixel residual between a frame shifted by a quarter, half or three quarters of a render pixel through setViewOffset and the still reference resampled by the same shift, both low-passed with a 5-tap binomial so only aliased energy survives; budgets judge the mean',
  }
}
