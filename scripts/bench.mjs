import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'file:///D:/dev/wall/examples/wall/node_modules/playwright/index.mjs'
import { views as defaultViews } from './bench-views.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const probeRoot = 'D:/dev/probe'
const benchRoot = join(probeRoot, 'bench')
const baselineDir = join(benchRoot, 'baseline')
const lockPath = join(probeRoot, 'bench.lock')
const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const viewUrls = Object.fromEntries(defaultViews.map(view => [view, view === 'spawn' ? '/' : `/?view=${view}`]))
const settleMs = 20000
const captureMs = 10000

function ensureNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major > 22 || major === 22 && minor >= 12) return
  const volta = process.env.VOLTA_HOME ?? join(process.env.LOCALAPPDATA ?? '', 'Volta')
  const images = join(volta, 'tools', 'image', 'node')
  const available = existsSync(images) ? readdirSync(images).filter(version => /^\d+\.\d+\.\d+$/.test(version)).map(version => version.split('.').map(Number)).filter(([vMajor, vMinor]) => vMajor > 22 || vMajor === 22 && vMinor >= 12).sort((left, right) => right[0] - left[0] || right[1] - left[1] || right[2] - left[2]) : []
  const selected = available[0]
  if (!selected) throw new Error(`Node.js ${process.versions.node} is too old; Node.js 22.12 or newer is required and no compatible Volta runtime is already installed.`)
  const executable = join(images, selected.join('.'), 'node.exe')
  const result = spawnSync(executable, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit', env: process.env })
  process.exit(result.status ?? 1)
}

function options() {
  const result = { views: defaultViews, dev: false, url: null, compare: null, compareEnabled: false, output: join(benchRoot, 'run') }
  for (let index = 2; index < process.argv.length; index++) {
    const arg = process.argv[index]
    if (arg === '--dev') result.dev = true
    else if (arg === '--url') result.url = new URL(process.argv[++index]).href
    else if (arg === '--views') result.views = (process.argv[++index] ?? '').split(',').filter(Boolean)
    else if (arg === '--compare') {
      result.compareEnabled = true
      result.compare = process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? resolve(process.argv[++index]) : baselineDir
    } else if (arg === '--output') result.output = resolve(process.argv[++index] ?? '')
    else throw new Error(`Unknown option: ${arg}`)
  }
  if (!result.views.length || result.views.some(view => !viewUrls[view])) throw new Error(`Views must be selected from: ${Object.keys(viewUrls).join(', ')}`)
  return result
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

async function acquireLock() {
  mkdirSync(probeRoot, { recursive: true })
  const holder = { pid: process.pid, worktree: root, startedAt: new Date().toISOString() }
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx')
      writeFileSync(fd, JSON.stringify(holder, null, 2))
      closeSync(fd)
      return holder
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      let current
      try { current = JSON.parse(readFileSync(lockPath, 'utf8')) } catch { current = null }
      if (current?.pid && !isAlive(Number(current.pid))) {
        try { unlinkSync(lockPath); console.log(`Cleared stale GPU lock from ${current.worktree ?? 'unknown worktree'} (pid ${current.pid}).`); continue } catch (removeError) { if (removeError.code !== 'ENOENT') throw removeError }
      }
      const label = current ? `${current.worktree ?? 'unknown worktree'} (pid ${current.pid ?? 'unknown'})` : 'an unreadable lock holder'
      console.log(`Waiting for the machine GPU lock held by ${label}.`)
      await new Promise(resolvePromise => setTimeout(resolvePromise, 2000))
    }
  }
}

function git(...args) {
  return execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, ...args], { encoding: 'utf8' }).trim()
}

function assertClean() {
  const changes = git('status', '--porcelain', '--untracked-files=normal').split(/\r?\n/).filter(Boolean)
  if (changes.length) throw new Error(`Benchmark requires a committed, clean worktree:\n${changes.join('\n')}`)
}

async function freePort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolvePromise))
  const port = server.address().port
  await new Promise((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()))
  return port
}

function launch(args, env) {
  const child = spawn(process.execPath, [vite, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let output = ''
  child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; process.stdout.write(chunk) })
  child.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; process.stderr.write(chunk) })
  child.output = () => output
  return child
}

async function waitForServer(child, url) {
  const start = Date.now()
  while (Date.now() - start < 60000) {
    if (child.exitCode !== null) throw new Error(`Vite exited before becoming ready:\n${child.output()}`)
    try { const response = await fetch(url); if (response.ok) return } catch {}
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
  }
  throw new Error(`Vite did not become ready at ${url}:\n${child.output()}`)
}

