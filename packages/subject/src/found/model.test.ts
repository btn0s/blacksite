import { describe, expect, it } from 'vitest'
import { FOUND_HOLSTER, clipSeconds, foundTimings, type FoundSet, type FoundWeapon } from './model'
import { FIELD_SET } from './sets'

const weapon = (clips: FoundWeapon['clips'], seconds?: FoundWeapon['seconds']): FoundWeapon => ({
  url: 'weapon.glb',
  fps: 30,
  clips,
  seconds,
  eye: { position: [0, 0, 0], forward: [0, 0, -1] },
  sight: { bone: 'sight', rear: [0, 0, 0], front: [0, 0, 1] },
  eyeRelief: 0.3,
  hip: { position: [0, 0, 0], rotation: [0, 0, 0] },
  world: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
  sprint: { position: [0, 0, 0], rotation: [0, 0, 0] },
  pivot: [0, 0, 0],
  recoil: { hip: 0.5, aim: 1 },
  aimSeconds: 0.2,
  events: {},
})

describe('found timing model', () => {
  it('derives clip lengths from frame ranges and honours overrides', () => {
    const spec = weapon({ reload: { clip: 'all', from: 10, to: 70 }, draw: 'Draw' }, { draw: 0.4 })
    expect(clipSeconds(spec, 'reload')).toBe(2)
    expect(clipSeconds(spec, 'draw')).toBe(0.4)
    expect(clipSeconds(spec, 'holster')).toBe(0)
  })

  it('falls back to the procedural holster and the normal reload', () => {
    const set: FoundSet = {
      name: 'test',
      credit: 'CREDITS.md',
      portrait: { aspect: 4 / 3 },
      weapons: {
        rifle: weapon({ reload: { clip: 'all', from: 0, to: 60 }, draw: { clip: 'all', from: 60, to: 75 } }),
        pistol: weapon({ reload: { clip: 'all', from: 0, to: 45 }, reloadEmpty: { clip: 'all', from: 45, to: 105 } }),
      },
    }
    const rifle = foundTimings(set, 'rifle')
    const pistol = foundTimings(set, 'pistol')
    expect([rifle.reloadSeconds, rifle.emptyReloadSeconds, pistol.reloadSeconds, pistol.emptyReloadSeconds]).toEqual([2, 2, 1.5, 2])
    expect(rifle.equipSeconds).toBeCloseTo(FOUND_HOLSTER.seconds + 0.5)
    expect(pistol.equipSeconds).toBeCloseTo(rifle.equipSeconds)
  })

  it('covers every gameplay action in the field set', () => {
    for (const id of ['rifle', 'pistol'] as const) {
      const timings = foundTimings(FIELD_SET, id)
      expect(timings.reloadSeconds).toBeGreaterThan(1)
      expect(timings.emptyReloadSeconds).toBeGreaterThanOrEqual(timings.reloadSeconds)
      expect(timings.equipSeconds).toBeGreaterThan(0.5)
      const spec = FIELD_SET.weapons[id]
      for (const [action, events] of Object.entries(spec.events ?? {})) {
        const length = clipSeconds(spec, action as 'reload' | 'reloadEmpty')
        for (const [at] of events ?? []) expect(at).toBeLessThan(length)
      }
    }
  })
})
