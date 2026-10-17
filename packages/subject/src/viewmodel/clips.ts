import type { ArmsWeapon } from '../arms/state'
import type { LeftAnchor } from './model'

export type ViewmodelAction = 'fire' | 'reload' | 'equip' | 'holster' | 'inspect'

export type Key = readonly [time: number, ...values: number[]]

export type Channel =
  | 'weapon.position' | 'weapon.rotation'
  | 'magazine.position' | 'magazine.rotation' | 'magazine.visible'
  | 'part' | 'left.freePosition' | 'left.freeRotation'
  | `left.${LeftAnchor}`

export type ClipEvent = 'grab' | 'magazineOut' | 'magazineIn' | 'rackBack' | 'rackForward' | 'raise'

export type Clip = { readonly duration: number; readonly channels: Partial<Record<Channel, readonly Key[]>>; readonly events?: readonly (readonly [time: number, event: ClipEvent])[] }

export type ClipSample = {
  weaponPosition: [number, number, number]
  weaponRotation: [number, number, number]
  magazinePosition: [number, number, number]
  magazineRotation: [number, number, number]
  magazineVisible: number
  part: number
  left: Record<LeftAnchor, number>
  leftFree: [number, number, number]
  leftFreeRotation: [number, number, number]
}

const ease = (t: number) => t * t * (3 - 2 * t)

function sampleChannel(keys: readonly Key[], time: number, out: number[]) {
  const width = keys[0].length - 1
  if (time <= keys[0][0]) { for (let index = 0; index < width; index++) out[index] = keys[0][index + 1]; return }
  const last = keys[keys.length - 1]
  if (time >= last[0]) { for (let index = 0; index < width; index++) out[index] = last[index + 1]; return }
  let next = 1
  while (keys[next][0] < time) next++
  const a = keys[next - 1]
  const b = keys[next]
  const t = ease((time - a[0]) / (b[0] - a[0]))
  for (let index = 0; index < width; index++) out[index] = a[index + 1] + (b[index + 1] - a[index + 1]) * t
}

export function createClipSample(): ClipSample {
  return {
    weaponPosition: [0, 0, 0], weaponRotation: [0, 0, 0], magazinePosition: [0, 0, 0], magazineRotation: [0, 0, 0], magazineVisible: 1,
    part: 0, left: { support: 1, magazine: 0, charge: 0, free: 0 }, leftFree: [-0.2, -0.45, -0.25], leftFreeRotation: [0, 0, 0],
  }
}

export function resetClipSample(sample: ClipSample) {
  sample.weaponPosition.fill(0)
  sample.weaponRotation.fill(0)
  sample.magazinePosition.fill(0)
  sample.magazineRotation.fill(0)
  sample.magazineVisible = 1
  sample.part = 0
  sample.left.support = 1
  sample.left.magazine = sample.left.charge = sample.left.free = 0
  sample.leftFree[0] = -0.2; sample.leftFree[1] = -0.45; sample.leftFree[2] = -0.25
  sample.leftFreeRotation.fill(0)
}

const scratch = [0, 0, 0]

export function sampleClip(clip: Clip, time: number, weight: number, sample: ClipSample) {
  const read = (channel: Channel) => {
    const keys = clip.channels[channel]
    if (!keys) return null
    sampleChannel(keys, time, scratch)
    return scratch
  }
  const add = (target: number[], channel: Channel) => {
    const values = read(channel)
    if (values) for (let index = 0; index < target.length; index++) target[index] += values[index] * weight
  }
  add(sample.weaponPosition, 'weapon.position')
  add(sample.weaponRotation, 'weapon.rotation')
  add(sample.magazinePosition, 'magazine.position')
  add(sample.magazineRotation, 'magazine.rotation')
  const visible = read('magazine.visible')
  if (visible) sample.magazineVisible += (visible[0] - 1) * weight
  const part = read('part')
  if (part) sample.part += part[0] * weight
  const anchors: LeftAnchor[] = ['support', 'magazine', 'charge', 'free']
  if (anchors.some(anchor => clip.channels[`left.${anchor}`])) {
    for (const anchor of anchors) {
      const value = read(`left.${anchor}`)
      const target = value ? value[0] : anchor === 'support' ? 1 : 0
      sample.left[anchor] += (target - sample.left[anchor]) * weight
    }
  }
  const free = read('left.freePosition')
  if (free) for (let index = 0; index < 3; index++) sample.leftFree[index] = free[index]
  const freeRotation = read('left.freeRotation')
  if (freeRotation) for (let index = 0; index < 3; index++) sample.leftFreeRotation[index] = freeRotation[index]
}

