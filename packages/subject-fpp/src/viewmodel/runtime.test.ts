import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Bone, Euler, Matrix4, Quaternion, SkinnedMesh, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createArmsState, type ArmsWeapon } from '../arms/state'
import { createViewmodelRuntime } from './runtime'
import { VIEWMODEL_WEAPONS } from './model'

async function load(file: string) {
  const bytes = readFileSync(new URL(file, import.meta.url))
  const jsonLength = bytes.readUInt32LE(12)
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString())
  delete json.images
  delete json.textures
  delete json.materials
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material
  const bin = bytes.subarray(28 + jsonLength)
  const encoded = Buffer.from(JSON.stringify(json))
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32)
  encoded.copy(padded)
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(28 + padded.length + bin.length, 8)
  header.writeUInt32LE(padded.length, 12)
  header.writeUInt32LE(0x4e4f534a, 16)
  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(bin.length, 0)
  binHeader.writeUInt32LE(0x004e4942, 4)
  const glb = Buffer.concat([header, padded, binHeader, bin])
  return (await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '')).scene
}

async function fixture(weapon: ArmsWeapon = 'rifle') {
  const [arms, rifle, pistol] = await Promise.all([load('../../assets/arms/blacksite-arms.glb'), load('../../assets/weapons/rifle.glb'), load('../../assets/weapons/pistol.glb')])
  const state = createArmsState()
  state.weapon = weapon
  const runtime = createViewmodelRuntime({ arms, weapons: { rifle, pistol } }, state)
  const view = new Quaternion()
  const advance = (seconds: number) => {
    for (let time = 0; time < seconds - 1e-8; time += 1 / 120) runtime.update(Math.min(1 / 120, seconds - time), view)
  }
  return { arms, state, runtime, advance, view }
}

describe('authored viewmodel assets', () => {
  it('fits every finger pivot inside its weighted finger geometry', async () => {
    const { arms } = await fixture()
    arms.updateMatrixWorld(true)
    let checked = 0
    arms.traverse(object => {
      if (!(object instanceof SkinnedMesh) || !object.name.includes('Glove')) return
      const indices = object.geometry.getAttribute('skinIndex')
      const weights = object.geometry.getAttribute('skinWeight')
      for (const bone of object.skeleton.bones) {
        if (!/^(index|middle|ring|pinky)_0[12]_/.test(bone.name)) continue
        const boneIndex = object.skeleton.bones.indexOf(bone)
        const points: Vector3[] = []
        for (let index = 0; index < indices.count; index++) {
          if (indices.getX(index) === boneIndex && weights.getX(index) > 0.7) points.push(object.getVertexPosition(index, new Vector3()).applyMatrix4(object.matrixWorld))
        }
        expect(points.length).toBeGreaterThan(5)
        const centre = points.reduce((sum, point) => sum.add(point), new Vector3()).multiplyScalar(1 / points.length)
        expect(centre.distanceTo(bone.getWorldPosition(new Vector3())), bone.name).toBeLessThan(0.035)
        checked++
      }
    })
    expect(checked).toBe(16)
  })
})

describe.each(['rifle', 'pistol'] as const)('%s viewmodel', weapon => {
  it('keeps hands reachable and finite throughout each authored action', async () => {
    const { runtime, state, advance } = await fixture(weapon)
    let largestError = 0
    let worstPose = ''
    let largestReach = 0
    for (const action of ['equip', 'reload', 'inspect', 'switch', 'aim', 'sprint'] as const) {
      advance(4)
      if (action === 'equip') state.equipSequence++
      if (action === 'reload') state.reloadSequence++
      if (action === 'inspect') state.inspectSequence++
      if (action === 'switch') state.weapon = weapon === 'rifle' ? 'pistol' : 'rifle'
      if (action === 'aim') state.aiming = true
      if (action === 'sprint') { state.aiming = false; state.sprinting = true; state.speed = 5.2 }
      for (let frame = 0; frame < 420; frame++) {
        runtime.update(1 / 120)
        if (state.debug.handError > largestError) worstPose = `${action} at ${frame / 120}s`
        largestError = Math.max(largestError, state.debug.handError)
        largestReach = Math.max(largestReach, state.debug.reach)
        expect(Number.isFinite(state.debug.handError)).toBe(true)
      }
    }
    expect(largestError, worstPose).toBeLessThan(0.005)
    expect(largestReach).toBeLessThan(1)
  })

  it('aligns the physical sight and completes ADS at the declared time', async () => {
    const { state, runtime, advance } = await fixture(weapon)
    advance(1)
    state.aiming = true
    advance(VIEWMODEL_WEAPONS[weapon].aimSeconds)
    expect(state.debug.aimAmount).toBeCloseTo(1, 6)
    const sight = runtime.sightInView()
    expect(Math.hypot(sight.x, sight.y)).toBeLessThan(0.003)
  })

  it('recovers from accepted fire and limits rapid turn sway', async () => {
    const { state, runtime, advance, view } = await fixture(weapon)
    advance(1)
    state.fireSequence++
    advance(0.05)
    expect(state.debug.recoilOffset).toBeGreaterThan(0.01)
    advance(0.55)
    expect(Math.abs(state.debug.recoilOffset)).toBeLessThan(0.0005)
    for (let frame = 0; frame < 120; frame++) {
      view.setFromEuler(new Euler(0, frame * 0.1, 0))
      runtime.update(1 / 120, view)
      expect(state.debug.handError).toBeLessThan(0.005)
      expect(Math.abs(state.debug.weaponOffset[0])).toBeLessThan(0.02)
    }
  })

  it('keeps the support palm attached to the moving magazine', async () => {
    const { state, runtime, advance } = await fixture(weapon)
    advance(1)
    state.reloadSequence++
    const samples = weapon === 'rifle' ? [0.44, 0.58, 0.7, 1.08, 1.25] : [0.54, 0.62, 0.74]
    const palmLocal: Vector3[] = []
    let previousTime = 0
    for (const time of samples) {
      advance(time - previousTime)
      previousTime = time
      const rig = runtime.rig.arms.left
      const matrix = new Matrix4().makeRotationFromQuaternion(rig.hand.getWorldQuaternion(new Quaternion()).multiply(rig.rest.handWorld.clone().invert()))
      const restFrame = new Quaternion()
      const forward = rig.fingerDirection.clone()
      const palm = rig.palm.clone()
      const z = new Vector3().crossVectors(forward, palm)
      restFrame.setFromRotationMatrix(new Matrix4().makeBasis(forward, palm, z))
      const centre = rig.palmOffset.clone().applyQuaternion(restFrame).applyMatrix4(matrix).add(rig.hand.getWorldPosition(new Vector3()))
      const mag = runtime.weaponPivot().getObjectByName('magazine') as Bone
      palmLocal.push(mag.worldToLocal(centre))
    }
    for (const centre of palmLocal.slice(1)) expect(centre.distanceTo(palmLocal[0])).toBeLessThan(0.005)
  })
})
