export type Vec3 = [number, number, number]
export type Tier = 'high' | 'medium' | 'low'

export const site = {
  layerSize: 1024,
  spawn: [-110, -45] as const,
  spawnYaw: Math.PI,
  far: 16000,
} as const

export const tiers = {
  high: { trees: 96000, nearFade: [48, 70] as const, impostorFar: [1800, 2600] as const, frameSize: 192, impostorBlur: 1.25, coverDistance: 120, coverNear: 15, coverDensity: 1, shadowDistance: 260, shadowMap: 2048, a2c: true, singleFrame: false, pixelRatio: 0 },
  medium: { trees: 64000, nearFade: [40, 58] as const, impostorFar: [1400, 2000] as const, frameSize: 160, impostorBlur: 1.25, coverDistance: 100, coverNear: 12, coverDensity: 0.8, shadowDistance: 200, shadowMap: 2048, a2c: true, singleFrame: false, pixelRatio: 0 },
  low: { trees: 40000, nearFade: [28, 42] as const, impostorFar: [900, 1300] as const, frameSize: 160, impostorBlur: 0.5, coverDistance: 80, coverNear: 10, coverDensity: 0.8, shadowDistance: 140, shadowMap: 1024, a2c: false, singleFrame: true, pixelRatio: 2 },
} as const

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
  pitch: -8,
  pitchMin: -70,
  pitchMax: 55,
  touchScale: 1.7,
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
  { name: 'tarn', position: [-110, 2, -45], target: [-700, 10, -190], fov: 55, note: 'The tarn at the head of the creek, the valley opening to the west' },
  { name: 'cascade', position: [-330, 4, -66], target: [-640, 4, -165], fov: 55, note: 'Above the cascading creek, looking down its fall to the valley floor' },
  { name: 'river', position: [-1600, 4, -240], target: [-1720, 8, -1500], fov: 50, note: 'On the river bank looking downstream toward the sea between the mountains' },
  { name: 'shore', position: [-1650, 6, -1380], target: [-1500, 18, -4200], fov: 50, note: 'The river mouth and the open sea to the horizon' },
  { name: 'range', position: [-1250, 6, 350], target: [-1250, 420, 2800], fov: 45, note: 'Across the valley floor to the southern mountain wall' },
]

export const route: readonly (readonly [number, number])[] = [[-260, -52], [-330, -66], [-420, -92], [-560, -140], [-700, -190], [-900, -260]]

export const flyover: { position: Vec3; target: Vec3 }[] = [
  { position: [-110, 40, -45], target: [-700, 0, -190] },
  { position: [-420, 70, -90], target: [-1100, 0, -300] },
  { position: [-1100, 60, -300], target: [-1700, 0, -1200] },
  { position: [-1700, 50, -1100], target: [-1500, 0, -4000] },
  { position: [-1500, 120, 100], target: [-1250, 250, 2800] },
]
