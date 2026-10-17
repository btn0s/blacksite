import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react'
import type { CharacterHandle } from './character/state'

export type LocalClock = ReturnType<typeof createLocalClock>

export function createLocalClock(wall: () => number = () => performance.now()) {
  let stoppedAt: number | null = null
  let stoppedFor = 0
  return {
    now: () => (stoppedAt ?? wall()) - stoppedFor,
    running: () => stoppedAt === null,
    setRunning(running: boolean) {
      if (running && stoppedAt !== null) { stoppedFor += wall() - stoppedAt; stoppedAt = null }
      else if (!running && stoppedAt === null) stoppedAt = wall()
    },
  }
}

export function useLocalSession(controller: CharacterHandle) {
  const clock = useMemo(() => createLocalClock(), [])
  const paused = useSyncExternalStore(controller.subscribe, () => controller.status().paused)
  useLayoutEffect(() => clock.setRunning(!paused), [clock, paused])
  return { frameloop: paused ? 'never' as const : 'always' as const, now: clock.now, paused }
}
