import { describe, expect, it } from 'vitest'
import { createCharacterController } from './state'

describe('character controller', () => {
  it('cycles only through its own views and stays put with one', () => {
    const locked = createCharacterController({ views: ['arms'], start: { position: [0, 0, 0], yaw: 0 } })
    locked.cycleView()
    locked.setView('shoulder')
    expect(locked.status().view).toBe('arms')
    const both = createCharacterController({ views: ['shoulder', 'head'], start: { position: [0, 0, 0], yaw: 0 } })
    expect(both.status().view).toBe('shoulder')
    both.cycleView()
    expect(both.status().view).toBe('head')
    both.cycleView()
    expect(both.status().view).toBe('shoulder')
  })
})
