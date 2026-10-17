import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import os from 'node:os'
import path from 'node:path'
import { SLACK } from './phase.mjs'

const ROOT = path.join(os.tmpdir(), 'blacksite-check-timing')
const POLL_MS = 250

const alive = pid => { try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' } }
const read = file => readFile(file, 'utf8').then(JSON.parse, () => null)
const describe = holder => `${holder.label} (pid ${holder.pid}, ${Math.round((Date.now() - holder.since) / 1000)} s so far)`

async function entries(directory, keep) {
  const found = []
  for (const name of (await readdir(directory)).sort()) {
    const file = path.join(directory, name)
    const entry = await read(file)
    if (entry && keep(entry)) found.push({ ...entry, file })
    else if (entry) await rm(file, { force: true })
  }
  return found
}

export async function takeTimingSlot({ label, seconds, log, shared = false, root = ROOT }) {
  const queueDir = path.join(root, 'queue')
  const holdersDir = path.join(root, 'holders')
  await mkdir(queueDir, { recursive: true })
  await mkdir(holdersDir, { recursive: true })
  const name = `${String(Date.now()).padStart(15, '0')}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.json`
  const ticket = path.join(queueDir, name)
  const holderFile = path.join(holdersDir, name)
  await writeFile(ticket, JSON.stringify({ pid: process.pid, label, shared }))
  const began = Date.now()
  let shown = ''
  try {
    for (;;) {
      const queue = await entries(queueDir, entry => alive(entry.pid))
      const ahead = queue.slice(0, queue.findIndex(entry => entry.file === ticket))
      const holders = await entries(holdersDir, entry => alive(entry.pid) && Date.now() <= entry.until)
      const timing = holders.find(holder => !holder.shared)
      if (shared ? !timing && ahead.every(entry => entry.shared) : !holders.length && !ahead.length) {
        const since = Date.now()
        const hold = { pid: process.pid, label, shared, since, until: since + seconds * SLACK * 1000 }
        await writeFile(holderFile, JSON.stringify(hold))
        return {
          waitedSeconds: Math.round((since - began) / 100) / 10,
          async hold(more) { await writeFile(holderFile, JSON.stringify({ ...hold, until: Date.now() + more * SLACK * 1000 })) },
          async release() { await rm(holderFile, { force: true }) },
        }
      }
      const next = ahead.find(entry => !entry.shared)
      const status = timing ? `timing now: ${describe(timing)}` : next ? `next to time: ${next.label}` : `${holders.length} other checks rendering, the oldest ${describe(holders[0])}`
      const key = `${timing?.since ?? next?.file ?? holders.length}-${ahead.length}`
      if (key !== shown) { log(`waiting for the timing slot, ${status}${ahead.length ? `; ${ahead.length} ahead of us` : ''}`); shown = key }
      await sleep(POLL_MS)
    }
  } finally {
    await rm(ticket, { force: true })
  }
}
