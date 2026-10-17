import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCharacterController } from './state'

describe('character controller', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('stops world time while paused and resumes where it stopped', () => {
    let time = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => time)
    const player = createCharacterController({ views: ['arms'], start: { position: [0, 0, 0], yaw: 0 } })
    time += 100
    const before = player.now()
    player.setPaused(true)
    time += 5000
    expect(player.now()).toBe(before)
    player.setPaused(false)
    expect(player.now()).toBe(before)
    time += 50
    expect(player.now()).toBe(before + 50)
  })

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
