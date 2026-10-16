import { createServer } from 'node:http'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

export const CHECKS = ['perf', 'hitch', 'pop', 'feel', 'critic', 'audio']

export const PROFILES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, cpu: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, cpu: 4 },
}

const DEFAULTS = { frameMs: 8.3, phoneFrameMs: 16.7, hitchMs: 33, firstPlayableMs: 5000, voices: 32 }

const GPU_ARGS = [
  '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--use-gl=angle',
  ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--autoplay-policy=no-user-gesture-required',
]

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.ktx2': 'image/ktx2', '.bin': 'application/octet-stream', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2' }

export async function serveDirectory(directory) {
  const root = path.resolve(directory)
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    let file = path.join(root, decodeURIComponent(url.pathname))
    if (!file.startsWith(root)) { response.writeHead(403).end(); return }
    try { if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html') } catch { file = path.join(root, 'index.html') }
    try {
      const body = await readFile(file)
      response.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' })
      response.end(body)
    } catch { response.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(resolve => server.close(resolve)) }
}

function probeScript() {
  const raf = window.requestAnimationFrame.bind(window)
  const state = { frames: [], busy: 0, readyAt: null, recording: true, longTasks: [], errors: [] }
  window.__check = state
  window.requestAnimationFrame = callback => raf(time => {
    const start = performance.now()
    try { callback(time) } finally { state.busy += performance.now() - start }
  })
  let last = null
  const loop = time => {
    if (last !== null && state.recording) state.frames.push([time, time - last, state.busy])
    state.busy = 0
    last = time
    if (state.readyAt === null && window.__blacksite?.ready) state.readyAt = performance.now()
    raf(loop)
  }
  raf(loop)
  try { new PerformanceObserver(list => { for (const entry of list.getEntries()) state.longTasks.push([entry.startTime, entry.duration]) }).observe({ type: 'longtask', buffered: true }) } catch {}
  addEventListener('error', event => state.errors.push(String(event.message)))
  addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)))
  state.frame = (count = 1) => new Promise(resolve => { let left = count; const step = () => (--left <= 0 ? resolve() : raf(step)); raf(step) })
  const lerp = (a, b, t) => a.map((value, index) => value + (b[index] - value) * t)
  state.fly = (poses, seconds) => new Promise(resolve => {
    const segments = Math.max(1, poses.length - 1)
    const start = performance.now()
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / (seconds * 1000))
      const at = Math.min(segments - 0.0001, t * segments)
      const index = Math.floor(at)
      const local = at - index
      const s = local * local * (3 - 2 * local)
      const a = poses[index]
      const b = poses[Math.min(poses.length - 1, index + 1)]
      window.__blacksite?.camera({ position: lerp(a.position, b.position, s), target: lerp(a.target, b.target, s), fov: a.fov !== undefined && b.fov !== undefined ? a.fov + (b.fov - a.fov) * s : a.fov })
      if (t >= 1) resolve()
      else raf(step)
    }
    raf(step)
  })
  state.track = seconds => new Promise(resolve => {
    const samples = []
    const start = performance.now()
    const step = () => {
      const now = performance.now()
      const player = window.__blacksite?.player?.()
      if (player) samples.push({ t: (now - start) / 1000, position: player.position })
      if (now - start >= seconds * 1000) resolve(samples)
      else raf(step)
    }
    raf(step)
  })
}

const HIDE_HUD = 'html.__bs-capture * { visibility: hidden !important; } html.__bs-capture canvas { visibility: visible !important; }'

function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p))]
}

const round = (value, digits = 2) => value === null || value === undefined ? null : Math.round(value * 10 ** digits) / 10 ** digits

