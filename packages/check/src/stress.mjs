import { within } from './phase.mjs'

const STALL_MS = 2500
const REFRESH_HZ = 144
const ROUNDS = 6
const SIZES = 3
const EDGE_INSET = 14
const CORNERS = [[1, 1], [-1, 1], [-1, -1], [1, -1]]
const HOPS = 4
const HOP_MS = 400
const SETTLE_MS = 600

const pointerWaits = index => [150 + (index * 97) % 300, 150 + (index * 61) % 300]
const restartWaits = index => [150 + (index * 233) % 700, index % 3 === 0 ? 16 : 120 + (index * 191) % 500]
const sum = values => values.reduce((total, value) => total + value, 0)
const rounds = waits => sum(Array.from({ length: ROUNDS }, (_, index) => sum(waits(index)))) / 1000

function plan(contract) {
  return [
    ['pointer', true, rounds(pointerWaits)],
    ['restart', !!contract?.character, rounds(restartWaits) + 1],
    ['hidden', true, 2.8],
    ['stall', true, STALL_MS / 1000 + 1.2],
    ['fullscreen', true, (SIZES + 1) * 0.4],
    ['edge', !!contract?.character, (CORNERS.length * (HOPS * HOP_MS + SETTLE_MS) + SETTLE_MS) / 1000],
  ]
}

export const stressSeconds = contract => 1 + sum(plan(contract).filter(([, present]) => present).map(([, , seconds]) => seconds))

export async function runStress({ page, scratch, contract, profile, name, log }) {
  const input = { move: 'KeyW', sprint: 'ShiftLeft', jump: 'Space', ...(contract?.input ?? {}) }
  const first = () => page.evaluate(() => window.__check.first ?? null)
  const wait = ms => page.waitForTimeout(ms)
  const { width, height } = profile.viewport
  const release = async () => { for (const key of [input.move, input.sprint]) await page.keyboard.up(key) }
  const bodies = {
    async pointer() {
      for (let index = 0; index < ROUNDS; index++) {
        const [locked, unlocked] = pointerWaits(index)
        await page.mouse.click(width / 2, height / 2)
        await wait(locked)
        await page.evaluate(() => document.exitPointerLock())
        await wait(unlocked)
      }
    },
    async restart() {
      await page.mouse.click(width / 2, height / 2)
      for (let index = 0; index < ROUNDS; index++) {
        const [moving, after] = restartWaits(index)
        await page.keyboard.down(input.move)
        if (index % 2) await page.keyboard.down(input.sprint)
        await wait(moving)
        if (index % 3 === 0) await page.keyboard.press(input.jump)
        await page.evaluate(() => window.__blacksite.character.respawn())
        await wait(after)
        await release()
      }
      await wait(1000)
    },
    async hidden() {
      await scratch.bringToFront()
      await scratch.waitForTimeout(2000)
      await page.bringToFront()
      await wait(800)
    },
    async stall() {
      await page.keyboard.down(input.move)
      await page.keyboard.down(input.sprint)
      await page.evaluate(ms => { const end = performance.now() + ms; while (performance.now() < end) {} }, STALL_MS)
      await wait(1200)
      await release()
    },
    async fullscreen() {
      await page.evaluate(() => document.documentElement.requestFullscreen?.().catch(() => {}))
      for (const size of [{ width: 1920, height: 1080 }, { width: height, height: width }, profile.viewport].slice(0, SIZES)) {
        await page.setViewportSize(size)
        await wait(400)
      }
      await page.evaluate(() => document.fullscreenElement ? document.exitFullscreen().catch(() => {}) : null)
      await wait(400)
    },
    async edge() {
      const bounds = await page.evaluate(() => window.__blacksite.character.bounds())
      if (!bounds) throw new Error('the character reports no world bounds')
      const [minX, , minZ] = bounds.min
      const [maxX, , maxZ] = bounds.max
      const inset = Math.min(EDGE_INSET, (maxX - minX) / 4, (maxZ - minZ) / 4)
      for (const [sx, sz] of CORNERS) {
        const x = sx > 0 ? maxX - inset : minX + inset
        const z = sz > 0 ? maxZ - inset : minZ + inset
        await page.evaluate(([x, z, ax, az]) => {
          const character = window.__blacksite.character
          character.respawn({ x, z })
          character.face({ x: ax, y: 0, z: az })
          character.move({ forward: 1, sprint: true })
        }, [x, z, x + sx * 1000, z + sz * 1000])
        for (let hop = 0; hop < HOPS; hop++) {
          await wait(HOP_MS)
          await page.evaluate(() => window.__blacksite.character.move({ forward: 1, sprint: true, jump: true }))
        }
        await wait(SETTLE_MS)
      }
      await page.evaluate(() => { const character = window.__blacksite.character; character.move(null); character.respawn() })
      await wait(SETTLE_MS)
    },
  }
  const steps = plan(contract)
  const ran = []
  const absent = steps.filter(([, present]) => !present).map(([step]) => step)
  const before = await first()
  if (before) return { pass: false, steps: ran, absent, during: 'before stress', firstError: before }
  await wait(1000)
  await page.evaluate(hz => { window.__check.hz = hz }, REFRESH_HZ)
  try {
    for (const [step, present, seconds] of steps) {
      if (!present) continue
      log(`${name}: stress ${step}`)
      const outcome = await within(`stress ${step}`, seconds, bodies[step]()).then(() => null, error => ({ message: String(error?.message ?? error), stack: String(error?.stack ?? '') }))
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
