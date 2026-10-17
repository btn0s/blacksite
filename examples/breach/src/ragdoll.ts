import * as THREE from 'three'
import type { useRapier } from '@react-three/rapier'
import { CORPSE_RAGDOLL, type CorpsePart } from './model'

type Rapier = ReturnType<typeof useRapier>['rapier']
type World = ReturnType<typeof useRapier>['world']
type Body = ReturnType<World['createRigidBody']>
type Hinge = InstanceType<Rapier['RevoluteImpulseJoint']>
type Joint = ReturnType<World['createImpulseJoint']>
type Limits = { rawSet: { jointSetLimits(handle: number, axis: number, min: number, max: number): void } }

const ANGULAR_AXES = [3, 4, 5]

function swing(joint: Joint, limit: number) {
  for (const axis of ANGULAR_AXES) (joint as unknown as Limits).rawSet.jointSetLimits(joint.handle, axis, -limit, limit)
}

export type CorpseRagdoll = {
  readonly pelvis: { position: THREE.Vector3; velocity: THREE.Vector3 }
  readonly bodies: number
  update(): void
  dispose(): void
}

const up = new THREE.Vector3(0, 1, 0)

function point(bones: Map<string, THREE.Object3D>, name: string, out: THREE.Vector3) {
  return out.setFromMatrixPosition(bones.get(name)!.matrixWorld)
}

function signedAngle(axis: THREE.Vector3, from: THREE.Vector3, to: THREE.Vector3) {
  return Math.atan2(axis.dot(new THREE.Vector3().crossVectors(from, to)), from.dot(to))
}

export function createCorpseRagdoll(rapier: Rapier, world: World, corpse: THREE.Object3D, push: { x: number; z: number }, velocity: { x: number; z: number }): CorpseRagdoll | null {
  const bones = new Map<string, THREE.Object3D>()
  corpse.traverse(object => { if (object instanceof THREE.Bone && !bones.has(object.name)) bones.set(object.name, object) })
  const names = new Set([CORPSE_RAGDOLL.impulse.at, 'thigh_l', 'thigh_r', 'neck_01', ...CORPSE_RAGDOLL.parts.flatMap(part => [part.bone, ...part.hinge ? [part.hinge.toward] : [], ...part.shapes.flatMap(shape => [shape.from, shape.to])])])
  for (const name of names) if (!bones.has(name)) return null

  const at = (name: string) => point(bones, name, new THREE.Vector3())
  const right = at('thigh_r').sub(at('thigh_l')).normalize()
  const forward = new THREE.Vector3().crossVectors(at('neck_01').sub(at('pelvis')), right).normalize()
  const groups = (CORPSE_RAGDOLL.group << 16) | CORPSE_RAGDOLL.collidesWith
  const bodies = new Map<string, Body>()
  const driven: { bone: THREE.Object3D; body: Body; offset: THREE.Matrix4 }[] = []

  for (const part of CORPSE_RAGDOLL.parts) {
    const origin = at(part.bone)
    const body = world.createRigidBody(rapier.RigidBodyDesc.dynamic()
      .setTranslation(origin.x, origin.y, origin.z)
      .setLinvel(velocity.x, 0, velocity.z)
      .setLinearDamping(CORPSE_RAGDOLL.linearDamping)
      .setAngularDamping(CORPSE_RAGDOLL.angularDamping))
    for (const shape of part.shapes) {
      const a = at(shape.from), b = at(shape.to)
      const along = b.clone().sub(a)
      const length = along.length()
      const direction = length > 1e-4 ? along.divideScalar(length) : up.clone()
      b.addScaledVector(direction, shape.beyond ?? 0)
      const half = Math.max(0.001, a.distanceTo(b) / 2)
      const center = a.add(b).multiplyScalar(0.5).sub(origin)
      const rotation = new THREE.Quaternion().setFromUnitVectors(up, direction)
      world.createCollider(rapier.ColliderDesc.capsule(half, shape.radius)
        .setTranslation(center.x, center.y, center.z)
        .setRotation(rotation)
        .setMass(part.mass / part.shapes.length)
        .setFriction(CORPSE_RAGDOLL.friction)
        .setRestitution(0)
        .setCollisionGroups(groups), body)
    }
    bodies.set(part.bone, body)
    const bone = bones.get(part.bone)!
    driven.push({ bone, body, offset: new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z).multiply(bone.matrixWorld) })
  }

  for (const part of CORPSE_RAGDOLL.parts) joint(part)

  function joint(part: CorpsePart) {
    if (!part.joint) return
    const parent = bodies.get(part.joint)!, child = bodies.get(part.bone)!
    const anchor = at(part.bone)
    const local1 = anchor.clone().sub(at(part.joint)), local2 = new THREE.Vector3()
    if (!part.hinge) {
      const ball = world.createImpulseJoint(rapier.JointData.spherical(local1, local2), parent, child, true)
      ball.setContactsEnabled(false)
      if (part.swing) swing(ball, part.swing)
      return
    }
    const upper = anchor.clone().sub(at(part.joint)).normalize()
    const lower = at(part.hinge.toward).sub(anchor).normalize()
    const flex = forward.clone().multiplyScalar(part.hinge.flex)
    let axis = new THREE.Vector3().crossVectors(upper, lower)
    if (axis.lengthSq() < 0.03) axis = new THREE.Vector3().crossVectors(lower, flex)
    axis.normalize()
    const bent = Math.max(0, signedAngle(axis, upper, lower))
    const hinge = world.createImpulseJoint(rapier.JointData.revolute(local1, local2, axis), parent, child, true) as Hinge
    hinge.setContactsEnabled(false)
    hinge.setLimits(-bent - CORPSE_RAGDOLL.hyperextend, part.hinge.range - bent)
  }

  const { bone: struck, at: hitAt, shot, lift } = CORPSE_RAGDOLL.impulse
  bodies.get(struck)!.applyImpulseAtPoint({ x: push.x * shot, y: lift, z: push.z * shot }, at(hitAt), true)

  const pelvisBody = bodies.get('pelvis')!
  const pelvis = { position: new THREE.Vector3(), velocity: new THREE.Vector3() }
  const pose = new THREE.Matrix4(), inverse = new THREE.Matrix4()
  const translation = new THREE.Vector3(), rotation = new THREE.Quaternion(), unit = new THREE.Vector3(1, 1, 1)
  const sample = () => { pelvis.position.copy(pelvisBody.translation()); pelvis.velocity.copy(pelvisBody.linvel()) }
  sample()
  let alive = true

  return {
    pelvis,
    bodies: bodies.size,
    update() {
      if (!alive) return
      for (const { bone, body, offset } of driven) {
        translation.copy(body.translation())
        rotation.copy(body.rotation())
        pose.compose(translation, rotation, unit).multiply(offset)
        bone.parent!.updateWorldMatrix(true, false)
        bone.matrix.copy(inverse.copy(bone.parent!.matrixWorld).invert().multiply(pose))
        bone.matrixWorld.copy(pose)
      }
      sample()
    },
    dispose() {
      if (!alive) return
      alive = false
      for (const body of bodies.values()) world.removeRigidBody(body)
      bodies.clear()
    },
  }
}