function frameStats(frames) {
  const intervals = frames.map(frame => frame[1])
  const busy = frames.map(frame => frame[2])
  return {
    frames: frames.length,
    interval: { p50: round(percentile(intervals, 0.5)), p95: round(percentile(intervals, 0.95)), p99: round(percentile(intervals, 0.99)), max: round(Math.max(0, ...intervals)) },
    cpu: { p50: round(percentile(busy, 0.5)), p95: round(percentile(busy, 0.95)), p99: round(percentile(busy, 0.99)), max: round(Math.max(0, ...busy)) },
  }
}

async function diffImages(page, base, pairs) {
  await page.goto(`${base}_check.html`)
  const results = []
  for (const pair of pairs) results.push(await page.evaluate(async items => {
    const load = src => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src })
    const width = 320
    const pixels = async src => {
      const image = await load(src)
      const height = Math.round(width * image.height / image.width)
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0, width, height)
      return context.getImageData(0, 0, width, height).data
    }
    const [x, y] = await Promise.all(items.map(pixels))
    let changed = 0
    for (let index = 0; index < x.length; index += 4) {
      const delta = Math.max(Math.abs(x[index] - y[index]), Math.abs(x[index + 1] - y[index + 1]), Math.abs(x[index + 2] - y[index + 2]))
      if (delta > 32) changed++
    }
    return changed / (x.length / 4)
  }, pair))
  return results
}

async function contactSheet(page, base, out, tiles, file, { columns = 6, width = 360 } = {}) {
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111;font:12px ui-monospace,monospace;color:#eee"><div style="display:grid;grid-template-columns:repeat(${columns},${width}px);gap:4px;padding:4px">${tiles.map(tile => `<figure style="margin:0;position:relative;outline:${tile.flag ? '3px solid #ff3b30' : 'none'};outline-offset:-3px"><img src="${tile.src}" style="display:block;width:${width}px"><figcaption style="position:absolute;left:4px;top:4px;background:#000b;padding:1px 4px">${tile.label}</figcaption></figure>`).join('')}</div></body>`
  await writeFile(path.join(out, '_sheet.html'), html)
  await page.goto(`${base}_sheet.html`)
  await page.waitForFunction(() => [...document.images].every(image => image.complete))
  await page.screenshot({ path: path.join(out, file), fullPage: true, timeout: 180000 })
  await rm(path.join(out, '_sheet.html'), { force: true })
}

async function shoot(page, out, file, hud) {
  await mkdir(path.dirname(path.join(out, file)), { recursive: true })
  if (!hud) await page.evaluate(() => document.documentElement.classList.add('__bs-capture'))
  await page.screenshot({ path: path.join(out, file), type: file.endsWith('.jpg') ? 'jpeg' : 'png', ...(file.endsWith('.jpg') ? { quality: 88 } : {}), timeout: 180000 })
  if (!hud) await page.evaluate(() => document.documentElement.classList.remove('__bs-capture'))
  return file
}

async function setPose(page, pose, frames = 4) {
  await page.evaluate(async ([value, count]) => { window.__blacksite.camera(value); await window.__check.frame(count) }, [pose, frames])
}

function speeds(samples) {
  const result = []
  for (let index = 1; index < samples.length; index++) {
    const a = samples[index - 1]
    const b = samples[index]
    const dt = b.t - a.t
    if (dt > 0) result.push({ t: b.t, speed: Math.hypot(b.position[0] - a.position[0], b.position[2] - a.position[2]) / dt })
  }
  return result
}

function steady(series) {
  const end = series.length ? series[series.length - 1].t : 0
  return percentile(series.filter(item => item.t >= end - 1).map(item => item.speed), 0.5)
}

function within(measured, expected, tolerance) {
  if (expected === undefined || expected === null) return { measured: round(measured), expected: null, pass: measured !== null }
  return { measured: round(measured), expected, error: round(measured === null ? null : (measured - expected) / expected, 3), pass: measured !== null && Math.abs(measured - expected) <= expected * tolerance }
}

