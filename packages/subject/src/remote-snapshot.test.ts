import { describe, expect, it } from 'vitest'
import type { AlsCharacterSnapshot } from 'als-ue5-r3f/als/AlsCharacterSnapshot'
import { createSubject, hasControl, keySubject, updateFpsMovementInput } from './controller'
import { createPawnMoveMessage, toAlsRemoteSnapshot } from './remote-snapshot'

const snapshot: AlsCharacterSnapshot = {
  t: 10, pos: [1, 0.9, 2], vel: [0, 1.5, 3], actorYaw: 40, viewYaw: 42, viewPitch: -5,
  gait: 'running', stance: 'standing', rotationMode: 'viewDirection', locomotionMode: 'grounded',
  action: 'mantle', actionSeq: 4, overlay: 'rifle', aiming: false, seq: 7,
  animation: { hasInput: true, inputYaw: 40, targetYaw: 40, relativeAcceleration: { x: 0.2, y: 0 }, mantle: { settings: 'High', position: 0.35 } },
}

describe('remote snapshot adapter', () => {
  it('carries mantle actions and montage position across the wire', () => {
    const message = createPawnMoveMessage(snapshot, { forward: 1, right: 0, jump: true, yaw: 42, pitch: -5 }, 1)
    const remote = toAlsRemoteSnapshot({ id: 'a', owner: 'a', authority: 'owner', seq: 1, t: 20, position: message.position, velocity: message.velocity, yaw: 42, pitch: -5, health: 100, locomotion: message.locomotion })
    expect(remote.action).toBe('mantle')
    expect(remote.actionSeq).toBe(4)
    expect(remote.animation?.mantle).toEqual({ settings: 'High', position: 0.35 })
    expect(remote.pos[1]).toBeCloseTo(0.9)
  })
})

describe('virtual input', () => {
  it('lets a touch pad or script move the player without pointer lock', () => {
    const controller = createSubject()
    keySubject(controller, 'KeyW', true)
    updateFpsMovementInput(controller)
    expect(controller.player.command.forward).toBe(0)
    controller.setVirtual(true)
    expect(hasControl(controller)).toBe(true)
    keySubject(controller, 'KeyW', true)
    updateFpsMovementInput(controller)
    expect(controller.player.command.forward).toBe(1)
    expect(controller.player.command.active).toBe(true)
    controller.setVirtual(false)
    expect(controller.keys.size).toBe(0)
  })
})
