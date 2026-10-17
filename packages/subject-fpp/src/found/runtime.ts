import { AnimationAction, AnimationClip, AnimationMixer, AnimationUtils, Bone, Euler, Group, LoopOnce, LoopRepeat, Matrix4, Object3D, Quaternion, QuaternionKeyframeTrack, Vector3, type KeyframeTrack, type Material, type Mesh } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import type { ArmsState, ArmsWeapon } from '../arms/state'
import { applyGunPose, createViewmodelFeel } from '../feel/viewmodel'
import { VIEWMODEL } from '../viewmodel/model'
import { approach, smoothstep } from '../viewmodel/spring'
import { FOUND_HOLSTER, FOUND_INSPECT, clipSeconds, type FoundClip, type FoundClipSource, type FoundSet, type FoundWeapon, type Vec3 } from './model'

export type FoundAsset = { scene: Object3D; animations: AnimationClip[] }
export type FoundAssets = Record<ArmsWeapon, FoundAsset>

type Action = 'fire' | 'reload' | 'draw' | 'holster' | 'inspect'
type Rigged = {
  spec: FoundWeapon
  holder: Group
  model: Object3D
  mixer: AnimationMixer
  actions: Partial<Record<FoundClip, AnimationAction>>
  bone: Object3D
  rear: Vector3
  front: Vector3
  up: Vector3
  bones: number
  triangles: number
  warm: Warmup | null
}

type Warmup = ReturnType<typeof warmup>

const LOCOMOTION = ['idle', 'walk', 'run'] as const
export const FOUND_CONVERGE = 12
const vector = (value: Vec3, target = new Vector3()) => target.set(value[0], value[1], value[2])

function resolveClip(asset: FoundAsset, source: FoundClipSource, fps: number, name: string) {
  const clipName = typeof source === 'string' ? source : source.clip
  const clip = asset.animations.find(entry => entry.name === clipName)
  if (!clip) throw new Error(`Found viewmodel clip ${clipName} is missing`)
  if (typeof source === 'string') return clip
  return AnimationUtils.subclip(clip, name, source.from, source.to, fps)
}

export function holdPose(clip: AnimationClip) {
  const tracks = clip.tracks.map((track: KeyframeTrack) => {
    const size = track.getValueSize()
    const count = track.times.length
    const mean = new Array<number>(size).fill(0)
    for (let key = 0; key < count; key++) {
      const flip = track instanceof QuaternionKeyframeTrack && key > 0 && [0, 1, 2, 3].reduce((dot, i) => dot + track.values[key * 4 + i] * track.values[i], 0) < 0 ? -1 : 1
      for (let i = 0; i < size; i++) mean[i] += track.values[key * size + i] * flip / count
    }
    if (track instanceof QuaternionKeyframeTrack) {
      const length = Math.hypot(...mean) || 1
      for (let i = 0; i < size; i++) mean[i] /= length
    }
    const Track = track.constructor as new (name: string, times: number[], values: number[]) => KeyframeTrack
    return new Track(track.name, [0, 1], [...mean, ...mean])
  })
  return new AnimationClip(clip.name, 1, tracks)
}

function warmup(model: Object3D) {
  const meshes: Mesh[] = []
  model.traverse(child => { if ((child as Mesh).isMesh) meshes.push(child as Mesh) })
  const materials = [...new Set(meshes.flatMap(mesh => [mesh.material].flat() as Material[]))]
  const writes = materials.map(material => [material.colorWrite, material.depthWrite] as const)
  const idle = Object3D.prototype.onAfterRender
  let drawn = false
  const done = () => { drawn = true }
  for (const mesh of meshes) mesh.onAfterRender = done
  const mask = (hidden: boolean) => materials.forEach((material, index) => {
    material.colorWrite = !hidden && writes[index][0]
    material.depthWrite = !hidden && writes[index][1]
  })
  return {
    drawn: () => drawn,
    mask,
    finish() {
      for (const mesh of meshes) if (mesh.onAfterRender === done) mesh.onAfterRender = idle
      mask(false)
    },
  }
}

