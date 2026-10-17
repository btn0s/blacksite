import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const require = createRequire(path.join(root, 'packages/check/package.json'))
const { chromium } = require('playwright-core')
const sharp = createRequire(path.join(root, 'package.json'))('sharp')
const args = process.argv.slice(2)
const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback }
const base = args[0] ?? 'http://localhost:5321/frames/firing-range.html'
const out = path.resolve(args[1] ?? 'viewmodel-captures')
const profile = option('profile', 'desktop')
const rig = option('rig', 'blacksite')
const scale = Number(option('scale', '1'))
const only = option('only', '').split(',').filter(Boolean)
const weaponFilter = option('weapon', '').split(',').filter(Boolean)
const batch = option('batch', '')
const measureOnly = args.includes('--measure-only')
const maxStep = Number(option('step', String(1 / 60)))
const GPU_ARGS = ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--use-gl=angle', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
const viewport = profile === 'phone' ? { width: 390, height: 844 } : { width: 1600, height: 900 }
const step = (seconds, patch = {}) => ({ seconds, patch })
const sampled = (times, patch) => times.map((time, index) => [`t${time}`, [step(index ? time - times[index - 1] : time, index ? {} : patch)]])
const sequences = {
  states: weapon => [
    ['idle', [step(0.4, { weapon })]],
    ['walk', [step(0.8, { speed: 3.1 })]],
    ['sprint', [step(0.5, { speed: 5.2, sprinting: true })]],
    ['aim', [step(0.6, { speed: 0, sprinting: false, aiming: true })]],
    ['aim-walk', [step(0.35, { speed: 1.8 })]],
    ['empty', [step(0.4, { speed: 0, aiming: false, empty: true })]],
    ['sway', [step(0.4, { empty: false, yawRate: 1.6 })]],
  ],
  fire: () => sampled([0.0167, 0.05, 0.1, 0.2, 0.35], { fire: true }),
  reload: weapon => sampled(rig === 'found' ? [0.1, 0.4, 0.7, 1, 1.3, 1.6, 1.9, 2.2, 2.5, 2.8, 3.125] : weapon === 'rifle' ? [0.1, 0.24, 0.38, 0.5, 0.7, 0.85, 1.08, 1.28, 1.48, 1.68, 1.78, 1.94, 2.1] : [0.1, 0.14, 0.3, 0.45, 0.6, 0.8, 0.95, 1.03, 1.18, 1.35], { reload: true }),
  equip: weapon => [['from', [step(1, { weapon: weapon === 'rifle' ? 'pistol' : 'rifle' })]], ...sampled([0.05, 0.12, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75], { weapon })],
  inspect: weapon => sampled(weapon === 'rifle' ? [0.2, 0.5, 0.8, 1.1, 1.4, 1.7, 2, 2.4, 2.8, 3.3] : [0.2, 0.5, 0.8, 1.1, 1.4, 1.7, 2, 2.3, 2.7], { inspect: true }),
  land: () => sampled([0.03, 0.06, 0.1, 0.22, 0.5], { land: 5.5 }),
  ...(rig === 'found' ? { emptyReload: () => sampled([0.1, 0.4, 0.7, 1, 1.3, 1.6, 1.9, 2.2, 2.5, 2.8, 3.125], { empty: true, reload: true }) } : {}),
}

