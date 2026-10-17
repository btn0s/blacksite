import { Bone, Euler, Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import type { ArmsDress, MuzzleFlash } from '../arms/dress'
import type { ArmsState, ArmsWeapon } from '../arms/state'
import { createClipSample, resetClipSample, sampleClip, VIEWMODEL_CLIPS, type Clip, type ViewmodelAction } from './clips'
import { applyGunPose, createViewmodelFeel } from '../feel/viewmodel'
import { GRIPS, VIEWMODEL, VIEWMODEL_WEAPONS, type LeftAnchor, type Socket, type Vec3, type WeaponModel } from './model'
import { createArmsRig, type Side } from './rig'

export type ViewmodelAssets = {
  arms: Object3D
  weapons: Record<ArmsWeapon, Object3D>
  dress?: ArmsDress
}

type WeaponRig = {
  weapon: ArmsWeapon
  model: WeaponModel
  pivot: Group
  mesh: Object3D
  magazine: Bone | null
  magazineRest: { position: Vector3; quaternion: Quaternion; scale: Vector3; pivot: Vector3 }
  part: Bone | null
  partRest: Vector3
  partBack: Vector3
  hammer: Bone | null
  hammerRest: Quaternion
  trigger: Bone | null
  triggerRest: Quaternion
  flash?: MuzzleFlash
  sight: Vector3
  rearSight: Vector3
  aimRotation: Vec3
  anchors: Partial<Record<LeftAnchor, { bone: Bone; position: Vector3; fingers: Vector3; palm: Vector3 }>>
}

const ANCHORS: LeftAnchor[] = ['support', 'magazine', 'charge', 'free']
const toPivot = (value: Vec3, target = new Vector3()) => target.set(value[0], value[1], value[2])
const meshToPivot = (value: Vec3, target = new Vector3()) => target.set(-value[0], value[1], -value[2])

function boneDirection(bone: Bone, mesh: Object3D, direction: Vector3) {
  mesh.updateWorldMatrix(true, true)
  const parent = bone.parent!
  const meshQuaternion = mesh.getWorldQuaternion(new Quaternion())
  const parentQuaternion = parent.getWorldQuaternion(new Quaternion())
  return direction.clone().applyQuaternion(meshQuaternion).applyQuaternion(parentQuaternion.invert()).normalize()
}

function boneRotation(bone: Bone, mesh: Object3D, euler: Euler, target: Quaternion) {
  const meshQuaternion = mesh.getWorldQuaternion(new Quaternion())
  const parentQuaternion = bone.parent!.getWorldQuaternion(new Quaternion())
  const local = parentQuaternion.clone().invert().multiply(meshQuaternion)
  const rotation = new Quaternion().setFromEuler(euler)
  return target.copy(local).multiply(rotation).multiply(local.invert())
}

export function createViewmodelRuntime(assets: ViewmodelAssets, state: ArmsState) {
  const root = new Group()
  root.name = 'BlacksiteViewmodel'
  const arms = clone(assets.arms)
  arms.name = 'BlacksiteViewmodelArms'
  arms.rotation.y = Math.PI
  arms.traverse(child => { child.frustumCulled = false })
  if (assets.dress) assets.dress.fieldArms(arms)
  arms.scale.setScalar(VIEWMODEL.arms.scale)
  const stretch = (from: string, to: string, amount: number) => {
    const start = arms.getObjectByName(from)
    for (let bone = arms.getObjectByName(to); bone && bone !== start; bone = bone.parent ?? undefined) bone.position.multiplyScalar(amount)
  }
  for (const side of ['l', 'r']) {
    stretch(`upperarm_${side}`, `lowerarm_${side}`, VIEWMODEL.arms.upperArmStretch)
    stretch(`lowerarm_${side}`, `hand_${side}`, VIEWMODEL.arms.forearmStretch)
  }
  root.add(arms)
  root.updateMatrixWorld(true)
  for (const side of ['right', 'left'] as const) {
    const upper = arms.getObjectByName(`upperarm_${side === 'right' ? 'r' : 'l'}`)!
    upper.position.copy(upper.parent!.worldToLocal(toPivot(VIEWMODEL.shoulders[side])))
  }
  root.updateMatrixWorld(true)
  const rig = createArmsRig(arms)
  const boneCount = countArmsBones(arms)
  let triangles = 0
  arms.traverse(child => { const geometry = (child as { geometry?: { index?: { count: number } | null } }).geometry; if (geometry?.index) triangles += geometry.index.count / 3 })

  const weapons = {} as Record<ArmsWeapon, WeaponRig>
  for (const weapon of ['rifle', 'pistol'] as const) {
    const model = VIEWMODEL_WEAPONS[weapon]
    const pivot = new Group()
    pivot.name = `BlacksiteViewmodelWeapon_${weapon}`
    const mesh = clone(assets.weapons[weapon])
    mesh.rotation.y = Math.PI
    mesh.traverse(child => { child.frustumCulled = false })
    pivot.add(mesh)
    root.add(pivot)
    if (assets.dress) assets.dress.weapon(weapon, mesh)
    root.updateMatrixWorld(true)
    const find = (name: string) => { const found = mesh.getObjectByName(name); return found instanceof Bone ? found : null }
    const magazine = find(model.magazine.bone)
    const part = find(model.cycle.part)
    const hammer = find('hammer')
    const trigger = find('trigger')
    const magazinePivot = magazine ? pivot.worldToLocal(magazine.getWorldPosition(new Vector3())) : new Vector3()
    const anchors: WeaponRig['anchors'] = {}
    for (const [anchor, bone] of [['magazine', magazine], ['charge', part]] as const) {
      if (!bone) continue
      const socket = model.left[anchor]
      const rotation = bone.getWorldQuaternion(new Quaternion()).invert()
      anchors[anchor] = { bone, position: bone.worldToLocal(toPivot(socket.position)), fingers: toPivot(socket.fingers).applyQuaternion(rotation), palm: toPivot(socket.palm).applyQuaternion(rotation) }
    }
    const sight = meshToPivot(model.sight)
    const rearSight = meshToPivot(model.rearSight)
    const aimQuaternion = new Quaternion().setFromUnitVectors(sight.clone().sub(rearSight).normalize(), new Vector3(0, 0, -1))
    aimQuaternion.multiply(new Quaternion().setFromEuler(new Euler(...model.aimRotation)))
    const aimEuler = new Euler().setFromQuaternion(aimQuaternion)
    weapons[weapon] = {
      weapon, model, pivot, mesh, magazine, part, hammer, trigger, anchors,
      magazineRest: { position: magazine?.position.clone() ?? new Vector3(), quaternion: magazine?.quaternion.clone() ?? new Quaternion(), scale: magazine?.scale.clone() ?? new Vector3(1, 1, 1), pivot: magazinePivot },
      partRest: part?.position.clone() ?? new Vector3(),
      partBack: part ? boneDirection(part, mesh, new Vector3(0, 0, -1)) : new Vector3(),
      hammerRest: hammer?.quaternion.clone() ?? new Quaternion(),
      triggerRest: trigger?.quaternion.clone() ?? new Quaternion(),
      flash: assets.dress?.flash(weapon, mesh),
      sight, rearSight, aimRotation: [aimEuler.x, aimEuler.y, aimEuler.z],
    }
  }

  const sample = createClipSample()
  const feel = createViewmodelFeel(state)
  let displayed: ArmsWeapon = state.weapon
  let pending: ArmsWeapon | null = null
  type Playing = { action: Exclude<ViewmodelAction, 'fire'>; clip: Clip; time: number; weight: number; fading: boolean }
  let playing: Playing | null = null
  let sprintAmount = 0
  let clock = 0
  let cycleTime = Infinity
  let shotIndex = 0
  let triggerPull = 0
  const previous = { fire: state.fireSequence, reload: state.reloadSequence, equip: state.equipSequence, weapon: state.weapon, inspect: state.inspectSequence, land: state.landSequence }

  const play = (action: Exclude<ViewmodelAction, 'fire'>, weapon: ArmsWeapon) => {
    playing = { action, clip: VIEWMODEL_CLIPS[weapon][action], time: 0, weight: action === 'reload' || action === 'inspect' ? 0 : 1, fading: false }
  }
  play('equip', displayed)

  const position = new Vector3()
  const pivotPoint = new Vector3()
  const aimedSight = new Vector3()
  const rotation = new Euler(0, 0, 0, 'XYZ')
  const quaternion = new Quaternion()
  const socketPosition = new Vector3()
  const socketFingers = new Vector3()
  const socketPalm = new Vector3()
  const wrist = new Vector3()
  const hand = new Quaternion()
  const pole = new Vector3()
  const blendPosition = new Vector3()
  const blendQuaternion = new Quaternion()
  const local = new Vector3()
  const magazineQuaternion = new Quaternion()
  const magazineEuler = new Euler()
  const freeEuler = new Euler()
  const holderEuler = new Euler(0, 0, 0, 'YXZ')
  const sightPoint = new Vector3()
  const freeQuaternion = new Quaternion()
  const matrix = new Matrix4()

  const socketWorld = (rigged: WeaponRig, socket: Socket, mode: LeftAnchor | 'right') => {
    local.copy(toPivot(socket.position, socketPosition))
    socketFingers.set(...socket.fingers).normalize()
    socketPalm.set(...socket.palm).normalize()
    const anchor = mode === 'magazine' || mode === 'charge' ? rigged.anchors[mode] : null
    if (anchor) {
      socketPosition.copy(anchor.position).applyMatrix4(anchor.bone.matrixWorld)
      anchor.bone.getWorldQuaternion(quaternion)
      socketFingers.copy(anchor.fingers).applyQuaternion(quaternion)
      socketPalm.copy(anchor.palm).applyQuaternion(quaternion)
      return
    }
    rigged.pivot.updateMatrixWorld(true)
    socketPosition.copy(local).applyMatrix4(rigged.pivot.matrixWorld)
    quaternion.setFromRotationMatrix(matrix.extractRotation(rigged.pivot.matrixWorld))
    socketFingers.applyQuaternion(quaternion)
    socketPalm.applyQuaternion(quaternion)
  }

  const partTravel = (rigged: WeaponRig) => {
    const cycle = rigged.model.cycle
    const fired = cycleTime < cycle.seconds ? Math.sin(Math.PI * cycleTime / cycle.seconds) * cycle.travel : 0
    const locked = cycle.locksOpen && state.empty && !(playing?.action === 'reload' && playing.time > playing.clip.duration * 0.5) ? cycle.rack : 0
    return Math.max(fired, locked, sample.part * cycle.rack)
  }

  const handPose = [new Vector3(), new Vector3(), new Vector3(), new Vector3()]
  const handQuaternions = [new Quaternion(), new Quaternion(), new Quaternion(), new Quaternion()]

  return {
    root,
    rig,
    update(delta: number, worldView?: Quaternion) {
      if (!Number.isFinite(delta) || delta < 0) throw new Error('Viewmodel delta must be finite seconds')
      const step = Math.min(delta, 0.1) * (state.timeScale ?? 1) + (state.debug.advance ?? 0)
      state.debug.advance = 0
      clock += step

      if (state.weapon !== previous.weapon) {
        pending = state.weapon
        play('holster', displayed)
      } else if (state.equipSequence !== previous.equip) play('equip', displayed)
      else if (state.reloadSequence !== previous.reload) play('reload', displayed)
      else if (state.inspectSequence !== previous.inspect && !playing) play('inspect', displayed)
      if (state.fireSequence !== previous.fire) {
        if (pending) { displayed = pending; pending = null; playing = null }
        if (playing?.action === 'equip') playing = null
        const rigged = weapons[displayed]
        const random = (shotIndex * 0.618034) % 1
        shotIndex++
        cycleTime = 0
        triggerPull = 1
        rigged.flash?.fire(random)
        if (playing?.action === 'inspect' || playing?.action === 'reload') playing.fading = true
      }
      previous.fire = state.fireSequence; previous.reload = state.reloadSequence; previous.equip = state.equipSequence
      previous.weapon = state.weapon; previous.inspect = state.inspectSequence; previous.land = state.landSequence

      if (playing) {
        playing.time += step
        if (playing.action === 'inspect' && (state.aiming || state.sprinting)) playing.fading = true
        const fadeIn = playing.action === 'reload' || playing.action === 'inspect' ? 0.08 : 0
        playing.weight = playing.fading ? Math.max(0, playing.weight - step / 0.15) : fadeIn ? Math.min(1, playing.weight + step / fadeIn) : 1
        if (playing.time >= playing.clip.duration || (playing.fading && playing.weight <= 0)) {
          const finished = playing.action
          playing = null
          if (finished === 'holster' && pending) { displayed = pending; pending = null; play('equip', displayed) }
        }
      }
      resetClipSample(sample)
      if (playing) sampleClip(playing.clip, playing.time, playing.weight, sample)

      const rigged = weapons[displayed]
      const model = rigged.model
      const reloading = playing?.action === 'reload' || playing?.action === 'equip' || playing?.action === 'holster'
      const aim = feel.aim(state.aiming && !reloading, step, displayed)
      sprintAmount = feel.lower(state.sprinting && !state.aiming, step)
      cycleTime += step
      triggerPull = Math.max(0, triggerPull - step / 0.09)

      feel.update(step, worldView, sprintAmount, displayed)

      const hip = model.hip
      toPivot(model.pivot, pivotPoint)
      quaternion.setFromEuler(rotation.set(...rigged.aimRotation))
      aimedSight.copy(rigged.rearSight).sub(pivotPoint).applyQuaternion(quaternion).add(pivotPoint)
      const ads = { x: -aimedSight.x, y: -aimedSight.y, z: -model.eyeRelief - aimedSight.z }
      const sprint = model.sprint
      const clipScale = 1
      position.set(
        hip.position[0] + (ads.x - hip.position[0]) * aim + sprint.position[0] * sprintAmount + sample.weaponPosition[0] * clipScale,
        hip.position[1] + (ads.y - hip.position[1]) * aim + sprint.position[1] * sprintAmount + sample.weaponPosition[1] * clipScale,
        hip.position[2] + (ads.z - hip.position[2]) * aim + sprint.position[2] * sprintAmount + sample.weaponPosition[2] * clipScale,
      )
      rotation.set(
        hip.rotation[0] * (1 - aim) + rigged.aimRotation[0] * aim + sprint.rotation[0] * sprintAmount + sample.weaponRotation[0],
        hip.rotation[1] * (1 - aim) + rigged.aimRotation[1] * aim + sprint.rotation[1] * sprintAmount + sample.weaponRotation[1],
        hip.rotation[2] * (1 - aim) + rigged.aimRotation[2] * aim + sprint.rotation[2] * sprintAmount + sample.weaponRotation[2],
      )
      for (const entry of Object.values(weapons)) entry.pivot.visible = entry === rigged
      quaternion.setFromEuler(rotation)
      toPivot(model.pivot, pivotPoint)
      rigged.pivot.quaternion.copy(quaternion)
      rigged.pivot.position.copy(position).add(pivotPoint).sub(pivotPoint.clone().applyQuaternion(quaternion))
      applyGunPose(rigged.pivot, feel)
      holderEuler.setFromQuaternion(rigged.pivot.quaternion)
      sightPoint.copy(rigged.rearSight).applyQuaternion(rigged.pivot.quaternion).add(rigged.pivot.position)
      state.debug.holder = [sightPoint.x, sightPoint.y, sightPoint.z, holderEuler.x, holderEuler.y, holderEuler.z]

      if (rigged.magazine) {
        const rest = rigged.magazineRest
        const visible = sample.magazineVisible > 0.5
        rigged.magazine.scale.copy(rest.scale).multiplyScalar(visible ? 1 : 1e-4)
        magazineEuler.set(-sample.magazineRotation[0], sample.magazineRotation[1], -sample.magazineRotation[2])
        boneRotation(rigged.magazine, rigged.mesh, magazineEuler, magazineQuaternion)
        rigged.magazine.quaternion.copy(magazineQuaternion).multiply(rest.quaternion)
        local.set(-sample.magazinePosition[0], sample.magazinePosition[1], -sample.magazinePosition[2])
        rigged.magazine.position.copy(rest.position).add(boneDirection(rigged.magazine, rigged.mesh, local).multiplyScalar(local.length()))
      }
      const travel = partTravel(rigged)
      if (rigged.part) rigged.part.position.copy(rigged.partRest).addScaledVector(rigged.partBack, travel)
      if (rigged.hammer) rigged.hammer.quaternion.copy(rigged.hammerRest)
      if (rigged.trigger) rigged.trigger.quaternion.copy(rigged.triggerRest)
      for (const entry of Object.values(weapons)) entry.flash?.update(step)
      root.updateMatrixWorld(true)

      socketWorld(rigged, model.right, 'right')
      rig.handFrame('right', socketPosition, socketFingers, socketPalm, wrist, hand)
      rig.clearGrip('right')
      rig.addGrip('right', GRIPS[model.right.grip], 1)
      rig.grips.right.index[0] += 14 * triggerPull
      rig.grips.right.index[1] += 10 * triggerPull
      const rightError = rig.solve('right', wrist, hand, toPivot(model.elbows.right, pole), VIEWMODEL.forearmTwist)

      const weights = sample.left
      let total = 0
      for (const anchor of ANCHORS) total += Math.max(0, weights[anchor])
      if (total < 1) { weights.free += 1 - total; total = 1 }
      rig.clearGrip('left')
      blendPosition.set(0, 0, 0)
      let accumulated = 0
      for (let index = 0; index < ANCHORS.length; index++) {
        const anchorName = ANCHORS[index]
        const weight = Math.max(0, weights[anchorName]) / total
        if (weight <= 0) continue
        if (anchorName === 'free') {
          freeEuler.set(...sample.leftFreeRotation)
          freeQuaternion.setFromEuler(freeEuler)
          socketPosition.set(...sample.leftFree)
          socketFingers.set(0.35, -0.1, -1).normalize().applyQuaternion(freeQuaternion)
          socketPalm.set(1, 0.2, 0).normalize().applyQuaternion(freeQuaternion)
          rig.addGrip('left', GRIPS.relaxed, weight)
        } else {
          const socket = model.left[anchorName]
          socketWorld(rigged, socket, anchorName)
          rig.addGrip('left', GRIPS[socket.grip], weight)
        }
        rig.handFrame('left', socketPosition, socketFingers, socketPalm, handPose[index], handQuaternions[index])
        blendPosition.addScaledVector(handPose[index], weight)
        accumulated += weight
        if (accumulated === weight) blendQuaternion.copy(handQuaternions[index])
        else blendQuaternion.slerp(handQuaternions[index], weight / accumulated)
      }
      const leftError = rig.solve('left', blendPosition, blendQuaternion, toPivot(model.elbows.left, pole), VIEWMODEL.forearmTwist)

      const debug = state.debug
      debug.animationSeconds = clock
      debug.frames++
      debug.activeAction = playing?.action === 'holster' || playing?.action === 'inspect' ? null : playing?.action ?? null
      debug.action = playing?.action ?? null
      debug.actionTime = playing?.time ?? 0
      debug.weapon = displayed
      debug.aiming = state.aiming
      debug.aimAmount = aim
      debug.sprintAmount = sprintAmount
      debug.boneCount = boneCount
      debug.triangles = triangles
      debug.handError = Math.max(rightError, leftError)
      debug.reach = Math.max(rig.measure.reach.right, rig.measure.reach.left)
      debug.weaponOffset = [position.x - hip.position[0], position.y - hip.position[1], position.z - hip.position[2]]
      debug.recoilOffset = feel.gun.pose.pivot.position.z
      debug.swayRotation = feel.gun.pose.group.quaternion.y * 2
      debug.bobPhase = feel.phase
    },
    weaponPivot: () => weapons[displayed].pivot,
    sightInView(target = new Vector3()) {
      const rigged = weapons[displayed]
      rigged.pivot.updateMatrixWorld(true)
      return target.copy(rigged.sight).applyMatrix4(rigged.pivot.matrixWorld)
    },
    dispose() {
      for (const entry of Object.values(weapons)) entry.flash?.dispose()
    },
  }
}

export type ViewmodelRuntime = ReturnType<typeof createViewmodelRuntime>

export function countArmsBones(scene: Object3D) {
  let count = 0
  scene.traverse(child => { if (child instanceof Bone) count++ })
  return count
}
