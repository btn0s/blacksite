import type { Binding, InputRuntime } from '@blacksite/input'
import { createCharacterController, type CharacterHandle } from '@blacksite/subject'
import { camera, input as tuning, site } from './model'

const DEG = Math.PI / 180

export const VALLEY_BINDINGS: ReadonlyArray<Binding> = [
  { action: 'home', control: { device: 'keyboard', key: 'KeyR' }, trigger: 'pressed' },
  { action: 'home', control: { device: 'gamepad', button: 8 }, trigger: 'pressed' },
  { action: 'home', control: { device: 'touch', button: 'home' }, trigger: 'pressed' },
]

export const VALLEY_GLYPHS = {
  home: { label: 'Tarn', keyboard: 'R', touch: 'Home', gamepad: { xbox: 'View', playstation: 'Create', generic: 'Back' } },
}

export const yawOf = (heading: number) => -heading - Math.PI / 2

export function createWalker(spawn: readonly [number, number, number], input: InputRuntime): CharacterHandle {
  return createCharacterController({
    views: ['shoulder', 'head'],
    start: { position: [spawn[0], spawn[1], spawn[2]], yaw: yawOf(site.spawnYaw), pitch: tuning.pitch * DEG },
    shoulderOffset: camera.shoulderOffset,
    look: { touchScale: tuning.touchScale, pitchMin: tuning.pitchMin * DEG, pitchMax: tuning.pitchMax * DEG },
    bindings: VALLEY_BINDINGS,
    input,
  })
}
