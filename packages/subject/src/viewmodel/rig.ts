import { Bone, Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import { GRIPS, type FingerName, type GripPose } from './model'

export type Side = 'right' | 'left'

const FINGERS: FingerName[] = ['thumb', 'index', 'middle', 'ring', 'pinky']
const suffix = (side: Side) => side === 'right' ? 'r' : 'l'

type FingerBone = { bone: Bone; rest: Quaternion; axis: Vector3; oppositionAxis: Vector3 }

type ArmRig = {
  side: Side
  upper: Bone
  lower: Bone
  hand: Bone
  upperLength: number
  lowerLength: number
  rest: { upper: Quaternion; lower: Quaternion; hand: Quaternion; upperWorld: Quaternion; lowerWorld: Quaternion; handWorld: Quaternion }
  upperDirection: Vector3
  lowerDirection: Vector3
  back: Vector3
  fingerDirection: Vector3
  palm: Vector3
  palmOffset: Vector3
  fingers: Record<FingerName, FingerBone[]>
}

const basis = new Matrix4()
const quatA = new Quaternion()
const quatB = new Quaternion()
const quatC = new Quaternion()
const vecA = new Vector3()
const vecB = new Vector3()
const vecC = new Vector3()
const vecD = new Vector3()
const vecE = new Vector3()
const parentQuat = new Quaternion()

export function frameQuaternion(primary: Vector3, secondary: Vector3, target: Quaternion) {
  const x = vecA.copy(primary).normalize()
  const y = vecB.copy(secondary).addScaledVector(x, -secondary.dot(x)).normalize()
  const z = vecC.crossVectors(x, y)
  basis.makeBasis(x, y, z)
  return target.setFromRotationMatrix(basis)
}

export function alignQuaternion(fromPrimary: Vector3, fromSecondary: Vector3, toPrimary: Vector3, toSecondary: Vector3, target: Quaternion) {
  frameQuaternion(fromPrimary, fromSecondary, quatC)
  frameQuaternion(toPrimary, toSecondary, target)
  return target.multiply(quatC.invert())
}

const worldPosition = (object: Object3D, target: Vector3) => target.setFromMatrixPosition(object.matrixWorld)

function setWorldQuaternion(bone: Bone, world: Quaternion) {
  bone.parent!.getWorldQuaternion(parentQuat)
  bone.quaternion.copy(parentQuat.invert().multiply(world))
  bone.updateMatrixWorld(true)
}

export function createArmsRig(scene: Object3D) {
  scene.updateMatrixWorld(true)
  const bone = (name: string) => {
    const found = scene.getObjectByName(name)
    if (!(found instanceof Bone)) throw new Error(`Viewmodel arms bone missing: ${name}`)
    return found
  }
  const arms = {} as Record<Side, ArmRig>
  for (const side of ['right', 'left'] as const) {
    const s = suffix(side)
    const upper = bone(`upperarm_${s}`)
    const lower = bone(`lowerarm_${s}`)
    const hand = bone(`hand_${s}`)
    const shoulder = worldPosition(upper, new Vector3())
    const elbow = worldPosition(lower, new Vector3())
    const wrist = worldPosition(hand, new Vector3())
    const knuckle = worldPosition(bone(`middle_01_${s}`), new Vector3())
    const indexBase = worldPosition(bone(`index_01_${s}`), new Vector3())
    const pinkyBase = worldPosition(bone(`pinky_01_${s}`), new Vector3())
    const fingerDirection = knuckle.clone().sub(wrist).normalize()
    const thumbSide = indexBase.clone().sub(pinkyBase).normalize()
    const palm = side === 'right' ? thumbSide.clone().cross(fingerDirection) : fingerDirection.clone().cross(thumbSide)
    palm.addScaledVector(fingerDirection, -palm.dot(fingerDirection)).normalize()
    const palmCentre = wrist.clone().lerp(knuckle, 0.55).addScaledVector(palm, 0.022)
    const restHandWorld = hand.getWorldQuaternion(new Quaternion())
    frameQuaternion(fingerDirection, palm, quatA)
    const palmOffset = palmCentre.clone().sub(wrist).applyQuaternion(quatA.clone().invert())
    const fingers = {} as Record<FingerName, FingerBone[]>
    for (const finger of FINGERS) {
      const chain: FingerBone[] = []
      for (let joint = 1; joint <= 3; joint++) {
        const current = bone(`${finger}_0${joint}_${s}`)
        const start = worldPosition(current, new Vector3())
        const child = current.children.find(entry => entry instanceof Bone)
        const end = child ? worldPosition(child, new Vector3()) : start.clone().add(start.clone().sub(worldPosition(current.parent!, new Vector3())).multiplyScalar(0.6))
        const direction = end.sub(start).normalize()
        const toward = finger === 'thumb'
          ? palm.clone().multiplyScalar(0.7).addScaledVector(thumbSide, -0.7).normalize()
          : palm.clone()
        const axis = direction.clone().cross(toward).normalize()
        const world = current.getWorldQuaternion(new Quaternion())
        world.invert()
        chain.push({ bone: current, rest: current.quaternion.clone(), axis: axis.applyQuaternion(world), oppositionAxis: thumbSide.clone().applyQuaternion(world) })
      }
      fingers[finger] = chain
    }
    arms[side] = {
      side, upper, lower, hand,
      upperLength: elbow.distanceTo(shoulder),
      lowerLength: wrist.distanceTo(elbow),
      rest: {
        upper: upper.quaternion.clone(), lower: lower.quaternion.clone(), hand: hand.quaternion.clone(),
        upperWorld: upper.getWorldQuaternion(new Quaternion()), lowerWorld: lower.getWorldQuaternion(new Quaternion()), handWorld: restHandWorld,
      },
      upperDirection: elbow.clone().sub(shoulder).normalize(),
      lowerDirection: wrist.clone().sub(elbow).normalize(),
      back: new Vector3(0, 0, 1),
      fingerDirection, palm, palmOffset, fingers,
    }
  }
  const grips: Record<Side, Record<FingerName, [number, number, number]>> = {
    right: Object.fromEntries(FINGERS.map(finger => [finger, [0, 0, 0]])) as Record<FingerName, [number, number, number]>,
    left: Object.fromEntries(FINGERS.map(finger => [finger, [0, 0, 0]])) as Record<FingerName, [number, number, number]>,
  }
  const wristTarget = new Vector3()
  const opposition = { right: 0, left: 0 }
  const handQuaternion = new Quaternion()
  const elbow = new Vector3()
  const measure = { reach: { right: 0, left: 0 } }

  return {
    arms,
    grips,
    measure,
    clearGrip(side: Side) { for (const finger of FINGERS) grips[side][finger].fill(0); opposition[side] = 0 },
    addGrip(side: Side, pose: GripPose, weight: number) {
      for (const finger of FINGERS) for (let joint = 0; joint < 3; joint++) grips[side][finger][joint] += pose[finger][joint] * weight
      opposition[side] += (pose.thumbOpposition ?? 0) * weight
    },
    handFrame(side: Side, palmCentre: Vector3, fingers: Vector3, palm: Vector3, outWrist: Vector3, outQuaternion: Quaternion) {
      const arm = arms[side]
      const delta = alignQuaternion(arm.fingerDirection, arm.palm, fingers, palm, quatB)
      outQuaternion.copy(delta).multiply(arm.rest.handWorld)
      frameQuaternion(fingers, palm, quatA)
      outWrist.copy(arm.palmOffset).applyQuaternion(quatA).negate().add(palmCentre)
    },
    solve(side: Side, wrist: Vector3, hand: Quaternion, pole: Vector3, twist: number) {
      const arm = arms[side]
      arm.upper.quaternion.copy(arm.rest.upper)
      arm.lower.quaternion.copy(arm.rest.lower)
      arm.hand.quaternion.copy(arm.rest.hand)
      arm.upper.updateMatrixWorld(true)
      const shoulder = worldPosition(arm.upper, vecD)
      wristTarget.copy(wrist)
      const toTarget = vecE.copy(wristTarget).sub(shoulder)
      const reach = arm.upperLength + arm.lowerLength
      const distance = Math.min(Math.max(toTarget.length(), Math.abs(arm.upperLength - arm.lowerLength) + 1e-4), reach * 0.9995)
      measure.reach[side] = toTarget.length() / reach
      const direction = toTarget.normalize()
      const along = (arm.upperLength ** 2 - arm.lowerLength ** 2 + distance ** 2) / (2 * distance)
      const height = Math.sqrt(Math.max(0, arm.upperLength ** 2 - along ** 2))
      const out = vecA.copy(pole).addScaledVector(direction, -pole.dot(direction))
      if (out.lengthSq() < 1e-8) out.set(0, -1, 0).addScaledVector(direction, -direction.y)
      out.normalize()
      const elbowOut = out.clone()
      elbow.copy(shoulder).addScaledVector(direction, along).addScaledVector(elbowOut, height)
      const upperDirection = vecB.copy(elbow).sub(shoulder).normalize().clone()
      alignQuaternion(arm.upperDirection, arm.back, upperDirection, elbowOut, quatB)
      setWorldQuaternion(arm.upper, quatB.multiply(arm.rest.upperWorld))
      const end = shoulder.clone().addScaledVector(direction, distance)
      const lowerDirection = end.sub(elbow).normalize()
      alignQuaternion(arm.lowerDirection, arm.back, lowerDirection, elbowOut, quatB)
      const lowerWorld = quatB.multiply(arm.rest.lowerWorld).clone()
      const carriedPalm = vecC.copy(arm.palm).applyQuaternion(arm.rest.lowerWorld.clone().invert()).applyQuaternion(lowerWorld)
      const wantedPalm = vecD.copy(arm.palm).applyQuaternion(arm.rest.handWorld.clone().invert()).applyQuaternion(hand)
      carriedPalm.addScaledVector(lowerDirection, -carriedPalm.dot(lowerDirection)).normalize()
      wantedPalm.addScaledVector(lowerDirection, -wantedPalm.dot(lowerDirection)).normalize()
      const angle = Math.atan2(vecE.crossVectors(carriedPalm, wantedPalm).dot(lowerDirection), carriedPalm.dot(wantedPalm))
      handQuaternion.setFromAxisAngle(lowerDirection, angle * twist)
      setWorldQuaternion(arm.lower, handQuaternion.multiply(lowerWorld))
      setWorldQuaternion(arm.hand, hand)
      const grip = grips[side]
      for (const finger of FINGERS) {
        const chain = arm.fingers[finger]
        for (let joint = 0; joint < 3; joint++) {
          const entry = chain[joint]
          quatA.setFromAxisAngle(entry.axis, grip[finger][joint] * Math.PI / 180)
          entry.bone.quaternion.copy(entry.rest)
          if (finger === 'thumb' && joint === 0) entry.bone.quaternion.multiply(quatB.setFromAxisAngle(entry.oppositionAxis, opposition[side] * Math.PI / 180))
          entry.bone.quaternion.multiply(quatA)
        }
      }
      arm.hand.updateMatrixWorld(true)
      return worldPosition(arm.hand, vecE).distanceTo(wrist)
    },
  }
}

export type ArmsRig = ReturnType<typeof createArmsRig>

export { GRIPS }
