import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { GPU_ARGS, serveDirectory } from '@blacksite/check/runner'

const require = createRequire(import.meta.resolve('@blacksite/check/runner'))
const { chromium } = require('playwright-core')
const { values } = parseArgs({ options: { site: { type: 'string', default: resolve(import.meta.dirname, '../../../dist/site') }, out: { type: 'string', default: '/tmp/breach-pad-check' }, layout: { type: 'string', default: 'xbox' } } })
const out = resolve(values.out)
await mkdir(out, { recursive: true })
const server = await serveDirectory(values.site)

function stub(id) {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }))
  const axes = [0, 0, 0, 0]
  const pad = { id, index: 0, connected: true, mapping: 'standard', timestamp: 0, axes, buttons, vibrationActuator: { effects: ['dual-rumble', 'trigger-rumble'], playEffect: async () => 'complete', reset: async () => 'complete' } }
  window.__pad = { pad, rumbles: 0, press(index, down) { buttons[index].pressed = down; buttons[index].value = down ? 1 : 0; pad.timestamp = performance.now() }, axis(index, value) { axes[index] = value; pad.timestamp = performance.now() } }
  pad.vibrationActuator.playEffect = async () => { window.__pad.rumbles++; return 'complete' }
  Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] })
}

const padId = values.layout === 'playstation' ? 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)' : 'Xbox 360 Controller (XInput STANDARD GAMEPAD)'
const results = []
const record = (name, pass, detail = {}) => { results.push({ name, pass, detail }); process.stdout.write(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}\n`) }
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: GPU_ARGS })
const errors = []
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await context.addInitScript(stub, padId)
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(`[page] ${error.message}`))
  page.on('console', message => { if (message.type() === 'error') errors.push(`[console] ${message.text().slice(0, 400)}`) })
  await page.goto(`${server.url}tools/characters/`, { waitUntil: 'load' })
  const poster = page.locator('.stage-poster').first()
  await poster.scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  await page.screenshot({ path: resolve(out, '01-poster.png') })
  await page.evaluate(() => window.__pad.press(0, true))
  await page.waitForTimeout(120)
  await page.evaluate(() => window.__pad.press(0, false))
  record('site: a pad press starts a demo from its poster', await page.waitForSelector('.stage iframe', { timeout: 5000 }).then(() => true, () => false))
  await page.goto(`${server.url}tools/weapons/`, { waitUntil: 'load' })
  const started = await page.waitForSelector('iframe[src*="frames/breach.html"]', { timeout: 15000 }).then(() => true, () => false)
  if (!started) throw new Error('Breach did not start')
  const stage = page.locator('iframe[src*="frames/breach.html"]')
  await stage.scrollIntoViewIfNeeded()
  const frame = await (await page.$('iframe[src*="frames/breach.html"]')).contentFrame()
  await frame.waitForFunction(() => window.__blacksite?.ready === true, null, { timeout: 120000, polling: 100 })
  await frame.waitForSelector('.breach-hud', { timeout: 30000 })
  await page.waitForTimeout(1500)

  const pad = (fn, ...args) => frame.evaluate(([fn, args]) => window.__pad[fn](...args), [fn, args])
  const tap = async (index, ms = 90) => { await pad('press', index, true); await page.waitForTimeout(ms); await pad('press', index, false); await page.waitForTimeout(80) }
  const state = () => frame.evaluate(() => {
    const player = window.__blacksite.player()
    const view = window.__blacksite.view()
    const [x, y, z, w] = view.quaternion
    const yaw = Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x)) * 180 / Math.PI
    const ammo = document.querySelector('.breach-ammo strong')?.firstChild?.textContent ?? ''
    return { x: +player.position[0].toFixed(2), z: +player.position[2].toFixed(2), yaw: +yaw.toFixed(1), fov: +view.fov.toFixed(1), magazine: Number(ammo), aiming: !!document.querySelector('.breach-reticle--aim'), reloading: (document.querySelector('.breach-ammo span')?.textContent ?? '').includes('reloading'), rumbles: window.__pad.rumbles }
  })
  const hints = () => frame.evaluate(() => [...document.querySelectorAll('.hud-hints kbd')].map(node => node.textContent))
  const menu = () => frame.evaluate(() => ({ open: !!document.querySelector('.hud-menu'), items: [...document.querySelectorAll('.hud-menu button')].map(node => node.textContent), selected: document.querySelector('.hud-menu [data-console-selected]')?.textContent ?? null }))

  const keyboard = await hints()
  await stage.screenshot({ path: resolve(out, '02-keyboard-glyphs.png') })
  const start = await state()
  await pad('axis', 1, -1)
  await page.waitForTimeout(1000)
  await pad('axis', 1, 0)
  const moved = await state()
  record('move: the left stick walks the player', Math.hypot(moved.x - start.x, moved.z - start.z) > 1, { from: [start.x, start.z], to: [moved.x, moved.z] })
  const glyphs = await hints()
  await stage.screenshot({ path: resolve(out, '03-pad-glyphs.png') })
  const expected = values.layout === 'playstation' ? 'R2' : 'RT'
  record('glyphs: hints switch to pad glyphs', glyphs.includes(expected) && glyphs.join() !== keyboard.join(), { keyboard, glyphs })

  await pad('axis', 2, 1)
  await page.waitForTimeout(500)
  await pad('axis', 2, 0)
  const turned = await state()
  const turn = Math.abs(((turned.yaw - moved.yaw + 540) % 360) - 180)
  record('look: the right stick turns the view', turn > 20, { from: moved.yaw, to: turned.yaw })

  await pad('press', 6, true)
  await page.waitForTimeout(450)
  const aimed = await state()
  await stage.screenshot({ path: resolve(out, '04-ads.png') })
  await pad('press', 7, true)
  await page.waitForTimeout(400)
  await pad('press', 7, false)
  await pad('press', 6, false)
  await page.waitForTimeout(200)
  const fired = await state()
  record('ads: LT aims down sights', aimed.aiming && aimed.fov < turned.fov, { hip: turned.fov, aim: aimed.fov })
  record('fire: RT fires and rumbles', fired.magazine < turned.magazine && fired.rumbles > turned.rumbles, { before: turned.magazine, after: fired.magazine, rumbles: fired.rumbles })
  await tap(2)
  await page.waitForTimeout(300)
  const reloading = await state()
  await page.waitForTimeout(3200)
  const reloaded = await state()
  record('reload: X reloads the magazine', reloading.reloading && reloaded.magazine > fired.magazine, { during: reloading.reloading, after: reloaded.magazine })

  await pad('axis', 1, -1)
  await page.waitForTimeout(400)
  await tap(9)
  await page.waitForTimeout(300)
  const paused = await menu()
  await stage.screenshot({ path: resolve(out, '05-pause.png') })
  const frozen0 = await state()
  await page.waitForTimeout(600)
  const frozen1 = await state()
  await pad('axis', 1, 0)
  await page.waitForTimeout(100)
  record('pause: Start opens the menu with Resume selected', paused.open && paused.selected === 'Resume', paused)
  record('pause: the local world stops under the menu', frozen0.x === frozen1.x && frozen0.z === frozen1.z && (await menu()).selected === 'Resume', { a: [frozen0.x, frozen0.z], b: [frozen1.x, frozen1.z] })
  await tap(13)
  await page.waitForTimeout(150)
  const down = await menu()
  await tap(12)
  await page.waitForTimeout(150)
  const up = await menu()
  record('pause: the D-pad moves the selection', down.selected === 'Restart' && up.selected === 'Resume', { down: down.selected, up: up.selected })
  await tap(0)
  await page.waitForTimeout(300)
  const closed = !(await menu()).open
  await pad('axis', 1, -1)
  await page.waitForTimeout(700)
  await pad('axis', 1, 0)
  const resumed = await state()
  record('pause: A on Resume closes the menu and play continues', closed && Math.hypot(resumed.x - frozen1.x, resumed.z - frozen1.z) > 0.5, { closed })
  await tap(9)
  await page.waitForTimeout(300)
  await tap(1)
  await page.waitForTimeout(300)
  record('pause: B closes the menu', !(await menu()).open)
} catch (error) {
  record('run', false, { error: String(error?.message ?? error) })
} finally {
  record('console: no errors', errors.length === 0, { errors: errors.slice(0, 5) })
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ layout: values.layout, results, errors }, null, 2))
  await browser.close()
  server.close?.()
}
process.exit(results.every(result => result.pass) ? 0 : 1)
