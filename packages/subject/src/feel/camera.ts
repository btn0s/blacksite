import { CAMERA_FEEL } from './model'
import { createCameraImpulse } from './impulse'
import { driveWith, resetSpring, spring, wander } from './spring'

export type CameraMotion = { speed: number; lateral: number; grounded: boolean; sprinting: boolean; aim: number }

export type CameraPose = { x: number; y: number; z: number; pitch: number; yaw: number; roll: number }

export const createCameraPose = (): CameraPose => ({ x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 })

const DEGREES = Math.PI / 180
const WIDE = 16 / 9

export const toHorizontal = (vertical: number, aspect = WIDE) => 2 * Math.atan(Math.tan(vertical * DEGREES / 2) * aspect) / DEGREES

export const toVertical = (horizontal: number, aspect = WIDE) => 2 * Math.atan(Math.tan(horizontal * DEGREES / 2) / aspect) / DEGREES

export function createCameraFeel() {
  const impulse = createCameraImpulse()
  const roll = spring()
  const sprintFov = spring()
  const punch = spring()
  const pose = createCameraPose()
  let phase = 0
  let bob = 0
  let lands = 0
  let fov = 75
  let hipFov = 75
  let footfall = 0
  return {
    pose,
    impulse,
    get phase() { return phase },
    get bob() { return bob },
    get fov() { return fov },
    get lookScale() { return Math.min(1, Math.tan(fov * DEGREES / 2) / Math.tan(hipFov * DEGREES / 2)) },
    get footfalls() { return footfall },
    land(speed: number) {
      const impact = Math.min(CAMERA_FEEL.dip.maxImpact, Math.max(0, speed))
      lands++
      impulse.kick({ dip: -impact * CAMERA_FEEL.dip.land, roll: impact * CAMERA_FEEL.flinch.land * (wander(lands) > 0 ? 1 : -1) })
      punch.v -= impact * CAMERA_FEEL.fov.land
    },
    jump() {
      impulse.kick({ dip: CAMERA_FEEL.dip.jump })
      punch.v += CAMERA_FEEL.fov.jump
    },
    crouch(crouched: boolean) {
      impulse.kick({ dip: crouched ? -CAMERA_FEEL.dip.crouch : CAMERA_FEEL.dip.stand, roll: crouched ? CAMERA_FEEL.flinch.crouch : -CAMERA_FEEL.flinch.stand })
    },
    shot(aim: number, fired = 1) {
      punch.v += CAMERA_FEEL.fov.shot * fired * (1 - aim * CAMERA_FEEL.fov.shotAim)
    },
    hurt(damage: number, side: number) {
      impulse.kick({ roll: (side > 0 ? -1 : 1) * (CAMERA_FEEL.flinch.hit + damage * CAMERA_FEEL.flinch.hitPerDamage) })
    },
    step(motion: CameraMotion, hip: number, aimed: number, dt: number, kick?: { pitch: number; roll: number }) {
      const { stride: strideFeel, bob: bobFeel, fov: fovFeel } = CAMERA_FEEL
      const grounded = motion.grounded ? 1 : 0
      const sprinting = motion.sprinting ? 1 : 0
      const aim = Math.min(1, Math.max(0, motion.aim))
      const stride = strideFeel.base + strideFeel.sprint * Math.min(1, motion.speed / strideFeel.reference)
      const before = Math.floor(phase / Math.PI - 0.5)
      phase += motion.speed * dt / stride * Math.PI * grounded
      if (Math.floor(phase / Math.PI - 0.5) !== before && motion.speed > CAMERA_FEEL.footfallSpeed) footfall++
      bob = Math.min(bobFeel.max, motion.speed / bobFeel.reference) * grounded * (1 + bobFeel.sprint * sprinting) * bobFeel.gain
      const camBob = bob * (1 - aim)
      driveWith(sprintFov, sprinting * fovFeel.sprint, fovFeel.sprintSpring, dt)
      driveWith(punch, 0, fovFeel.punch, dt)
      const kicked = impulse.step(dt)
      driveWith(roll, -motion.lateral * CAMERA_FEEL.strafeRoll.gain * (1 - aim), CAMERA_FEEL.strafeRoll.spring, dt)
      const wide = toHorizontal(hip)
      hipFov = hip
      fov = toVertical(wide + (toHorizontal(aimed) - wide) * aim + sprintFov.x * (1 - aim) + punch.x * (1 - aim * CAMERA_FEEL.fov.aimKeep))
      pose.x = Math.sin(phase) * bobFeel.lateral * camBob
      pose.y = (Math.cos(2 * phase) - 1) * bobFeel.vertical * camBob + kicked.y
      pose.z = 0
      pose.pitch = (kick?.pitch ?? 0) + kicked.pitch
      pose.yaw = 0
      pose.roll = roll.x + kicked.roll + Math.sin(phase) * bobFeel.roll * camBob + (kick?.roll ?? 0)
      return pose
    },
    reset() {
      for (const state of [roll, sprintFov, punch]) resetSpring(state)
      impulse.reset()
      phase = bob = 0
      Object.assign(pose, createCameraPose())
    },
  }
}

export type CameraFeel = ReturnType<typeof createCameraFeel>