async function runFeel(page, contract) {
  const input = { move: 'KeyW', sprint: 'ShiftLeft', jump: 'Space', ...(contract.input ?? {}) }
  const feel = contract.model?.feel ?? {}
  const tolerance = feel.tolerance ?? 0.1
  await page.evaluate(() => window.__blacksite.camera(null))
  if (contract.scripts.includes('feelStart')) await page.evaluate(() => window.__blacksite.scripts.feelStart())
  await page.evaluate(() => window.__check.frame(30))
  const track = seconds => page.evaluate(value => window.__check.track(value), seconds)
  const moving = track(3)
  await page.keyboard.down(input.move)
  const move = speeds(await moving)
  await page.keyboard.down(input.sprint)
  const sprint = speeds(await track(3))
  await page.keyboard.up(input.sprint)
  await page.keyboard.up(input.move)
  await track(1.5)
  const jumping = track(1.6)
  await page.keyboard.down(input.jump)
  await page.waitForTimeout(120)
  await page.keyboard.up(input.jump)
  const jump = await jumping
  const moveSpeed = steady(move)
  const top = move.find(item => moveSpeed && item.speed >= moveSpeed * 0.9)
  const ground = jump.length ? jump[0].position[1] : null
  const apex = jump.length ? Math.max(...jump.map(item => item.position[1])) - ground : null
  const numbers = {
    moveSpeed: within(moveSpeed, feel.moveSpeed, tolerance),
    sprintSpeed: within(steady(sprint), feel.sprintSpeed, tolerance),
    timeToTopSpeed: within(top ? top.t : null, feel.timeToTopSpeed, Math.max(tolerance, 0.25)),
    jumpApex: within(apex, feel.jumpApex, tolerance),
  }
  return { pass: Object.values(numbers).every(item => item.pass), tolerance, numbers, samples: { move: move.length, sprint: sprint.length, jump: jump.length } }
}

