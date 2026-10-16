import { createSoundscape } from '@blacksite/soundscape'
import type { Vector3 } from 'three'
import type { Surface } from './hits'

type Weapon = 'rifle' | 'pistol'

const point = (value: Vector3): [number, number, number] => [value.x, value.y, value.z]

export function createRangeAudio() {
  const soundscape = createSoundscape({ tier: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'phone' : 'desktop' })
  soundscape.prepare()
  let zoneSet = false

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
    reload(weapon: Weapon) {
      soundscape.play(`weapon.reload.${weapon}`)
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
