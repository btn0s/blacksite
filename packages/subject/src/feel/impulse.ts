import type { Object3D } from 'three'
import { CAMERA_FEEL } from './model'
import { driveWith, resetSpring, spring } from './spring'

export type ImpulsePoint = { readonly x: number; readonly y: number; readonly z: number }

export type ImpulsePose = { y: number; pitch: number; roll: number }

export type CameraKick = { dip?: number; pitch?: number; roll?: number }

export function blastFalloff(distance: number, impulse = CAMERA_FEEL.impulse) {
  if (!(distance < impulse.reach)) return 0
  const near = impulse.falloff * impulse.falloff
  return near / (near + distance * distance)
}

export function createCameraImpulse() {
  const dip = spring()
  const pitch = spring()
  const roll = spring()
  const pose: ImpulsePose = { y: 0, pitch: 0, roll: 0 }
  return {
    pose,
    kick(kick: CameraKick) {
      dip.v += kick.dip ?? 0
      pitch.v += kick.pitch ?? 0
      roll.v += kick.roll ?? 0
    },
    blast(source: ImpulsePoint, strength: number, eye: ImpulsePoint, yaw: number) {
      const dx = source.x - eye.x
      const dz = source.z - eye.z
      const distance = Math.hypot(dx, source.y - eye.y, dz)
      const amount = strength * blastFalloff(distance)
      if (!(amount > 0)) return
      const flat = Math.hypot(dx, dz)
      const side = flat > 1e-6 ? (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / flat : 0
      const { dip: down, pitch: up, roll: lean } = CAMERA_FEEL.impulse
      dip.v -= amount * down
      pitch.v += amount * up
      roll.v -= amount * lean * side
    },
    step(dt: number) {
      driveWith(dip, 0, CAMERA_FEEL.dip.spring, dt)
      driveWith(pitch, 0, CAMERA_FEEL.flinch.spring, dt)
      driveWith(roll, 0, CAMERA_FEEL.flinch.spring, dt)
      pose.y = dip.x * CAMERA_FEEL.dip.metres
      pose.pitch = pitch.x * CAMERA_FEEL.flinch.radians
      pose.roll = roll.x * CAMERA_FEEL.flinch.radians
      return pose
    },
    reset() {
      for (const state of [dip, pitch, roll]) resetSpring(state)
      pose.y = pose.pitch = pose.roll = 0
    },
  }
}

export type CameraImpulse = ReturnType<typeof createCameraImpulse>

export function applyCameraImpulse(camera: Object3D, pose: ImpulsePose) {
  if (Math.abs(pose.y) + Math.abs(pose.pitch) + Math.abs(pose.roll) < 1e-7) return
  camera.rotateX(pose.pitch)
  camera.rotateZ(pose.roll)
  camera.position.y += pose.y
}
