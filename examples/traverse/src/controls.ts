import { createGameplayContext, type Binding } from '@blacksite/input'
import type { AlsCharacterCodeInput } from 'als-ue5-r3f/als/AlsCharacter.hooks'
import { input as tuning } from './model'

const key = (action: string, code: string, trigger: Binding['trigger'] = 'down'): Binding => ({ action, control: { device: 'keyboard', key: code }, trigger })
const pad = (action: string, button: number, trigger: Binding['trigger'] = 'down'): Binding => ({ action, control: { device: 'gamepad', button }, trigger })
const touch = (action: string, button: string, trigger: Binding['trigger'] = 'down'): Binding => ({ action, control: { device: 'touch', button }, trigger })

export const TRAVERSE_INPUT = createGameplayContext([
  key('forward', 'KeyW'), key('forward', 'ArrowUp'),
  key('back', 'KeyS'), key('back', 'ArrowDown'),
  key('left', 'KeyA'), key('left', 'ArrowLeft'),
  key('right', 'KeyD'), key('right', 'ArrowRight'),
  key('sprint', 'ShiftLeft'), pad('sprint', 10), pad('sprint', 4), touch('sprint', 'sprint'),
  key('jump', 'Space', 'pressed'), pad('jump', 0, 'pressed'), touch('jump', 'jump', 'pressed'),
  pad('roll', 1, 'pressed'), touch('roll', 'roll', 'pressed'), key('roll', 'KeyQ', 'pressed'),
  key('crouch', 'ControlLeft', 'pressed'), pad('crouch', 2, 'pressed'), touch('crouch', 'crouch', 'pressed'),
  key('walk', 'AltLeft', 'pressed'),
  key('ragdoll', 'KeyX', 'pressed'), pad('ragdoll', 3, 'pressed'), touch('ragdoll', 'ragdoll', 'pressed'),
  key('shoulder', 'KeyC', 'pressed'), pad('shoulder', 5, 'pressed'), touch('shoulder', 'shoulder', 'pressed'),
  key('restart', 'KeyR', 'pressed'), pad('restart', 8, 'pressed'),
  key('checkpoint', 'KeyT', 'pressed'), pad('checkpoint', 13, 'pressed'),
  key('ghost', 'KeyG', 'pressed'),
], 'traverse')

export type Command = {
  forward: number
  right: number
  sprint: boolean
  walk: boolean
  crouch: boolean
  jumpSequence: number
  rollSequence: number
  ragdollSequence: number
  yaw: number
  pitch: number
  rightShoulder: boolean
  active: boolean
}

export const createCommand = (yaw = 0): Command => ({ forward: 0, right: 0, sprint: false, walk: false, crouch: false, jumpSequence: 0, rollSequence: 0, ragdollSequence: 0, yaw, pitch: -12, rightShoulder: true, active: true })

export function look(command: Command, dxDegrees: number, dyDegrees: number) {
  command.yaw = ((command.yaw + dxDegrees + 540) % 360) - 180
  command.pitch = Math.max(tuning.pitchMin, Math.min(tuning.pitchMax, command.pitch - dyDegrees))
}

export function codeInput(command: Command): AlsCharacterCodeInput {
  const yaw = command.yaw * Math.PI / 180
  const fx = Math.cos(yaw)
  const fz = Math.sin(yaw)
  let x = fx * command.forward - fz * command.right
  let z = fz * command.forward + fx * command.right
  const length = Math.hypot(x, z)
  if (length > 1) { x /= length; z /= length }
  const gentle = length > 0 && length < tuning.walkStick
  return {
    active: command.active,
    jumpSequence: command.jumpSequence,
    rollSequence: command.rollSequence,
    ragdollSequence: command.ragdollSequence,
    movementDirection: { x, z },
    desiredGait: command.walk || gentle ? 'Walking' : command.sprint ? 'Sprinting' : 'Running',
    desiredStance: command.crouch ? 'Crouching' : 'Standing',
    desiredRotationMode: 'VelocityDirection',
    viewYawAngle: command.yaw,
    viewPitchAngle: command.pitch,
    aiming: false,
    overlayMode: 'Default',
  }
}

export function stickCurve(value: number) {
  const dead = tuning.stickDeadZone
  const magnitude = Math.abs(value)
  if (magnitude < dead) return 0
  const normalized = (magnitude - dead) / (1 - dead)
  return Math.sign(value) * normalized * normalized
}