await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, args: GPU_ARGS, channel: 'chrome' })
const context = await browser.newContext({ viewport, deviceScaleFactor: scale, isMobile: profile === 'phone', hasTouch: profile === 'phone' })
await context.addInitScript(() => {
  window.__captureReadyAt = null
  window.__capturePerf = null
  addEventListener('message', event => { if (event.origin === location.origin && event.data?.type === 'blacksite:perf') window.__capturePerf = event.data.value })
  const ready = () => { if (window.__blacksite?.ready) window.__captureReadyAt = performance.now(); else requestAnimationFrame(ready) }
  requestAnimationFrame(ready)
})
const page = await context.newPage()
const errors = []
const assets = []
const assetRequests = []
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', error => errors.push(String(error)))
page.on('response', response => {
  if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
  if (/\.glb(?:[?#]|$)/.test(response.url())) assetRequests.push(response.body().then(bytes => assets.push({ url: response.url(), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })))
})
page.on('requestfailed', request => errors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`))
const url = new URL(base)
url.searchParams.set('arms', rig)
url.searchParams.set('dpr', String(scale))
await page.goto(url.href)
await page.waitForFunction(() => window.__blacksite?.ready && window.__viewmodel?.presentation(), null, { timeout: 60000 })
await page.evaluate(maxStep => {
  window.__viewmodel.capture(true)
  window.__viewmodel.arms.timeScale = 0
  window.__blacksite.camera({ position: [0, 1.63, 0.4], target: [0, 1.5, -15] })
  document.querySelector('.hud-prompt')?.remove()
  window.__captureYaw = 0
  window.__advance = async (seconds, patch = {}, maximumStep = maxStep) => {
    const arms = window.__viewmodel.arms
    for (const key of ['weapon', 'aiming', 'speed', 'sprinting', 'empty']) if (key in patch) arms[key] = patch[key]
    if (patch.fire) arms.fireSequence++
    if (patch.reload) arms.reloadSequence++
    if (patch.inspect) arms.inspectSequence++
    if (patch.land) { arms.landSpeed = patch.land; arms.landSequence++ }
    const tick = () => new Promise(resolve => requestAnimationFrame(resolve))
    let remaining = seconds
    while (remaining > 1e-7) {
      const dt = Math.min(maximumStep, remaining)
      if (patch.yawRate) { window.__captureYaw += patch.yawRate * dt; window.__blacksite.camera({ position: [0, 1.63, 0.4], target: [Math.sin(window.__captureYaw) * 15, 1.5, 0.4 - Math.cos(window.__captureYaw) * 15] }) }
      arms.debug.advance = dt
      await tick()
      remaining -= dt
    }
    await tick()
    return structuredClone(arms.debug)
  }
}, maxStep)
const advance = (seconds, patch = {}) => page.evaluate(({ seconds, patch }) => window.__advance(seconds, patch), { seconds, patch })
const reset = async weapon => { await page.evaluate(() => { window.__captureYaw = 0; window.__blacksite.camera({ position: [0, 1.63, 0.4], target: [0, 1.5, -15] }) }); return page.evaluate(weapon => window.__advance(4.2, { weapon, aiming: false, speed: 0, sprinting: false, empty: false }, 0.1), weapon) }
const modelSnapshot = await page.evaluate(() => window.__viewmodel.model)
const report = []
const measurements = []
let stopRequested = false
process.once('SIGTERM', () => { stopRequested = true })
const persist = async complete => {
  const performanceSample = await page.evaluate(() => ({ firstPlayableMs: window.__captureReadyAt, render: window.__capturePerf }))
  await Promise.all(assetRequests)
  await writeFile(path.join(out, `report-${rig}-${profile}-${scale}x${batch ? `-${batch}` : ''}.json`), JSON.stringify({ capturedAt: new Date().toISOString(), complete, batch: batch || 'full', url: url.href, assets, performance: performanceSample, model: modelSnapshot, errors, measurements, report }, null, 2))
}
if (rig === 'blacksite' && (measureOnly || args.includes('--measure'))) {
  const model = await page.evaluate(() => window.__viewmodel.model)
  for (const weapon of ['rifle', 'pistol']) {
    await reset(weapon)
    const expected = model.weapons[weapon]
    let reached = null
    for (let index = 1; index <= Math.ceil((expected.aimSeconds + 0.05) * 120); index++) { const debug = await advance(1 / 120, { aiming: true }); if (reached === null && debug.aimAmount >= 0.999999) reached = index / 120 }
    measurements.push({ weapon, metric: 'ADS seconds', expected: expected.aimSeconds, actual: reached, pass: reached !== null && Math.abs(reached - expected.aimSeconds) <= 1 / 120 + 1e-6 })
    await advance(0.8, { aiming: false })
    let peak = 0, settled = 0
    for (let index = 1; index <= 72; index++) { const debug = await advance(1 / 120, index === 1 ? { fire: true } : {}); peak = Math.max(peak, Math.abs(debug.recoilOffset)); if (Math.abs(debug.recoilOffset) > expected.recoil.back * 0.05) settled = index / 120 }
    const damping = model.procedural.recoil.damping / 2
    const omega = Math.sqrt(model.procedural.recoil.stiffness - damping * damping)
    const peakTime = Math.atan(omega / damping) / omega
    const expectedPeak = expected.recoil.back * Math.sqrt(model.procedural.recoil.stiffness) * Math.E / omega * Math.exp(-damping * peakTime) * Math.sin(omega * peakTime)
    measurements.push({ weapon, metric: 'recoil peak metres', expected: expectedPeak, actual: peak, pass: Math.abs(peak - expectedPeak) < expectedPeak * 0.1 })
    measurements.push({ weapon, metric: 'recoil recovery to 5% seconds', expected: '<0.35', actual: settled + 1 / 120, pass: settled < 0.35 })
    for (const [speed, sprinting] of [[3.1, false], [5.2, true]]) {
      const before = await advance(0.5, { speed, sprinting })
      const after = await advance(1)
      const expectedHz = speed / (sprinting ? model.procedural.bob.sprintStride : model.procedural.bob.walkStride)
      const actual = (after.bobPhase - before.bobPhase) / Math.PI
      measurements.push({ weapon, metric: `${sprinting ? 'sprint' : 'walk'} bob steps per second`, expected: expectedHz, actual, pass: Math.abs(actual - expectedHz) < 0.001 })
    }
    await advance(1, { speed: 0, sprinting: false })
    const sway = await advance(0.6, { yawRate: 6 })
    measurements.push({ weapon, metric: 'sway cap radians', expected: model.procedural.sway.maxRotation, actual: Math.abs(sway.swayRotation), pass: Math.abs(sway.swayRotation) <= model.procedural.sway.maxRotation * 1.03 && Math.abs(sway.swayRotation) >= model.procedural.sway.maxRotation * 0.9 })
  }
}
capture: if (!measureOnly) for (const [name, build] of Object.entries(sequences)) {
  if (only.length && !only.includes(name)) continue
  if (rig === 'found' && ['equip', 'inspect', 'land'].includes(name)) continue
  for (const weapon of rig === 'found' ? ['pistol'] : ['rifle', 'pistol']) {
    if (weaponFilter.length && !weaponFilter.includes(weapon)) continue
    await reset(weapon)
    const dir = path.join(out, rig, `${profile}-${scale}x`, name, weapon)
    await mkdir(dir, { recursive: true })
    const shots = []
    let index = 0
    for (const [label, steps] of build(weapon)) {
      let debug
      for (const { seconds, patch } of steps) debug = await advance(seconds, patch)
      const file = path.join(dir, `${String(index++).padStart(2, '0')}-${label}.png`)
      await page.screenshot({ path: file, timeout: 90000 }).catch(async error => { await browser.close(); throw error })
      const entry = { sequence: name, weapon, label, file: path.relative(out, file), action: debug.action, time: debug.actionTime, aim: debug.aimAmount, handError: debug.handError, reach: debug.reach, recoil: debug.recoilOffset, sway: debug.swayRotation, offset: debug.weaponOffset, bones: debug.boneCount, viewmodelTriangles: debug.triangles }
      report.push(entry)
      shots.push(entry)
    }
    const width = profile === 'phone' ? 390 : 640
    const height = profile === 'phone' ? 520 : 400
    const columns = Math.min(4, shots.length)
    const tiles = []
    for (let i = 0; i < shots.length; i++) {
      const source = sharp(path.join(out, shots[i].file))
      const crop = profile === 'phone' ? { left: 0, top: Math.floor(viewport.height * 0.37 * scale), width: viewport.width * scale, height: Math.floor(viewport.height * 0.61 * scale) } : { left: Math.floor(viewport.width * 0.27 * scale), top: Math.floor(viewport.height * 0.38 * scale), width: Math.floor(viewport.width * 0.62 * scale), height: Math.floor(viewport.height * 0.6 * scale) }
      const picture = await source.extract(crop).resize(width, height - 28, { fit: 'contain', background: '#12140f' }).png().toBuffer()
      const label = Buffer.from(`<svg width="${width}" height="28"><rect width="100%" height="100%" fill="#12140f"/><text x="10" y="20" font-family="monospace" font-size="15" fill="#f0ecdb">${weapon} ${name} ${shots[i].label}</text></svg>`)
      const left = (i % columns) * width, top = Math.floor(i / columns) * height
      tiles.push({ input: picture, left, top: top + 28 }, { input: label, left, top })
    }
    const sheet = path.join(dir, 'contact-sheet.png')
    await sharp({ create: { width: columns * width, height: Math.ceil(shots.length / columns) * height, channels: 3, background: '#12140f' } }).composite(tiles).png().toFile(sheet)
    await persist(false)
    if (stopRequested) break capture
  }
}
await persist(!stopRequested)
console.log(JSON.stringify({ errors, measurements, shots: report.length, maxHandError: Math.max(...report.map(entry => entry.handError ?? 0)), maxReach: Math.max(...report.map(entry => entry.reach ?? 0)) }, null, 2))
await browser.close()
if (errors.length || measurements.some(entry => !entry.pass)) process.exitCode = 1
