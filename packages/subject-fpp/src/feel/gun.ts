import { Euler, Quaternion, Vector3 } from 'three'
import { GUN_FEEL } from './model'
import { PUSH_RATE, damp, drive, driveWith, resetSpring, smoother, soft, spring } from './spring'

export type GunMotion = { forward: number; lateral: number; pitchRate: number; yawRate: number; heft: number; sprint: number }

export type GunShot = { fired: number; control: number; punch: number; side: number; camera: number; wander: number }

export type GunPose = {
  group: { quaternion: Quaternion; position: Vector3 }
  pivot: { rotation: Euler; position: Vector3 }
}

const shoulder = new Vector3()
const swing = new Vector3()
const turn = new Euler(0, 0, 0, 'YXZ')

export function createGunFeel() {
  const gunBack = spring()
  const gunRise = spring()
  const gunRoll = spring()
  const cameraPitch = spring()
  const cameraRoll = spring()
  const settle = spring()
  const swayYaw = spring()
  const swayPitch = spring()
  const swayRoll = spring()
  const reachX = spring()
  const reachY = spring()
  const strafe = spring()
  const surge = spring()
  const drop = spring()
  const all = [gunBack, gunRise, gunRoll, cameraPitch, cameraRoll, settle, swayYaw, swayPitch, swayRoll, reachX, reachY, strafe, surge, drop]
  let aimLinear = 0
  let ads = 0
  let surging = 0
  let breathing = 0
  let shake = 1
  let tension = 0
  let bracing = 0
  let carried = 0
  const kick = { pitch: 0, roll: 0 }
  const pose: GunPose = { group: { quaternion: new Quaternion(), position: new Vector3() }, pivot: { rotation: new Euler(), position: new Vector3() } }
  return {
    kick,
    pose,
    get ads() { return ads },
    get aimLinear() { return aimLinear },
    aim(wanted: boolean, seconds: number, dt: number) {
      const was = aimLinear
      aimLinear = wanted ? Math.min(1, aimLinear + dt / seconds) : Math.max(0, aimLinear - dt / (seconds * GUN_FEEL.aimOut))
      ads = smoother(aimLinear)
      if (was < 1 && aimLinear === 1) settle.v -= GUN_FEEL.aimSettle
      else if (was > 0 && aimLinear === 0) settle.v += GUN_FEEL.aimSettle * 0.6
      return ads
    },
    brace() { settle.v -= 2.5 },
    shot(shot: GunShot) {
      const held = shot.fired * shot.control
      const force = held * shot.punch / GUN_FEEL.kick.reference
      shake = shot.camera
      bracing = 1
      gunBack.push += GUN_FEEL.kick.back * force * PUSH_RATE
      gunRise.push += GUN_FEEL.kick.rise * force * PUSH_RATE
      gunRoll.push += GUN_FEEL.kick.roll * (shot.wander + GUN_FEEL.kick.rollBias) * held * shot.side * PUSH_RATE / GUN_FEEL.kick.side
    },
    stance(crouched: boolean) { drop.v -= crouched ? GUN_FEEL.stance : -GUN_FEEL.stance * 0.6 },
    land(speed: number) { drop.v -= Math.min(GUN_FEEL.land.max, Math.max(0, speed) * GUN_FEEL.land.perSpeed) },
    step(motion: GunMotion, dt: number) {
      const { springs } = GUN_FEEL
      const { forward, heft, lateral, pitchRate, yawRate, sprint } = motion
      const loose = 1 / Math.sqrt(Math.max(0.3, heft))
      const { brace, relax, rise, tight } = GUN_FEEL.tension
      bracing = damp(bracing, 0, 4, dt)
      const wanted = bracing * brace
      tension = damp(tension, wanted, wanted > tension ? rise : relax, dt)
      const grip = 1 + tight * tension
      const hands = springs.sway[0] * loose * grip
      const [slack, firm] = GUN_FEEL.hands
      const damping = slack + (firm - slack) * Math.max(0, Math.min(1, (heft - 0.6) / 0.9))
      const weight = heft ** GUN_FEEL.sway.heft
      const arms = springs.sway[0] * grip
      const reach = weight * (1 - GUN_FEEL.aimSteady * ads) / grip
      const lagYaw = soft(yawRate * GUN_FEEL.sway.gain * reach, GUN_FEEL.sway.max * weight)
      const lagPitch = soft(pitchRate * GUN_FEEL.sway.gain * reach, GUN_FEEL.sway.max * GUN_FEEL.sway.pitch * weight)
      breathing += dt
      carried = Math.max(0, Math.min(1, sprint))
      driveWith(gunBack, 0, springs.gun, dt)
      drive(gunRise, 0, hands, damping, dt)
      drive(gunRoll, 0, hands, damping, dt)
      driveWith(cameraPitch, gunRise.x * GUN_FEEL.kick.camera * shake, springs.camera, dt)
      driveWith(cameraRoll, gunRoll.x * GUN_FEEL.kick.cameraRoll * shake, springs.camera, dt)
      driveWith(settle, 0, springs.settle, dt)
      drive(strafe, soft(lateral / 4 / grip, 1), springs.strafe[0] * loose * grip, springs.strafe[1], dt)
      driveWith(surge, forward, springs.surge, dt)
      surging = Math.max(-1, Math.min(1, (forward - surge.x) / 3)) * GUN_FEEL.surge
      driveWith(drop, 0, springs.land, dt)
      const lagDown = lagPitch + Math.abs(lagYaw) * GUN_FEEL.dip
      drive(swayYaw, lagYaw, arms, springs.sway[1], dt)
      drive(swayPitch, lagDown, arms, springs.sway[1], dt)
      drive(swayRoll, swayYaw.x * GUN_FEEL.sway.roll, arms * GUN_FEEL.sway.rollLag, springs.sway[1], dt)
      const reachRate = arms * GUN_FEEL.reach.lag
      drive(reachX, -lagYaw * GUN_FEEL.reach.yaw, reachRate, firm, dt)
      drive(reachY, lagDown * GUN_FEEL.reach.pitch, reachRate, firm, dt)
      kick.pitch = cameraPitch.x
      kick.roll = cameraRoll.x
    },
    place(walk: number, walkBob: number, heft: number) {
      const hip = 1 - GUN_FEEL.aimSteady * ads
      const lag = heft * hip
      const aimWalk = walkBob * ads * GUN_FEEL.walkAim
      const stepSin = Math.sin(walk)
      const stepDip = Math.cos(2 * walk) - 1
      const stride = walk - 0.35 * heft
      const strideSin = Math.sin(stride)
      const eight = Math.sin(2 * stride)
      const hipWalk = walkBob * hip * GUN_FEEL.walkHip * heft * (1 - carried)
      const lope = Math.sin(walk * 0.5)
      const sprintSwing = walkBob * carried * heft
      const arc = Math.sin(Math.PI * ads) * (1 - ads * 0.5)
      const breathe = GUN_FEEL.breath * Math.max(1, heft) * (ads + GUN_FEEL.breathHip * (1 - ads))
      turn.set(
        -swayPitch.x + settle.x * 0.02 + stepDip * 0.0016 * aimWalk + Math.sin(breathing * 1.3) * breathe - cameraPitch.x,
        -swayYaw.x + stepSin * 0.0013 * aimWalk + Math.sin(breathing * 0.8) * breathe * 0.7,
        swayRoll.x - strafe.x * 0.05 * hip + stepSin * 0.014 * aimWalk - cameraRoll.x,
      )
      const group = pose.group
      group.quaternion.setFromEuler(turn)
      shoulder.fromArray(GUN_FEEL.shoulder).multiplyScalar((0.6 + 0.4 * heft) * hip)
      swing.copy(shoulder).applyQuaternion(group.quaternion).negate().add(shoulder)
      group.position.set(swing.x + reachX.x * hip, swing.y + reachY.x * hip, swing.z)
      const kicked = 1 - GUN_FEEL.aimKick * ads
      pose.pivot.position.set(
        -strafe.x * 0.025 * heft * hip + strideSin * 0.006 * hipWalk + lope * GUN_FEEL.sprint * sprintSwing + arc * GUN_FEEL.aimArc * 0.8,
        drop.x * 0.3 * heft * hip + eight * 0.0018 * hipWalk - Math.abs(lope) * GUN_FEEL.sprint * 0.5 * sprintSwing - arc * GUN_FEEL.aimArc,
        -stepDip * 0.003 * aimWalk + gunBack.x * kicked + surging * lag,
      )
      pose.pivot.rotation.set(
        drop.x * 0.25 * heft * hip + gunRise.x * kicked - surging * 0.6 * lag + eight * 0.006 * hipWalk,
        strideSin * 0.012 * hipWalk + lope * 0.05 * sprintSwing,
        gunRoll.x * kicked + strideSin * 0.024 * hipWalk + lope * 0.12 * sprintSwing + arc * GUN_FEEL.aimArc * 4,
      )
      return pose
    },
    reset() {
      aimLinear = ads = carried = surging = breathing = tension = bracing = 0
      kick.pitch = kick.roll = 0
      for (const state of all) resetSpring(state)
    },
  }
}

export type GunFeel = ReturnType<typeof createGunFeel>