async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill()
  await Promise.race([new Promise(resolvePromise => child.once('exit', resolvePromise)), new Promise(resolvePromise => setTimeout(resolvePromise, 5000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

function instrument() {
  window.__benchEvents = []
  window.__benchTelemetry = []
  window.__benchCapture = false
  window.__benchPipelines = 0
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href)
    if (url.pathname === '/__inspect/telemetry' && init?.method === 'POST') {
      window.__benchTelemetry.push(JSON.parse(init.body))
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    return nativeFetch(input, init)
  }
  const record = (kind, bytes = 0) => {
    if (window.__benchCapture) window.__benchEvents.push({ at: performance.now() - window.__benchCaptureStart, kind, bytes })
  }
  for (const name of ['createRenderPipeline', 'createRenderPipelineAsync', 'createComputePipeline', 'createComputePipelineAsync']) {
    const original = GPUDevice.prototype[name]
    GPUDevice.prototype[name] = function (...args) {
      window.__benchPipelines++
      record('pipeline-create')
      return original.apply(this, args)
    }
  }
  const writeBuffer = GPUQueue.prototype.writeBuffer
  GPUQueue.prototype.writeBuffer = function (buffer, offset, data, ...args) {
    const bytes = ArrayBuffer.isView(data) ? data.byteLength : data?.byteLength ?? 0
    if (bytes >= 64 * 1024) record('buffer-upload', bytes)
    return writeBuffer.call(this, buffer, offset, data, ...args)
  }
  const writeTexture = GPUQueue.prototype.writeTexture
  GPUQueue.prototype.writeTexture = function (target, data, ...args) {
    record('texture-upload', ArrayBuffer.isView(data) ? data.byteLength : data?.byteLength ?? 0)
    return writeTexture.call(this, target, data, ...args)
  }
}

function resident(summary) {
  const content = summary.content ?? {}
  const textures = content.textureStreaming ?? {}
  const paging = content.geometryPaging ?? {}
  return {
    geometryOccupiedBytes: paging.occupiedSlotBytes ?? null,
    geometryArenaBytes: paging.arenaBytes ?? content.residentGeometryBytes ?? null,
    textureBytes: textures.residentBytes ?? null,
    ledgerPeakBytes: textures.ledger?.peakBytes ?? content.regionalCollision?.cpu?.peakBytes ?? null,
  }
}

async function runView(page, baseUrl, view, outputDir, identity) {
  const url = new URL(viewUrls[view], baseUrl).href
  const started = performance.now()
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction(() => Boolean(document.querySelector('[role="alert"]')) || (!document.querySelector('.hud-loading') && window.__sceneInspect), undefined, { timeout: 240000 })
  const alert = page.locator('[role="alert"]')
  if (await alert.count()) throw new Error(`${view} failed to load: ${await alert.innerText()}`)
  const firstPlayableMs = performance.now() - started
  const startup = await page.evaluate(() => ({
    marks: performance.getEntriesByType('mark').map(({ name, startTime }) => ({ name, startTime })),
    measures: performance.getEntriesByType('measure').map(({ name, startTime, duration }) => ({ name, startTime, duration })),
  }))
  await page.evaluate(() => { window.__benchReadyPipelines = window.__benchPipelines })
  if (view === 'spawn') await page.locator('canvas').click({ position: { x: 960, y: 540 } })
  await page.waitForTimeout(settleMs)
  const dump = async () => {
    const count = await page.evaluate(() => window.__benchTelemetry.length)
    await page.keyboard.press('t')
    await page.waitForFunction(previous => window.__benchTelemetry.length > previous, count, { timeout: 10000 })
    return page.evaluate(() => window.__benchTelemetry.at(-1))
  }
  const before = await dump()
  const screenshotPath = join(outputDir, `${view}.png`)
  await page.screenshot({ path: screenshotPath })
  await page.evaluate(() => { window.__benchEvents.length = 0; window.__benchCapture = true; window.__benchCaptureStart = performance.now(); window.__benchPipelineStart = window.__benchPipelines })
  if (view === 'spawn') await page.keyboard.down('w')
  const captureStarted = new Date().toISOString()
  await page.waitForTimeout(captureMs)
  await page.evaluate(() => { window.__benchCapture = false })
  if (view === 'spawn') await page.keyboard.up('w')
  const after = await dump()
  const telemetry = after
  const capture = telemetry.history
  const texture = telemetry.content?.textureStreaming ?? {}
  const beforeTexture = before.content?.textureStreaming ?? {}
  const pageStats = telemetry.content?.geometryPaging ?? {}
  const beforePageStats = before.content?.geometryPaging ?? {}
  const result = {
    ...identity,
    view,
    url,
    capturedAt: captureStarted,
    firstPlayableMs,
    startup,
    settleMs,
    captureMs,
    samples: capture?.frames?.samples ?? 0,
    cpuMs: capture?.cpu ?? telemetry.stats?.cpu ?? null,
    gpuMs: capture?.gpu ?? telemetry.stats?.gpu ?? null,
    draws: telemetry.submissions?.drawCalls ?? telemetry.stats?.drawCalls ?? null,
    trianglesDrawn: telemetry.content?.drawnTriangles ?? telemetry.stats?.drawnTriangles ?? null,
    trianglesSelected: telemetry.content?.sceneTriangles ?? telemetry.stats?.sceneTriangles ?? null,
    sourceTriangles: telemetry.content?.sourceTriangles ?? null,
    resident: resident(telemetry),
    pipelinesCreatedAfterReady: await page.evaluate(() => window.__benchPipelines - window.__benchReadyPipelines),
    texturePromotions: texture.promotions === undefined ? null : texture.promotions - (beforeTexture.promotions ?? 0),
    textureUploadBytes: texture.uploadBytes === undefined ? null : texture.uploadBytes - (beforeTexture.uploadBytes ?? 0),
    geometryPageUploadBytes: pageStats.uploadBytes === undefined ? null : pageStats.uploadBytes - (beforePageStats.uploadBytes ?? 0),
    consoleErrors: page.__benchErrors,
    telemetry,
    events: await page.evaluate(() => window.__benchEvents),
  }
  result.frameLog = {
    gpuP95AtMs: result.gpuMs?.p95 ?? null,
    pipelineCreates: result.events.filter(event => event.kind === 'pipeline-create').length,
    bufferUploadEvents: result.events.filter(event => event.kind === 'buffer-upload').length,
    bufferUploadBytes: result.events.filter(event => event.kind === 'buffer-upload').reduce((sum, event) => sum + event.bytes, 0),
    textureUploadEvents: result.events.filter(event => event.kind === 'texture-upload').length,
    textureUploadBytes: result.events.filter(event => event.kind === 'texture-upload').reduce((sum, event) => sum + event.bytes, 0),
  }
  const frameTimes = capture?.frameTimesMs ?? []
  const gpuTimes = capture?.gpuTimesMs ?? []
  if (frameTimes.length && frameTimes.length === gpuTimes.length) {
    const offsets = []
    let offset = -frameTimes.reduce((sum, value) => sum + value, 0)
    for (let index = 0; index < frameTimes.length; index++) {
      offset += frameTimes[index]
      offsets.push(offset)
    }
    result.frameLog.spikes = gpuTimes.map((gpuMs, index) => ({ gpuMs, atMs: captureMs + offsets[index] })).sort((a, b) => b.gpuMs - a.gpuMs).slice(0, 10).map(spike => ({ ...spike, eventsWithin100Ms: result.events.filter(event => Math.abs(event.at - spike.atMs) <= 100) }))
  }
  writeFileSync(join(outputDir, `${view}.json`), JSON.stringify(result, null, 2))
  if (result.consoleErrors.length) throw new Error(`${view} emitted ${result.consoleErrors.length} console error(s): ${result.consoleErrors.join('\n')}`)
  return result
}

function fmt(value, digits = 2) { return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(digits) }

function table(results, compareResults = null) {
  const rows = results.map(result => {
    const old = compareResults?.find(entry => entry.view === result.view)
    const delta = (field, part) => old ? ` (${fmt(result[field]?.[part] - old[field]?.[part], 2)})` : ''
    return [result.view, fmt(result.firstPlayableMs / 1000), `${fmt(result.cpuMs?.p50)} / ${fmt(result.cpuMs?.p95)}${delta('cpuMs', 'p95')}`, `${fmt(result.gpuMs?.p50)} / ${fmt(result.gpuMs?.p95)}${delta('gpuMs', 'p95')}`, fmt(result.gpuMs?.max), result.draws ?? '—', `${result.trianglesDrawn ?? '—'} / ${result.trianglesSelected ?? '—'}`, fmt(result.resident.geometryOccupiedBytes / 1048576), fmt(result.resident.geometryArenaBytes / 1048576), fmt(result.resident.textureBytes / 1048576), fmt(result.resident.ledgerPeakBytes / 1048576), result.pipelinesCreatedAfterReady]
  })
  console.log('\nView             Ready(s) CPU p50/p95 ms      GPU p50/p95 ms      GPU max Draws Triangles drawn/selected Occupied MiB Arena MiB Tex MiB Ledger peak MiB Pipelines+')
  for (const row of rows) console.log(`${row[0].padEnd(16)} ${row[1].padStart(8)} ${row[2].padEnd(20)} ${row[3].padEnd(20)} ${row[4].padStart(7)} ${String(row[5]).padStart(5)} ${String(row[6]).padStart(25)} ${row[7].padStart(11)} ${row[8].padStart(9)} ${row[9].padStart(7)} ${row[10].padStart(15)} ${String(row[11]).padStart(10)}`)
  if (compareResults) console.log('Parenthesized values are p95 deltas against --compare.')
}

const config = options()
ensureNodeVersion()
let lock
let server
let browser
try {
  lock = await acquireLock()
  assertClean()
  if (!existsSync(vite)) throw new Error('Vite is unavailable. Link the existing node_modules; do not install dependencies.')
  const branch = git('branch', '--show-current')
  const sha = git('rev-parse', 'HEAD')
  const outputDir = config.output
  const buildDir = join(outputDir, 'build')
  mkdirSync(outputDir, { recursive: true })
  const identity = { branch, sha, worktree: root, dev: config.dev }
  const env = { ...process.env, BLACKSITE_OWNED_ASSETS: join(root, 'owned-assets') }
  if (!config.dev && !config.url) {
    const build = spawn(process.execPath, [vite, 'build', '--config', 'examples/archway/vite.config.ts', '--outDir', buildDir, '--emptyOutDir'], { cwd: root, env, stdio: 'inherit', windowsHide: true })
    const status = await new Promise((resolvePromise, reject) => { build.once('error', reject); build.once('exit', (code, signal) => resolvePromise({ code, signal })) })
    if (status.code !== 0) throw new Error(`Production build failed (${status.signal ?? status.code}).`)
  }
  let baseUrl = config.url
  if (!baseUrl) {
    const port = await freePort()
    const args = config.dev
      ? ['--config', 'examples/archway/vite.config.ts', '--host', '127.0.0.1', '--port', String(port), '--strictPort']
      : ['preview', '--config', 'examples/archway/vite.config.ts', '--outDir', buildDir, '--host', '127.0.0.1', '--port', String(port), '--strictPort']
    server = launch(args, env)
    baseUrl = `http://127.0.0.1:${port}`
    await waitForServer(server, baseUrl)
  }
  const gpuMemory = execFileSync('nvidia-smi', ['--query-gpu=memory.free', '--format=csv'], { encoding: 'utf8', windowsHide: true })
  const freeMiB = gpuMemory.trim().split(/\r?\n/).slice(1).map(line => Number.parseInt(line, 10))
  if (!freeMiB.length || freeMiB.some(value => !Number.isFinite(value) || value < 3072)) throw new Error(`Benchmark requires at least 3 GiB free GPU memory:\n${gpuMemory.trim()}`)
  console.log(gpuMemory.trim())
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] })
  const results = []
  for (const view of config.views) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
    page.__benchErrors = []
    page.on('pageerror', error => page.__benchErrors.push(error.stack ?? String(error)))
    page.on('console', message => { if (message.type() === 'error') page.__benchErrors.push(message.text()) })
    await page.addInitScript(instrument)
    results.push(await runView(page, baseUrl, view, outputDir, identity))
    await page.close()
  }
  let compareResults = null
  if (config.compareEnabled) compareResults = results.map(result => {
    const priorPath = join(config.compare, `${result.view}.json`)
    if (!existsSync(priorPath)) throw new Error(`Missing comparison result: ${priorPath}`)
    return JSON.parse(readFileSync(priorPath, 'utf8'))
  })
  table(results, compareResults)
  console.log(`\nResults: ${outputDir}`)
} finally {
  await browser?.close().catch(() => {})
  await stop(server)
  if (lock) {
    try {
      const current = JSON.parse(readFileSync(lockPath, 'utf8'))
      if (current.pid === lock.pid && current.worktree === lock.worktree) unlinkSync(lockPath)
    } catch {}
  }
}