function rig(asset: FoundAsset, spec: FoundWeapon, name: string): Rigged {
  const holder = new Group()
  holder.name = `FoundViewmodel_${name}`
  const base = new Group()
  const model = clone(asset.scene)
  model.traverse(child => { child.frustumCulled = false })
  for (const hidden of spec.hide ?? []) { const node = model.getObjectByName(hidden); if (node) node.visible = false }
  const forward = vector(spec.eye.forward).normalize()
  const up = vector(spec.eye.up ?? [0, 1, 0]).normalize()
  const right = new Vector3().crossVectors(forward, up).normalize()
  up.crossVectors(right, forward)
  const basis = new Matrix4().makeBasis(right, up, forward.clone().negate()).invert()
  base.quaternion.setFromRotationMatrix(basis)
  const scale = spec.scale ?? 1
  model.scale.setScalar(scale)
  base.position.copy(vector(spec.eye.position).multiplyScalar(scale).applyQuaternion(base.quaternion).negate())
  base.add(model)
  holder.add(base)
  holder.updateMatrixWorld(true)
  const bone = model.getObjectByName(spec.sight.bone)
  if (!bone) throw new Error(`Found viewmodel sight bone ${spec.sight.bone} is missing`)
  const inverseBone = new Matrix4().copy(bone.matrixWorld).invert().multiply(model.matrixWorld)
  const rear = vector(spec.sight.rear)
  const front = vector(spec.sight.front)
  const upDirection = spec.sight.up ? vector(spec.sight.up) : new Vector3(0, 1, 0).transformDirection(inverseBone)
  const mixer = new AnimationMixer(model)
  const actions: Rigged['actions'] = {}
  for (const [clip, source] of Object.entries(spec.clips) as [FoundClip, FoundClipSource][]) {
    const resolved = resolveClip(asset, source, spec.fps, `${name}:${clip}`)
    const action = mixer.clipAction(clip === 'idle' ? holdPose(resolved) : resolved)
    const looping = (LOCOMOTION as readonly string[]).includes(clip)
    action.setLoop(looping ? LoopRepeat : LoopOnce, Infinity)
    action.clampWhenFinished = !looping
    actions[clip] = action
  }
  for (const clip of LOCOMOTION) actions[clip]?.play().setEffectiveWeight(clip === 'idle' ? 1 : 0)
  let bones = 0
  let triangles = 0
  model.traverse(child => {
    if (child instanceof Bone) bones++
    const geometry = (child as { geometry?: { index?: { count: number } | null } }).geometry
    if (geometry?.index) triangles += geometry.index.count / 3
  })
  return { spec, holder, model, mixer, actions, bone, rear, front, up: upDirection.normalize(), bones, triangles, warm: warmup(model) }
}

export function foundSeconds(asset: FoundAsset, spec: FoundWeapon, clip: FoundClip) {
  const seconds = clipSeconds(spec, clip)
  if (seconds) return seconds
  const source = spec.clips[clip]
  return typeof source === 'string' ? asset.animations.find(entry => entry.name === source)?.duration ?? 0 : 0
}

