import { describe, expect, it } from 'vitest'
import type { AlsCharacterSnapshot } from 'als-ue5-r3f/als/AlsCharacterSnapshot'
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
