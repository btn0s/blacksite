import { PUSH_RATE, drive, spring, resetSpring } from './spring'

export type RecoilTuning = {
  recover: number
  settle: number
  first: number
  heft: number
  impulse: number
  kept?: number
}

export const AIM_RECOIL = {
  hz: 4.2,
  damping: [0.78, 0.87] as const,
  kickGain: 1.8,
  anchorRate: 12,
  returnFiring: 0.9,
  settleDelay: 0.22,
} as const

export const RECOIL_TUNING = {
  rifle: { recover: 6, settle: 2.92, first: 1.7, heft: 1, impulse: 0.33 },
  pistol: { recover: 10.5, settle: 7, first: 1.2, heft: 0.6, impulse: 0.33 },
} as const satisfies Record<string, RecoilTuning>

export function handsTuning(recover: number, heft: number) {
  const [loose, tight] = AIM_RECOIL.damping
  const heavy = Math.max(0, Math.min(1, (heft - 0.6) / 0.9))
  return { damping: loose + (tight - loose) * heavy, hz: AIM_RECOIL.hz * Math.sqrt(recover / 7) }
}

export function createAimRecoil() {
  const pitch = spring()
  const yaw = spring()
  let climbPitch = 0
  let climbYaw = 0
  let anchorPitch = 0
  let anchorYaw = 0
  let sinceShot = Infinity
  let spray = 0
  let tuning: RecoilTuning = RECOIL_TUNING.rifle
  const offset = { pitch: 0, yaw: 0 }
  return {
    offset,
    get spray() { return spray },
    shot(kickPitch: number, kickYaw: number, weapon: RecoilTuning = tuning) {
      tuning = weapon
      const hands = handsTuning(weapon.recover, weapon.heft)
      const push = 2 * Math.PI * hands.hz * AIM_RECOIL.kickGain * PUSH_RATE
      const first = spray === 0 ? weapon.first : 1
      const kept = weapon.kept ?? 0
      pitch.push += kickPitch * (1 - kept) * weapon.impulse * first * push
      yaw.push += kickYaw * (1 - kept) * weapon.impulse * first * push
      climbPitch += kickPitch * (1 - kept)
      climbYaw += kickYaw * (1 - kept)
      sinceShot = 0
      spray++
      return { pitch: kickPitch * kept, yaw: kickYaw * kept }
    },
    step(dt: number) {
      if (!(dt > 0)) return offset
      sinceShot += dt
      const firing = sinceShot < AIM_RECOIL.settleDelay
      const settle = Math.exp(-(firing ? AIM_RECOIL.returnFiring : tuning.settle) * dt)
      climbPitch *= settle
      climbYaw *= settle
      const follow = 1 - Math.exp(-AIM_RECOIL.anchorRate * dt)
      anchorPitch += (climbPitch - anchorPitch) * follow
      anchorYaw += (climbYaw - anchorYaw) * follow
      const hands = handsTuning(tuning.recover, tuning.heft)
      drive(pitch, anchorPitch, hands.hz, hands.damping, dt)
      drive(yaw, anchorYaw, hands.hz, hands.damping, dt)
      offset.pitch = pitch.x
      offset.yaw = yaw.x
      if (!firing && Math.abs(anchorPitch) + Math.abs(anchorYaw) < 1e-4 && Math.abs(pitch.x) < 1e-4 && Math.abs(pitch.v) < 1e-3) spray = 0
      return offset
    },
    reset() {
      resetSpring(pitch)
      resetSpring(yaw)
      climbPitch = climbYaw = anchorPitch = anchorYaw = 0
      sinceShot = Infinity
      spray = 0
      offset.pitch = offset.yaw = 0
    },
  }
}

export type AimRecoil = ReturnType<typeof createAimRecoil>
