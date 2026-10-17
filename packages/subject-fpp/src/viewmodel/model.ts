import type { ArmsWeapon } from '../arms/state'

export type Vec3 = readonly [number, number, number]

export type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky'
export type GripPose = Readonly<Record<FingerName, Vec3>> & { readonly spread?: number; readonly thumbOpposition?: number }

export const GRIPS = {
  relaxed: { thumb: [10, 10, 8], index: [14, 18, 10], middle: [18, 22, 12], ring: [22, 24, 14], pinky: [26, 26, 16], spread: 2 },
  trigger: { thumb: [42, 34, 26], index: [26, 38, 18], middle: [84, 94, 52], ring: [88, 96, 54], pinky: [92, 96, 52], spread: -2 },
  handguard: { thumb: [30, 18, 12], index: [58, 62, 36], middle: [64, 66, 38], ring: [70, 68, 40], pinky: [74, 70, 40], spread: 0 },
  wrap: { thumb: [38, 22, 14], index: [62, 72, 40], middle: [70, 78, 46], ring: [76, 80, 46], pinky: [80, 80, 44], spread: -3 },
  pistolTrigger: { thumb: [10, 30, 5], index: [65, 0, 15], middle: [45, 35, 25], ring: [50, 40, 25], pinky: [55, 45, 25], thumbOpposition: 5 },
  pistolSupport: { thumb: [10, 5, 0], index: [62, 72, 40], middle: [70, 78, 46], ring: [76, 80, 46], pinky: [80, 80, 44], thumbOpposition: 60 },
  magazine: { thumb: [34, 28, 18], index: [46, 52, 30], middle: [56, 60, 36], ring: [62, 64, 38], pinky: [66, 66, 38], spread: 0 },
  pinch: { thumb: [30, 36, 30], index: [42, 58, 46], middle: [74, 84, 50], ring: [84, 90, 52], pinky: [88, 90, 50], spread: -2 },
} as const satisfies Record<string, GripPose>

export type GripName = keyof typeof GRIPS

export type Socket = {
  readonly position: Vec3
  readonly fingers: Vec3
  readonly palm: Vec3
  readonly grip: GripName
}

export type LeftAnchor = 'support' | 'magazine' | 'charge' | 'free'

export type WeaponModel = {
  readonly hip: { readonly position: Vec3; readonly rotation: Vec3 }
  readonly sight: Vec3
  readonly rearSight: Vec3
  readonly eyeRelief: number
  readonly aimRotation: Vec3
  readonly aimSeconds: number
  readonly aimFov: number
  readonly pivot: Vec3
  readonly sprint: { readonly position: Vec3; readonly rotation: Vec3 }
  readonly recoil: { readonly back: number; readonly pitch: number; readonly yaw: number; readonly roll: number; readonly rise: number; readonly aimScale: number }
  readonly cycle: { readonly part: 'slide' | 'charging_handle'; readonly travel: number; readonly seconds: number; readonly rack: number; readonly locksOpen: boolean }
  readonly right: Socket
  readonly left: Readonly<Record<Exclude<LeftAnchor, 'free'>, Socket>>
  readonly elbows: { readonly right: Vec3; readonly left: Vec3 }
  readonly magazine: { readonly bone: string }
}

export const VIEWMODEL = {
  fov: 56,
  spring: { integrator: 'semi-implicit-euler', maxStepSeconds: 1 / 240 },
  shoulders: { right: [0.18, -0.3, 0.02], left: [-0.18, -0.3, 0.02] },
  arms: { scale: 1.1, upperArmStretch: 1.6, forearmStretch: 1.15 },
  sway: { perRadianPerSecond: 0.016, maxRotation: 0.07, positionPerRadian: 0.045, stiffness: 140, damping: 19 },
  bob: { walkStride: 0.78, sprintStride: 1.05, walkSpeed: 3.1, vertical: 0.006, lateral: 0.009, roll: 0.014, pitch: 0.008, aimScale: 0.12, sprintScale: 1.9, blendRate: 9 },
  idle: { breathHz: 0.23, vertical: 0.0014, pitch: 0.004, aimScale: 0.35 },
  landing: { dipPerMetrePerSecond: 0.0075, maxDip: 0.04, stiffness: 95, damping: 11 },
  recoil: { stiffness: 520, damping: 34, rotationStiffness: 420, rotationDamping: 30 },
  sprintRate: 8,
  forearmTwist: 0.55,
  moveThreshold: 0.05,
} as const