const d = Math.PI / 180

const rifleReload: Clip = {
  duration: 2.1,
  events: [[0.38, 'grab'], [0.5, 'magazineOut'], [1.28, 'magazineIn'], [1.68, 'rackBack'], [1.78, 'rackForward']],
  channels: {
    'weapon.position': [[0, 0, 0, 0], [0.24, -0.065, 0.12, -0.045], [0.5, -0.07, 0.115, -0.045], [1.26, -0.07, 0.115, -0.045], [1.32, -0.07, 0.13, -0.045], [1.42, -0.07, 0.115, -0.045], [1.62, -0.055, 0.1, -0.045], [1.74, -0.055, 0.095, -0.035], [1.86, -0.035, 0.065, -0.035], [2.1, 0, 0, 0]],
    'weapon.rotation': [[0, 0, 0, 0], [0.26, 8 * d, 25 * d, 48 * d], [1.2, 7 * d, 25 * d, 50 * d], [1.3, 10 * d, 24 * d, 48 * d], [1.42, 7 * d, 22 * d, 40 * d], [1.62, 7 * d, 25 * d, 24 * d], [1.86, 4 * d, 12 * d, 8 * d], [2.1, 0, 0, 0]],
    'magazine.position': [[0, 0, 0, 0], [0.42, 0, 0, 0], [0.56, 0, -0.07, 0.006], [0.84, -0.12, -0.22, 0.02], [0.86, -0.12, -0.22, 0.02], [1.08, 0, -0.12, 0.02], [1.2, 0, -0.035, 0.004], [1.3, 0, 0, 0]],
    'magazine.rotation': [[0, 0, 0, 0], [0.56, 0, 0, 0], [0.84, -0.4, 0.2, -0.2], [0.86, -0.3, 0.1, -0.1], [1.08, -0.08, 0, 0], [1.3, 0, 0, 0]],
    'magazine.visible': [[0, 1], [0.84, 1], [0.85, 0], [0.86, 1]],
    'part': [[0, 0], [1.62, 0], [1.7, 1], [1.74, 1], [1.79, 0]],
    'left.support': [[0, 1], [0.22, 1], [0.4, 0], [1.4, 0], [1.86, 0], [2.04, 1]],
    'left.magazine': [[0, 0], [0.22, 0], [0.4, 1], [1.3, 1], [1.46, 0]],
    'left.charge': [[0, 0], [1.3, 0], [1.48, 1], [1.76, 1], [1.88, 0]],
  },
}

const pistolReload: Clip = {
  duration: 1.35,
  events: [[0.14, 'magazineOut'], [0.8, 'magazineIn'], [0.95, 'rackBack'], [1.03, 'rackForward']],
  channels: {
    'weapon.position': [[0, 0, 0, 0], [0.16, -0.055, 0.11, -0.035], [0.78, -0.06, 0.11, -0.035], [0.84, -0.06, 0.125, -0.035], [0.92, -0.06, 0.11, -0.035], [1.1, -0.025, 0.055, -0.02], [1.35, 0, 0, 0]],
    'weapon.rotation': [[0, 0, 0, 0], [0.18, 16 * d, 34 * d, -32 * d], [0.78, 18 * d, 34 * d, -34 * d], [0.86, 21 * d, 32 * d, -30 * d], [0.98, 12 * d, 24 * d, -20 * d], [1.35, 0, 0, 0]],
    'magazine.position': [[0, 0, 0, 0], [0.14, 0, 0, 0], [0.34, 0, -0.21, 0.02], [0.35, 0, -0.21, 0.02], [0.4, -0.05, -0.27, 0.04], [0.6, 0, -0.14, 0.01], [0.72, 0, -0.03, 0], [0.82, 0, 0, 0]],
    'magazine.rotation': [[0, 0, 0, 0], [0.35, 0.3, 0, 0], [0.4, 0.2, 0, 0.1], [0.6, 0.05, 0, 0], [0.82, 0, 0, 0]],
    'magazine.visible': [[0, 1], [0.34, 1], [0.345, 0], [0.39, 0], [0.395, 1]],
    'part': [[0, 0], [0.9, 0], [0.95, 1], [1.0, 1], [1.04, 0]],
    'left.support': [[0, 1], [0.1, 1], [0.26, 0], [0.9, 0], [1.12, 1]],
    'left.freePosition': [[0, -0.12, -0.32, -0.26], [0.4, -0.1, -0.36, -0.24]],
    'left.freeRotation': [[0, 0.4, 0, -0.3]],
    'left.magazine': [[0, 0], [0.26, 0], [0.38, 1], [0.84, 1], [0.92, 0]],
    'left.charge': [[0, 0], [0.82, 0], [0.9, 1], [1.0, 1], [1.08, 0]],
  },
}

