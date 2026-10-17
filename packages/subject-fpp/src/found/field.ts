import type { ArmsWeapon } from '../arms/state'
import type { FoundWeapon } from './model'

type FieldWeapon = Omit<FoundWeapon, 'url'>

const range = (from: number, to: number, clip: string) => ({ clip, from, to })

const rifle: FieldWeapon = {
  fps: 30,
  clips: { idle: range(198, 222, 'Scene'), fire: range(0, 10, 'Scene'), reloadEmpty: range(10, 100, 'Scene'), reload: range(100, 152, 'Scene'), holster: range(152, 164, 'Scene'), draw: range(164, 177, 'Scene') },
  eye: { position: [-0.11, 0.22, 0.3], forward: [0, 0, -1] },
  sight: { bone: 'akm_base', rear: [0, 14.05, 26], front: [0, 14.09, 70.5] },
  eyeRelief: 0.5,
  hip: { position: [0, 0, 0], rotation: [0, 0, 0] },
  sprint: { position: [0.03, -0.05, 0.03], rotation: [-0.3, 0.55, 0.3] },
  pivot: [0.08, -0.12, -0.35],
  recoil: { hip: 0.5, aim: 1 },
  aimSeconds: 0.24,
  events: {
    reload: [[0.53, 'magazineOut'], [1.33, 'magazineIn']],
    reloadEmpty: [[0.53, 'magazineOut'], [1.4, 'magazineIn'], [2.07, 'rackBack'], [2.33, 'rackForward']],
  },
}

const pistol: FieldWeapon = {
  fps: 30,
  clips: { idle: range(234, 263, 'allanimations'), fire: range(0, 11, 'allanimations'), fireLast: range(83, 94, 'allanimations'), reload: range(12, 82, 'allanimations'), reloadEmpty: range(95, 175, 'allanimations'), holster: range(176, 188, 'allanimations'), draw: range(188, 198, 'allanimations'), inspect: range(198, 234, 'allanimations') },
  eye: { position: [0.03, 0.19, -0.12], forward: [0, 0, 1] },
  sight: { bone: 'pistol', rear: [0, 9.2, -0.6], front: [0, 9.25, 18.8] },
  eyeRelief: 0.28,
  hip: { position: [0.06, 0.01, -0.22], rotation: [0.1, -0.06, 0] },
  sprint: { position: [0.03, -0.03, 0.03], rotation: [-0.28, 0.3, 0.15] },
  pivot: [0.04, -0.14, -0.38],
  recoil: { hip: 0.5, aim: 1 },
  aimSeconds: 0.2,
  events: {
    reload: [[0.4, 'magazineOut'], [1.27, 'magazineIn'], [1.67, 'rackForward']],
    reloadEmpty: [[0.33, 'magazineOut'], [1.0, 'magazineIn'], [1.93, 'rackForward']],
  },
}

export const FIELD_WEAPONS: Record<ArmsWeapon, FieldWeapon> = { rifle, pistol }

export const FIELD_PORTRAIT = { aspect: 4 / 3, aimAspect: 1, camera: [-0.03, 0.08, 0.1] as [number, number, number] }
