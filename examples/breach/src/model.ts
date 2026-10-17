import type { WeaponDefinition } from '@blacksite/armory'
import { FIELD_WEAPONS, foundTimings } from '@blacksite/subject-fpp/arms/model'

export const DEG = Math.PI / 180
export const SPEED_OF_SOUND = 343

export const MOVE = {
  eye: 1.63,
  crouchEye: 1.0,
  eyeSmoothing: 20,
  radius: 0.3,
  height: 1.8,
  crouchHeight: 1.12,
  step: 0.45,
  walk: 1.75,
  run: 3.75,
  sprint: 6.5,
  crouch: 2.0,
  aim: 1.65,
  accelerate: [20, 7.5] as const,
  brake: [15, 12.5, 5] as const,
  airControl: 0.25,
  jumpSpeed: 4.2,
  gravity: 9.8,
  coyoteSeconds: 0.1,
  bufferSeconds: 0.1,
  landDip: 0.06,
  crouchSeconds: 0.2,
  sprintOutSeconds: 0.22,
  bobAmplitude: 0.012,
}

export const jumpApex = () => MOVE.jumpSpeed * MOVE.jumpSpeed / (2 * MOVE.gravity)

export function acceleration(speed: number) {
  const k = Math.min(1, Math.max(0, speed / MOVE.sprint))
  return MOVE.accelerate[0] + (MOVE.accelerate[1] - MOVE.accelerate[0]) * k
}

export function braking(speed: number) {
  if (speed <= MOVE.run) return MOVE.brake[0] + (MOVE.brake[1] - MOVE.brake[0]) * speed / MOVE.run
  return MOVE.brake[1] + (MOVE.brake[2] - MOVE.brake[1]) * Math.min(1, (speed - MOVE.run) / (MOVE.sprint - MOVE.run))
}

export function timeToTopSpeed(speed: number, fraction = 0.9) {
  let velocity = 0
  let time = 0
  const dt = 1 / 240
  while (velocity < speed * fraction && time < 2) {
    velocity = Math.min(speed, velocity + acceleration(velocity) * dt)
    time += dt
  }
  return time
}

export const VIEW = {
  fov: 75,
  fovBlend: 14,
  viewmodelFov: 56,
  sensitivity: 0.0022,
  touchSensitivity: 0.0042,
  kickDecaySeconds: 0.08,
  shake: { shot: 0.18 * DEG, hit: 1.4 * DEG, decay: 9 },
}

export type Kick = readonly [pitch: number, yaw: number]

const rifleKicks: Kick[] = [
  [0.35, 0], [0.55, 0.02], [0.9, 0.04], [1.0, 0.05], [1.0, 0.04], [0.95, 0.03], [0.85, 0.02], [0.7, 0.05], [0.6, 0.08],
  [0.25, -0.5], [0.2, -0.55], [0.2, -0.6], [0.15, -0.55], [0.15, -0.45], [0.1, -0.35],
  [0.1, 0.45], [0.1, 0.6], [0.1, 0.65], [0.1, 0.6], [0.1, 0.5], [0.05, 0.4],
  [0.15, -0.3], [0.15, -0.4], [0.15, -0.4], [0.1, -0.3], [0.1, 0.25], [0.1, 0.35], [0.1, 0.35], [0.1, 0.3], [0.1, 0.2],
]

const pistolKicks: Kick[] = [[1.3, 0.1], [1.4, -0.15], [1.4, 0.2], [1.5, -0.2], [1.5, 0.15], [1.5, -0.1], [1.5, 0.2], [1.5, -0.2]]

const FOUND = { rifle: foundTimings({ weapons: FIELD_WEAPONS }, 'rifle'), pistol: foundTimings({ weapons: FIELD_WEAPONS }, 'pistol') }

