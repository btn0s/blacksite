import { Suspense, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { Euler, Group, Mesh, Quaternion, Vector3, type Object3D, type PerspectiveCamera } from 'three'
import type { WeaponEvent, WeaponQueries } from '@blacksite/armory'
import { createAimAssist, type AimCandidate, type InputDevice } from '@blacksite/input'
import { Character, type CharacterProps } from 'als-ue5-r3f/app/Character'
import { AlsCamera } from 'als-ue5-r3f/app/AlsCamera'
import type { AlsRagdollHandle } from 'als-ue5-r3f/app/AlsRemoteActor'
import type { AlsCharacterCodeInput } from 'als-ue5-r3f/als/AlsCharacter.hooks'
import type { AlsCharacterSnapshot } from 'als-ue5-r3f/als/AlsCharacterSnapshot'
import { createWorldTimeState } from 'als-ue5-r3f/engine/timeDilation'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { ArmsViewmodel, portraitFov, type ArmsPresentation } from '../ArmsViewmodel'
import type { ArmsWeapon } from '../arms/state'
import { WorldWeapon } from '../found/WorldWeapon'
import { RECOIL_TUNING } from '../feel/recoil'
import { aimCandidates, characterInput, padLookDegrees, type AimTarget } from '../input'
import { readActionIntent } from '../intent'
import { ROLL_TAP_SECONDS, WALK_STICK, type CharacterHandle as Controller } from './state'
import { createCharacterWorld } from './world'

export const BODY_LAYER = 3

export type AlsFootstepSoundRequest = Parameters<CharacterProps['footstepSoundSink']['PlayFootstepSound']>[0]

export type CharacterEvents = {
  onWeapon?: (event: WeaponEvent) => void
  onFootstep?: (request: Readonly<AlsFootstepSoundRequest>) => void
  onLand?: (speed: number) => void
  onJump?: () => void
  onAction?: (action: string, device: InputDevice) => void
  onSnapshot?: (snapshot: AlsCharacterSnapshot) => void
}

export type CharacterControllerProps = {
  controller: Controller
  queries?: WeaponQueries
  events?: CharacterEvents
  aimTargets?: () => ReadonlyArray<AimTarget>
  onPresentation?: (presentation: ArmsPresentation | null) => void
  ragdollRef?: RefObject<AlsRagdollHandle | null>
  renderWeapon?: (scene: Object3D) => ReactNode
  snapshotRateHz?: number
  manifestUrl?: string
}

const ASSIST_CONE = 6
const TOUCH_SPRINT = 0.92
const DEG = Math.PI / 180
const noop = () => {}
const NO_HITS: WeaponQueries = { castRay: () => null, sweepSphere: () => null }

export function CharacterController({ controller, queries, events, aimTargets, onPresentation, ragdollRef, renderWeapon, snapshotRateHz, manifestUrl }: CharacterControllerProps) {
  const camera = useThree(state => state.camera) as PerspectiveCamera
  const gl = useThree(state => state.gl)
  const hooks = useRef(events)
  hooks.current = events
  const targets = useRef(aimTargets)
  targets.current = aimTargets
  const als = controller.als
  const context = useMemo(() => characterInput({ armed: controller.armed, views: controller.config.views }, controller.config.bindings), [controller])
  const physics = useRapier()
  const worldTime = useMemo(createWorldTimeState, [])
  const body = useRef<Group>(null)
  const revision = useSpawnRevision(controller)
  const scratch = useMemo(() => ({
    rotation: new Euler(0, 0, 0, 'YXZ'), quaternion: new Quaternion(), posed: new Euler(0, 0, 0, 'YXZ'), turned: new Euler(0, 0, 0, 'YXZ'), shift: new Vector3(),
    right: new Vector3(), up: new Vector3(0, 1, 0),
    latch: { sprint: false, crouch: false, walk: false }, mouse: { fire: false }, candidates: [] as AimCandidate[],
    aimed: false, crouched: false, grounded: true, fall: 0, height: controller.eyeConfig.stand, jumpHeld: false, walk: false, settled: false,
    sprintHeld: false, sprintSince: 0, rollSequence: 0, jumpBuffer: 0,
    assist: createAimAssist(controller.aimAssist || undefined),
    offset: { pitch: 0, yaw: 0 }, fireReadyAt: 0, accumulated: 0,
  }), [controller])
  const held = useMemo(() => (action: string) => controller.input.actions.isHeld(action), [controller])
  const sink = useMemo(() => ({
    PlayFootstepSound(request: Readonly<AlsFootstepSoundRequest>) { hooks.current?.onFootstep?.(request) },
    SetListenerTransform: noop,
  }), [])
  const inputSource = useMemo(() => (): AlsCharacterCodeInput => {
    const command = als.command
    const yaw = command.yaw * DEG
    const forward = command.active ? command.forward : 0
    const right = command.active ? command.right : 0
    const tilt = Math.hypot(forward, right)
    return {
      active: command.active,
      jumpSequence: command.jumpSequence,
      coyoteSeconds: controller.jumpConfig.coyoteSeconds,
      rollSequence: scratch.rollSequence,
      ragdollSequence: command.ragdollSequence,
      movementDirection: { x: forward * Math.cos(yaw) - right * Math.sin(yaw), z: forward * Math.sin(yaw) + right * Math.cos(yaw) },
      desiredGait: scratch.walk || (tilt > 0 && tilt < WALK_STICK) ? 'Walking' : command.sprint ? 'Sprinting' : 'Running',
      desiredStance: command.crouch ? 'Crouching' : 'Standing',
      desiredRotationMode: controller.armed ? 'ViewDirection' : 'VelocityDirection',
      viewYawAngle: command.yaw,
      viewPitchAngle: command.pitch,
      aiming: command.aim,
      overlayMode: command.overlay,
    }
  }, [als, controller, scratch])
  const bodyLod = useMemo(() => () => ({ visible: camera.layers.isEnabled(BODY_LAYER), shadow: true }), [camera])
  const controlRotation = useMemo(() => () => ({ yaw: als.command.yaw, pitch: als.command.pitch }), [als])
  const rightShoulder = useMemo(() => () => controller.rightShoulder, [controller])

  useEffect(() => controller.input.mount(), [controller])
  useEffect(() => controller.input.actions.addContext(context), [controller, context])
  useEffect(() => {
    controller.input.setGameplay(true)
    return () => controller.input.setGameplay(false)
  }, [controller])
  useEffect(() => {
    controller.world.current = createCharacterWorld(physics, () => als.pose.current.ownerRigidBody)
    return () => { controller.world.current = null }
  }, [controller, physics, als])

  useEffect(() => controller.input.actions.subscribe(({ action, device }) => {
    if (controller.status().paused || controller.driver) return
    if ((action === 'roll' || action === 'ragdoll') && device === 'gamepad') controller.input.rumble(140, 0.5, 0.3)
    if (action === 'roll') controller.roll()
    else if (action === 'ragdoll') controller.ragdoll()
    else if (action === 'shoulder') controller.swapShoulder()
    else if (action === 'reload') controller.reload()
    else if (action === 'swap') controller.cycle()
    else if (action === 'primary' && controller.config.weapons?.[0]) controller.select(controller.config.weapons[0].definition.id)
    else if (action === 'secondary' && controller.config.weapons?.[1]) controller.select(controller.config.weapons[1].definition.id)
    else if (action === 'inspect') controller.inspect()
    else if (action === 'view') controller.cycleView()
    else if (action === 'sprintToggle') scratch.latch.sprint = !scratch.latch.sprint
    else if (action === 'crouchToggle') scratch.latch.crouch = !scratch.latch.crouch
    else if (action === 'walkToggle') scratch.latch.walk = !scratch.latch.walk
    hooks.current?.onAction?.(action, device)
  }), [controller, scratch])

  useEffect(() => {
    const canvas = gl.domElement
    const doc = canvas.ownerDocument
    const locked = () => doc.pointerLockElement === canvas
    const request = () => { Promise.resolve(canvas.requestPointerLock()).catch(noop) }
    controller.pointer.current = request
    const lock = (event: MouseEvent) => {
      if ((event as PointerEvent).pointerType === 'touch' || controller.status().paused) return
      request()
    }
    const lockChange = () => {
      const on = locked()
      if (!on) scratch.mouse.fire = false
      controller.setStatus({ locked: on })
    }
    const move = (event: PointerEvent) => {
      if (!locked() || controller.status().paused || controller.driver) return
      const scale = controller.look.mouse * controller.sensitivity * controller.feel.lookScale
      turn(event.movementX * scale, event.movementY * scale)
    }
    const fire = (event: MouseEvent) => { if (event.button === 0 && locked()) scratch.mouse.fire = true }
    const stopFire = (event: MouseEvent) => { if (event.button === 0) scratch.mouse.fire = false }
    const wheel = (event: WheelEvent) => { if (locked() && Math.abs(event.deltaY) > 4) controller.cycle() }
    const menu = (event: MouseEvent) => event.preventDefault()
    canvas.addEventListener('click', lock)
    canvas.addEventListener('mousedown', fire)
    canvas.addEventListener('contextmenu', menu)
    doc.addEventListener('mouseup', stopFire)
    doc.addEventListener('pointerlockchange', lockChange)
    doc.addEventListener('pointermove', move)
    doc.addEventListener('wheel', wheel, { passive: true })
    return () => {
      controller.pointer.current = null
      canvas.removeEventListener('click', lock); canvas.removeEventListener('mousedown', fire); canvas.removeEventListener('contextmenu', menu)
      doc.removeEventListener('mouseup', stopFire); doc.removeEventListener('pointerlockchange', lockChange); doc.removeEventListener('pointermove', move); doc.removeEventListener('wheel', wheel)
    }
  }, [gl, controller, scratch])

  const turn = (yaw: number, down: number) => {
    const control = controller.control
    control.yaw -= yaw
    control.pitch = Math.max(controller.look.pitchMin, Math.min(controller.look.pitchMax, control.pitch - down))
    controller.sway.yaw -= yaw
    controller.sway.pitch -= down
  }

  const handle = (event: WeaponEvent) => {
    const arms = controller.arms
    if (event.type === 'switch-started') {
      arms.weapon = event.weaponId as ArmsWeapon
      const weapon = controller.weaponOf(event.weaponId)
      if (weapon) { arms.aimSeconds = weapon.adsSeconds; als.command.overlay = weapon.overlay }
      arms.equipSequence++
    } else if (event.type === 'reload-started') arms.reloadSequence++
    else if (event.type === 'trigger-blocked' && event.reason === 'empty') controller.queued.reload = true
    else if (event.type === 'shot') {
      arms.fireSequence++
      const kick = arms.aiming ? controller.aimKick : 1
      scratch.offset.pitch += event.recoil.pitch * kick
      scratch.offset.yaw += event.recoil.yaw * kick
      controller.feel.shot(arms.debug.aimAmount)
      const rumble = controller.weaponOf(event.weaponId)?.rumble
      if (rumble && controller.input.snapshot().source === 'gamepad') controller.input.rumble(rumble.ms, rumble.strong, rumble.weak, { left: 0, right: rumble.trigger })
    }
    hooks.current?.onWeapon?.(event)
  }

  useFrame((_, delta) => {
    const command = als.command
    const status = controller.status()
    if (status.paused) { command.active = false; return }
    const control = controller.control
    const touch = controller.touch
    const hub = controller.input.actions
    const look = controller.look
    const drive = controller.driver
    if (control.reset) {
      scratch.fireReadyAt = scratch.accumulated = 0
      controller.kick.pitch = controller.kick.yaw = 0
      scratch.offset.pitch = scratch.offset.yaw = 0
      controller.recoil.reset()
      scratch.assist.reset()
      scratch.settled = false
      control.reset = false
    }
    const lookScale = controller.sensitivity * controller.feel.lookScale
    if (!drive && (touch.lookX || touch.lookY)) {
      turn(touch.lookX * controller.look.touch * lookScale, touch.lookY * controller.look.touch * lookScale)
      touch.lookX = touch.lookY = 0
    }
    const stick = hub.value('look')
    const aimHeld = drive ? drive.aim : hub.isHeld('aim')
    const pad = !drive && controller.input.snapshot().source === 'gamepad'
    if (pad && (stick.x || stick.y || (controller.aimAssist && targets.current))) {
      const shaped = padLookDegrees(stick.x, stick.y, controller.padLook, delta)
      let yaw = shaped.yaw * lookScale, pitch = shaped.pitch * lookScale
      const source = targets.current
      if (pad && controller.aimAssist && source) {
        const candidates = aimCandidates(source(), controller.eye, scratch.rotation.y, scratch.rotation.x, ASSIST_CONE, scratch.candidates)
        const assisted = scratch.assist.modify({ yawDelta: yaw, pitchDelta: pitch, stickMagnitude: shaped.magnitude, aiming: aimHeld, aimPressed: aimHeld && !scratch.aimed, dt: delta }, candidates)
        yaw = assisted.yawDelta
        pitch = assisted.pitchDelta
      }
      if (yaw || pitch) turn(yaw * DEG, -pitch * DEG)
    }
    scratch.aimed = aimHeld
    if (scratch.offset.pitch || scratch.offset.yaw) {
      const kept = controller.recoil.shot(scratch.offset.pitch, scratch.offset.yaw, RECOIL_TUNING[controller.arms.weapon])
      control.pitch = Math.max(look.pitchMin, Math.min(look.pitchMax, control.pitch + kept.pitch))
      control.yaw -= kept.yaw
      scratch.offset.pitch = scratch.offset.yaw = 0
    }
    const settled = controller.recoil.step(delta)
    controller.kick.pitch = settled.pitch
    controller.kick.yaw = settled.yaw
    scratch.rotation.set(Math.max(-1.5, Math.min(1.5, control.pitch + settled.pitch)), control.yaw - settled.yaw, 0)

    const intent = drive
      ? { forward: drive.forward, right: drive.right, jump: drive.jump, sprint: drive.sprint, crouch: !!drive.crouch, walk: !!drive.walk, aim: drive.aim }
      : readActionIntent(hub.value('move'), held, scratch.latch)
    if (!drive && (touch.forward || touch.right)) {
      const length = Math.max(1, Math.hypot(touch.forward, touch.right))
      intent.forward = touch.forward / length
      intent.right = touch.right / length
    }
    const active = controller.active
    const aiming = active && (aimHeld || (!drive && status.touchAim))
    controller.firing = drive ? drive.fire : scratch.mouse.fire || touch.fire || hub.isHeld('fire')
    const firing = active && controller.firing
    const character = als.pose.current.character
    const clock = controller.clock
    const sprintHeld = !drive && hub.isHeld('sprint')
    if (sprintHeld && !scratch.sprintHeld) scratch.sprintSince = clock
    if (!sprintHeld && scratch.sprintHeld && clock - scratch.sprintSince < ROLL_TAP_SECONDS) controller.queued.roll = true
    scratch.sprintHeld = sprintHeld
    if (controller.queued.roll && active) scratch.rollSequence++
    controller.queued.roll = false
    const jumpPressed = (intent.jump && !scratch.jumpHeld) || controller.queued.jump
    if (jumpPressed && active) {
      command.jumpSequence++
      if (character?.locomotionMode === 'InAir') scratch.jumpBuffer = clock + controller.jumpConfig.bufferSeconds
    }
    if (scratch.jumpBuffer > clock && character?.locomotionMode === 'Grounded' && !character.locomotionAction) {
      scratch.jumpBuffer = 0
      command.jumpSequence++
    }
    scratch.jumpHeld = intent.jump
    controller.queued.jump = false
    if (drive) drive.jump = false
    command.active = active
    command.forward = active ? intent.forward : 0
    command.right = active ? intent.right : 0
    command.crouch = active && (intent.crouch || (!drive && status.touchCrouch))
    command.sprint = active && (intent.sprint || (!drive && Math.hypot(touch.forward, touch.right) > TOUCH_SPRINT)) && !firing
    command.aim = aiming
    scratch.walk = intent.walk || command.aim
    command.yaw = -(scratch.rotation.y + Math.PI / 2) / DEG
    command.pitch = scratch.rotation.x / DEG
    const mode = status.view === 'shoulder' ? 'ThirdPerson' : 'FirstPerson'
    if (character && character.viewMode !== mode) character.viewMode = mode
  }, ALS_FRAME_PRIORITY.ControlRotation - 0.2)

  useFrame((_, delta) => {
    const status = controller.status()
    const sample = als.pose.current
    const character = sample.character
    const group = body.current
    if (group) {
      const visible = status.view !== 'arms'
      group.traverse(object => {
        if (!(object instanceof Mesh)) return
        if (object.layers.mask !== 1 << BODY_LAYER) object.layers.set(BODY_LAYER)
        object.castShadow = true
      })
      if (visible) camera.layers.enable(BODY_LAYER)
      else camera.layers.disable(BODY_LAYER)
    }
    if (status.paused || !sample.ready || !character) return
    const step = Math.min(delta, 0.1)
    const arms = controller.arms
    const control = controller.control
    controller.clock += step
    const v = character.movement.velocity
    controller.velocity.set(v.x, v.z, v.y)
    controller.position.copy(sample.ground)
    const grounded = character.locomotionMode === 'Grounded'
    const crouched = character.stance === 'Crouching'
    const sprinting = character.gait === 'Sprinting' && controller.velocity.lengthSq() > 1
    const speed = Math.hypot(controller.velocity.x, controller.velocity.z)
    controller.grounded = grounded
    controller.crouching = crouched
    controller.sprinting = sprinting
    controller.speed = speed
    if (!grounded) scratch.fall = Math.min(scratch.fall, controller.velocity.y)
    if (scratch.settled && grounded && !scratch.grounded) {
      const landed = -scratch.fall
      hooks.current?.onLand?.(landed)
      controller.feel.land(landed)
      arms.landSpeed = landed
      arms.landSequence++
    }
    if (scratch.settled && !grounded && scratch.grounded && controller.velocity.y > 1) { hooks.current?.onJump?.(); controller.feel.jump() }
    if (grounded) scratch.fall = 0
    scratch.grounded = grounded
    if (crouched !== scratch.crouched) { scratch.crouched = crouched; controller.feel.crouch(crouched) }
    const eyeHeight = crouched ? controller.eyeConfig.crouch : controller.eyeConfig.stand
    scratch.height = scratch.settled ? scratch.height + (eyeHeight - scratch.height) * (1 - Math.exp(-controller.eyeConfig.smoothing * step)) : eyeHeight
    scratch.settled = true
    const eye = controller.eye.copy(sample.ground)
    eye.y += scratch.height - controller.eyeDrop

    const active = controller.active
    arms.speed = speed
    arms.sprinting = sprinting
    arms.aiming = als.command.aim
    const sinYaw = Math.sin(control.yaw), cosYaw = Math.cos(control.yaw)
    const ahead = -sinYaw * controller.velocity.x - cosYaw * controller.velocity.z
    const lateral = cosYaw * controller.velocity.x - sinYaw * controller.velocity.z
    const weapon = controller.weaponOf(arms.weapon)
    controller.feel.step({ speed, lateral, grounded, sprinting, aim: arms.debug.aimAmount }, controller.fov, weapon?.adsFov ?? controller.fov, step, arms.kick)
    arms.motion = { forward: ahead, lateral, grounded, crouching: crouched, look: controller.sway, walk: controller.feel.phase, bob: controller.feel.bob }

    const aim = controller.aim
    if (status.view === 'arms') {
      scratch.quaternion.setFromEuler(scratch.rotation)
      aim.origin.copy(eye)
      aim.direction.set(0, 0, -1).applyQuaternion(scratch.quaternion)
      controller.muzzle.copy(eye)
      camera.position.copy(eye)
      if (!controller.override) {
        const pose = controller.feel.pose
        scratch.posed.set(Math.max(-1.55, Math.min(1.55, scratch.rotation.x + pose.pitch)), scratch.rotation.y + pose.yaw, pose.roll)
        camera.quaternion.setFromEuler(scratch.posed)
        scratch.shift.set(pose.x, pose.y, pose.z).applyEuler(scratch.turned.set(0, scratch.rotation.y, 0))
        camera.position.add(scratch.shift)
        const fov = portraitFov(controller.feel.fov, camera.aspect)
        if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix() }
      } else camera.quaternion.copy(scratch.quaternion)
    } else {
      camera.getWorldPosition(aim.origin)
      camera.getWorldDirection(aim.direction)
      scratch.right.set(1, 0, 0).applyQuaternion(camera.quaternion)
      controller.muzzle.copy(eye).addScaledVector(aim.direction, 0.1).addScaledVector(scratch.right, arms.aiming ? 0.025 : 0.1).addScaledVector(scratch.up, -0.12)
      if (status.view === 'head' && sample.headBone) sample.headBone.scale.setScalar(0.001)
    }

    const runtime = controller.weapon
    if (runtime) {
      if (sprinting) scratch.fireReadyAt = controller.clock + controller.sprintOutSeconds
      const firing = active && controller.firing
      scratch.accumulated = Math.min(scratch.accumulated + step, 0.1)
      let reloading = active && controller.queued.reload
      controller.queued.reload = false
      const hits = queries ?? controller.world.current ?? NO_HITS
      while (scratch.accumulated >= runtime.fixedDeltaSeconds) {
        scratch.accumulated -= runtime.fixedDeltaSeconds
        const stance = { aiming: arms.aiming, moving: Math.min(1, speed / 3.75), crouched }
        const out = runtime.step({ tick: runtime.snapshot().nextTick, trigger: firing && !sprinting && controller.clock >= scratch.fireReadyAt, reload: reloading, selectWeaponId: controller.selected, aim, muzzle: controller.muzzle, stance }, hits)
        reloading = false
        for (const event of out) handle(event)
      }
      if (reloading) controller.queued.reload = true
      const snapshot = runtime.snapshot()
      arms.empty = (snapshot.weapons.find(entry => entry.id === snapshot.equippedWeaponId)?.magazine ?? 1) <= 0
    }
  }, ALS_FRAME_PRIORITY.Camera + 0.02)

  const views = controller.config.views
  return <>
    <group ref={body}>
      <Suspense fallback={null}>
        <Character key={revision} initialPosition={als.spawn} poseSample={als.pose} worldTime={worldTime} footstepSoundSink={sink}
          onSizeChange={noop} onOverlayModeBridgeChange={noop} inputEnabled={false} inputSource={inputSource} terrainFootLock
          ragdollRef={ragdollRef} teleportRef={controller.teleporter} gaitSpeedOverrides={controller.config.gaits} animationLod={bodyLod} renderOverlayObject={renderWeapon ?? (controller.armed ? scene => <Suspense fallback={null}><WorldWeapon characterScene={scene} weapon={() => controller.arms.weapon} /></Suspense> : undefined)}
          onSnapshot={events?.onSnapshot} snapshotRateHz={snapshotRateHz} gamepadEnabled={false} toggleRotationModeKey={null} showDebugControls={false} exposeDebugGlobals={false} />
      </Suspense>
    </group>
    <AlsCamera poseSample={als.pose} worldTime={worldTime} footstepAudioRuntime={sink} toggleViewModeKey={null} gamepadEnabled={false} controlRotationSource={controlRotation} rightShoulder={rightShoulder} shoulderOffset={controller.shoulderOffset} aspectRatioAxisConstraint="MajorAxisFOV" nearClipPlane={null} />
    {views.includes('arms') && <ArmsView controller={controller} onPresentation={onPresentation} manifestUrl={manifestUrl} />}
  </>
}

function ArmsView({ controller, onPresentation, manifestUrl }: { controller: Controller; onPresentation?: (presentation: ArmsPresentation | null) => void; manifestUrl?: string }) {
  const view = useView(controller)
  return <ArmsViewmodel state={controller.arms} visible={view === 'arms'} render="external" rig="found" manifestUrl={manifestUrl} onPresentation={onPresentation} />
}

function useView(controller: Controller) {
  return useSyncExternalStore(controller.subscribe, () => controller.status().view)
}

function useSpawnRevision(controller: Controller) {
  return useSyncExternalStore(controller.als.subscribe, controller.als.getRevision)
}
