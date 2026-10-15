export const aimAssistDefaults = {
  enabled: true,
  slowdown: 0.55,
  frictionCone: 1.75,
  magnetism: 0.3,
  magnetismCone: 2.5,
  magnetismSpeed: 18,
  snapCone: 4,
  snapDuration: 0.16,
  snapAngle: 2.5,
  snapSpeed: 35,
  snapEase: 16,
  hipScale: 0.5,
  breakaway: 0.75,
} as const

export type AimAssistSettings = { [K in keyof typeof aimAssistDefaults]: typeof aimAssistDefaults[K] extends boolean ? boolean : number }
export interface AimCandidate {
  readonly id: string
  readonly angle: number
  readonly surfaceAngle: number
  readonly yawError: number
  readonly pitchError: number
  readonly strength: number
  readonly moving: boolean
}
export interface AimInput {
  readonly yawDelta: number
  readonly pitchDelta: number
  readonly stickMagnitude: number
  readonly aiming: boolean
  readonly aimPressed: boolean
  readonly dt: number
}

function capped(yaw: number, pitch: number, limit: number) {
  const length = Math.hypot(yaw, pitch)
  const scale = length > 0 ? Math.min(1, limit / length) : 0
  return { yawDelta: yaw * scale, pitchDelta: pitch * scale }
}

export function createAimAssist(settings: AimAssistSettings = aimAssistDefaults) {
  let tracked = ""
  let snap = { target: "", elapsed: 0, budget: 0 }
  const reset = () => { tracked = ""; snap = { target: "", elapsed: 0, budget: 0 } }
  return {
    reset,
    modify(input: AimInput, candidates: ReadonlyArray<AimCandidate>) {
      const target = [...candidates].sort((a, b) => a.angle - b.angle)[0]
      if (!settings.enabled || !target) {
        reset()
        return { yawDelta: input.yawDelta, pitchDelta: input.pitchDelta }
      }
      const dt = Math.max(0, Math.min(0.05, input.dt))
      const breakaway = input.stickMagnitude >= settings.breakaway
      if (input.aimPressed && !breakaway) {
        const snapTarget = candidates.find((candidate) => candidate.angle <= settings.snapCone)
        snap = { target: snapTarget?.id ?? "", elapsed: 0, budget: settings.snapAngle * (snapTarget?.strength ?? 0) }
      }
      const proximity = 1 - Math.min(1, Math.max(0, target.surfaceAngle / settings.frictionCone))
      const strength = target.strength * (input.aiming ? 1 : settings.hipScale)
      const friction = 1 - settings.slowdown * strength * proximity * proximity
      const result = { yawDelta: input.yawDelta * friction, pitchDelta: input.pitchDelta * friction }
      if (!breakaway && tracked === target.id && target.moving && target.surfaceAngle <= settings.magnetismCone) {
        const correction = capped(target.yawError * settings.magnetism * strength * dt * 2, target.pitchError * settings.magnetism * strength * dt * 2, settings.magnetismSpeed * dt * strength)
        result.yawDelta += correction.yawDelta
        result.pitchDelta += correction.pitchDelta
      }
      const snapCandidate = candidates.find((candidate) => candidate.id === snap.target)
      if (snapCandidate && input.aiming && !breakaway && snap.elapsed < settings.snapDuration && snap.budget > 0 && snapCandidate.angle <= settings.snapCone) {
        snap.elapsed += dt
        const ease = 1 - Math.exp(-settings.snapEase * dt)
        const correction = capped(snapCandidate.yawError * ease, snapCandidate.pitchError * ease, Math.min(snap.budget, settings.snapSpeed * dt * snapCandidate.strength))
        snap.budget -= Math.hypot(correction.yawDelta, correction.pitchDelta)
        result.yawDelta += correction.yawDelta
        result.pitchDelta += correction.pitchDelta
      } else snap.target = ""
      tracked = target.id
      return result
    },
  }
}
