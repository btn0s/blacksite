import { describe, expect, it } from 'vitest'
import { createLocalClock } from './session'

describe('local session clock', () => {
  it('stops while the session is paused and resumes where it stopped', () => {
    let time = 1000
    const clock = createLocalClock(() => time)
    time += 100
    const before = clock.now()
    clock.setRunning(false)
    time += 5000
    expect(clock.now()).toBe(before)
    clock.setRunning(true)
    expect(clock.now()).toBe(before)
    time += 50
    expect(clock.now()).toBe(before + 50)
  })
})
