import { createConsumerOverlayStates, type ConsumerOverlayState, type ConsumerUpperBodyMontage } from 'als-ue5-r3f/als/AnimGraph/consumerOverlayStates'
import { createConsumerUpperBodySlot } from 'als-ue5-r3f/als/AnimGraph/consumerUpperBodySlot'
import { ALS_VIRTUAL_BONES } from 'als-ue5-r3f/als/Utility/AlsVirtualBones'
import { createRigDefinition } from 'als-ue5-r3f/engine/rig'
import { applyPose, createPoseApplicator } from 'als-ue5-r3f/engine/applyPose'
import { createVirtualBonePoseScratch, refreshVirtualBonePose } from 'als-ue5-r3f/engine/virtualBones'
import { Euler, Group, Matrix4, Vector3 } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { createArmsActionClips, createFirstPersonPoseBanks, armsActionClipName } from './clips'
import { createArmsMesh } from './geometry'
import type { ArmsAssets } from './manifest'
import type { ArmsAction, ArmsState, ArmsWeapon } from './state'

const weaponModes = { rifle: 'BlacksiteArmsRifle', pistol: 'BlacksiteArmsPistol' } as const
export const DEFAULT_ARMS_PRESENTATION = {
  rifle: { position: [0.2, -1.6, -0.36], aimOffset: [0, 0, 0.21], sight: [0, 0.15937, 0.03789] },
  pistol: { position: [0.24, -1.7, -0.1], aimOffset: [0, 0, 0.06], sight: [0, 0.0798, 0.00189] },
} satisfies Record<ArmsWeapon, { position: [number, number, number]; aimOffset: [number, number, number]; sight: [number, number, number] }>

const DEFAULT_ARMS_SPRINT = { pivot: new Vector3(0.2, -0.26, -0.3), position: new Vector3(0, 0.03, 0.02), rotation: new Euler(-0.1, 0.28, 0.06) }

