import { createAudioLog, type AudioSample } from '@blacksite/check'
import { isTouchDevice } from '@blacksite/look/world'
import { BUDGET } from './model'

export type Vec3 = [number, number, number]

export interface Sound {
  start(): unknown
  setZone(name: string): void
  play(cue: string, options?: { position?: Vec3; delay?: boolean }): unknown
  setListener(listener: { position: Vec3; forward?: Vec3 }): void
  setBusVolume(bus: 'master', gain: number): void
  update(dt: number): void
  sample(): AudioSample
}

export const soundTier = isTouchDevice() ? 'phone' : 'desktop'
export const voiceCap = soundTier === 'phone' ? BUDGET.phoneVoices : BUDGET.voices

function silentUntilSoundscape(): Sound {
  const log = createAudioLog()
  return { start() {}, setZone() {}, play() {}, setListener() {}, setBusVolume() {}, update() {}, sample: () => log.sample() }
}

export const sound: Sound = silentUntilSoundscape()
