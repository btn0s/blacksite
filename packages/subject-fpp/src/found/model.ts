import type { ClipEvent } from '../viewmodel/clips'
import type { ArmsWeapon } from '../arms/state'

export type Vec3 = [number, number, number]
export type FoundClip = 'idle' | 'walk' | 'run' | 'fire' | 'fireLast' | 'aimFire' | 'reload' | 'reloadEmpty' | 'draw' | 'holster' | 'inspect'
export type FoundClipSource = string | { clip: string; from: number; to: number }

export interface FoundWeapon {
  url: string
  fps: number
  scale?: number
  clips: Partial<Record<FoundClip, FoundClipSource>>
  eye: { position: Vec3; forward: Vec3; up?: Vec3 }
  sight: { bone: string; rear: Vec3; front: Vec3; up?: Vec3 }
  eyeRelief: number
  hip: { position: Vec3; rotation: Vec3 }
  sprint: { position: Vec3; rotation: Vec3 }
  pivot: Vec3
  recoil: { hip: number; aim: number }
  aimSeconds: number
  seconds?: Partial<Record<'reload' | 'reloadEmpty' | 'draw' | 'holster', number>>
  events?: Partial<Record<'reload' | 'reloadEmpty', readonly (readonly [number, ClipEvent])[]>>
  hide?: readonly string[]
}

export interface FoundSet {
  name: string
  credit: string
  portrait: { aspect: number; aimAspect: number; camera: Vec3 }
  weapons: Record<ArmsWeapon, FoundWeapon>
}

export const FOUND_HOLSTER = { seconds: 0.32, position: [0.02, -0.28, 0.06] as Vec3, rotation: [-0.9, 0.2, 0.35] as Vec3 }
export const FOUND_INSPECT = { seconds: 2.2, position: [-0.05, 0.035, 0.05] as Vec3, rotation: [0.18, 0.55, 0.6] as Vec3 }

export type FoundTiming = Pick<FoundWeapon, 'clips' | 'fps' | 'seconds'>

export function clipSeconds(spec: FoundTiming, clip: FoundClip) {
  const scaled = spec.seconds?.[clip as keyof NonNullable<FoundWeapon['seconds']>]
  if (scaled) return scaled
  const source = spec.clips[clip]
  return source && typeof source !== 'string' ? (source.to - source.from) / spec.fps : 0
}

export function foundTimings(set: { weapons: Record<ArmsWeapon, FoundTiming> }, weapon: ArmsWeapon) {
  const spec = set.weapons[weapon]
  const swap = (entry: FoundTiming, clip: 'draw' | 'holster') => clipSeconds(entry, clip) || FOUND_HOLSTER.seconds
  const other = set.weapons[weapon === 'rifle' ? 'pistol' : 'rifle']
  return { reloadSeconds: clipSeconds(spec, 'reload'), emptyReloadSeconds: clipSeconds(spec, 'reloadEmpty') || clipSeconds(spec, 'reload'), equipSeconds: Math.max(swap(other, 'holster') + swap(spec, 'draw'), swap(spec, 'holster') + swap(other, 'draw')) }
}
