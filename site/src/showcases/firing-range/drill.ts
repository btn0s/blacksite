import { useSyncExternalStore } from 'react'

export type DrillView = {
  phase: 'ready' | 'running' | 'done'
  time: number
  best: number | null
  score: number
  shots: number
  hits: number
  cleared: boolean[]
  weapon: 'rifle' | 'pistol'
  magazine: number
  capacity: number
  reloading: boolean
  aiming: boolean
  marker: number
  locked: boolean
}

let view: DrillView = {
  phase: 'ready', time: 0, best: null, score: 0, shots: 0, hits: 0, cleared: [], weapon: 'rifle',
  magazine: 30, capacity: 30, reloading: false, aiming: false, marker: 0, locked: false,
}
const listeners = new Set<() => void>()

export const drill = {
  get: () => view,
  set(patch: Partial<DrillView>) {
    let changed = false
    for (const key of Object.keys(patch) as (keyof DrillView)[]) if (view[key] !== patch[key]) { changed = true; break }
    if (!changed) return
    view = { ...view, ...patch }
    for (const listener of listeners) listener()
  },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
}

export const useDrill = () => useSyncExternalStore(drill.subscribe, drill.get)

export const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`
