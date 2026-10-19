import type { Binding, InputRuntime } from '@blacksite/input'
import { createCharacterController, type CharacterHandle } from '@blacksite/subject'
import { camera, input as tuning, type ValleyBookmark } from './model'

const DEG = Math.PI / 180

export const VALLEY_BINDINGS: ReadonlyArray<Binding> = [
  { action: 'home', control: { device: 'keyboard', key: 'KeyR' }, trigger: 'pressed' },
  { action: 'home', control: { device: 'gamepad', button: 8 }, trigger: 'pressed' },
  { action: 'home', control: { device: 'touch', button: 'home' }, trigger: 'pressed' },
]

export const VALLEY_GLYPHS = {
  home: { label: 'Watchtower', keyboard: 'R', touch: 'Home', gamepad: { xbox: 'View', playstation: 'Create', generic: 'Back' } },
}

export const yawOf = (heading: number) => -heading - Math.PI / 2

export function createWalker(bookmark: ValleyBookmark, input: InputRuntime): CharacterHandle {
  const spawn = bookmark.position
  const dx = bookmark.target[0] - spawn[0], dz = bookmark.target[2] - spawn[2]
  const yaw = Math.atan2(-dx, -dz)
  const pitch = Math.atan2(bookmark.target[1] - spawn[1] - 1.6, Math.hypot(dx, dz))
  return createCharacterController({
    views: ['shoulder'],
    start: { position: [spawn[0], spawn[1], spawn[2]], yaw, pitch },
    shoulderOffset: camera.shoulderOffset,
    look: { touchScale: tuning.touchScale, pitchMin: tuning.pitchMin * DEG, pitchMax: tuning.pitchMax * DEG },
    bindings: VALLEY_BINDINGS,
    input,
  })
}
