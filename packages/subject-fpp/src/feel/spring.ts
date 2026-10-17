export type Spring = { x: number; v: number; push: number }
export type Tuning = readonly [frequency: number, damping: number]

export const PUSH_RATE = 30
const REFERENCE_STEP = 1 / 240

export const spring = (x = 0): Spring => ({ x, v: 0, push: 0 })

export const resetSpring = (state: Spring) => { state.x = state.v = state.push = 0 }

export const damp = (value: number, target: number, rate: number, dt: number) => target + (value - target) * Math.exp(-rate * dt)

export const soft = (value: number, limit: number) => limit > 0 ? limit * Math.tanh(value / limit) : 0

export const smoother = (t: number) => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * x * (x * (x * 6 - 15) + 10)
}

function decayIntegral(difference: number, dt: number) {
  const scaled = difference * dt
  if (Math.abs(scaled) < 1e-3) return dt * dt * (0.5 - scaled / 3 + scaled * scaled / 8 - scaled ** 3 / 30)
  return (1 - (1 + scaled) * Math.exp(-scaled)) / (difference * difference)
}

function exponentialIntegral(difference: number, dt: number, fade: number) {
  const scaled = difference * dt
  const ratio = Math.abs(scaled) < 1e-4 ? 1 - scaled / 2 + scaled * scaled / 6 - scaled ** 3 / 24 : -Math.expm1(-scaled) / scaled
  return fade * dt * ratio
}

function drivePhysical(state: Spring, target: number, frequency: number, damping: number, dt: number) {
  const force = state.push
  const forceFade = Math.exp(-PUSH_RATE * dt)
  const omega = 2 * Math.PI * frequency
  if (omega === 0) {
    const integral = -Math.expm1(-PUSH_RATE * dt) / PUSH_RATE
    state.x += state.v * dt + force * (dt - integral) / PUSH_RATE
    state.v += force * integral
    state.push = force * forceFade
    return
  }
  const decay = damping * omega
  const offset = state.x - target
  const velocity = state.v
  if (damping === 1) {
    const residual = velocity + decay * offset
    const fade = Math.exp(-decay * dt)
    state.x = target + fade * (offset + residual * dt)
    state.v = fade * (velocity - decay * residual * dt)
    if (force !== 0) {
      const difference = decay - PUSH_RATE
      const integral = decayIntegral(difference, dt)
      const scaled = force * forceFade
      state.x += scaled * integral
      state.v += scaled * (dt * Math.exp(-difference * dt) - PUSH_RATE * integral)
    }
  } else if (damping < 1) {
    const oscillation = omega * Math.sqrt(1 - damping * damping)
    const fade = Math.exp(-decay * dt)
    const cosine = Math.cos(oscillation * dt)
    const sine = Math.sin(oscillation * dt) / oscillation
    state.x = target + fade * (offset * cosine + (velocity + decay * offset) * sine)
    state.v = fade * (velocity * cosine - (decay * velocity + omega * omega * offset) * sine)
    if (force !== 0) {
      const difference = PUSH_RATE - decay
      const scale = force / (difference * difference + oscillation * oscillation)
      state.x += scale * (forceFade - fade * (cosine - difference * sine))
      state.v += scale * (-PUSH_RATE * forceFade + fade * (PUSH_RATE * cosine + (oscillation * oscillation - decay * difference) * sine))
    }
  } else {
    const split = omega * Math.sqrt(damping * damping - 1)
    const fast = decay + split
    const slow = decay - split
    const fastWeight = (-velocity - slow * offset) / (fast - slow)
    const slowWeight = offset - fastWeight
    const fastFade = Math.exp(-fast * dt)
    const slowFade = Math.exp(-slow * dt)
    state.x = target + fastWeight * fastFade + slowWeight * slowFade
    state.v = -fast * fastWeight * fastFade - slow * slowWeight * slowFade
    if (force !== 0) {
      const response = force * (exponentialIntegral(slow - PUSH_RATE, dt, forceFade) - exponentialIntegral(fast - PUSH_RATE, dt, forceFade)) / (fast - slow)
      state.x += response
      state.v += force * (slowFade - fastFade) / (fast - slow) - PUSH_RATE * response
    }
  }
  state.push = force * forceFade
}

export function drive(state: Spring, target: number, frequency: number, damping: number, dt: number) {
  if (!(dt > 0)) return
  const step = REFERENCE_STEP
  const omega = 2 * Math.PI * frequency
  const dampingStep = 1 - 2 * damping * omega * step
  const pp = 1 - omega * omega * step * step
  const pv = step * dampingStep
  const vp = -omega * omega * step
  const vv = dampingStep
  const halfTrace = (pp + vv) / 2
  const determinant = pp * vv - pv * vp
  const discriminant = halfTrace * halfTrace - determinant
  if (omega === 0 || determinant <= 0) { drivePhysical(state, target, frequency, damping, dt); return }
  const steps = dt / step
  let identity: number
  let transition: number
  if (discriminant < 0) {
    const radius = Math.sqrt(determinant)
    const angle = Math.acos(Math.max(-1, Math.min(1, halfTrace / radius)))
    const decay = radius ** steps
    transition = decay * Math.sin(steps * angle) / Math.sqrt(-discriminant)
    identity = decay * Math.cos(steps * angle) - halfTrace * transition
  } else if (discriminant > 1e-12) {
    const split = Math.sqrt(discriminant)
    const fast = halfTrace + split
    const slow = halfTrace - split
    if (slow <= 0) { drivePhysical(state, target, frequency, damping, dt); return }
    const fastPower = fast ** steps
    const slowPower = slow ** steps
    transition = (fastPower - slowPower) / (fast - slow)
    identity = (fast * slowPower - slow * fastPower) / (fast - slow)
  } else {
    if (halfTrace <= 0) { drivePhysical(state, target, frequency, damping, dt); return }
    const power = halfTrace ** steps
    transition = steps * power / halfTrace
    identity = power - halfTrace * transition
  }
  const push = state.push
  const pushFade = Math.exp(-PUSH_RATE * dt)
  let position = state.x - target
  let velocity = state.v
  let pushedPosition = 0
  let pushedVelocity = 0
  if (push !== 0) {
    const pushStep = Math.exp(-PUSH_RATE * step)
    const denominator = (pushStep - pp) * (pushStep - vv) - pv * vp
    if (Math.abs(denominator) < 1e-10) { drivePhysical(state, target, frequency, damping, dt); return }
    pushedPosition = ((pushStep - vv) * step * step + pv * step) / denominator
    pushedVelocity = (vp * step * step + (pushStep - pp) * step) / denominator
    position -= pushedPosition * push
    velocity -= pushedVelocity * push
  }
  state.x = target + identity * position + transition * (pp * position + pv * velocity) + pushedPosition * push * pushFade
  state.v = identity * velocity + transition * (vp * position + vv * velocity) + pushedVelocity * push * pushFade
  state.push = push * pushFade
}

export const driveWith = (state: Spring, target: number, tuning: Tuning, dt: number) => drive(state, target, tuning[0], tuning[1], dt)

function noise(index: number) {
  let hash = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  hash ^= hash >>> 16
  return (hash >>> 0) / 4294967296
}

export function wander(shot: number, bends = 4, seed = 0) {
  const at = shot / bends
  const index = Math.floor(at) + seed * 4096
  const t = at - Math.floor(at)
  const eased = t * t * (3 - 2 * t)
  return (noise(index) + (noise(index + 1) - noise(index)) * eased) * 2 - 1
}
