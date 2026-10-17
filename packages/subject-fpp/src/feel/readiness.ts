import { READINESS } from './model'

export type LowerReason = 'airborne' | 'draw' | 'holster' | 'land' | 'reload' | 'sprint' | 'switch'

export type ReadinessPhase = 'lowered' | 'lowering' | 'raised' | 'raising'

export type Readiness = {
  duration: number
  fireRequested: boolean
  fromFraction: number
  fromVelocity: number
  lastFire: boolean
  lowered: number
  target: 0 | 1
  velocity: number
  phase: ReadinessPhase
  reason: LowerReason | null
  startedAt: number
}

const CANCELABLE: Record<LowerReason, boolean> = {
  airborne: true,
  draw: true,
  holster: false,
  land: true,
  reload: false,
  sprint: true,
  switch: true,
}

export const createReadiness = (): Readiness => ({
  duration: 0, fireRequested: false, fromFraction: 0, fromVelocity: 0, lastFire: false,
  lowered: 0, target: 0, velocity: 0, phase: 'raised', reason: null, startedAt: 0,
})

function sample(state: Readiness, time: number) {
  if (state.duration === 0) return
  const t = Math.min(1, Math.max(0, (time - state.startedAt) / state.duration))
  const t2 = t * t
  const t3 = t2 * t
  const d = state.duration
  state.lowered = (2 * t3 - 3 * t2 + 1) * state.fromFraction + (t3 - 2 * t2 + t) * d * state.fromVelocity + (-2 * t3 + 3 * t2) * state.target
  state.velocity = ((6 * t2 - 6 * t) * state.fromFraction + (3 * t2 - 4 * t + 1) * d * state.fromVelocity + (-6 * t2 + 6 * t) * state.target) / d
  if (t === 1) {
    state.lowered = state.target
    state.velocity = 0
    state.phase = state.target ? 'lowered' : 'raised'
    if (!state.target) state.reason = null
  }
}

export function advanceReadiness(state: Readiness, time: number, reason: LowerReason | null, fire: boolean, shootable = true, seconds: number = READINESS.seconds) {
  if (shootable && fire && !state.lastFire) state.fireRequested = true
  state.lastFire = fire
  if (!shootable) state.fireRequested = false
  sample(state, time)
  const wantsRaise = fire || state.fireRequested
  const target: 0 | 1 = reason && !(wantsRaise && CANCELABLE[reason]) ? 1 : 0
  if (target !== state.target) {
    state.fromFraction = state.lowered
    state.fromVelocity = state.velocity
    state.startedAt = time
    state.duration = seconds
    state.target = target
    state.phase = target ? 'lowering' : 'raising'
    if (reason) state.reason = reason
  } else if (target && reason) {
    state.reason = reason
  }
  sample(state, time)
  return state
}

export const ready = (state: Readiness) => state.phase === 'raised'

export const consumeFire = (state: Readiness) => { state.fireRequested = false }
