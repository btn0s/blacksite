import { execFileSync } from 'node:child_process'
import { mkdirSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const probeRoot = 'D:/dev/probe'
export const lockPath = join(probeRoot, 'bench.lock')
export const minimumFreeMiB = 3072

export class Contended extends Error {}

function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

export async function acquireLock(worktree) {
  mkdirSync(probeRoot, { recursive: true })
  const holder = { pid: process.pid, worktree, startedAt: new Date().toISOString() }
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

export function releaseLock(lock) {
  try {
    const current = JSON.parse(readFileSync(lockPath, 'utf8'))
    if (current.pid === lock.pid && current.worktree === lock.worktree) unlinkSync(lockPath)
  } catch {}
}

export function assertFreeGpuMemory(what) {
  const gpuMemory = execFileSync('nvidia-smi', ['--query-gpu=memory.free', '--format=csv'], { encoding: 'utf8', windowsHide: true })
  const freeMiB = gpuMemory.trim().split(/\r?\n/).slice(1).map(line => Number.parseInt(line, 10))
  if (!freeMiB.length || freeMiB.some(value => !Number.isFinite(value) || value < minimumFreeMiB)) throw new Contended(`${what} requires at least 3 GiB free GPU memory:\n${gpuMemory.trim()}`)
  console.log(gpuMemory.trim())
}