export const WEAPONS = {
  rifle: {
    id: 'rifle', label: 'Rifle', roundsPerSecond: 10, magazine: 30, reserve: 150,
    ...FOUND.rifle, damage: 36, range: 120,
    adsSeconds: 0.25, adsFov: 55, kicks: rifleKicks, kickResetSeconds: 0.43, kickJitter: 0.04, recoveryFraction: 0.6, recoverySeconds: 0.43,
    spread: { hip: 1.1, aim: 0.12, move: 1.6, sprint: 4, crouch: 0.75, bloomPerShot: 0.18, bloomMax: 2.2, recoverySeconds: 0.43, recoveryDelaySeconds: 0.1 },
  },
  pistol: {
    id: 'pistol', label: 'Pistol', roundsPerSecond: 5, magazine: 8, reserve: 40,
    ...FOUND.pistol, damage: 28, range: 60,
    adsSeconds: 0.15, adsFov: 62, kicks: pistolKicks, kickResetSeconds: 0.3, kickJitter: 0.1, recoveryFraction: 0.85, recoverySeconds: 0.25,
    spread: { hip: 0.9, aim: 0.15, move: 1.2, sprint: 3, crouch: 0.8, bloomPerShot: 0.35, bloomMax: 1.8, recoverySeconds: 0.3, recoveryDelaySeconds: 0.2 },
  },
} as const

export type WeaponId = keyof typeof WEAPONS

export const HIT_ZONES = { head: 4, chest: 1, limb: 0.75 } as const
export type HitZone = keyof typeof HIT_ZONES

export function armoryDefinitions(): WeaponDefinition[] {
  return (Object.values(WEAPONS) as Array<(typeof WEAPONS)[WeaponId]>).map(weapon => ({
    id: weapon.id,
    label: weapon.label,
    fireMode: weapon.id === 'rifle' ? 'auto' : 'semi',
    roundsPerSecond: weapon.roundsPerSecond,
    magazineSize: weapon.magazine,
    initialReserve: weapon.reserve,
    reloadSeconds: weapon.reloadSeconds,
    emptyReloadSeconds: weapon.emptyReloadSeconds,
    equipSeconds: weapon.equipSeconds,
    damage: weapon.damage,
    range: weapon.range,
    spreadRadians: weapon.spread.hip * DEG,
    recoil: { pitchMin: weapon.kicks[0]![0] * DEG, pitchMax: weapon.kicks[0]![0] * DEG, yawMax: 0 },
    pattern: {
      kicks: weapon.kicks.map(([pitch, yaw]) => ({ pitch: pitch * DEG, yaw: yaw * DEG })),
      resetSeconds: weapon.kickResetSeconds,
      jitter: weapon.kickJitter * DEG,
    },
    spread: {
      hip: weapon.spread.hip * DEG,
      aim: weapon.spread.aim * DEG,
      move: weapon.spread.move * DEG,
      crouch: weapon.spread.crouch,
      bloomPerShot: weapon.spread.bloomPerShot * DEG,
      bloomMax: weapon.spread.bloomMax * DEG,
      recoverySeconds: weapon.spread.recoverySeconds,
      recoveryDelaySeconds: weapon.spread.recoveryDelaySeconds,
    },
    ballistics: { kind: 'hitscan' },
  }))
}

export const PLAYER = {
  health: 100,
  regenDelaySeconds: 5,
  regenPerSecond: 25,
  deathRestartSeconds: 3.5,
  exfilRestartSeconds: 5,
}

export const AI = {
  health: 100,
  sightRange: 37,
  sightHalfAngle: 77 * DEG,
  reactionSeconds: [0.35, 0.6] as const,
  hearingRange: 32,
  barkLeadSeconds: 0.8,
  barkCooldownSeconds: 2.5,
  attackTokens: 2,
  tokenHoldSeconds: 3,
  tokenCooldownSeconds: 1.2,
  tokenIdleSeconds: 0.5,
  burst: [3, 5] as const,
  burstPauseSeconds: [0.6, 1.2] as const,
  roundsPerSecond: 9,
  damage: 12,
  firstBurstMisses: true,
  missRadius: [0.5, 1.4] as const,
  accuracy: { start: 0.15, end: 0.45, rampSeconds: 3, moving: 0.6, sprinting: 0.4, crouched: 0.8 },
  runSpeed: MOVE.run,
  crouchSpeed: MOVE.crouch,
  sprintSpeed: MOVE.sprint,
  walkSpeed: MOVE.walk,
  magazine: 30,
  reloadSeconds: 2.5,
  acceleration: 18,
  flinchSeconds: 0.35,
  squadBarkSeconds: 0.9,
}

export type RoomId = 'yard' | 'lobby' | 'corridor' | 'side' | 'hall' | 'office' | 'exfil'

export type Acoustics = { volume: number; area: number; absorption: number; predelay: number }

