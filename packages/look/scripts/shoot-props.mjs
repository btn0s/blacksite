import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const { chromium } = createRequire(path.resolve(root, '../check/package.json'))('playwright-core')
const out = path.resolve(process.argv[2] ?? path.join(tmpdir(), 'look-props.png'))

const server = await createServer({ root: path.join(root, 'preview'), configFile: false, logLevel: 'error', server: { port: 0, fs: { allow: [path.resolve(root, '../..')] } } })
await server.listen()
const url = server.resolvedUrls.local[0]
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] })
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  page.on('pageerror', error => process.stderr.write(`${error.message}\n`))
  await page.goto(`${url}props.html`)
  await page.waitForFunction(() => document.title.startsWith('ready'), undefined, { timeout: 120000 })
  await page.screenshot({ path: out })
  process.stdout.write(`${await page.title()}\n${out}\n`)
} finally {
  await browser.close()
  await server.close()
}
