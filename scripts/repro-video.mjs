import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'file:///D:/dev/wall/examples/wall/node_modules/playwright/index.mjs'
import { Contended, acquireLock, assertFreeGpuMemory, releaseLock } from './gpu-lock.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const width = 1920
const height = 1080
const second = 1000

function options() {
  const result = { url: 'http://127.0.0.1:5247/', output: 'D:/dev/probe/repro', sha: null }
  for (let index = 2; index < process.argv.length; index++) {
    const arg = process.argv[index]
    if (arg === '--url') result.url = new URL(process.argv[++index]).href
    else if (arg === '--output') result.output = resolve(process.argv[++index] ?? '')
    else if (arg === '--sha') result.sha = process.argv[++index]
    else throw new Error(`Unknown option: ${arg}\nUsage: node scripts/repro-video.mjs [--url http://127.0.0.1:5247/] [--output D:/dev/probe/repro] [--sha <label>]`)
  }
  result.sha ??= execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  return result
}

function stamp() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function instrument() {
  window.__repro = { telemetry: [] }
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href)
    if (url.pathname === '/__inspect/telemetry' && init?.method === 'POST') {
      window.__repro.telemetry.push(JSON.parse(init.body))
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    return nativeFetch(input, init)
  }
}

class Recorder {
  constructor(cdp, videoPath) {
    this.cdp = cdp
    this.origin = null
    this.latest = null
    this.waiting = []
    this.frames = 0
    this.encoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-use_wallclock_as_timestamps', '1', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-vf', 'setpts=PTS-STARTPTS,format=yuv420p', '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-movflags', '+faststart', videoPath], { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true })
    this.closed = new Promise(resolvePromise => this.encoder.once('close', resolvePromise))
    this.encoder.stdin.on('error', () => {})
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      const png = Buffer.from(data, 'base64')
      const at = performance.now()
      this.origin ??= at
      this.frames++
      this.latest = { png, at }
      this.encoder.stdin.write(png)
      for (const resolveFrame of this.waiting.splice(0)) resolveFrame(this.latest)
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    })
  }

  start() { return this.cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: width, maxHeight: height }) }
  time() { return this.origin === null ? 0 : (performance.now() - this.origin) / second }
  next() { return new Promise(resolveFrame => this.waiting.push(resolveFrame)) }

  async stop() {
    await this.cdp.send('Page.stopScreencast').catch(() => {})
    this.encoder.stdin.end()
    await this.closed
  }
}

