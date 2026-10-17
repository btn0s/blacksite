import { Euler, Quaternion, type Object3D } from 'three'
import type { ArmsState } from '../arms/state'
import { CAMERA_FEEL, GUN_FEEL, WEAPON_HEFT, aimTime } from './model'
import { createGunFeel } from './gun'
import { advanceReadiness, createReadiness } from './readiness'
import { wander } from './spring'

const delta = new Quaternion()
const deltaEuler = new Euler(0, 0, 0, 'YXZ')
const pivotQuaternion = new Quaternion()

export function createViewmodelFeel(state: ArmsState) {
  const gun = createGunFeel()
  const previousView = new Quaternion()
  let hasView = false
  let phase = 0
  let shots = 0
  let crouched = false
  const previous = { fire: state.fireSequence, land: state.landSequence }
  const readiness = createReadiness()
  let clock = 0
  return {
    gun,
    readiness,
    lower(sprinting: boolean, step: number) {
      clock += step
      advanceReadiness(readiness, clock, sprinting ? 'sprint' : null, false)
      return readiness.lowered
    },
    get ads() { return gun.ads },
    aim(wanted: boolean, step: number, weapon = state.weapon) {
      return gun.aim(wanted, aimTime(weapon, state.aimSeconds), step)
    },
    update(step: number, worldView: Quaternion | undefined, sprint: number, weapon = state.weapon) {
      const heft = WEAPON_HEFT[weapon]
      const motion = state.motion
      if (state.fireSequence !== previous.fire) {
        const fired = Math.max(1, Math.min(4, state.fireSequence - previous.fire))
        shots += fired
        const control = (1 - (1 - GUN_FEEL.aimRecoil) * gun.ads) * (motion?.crouching ? GUN_FEEL.crouchRecoil : 1)
        gun.shot({ fired, control, punch: heft.punch, side: heft.side, camera: heft.camera, wander: wander(shots, heft.bends, heft.seed) })
      }
      if (state.landSequence !== previous.land) gun.land(state.landSpeed)
      previous.fire = state.fireSequence
      previous.land = state.landSequence
      if (motion && motion.crouching !== crouched) { crouched = motion.crouching; gun.stance(crouched) }
      let pitchRate = 0
      let yawRate = 0
      if (motion?.look) {
        if (step > 0) { pitchRate = motion.look.pitch / step; yawRate = motion.look.yaw / step }
        motion.look.pitch = motion.look.yaw = 0
      } else if (worldView) {
        if (hasView && step > 0) {
          delta.copy(previousView).invert().multiply(worldView)
          deltaEuler.setFromQuaternion(delta)
          pitchRate = deltaEuler.x / step
          yawRate = deltaEuler.y / step
        }
        previousView.copy(worldView)
        hasView = true
      }
      const grounded = motion?.grounded ?? true
      const speed = state.speed
      let bob = motion?.bob
      if (motion?.walk !== undefined) phase = motion.walk
      else {
        const stride = CAMERA_FEEL.stride.base + CAMERA_FEEL.stride.sprint * Math.min(1, speed / CAMERA_FEEL.stride.reference)
        phase += speed * step / stride * Math.PI * (grounded ? 1 : 0)
      }
      if (bob === undefined) bob = Math.min(CAMERA_FEEL.bob.max, speed / CAMERA_FEEL.bob.reference) * (grounded ? 1 : 0) * (1 + CAMERA_FEEL.bob.sprint * (state.sprinting ? 1 : 0)) * CAMERA_FEEL.bob.gain
      gun.step({ forward: motion?.forward ?? speed, lateral: motion?.lateral ?? 0, pitchRate, yawRate, heft: heft.heft, sprint }, step)
      state.kick.pitch = gun.kick.pitch
      state.kick.roll = gun.kick.roll
      return gun.place(phase, bob, heft.heft)
    },
    get phase() { return phase },
  }
}

export type ViewmodelFeel = ReturnType<typeof createViewmodelFeel>

export function applyGunPose(holder: Object3D, feel: ViewmodelFeel) {
  const pose = feel.gun.pose
  pivotQuaternion.setFromEuler(pose.pivot.rotation)
  holder.position.add(pose.pivot.position).applyQuaternion(pose.group.quaternion).add(pose.group.position)
  holder.quaternion.premultiply(pivotQuaternion).premultiply(pose.group.quaternion)
}
