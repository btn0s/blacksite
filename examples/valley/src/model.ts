export type Vec3 = [number, number, number]
export type Tier = 'high' | 'medium' | 'low'

export const site = {
  scanCentre: [632, 720] as const,
  verticalScale: 1,
  walkable: 1024,
  nearSize: 1025,
  farExtent: 16384,
  farSize: 2049,
  band: 200,
  layerSize: 1024,
  meadowCentre: [10, 10] as const,
  meadowRadius: 230,
  treeline: 980,
  spawn: [6, 14] as const,
  spawnYaw: -2.2,
  far: 16000,
} as const

export const tiers = {
  high: { trees: 64000, nearTrees: 70, nearFade: [48, 70] as const, impostorFar: [640, 940] as const, frameSize: 192, coverDistance: 75, coverDensity: 1, cascades: 3, shadowDistance: 180, shadowMap: 2048, a2c: true, singleFrame: false },
  medium: { trees: 44000, nearTrees: 58, nearFade: [40, 58] as const, impostorFar: [560, 820] as const, frameSize: 160, coverDistance: 60, coverDensity: 0.8, cascades: 2, shadowDistance: 130, shadowMap: 2048, a2c: true, singleFrame: false },
  low: { trees: 28000, nearTrees: 42, nearFade: [28, 42] as const, impostorFar: [440, 660] as const, frameSize: 128, coverDistance: 45, coverDensity: 0.8, cascades: 2, shadowDistance: 90, shadowMap: 1024, a2c: false, singleFrame: true },
} as const

export const canopy = { height: 13, crown: 5.5, lead: 90 } as const

export const locomotion = {
  walk: 1.75,
  run: 3.75,
  sprint: 6.5,
  acceleration: 20,
  jumpSpeed: 4.2,
  gravity: 9.8,
  physicsStep: 1 / 60,
} as const

export const feel = {
  moveSpeed: locomotion.run,
  sprintSpeed: locomotion.sprint,
  timeToTopSpeed: 0.9 * locomotion.run / locomotion.acceleration,
  jumpApex: locomotion.jumpSpeed ** 2 / (2 * locomotion.gravity) - locomotion.jumpSpeed * locomotion.physicsStep / 2,
  tolerance: 0.1,
} as const

export const camera = { near: 0.1, shoulderOffset: 0.45 } as const

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
} as const

export const budget = {
  frameMs: 8.3,
  phoneFrameMs: 16.7,
  hitchMs: 33,
  firstPlayableMs: 9000,
  voices: 32,
} as const

export const quality = {
  shimmerStill: 0.012,
  shimmerMotion: 0.012,
  popLimit: 0.035,
} as const

export type ValleyBookmark = { name: string; position: Vec3; target: Vec3; fov: number; note: string }

export const bookmarks: ValleyBookmark[] = [
  { name: 'meadow', position: [-14, 3.2, 30], target: [40, 0.6, -40], fov: 55, note: 'Eye level in the meadow grass, looking down the hill toward the forest edge' },
  { name: 'canopy', position: [-150, 30, -150], target: [-330, -20, -420], fov: 55, note: 'Mid-distance forest canopy: near trees, impostors and the crossfade band' },
  { name: 'valley', position: [60, 26, -60], target: [-900, -60, -1500], fov: 50, note: 'Across the forested valley to the far ridges in haze' },
  { name: 'ridge', position: [210, 70, 230], target: [-1800, 120, -2600], fov: 45, note: 'From the high meadow to the mountains at the horizon' },
]

export const flyover: { position: Vec3; target: Vec3 }[] = [
  { position: [40, 60, 120], target: [-60, 20, -80] },
  { position: [-60, 45, -60], target: [-260, 0, -300] },
  { position: [-260, 70, -300], target: [-520, 0, -620] },
  { position: [-520, 120, -620], target: [-1200, 40, -1400] },
  { position: [-380, 160, -200], target: [200, 40, 120] },
]
