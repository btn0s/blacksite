import { describe, expect, it } from 'vitest'
import { advanceFootContact, contacts, type FootSample } from './model'

const sample = (index: number, x: number, planted = true): FootSample => ({ t: index / 60, x, y: 0.13, z: 0, ground: 0.13, grounded: true, planted })

describe('planted foot measurement', () => {
  it('waits for idle touchdown then retains a contact whose support goes wrong', () => {
    expect(advanceFootContact(false, { grounded: true, lock: 1, gap: 0.2, phase: -0.6 }).planted).toBe(false)
    const acquired = advanceFootContact(false, { grounded: true, lock: 1, gap: 0.01, phase: -0.6 })
    expect(acquired.groundedContact).toBe(true)
    expect(advanceFootContact(acquired.groundedContact, { grounded: true, lock: 1, gap: 0.2, phase: -0.6 }).planted).toBe(true)
    expect(advanceFootContact(true, { grounded: false, lock: 1, gap: 0, phase: 1 }).planted).toBe(false)
  })

  it('measures authored moving stance even when the foot misses the ground', () => {
    expect(advanceFootContact(false, { grounded: true, lock: 0, gap: 0.2, phase: 1 }).planted).toBe(true)
  })
  it('counts accumulated travel even when a sliding foot returns to its start', () => {
    const measured = contacts([0, 0, 0.01, 0.02, 0.01, 0, 0].map((x, index) => sample(index, x)))
    expect(measured).toHaveLength(1)
    expect(measured[0]!.drift).toBeCloseTo(0.6)
    expect(measured[0]!.excursion).toBeCloseTo(0.02)
  })

  it('keeps an authored planted foot measurable when its terrain support is wrong', () => {
    const measured = contacts(Array.from({ length: 9 }, (_, index) => ({ ...sample(index, index * 0.01), y: 0.33 })))
    expect(measured).toHaveLength(1)
    expect(measured[0]!.drift).toBeCloseTo(0.6)
  })

  it('splits contacts at toe-off without selecting samples by measured foot speed', () => {
    const measured = contacts(Array.from({ length: 15 }, (_, index) => sample(index, index * 0.02, index !== 7)))
    expect(measured).toHaveLength(2)
    for (const contact of measured) expect(contact.drift).toBeCloseTo(1.2)
  })

  it('does not report a contact without grounded terrain support', () => {
    expect(contacts(Array.from({ length: 9 }, (_, index) => ({ ...sample(index, 0), ground: -Infinity })))).toEqual([])
    expect(contacts(Array.from({ length: 9 }, (_, index) => ({ ...sample(index, 0), grounded: false })))).toEqual([])
  })
})
