import { AnimationClip, Euler, Matrix4, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'
import { compileClipSampler, sampleClip } from 'als-ue5-r3f/engine/clipSampler'
import { createPoseBuffer } from 'als-ue5-r3f/engine/poseBuffer'
import type { RigDefinition } from 'als-ue5-r3f/engine/rig'
import actions from '../../assets/arms-actions.json'
import type { ArmsAction, ArmsWeapon } from './state'

export function createArmsActionClips(rig: RigDefinition, animations: readonly AnimationClip[], aiming = false): AnimationClip[] {
  const result: AnimationClip[] = []
  const base = createPoseBuffer(rig.boneCount)
  const quaternion = new Quaternion()
  const offset = new Quaternion()
  const rotation = new Euler()
  const matrices = Array.from({ length: rig.physicalBoneCount }, () => new Matrix4())
  const position = new Vector3()
  const scale = new Vector3()
  const local = new Matrix4()
  const gunToHand = new Matrix4()
  const gunTarget = new Matrix4()
  const handIndex = rig.boneNames.indexOf('hand_r')
  const gunIndex = rig.boneNames.indexOf('ik_hand_gun')
  const gunParent = rig.parentIndices[gunIndex]
  for (const weapon of ['rifle', 'pistol'] as const) {
    const name = weapon === 'rifle' ? 'A_Als_Rifle_Poses' : 'A_Als_PistolTwoHanded_Poses'
    const poses = animations.find(clip => clip.name === name)
    if (!poses) throw new Error(`Missing arms base clip ${name}`)
    const poseTime = weapon === 'rifle' ? 0.166667 : 0.2
    sampleClip(compileClipSampler(poses, rig), rig, poseTime, base, false)
    const updateMatrices = (deltas?: Record<string, number[][]>, frame = 0) => {
      for (let index = 0; index < rig.physicalBoneCount; index++) {
        quaternion.fromArray(base.rotations, index * 4)
        const delta = deltas?.[rig.boneNames[index]]?.[frame]
        if (delta) {
          offset.setFromEuler(rotation.set(delta[0] * Math.PI / 180, delta[1] * Math.PI / 180, delta[2] * Math.PI / 180))
          quaternion.multiply(offset).normalize()
        }
        local.compose(position.fromArray(base.positions, index * 3), quaternion, scale.fromArray(base.scales, index * 3))
        const parent = rig.parentIndices[index]
        if (parent >= 0) matrices[index].multiplyMatrices(matrices[parent], local)
        else matrices[index].copy(local)
      }
    }
    updateMatrices()
    gunToHand.copy(matrices[handIndex]).invert().multiply(matrices[gunIndex])
    for (const action of ['fire', 'reload', 'equip'] as const) {
      if (aiming && action !== 'fire') continue
      const data = actions[action]
      const times = actions.timings[weapon][action]
      const tracks = []
      const gunPositions: number[] = []
      const gunRotations: number[] = []
      for (let frame = 0; frame < times.length; frame++) {
        updateMatrices(data.bones, frame)
        gunTarget.copy(matrices[gunParent]).invert().multiply(matrices[handIndex]).multiply(gunToHand)
        gunTarget.decompose(position, quaternion, scale)
        position.toArray(gunPositions, gunPositions.length)
        quaternion.toArray(gunRotations, gunRotations.length)
      }
      for (let index = 0; index < rig.physicalBoneCount; index++) {
        const bone = rig.boneNames[index]
        const rotations: number[] = []
        const positions: number[] = []
        const scales: number[] = []
        const deltas = (data.bones as Record<string, number[][]>)[bone]
        for (let frame = 0; frame < times.length; frame++) {
          quaternion.fromArray(base.rotations, index * 4)
          if (deltas) {
            const [x, y, z] = deltas[frame]
            offset.setFromEuler(rotation.set(x * Math.PI / 180, y * Math.PI / 180, z * Math.PI / 180))
            quaternion.multiply(offset).normalize()
          }
          quaternion.toArray(rotations, rotations.length)
          positions.push(...base.positions.subarray(index * 3, index * 3 + 3))
          scales.push(...base.scales.subarray(index * 3, index * 3 + 3))
        }
        tracks.push(new QuaternionKeyframeTrack(`${bone}.quaternion`, times, index === gunIndex ? gunRotations : rotations),
          new VectorKeyframeTrack(`${bone}.position`, times, index === gunIndex ? gunPositions : positions),
          new VectorKeyframeTrack(`${bone}.scale`, times, scales))
      }
      result.push(new AnimationClip(armsActionClipName(weapon, action, aiming), times.at(-1)!, tracks))
    }
  }
  return aiming ? result : [...result, ...createArmsActionClips(rig, animations, true)]
}

export const armsActionClipName = (weapon: ArmsWeapon, action: ArmsAction, aiming = false) => `Blacksite_${weapon}_${action}${aiming ? '_aim' : ''}`

export function createFirstPersonPoseBanks(animations: readonly AnimationClip[]) {
  return (['rifle', 'pistol'] as const).map(weapon => {
    const type = weapon === 'rifle' ? 'Rifle' : 'PistolTwoHanded'
    const source = animations.find(clip => clip.name === `A_Als_${type}_Poses`)
    if (!source) throw new Error(`Missing ${type} pose bank`)
    const clip = source.clone()
    clip.name = `Blacksite_${weapon}_Poses`
    const readyTime = weapon === 'rifle' ? 0.166667 : 0.2
    const relaxedEnd = weapon === 'rifle' ? 0.134 : 0.167
    for (let trackIndex = 0; trackIndex < clip.tracks.length; trackIndex++) {
      const track = clip.tracks[trackIndex]
      const original = source.tracks[trackIndex]
      const width = track.getValueSize()
      const interpolant = original.InterpolantFactoryMethodLinear()
      const ready = Array.from(interpolant.evaluate(readyTime))
      for (let index = 0; index < track.times.length; index++) {
        if (track.times[index] <= relaxedEnd) track.values.set(ready, index * width)
      }
    }
    return clip
  })
}
