import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { PROFILES, serveDirectory } from '@blacksite/check/runner'

const require = createRequire(import.meta.resolve('@blacksite/check/runner'))
const { chromium } = require('playwright-core')
const { values } = parseArgs({ options: { url: { type: 'string' }, out: { type: 'string', default: '/tmp/traverse-contact-check' }, checks: { type: 'string' }, profile: { type: 'string', default: 'desktop' } } })
const profile = PROFILES[values.profile]
if (!profile) throw new Error(`unknown profile ${values.profile}`)
const server = values.url ? null : await serveDirectory(resolve(import.meta.dirname, '../dist'))
const url = values.url ?? server.url
const out = resolve(values.out)
await mkdir(out, { recursive: true })
const report = { url, profile: values.profile, startedAt: new Date().toISOString(), uptime: execFileSync('uptime', { encoding: 'utf8' }).trim(), results: [], errors: [], pass: false }
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--use-gl=angle', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required'] })
try {
  const context = await browser.newContext(profile)
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()) })
  if (profile.cpu > 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: profile.cpu })
  await page.goto(url)
  await page.waitForFunction(() => window.__blacksite?.ready && window.__traverse?.ready, null, { timeout: 120000 })
  const names = values.checks?.split(',') ?? await page.evaluate(() => window.__traverse.checks)
  for (const name of names) {
    const result = await page.evaluate(name => window.__traverse.run(name), name).catch(error => ({ name, pass: false, metrics: {}, limits: {}, notes: [error.message] }))
    report.results.push(result)
    const recording = await page.evaluate(() => window.__traverse.recording())
    if (recording) await writeFile(resolve(out, `${name}-contacts.json`), JSON.stringify(recording))
    await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2))
    process.stdout.write(`${result.pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(result.metrics)} ${result.notes.join('; ')}\n`)
  }
  report.pass = report.results.length > 0 && report.results.every(result => result.pass) && report.errors.length === 0
} finally {
  report.finishedAt = new Date().toISOString()
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
  await server?.close()
}
process.exitCode = report.pass ? 0 : 1
