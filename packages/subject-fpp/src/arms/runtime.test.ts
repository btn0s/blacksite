import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { Bone, Group, PerspectiveCamera, SkinnedMesh, Vector3 } from 'three'
import { createArmsState } from './state'
import { createArmsRuntime, measureArmsAttachment } from './runtime'
import { createArmsMesh } from './geometry'
import { validateArmsManifest, validateArmsSkeleton, type ArmsAssets } from './manifest'
import { createArmsActionClips, armsActionClipName } from './clips'
import { createRigDefinition } from 'als-ue5-r3f/engine/rig'
import { ALS_WEAPONS } from '../../../armory/src/presets'

const load = async (name: string) => {
  const bytes = readFileSync(new URL(`../../../../vendor/als-web/public/assets/${name}.glb`, import.meta.url))
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
}

const assets = async (): Promise<ArmsAssets> => {
  const [character, rifle, pistol] = await Promise.all([load('skm-als'), load('skm-als-rifle'), load('skm-als-pistol')])
  return { manifest: { version: 1 }, character, animations: character.animations, weapons: { rifle: rifle.scene, pistol: pistol.scene } }
}

describe('rigged arms', () => {
  it('retains original skeleton weights and clips only triangles weighted to arms', async () => {
    const character = await load('skm-als')
    const arms = createArmsMesh(character.scene)
    let boneCount = 0
    let count = 0
    arms.scene.traverse(object => {
      if (object instanceof Bone) boneCount++
      if (!(object instanceof SkinnedMesh)) return
      const indices = object.geometry.getIndex()!
      count += indices.count
      const joints = object.geometry.getAttribute('skinIndex')
      const weights = object.geometry.getAttribute('skinWeight')
      for (let index = 0; index < indices.count; index++) {
        const vertex = indices.getX(index)
        let armWeight = 0
        for (let slot = 0; slot < 4; slot++) {
          let bone: Bone | null = object.skeleton.bones[joints.getComponent(vertex, slot)]
          while (bone) {
            if (/^clavicle_[lr]$/.test(bone.name)) { armWeight += weights.getComponent(vertex, slot); break }
            bone = bone.parent instanceof Bone ? bone.parent : null
          }
        }
        expect(armWeight).toBeGreaterThanOrEqual(0.5)
      }
    })
    expect(boneCount).toBe(68)
    expect(count).toBeGreaterThan(100)
    expect(arms.triangles).toBe(count / 3)
    arms.dispose()
  })

  it('advances native animation exactly once in seconds at variable render rates and deforms both weapon rigs', async () => {
    const source = await assets()
    for (const weapon of ['rifle', 'pistol'] as const) {
      const state = createArmsState()
      state.weapon = weapon
      const runtime = createArmsRuntime(source, state)
      const hand = runtime.root.getObjectByName('hand_r')!
      let elapsed = 0
      for (let frame = 0; frame < 60; frame++) {
        const dt = frame % 2 ? 1 / 144 : 1 / 30
        elapsed += dt
        runtime.update(dt)
      }
      expect(state.debug.animationSeconds).toBe(elapsed)
      expect(state.debug.frames).toBe(60)
      expect(state.debug.boneCount).toBe(68)
      runtime.root.updateWorldMatrix(true, true)
      const camera = new PerspectiveCamera(70, 16 / 9, 0.005, 10)
      for (const name of ['hand_l', 'hand_r', 'ik_hand_gun']) {
        const position = runtime.root.getObjectByName(name)!.getWorldPosition(new Vector3())
        expect(position.z, `${weapon}:${name} near plane`).toBeLessThan(-0.15)
        const projected = position.project(camera)
        expect(Math.abs(projected.x), `${weapon}:${name} horizontal framing`).toBeLessThan(0.9)
        expect(Math.abs(projected.y), `${weapon}:${name} vertical framing`).toBeLessThan(0.9)
      }
      const idle = hand.quaternion.clone()
      state.aiming = true
      for (let frame = 0; frame < 30; frame++) runtime.update(1 / 60)
      runtime.root.updateWorldMatrix(true, true)
      expect(hand.quaternion.angleTo(idle)).toBeGreaterThan(0.01)
      state.fireSequence++
      runtime.update(1 / 60)
      runtime.update(0.035)
      expect(state.debug.activeAction).toBe('fire')
      expect(state.debug.poseDelta).toBeGreaterThan(0.001)
      state.reloadSequence++
      runtime.update(1 / 60)
      runtime.update(0.4)
      expect(state.debug.activeAction).toBe('reload')
      expect(state.debug.poseDelta).toBeGreaterThan(0.001)
      runtime.dispose()
    }
  }, 20000)

  it('measures zero camera attachment jitter under simultaneous translation and rotation and detects a stale camera', () => {
    const camera = new PerspectiveCamera()
    const attachment = new Group()
    attachment.position.set(0.18, -0.28, -0.45)
    camera.add(attachment)
    const staleCamera = new PerspectiveCamera()
    let maximum = 0
    for (let frame = 0; frame < 180; frame++) {
      camera.position.set(frame * 0.1, Math.sin(frame) * 0.2, -frame * 0.05)
      camera.rotation.set(frame * 0.003, frame * 0.02, 0)
      camera.updateWorldMatrix(true, true)
      maximum = Math.max(maximum, measureArmsAttachment(camera, attachment))
      if (frame > 0) expect(measureArmsAttachment(staleCamera, attachment)).toBeGreaterThan(0.01)
      staleCamera.matrixWorld.copy(camera.matrixWorld)
    }
    expect(maximum).toBeLessThan(1e-12)
  })

  it('rejects incompatible manifests and animation skeletons', async () => {
    expect(() => validateArmsManifest({ version: 2 })).toThrow('version 1')
    expect(() => validateArmsManifest({ version: 1, fov: 180 })).toThrow('FOV')
    const character = await load('skm-als')
    validateArmsSkeleton(character.scene, character.scene)
    expect(() => validateArmsSkeleton(character.scene, new Group())).toThrow('68-bone')
  })

  it('authors reload and equip clip durations to the gameplay completion boundaries', async () => {
    const character = await load('skm-als')
    const clips = createArmsActionClips(createRigDefinition(character.scene), character.animations)
    for (const weapon of ['rifle', 'pistol'] as const) {
      const preset = ALS_WEAPONS.find(definition => definition.id === weapon)!
      expect(clips.find(clip => clip.name === armsActionClipName(weapon, 'reload'))!.duration).toBe(preset.reloadSeconds)
      expect(clips.find(clip => clip.name === armsActionClipName(weapon, 'equip'))!.duration).toBe(preset.equipSeconds)
    }
  })
})
