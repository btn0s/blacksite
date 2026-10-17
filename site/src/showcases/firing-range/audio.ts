import { createSoundscape, type CueDefinition, type SoundLayer, type VoiceHandle } from '@blacksite/soundscape'
import type { ClipEvent } from '@blacksite/subject-fpp/arms'
import type { Vector3 } from 'three'
import type { Surface } from './hits'
import { RANGE_BUDGET } from './model'

type Weapon = 'rifle' | 'pistol'
type Soundscape = Pick<ReturnType<typeof createSoundscape>, 'prepare' | 'start' | 'setZone' | 'setListener' | 'update' | 'play' | 'registerCue' | 'sample' | 'dispose'>

const point = (value: Vector3): [number, number, number] => [value.x, value.y, value.z]
const burst = (frequency: number, gain: number, duration: number, offset: number, q = 3): SoundLayer => ({ kind: 'noise', gain, duration, offset, send: 0.04, filter: { type: 'bandpass', frequency, q } })

export function reloadCue(weapon: Weapon, events: readonly (readonly [number, ClipEvent])[]): CueDefinition {
  const pitch = weapon === 'rifle' ? 1 : 1.25
  const layers: SoundLayer[] = [burst(1200, 0.12, 0.18, 0, 0.8)]
  for (const [at, event] of events) {
    if (event === 'grab') layers.push(burst(900, 0.14, 0.08, at, 1.2))
    if (event === 'magazineOut') layers.push(burst(1800 * pitch, 0.45, 0.03, at), burst(900, 0.18, 0.1, at + 0.02, 1.2))
    if (event === 'magazineIn') layers.push(burst(1500 * pitch, 0.6, 0.03, at), burst(2400 * pitch, 0.35, 0.03, at + 0.02))
    if (event === 'rackBack') layers.push(burst(1300 * pitch, 0.55, 0.03, at))
    if (event === 'rackForward') layers.push(burst(2100 * pitch, 0.6, 0.03, at), burst(3200 * pitch, 0.25, 0.03, at + 0.012))
  }
  return { class: 'weapons', bus: 'weapons', reverbSend: 0.12, variants: [{ id: '1', layers }] }
}

export function createRangeAudio(soundscape: Soundscape = createSoundscape({ voiceCap: RANGE_BUDGET.voices, tier: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'phone' : 'desktop' })) {
  soundscape.prepare()
  let zoneSet = false
  const reloads = new Set<string>()
  let reloading: VoiceHandle | null = null

  return {
    start() {
      void soundscape.start()
      if (!zoneSet) { soundscape.setZone('outdoor'); zoneSet = true }
    },
    update(dt: number, position: Vector3, forward: Vector3) {
      soundscape.setListener({ position: point(position), forward: point(forward) })
      soundscape.update(dt)
    },
    shot(weapon: Weapon) {
      soundscape.play(`weapon.${weapon}`)
    },
    dry() {
      soundscape.play('weapon.dry')
    },
    steel(pitch: number, strength: number, position: Vector3) {
      soundscape.play('impact.steel', { position: point(position), pitch, volume: 0.5 + strength * 0.5, delay: true })
    },
    impact(surface: Surface, position: Vector3, distance: number) {
      if (distance > 70) return
      soundscape.play(`impact.${surface}`, { position: point(position), delay: true })
    },
    casing(position: Vector3) {
      soundscape.play('foley.casing', { position: point(position), volume: 1.6 })
    },
    reload(weapon: Weapon, events: readonly (readonly [number, ClipEvent])[]) {
      const cue = `range.reload.${weapon}.${events.map(([at, event]) => `${event}@${at}`).join(',')}`
      if (!reloads.has(cue)) { soundscape.registerCue(cue, reloadCue(weapon, events)); reloads.add(cue) }
      reloading?.stop()
      reloading = soundscape.play(cue)
    },
    cancelReload() {
      reloading?.stop()
      reloading = null
    },
    land(speed: number) {
      soundscape.play('landing.concrete', { volume: Math.min(1, speed / 6) })
    },
    equip() {
      soundscape.play('weapon.equip')
    },
    sample() {
      return soundscape.sample()
    },
    dispose() {
      soundscape.dispose()
    },
  }
}

export type RangeAudio = ReturnType<typeof createRangeAudio>
