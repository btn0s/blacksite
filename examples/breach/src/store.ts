import { useSyncExternalStore } from 'react'

export type Subtitle = { id: number; speaker: string; text: string; until: number }
export type Damage = { id: number; angle: number; until: number }
export type Phase = 'play' | 'dead' | 'exfil'

export type View = {
  phase: Phase
  health: number
  weapon: 'rifle' | 'pistol'
  magazine: number
  capacity: number
  reserve: number
  reloading: boolean
  aiming: boolean
  spread: number
  marker: number
  markerKind: 'hit' | 'head' | 'kill'
  objective: string
  cleared: boolean[]
  exfil: boolean
  subtitles: Subtitle[]
  damage: Damage[]
  locked: boolean
  time: number
  shots: number
  hits: number
  kills: number
  restartIn: number
}

const initial: View = {
  phase: 'play', health: 100, weapon: 'rifle', magazine: 30, capacity: 30, reserve: 150, reloading: false, aiming: false, spread: 1,
  marker: 0, markerKind: 'hit', objective: 'Breach the works', cleared: [false, false, false], exfil: false, subtitles: [], damage: [], locked: false,
  time: 0, shots: 0, hits: 0, kills: 0, restartIn: 0,
}

let view = initial
const listeners = new Set<() => void>()

export const hud = {
  get: () => view,
  set(patch: Partial<View>) {
    let changed = false
    for (const key in patch) if (patch[key as keyof View] !== view[key as keyof View]) { changed = true; break }
    if (!changed) return
    view = { ...view, ...patch }
    for (const listener of listeners) listener()
  },
  reset(patch: Partial<View> = {}) { view = { ...initial, locked: view.locked, ...patch }; for (const listener of listeners) listener() },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
}

export const useHud = () => useSyncExternalStore(hud.subscribe, hud.get, hud.get)
