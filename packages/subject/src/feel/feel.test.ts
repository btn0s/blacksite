import { describe, expect, it } from 'vitest'
import { createCameraFeel } from './camera'
import { createCameraImpulse } from './impulse'
import { createGunFeel } from './gun'
import { createAimRecoil, RECOIL_TUNING } from './recoil'
import { advanceReadiness, createReadiness } from './readiness'
import { drive, spring } from './spring'

describe('feel', () => {
  it('drives springs identically at any frame rate', () => {
    const fast = spring()
    const slow = spring()
    fast.v = slow.v = 3
    for (let i = 0; i < 240; i++) drive(fast, 0, 3.2, 0.5, 1 / 240)
    for (let i = 0; i < 30; i++) drive(slow, 0, 3.2, 0.5, 1 / 30)
    expect(slow.x).toBeCloseTo(fast.x, 6)
    expect(slow.v).toBeCloseTo(fast.v, 6)
  })

  it('climbs during a burst and recovers on its own after release', () => {
    const recoil = createAimRecoil()
    let peak = 0
    for (let frame = 0; frame < 60; frame++) {
      if (frame % 6 === 0) recoil.shot(0.01, 0.002, RECOIL_TUNING.rifle)
      peak = Math.max(peak, recoil.step(1 / 60).pitch)
    }
    expect(peak).toBeGreaterThan(0.04)
    for (let frame = 0; frame < 60; frame++) recoil.step(1 / 60)
    expect(recoil.offset.pitch).toBeLessThan(peak * 0.3)
    for (let frame = 0; frame < 120; frame++) recoil.step(1 / 60)
    expect(Math.abs(recoil.offset.pitch)).toBeLessThan(peak * 0.05)
  })

  it('raises the weapon continuously and honours a fire press during sprint', () => {
    const state = createReadiness()
    advanceReadiness(state, 0, 'sprint', false)
    advanceReadiness(state, 0.13, 'sprint', false)
    const mid = state.lowered
    expect(mid).toBeGreaterThan(0.3)
    advanceReadiness(state, 0.14, 'sprint', true)
    expect(state.phase).toBe('raising')
    expect(Math.abs(state.lowered - mid)).toBeLessThan(0.1)
    advanceReadiness(state, 0.5, 'sprint', true)
    expect(state.phase).toBe('raised')
  })

  it('bobs the camera with distance and dips on landing', () => {
    const camera = createCameraFeel()
    let low = 0
    for (let i = 0; i < 120; i++) low = Math.min(low, camera.step({ speed: 3.8, lateral: 0, grounded: true, sprinting: false, aim: 0 }, 90, 68, 1 / 60).y)
    expect(low).toBeLessThan(-0.015)
    expect(camera.footfalls).toBeGreaterThan(3)
    camera.land(6)
    let dip = 0
    for (let i = 0; i < 30; i++) dip = Math.min(dip, camera.step({ speed: 0, lateral: 0, grounded: true, sprinting: false, aim: 0 }, 90, 68, 1 / 60).y)
    expect(dip).toBeLessThan(-0.002)
  })

  it('answers a blast with a recovering kick that fades with distance and leans away', () => {
    const peak = (distance: number, side: number) => {
      const impulse = createCameraImpulse()
      impulse.blast({ x: side * distance, y: 1.6, z: -distance }, 1, { x: 0, y: 1.6, z: 0 }, 0)
      let pitch = 0
      let roll = 0
      for (let i = 0; i < 30; i++) { const pose = impulse.step(1 / 60); pitch = Math.max(pitch, pose.pitch); roll = Math.abs(pose.roll) > Math.abs(roll) ? pose.roll : roll }
      for (let i = 0; i < 240; i++) impulse.step(1 / 60)
      return { pitch, roll, rest: Math.abs(impulse.pose.pitch) + Math.abs(impulse.pose.roll) + Math.abs(impulse.pose.y) }
    }
    const near = peak(4, 1)
    const far = peak(40, 1)
    expect(near.pitch).toBeGreaterThan(0.005)
    expect(near.pitch).toBeLessThan(0.05)
    expect(far.pitch).toBeLessThan(near.pitch * 0.1)
    expect(near.roll).toBeLessThan(0)
    expect(peak(4, -1).roll).toBeGreaterThan(0)
    expect(near.rest).toBeLessThan(1e-4)
    expect(peak(200, 1).pitch).toBe(0)
  })

  it('kicks the gun back and settles', () => {
    const gun = createGunFeel()
    gun.shot({ fired: 1, control: 1, punch: 0.0105, side: 0.0038, camera: 1, wander: 0.2 })
    let peak = 0
    for (let i = 0; i < 60; i++) {
      gun.step({ forward: 0, lateral: 0, pitchRate: 0, yawRate: 0, heft: 1, sprint: 0 }, 1 / 120)
      peak = Math.max(peak, gun.place(0, 0, 1).pivot.position.z)
    }
    expect(peak).toBeGreaterThan(0.004)
    for (let i = 0; i < 240; i++) gun.step({ forward: 0, lateral: 0, pitchRate: 0, yawRate: 0, heft: 1, sprint: 0 }, 1 / 120)
    expect(Math.abs(gun.place(0, 0, 1).pivot.position.z)).toBeLessThan(1e-4)
  })
})
