import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const FLYOVER_DEFAULTS = { popLimit: 0, steps: 16, k: 2.5, floor: 0.0004, width: 360 }

const spline = (p0, p1, p2, p3, t) => p1.map((_, index) => 0.5 * (2 * p1[index] + (p2[index] - p0[index]) * t + (2 * p0[index] - 5 * p1[index] + 4 * p2[index] - p3[index]) * t * t + (3 * p1[index] - p0[index] - 3 * p2[index] + p3[index]) * t * t * t))

export function flyoverPoses(poses, steps) {
  const result = []
  for (let index = 0; index < poses.length - 1; index++) {
    const p0 = poses[Math.max(0, index - 1)]
    const p1 = poses[index]
    const p2 = poses[index + 1]
    const p3 = poses[Math.min(poses.length - 1, index + 2)]
    for (let step = index === 0 ? 0 : 1; step <= steps; step++) {
      const t = step / steps
      const fov = p1.fov !== undefined && p2.fov !== undefined ? p1.fov + (p2.fov - p1.fov) * t : p1.fov
      result.push({ segment: index, step, pose: { position: spline(p0.position, p1.position, p2.position, p3.position, t), target: spline(p0.target, p1.target, p2.target, p3.target, t), ...(fov !== undefined ? { fov } : {}) } })
    }
  }
  return result
}

async function frame({ pose, settle, width, first }) {
  const canvas = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
  const height = Math.round(width * canvas.height / canvas.width)
  const work = new OffscreenCanvas(width, height)
  const context = work.getContext('2d', { willReadFrequently: true })
  context.imageSmoothingQuality = 'high'
  window.__blacksite.camera(pose)
  await window.__check.frame(settle)
  const data = await new Promise((resolve, reject) => {
    let tries = 0
    const step = () => requestAnimationFrame(() => {
      context.clearRect(0, 0, width, height)
      context.drawImage(canvas, 0, 0, width, height)
      const pixels = context.getImageData(0, 0, width, height).data
      let alpha = 0
      for (let index = 3; index < pixels.length; index += 388) alpha += pixels[index]
      if (alpha) resolve(pixels)
      else if (++tries > 20) reject(new Error('the canvas could not be read inside requestAnimationFrame'))
      else step()
    })
    step()
  })
  const luma = new Float32Array(width * height)
  for (let index = 0, pixel = 0; pixel < luma.length; index += 4, pixel++) luma[pixel] = (0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) / 255
  const previous = first ? null : window.__flyoverLuma
  let energy = null
  if (previous && previous.length === luma.length) {
    energy = 0
    for (let pixel = 0; pixel < luma.length; pixel++) energy += (luma[pixel] - previous[pixel]) ** 2
    energy /= luma.length
  }
  window.__flyoverLuma = luma
  const blob = await work.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  const src = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob) })
  return { energy, src }
}

export const flyoverSeconds = (contract, options, plan) => {
  const count = Math.max(0, ((contract?.flyover ?? 0) - 1) * (options.flyoverSteps ?? FLYOVER_DEFAULTS.steps) + 1)
  return plan.frames(30 + count * ((options.flyoverSettle ?? 4) + 1)) + plan.shot(2)
}

export async function runFlyover({ page, scratch, base, out, name, contract, options, setPose, contactSheet, percentile, round }) {
  const poses = contract ? await page.evaluate(() => window.__blacksite.flyover ?? null) : null
  if (!poses || poses.length < 2) return { pass: false, skipped: 'needs at least two flyover poses in window.__blacksite' }
  const quality = contract.model?.quality ?? {}
  const popLimit = quality.popLimit ?? FLYOVER_DEFAULTS.popLimit
  const steps = options.flyoverSteps ?? FLYOVER_DEFAULTS.steps
  const k = options.flyoverK ?? FLYOVER_DEFAULTS.k
  const floor = options.flyoverFloor ?? FLYOVER_DEFAULTS.floor
  const width = options.flyoverWidth ?? FLYOVER_DEFAULTS.width
  const path_ = flyoverPoses(poses, steps)
  const scripts = contract.scripts ?? []
  const tiles = []
  await mkdir(path.join(out, 'flyover'), { recursive: true })
  if (scripts.includes('freeze')) await page.evaluate(() => window.__blacksite.scripts.freeze())
  try {
    await setPose(page, path_[0].pose, 30)
    for (const [index, item] of path_.entries()) {
      const result = await page.evaluate(frame, { pose: item.pose, settle: options.flyoverSettle ?? 4, width, first: index === 0 })
      const src = `flyover/${name}-${String(index).padStart(3, '0')}.jpg`
      await writeFile(path.join(out, src), Buffer.from(result.src.split(',')[1], 'base64'))
      tiles.push({ index, segment: item.segment, step: item.step, energy: result.energy, src, pose: item.pose })
    }
  } finally {
    if (scripts.includes('unfreeze')) await page.evaluate(() => window.__blacksite.scripts.unfreeze())
    await page.evaluate(() => { delete window.__flyoverLuma; window.__blacksite.camera(null) })
  }
  const energies = tiles.slice(1).map(tile => tile.energy)
  const flagged = []
  energies.forEach((value, index) => {
    const neighbours = energies.filter((_, other) => other !== index && Math.abs(other - index) <= 2)
    const expected = percentile(neighbours, 0.5) ?? 0
    const tile = tiles[index + 1]
    tile.expected = expected
    if (value > Math.max(expected * k, expected + floor)) { tile.flag = true; flagged.push({ frame: tile.index, segment: tile.segment, step: tile.step, energy: round(value, 5), expected: round(expected, 5), ratio: round(expected ? value / expected : null, 2) }) }
  })
  const allowed = Math.floor(popLimit * energies.length)
  const sheet = `flyover-${name}.png`
  const json = `flyover-${name}.json`
  await contactSheet(scratch, base, out, tiles.map(tile => ({ src: tile.src, flag: tile.flag, label: `${tile.index} s${tile.segment}:${tile.step}/${steps}${tile.energy !== null ? ` E${(tile.energy * 1000).toFixed(2)}` : ''}${tile.flag ? ` ×${(tile.energy / tile.expected).toFixed(1)}` : ''}` })), sheet, { columns: 8, width: 240 })
  await writeFile(path.join(out, json), `${JSON.stringify({ profile: name, steps, k, floor, popLimit, allowed, frames: tiles.map(tile => ({ index: tile.index, segment: tile.segment, step: tile.step, energy: round(tile.energy, 6), expected: round(tile.expected ?? null, 6), flag: !!tile.flag, src: tile.src, pose: tile.pose })) }, null, 2)}\n`)
  return {
    pass: flagged.length <= allowed,
    frames: tiles.length,
    steps,
    popLimit,
    allowed,
    energy: { p50: round(percentile(energies, 0.5), 5), p95: round(percentile(energies, 0.95), 5), max: round(Math.max(...energies), 5) },
    flagged,
    files: [sheet, json],
    method: `mean squared luminance delta (0..1) between consecutive ${width} px frames along a Catmull-Rom path through flyover with ${steps} frames per segment, wind frozen; a frame is flagged above ${k}x the median of the two frames either side and at least ${floor} over it; fails when flagged frames exceed popLimit of the frame count`,
  }
}
