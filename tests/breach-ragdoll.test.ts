import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { CORPSE_RAGDOLL } from '../examples/breach/src/model'
import { createCorpseRagdoll, warmCorpseRagdoll } from '../examples/breach/src/ragdoll'

type Node = [name: string, parent: string | null, offset: [number, number, number]]

const SKELETON: Node[] = [
  ['root', null, [0, 0, 0]],
  ['pelvis', 'root', [0, 0.97, 0]],
  ['spine_01', 'pelvis', [0, 0.1, 0]],
  ['spine_02', 'spine_01', [0, 0.15, 0]],
  ['spine_03', 'spine_02', [0, 0.15, 0]],
  ['neck_01', 'spine_03', [0, 0.17, 0]],
  ['head', 'neck_01', [0, 0.09, 0]],
  ...(['l', 'r'] as const).flatMap(side => {
    const x = side === 'l' ? 1 : -1
    return [
      [`clavicle_${side}`, 'spine_03', [0.03 * x, 0.1, 0]],
      [`upperarm_${side}`, `clavicle_${side}`, [0.15 * x, 0, 0]],
      [`lowerarm_${side}`, `upperarm_${side}`, [0.05 * x, -0.28, 0.05]],
      [`hand_${side}`, `lowerarm_${side}`, [0, -0.06, 0.25]],
      [`thigh_${side}`, 'pelvis', [0.09 * x, 0, 0]],
      [`calf_${side}`, `thigh_${side}`, [0, -0.43, 0.01]],
      [`foot_${side}`, `calf_${side}`, [0, -0.4, 0]],
      [`ball_${side}`, `foot_${side}`, [0, -0.05, 0.12]],
    ] as Node[]
  }),
]

function soldier(at: THREE.Vector3) {
  const corpse = new THREE.Group()
  corpse.position.copy(at)
  const bones = new Map<string, THREE.Bone>()
  for (const [name, parent, offset] of SKELETON) {
    const bone = new THREE.Bone()
    bone.name = name
    bone.position.set(...offset)
    ;(parent ? bones.get(parent)! : corpse).add(bone)
    bones.set(name, bone)
  }
  corpse.updateMatrixWorld(true)
  corpse.traverse(object => { object.matrixAutoUpdate = false })
  return { corpse, bones }
}

function world() {
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  physics.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 60).setTranslation(0, -0.5, 0))
  return physics
}

const position = (bone: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld)

function simulate(physics: RAPIER.World, corpse: THREE.Object3D, update: () => void, seconds: number) {
  physics.timestep = 1 / 30
  for (let step = 0; step < seconds * 30; step++) { physics.step(); update(); corpse.updateMatrixWorld(true) }
}

describe('Breach phone corpse ragdoll', () => {
  beforeAll(async () => { await RAPIER.init() })

  it('falls in the direction of the shot and comes to rest on the floor', () => {
    const physics = world()
    const { corpse, bones } = soldier(new THREE.Vector3(2, 0, -3))
    const head = position(bones.get('head')!)
    const ragdoll = createCorpseRagdoll(RAPIER as never, physics as never, corpse, { x: 1, z: 0 }, { x: 0, z: 0 })!
    expect(ragdoll.bodies).toBe(CORPSE_RAGDOLL.parts.length)
    simulate(physics, corpse, ragdoll.update, 3)
    const fallen = position(bones.get('head')!)
    expect(fallen.x - head.x).toBeGreaterThan(0.8)
    expect(Math.abs(fallen.z - head.z)).toBeLessThan(0.6)
    expect(fallen.y).toBeLessThan(0.45)
    expect(ragdoll.pelvis.position.y).toBeLessThan(0.45)
    expect(ragdoll.pelvis.velocity.length()).toBeLessThan(0.3)
  })

  it('keeps knees and elbows bending the way joints bend', () => {
    const physics = world()
    const { corpse, bones } = soldier(new THREE.Vector3(0, 0, 0))
    const ragdoll = createCorpseRagdoll(RAPIER as never, physics as never, corpse, { x: 0, z: -1 }, { x: 0, z: 0 })!
    simulate(physics, corpse, ragdoll.update, 3)
    for (const side of ['l', 'r']) {
      const thigh = position(bones.get(`thigh_${side}`)!), calf = position(bones.get(`calf_${side}`)!), foot = position(bones.get(`foot_${side}`)!)
      const knee = calf.clone().sub(thigh).normalize().angleTo(foot.clone().sub(calf).normalize())
      expect(knee).toBeLessThan(CORPSE_RAGDOLL.parts.find(part => part.bone === `calf_${side}`)!.hinge!.range + 0.1)
      const upper = position(bones.get(`upperarm_${side}`)!), lower = position(bones.get(`lowerarm_${side}`)!), hand = position(bones.get(`hand_${side}`)!)
      expect(lower.clone().sub(upper).normalize().angleTo(hand.clone().sub(lower).normalize())).toBeLessThan(CORPSE_RAGDOLL.parts.find(part => part.bone === `lowerarm_${side}`)!.hinge!.range + 0.1)
    }
  })

  it('drives only the skeleton and leaves the physics world as it found it', () => {
    const physics = world()
    const bodies = physics.bodies.len()
    const { corpse } = soldier(new THREE.Vector3(0, 0, 0))
    const ragdoll = createCorpseRagdoll(RAPIER as never, physics as never, corpse, { x: 0, z: 1 }, { x: 0, z: 0 })!
    expect(physics.bodies.len()).toBe(bodies + CORPSE_RAGDOLL.parts.length)
    simulate(physics, corpse, ragdoll.update, 0.5)
    ragdoll.dispose()
    expect(physics.bodies.len()).toBe(bodies)
    expect(physics.impulseJoints.len()).toBe(0)
  })

  it('warms up without leaving anything in the world', () => {
    const physics = world()
    const bodies = physics.bodies.len()
    warmCorpseRagdoll(RAPIER as never, physics as never)
    expect(physics.bodies.len()).toBe(bodies)
    expect(physics.colliders.len()).toBe(1)
  })

  it('declines a skeleton that is missing a ragdoll bone', () => {
    const corpse = new THREE.Group()
    corpse.add(Object.assign(new THREE.Bone(), { name: 'pelvis' }))
    expect(createCorpseRagdoll(RAPIER as never, world() as never, corpse, { x: 1, z: 0 }, { x: 0, z: 0 })).toBeNull()
  })
})
