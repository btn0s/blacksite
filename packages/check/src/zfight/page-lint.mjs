import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'
import { GPU_ARGS, PROFILES, serveDirectory } from '../runner.mjs'
import { pageScript } from './page-script.mjs'
import { installHook } from './hook.mjs'

export async function lintPage({ target, page: pagePath, profile = 'desktop', options = {}, log = () => {} }) {
  let server = null
  let url = target
  if (!/^https?:\/\//.test(url) && existsSync(url)) { server = await serveDirectory(url); url = server.url + (pagePath ?? '') }
  const browser = await chromium.launch({ headless: true, args: GPU_ARGS, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) })
  try {
    const settings = PROFILES[profile]
    const context = await browser.newContext({ viewport: settings.viewport, deviceScaleFactor: 1, isMobile: settings.isMobile, hasTouch: settings.hasTouch })
    await context.addInitScript(installHook)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(String(error).slice(0, 300)))
    log(`loading ${url}`)
    await page.goto(url, { waitUntil: 'load', timeout: 120000 })
    const ready = await page.waitForFunction(() => window.__blacksite?.ready === true || (window.__bsHook && window.__bsHook.renders.size > 0 && window.__bsHook.frame > 120), null, { timeout: 90000, polling: 100 }).then(() => true, () => false)
    if (!ready) throw new Error(`${url} never rendered a three.js scene${errors.length ? `: ${errors[0]}` : ''}`)
    await page.waitForTimeout(options.settleMs ?? 1500)
    await page.addScriptTag({ content: pageScript() })
    const report = await page.evaluate(settings => window.__bsZ.lint(settings), { ...options.lint, viewport: settings.viewport })
    return { ...report, url, errors }
  } finally {
    await browser.close()
    await server?.close()
  }
}