export function createFoundRuntime(assets: FoundAssets, set: FoundSet, state: ArmsState) {
  const root = new Group()
  root.name = 'FoundViewmodel'
  const weapons = { rifle: rig(assets.rifle, set.weapons.rifle, 'rifle'), pistol: rig(assets.pistol, set.weapons.pistol, 'pistol') }
  for (const entry of Object.values(weapons)) root.add(entry.holder)

  const feel = createViewmodelFeel(state)
  let displayed: ArmsWeapon = state.weapon
  let pending: ArmsWeapon | null = null
  type Playing = { action: Action; clip: FoundClip | null; time: number; duration: number; weight: number; fading: boolean }
  let playing: Playing | null = null
  let sprintAmount = 0
  let moveAmount = 0
  let clock = 0
  const locomotion = { idle: 1, walk: 0, run: 0 }
  const previous = { fire: state.fireSequence, reload: state.reloadSequence, equip: state.equipSequence, weapon: state.weapon, inspect: state.inspectSequence, land: state.landSequence }

  const durationOf = (rigged: Rigged, clip: FoundClip) => foundSeconds(assets[rigged === weapons.rifle ? 'rifle' : 'pistol'], rigged.spec, clip)
  const stopAction = () => {
    if (!playing?.clip) return
    weapons[displayed].actions[playing.clip]?.stop()
  }
  const play = (action: Action, clip: FoundClip | null) => {
    stopAction()
    const rigged = weapons[displayed]
    const animation = clip ? rigged.actions[clip] : undefined
    if (clip && !animation) clip = null
    const duration = clip ? durationOf(rigged, clip) : action === 'holster' || action === 'draw' ? FOUND_HOLSTER.seconds : action === 'inspect' ? FOUND_INSPECT.seconds : 0
    if (animation && clip) {
      const authored = animation.getClip().duration
      animation.reset().setEffectiveTimeScale(duration > 0 ? authored / duration : 1).setEffectiveWeight(0).play()
    }
    playing = { action, clip, time: 0, duration, weight: action === 'fire' || action === 'draw' || action === 'holster' ? 1 : 0, fading: false }
  }
  play('draw', 'draw')

  const hipQuaternion = new Quaternion()
  const aimQuaternion = new Quaternion()
  const blendQuaternion = new Quaternion()
  const procedural = new Quaternion()
  const hipPosition = new Vector3()
  const aimPosition = new Vector3()
  const blendPosition = new Vector3()
  const pivot = new Vector3()
  const rear = new Vector3()
  const front = new Vector3()
  const up = new Vector3()
  const direction = new Vector3()
  const relative = new Matrix4()
  const inverseHolder = new Matrix4()
  const euler = new Euler()
  const holderEuler = new Euler(0, 0, 0, 'YXZ')
  const sightPoint = new Vector3()
  const clipQuaternion = new Quaternion()
  const clipRear = new Vector3()
  const groupEuler = new Euler(0, 0, 0, 'YXZ')
  const hipRear = new Vector3()
  const hipDirection = new Vector3()
  const converge = new Vector3()
  const correction = new Quaternion()
  const roll = new Quaternion()
  const minusZ = new Vector3(0, 0, -1)
  const offset = new Vector3()

  const sights = (rigged: Rigged) => {
    rigged.holder.position.set(0, 0, 0)
    rigged.holder.quaternion.identity()
    rigged.holder.updateMatrixWorld(true)
    inverseHolder.copy(rigged.holder.matrixWorld).invert()
    relative.multiplyMatrices(inverseHolder, rigged.bone.matrixWorld)
    rear.copy(rigged.rear).applyMatrix4(relative)
    front.copy(rigged.front).applyMatrix4(relative)
    up.copy(rigged.up).transformDirection(relative)
  }

  let held = 0

  return {
    root,
    update(delta: number, worldView?: Quaternion) {
      if (!Number.isFinite(delta) || delta < 0) throw new Error('Viewmodel delta must be finite seconds')
      const step = Math.min(delta, 0.1) * (state.timeScale ?? 1) + (state.debug.advance ?? 0)
      state.debug.advance = 0
      clock += step

      if (state.weapon !== previous.weapon) { pending = state.weapon; play('holster', 'holster') }
      else if (state.equipSequence !== previous.equip) play('draw', 'draw')
      else if (state.reloadSequence !== previous.reload) play('reload', state.empty && weapons[displayed].actions.reloadEmpty ? 'reloadEmpty' : 'reload')
      else if (state.inspectSequence !== previous.inspect && !playing) play('inspect', 'inspect')
      if (state.fireSequence !== previous.fire) {
        if (pending) { stopAction(); displayed = pending; pending = null; playing = null }
        const rigged = weapons[displayed]
        const aiming = state.aiming && rigged.actions.aimFire
        play('fire', aiming ? 'aimFire' : state.empty && rigged.actions.fireLast ? 'fireLast' : 'fire')
      }
      previous.fire = state.fireSequence; previous.reload = state.reloadSequence; previous.equip = state.equipSequence
      previous.weapon = state.weapon; previous.inspect = state.inspectSequence; previous.land = state.landSequence

      let holsterAmount = 0
      let inspectAmount = 0
      if (playing) {
        playing.time += step
        if (playing.action === 'inspect' && (state.aiming || state.sprinting)) playing.fading = true
        const fadeIn = playing.action === 'reload' || playing.action === 'inspect' ? 0.1 : 0
        const fadeOut = playing.action === 'fire' ? 0.12 : 0.18
        const tail = playing.duration - playing.time
        const target = playing.fading ? 0 : playing.action === 'holster' ? 1 : Math.min(1, Math.max(0, tail / fadeOut))
        playing.weight = playing.fading ? Math.max(0, playing.weight - step / 0.15) : fadeIn ? Math.min(target, playing.weight + step / fadeIn) : target
        if (!playing.clip && playing.action === 'holster') holsterAmount = smoothstep(playing.time / playing.duration)
        if (!playing.clip && playing.action === 'draw') holsterAmount = 1 - smoothstep(playing.time / playing.duration)
        if (!playing.clip && playing.action === 'inspect') inspectAmount = Math.sin(Math.PI * Math.min(1, playing.time / playing.duration)) ** 2 * (playing.fading ? playing.weight : 1)
        if (playing.time >= playing.duration || (playing.fading && playing.weight <= 0)) {
          const finished = playing.action
          stopAction()
          playing = null
          if (finished === 'holster' && pending) { displayed = pending; pending = null; play('draw', 'draw') }
        }
      }

      const rigged = weapons[displayed]
      const spec = rigged.spec
      const busy = playing?.action === 'reload' || playing?.action === 'draw' || playing?.action === 'holster'
      const aim = feel.aim(state.aiming && !busy, step, displayed)
      sprintAmount = feel.lower(state.sprinting && !state.aiming, step)
      const moving = state.speed > VIEWMODEL.moveThreshold
      moveAmount = approach(moveAmount, moving ? Math.min(1.6, state.speed / VIEWMODEL.bob.walkSpeed) : 0, VIEWMODEL.bob.blendRate, step)

      const run = rigged.actions.run ? sprintAmount : 0
      const walk = rigged.actions.walk ? Math.min(1, moveAmount) * (1 - run) * (1 - aim) : 0
      locomotion.run = run
      locomotion.walk = walk
      locomotion.idle = 1 - run - walk
      const actionWeight = playing?.clip ? playing.weight : 0
      for (const clip of LOCOMOTION) rigged.actions[clip]?.setEffectiveWeight(locomotion[clip] * (1 - actionWeight))
      if (playing?.clip) rigged.actions[playing.clip]?.setEffectiveWeight(actionWeight)
      for (const entry of Object.values(weapons)) {
        if (entry.warm?.drawn()) { entry.warm.finish(); entry.warm = null }
        const warming = entry !== rigged && entry.warm !== null
        entry.warm?.mask(warming)
        entry.holder.visible = entry === rigged || warming
      }
      held += step
      if (!state.poseHold) { rigged.mixer.update(held); held = 0 }

      feel.update(step, worldView, sprintAmount, displayed)

      sights(rigged)
      direction.subVectors(front, rear).normalize()
      aimQuaternion.setFromUnitVectors(direction, minusZ)
      up.applyQuaternion(aimQuaternion)
      roll.setFromAxisAngle(minusZ, -Math.atan2(-up.x, up.y))
      aimQuaternion.premultiply(roll)
      clipQuaternion.copy(aimQuaternion).invert()
      clipRear.copy(rear)
      aimPosition.set(0, 0, -spec.eyeRelief).sub(rear.applyQuaternion(aimQuaternion))

      vector(spec.pivot, pivot)
      hipQuaternion.setFromEuler(euler.set(...spec.hip.rotation))
      hipPosition.copy(pivot).sub(offset.copy(pivot).applyQuaternion(hipQuaternion)).add(vector(spec.hip.position, offset))
      hipRear.copy(clipRear).applyQuaternion(hipQuaternion).add(hipPosition)
      hipDirection.subVectors(front, clipRear).normalize().applyQuaternion(hipQuaternion)
      converge.set(0, 0, -(spec.converge ?? FOUND_CONVERGE)).sub(hipRear).normalize()
      correction.setFromUnitVectors(hipDirection, converge)
      hipQuaternion.premultiply(correction)
      hipPosition.sub(hipRear).applyQuaternion(correction).add(hipRear)
      blendQuaternion.slerpQuaternions(hipQuaternion, aimQuaternion, aim)
      blendPosition.lerpVectors(hipPosition, aimPosition, aim)

      const sprint = rigged.actions.run ? 0 : sprintAmount
      euler.set(
        spec.sprint.rotation[0] * sprint + FOUND_HOLSTER.rotation[0] * holsterAmount + FOUND_INSPECT.rotation[0] * inspectAmount,
        spec.sprint.rotation[1] * sprint + FOUND_HOLSTER.rotation[1] * holsterAmount + FOUND_INSPECT.rotation[1] * inspectAmount,
        spec.sprint.rotation[2] * sprint + FOUND_HOLSTER.rotation[2] * holsterAmount + FOUND_INSPECT.rotation[2] * inspectAmount,
      )
      procedural.setFromEuler(euler)
      pivot.lerp(offset.set(0, -0.02, -spec.eyeRelief - 0.08), aim)
      offset.set(
        spec.sprint.position[0] * sprint + FOUND_HOLSTER.position[0] * holsterAmount + FOUND_INSPECT.position[0] * inspectAmount,
        spec.sprint.position[1] * sprint + FOUND_HOLSTER.position[1] * holsterAmount,
        spec.sprint.position[2] * sprint + FOUND_HOLSTER.position[2] * holsterAmount + FOUND_INSPECT.position[2] * inspectAmount,
      )
      rigged.holder.quaternion.copy(procedural).multiply(blendQuaternion)
      rigged.holder.position.copy(blendPosition).sub(pivot).applyQuaternion(procedural).add(pivot).add(offset)
      applyGunPose(rigged.holder, feel)
      rigged.holder.updateMatrixWorld(true)

      const debug = state.debug
      holderEuler.setFromQuaternion(clipQuaternion.premultiply(rigged.holder.quaternion))
      sightPoint.copy(rigged.rear).applyMatrix4(rigged.bone.matrixWorld)
      debug.holder = [sightPoint.x, sightPoint.y, sightPoint.z, holderEuler.x, holderEuler.y, holderEuler.z]
      holderEuler.setFromQuaternion(clipQuaternion.copy(aimQuaternion).invert())
      debug.clip = [clipRear.x, clipRear.y, clipRear.z, holderEuler.x, holderEuler.y, holderEuler.z]
      const gunPose = feel.gun.pose
      groupEuler.setFromQuaternion(gunPose.group.quaternion)
      debug.feel = [groupEuler.x, groupEuler.y, groupEuler.z, gunPose.pivot.rotation.x, gunPose.pivot.rotation.y, gunPose.pivot.rotation.z, gunPose.pivot.position.x, gunPose.pivot.position.y, gunPose.pivot.position.z]
      debug.animationSeconds = clock
      debug.frames++
      debug.activeAction = playing?.action === 'fire' ? 'fire' : playing?.action === 'reload' ? 'reload' : playing?.action === 'draw' ? 'equip' : null
      debug.action = playing ? playing.action === 'draw' ? 'equip' : playing.action : null
      debug.actionTime = playing?.time ?? 0
      debug.weapon = displayed
      debug.aiming = state.aiming
      debug.aimAmount = aim
      debug.sprintAmount = sprintAmount
      debug.boneCount = rigged.bones
      debug.triangles = rigged.triangles
      debug.handError = 0
      debug.reach = 0
      debug.weaponOffset = [blendPosition.x, blendPosition.y, blendPosition.z]
      debug.recoilOffset = feel.gun.pose.pivot.position.z
      debug.swayRotation = feel.gun.pose.group.quaternion.y * 2
      debug.bobPhase = feel.phase
    },
    sightInView(target = new Vector3()) {
      const rigged = weapons[displayed]
      rigged.holder.updateMatrixWorld(true)
      return target.copy(rigged.rear).applyMatrix4(rigged.bone.matrixWorld)
    },
    seconds(weapon: ArmsWeapon, clip: FoundClip) {
      return foundSeconds(assets[weapon], set.weapons[weapon], clip)
    },
    dispose() {
      for (const entry of Object.values(weapons)) { entry.warm?.finish(); entry.mixer.stopAllAction(); entry.mixer.uncacheRoot(entry.model) }
    },
  }
}

export type FoundRuntime = ReturnType<typeof createFoundRuntime>