async function main() {
  const config = options()
  const label = `${config.sha}-${stamp()}`
  const outputDir = join(config.output, label)
  const framesDir = join(outputDir, 'frames')
  const telemetryDir = join(outputDir, 'telemetry')
  mkdirSync(framesDir, { recursive: true })
  mkdirSync(telemetryDir, { recursive: true })
  const lock = await acquireLock(root)
  let browser
  let recorder
  const timeline = { sha: config.sha, url: config.url, startedAt: new Date().toISOString(), video: 'video.mp4', clock: 'seconds from the first video frame', viewport: { width, height, deviceScaleFactor: 1 }, phases: [], consoleErrors: [] }
  const finish = () => writeFileSync(join(outputDir, 'timeline.json'), JSON.stringify(timeline, null, 2))
  try {
    assertFreeGpuMemory('The repro recording')
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] })
    timeline.browser = browser.version()
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
    page.on('pageerror', error => timeline.consoleErrors.push(error.stack ?? String(error)))
    page.on('console', message => { if (message.type() === 'error') timeline.consoleErrors.push(message.text()) })
    await page.addInitScript(instrument)
    recorder = new Recorder(await page.context().newCDPSession(page), join(outputDir, 'video.mp4'))
    await recorder.start()

    let telemetryCount = 0
    const dump = async name => {
      await page.keyboard.press('t')
      try {
        await page.waitForFunction(count => window.__repro.telemetry.length > count, telemetryCount, { timeout: 20000, polling: 100 })
      } catch {
        timeline.consoleErrors.push(`No telemetry arrived after pressing T for ${name}`)
        return null
      }
      const snapshot = await page.evaluate(count => window.__repro.telemetry[count], telemetryCount)
      telemetryCount++
      const file = `${name}.json`
      writeFileSync(join(telemetryDir, file), JSON.stringify(snapshot, null, 2))
      return { file: `telemetry/${file}`, yaw: snapshot.player?.yaw ?? null, pitch: snapshot.player?.pitch ?? null }
    }
    const png = (name, frame = recorder.latest) => {
      if (!frame) return null
      writeFileSync(join(framesDir, `${name}.png`), frame.png)
      return `frames/${name}.png`
    }

    const sweep = (pixels, ms) => page.evaluate(([total, duration]) => new Promise(resolvePromise => {
      const start = performance.now()
      let sent = 0
      const step = () => {
        const progress = Math.min(1, (performance.now() - start) / duration)
        const movementX = Math.round(total * progress) - sent
        if (movementX) document.dispatchEvent(new PointerEvent('pointermove', { movementX, movementY: 0, bubbles: true }))
        sent += movementX
        if (progress < 1) setTimeout(step, 8)
        else resolvePromise()
      }
      step()
    }), [pixels, ms])

    await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    const loading = { name: '1-load', description: 'Load and wait for first playable.', startSec: recorder.time() }
    timeline.phases.push(loading)
    await page.waitForFunction(() => Boolean(document.querySelector('[role="alert"]')) || (!document.querySelector('.hud-loading') && window.__sceneInspect), undefined, { timeout: 240000 })
    const alert = page.locator('[role="alert"]')
    if (await alert.count()) throw new Error(`The level failed to load: ${await alert.innerText()}`)
    await page.waitForTimeout(2 * second)
    await page.locator('canvas').click({ position: { x: width / 2, y: height / 2 } })
    await page.waitForTimeout(second)
    loading.firstPlayableSec = recorder.time()
    loading.pointerLocked = await page.evaluate(() => document.pointerLockElement !== null)

    const calibrationA = await dump('00-calibration-before')
    await sweep(300, 600)
    await page.waitForTimeout(500)
    const calibrationB = await dump('00-calibration-after')
    await sweep(-300, 600)
    await page.waitForTimeout(500)
    const radiansPerPixel = calibrationA?.yaw != null && calibrationB?.yaw != null ? (calibrationB.yaw - calibrationA.yaw) / 300 : NaN
    timeline.lookCalibration = { radiansPerPixel, before: calibrationA, after: calibrationB }
    if (!Number.isFinite(radiansPerPixel) || Math.abs(radiansPerPixel) < 1e-6) timeline.consoleErrors.push('The mouse did not turn the camera; the look phases are static.')
    const pixelsFor = degrees => Math.round((degrees * Math.PI / 180) / (Math.abs(radiansPerPixel) || 1))
    const direction = Math.sign(radiansPerPixel) || 1

    const phase = async (name, description, run) => {
      const entry = { name, description, startSec: recorder.time() }
      timeline.phases.push(entry)
      entry.startTelemetry = await dump(`${name}-start`)
      entry.startFrame = png(`${name}-start`)
      const frames = []
      entry.frames = frames
      await run({
        snapshot: tag => { const file = png(`${name}-${tag}`); if (file) frames.push(file) },
        burst: async (tag, count) => {
          for (let index = 0; index < count; index++) {
            const frame = await recorder.next()
            const file = png(`${name}-${tag}-${String(index).padStart(2, '0')}`, frame)
            if (file) frames.push(file)
          }
        },
      })
      entry.endFrame = png(`${name}-end`)
      entry.endTelemetry = await dump(`${name}-end`)
      entry.endSec = recorder.time()
    }
    const hold = async (ms, capture) => {
      await page.waitForTimeout(ms / 2)
      capture.snapshot('mid')
      await capture.burst('burst', 4)
      await page.waitForTimeout(ms / 2)
    }

    loading.endSec = recorder.time()
    await phase('2-stand-forward', 'Stand at spawn looking straight ahead for 15 s.', capture => hold(15 * second, capture))
    await phase('3-look-around', 'Turn through a full circle slowly (30 s, 12 degrees per second).', async capture => {
      const segment = 6
      for (let index = 0; index < segment; index++) {
        await sweep(direction * pixelsFor(360 / segment), 30 * second / segment)
        capture.snapshot(`quarter-${index + 1}`)
      }
    })
    await phase('4-fixed-direction', 'Turn 90 degrees right, then look in that one direction for 15 s.', async capture => {
      await sweep(direction * pixelsFor(90), 1.5 * second)
      await hold(15 * second, capture)
    })
    await phase('5-pan', 'Pan slowly right through 120 degrees over 30 s, then pan back over 30 s.', async capture => {
      await sweep(direction * pixelsFor(120), 30 * second)
      capture.snapshot('turnaround')
      await sweep(-direction * pixelsFor(120), 30 * second)
    })
    await phase('6-pause', 'Pause with Escape, wait 8 s, unpause with Resume.', async capture => {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(second)
      const resume = page.getByRole('button', { name: 'Resume' })
      timeline.pauseMenuShown = await resume.count() > 0
      await page.waitForTimeout(7 * second)
      capture.snapshot('paused')
      if (timeline.pauseMenuShown) await resume.click()
      else await page.keyboard.press('Escape')
      await page.waitForTimeout(2 * second)
      capture.snapshot('unpaused')
      await capture.burst('after-unpause', 4)
    })
    await phase('7-stand-still', 'Stand still again for 10 s.', capture => hold(10 * second, capture))
    timeline.endedAt = new Date().toISOString()
  } catch (error) {
    if (error instanceof Contended) { console.error(`Deferred: ${error.message}`); process.exitCode = 75 }
    else { timeline.failure = error.stack ?? String(error); console.error(error); process.exitCode = 1 }
  } finally {
    if (recorder) { timeline.videoFrames = recorder.frames; await recorder.stop().catch(() => {}) }
    await browser?.close().catch(() => {})
    releaseLock(lock)
    finish()
    console.log(`Repro: ${outputDir}`)
  }
}

await main()
