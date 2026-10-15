import { describe, expect, it } from 'vitest'
import { readStandaloneIntent } from './intent'

describe('standalone subject intent', () => {
  it('normalizes diagonal movement and keeps jump as an action', () => {
    const intent = readStandaloneIntent(new Set(['KeyW', 'KeyD', 'Space']))
    expect(intent.forward).toBeCloseTo(Math.SQRT1_2)
    expect(intent.right).toBeCloseTo(Math.SQRT1_2)
    expect(intent.jump).toBe(true)
  })

  it('cancels opposing movement keys', () => {
    expect(readStandaloneIntent(new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD']))).toEqual({ forward: 0, right: 0, jump: false })
  })
})