export async function runChecks(options) {
  const only = options.only?.length ? options.only : CHECKS
  const profiles = options.profiles?.length ? options.profiles : ['desktop', 'phone']
  const out = path.resolve(options.out)
  const seconds = options.seconds ?? 12
  const grid = options.grid ?? 4
  const log = options.log ?? (() => {})
  await mkdir(out, { recursive: true })
  await writeFile(path.join(out, '_check.html'), '<!doctype html><title>check</title>')
  const files = await serveDirectory(out)
  let server = null
  let url = options.target
  if (!/^https?:\/\//.test(url) && existsSync(url)) { server = await serveDirectory(url); url = server.url + (options.page ?? '') }
  const browser = await chromium.launch({ headless: true, args: GPU_ARGS, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) })
  const report = { url, startedAt: new Date().toISOString(), checks: {}, profiles: {}, console: [] }
  const add = (name, profile, result) => { report.checks[name] ??= {}; report.checks[name][profile] = result }
  try {
    for (const name of profiles) {
      const profile = PROFILES[name]
      log(`${name}: loading ${url}`)
      const context = await browser.newContext({ viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor, isMobile: profile.isMobile, hasTouch: profile.hasTouch })
      await context.addInitScript(probeScript)
      await context.addInitScript(css => { addEventListener('DOMContentLoaded', () => { const style = document.createElement('style'); style.textContent = css; document.head.append(style) }) }, HIDE_HUD)
      const page = await context.newPage()
      const scratch = await context.newPage()
      await page.bringToFront()
      page.on('console', message => { if (message.type() === 'error' && !/the server responded with a status of 404/.test(message.text())) report.console.push({ profile: name, text: message.text().slice(0, 400) }) })
      page.on('pageerror', error => report.console.push({ profile: name, text: String(error).slice(0, 400) }))
      page.on('crash', () => report.console.push({ profile: name, text: 'page crashed' }))
      page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) report.console.push({ profile: name, text: `${response.status()} ${response.url()}` }) })
      if (profile.cpu > 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: profile.cpu })
      await page.goto(url, { waitUntil: 'load', timeout: 120000 })
      const hasContract = await page.waitForFunction(() => window.__blacksite?.ready === true, null, { timeout: 90000, polling: 50 }).then(() => true, () => false)
      const contract = hasContract ? await page.evaluate(() => { const c = window.__blacksite; return { version: c.version, bookmarks: c.bookmarks, scripts: Object.keys(c.scripts ?? {}), player: typeof c.player === 'function', audio: typeof c.audio === 'function', input: c.input ?? null, model: c.model ?? null } }) : null
      const budget = { ...DEFAULTS, ...(contract?.model?.budget ?? {}) }
      const readyAt = await page.evaluate(() => window.__check.readyAt)
      report.profiles[name] = { ...profile, contract: contract ? { bookmarks: contract.bookmarks.map(bookmark => bookmark.name), scripts: contract.scripts, player: contract.player, audio: contract.audio, model: contract.model } : null, firstPlayableMs: round(readyAt, 0) }
      log(`${name}: first playable ${round(readyAt, 0)} ms${contract ? '' : ' (no window.__blacksite contract, running timing only)'}`)

      const audioLog = { voices: [], plays: [] }
      let audioTimer = null
      const pollAudio = async () => {
        const sample = await page.evaluate(() => window.__blacksite?.audio?.() ?? null).catch(() => null)
        if (sample) { audioLog.voices.push(sample.voices); audioLog.plays.push(...(sample.plays ?? [])) }
      }
      if (contract?.audio) audioTimer = setInterval(pollAudio, 250)

      await page.evaluate(() => window.__check.frame(60))
      await page.evaluate(() => { window.__check.frames.length = 0 })
      if (only.includes('perf') || only.includes('hitch') || only.includes('audio')) {
        log(`${name}: scripted run`)
        if (contract?.scripts.includes('perf')) await page.evaluate(() => window.__blacksite.scripts.perf())
        else if (contract && contract.bookmarks.length > 1) await page.evaluate(([poses, s]) => window.__check.fly(poses, s), [contract.bookmarks, seconds])
        else await page.waitForTimeout(seconds * 1000)
        if (contract) await page.evaluate(() => window.__blacksite.camera(null))
        await page.waitForTimeout(1500)
      }
      const frames = await page.evaluate(() => window.__check.frames.slice())
      const stats = frameStats(frames)
      const frameBudget = name === 'phone' ? budget.phoneFrameMs : budget.frameMs
      const vsync = stats.interval.p50 ?? 16.7
      if (only.includes('perf')) add('perf', name, {
        pass: stats.cpu.p95 !== null && stats.cpu.p95 <= frameBudget && stats.interval.p95 <= vsync * 1.25,
        budgetMs: frameBudget, vsyncMs: vsync, ...stats,
        note: 'cpu is main-thread time inside requestAnimationFrame per frame; interval is the presented frame spacing, capped by vsync in headless Chrome',
      })
      if (only.includes('hitch')) {
        const hitches = frames.filter(frame => frame[1] > budget.hitchMs).map(frame => ({ atMs: round(frame[0] - (readyAt ?? 0), 0), ms: round(frame[1], 1) }))
        add('hitch', name, { pass: hitches.length === 0 && readyAt !== null && readyAt <= budget.firstPlayableMs, thresholdMs: budget.hitchMs, firstPlayableMs: round(readyAt, 0), firstPlayableBudgetMs: budget.firstPlayableMs, count: hitches.length, longestMs: stats.interval.max, hitches: hitches.slice(0, 40) })
      }

      if (only.includes('feel') && name === 'desktop') {
        if (!contract?.player) add('feel', name, { pass: false, skipped: 'the game exposes no player() in window.__blacksite' })
        else { log(`${name}: feel`); add('feel', name, await runFeel(page, contract)) }
      }

      if (only.includes('audio')) {
        if (audioTimer) { clearInterval(audioTimer); await pollAudio() }
        if (!contract?.audio) add('audio', name, { pass: false, skipped: 'the game exposes no audio() in window.__blacksite' })
        else {
          let repeats = 0
          const last = new Map()
          const counts = {}
          for (const play of audioLog.plays) {
            counts[play.cue] ??= new Set()
            counts[play.cue].add(play.sample)
            if (last.get(play.cue) === play.sample) repeats++
            last.set(play.cue, play.sample)
          }
          const maxVoices = Math.max(0, ...audioLog.voices)
          add('audio', name, { pass: maxVoices <= budget.voices && repeats === 0, voices: { max: maxVoices, p50: percentile(audioLog.voices, 0.5), budget: budget.voices }, plays: audioLog.plays.length, backToBackRepeats: repeats, variations: Object.fromEntries(Object.entries(counts).map(([cue, set]) => [cue, set.size])) })
        }
      }

      if (only.includes('pop') && name === 'desktop') {
        if (!contract || contract.bookmarks.length < 2) add('pop', name, { pass: false, skipped: 'needs at least two bookmarks in window.__blacksite' })
        else {
          log(`${name}: pop sheet`)
          const steps = options.popSteps ?? 10
          const tiles = []
          const lerp = (a, b, t) => a.map((value, index) => value + (b[index] - value) * t)
          const bookmarks = contract.bookmarks
          for (let index = 0; index < bookmarks.length - 1; index++) {
            for (let step = 0; step <= steps; step++) {
              if (index > 0 && step === 0) continue
              const t = step / steps
              const a = bookmarks[index]
              const b = bookmarks[index + 1]
              await setPose(page, { position: lerp(a.position, b.position, t), target: lerp(a.target, b.target, t), fov: a.fov }, 6)
              tiles.push({ label: `${a.name}→${b.name} ${step}/${steps}`, src: await shoot(page, out, `pop/move-${String(tiles.length).padStart(3, '0')}.jpg`, false) })
            }
          }
          const still = []
          for (const bookmark of bookmarks) {
            await setPose(page, bookmark, 30)
            const first = await shoot(page, out, `pop/still-${bookmark.name}-0.png`, false)
            await page.waitForTimeout(1000)
            const second = await shoot(page, out, `pop/still-${bookmark.name}-1.png`, false)
            still.push({ name: bookmark.name, first, second })
          }
          const moveDiffs = await diffImages(scratch, files.url, tiles.slice(1).map((tile, index) => [tiles[index].src, tile.src]))
          const stillDiffs = await diffImages(scratch, files.url, still.map(item => [item.first, item.second]))
          const flagged = []
          moveDiffs.forEach((value, index) => {
            const neighbours = moveDiffs.filter((_, other) => other !== index && Math.abs(other - index) <= 2)
            const expected = percentile(neighbours, 0.5) ?? 0
            tiles[index + 1].diff = value
            if (value > Math.max(expected * 2.5, expected + 0.08)) { tiles[index + 1].flag = true; flagged.push({ frame: tiles[index + 1].label, changed: round(value, 3), expected: round(expected, 3) }) }
          })
          const stillFlags = still.map((item, index) => ({ name: item.name, changed: round(stillDiffs[index], 4) })).filter(item => item.changed > (options.stillThreshold ?? 0.02))
          await contactSheet(scratch, files.url, out, tiles.map(tile => ({ ...tile, label: `${tile.label}${tile.diff !== undefined ? ` Δ${(tile.diff * 100).toFixed(1)}%` : ''}` })), 'pop-sheet.png')
          await contactSheet(scratch, files.url, out, still.flatMap(item => [{ src: item.first, label: `${item.name} t=0` }, { src: item.second, label: `${item.name} t=1s`, flag: stillFlags.some(flag => flag.name === item.name) }]), 'pop-still.png', { columns: 4 })
          add('pop', name, { pass: flagged.length === 0 && stillFlags.length === 0, frames: tiles.length, flagged, still: stillFlags, files: ['pop-sheet.png', 'pop-still.png'], method: 'fraction of pixels (320 px wide, channel delta > 32) changed between frames; a moving frame is flagged above 2.5x its neighbours, a still camera above 2% in one second' })
        }
      }

      if (only.includes('critic')) {
        log(`${name}: critic captures`)
        const captured = []
        const bookmarks = contract?.bookmarks.length ? contract.bookmarks : [null]
        for (const bookmark of bookmarks) {
          const label = bookmark?.name ?? 'play'
          if (bookmark) await setPose(page, bookmark, 40)
          else await page.waitForTimeout(1000)
          await page.waitForTimeout(400)
          captured.push(await shoot(page, out, `critic/${name}-${label}.png`, true))
          if (bookmark && name === 'desktop' && grid > 1) {
            const tiles = []
            for (let row = 0; row < grid; row++) for (let column = 0; column < grid; column++) {
              await setPose(page, { ...bookmark, view: { x: column / grid, y: row / grid, scale: grid } }, 4)
              tiles.push({ src: await shoot(page, out, `critic/${label}-${grid}x/r${row}c${column}.png`, false), label: `${label} ${grid}x r${row}c${column}` })
            }
            const sheet = `critic/${name}-${label}-${grid}x.png`
            await contactSheet(scratch, files.url, out, tiles, sheet, { columns: grid, width: Math.round(profile.viewport.width / 2) })
            captured.push(sheet)
          }
        }
        if (contract) await page.evaluate(() => window.__blacksite.camera(null))
        const errors = report.console.filter(item => item.profile === name)
        add('critic', name, { pass: errors.length === 0, captures: captured.length, files: captured, consoleErrors: errors.length, read: 'open every PNG at 1x and the grid sheets zoomed in; the check only proves they were captured with no console errors' })
      }
      clearInterval(audioTimer)
      await context.close()
    }
  } finally {
    await browser.close()
    await server?.close()
    await files.close()
    await rm(path.join(out, '_check.html'), { force: true })
  }
  report.finishedAt = new Date().toISOString()
  report.pass = Object.values(report.checks).every(byProfile => Object.values(byProfile).every(result => result.pass || result.skipped))
  await writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  return report
}

