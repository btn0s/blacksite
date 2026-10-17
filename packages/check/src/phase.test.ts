import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SLACK, planned, within } from './phase.mjs'
import { takeTimingSlot } from './slot.mjs'

describe('within', () => {
  afterEach(() => { vi.useRealTimers() })

  it('rejects a phase that runs past its slack and names it', async () => {
    vi.useFakeTimers()
    const late = within('phone scripted run', 10, new Promise(() => {}))
    const caught = late.catch((error: Error & { late?: boolean }) => error)
    await vi.advanceTimersByTimeAsync(10 * SLACK * 1000)
    const error = await caught
    expect((error as { late?: boolean }).late).toBe(true)
    expect((error as Error).message).toBe(`phone scripted run did not finish within ${10 * SLACK} s (${SLACK}x the 10 s it should take)`)
  })

  it('passes the result and the error of a phase through', async () => {
    await expect(within('load', 1, Promise.resolve(7))).resolves.toBe(7)
    await expect(within('load', 1, Promise.reject(new Error('stuck before waypoint 33')))).rejects.toThrow('stuck before waypoint 33')
  })

  it('derives expected seconds from frames, screenshots and declared scripts', () => {
    const plan = planned({ hitchMs: 33 }, 0.5, { model: { scripts: { perf: 75 } } }, 12)
    expect(plan.frames(60)).toBeCloseTo(1.98)
    expect(plan.shot(4)).toBe(2)
    expect(plan.script('perf')).toBe(75)
    expect(plan.script('edge')).toBe(12)
  })
})

describe('takeTimingSlot', () => {
  let root = ''
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  const holders = async () => Promise.all((await readdir(path.join(root, 'holders'))).map(async name => JSON.parse(await readFile(path.join(root, 'holders', name), 'utf8')).label))

  it('queues a second timed run until the first releases, and says who is timing', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'slot-'))
    const lines: string[] = []
    const first = await takeTimingSlot({ label: 'first', seconds: 60, log: () => {}, root })
    let second: Awaited<ReturnType<typeof takeTimingSlot>> | null = null
    const waiting = takeTimingSlot({ label: 'second', seconds: 60, log: line => lines.push(line), root }).then(slot => { second = slot })
    await pause(600)
    expect(second).toBeNull()
    expect(lines[0]).toMatch(/^waiting for the timing slot, timing now: first \(pid \d+, \d+ s so far\)$/)
    await first.release()
    await waiting
    expect(await holders()).toEqual(['second'])
    await second!.release()
  })

  it('lets other checks render together, but not beside a timed run or ahead of one waiting', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'slot-'))
    const critic = await takeTimingSlot({ label: 'critic', seconds: 60, shared: true, log: () => {}, root })
    const zfight = await takeTimingSlot({ label: 'zfight', seconds: 60, shared: true, log: () => {}, root })
    const order: string[] = []
    const perf = takeTimingSlot({ label: 'perf', seconds: 60, log: () => {}, root }).then(slot => { order.push('perf'); return slot })
    await pause(100)
    const stress = takeTimingSlot({ label: 'stress', seconds: 60, shared: true, log: () => {}, root }).then(slot => { order.push('stress'); return slot })
    await pause(600)
    expect(order).toEqual([])
    await critic.release()
    await zfight.release()
    const timed = await perf
    await pause(600)
    expect(order).toEqual(['perf'])
    await timed.release()
    await (await stress).release()
    expect(order).toEqual(['perf', 'stress'])
  })

  it('clears a holder whose process is gone or which is past its own limit', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'slot-'))
    await takeTimingSlot({ label: 'setup', seconds: 1, log: () => {}, root }).then(slot => slot.release())
    for (const holder of [{ pid: 2 ** 22 + 12345, label: 'gone', shared: false, since: Date.now(), until: Date.now() + 60000 }, { pid: process.pid, label: 'overdue', shared: false, since: Date.now() - 9000, until: Date.now() - 1 }]) {
      await writeFile(path.join(root, 'holders', `000000000000000-${holder.label}.json`), JSON.stringify(holder))
      const slot = await takeTimingSlot({ label: 'next', seconds: 1, log: () => {}, root })
      expect(await holders()).toEqual(['next'])
      await slot.release()
    }
  })
})