const STANDING: Record<string, [number, number, number]> = {
  pelvis: [0, 0.97, 0], spine_01: [0, 1.07, 0], spine_03: [0, 1.37, 0], neck_01: [0, 1.64, 0], head: [0, 1.73, 0],
  ...Object.fromEntries((['l', 'r'] as const).flatMap(side => {
    const x = side === 'l' ? 1 : -1
    return [
      [`upperarm_${side}`, [0.18 * x, 1.47, 0]], [`lowerarm_${side}`, [0.23 * x, 1.19, 0.05]], [`hand_${side}`, [0.23 * x, 1.13, 0.3]],
      [`thigh_${side}`, [0.09 * x, 0.97, 0]], [`calf_${side}`, [0.09 * x, 0.54, 0.01]], [`foot_${side}`, [0.09 * x, 0.14, 0.01]], [`ball_${side}`, [0.09 * x, 0.09, 0.13]],
    ]
  })),
}

export function warmCorpseRagdoll(rapier: Rapier, world: World) {
  const corpse = new THREE.Group()
  for (const [name, position] of Object.entries(STANDING)) corpse.add(Object.assign(new THREE.Bone(), { name }).translateX(position[0]).translateY(position[1]).translateZ(position[2]))
  corpse.updateMatrixWorld(true)
  const scratch = new rapier.World(world.gravity)
  scratch.timestep = world.timestep
  scratch.createCollider(rapier.ColliderDesc.cuboid(4, 0.5, 4).setTranslation(0, -0.5, 0))
  scratch.createCollider(rapier.ColliderDesc.cuboid(4, 2, 0.5).setTranslation(0, 2, 1))
  const ragdoll = createCorpseRagdoll(rapier, scratch, corpse, { x: 0, z: 1 }, { x: 0, z: 0 })
  for (let step = 0; step < 90; step++) {
    scratch.step()
    ragdoll?.update()
  }
  ragdoll?.dispose()
  scratch.free()
}