export const VIEWMODEL_WEAPONS: Record<ArmsWeapon, WeaponModel> = {
  rifle: {
    hip: { position: [0.11, -0.165, -0.235], rotation: [0.015, 0.035, 0] },
    sight: [0, 0.08921, 0.5877],
    rearSight: [0, 0.08924, 0.17739],
    eyeRelief: 0.37,
    aimRotation: [0, 0, 0],
    aimSeconds: 0.26,
    aimFov: 50,
    pivot: [0, 0.02, -0.05],
    sprint: { position: [-0.04, 0.005, -0.01], rotation: [-0.2, 0.5, 0.28] },
    recoil: { back: 0.024, pitch: 0.045, yaw: 0.012, roll: 0.03, rise: 0.006, aimScale: 0.45 },
    cycle: { part: 'charging_handle', travel: 0.07, seconds: 0.06, rack: 0.07, locksOpen: false },
    right: { position: [0.017, -0.042, 0.038], fingers: [0, -0.32, -1], palm: [-1, 0, 0.05], grip: 'trigger' },
    left: {
      support: { position: [-0.004, 0.006, -0.28], fingers: [0.75, 0.12, -0.65], palm: [-0.2, 1, 0.05], grip: 'handguard' },
      magazine: { position: [-0.028, -0.065, -0.15], fingers: [0.05, -0.2, -1], palm: [1, 0.1, 0], grip: 'magazine' },
      charge: { position: [-0.025, 0.055, -0.08], fingers: [1, -0.15, -0.1], palm: [0.1, -1, 0], grip: 'pinch' },
    },
    elbows: { right: [1, -0.25, 0.35], left: [-1, -0.25, 0.35] },
    magazine: { bone: 'magazine' },
  },
  pistol: {
    hip: { position: [0.1, -0.15, -0.34], rotation: [0.02, 0.05, 0] },
    sight: [0, 0.07206, 0.17032],
    rearSight: [0, 0.07369, -0.00314],
    eyeRelief: 0.36,
    aimRotation: [0, 0, 0],
    aimSeconds: 0.19,
    aimFov: 60,
    pivot: [0, -0.02, 0.0],
    sprint: { position: [-0.035, -0.015, 0.01], rotation: [-0.3, 0.45, 0.2] },
    recoil: { back: 0.03, pitch: 0.12, yaw: 0.018, roll: 0.035, rise: 0.012, aimScale: 0.6 },
    cycle: { part: 'slide', travel: 0.034, seconds: 0.07, rack: 0.034, locksOpen: true },
    right: { position: [0.015, -0.045, 0.02], fingers: [-0.28, 0.72, -0.64], palm: [-0.92, -0.14, 0.25], grip: 'pistolTrigger' },
    left: {
      support: { position: [-0.025, -0.04, -0.008], fingers: [0.25, 0.55, -0.8], palm: [0.95, -0.2, 0.15], grip: 'pistolSupport' },
      magazine: { position: [-0.022, -0.058, 0.006], fingers: [0.1, 0.9, -0.25], palm: [1, 0.1, 0], grip: 'magazine' },
      charge: { position: [-0.004, 0.06, 0.07], fingers: [0.6, 0, -0.8], palm: [0.15, -0.2, 1], grip: 'pinch' },
    },
    elbows: { right: [1, -0.25, 0.35], left: [-1, -0.25, 0.35] },
    magazine: { bone: 'magazine' },
  },
}

export function bobFrequency(speed: number, sprinting: boolean) {
  const stride = sprinting ? VIEWMODEL.bob.sprintStride : VIEWMODEL.bob.walkStride
  return speed / stride
}
