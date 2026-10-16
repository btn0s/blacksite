import { describe, expect, it } from 'vitest'
import { createAlsCharacter, refreshGait, refreshLocomotion } from '../../../vendor/als-web/src/als/AlsCharacter'
import { refreshGroundedMovementSettings } from '../../../vendor/als-web/src/als/AlsCharacterMovementComponent'
import {
  createSubject, createSubjectInputSource, keySubject, lookSubject, resetFpsInput,
  updateFpsMovementInput,
} from './controller'

function lockedController() {
  const controller = createSubject()
  controller.frame.locked = true
  return controller
}

describe('classic FPS input over one ALS player', () => {
  it('classifies authored running speed as Running instead of the old 300 m/s walking threshold', () => {
    const c = lockedController()
    keySubject(c, 'KeyW', true)
    updateFpsMovementInput(c)
    const input = createSubjectInputSource(c)()
    const classify = (walkSpeed?: number) => {
      const character = createAlsCharacter({ gaitSpeedOverrides: walkSpeed === undefined ? undefined : {
        Standing: { walkForwardSpeed: walkSpeed, walkBackwardSpeed: walkSpeed },
      } })
      character.desiredGait = input.desiredGait!
      refreshLocomotion(character, { x: 3.75, y: 0, z: 0 })
      Object.assign(character.movement.velocity, { x: 3.75, y: 0, z: 0 })
      refreshGait(character)
      refreshGroundedMovementSettings(character.movement, 0)
      return { gait: character.gait, gaitAmount: character.movement.gaitAmount, speed: character.movement.maxWalkSpeed }
    }
    expect(classify(300)).toEqual({ gait: 'Walking', gaitAmount: 0.0125, speed: 3.75 })
    expect(classify(input.desiredSpeed)).toEqual({ gait: 'Running', gaitAmount: 2, speed: 3.75 })
  })

  it('uses authored gait settings and camera-relative world direction at the ALS boundary', () => {
    const c = lockedController()
    const sample = createSubjectInputSource(c)
    keySubject(c, 'KeyW', true)
    updateFpsMovementInput(c)
    expect(sample()).toMatchObject({ desiredGait: 'Running', desiredStance: 'Standing', movementDirection: { x: 1, z: 0 } })
    expect(sample().desiredSpeed).toBeUndefined()
    c.player.command.yaw = 90
    expect(sample().movementDirection?.x).toBeCloseTo(0)
    expect(sample().movementDirection?.z).toBeCloseTo(1)
    keySubject(c, 'ShiftLeft', true)
    updateFpsMovementInput(c)
    expect(sample().desiredGait).toBe('Sprinting')
    expect(sample().desiredSpeed).toBeUndefined()
    keySubject(c, 'ControlLeft', true)
    updateFpsMovementInput(c)
    expect(sample()).toMatchObject({ desiredGait: 'Running', desiredStance: 'Crouching' })
    c.frame.locked = false
    updateFpsMovementInput(c)
    expect(sample().movementDirection).toEqual({ x: 0, z: 0 })
  })

  it('normalizes diagonal movement, cancels opposing keys and stops outside pointer lock', () => {
    const c = lockedController()
    keySubject(c, 'KeyW', true)
    keySubject(c, 'KeyD', true)
    updateFpsMovementInput(c)
    expect(Math.hypot(c.player.command.forward, c.player.command.right)).toBeCloseTo(1)
    keySubject(c, 'KeyA', true)
    updateFpsMovementInput(c)
    expect(c.player.command.right).toBe(0)
    c.frame.locked = false
    updateFpsMovementInput(c)
    expect(c.player.command.forward).toBe(0)
  })

  it('treats Shift as immediate hold sprint, with no tap-roll or release action', () => {
    const c = lockedController()
    keySubject(c, 'KeyW', true)
    keySubject(c, 'ShiftLeft', true)
    updateFpsMovementInput(c)
    expect(c.player.command.sprint).toBe(true)
    keySubject(c, 'ShiftLeft', false)
    updateFpsMovementInput(c)
    expect(c.player.command.sprint).toBe(false)
    expect(c.player.command.jumpSequence).toBe(0)
    expect(c.player.pose.current.character).toBeNull()
    keySubject(c, 'ShiftRight', true)
    c.input.aim = true
    updateFpsMovementInput(c)
    expect(c.player.command.sprint).toBe(false)
    expect(c.player.command.aim).toBe(true)
  })

  it('uses one jump edge per press despite OS repeats and repeat physics samples', () => {
    const c = lockedController()
    keySubject(c, 'Space', true)
    keySubject(c, 'Space', true, true)
    keySubject(c, 'Space', true)
    for (let i = 0; i < 5; i++) updateFpsMovementInput(c)
    expect(c.player.command.jumpSequence).toBe(1)
    keySubject(c, 'Space', false)
    keySubject(c, 'Space', true)
    expect(c.player.command.jumpSequence).toBe(2)
  })

  it('holds crouch and cancels sprint until Ctrl is released', () => {
    const c = lockedController()
    for (const key of ['KeyW', 'ShiftLeft', 'ControlLeft']) keySubject(c, key, true)
    updateFpsMovementInput(c)
    expect(c.player.command.crouch).toBe(true)
    expect(c.player.command.sprint).toBe(false)
    keySubject(c, 'ControlLeft', false)
    updateFpsMovementInput(c)
    expect(c.player.command.crouch).toBe(false)
    expect(c.player.command.sprint).toBe(true)
  })

  it('switches view and authored weapon overlays without replacing the player', () => {
    const c = lockedController()
    const player = c.player
    expect(player.command.bodyVisible).toBe(false)
    keySubject(c, 'KeyV', true)
    keySubject(c, 'KeyV', true, true)
    expect(c.view).toBe('third-person')
    expect(player.command.view).toBe('ThirdPerson')
    expect(player.command.bodyVisible).toBe(true)
    keySubject(c, 'Digit2', true)
    expect(c.weapon).toBe('pistol')
    expect(player.command.overlay).toBe('PistolTwoHanded')
    keySubject(c, 'Digit3', true)
    expect(player.command.overlay).toBe('Bow')
    expect(c.input.weaponSequence).toBe(2)
    expect(c.player).toBe(player)
  })

  it('clears latched movement/aim/fire on focus or pointer-lock loss', () => {
    const c = lockedController()
    keySubject(c, 'KeyW', true)
    c.input.fire = c.input.aim = true
    updateFpsMovementInput(c)
    resetFpsInput(c)
    updateFpsMovementInput(c)
    expect(c.keys.size).toBe(0)
    expect(c.input.fire).toBe(false)
    expect(c.input.aim).toBe(false)
    expect(c.player.command.forward).toBe(0)
    expect(c.player.command.aim).toBe(false)
  })

  it('bounds view pitch, wraps yaw and rejects nonfinite mouse/recoil input', () => {
    const c = lockedController()
    lookSubject(c, 50000, -50000)
    expect(c.player.command.pitch).toBe(85)
    expect(c.player.command.yaw).toBeGreaterThanOrEqual(-180)
    expect(c.player.command.yaw).toBeLessThan(180)
    const before = { ...c.player.command }
    lookSubject(c, NaN, 1)
    c.addRecoil(Infinity, 2)
    expect(c.player.command).toEqual(before)
    c.player.command.pitch = 0
    c.addRecoil(2, -1)
    expect(c.player.command.pitch).toBe(2)
    lookSubject(c, 0, 10)
    expect(c.player.command.pitch).toBeLessThan(2)
  })

  it('prevents disabled players from moving, jumping, looking or keeping a trigger latched', () => {
    const c = lockedController()
    c.input.fire = c.input.aim = true
    keySubject(c, 'KeyW', true)
    c.setEnabled(false)
    keySubject(c, 'Space', true)
    lookSubject(c, 100, 100)
    updateFpsMovementInput(c)
    expect(c.input.fire).toBe(false)
    expect(c.player.command.forward).toBe(0)
    expect(c.player.command.jumpSequence).toBe(0)
    expect(c.player.command.yaw).toBe(0)
    expect(c.getSnapshot().enabled).toBe(false)
  })

  it('respawns at a new feet position with a fresh ALS lifecycle and preserved view/weapon', () => {
    const c = lockedController()
    c.setView('third-person')
    c.setWeapon('bow')
    const beforePose = c.player.pose.current
    beforePose.ready = true
    c.input.fire = true
    c.setEnabled(false)
    let revisionEvents = 0
    const unsubscribe = c.player.subscribe(() => revisionEvents++)
    c.respawn([8, 0, -4], 90)
    expect(c.player.spawn).toEqual([8, 0, -4])
    expect(c.player.getRevision()).toBe(1)
    expect(revisionEvents).toBe(1)
    expect(c.player.pose.current).not.toBe(beforePose)
    expect(c.player.pose.current.ownerRigidBody).toBeNull()
    expect(c.player.pose.current.ready).toBe(false)
    expect(c.player.command.yaw).toBe(90)
    expect(c.view).toBe('third-person')
    expect(c.weapon).toBe('bow')
    expect(c.enabled).toBe(true)
    expect(c.input.fire).toBe(false)
    unsubscribe()
    expect(() => c.respawn([NaN, 0, 0])).toThrow('finite')
  })

  it('keeps sessions independent and sends HUD updates only for changed discrete state', () => {
    const first = createSubject()
    const second = createSubject()
    let notifications = 0
    const unsubscribe = first.subscribe(() => notifications++)
    const initial = first.getSnapshot()
    first.publish()
    expect(first.getSnapshot()).toBe(initial)
    expect(notifications).toBe(0)
    first.setWeapon('pistol')
    expect(notifications).toBe(1)
    expect(second.weapon).toBe('rifle')
    expect(second.player.command.overlay).toBe('Rifle')
    unsubscribe()
    first.setView('third-person')
    expect(notifications).toBe(1)
  })
})
