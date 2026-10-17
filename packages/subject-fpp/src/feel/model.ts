import type { Tuning } from './spring'

export const CAMERA_FEEL = {
  stride: { base: 1.15, sprint: 0.35, reference: 5.9 },
  bob: { reference: 4.3, max: 1.5, sprint: 0.35, gain: 1.25, lateral: 0.012, vertical: 0.011, roll: 0.005 },
  footfallSpeed: 0.25,
  dip: { spring: [3.2, 0.5] as Tuning, metres: 0.05, land: 0.42, maxImpact: 8, jump: 0.7, crouch: 0.9, stand: 0.5 },
  flinch: { spring: [3.5, 0.45] as Tuning, radians: 0.02, land: 0.12, crouch: 0.5, stand: 0.3, hit: 1.2, hitPerDamage: 0.03 },
  strafeRoll: { gain: 0.006, spring: [2.6, 0.8] as Tuning },
  fov: { sprint: 2, sprintSpring: [2.2, 1] as Tuning, punch: [6, 0.6] as Tuning, shot: 0.2, shotAim: 0.5, jump: 2, land: 0.5, aimKeep: 0.6 },
} as const

export const GUN_FEEL = {
  springs: {
    camera: [1.8, 1] as Tuning,
    gun: [9.5, 0.82] as Tuning,
    land: [3, 0.75] as Tuning,
    settle: [3.6, 0.7] as Tuning,
    strafe: [3, 1.1] as Tuning,
    surge: [2, 0.6] as Tuning,
    sway: [2.1, 0.7] as Tuning,
  },
  hands: [0.78, 0.87] as const,
  aimSeconds: 0.3,
  aimHeft: 0.35,
  aimRecoil: 0.72,
  crouchRecoil: 0.82,
  aimOut: 0.8,
  aimSettle: 5,
  aimArc: 0.03,
  aimSteady: 0.9,
  aimKick: 0.3,
  breath: 0.0012,
  breathHip: 0.5,
  dip: 0.25,
  kick: { reference: 0.0085, side: 0.0028, back: 2.6, rise: 0.8, roll: 0.7, rollBias: 0.25, camera: 0.3, cameraRoll: 0.12, first: 1.7 },
  reach: { lag: 0.55, pitch: 0.3, yaw: 0.38 },
  shoulder: [0.1, -0.22, 0.24] as const,
  sprint: 0.022,
  stance: 1.4,
  land: { perSpeed: 0.25, max: 1.6 },
  surge: 0.021,
  sway: { gain: 0.0355, heft: 0.6, max: 0.1, pitch: 0.75, roll: 0.6, rollLag: 0.6 },
  tension: { brace: 0.2, relax: 10, rise: 25, tight: 3 },
  walkHip: 0.6,
  walkAim: 1,
} as const

export const WEAPON_HEFT = {
  rifle: { heft: 1, punch: 0.0105, side: 0.0038, camera: 1, bends: 4, seed: 21 },
  pistol: { heft: 0.6, punch: 0.01, side: 0.003, camera: 0.6, bends: 3, seed: 7 },
} as const

export const READINESS = {
  seconds: 0.26,
  landSeconds: 0.2,
} as const

export const SOUND_FEEL = {
  aimIn: 0.25,
  aimOut: 0.18,
  mech: 0.32,
} as const

export const aimTime = (weapon: keyof typeof WEAPON_HEFT, seconds: number = GUN_FEEL.aimSeconds) => seconds * (1 + GUN_FEEL.aimHeft * (WEAPON_HEFT[weapon].heft - 1))
