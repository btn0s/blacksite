export type Gate = { name: string; at: readonly [number, number, number]; half: readonly [number, number, number]; yaw: number }

export type Race = {
  state: 'ready' | 'running' | 'finished'
  start: number
  next: number
  splits: number[]
  best: number[] | null
}

export const createRace = (best: number[] | null = null): Race => ({ state: 'ready', start: 0, next: 0, splits: [], best })

export function inside(gate: Gate, x: number, y: number, z: number) {
  const dx = x - gate.at[0]
  const dz = z - gate.at[2]
  const c = Math.cos(gate.yaw)
  const s = Math.sin(gate.yaw)
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  return Math.abs(lx) <= gate.half[0] && Math.abs(y - gate.at[1]) <= gate.half[1] && Math.abs(lz) <= gate.half[2]
}

export type RaceEvent = { kind: 'start' } | { kind: 'split'; index: number; time: number; delta: number | null } | { kind: 'finish'; time: number; delta: number | null; record: boolean }

export function stepRace(race: Race, gates: readonly Gate[], now: number, x: number, y: number, z: number): RaceEvent | null {
  if (race.state === 'finished') return null
  if (race.state === 'ready') {
    if (!inside(gates[0]!, x, y, z)) return null
    race.state = 'running'
    race.start = now
    race.next = 1
    race.splits = []
    return { kind: 'start' }
  }
  const gate = gates[race.next]
  if (!gate || !inside(gate, x, y, z)) return null
  const time = now - race.start
  const index = race.next - 1
  race.splits.push(time)
  const reference = race.best?.[index]
  const delta = reference === undefined ? null : time - reference
  race.next++
  if (race.next < gates.length) return { kind: 'split', index, time, delta }
  race.state = 'finished'
  const record = !race.best || time < race.best[race.best.length - 1]!
  if (record) race.best = [...race.splits]
  return { kind: 'finish', time, delta, record }
}

export function elapsed(race: Race, now: number) {
  if (race.state === 'ready') return 0
  if (race.state === 'finished') return race.splits[race.splits.length - 1] ?? 0
  return now - race.start
}