export const ACOUSTICS: Record<RoomId, Acoustics> = {
  yard: { volume: 0, area: 0, absorption: 1, predelay: 0.12 },
  lobby: { volume: 10 * 8 * 3.2, area: 2 * 10 * 8 + 2 * (10 + 8) * 3.2, absorption: 0.1, predelay: 0.018 },
  corridor: { volume: 2.4 * 7 * 3, area: 2 * 2.4 * 7 + 2 * (2.4 + 7) * 3, absorption: 0.12, predelay: 0.007 },
  side: { volume: 3.5 * 6.5 * 3, area: 2 * 3.5 * 6.5 + 2 * (3.5 + 6.5) * 3, absorption: 0.2, predelay: 0.008 },
  hall: { volume: 14 * 12 * 5, area: 2 * 14 * 12 + 2 * (14 + 12) * 5, absorption: 0.08, predelay: 0.03 },
  office: { volume: 9 * 8 * 3, area: 2 * 9 * 8 + 2 * (9 + 8) * 3, absorption: 0.22, predelay: 0.014 },
  exfil: { volume: 0, area: 0, absorption: 1, predelay: 0.09 },
}

export const OUTDOOR_TAIL = 0.6
export const PHONE_TAIL_SCALE = 0.7

export function sabine(acoustics: Acoustics) {
  if (!acoustics.volume) return OUTDOOR_TAIL
  return 0.161 * acoustics.volume / (acoustics.area * acoustics.absorption)
}

export const FEET = {
  walk: 0.4,
  run: 0.3,
  sprint: 0.26,
  crouch: 0.5,
}

export const FEEDBACK = {
  hitMarkerSeconds: 0.12,
  killMarkerSeconds: 0.32,
  muzzleFlashSeconds: 0.05,
  tracerEvery: 3,
  tracerSpeed: 520,
  decals: 256,
  casings: 48,
  corpse: { minimumSeconds: 0.55, settledSeconds: 0.2, settledSpeed: 0.5, groundedHeight: 0.65 },
}

export const PRESENTATION = {
  animationInterval: { desktop: [2, 2, 3], phone: [3, 4, 6], hidden: 60 },
  animationBands: [10, 20] as const,
  animationBudget: { desktop: 2, phone: 1 },
  animationFloor: { desktop: 1, phone: 0.25 },
  armsPoseInterleave: { desktop: false, phone: true },
  corpseSeconds: { desktop: 2, phone: 1.2 },
  topple: { seconds: 0.55, lift: 0.13, bounce: { seconds: 0.3, angle: 0.1 } },
  ragdolls: { desktop: 3, phone: 2 },
  ragdoll: { desktop: 'als', phone: 'corpse' } as const,
  physicsHz: { desktop: 60, phone: 30 },
}

export type CorpseShape = { from: string; to: string; radius: number; beyond?: number }
export type CorpsePart = { bone: string; joint?: string; swing?: number; hinge?: { toward: string; flex: number; range: number }; shapes: CorpseShape[]; mass: number }

const limb = (side: 'l' | 'r'): CorpsePart[] => [
  { bone: `upperarm_${side}`, joint: 'spine_01', swing: 1.2, shapes: [{ from: `upperarm_${side}`, to: `lowerarm_${side}`, radius: 0.05 }], mass: 2.5 },
  { bone: `lowerarm_${side}`, joint: `upperarm_${side}`, hinge: { toward: `hand_${side}`, flex: 1, range: 1.6 }, shapes: [{ from: `lowerarm_${side}`, to: `hand_${side}`, radius: 0.045, beyond: 0.1 }], mass: 2 },
  { bone: `thigh_${side}`, joint: 'pelvis', swing: 1, shapes: [{ from: `thigh_${side}`, to: `calf_${side}`, radius: 0.075 }], mass: 8 },
  { bone: `calf_${side}`, joint: `thigh_${side}`, hinge: { toward: `foot_${side}`, flex: -1, range: 1.3 }, shapes: [{ from: `calf_${side}`, to: `foot_${side}`, radius: 0.055 }, { from: `foot_${side}`, to: `ball_${side}`, radius: 0.035 }], mass: 4.5 },
]