export function createArmsRuntime(assets: ArmsAssets, state: ArmsState) {
  const mesh = createArmsMesh(assets.character.scene)
  if (assets.dress && assets.dressed?.arms) assets.dress.arms(mesh.scene)
  const rig = createRigDefinition(mesh.scene, ALS_VIRTUAL_BONES)
  const applicator = createPoseApplicator(mesh.scene, rig)
  const virtualScratch = createVirtualBonePoseScratch(rig.boneCount)
  const fallbackClips = createArmsActionClips(rig, assets.character.animations)
  const clips = [...assets.animations, ...fallbackClips, ...createFirstPersonPoseBanks(assets.character.animations)]
  const clipMap = new Map(clips.map(clip => [clip.name, clip]))
  const states: ConsumerOverlayState[] = (['rifle', 'pistol'] as const).map(weapon => {
    const type = weapon === 'rifle' ? 'Rifle' : 'PistolTwoHanded'
    return {
      mode: weaponModes[weapon], template: type,
      sources: {
        poses: `Blacksite_${weapon}_Poses`, aim: `A_Als_${type}_Aim`, aimCrouch: `A_Als_${type}_Aim_Crouch`,
        aimReference: `A_Als_${type}_Poses`, idle: 'A_Als_Idle', idleReference: 'A_Als_Stand_Pose',
        runArms: 'A_Als_Rifle_Run_Arms', sprintArms: 'A_Als_Rifle_Sprint_Arms', sprintImpulseArms: 'A_Als_Rifle_Sprint_Impulse_Arms',
        ...assets.manifest.weapons?.[weapon]?.clips,
      },
    }
  })
  let montage: ConsumerUpperBodyMontage | null = null
  const registration = { clips, states, sampleMontage: () => montage }
  const overlays = createConsumerOverlayStates(rig, clips, registration)
  const slot = createConsumerUpperBodySlot(rig, registration)
  const root = new Group()
  root.name = 'BlacksiteArmsCameraAttachment'
  const body = new Group()
  body.rotation.y = Math.PI
  body.position.fromArray(DEFAULT_ARMS_PRESENTATION[state.weapon].position)
  body.add(mesh.scene)
  root.add(body)
  const weapons = (['rifle', 'pistol'] as const).map(weapon => {
    const object = clone(assets.weapons[weapon])
    object.name = `BlacksiteArmsWeapon_${weapon}`
    const attachment = assets.manifest.weapons?.[weapon]?.attachment
    const bone = mesh.scene.getObjectByName(attachment?.bone ?? 'VB hand_r_to_ik_hand_gun')
    if (!bone) throw new Error(`Arms weapon attachment bone missing: ${attachment?.bone}`)
    bone.add(object)
    object.position.fromArray(attachment?.position ?? [0, 0, 0])
    object.rotation.set(...(attachment?.rotation ?? [0, 0, 0]))
    object.scale.setScalar(attachment?.scale ?? 1)
    object.traverse(child => { child.frustumCulled = false })
    if (assets.dress && assets.dressed?.[weapon]) assets.dress.weapon(weapon, object)
    return { weapon, object, flash: assets.dress?.flash(weapon, object) }
  })
  const previous = { fire: state.fireSequence, reload: state.reloadSequence, equip: state.equipSequence, weapon: state.weapon }
  let sequence = 0
  let clock = 0
  let phase = 0
  let action: ArmsAction | null = null
  let actionTime = 0
  let previousRotations: Float32Array | null = null
  let aimAmount = 0
  let movementAmount = 0
  let sprintAmount = 0
  const sprintShift = new Vector3()
  const inverseRoot = new Matrix4()
  const sight = new Vector3()
  const input = {
    relevant: true, deltaTime: 0, rotationMode: 'ViewDirection' as 'Aiming' | 'ViewDirection',
    locomotionMode: 'Grounded' as const, gait: 'Walking' as 'Walking' | 'Running' | 'Sprinting',
    transitionsAllowed: true, moving: false, pitchAmount: 0.5,
    standingAmount: 1, crouchingAmount: 0, gaitWalkingAmount: 0,
    gaitRunningAmount: 0, gaitSprintingAmount: 0, inAirAmount: 0,
    groundPredictionAmount: 0, sprintAccelerationAmount: 0,
    velocityBlend: { forwardAmount: 1, backwardAmount: 0, leftAmount: 0, rightAmount: 0 },
  }
  state.debug.boneCount = rig.physicalBoneCount
  state.debug.triangles = mesh.triangles
  const startAction = (next: ArmsAction, weapon: ArmsWeapon) => {
    const clipName = assets.manifest.weapons?.[weapon]?.clips?.[next] ?? armsActionClipName(weapon, next, state.aiming && next === 'fire')
    if (!clipMap.has(clipName)) throw new Error(`Missing arms ${weapon} ${next} clip: ${clipName}`)
    action = next
    actionTime = 0
    montage = { id: `${++sequence}`, clip: clipName, time: 0, playRate: 1, blendIn: next === 'fire' ? 0.015 : 0.08, blendOut: next === 'fire' ? 0.06 : 0.12 }
  }
  startAction('equip', state.weapon)
  return {
    root,
    update(delta: number) {
      if (!Number.isFinite(delta) || delta < 0) throw new Error('Arms delta must be finite seconds')
      clock += delta
      phase += delta * state.speed / 1.5
      input.deltaTime = delta
      input.rotationMode = state.aiming ? 'Aiming' : 'ViewDirection'
      input.moving = state.speed > 0.05
      input.gait = 'Walking'
      input.gaitWalkingAmount = input.moving ? 1 : 0
      input.gaitRunningAmount = 0
      input.gaitSprintingAmount = 0
      if (state.weapon !== previous.weapon || state.equipSequence !== previous.equip) startAction('equip', state.weapon)
      else if (state.reloadSequence !== previous.reload) startAction('reload', state.weapon)
      else if (state.fireSequence !== previous.fire) {
        startAction('fire', state.weapon)
        weapons.find(entry => entry.weapon === state.weapon)!.flash?.fire((sequence * 0.618034) % 1)
      }
      else if (montage) {
        actionTime += delta
        if (actionTime >= clipMap.get(montage.clip)!.duration) { montage = null; action = null }
        else montage = { ...montage, time: actionTime }
      }
      previous.fire = state.fireSequence
      previous.reload = state.reloadSequence
      previous.equip = state.equipSequence
      previous.weapon = state.weapon
      const mode = weaponModes[state.weapon]
      const overlay = overlays.get(mode)!
      overlay.setTime(phase, clock)
      overlay.update(input)
      const native = overlay.evaluate(input)
      slot.update(delta, false, mode)
      const pose = slot.evaluate(native)?.get('ArmRight')?.pose ?? native.pose
      refreshVirtualBonePose(pose, rig, virtualScratch)
      applyPose(applicator, pose)
      let poseDelta = 0
      if (previousRotations) {
        for (let index = 0; index < pose.rotations.length; index++) poseDelta = Math.max(poseDelta, Math.abs(pose.rotations[index] - previousRotations[index]))
        previousRotations.set(pose.rotations)
      } else previousRotations = pose.rotations.slice()
      for (const entry of weapons) { entry.object.visible = entry.weapon === state.weapon; entry.flash?.update(delta) }
      aimAmount += ((state.aiming ? 1 : 0) - aimAmount) * (1 - Math.exp(-16 * delta))
      movementAmount += ((input.moving ? 1 : 0) - movementAmount) * (1 - Math.exp(-12 * delta))
      sprintAmount += ((state.sprinting && !state.aiming ? 1 : 0) - sprintAmount) * (1 - Math.exp(-10 * delta))
      const bob = Math.sin(phase * Math.PI * 2) * movementAmount * (state.sprinting ? 0.012 : 0.006) * (1 - aimAmount * 0.8)
      const framing = assets.manifest.weapons?.[state.weapon]?.presentation
      body.position.fromArray(framing?.position ?? DEFAULT_ARMS_PRESENTATION[state.weapon].position)
      const aimOffset = framing?.aimOffset ?? DEFAULT_ARMS_PRESENTATION[state.weapon].aimOffset
      const sprint = DEFAULT_ARMS_SPRINT
      root.rotation.set(sprint.rotation.x * sprintAmount, sprint.rotation.y * sprintAmount, sprint.rotation.z * sprintAmount + Math.cos(phase * Math.PI * 2) * movementAmount * (state.sprinting ? 0.02 : 0.006) * (1 - aimAmount))
      sprintShift.copy(sprint.pivot).applyEuler(root.rotation).negate().add(sprint.pivot).addScaledVector(sprint.position, sprintAmount)
      root.updateWorldMatrix(true, true)
      inverseRoot.copy(root.matrixWorld).invert()
      const weaponObject = weapons.find(entry => entry.weapon === state.weapon)!.object
      sight.fromArray(framing?.sight ?? DEFAULT_ARMS_PRESENTATION[state.weapon].sight)
        .applyMatrix4(weaponObject.matrixWorld).applyMatrix4(inverseRoot).applyQuaternion(root.quaternion)
      root.position.set(aimAmount * (aimOffset[0] - sight.x), bob + aimAmount * (aimOffset[1] - sight.y), aimAmount * aimOffset[2]).add(sprintShift)
      root.updateMatrix()
      state.debug.animationSeconds = clock
      state.debug.frames++
      state.debug.activeAction = action
      state.debug.weapon = state.weapon
      state.debug.aiming = state.aiming
      state.debug.aimAmount = aimAmount
      state.debug.poseDelta = poseDelta
    },
    dispose() {
      mesh.dispose()
      for (const entry of weapons) entry.flash?.dispose()
    },
  }
}

const inverseCamera = new Matrix4()
const measured = new Matrix4()

export function measureArmsAttachment(camera: { matrixWorld: Matrix4 }, attachment: Group): number {
  inverseCamera.copy(camera.matrixWorld).invert()
  measured.multiplyMatrices(inverseCamera, attachment.matrixWorld)
  let error = 0
  for (let index = 0; index < 16; index++) error = Math.max(error, Math.abs(measured.elements[index] - attachment.matrix.elements[index]))
  return error
}
