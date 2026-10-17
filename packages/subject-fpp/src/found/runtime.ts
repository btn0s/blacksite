import { AnimationAction, AnimationClip, AnimationMixer, AnimationUtils, Bone, Euler, Group, LoopOnce, LoopRepeat, Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import type { ArmsState, ArmsWeapon } from '../arms/state'
import { VIEWMODEL, VIEWMODEL_WEAPONS, bobFrequency } from '../viewmodel/model'
import { approach, createSpring3, kickSpring3, smoothstep, stepSpring3 } from '../viewmodel/spring'
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
}

const LOCOMOTION = ['idle', 'walk', 'run'] as const
const vector = (value: Vec3, target = new Vector3()) => target.set(value[0], value[1], value[2])

function resolveClip(asset: FoundAsset, source: FoundClipSource, fps: number, name: string) {
  const clipName = typeof source === 'string' ? source : source.clip
  const clip = asset.animations.find(entry => entry.name === clipName)
  if (!clip) throw new Error(`Found viewmodel clip ${clipName} is missing`)
  if (typeof source === 'string') return clip
  return AnimationUtils.subclip(clip, name, source.from, source.to, fps)
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
    const action = mixer.clipAction(resolveClip(asset, source, spec.fps, `${name}:${clip}`))
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
  return { spec, holder, model, mixer, actions, bone, rear, front, up: upDirection.normalize(), bones, triangles }
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

  const sway = { rotation: createSpring3(), position: createSpring3() }
  const recoil = { position: createSpring3(), rotation: createSpring3() }
  const landing = createSpring3()
  const previousView = new Quaternion()
  const deltaView = new Quaternion()
  const deltaEuler = new Euler(0, 0, 0, 'YXZ')
  let hasView = false
  let displayed: ArmsWeapon = state.weapon
  let pending: ArmsWeapon | null = null
  type Playing = { action: Action; clip: FoundClip | null; time: number; duration: number; weight: number; fading: boolean }
  let playing: Playing | null = null
  let aimLinear = 0
  let sprintAmount = 0
  let moveAmount = 0
  let bobPhase = 0
  let clock = 0
  let shotIndex = 0
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
        const kick = VIEWMODEL_WEAPONS[displayed].recoil
        const aim = smoothstep(aimLinear)
        const scale = rigged.spec.recoil.hip + (rigged.spec.recoil.aim - rigged.spec.recoil.hip) * aim
        const random = (shotIndex * 0.618034) % 1
        const side = ((shotIndex * 0.381966) % 1) * 2 - 1
        shotIndex++
        const omega = Math.sqrt(VIEWMODEL.recoil.stiffness) * Math.E
        const omegaRotation = Math.sqrt(VIEWMODEL.recoil.rotationStiffness) * Math.E
        kickSpring3(recoil.position, [side * 0.002 * omega * scale, kick.rise * omega * scale, kick.back * omega * scale])
        kickSpring3(recoil.rotation, [kick.pitch * omegaRotation * scale, side * kick.yaw * omegaRotation * scale, (random * 2 - 1) * kick.roll * omegaRotation * scale])
      }
      if (state.landSequence !== previous.land) {
        const dip = Math.min(VIEWMODEL.landing.maxDip, Math.abs(state.landSpeed ?? 0) * VIEWMODEL.landing.dipPerMetrePerSecond)
        kickSpring3(landing, [0, -dip * Math.sqrt(VIEWMODEL.landing.stiffness) * Math.E, 0])
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
      aimLinear = Math.min(1, Math.max(0, aimLinear + (state.aiming && !busy ? 1 : -1) * step / spec.aimSeconds))
      const aim = smoothstep(aimLinear)
      sprintAmount = approach(sprintAmount, state.sprinting && !state.aiming ? 1 : 0, VIEWMODEL.sprintRate, step)
      const moving = state.speed > VIEWMODEL.moveThreshold
      moveAmount = approach(moveAmount, moving ? Math.min(1.6, state.speed / VIEWMODEL.bob.walkSpeed) : 0, VIEWMODEL.bob.blendRate, step)
      bobPhase += Math.PI * bobFrequency(Math.max(state.speed, 0.5), state.sprinting) * step * (moving ? 1 : 0)

      const run = rigged.actions.run ? sprintAmount : 0
      const walk = rigged.actions.walk ? Math.min(1, moveAmount) * (1 - run) * (1 - aim) : 0
      locomotion.run = run
      locomotion.walk = walk
      locomotion.idle = 1 - run - walk
      const actionWeight = playing?.clip ? playing.weight : 0
      for (const clip of LOCOMOTION) rigged.actions[clip]?.setEffectiveWeight(locomotion[clip] * (1 - actionWeight))
      if (playing?.clip) rigged.actions[playing.clip]?.setEffectiveWeight(actionWeight)
      for (const entry of Object.values(weapons)) entry.holder.visible = entry === rigged
      held += step
      if (!state.poseHold) { rigged.mixer.update(held); held = 0 }

      if (worldView) {
        if (hasView && step > 0) {
          deltaView.copy(previousView).invert().multiply(worldView)
          deltaEuler.setFromQuaternion(deltaView)
          const scale = VIEWMODEL.sway.perRadianPerSecond * (1 - aim * 0.7)
          const max = VIEWMODEL.sway.maxRotation
          const target: Vec3 = [
            Math.max(-max, Math.min(max, -deltaEuler.x / step * scale)),
            Math.max(-max, Math.min(max, -deltaEuler.y / step * scale)),
            Math.max(-max, Math.min(max, -deltaEuler.y / step * scale * 0.6)),
          ]
          stepSpring3(sway.rotation, target, VIEWMODEL.sway.stiffness, VIEWMODEL.sway.damping, step)
          stepSpring3(sway.position, [-target[1] * VIEWMODEL.sway.positionPerRadian, target[0] * VIEWMODEL.sway.positionPerRadian, 0], VIEWMODEL.sway.stiffness, VIEWMODEL.sway.damping, step)
        }
        previousView.copy(worldView)
        hasView = true
      } else {
        stepSpring3(sway.rotation, null, VIEWMODEL.sway.stiffness, VIEWMODEL.sway.damping, step)
        stepSpring3(sway.position, null, VIEWMODEL.sway.stiffness, VIEWMODEL.sway.damping, step)
      }
      stepSpring3(recoil.position, null, VIEWMODEL.recoil.stiffness, VIEWMODEL.recoil.damping, step)
      stepSpring3(recoil.rotation, null, VIEWMODEL.recoil.rotationStiffness, VIEWMODEL.recoil.rotationDamping, step)
      stepSpring3(landing, null, VIEWMODEL.landing.stiffness, VIEWMODEL.landing.damping, step)

      sights(rigged)
      direction.subVectors(front, rear).normalize()
      aimQuaternion.setFromUnitVectors(direction, minusZ)
      up.applyQuaternion(aimQuaternion)
      roll.setFromAxisAngle(minusZ, -Math.atan2(-up.x, up.y))
      aimQuaternion.premultiply(roll)
      aimPosition.set(0, 0, -spec.eyeRelief).sub(rear.applyQuaternion(aimQuaternion))

      vector(spec.pivot, pivot)
      hipQuaternion.setFromEuler(euler.set(...spec.hip.rotation))
      hipPosition.copy(pivot).sub(offset.copy(pivot).applyQuaternion(hipQuaternion)).add(vector(spec.hip.position, offset))
      blendQuaternion.slerpQuaternions(hipQuaternion, aimQuaternion, aim)
      blendPosition.lerpVectors(hipPosition, aimPosition, aim)

      const bob = VIEWMODEL.bob
      const bobScale = moveAmount * (rigged.actions.walk ? aim * bob.aimScale : 1 - aim * (1 - bob.aimScale))
      const breath = Math.sin(clock * Math.PI * 2 * VIEWMODEL.idle.breathHz) * aim * VIEWMODEL.idle.aimScale
      const sprint = rigged.actions.run ? 0 : sprintAmount
      euler.set(
        spec.sprint.rotation[0] * sprint + FOUND_HOLSTER.rotation[0] * holsterAmount + FOUND_INSPECT.rotation[0] * inspectAmount + Math.sin(bobPhase * 2) * bob.pitch * bobScale + breath * VIEWMODEL.idle.pitch + sway.rotation.value[0] + recoil.rotation.value[0],
        spec.sprint.rotation[1] * sprint + FOUND_HOLSTER.rotation[1] * holsterAmount + FOUND_INSPECT.rotation[1] * inspectAmount + sway.rotation.value[1] + recoil.rotation.value[1],
        spec.sprint.rotation[2] * sprint + FOUND_HOLSTER.rotation[2] * holsterAmount + FOUND_INSPECT.rotation[2] * inspectAmount + Math.sin(bobPhase) * bob.roll * bobScale + sway.rotation.value[2] + recoil.rotation.value[2],
      )
      procedural.setFromEuler(euler)
      pivot.lerp(offset.set(0, -0.02, -spec.eyeRelief - 0.08), aim)
      offset.set(
        spec.sprint.position[0] * sprint + FOUND_HOLSTER.position[0] * holsterAmount + FOUND_INSPECT.position[0] * inspectAmount + Math.sin(bobPhase) * bob.lateral * bobScale + sway.position.value[0] + recoil.position.value[0],
        spec.sprint.position[1] * sprint + FOUND_HOLSTER.position[1] * holsterAmount - (Math.sin(bobPhase) ** 2) * bob.vertical * bobScale + breath * VIEWMODEL.idle.vertical + sway.position.value[1] + recoil.position.value[1] + landing.value[1],
        spec.sprint.position[2] * sprint + FOUND_HOLSTER.position[2] * holsterAmount + FOUND_INSPECT.position[2] * inspectAmount + recoil.position.value[2],
      )
      rigged.holder.quaternion.copy(procedural).multiply(blendQuaternion)
      rigged.holder.position.copy(blendPosition).sub(pivot).applyQuaternion(procedural).add(pivot).add(offset)
      rigged.holder.updateMatrixWorld(true)

      const debug = state.debug
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
      debug.recoilOffset = recoil.position.value[2]
      debug.swayRotation = sway.rotation.value[1]
      debug.bobPhase = bobPhase
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
      for (const entry of Object.values(weapons)) { entry.mixer.stopAllAction(); entry.mixer.uncacheRoot(entry.model) }
    },
  }
}

export type FoundRuntime = ReturnType<typeof createFoundRuntime>
