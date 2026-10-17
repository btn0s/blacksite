export const locomotion = {
  walk: 1.75,
  run: 3.75,
  sprint: 6.5,
  crouchWalk: 1.5,
  crouchRun: 2,
  capsuleRadius: 0.3,
  capsuleHalfHeight: 0.9,
  maxStep: 0.45,
  walkableSlopeDegrees: 44.8,
  acceleration: 20,
  jumpSpeed: 4.2,
  gravity: 9.8,
  physicsStep: 1 / 60,
} as const

export const feel = {
  moveSpeed: locomotion.run,
  sprintSpeed: locomotion.sprint,
  timeToTopSpeed: (Math.ceil(0.9 * locomotion.run / locomotion.acceleration / locomotion.physicsStep) + 1) * locomotion.physicsStep,
  jumpApex: locomotion.jumpSpeed ** 2 / (2 * locomotion.gravity) - locomotion.jumpSpeed * locomotion.physicsStep / 2,
  tolerance: 0.1,
} as const

export const mantle = {
  minLedge: 0.5,
  maxLedge: 2.25,
  highAbove: 1.25,
  routeLedges: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const,
  reachTopWithin: 1.8,
  successRate: 1,
} as const

export const feet = {
  plantedHeight: 0.025,
  stancePhase: 0.75,
  authoredLock: 0.99,
  edgeFrames: 1,
  flatDriftP95: 0.1,
  unevenDriftP95: 0.15,
  excursionP95: 0.03,
  plantedGap: 0.04,
  stairRiser: 0.17,
  stairTread: 0.28,
  slopes: [10, 20, 30] as const,
} as const

export const camera = {
  clipFrames: 0,
  shoulderOffset: 0.5,
  shoulderSwapSeconds: 0.5,
  shoulderMaxStep: 0.12,
  easeOutSeconds: 0.4,
} as const

export const input = {
  mouseDegreesPerPixel: 0.0022 * 180 / Math.PI,
  touchDegreesPerPixel: 0.0042 * 180 / Math.PI * 1.7,
  padYawRate: 240,
  padPitchRate: 90,
  pitchMin: -70,
  pitchMax: 55,
  walkStick: 0.5,
  stickDeadZone: 0.2,
  touchSprint: 0.92,
  rollTapSeconds: 0.25,
  jumpBufferSeconds: 0.1,
  coyoteSeconds: 0.1,
  landingDip: 0.12,
  landingDipRecovery: 9,
} as const

export const route = {
  checkpoints: 7,
  parSeconds: 75,
  goldSeconds: 58,
  ghostHz: 20,
  ghostMsPerFrame: 0.15,
  ghostBytesPerMinute: 1_000_000,
} as const

export const look = {
  atmosphere: { fog: '#858a7e', density: 0.017, shadowSize: 30, sunIntensity: 3.6, ambient: 1.0, sunDirection: [0.5, 0.42, -0.6] as [number, number, number] },
  ash: 1400,
  phoneDensity: 0.5,
  ashRadius: 22,
} as const

export const budget = {
  frameMs: 8.3,
  phoneFrameMs: 16.7,
  hitchMs: 33,
  firstPlayableMs: 5000,
  voices: 32,
  phoneVoices: 16,
} as const

export const frame = {
  desktopFps: 120,
  phoneFps: 60,
  desktopDrawCalls: 180,
  phoneDrawCalls: 120,
  shadowedLights: 1,
  pointLights: 4,
} as const

export function nearPlaneRadius(near: number, verticalFovDegrees: number, aspect: number) {
  const half = Math.tan(verticalFovDegrees * Math.PI / 360) * near
  return Math.hypot(half, half * aspect, near)
}

export type FootSample = { t: number; x: number; y: number; z: number; ground: number; grounded: boolean; planted: boolean; plant?: number; lock?: number }

export type Contact = { seconds: number; drift: number; excursion: number; jitter: number }

export function advanceFootContact(previous: boolean, input: { grounded: boolean; lock: number; gap: number; phase: number }) {
  const groundedContact = input.grounded && input.lock >= feet.authoredLock && (previous || Math.abs(input.gap) <= feet.plantedHeight)
  return { groundedContact, planted: input.grounded && (groundedContact || input.phase >= feet.stancePhase) }
}

export function contacts(samples: readonly FootSample[]) {
  const result: Contact[] = []
  let run: FootSample[] = []
  const flat = (a: FootSample, b: FootSample) => Math.hypot(b.x - a.x, b.z - a.z)
  const flush = () => {
    const inner = run.slice(feet.edgeFrames, run.length - feet.edgeFrames)
    run = []
    if (inner.length < 3) return
    const first = inner[0]!
    const end = inner[inner.length - 1]!
    const steps: number[] = []
    let excursion = 0
    for (let index = 1; index < inner.length; index++) {
      steps.push(flat(inner[index - 1]!, inner[index]!))
      excursion = Math.max(excursion, flat(first, inner[index]!))
    }
    const seconds = end.t - first.t
    if (seconds > 0) result.push({ seconds, drift: steps.reduce((sum, step) => sum + step, 0) / seconds, excursion, jitter: percentile(steps, 0.5) })
  }
  for (const sample of samples) {
    if (sample.grounded && sample.planted && Number.isFinite(sample.ground)) run.push(sample)
    else flush()
  }
  flush()
  return result
}

export function percentile(values: readonly number[], p: number) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!
}

export function mean(values: readonly number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

export function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`
}

export function formatSplit(delta: number) {
  return `${delta < 0 ? '−' : '+'}${Math.abs(delta).toFixed(2)}`
}
