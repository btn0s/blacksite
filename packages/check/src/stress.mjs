const STALL_MS = 2500
const REFRESH_HZ = 144
const STEP_MS = 30000

export async function runStress({ page, scratch, contract, profile, name, log }) {
  const input = { move: 'KeyW', sprint: 'ShiftLeft', jump: 'Space', ...(contract?.input ?? {}) }
  const first = () => page.evaluate(() => window.__check.first ?? null)
  const wait = ms => page.waitForTimeout(ms)
  const { width, height } = profile.viewport
  const release = async () => { for (const key of [input.move, input.sprint]) await page.keyboard.up(key) }
  const steps = [
    ['pointer', async () => {
      for (let index = 0; index < 6; index++) {
        await page.mouse.click(width / 2, height / 2)
        await wait(150 + (index * 97) % 300)
        await page.evaluate(() => document.exitPointerLock())
        await wait(150 + (index * 61) % 300)
      }
    }],
    ['restart', input.restart && (async () => {
      await page.mouse.click(width / 2, height / 2)
      for (let index = 0; index < 6; index++) {
        await page.keyboard.down(input.move)
        if (index % 2) await page.keyboard.down(input.sprint)
        await wait(150 + (index * 233) % 700)
        if (index % 3 === 0) await page.keyboard.press(input.jump)
        await page.keyboard.press(input.restart)
        await wait(index % 3 === 0 ? 16 : 120 + (index * 191) % 500)
        await release()
      }
      await wait(1000)
    })],
    ['hidden', async () => {
      await scratch.bringToFront()
      await scratch.waitForTimeout(2000)
      await page.bringToFront()
      await wait(800)
    }],
    ['stall', async () => {
      await page.keyboard.down(input.move)
      await page.keyboard.down(input.sprint)
      await page.evaluate(ms => { const end = performance.now() + ms; while (performance.now() < end) {} }, STALL_MS)
      await wait(1200)
      await release()
    }],
    ['fullscreen', async () => {
      await page.evaluate(() => document.documentElement.requestFullscreen?.().catch(() => {}))
      for (const size of [{ width: 1920, height: 1080 }, { width: height, height: width }, profile.viewport]) {
        await page.setViewportSize(size)
        await wait(400)
      }
      await page.evaluate(() => document.fullscreenElement ? document.exitFullscreen().catch(() => {}) : null)
      await wait(400)
    }],
    ['edge', contract?.scripts.includes('edge') && (() => page.evaluate(() => window.__blacksite.scripts.edge()))],
  ]
  const ran = []
  const absent = steps.filter(([, body]) => !body).map(([step]) => step)
  const before = await first()
  if (before) return { pass: false, steps: ran, absent, during: 'before stress', firstError: before }
  await wait(1000)
  await page.evaluate(hz => { window.__check.hz = hz }, REFRESH_HZ)
  try {
    for (const [step, body] of steps) {
      if (!body) continue
      log(`${name}: stress ${step}`)
      let timer
      const outcome = await Promise.race([body().then(() => null, error => ({ message: String(error?.message ?? error), stack: String(error?.stack ?? '') })), new Promise(resolve => { timer = setTimeout(() => resolve({ message: `${step} did not finish within ${STEP_MS / 1000} s`, stack: '' }), STEP_MS) })])
      clearTimeout(timer)
      await release().catch(() => {})
      const error = await first().catch(() => null) ?? outcome
      ran.push(step)
      if (error) return { pass: false, refreshHz: REFRESH_HZ, steps: ran, absent, during: step, firstError: error }
    }
  } finally {
    await page.evaluate(() => { window.__check.hz = null }).catch(() => {})
  }
  return { pass: true, refreshHz: REFRESH_HZ, steps: ran, absent, stallMs: STALL_MS }
}