const equip = (seconds: number, depth: number): Clip => ({
  duration: seconds,
  events: [[seconds * 0.3, 'raise']],
  channels: {
    'weapon.position': [[0, 0.02, -0.3, 0.05], [seconds * 0.62, 0, 0.01, -0.004], [seconds * 0.82, 0, -0.004, 0.002], [seconds, 0, 0, 0]],
    'weapon.rotation': [[0, -depth, 0.35, 0.5], [seconds * 0.62, 0.03, -0.02, -0.04], [seconds * 0.82, -0.01, 0.006, 0.01], [seconds, 0, 0, 0]],
    'left.support': [[0, 0], [seconds * 0.35, 0], [seconds * 0.8, 1]],
    'left.freePosition': [[0, -0.16, -0.42, -0.3]],
    'left.freeRotation': [[0, 0.3, 0, -0.5]],
  },
})

const holster = (seconds: number, depth: number): Clip => ({
  duration: seconds,
  channels: {
    'weapon.position': [[0, 0, 0, 0], [seconds, 0.02, -0.32, 0.06]],
    'weapon.rotation': [[0, 0, 0, 0], [seconds, -depth, 0.3, 0.45]],
    'left.support': [[0, 1], [seconds * 0.5, 0]],
    'left.freePosition': [[0, -0.16, -0.42, -0.3]],
    'left.freeRotation': [[0, 0.3, 0, -0.5]],
  },
})

const rifleInspect: Clip = {
  duration: 3.2,
  channels: {
    'weapon.position': [[0, 0, 0, 0], [0.5, -0.07, 0.035, 0.06], [1.3, -0.07, 0.04, 0.06], [1.8, -0.05, 0.05, 0.05], [2.5, -0.05, 0.05, 0.05], [3.2, 0, 0, 0]],
    'weapon.rotation': [[0, 0, 0, 0], [0.5, 8 * d, -38 * d, 20 * d], [1.3, 10 * d, -42 * d, 26 * d], [1.8, -4 * d, -24 * d, -34 * d], [2.5, -6 * d, -22 * d, -38 * d], [3.2, 0, 0, 0]],
    'left.support': [[0, 1]],
  },
}

const pistolInspect: Clip = {
  duration: 2.6,
  channels: {
    'weapon.position': [[0, 0, 0, 0], [0.45, -0.07, 0.04, 0.08], [1.1, -0.07, 0.045, 0.08], [1.5, -0.05, 0.05, 0.07], [2.0, -0.05, 0.05, 0.07], [2.6, 0, 0, 0]],
    'weapon.rotation': [[0, 0, 0, 0], [0.45, 6 * d, -46 * d, 28 * d], [1.1, 8 * d, -50 * d, 34 * d], [1.5, 0, -10 * d, -60 * d], [2.0, -2 * d, -8 * d, -64 * d], [2.6, 0, 0, 0]],
    'left.support': [[0, 1], [0.3, 0], [2.2, 0], [2.55, 1]],
    'left.freePosition': [[0, -0.14, -0.34, -0.26]],
    'left.freeRotation': [[0, 0.4, 0, -0.3]],
  },
}

export const VIEWMODEL_CLIPS: Record<ArmsWeapon, Record<Exclude<ViewmodelAction, 'fire'>, Clip>> = {
  rifle: { reload: rifleReload, equip: equip(0.48, 0.9), holster: holster(0.2, 0.9), inspect: rifleInspect },
  pistol: { reload: pistolReload, equip: equip(0.38, 1.1), holster: holster(0.16, 1.1), inspect: pistolInspect },
}

export function switchSeconds(weapon: ArmsWeapon, from: ArmsWeapon = weapon) {
  return VIEWMODEL_CLIPS[from].holster.duration + VIEWMODEL_CLIPS[weapon].equip.duration
}