export const CORPSE_RAGDOLL = {
  parts: [
    { bone: 'pelvis', shapes: [{ from: 'thigh_l', to: 'thigh_r', radius: 0.12 }], mass: 12 },
    { bone: 'spine_01', joint: 'pelvis', swing: 0.6, shapes: [{ from: 'spine_01', to: 'neck_01', radius: 0.13 }, { from: 'upperarm_l', to: 'upperarm_r', radius: 0.07 }], mass: 26 },
    { bone: 'neck_01', joint: 'spine_01', swing: 0.6, shapes: [{ from: 'neck_01', to: 'head', radius: 0.1, beyond: 0.1 }], mass: 6 },
    ...limb('l'),
    ...limb('r'),
  ] as CorpsePart[],
  impulse: { bone: 'spine_01', at: 'spine_03', shot: 38, lift: 6 },
  group: 0x0008,
  collidesWith: 0x0001,
  linearDamping: 0.05,
  angularDamping: 1,
  friction: 0.9,
  hyperextend: 0.05,
  maximumSeconds: 4,
}

export function animationInterval(tier: 'desktop' | 'phone', distance: number, visible: boolean) {
  if (!visible) return PRESENTATION.animationInterval.hidden
  const band = PRESENTATION.animationBands.findIndex(limit => distance < limit)
  return PRESENTATION.animationInterval[tier][band < 0 ? 2 : band]!
}

export function animationBudget(tier: 'desktop' | 'phone', falling: number) {
  return Math.max(PRESENTATION.animationFloor[tier], PRESENTATION.animationBudget[tier] - falling)
}

export function scheduleAnimation(credit: Map<string, number>, intervals: ReadonlyMap<string, number>, budget: number, due: Set<string>) {
  due.clear()
  for (const [id, interval] of intervals) credit.set(id, Math.min(2, (credit.get(id) ?? 1) + 1 / interval))
  while (due.size < budget) {
    let best: string | null = null
    for (const id of intervals.keys()) if (!due.has(id) && credit.get(id)! >= 1 && (best === null || credit.get(id)! > credit.get(best)!)) best = id
    if (best === null) break
    due.add(best)
    credit.set(best, 0)
  }
  return due
}

export const BUDGET = {
  frameMs: 16,
  desktopTargetMs: 1000 / 120,
  phoneTargetMs: 1000 / 60,
  hitchMs: 33,
  drawCalls: { desktop: 260, phone: 160 },
  voices: 28,
  pointLights: { high: 5, medium: 4, low: 2 },
  firstPlayableSeconds: 5,
}

export const FEEL = {
  moveSpeed: MOVE.run,
  sprintSpeed: MOVE.sprint,
  timeToTopSpeed: timeToTopSpeed(MOVE.run),
  jumpApex: jumpApex(),
  tolerance: 0.1,
}

export const CHECK_BUDGET = {
  frameMs: BUDGET.desktopTargetMs,
  phoneFrameMs: BUDGET.phoneTargetMs,
  hitchMs: BUDGET.hitchMs,
  firstPlayableMs: BUDGET.firstPlayableSeconds * 1000,
  voices: BUDGET.voices,
}

export function sprintOk(intentForward: number, aiming: boolean, firing: boolean) {
  return intentForward > 0.3 && !aiming && !firing
}

export function moveSpeed(state: { sprinting: boolean; crouched: boolean; aiming: boolean; walking: boolean }) {
  const base = state.sprinting ? MOVE.sprint : state.crouched ? MOVE.crouch : state.walking ? MOVE.walk : MOVE.run
  return state.aiming && !state.sprinting ? Math.min(base, MOVE.aim) : base
}

export function aiHitChance(exposureSeconds: number, target: { moving: boolean; sprinting: boolean; crouched: boolean }) {
  const ramp = Math.min(1, Math.max(0, exposureSeconds / AI.accuracy.rampSeconds))
  let chance = AI.accuracy.start + (AI.accuracy.end - AI.accuracy.start) * ramp
  if (target.sprinting) chance *= AI.accuracy.sprinting
  else if (target.moving) chance *= AI.accuracy.moving
  if (target.crouched) chance *= AI.accuracy.crouched
  return chance
}

export function footInterval(state: { sprinting: boolean; crouched: boolean; walking: boolean }) {
  return state.sprinting ? FEET.sprint : state.crouched ? FEET.crouch : state.walking ? FEET.walk : FEET.run
}
