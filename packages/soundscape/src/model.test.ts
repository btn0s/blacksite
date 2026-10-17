import { describe, expect, it } from 'vitest'
import { attenuationAt, CLASS_ATTENUATION, distanceBetween, selectVariant, SPEED_OF_SOUND, voiceScore } from './model'
import type { CueVariant } from './types'

const variants: CueVariant[] = [
  { id: 'a', layers: [{ kind: 'noise', duration: 0.1, gain: 1 }] },
  { id: 'b', layers: [{ kind: 'noise', duration: 0.1, gain: 1 }] },
  { id: 'c', layers: [{ kind: 'noise', duration: 0.1, gain: 1 }] },
]

describe('cue selection', () => {
  it('never repeats the previous variant, including at either random boundary', () => {
    for (let previous = 0; previous < variants.length; previous++) {
      for (const random of [() => 0, () => 0.49, () => 0.999999]) {
        expect(selectVariant(variants, previous, 'random-no-repeat', random)).not.toBe(previous)
      }
    }
  })

  it('avoids the variants that start on either side of a delayed voice', () => {
    for (const random of [() => 0, () => 0.49, () => 0.999999]) {
      expect(selectVariant(variants, 2, 'random-no-repeat', random, [0, 1])).toBe(2)
      expect([0, 1, 2].filter(index => index !== 1)).toContain(selectVariant(variants, 0, 'random-no-repeat', random, [1]))
    }
    expect(selectVariant(variants, 0, 'random-no-repeat', () => 0, [0, 1, 2])).not.toBe(0)
  })

  it('walks the pool and wraps for round robin', () => {
    let selected = -1
    const sequence: number[] = []
    for (let index = 0; index < 7; index++) {
      selected = selectVariant(variants, selected, 'round-robin', () => 0)
      sequence.push(selected)
    }
    expect(sequence).toEqual([0, 1, 2, 0, 1, 2, 0])
  })
})

describe('spatial model', () => {
  it('keeps nearby sounds full, fades distant sounds, and virtualises beyond far range', () => {
    const curve = CLASS_ATTENUATION.foley
    expect(attenuationAt(1, curve)).toBe(1)
    expect(attenuationAt(15, curve)).toBeGreaterThan(attenuationAt(30, curve))
    expect(attenuationAt(45, curve)).toBe(0)
    expect(attenuationAt(300, curve)).toBe(0)
  })

  it('uses metres for travel time and prioritises voice over ambience at equal loudness', () => {
    const metres = distanceBetween([0, 0, 0], [0, 0, 343])
    expect(metres / SPEED_OF_SOUND).toBe(1)
    expect(voiceScore('voice', 0.4)).toBeGreaterThan(voiceScore('ambience', 0.4))
    expect(voiceScore('sfx', 0.8)).toBeGreaterThan(voiceScore('sfx', 0.2))
  })
})
