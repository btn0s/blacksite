import type { Binding, GlyphMap } from '@blacksite/input'
import { CHARACTER_GLYPHS, createCharacterController, type CharacterHandle } from '@blacksite/subject'
import type { Route } from './route'
import { camera, input as tuning } from './model'

const DEG = Math.PI / 180
const key = (action: string, code: string): Binding => ({ action, control: { device: 'keyboard', key: code }, trigger: 'pressed' })
const pad = (action: string, button: number): Binding => ({ action, control: { device: 'gamepad', button }, trigger: 'pressed' })
const touch = (action: string, button: string): Binding => ({ action, control: { device: 'touch', button }, trigger: 'pressed' })

export const TRAVERSE_BINDINGS: ReadonlyArray<Binding> = [
  key('restart', 'KeyR'), pad('restart', 8),
  key('checkpoint', 'KeyT'), pad('checkpoint', 13), touch('checkpoint', 'checkpoint'),
  key('ghost', 'KeyG'), pad('ghost', 12),
  key('pause', 'KeyP'),
]

export const TRAVERSE_GLYPHS: GlyphMap = {
  ...CHARACTER_GLYPHS,
  sprint: { ...CHARACTER_GLYPHS.sprint!, label: 'Sprint · tap roll' },
  jump: { ...CHARACTER_GLYPHS.jump!, label: 'Jump · mantle' },
  checkpoint: { label: 'Retry', keyboard: 'T', touch: 'Retry', gamepad: { xbox: 'D-pad ↓', playstation: 'D-pad ↓', generic: 'D-pad ↓' } },
  restart: { label: 'Restart', keyboard: 'R', gamepad: { xbox: 'View', playstation: 'Create', generic: 'Back' } },
  ghost: { label: 'Ghost', keyboard: 'G', gamepad: { xbox: 'D-pad ↑', playstation: 'D-pad ↑', generic: 'D-pad ↑' } },
}

export const TRAVERSE_HINTS = ['move', 'sprint', 'jump', 'crouch', 'shoulder', 'view', 'ragdoll', 'checkpoint', 'restart']

export const yawOf = (heading: number) => -heading - Math.PI / 2

export function createRunner(route: Route): CharacterHandle {
  return createCharacterController({
    views: ['shoulder', 'head'],
    start: { position: route.spawn, yaw: yawOf(route.spawnYaw), pitch: tuning.pitch * DEG },
    shoulderOffset: camera.shoulderOffset,
    look: { touchScale: tuning.touchScale, pitchMin: tuning.pitchMin * DEG, pitchMax: tuning.pitchMax * DEG },
    bindings: TRAVERSE_BINDINGS,
  })
}
