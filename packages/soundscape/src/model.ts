import type { Attenuation, CueVariant, SoundClass, Vec3 } from './types'

export const SPEED_OF_SOUND = 343

export const CLASS_ATTENUATION: Record<SoundClass, Attenuation> = {
  weapons: { near: 3, far: 200, rolloff: 1.1 },
  sfx: { near: 2, far: 100, rolloff: 1.2 },
  foley: { near: 1.5, far: 45, rolloff: 1.3 },
  ambience: { near: 4, far: 160, rolloff: 0.8 },
  music: { near: 1, far: Infinity, rolloff: 0 },
  ui: { near: 1, far: Infinity, rolloff: 0 },
  voice: { near: 2, far: 55, rolloff: 1.1 },
}

export const CLASS_PRIORITY: Record<SoundClass, number> = {
  weapons: 6,
  voice: 7,
  ui: 8,
  sfx: 4,
  foley: 3,
  music: 2,
  ambience: 1,
}

export function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

export function attenuationAt(distance: number, curve: Attenuation): number {
  if (distance <= curve.near) return 1
  if (distance >= curve.far) return 0
  const falloff = 1 / (1 + Math.pow((distance - curve.near) / Math.max(1, curve.near), curve.rolloff ?? 1))
  const fade = Number.isFinite(curve.far) ? Math.min(1, (curve.far - distance) / Math.max(1, curve.far * 0.2)) : 1
  return falloff * fade
}

export function selectVariant(
  variants: readonly CueVariant[],
  previous: number,
  selection: 'random-no-repeat' | 'round-robin',
  random: () => number,
  avoid: readonly number[] = [],
): number {
  if (variants.length < 2) return 0
  if (selection === 'round-robin') return (previous + 1) % variants.length
  if (avoid.length) {
    const open = variants.map((_, index) => index).filter(index => !avoid.includes(index))
    if (open.length) return open[Math.min(open.length - 1, Math.floor(random() * open.length))]!
  }
  const choice = Math.min(variants.length - 2, Math.floor(random() * (variants.length - 1)))
  return choice >= previous ? choice + 1 : choice
}

export function jitterGain(random: () => number, db = 1.5): number {
  return Math.pow(10, ((random() * 2 - 1) * db) / 20)
}

export function jitterPitch(random: () => number, fraction = 0.05): number {
  return 1 + (random() * 2 - 1) * fraction
}

export function voiceScore(soundClass: SoundClass, loudness: number): number {
  return CLASS_PRIORITY[soundClass] * 10 + Math.max(0, loudness) * 10
}
