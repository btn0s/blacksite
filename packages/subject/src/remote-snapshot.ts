import type { ClientMessage, PawnIntent, PawnState } from '@blacksite/relay'
import type { AlsCharacterSnapshot } from 'als-ue5-r3f/als/AlsCharacterSnapshot'
import { ALS_STANDING_CAPSULE_HALF_HEIGHT } from 'als-ue5-r3f/als/AlsCharacter.hooks'

export function createPawnMoveMessage(snapshot: AlsCharacterSnapshot, intent: PawnIntent, seq: number): Extract<ClientMessage, { type: 'move' }> {
  const animation = snapshot.animation
  const acceleration = animation?.relativeAcceleration
  return {
    type: 'move', seq,
    position: { x: snapshot.pos[0], y: snapshot.pos[1] - ALS_STANDING_CAPSULE_HALF_HEIGHT, z: snapshot.pos[2] },
    velocity: { x: snapshot.vel[0], y: snapshot.vel[1], z: snapshot.vel[2] },
    intent: { ...intent, yaw: snapshot.viewYaw, pitch: snapshot.viewPitch, aiming: snapshot.aiming },
    locomotion: {
      gait: snapshot.gait, stance: snapshot.stance, mode: snapshot.locomotionMode,
      actorYaw: snapshot.actorYaw, rotationMode: snapshot.rotationMode,
      hasInput: animation?.hasInput ?? Math.hypot(snapshot.vel[0], snapshot.vel[2]) > 0.01,
      inputYaw: animation?.inputYaw ?? Math.atan2(snapshot.vel[2], snapshot.vel[0]) * 180 / Math.PI,
      targetYaw: animation?.targetYaw ?? snapshot.actorYaw,
      relativeAcceleration: {
        x: Math.max(-1, Math.min(1, acceleration?.x ?? 0)),
        y: Math.max(-1, Math.min(1, acceleration?.y ?? 0)),
      },
      action: snapshot.action, actionSeq: snapshot.actionSeq,
      mantle: animation?.mantle && { ...animation.mantle },
      rolling: animation?.rolling && { ...animation.rolling },
    },
  }
}

export function toAlsRemoteSnapshot(state: PawnState): AlsCharacterSnapshot {
  const locomotion = state.locomotion
  const speed = Math.hypot(state.velocity.x, state.velocity.z)
  return {
    t: state.t, pos: [state.position.x, state.position.y + ALS_STANDING_CAPSULE_HALF_HEIGHT, state.position.z],
    vel: [state.velocity.x, state.velocity.y, state.velocity.z],
    actorYaw: locomotion?.actorYaw ?? state.yaw, viewYaw: state.yaw, viewPitch: state.pitch,
    gait: locomotion?.gait ?? (speed > 4 ? 'sprinting' : 'running'),
    stance: locomotion?.stance ?? 'standing',
    rotationMode: locomotion?.rotationMode ?? (state.aiming ? 'aiming' : 'viewDirection'),
    locomotionMode: locomotion?.mode ?? 'grounded',
    action: locomotion?.action ?? 'none', actionSeq: locomotion?.actionSeq ?? 0, overlay: state.weapon === 'pistol' ? 'pistol' : 'rifle', aiming: state.aiming ?? false, seq: state.seq,
    animation: locomotion ? {
      hasInput: locomotion.hasInput, inputYaw: locomotion.inputYaw, targetYaw: locomotion.targetYaw,
      relativeAcceleration: { ...locomotion.relativeAcceleration },
      mantle: locomotion.mantle && { ...locomotion.mantle },
      rolling: locomotion.rolling && { ...locomotion.rolling },
    } : undefined,
  }
}
