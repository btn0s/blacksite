import { useRef, useSyncExternalStore } from 'react'
import { PLAYER, WEAPONS } from './model'

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
  phase: 'play', health: PLAYER.health, weapon: 'rifle', magazine: WEAPONS.rifle.magazine, capacity: WEAPONS.rifle.magazine, reserve: WEAPONS.rifle.reserve, reloading: false, aiming: false, spread: WEAPONS.rifle.spread.hip,
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

export function useHud<K extends keyof View>(...keys: K[]): Pick<View, K> {
  const cache = useRef<Pick<View, K> | null>(null)
  const get = () => {
    const previous = cache.current
    if (previous && keys.every(key => previous[key] === view[key])) return previous
    const next = {} as Pick<View, K>
    for (const key of keys) next[key] = view[key]
    cache.current = next
    return next
  }
  return useSyncExternalStore(hud.subscribe, get, get)
}