export function summarize(report) {
  const lines = []
  for (const [check, byProfile] of Object.entries(report.checks)) for (const [profile, result] of Object.entries(byProfile)) {
    const status = result.skipped ? 'skip' : result.pass ? 'pass' : 'FAIL'
    let detail = result.skipped ?? ''
    if (check === 'perf') detail = `cpu p50 ${result.cpu.p50} p95 ${result.cpu.p95} p99 ${result.cpu.p99} max ${result.cpu.max} ms (budget ${result.budgetMs}); interval p95 ${result.interval.p95} max ${result.interval.max} ms`
    if (check === 'hitch') detail = `${result.count} frames over ${result.thresholdMs} ms, longest ${result.longestMs} ms; first playable ${result.firstPlayableMs} ms (budget ${result.firstPlayableBudgetMs})`
    if (check === 'feel' && !result.skipped) detail = Object.entries(result.numbers).map(([key, value]) => `${key} ${value.measured}${value.expected !== null ? `/${value.expected}` : ''}`).join(', ')
    if (check === 'audio' && !result.skipped) detail = `voices max ${result.voices.max}/${result.voices.budget}, ${result.plays} plays, ${result.backToBackRepeats} back-to-back repeats`
    if (check === 'pop' && !result.skipped) detail = `${result.flagged.length} moving frames and ${result.still.length} still views flagged of ${result.frames}`
    if (check === 'critic') detail = `${result.captures} captures, ${result.consoleErrors} console errors`
    lines.push(`${status.padEnd(4)}  ${check.padEnd(6)} ${profile.padEnd(7)} ${detail}`)
  }
  lines.push(report.pass ? 'checks passed' : 'checks failed')
  return lines.join('\n')
}
