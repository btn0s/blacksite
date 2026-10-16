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
} as const

export const mantle = {
  minLedge: 0.5,
  maxLedge: 2.25,
  highAbove: 1.25,
  routeLedges: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const,
  reachTopWithin: 1.6,
  successRate: 1,
} as const

export const feet = {
  plantedHeight: 0.06,
  flatSlideP95: 0.1,
  flatSlideMean: 0.04,
  unevenSlideP95: 0.15,
  plantedGap: 0.04,
  stairRiser: 0.17,
  stairTread: 0.28,
  slopes: [10, 20, 30] as const,
} as const

export const camera = {
  near: 0.1,
  clipFrames: 0,
  shoulderSwapSeconds: 0.35,
  shoulderMaxStep: 0.12,
  easeOutSeconds: 0.4,
} as const

export const route = {
  checkpoints: 7,
  parSeconds: 75,
  goldSeconds: 58,
  ghostHz: 20,
  ghostMsPerFrame: 0.15,
  ghostBytesPerMinute: 1_000_000,
} as const

export const frame = {
  desktopFps: 120,
  desktopP95Ms: 9,
  phoneFps: 60,
  phoneP95Ms: 16.7,
  firstPlayableSeconds: 5,
  desktopDrawCalls: 180,
  phoneDrawCalls: 120,
  shadowedLights: 1,
  pointLights: 4,
} as const

export function nearPlaneRadius(near: number, verticalFovDegrees: number, aspect: number) {
  const half = Math.tan(verticalFovDegrees * Math.PI / 360) * near
  return Math.hypot(half, half * aspect, near)
}

export type FootSample = { t: number; x: number; y: number; z: number; ground: number; grounded: boolean }

export function plantedSpeeds(samples: readonly FootSample[]) {
  const speeds: number[] = []
  for (let index = 1; index < samples.length; index++) {
    const a = samples[index - 1]!
    const b = samples[index]!
    const dt = b.t - a.t
    if (dt <= 0 || !a.grounded || !b.grounded) continue
    if (a.y - a.ground > feet.plantedHeight || b.y - b.ground > feet.plantedHeight) continue
    speeds.push(Math.hypot(b.x - a.x, b.z - a.z) / dt)
  }
  return speeds
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
