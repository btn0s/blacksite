import { Suspense, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
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
import { RECOIL_TUNING } from '../feel/recoil'
import { aimCandidates, fppInput, padLookDegrees, type AimTarget } from '../input'
import { readActionIntent } from '../intent'
import type { CharacterHandle as Controller } from './state'

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
  queries: WeaponQueries
  events?: CharacterEvents
  aimTargets?: () => ReadonlyArray<AimTarget>
  onPresentation?: (presentation: ArmsPresentation | null) => void
  ragdollRef?: RefObject<AlsRagdollHandle | null>
  renderWeapon?: (scene: Object3D) => ReactNode
  snapshotRateHz?: number
  manifestUrl?: string
}

const ASSIST_CONE = 6
const DEG = Math.PI / 180
const noop = () => {}

export function CharacterController({ controller, queries, events, aimTargets, onPresentation, ragdollRef, renderWeapon, snapshotRateHz, manifestUrl }: CharacterControllerProps) {
  const camera = useThree(state => state.camera) as PerspectiveCamera
  const gl = useThree(state => state.gl)
  const three = useThree(state => state.get)
  const hooks = useRef(events)
  hooks.current = events
  const targets = useRef(aimTargets)
  targets.current = aimTargets
  const als = controller.als
  const context = useMemo(() => fppInput(controller.config.bindings), [controller])
  const worldTime = useMemo(createWorldTimeState, [])
  const body = useRef<Group>(null)
  const revision = useSpawnRevision(controller)
  const scratch = useMemo(() => ({
    rotation: new Euler(0, 0, 0, 'YXZ'), quaternion: new Quaternion(), posed: new Euler(0, 0, 0, 'YXZ'), turned: new Euler(0, 0, 0, 'YXZ'), shift: new Vector3(),
    right: new Vector3(), up: new Vector3(0, 1, 0),
    latch: { sprint: false, crouch: false }, mouse: { fire: false }, candidates: [] as AimCandidate[],
    aimed: false, crouched: false, grounded: true, fall: 0, height: controller.eyeConfig.stand, jumpHeld: false, walk: false, settled: false,
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
    return {
      active: command.active,
      jumpSequence: command.jumpSequence,
      ragdollSequence: command.ragdollSequence,
      movementDirection: { x: forward * Math.cos(yaw) - right * Math.sin(yaw), z: forward * Math.sin(yaw) + right * Math.cos(yaw) },
      desiredGait: command.sprint ? 'Sprinting' : scratch.walk ? 'Walking' : 'Running',
      desiredStance: command.crouch ? 'Crouching' : 'Standing',
      desiredRotationMode: 'ViewDirection',
      viewYawAngle: command.yaw,
      viewPitchAngle: command.pitch,
      aiming: command.aim,
      overlayMode: command.overlay,
    }
  }, [als, scratch])
  const controlRotation = useMemo(() => () => ({ yaw: als.command.yaw, pitch: als.command.pitch }), [als])

  useEffect(() => controller.input.mount(), [controller])
  useEffect(() => controller.input.actions.addContext(context), [controller, context])
  useEffect(() => {
    controller.input.setGameplay(true)
    return () => controller.input.setGameplay(false)
  }, [controller])
  useEffect(() => controller.input.actions.subscribe(({ action, device }) => {
    if (action === 'pause') { controller.setPaused(!controller.status().paused); return }
    if (controller.status().paused) return
    if (action === 'reload') controller.reload()
    else if (action === 'swap') controller.cycle()
    else if (action === 'primary' && controller.config.weapons?.[0]) controller.select(controller.config.weapons[0].definition.id)
    else if (action === 'secondary' && controller.config.weapons?.[1]) controller.select(controller.config.weapons[1].definition.id)
    else if (action === 'inspect') controller.inspect()
    else if (action === 'view') controller.cycleView()
    else if (action === 'sprintToggle') scratch.latch.sprint = !scratch.latch.sprint
    else if (action === 'crouchToggle') scratch.latch.crouch = !scratch.latch.crouch
    hooks.current?.onAction?.(action, device)
  }), [controller, scratch])

  useEffect(() => {
    let resume: ReturnType<typeof three>['frameloop'] | null = null
    const apply = () => {
      const state = three()
      if (controller.status().paused && resume === null) { resume = state.frameloop; state.setFrameloop('never') }
      else if (!controller.status().paused && resume !== null) { state.setFrameloop(resume); resume = null }
    }
    apply()
    const unsubscribe = controller.subscribe(apply)
    return () => { unsubscribe(); if (resume !== null) three().setFrameloop(resume) }
  }, [controller, three])

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
      if (!on && controller.status().locked) controller.setPaused(true)
      controller.setStatus({ locked: on })
    }
    const move = (event: PointerEvent) => {
      if (!locked() || controller.status().paused) return
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
    control.pitch = Math.max(-controller.look.pitchLimit, Math.min(controller.look.pitchLimit, control.pitch - down))
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
    const limit = controller.look.pitchLimit
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
    if (touch.lookX || touch.lookY) {
      turn(touch.lookX * controller.look.touch * lookScale, touch.lookY * controller.look.touch * lookScale)
      touch.lookX = touch.lookY = 0
    }
    const stick = hub.value('look')
    const aimHeld = hub.isHeld('aim')
    const pad = controller.input.snapshot().source === 'gamepad'
    if (stick.x || stick.y || (pad && controller.aimAssist && targets.current)) {
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
      control.pitch = Math.max(-limit, Math.min(limit, control.pitch + kept.pitch))
      control.yaw -= kept.yaw
      scratch.offset.pitch = scratch.offset.yaw = 0
    }
    const settled = controller.recoil.step(delta)
    controller.kick.pitch = settled.pitch
    controller.kick.yaw = settled.yaw
    scratch.rotation.set(Math.max(-1.5, Math.min(1.5, control.pitch + settled.pitch)), control.yaw - settled.yaw, 0)

    const intent = readActionIntent(hub.value('move'), held, scratch.latch)
    if (touch.forward || touch.right) {
      const length = Math.max(1, Math.hypot(touch.forward, touch.right))
      intent.forward = touch.forward / length
      intent.right = touch.right / length
    }
    const drive = controller.driver
    const active = controller.active
    const forward = drive ? drive.forward : intent.forward
    const right = drive ? drive.right : intent.right
    const aiming = active && (aimHeld || status.touchAim || !!drive?.aim)
    controller.firing = scratch.mouse.fire || touch.fire || hub.isHeld('fire')
    const firing = active && (controller.firing || !!drive?.fire)
    const jumpHeld = intent.jump || !!drive?.jump
    if ((jumpHeld && !scratch.jumpHeld) || controller.queued.jump) command.jumpSequence++
    scratch.jumpHeld = jumpHeld
    controller.queued.jump = false
    if (drive) drive.jump = false
    command.active = active
    command.forward = active ? forward : 0
    command.right = active ? right : 0
    command.crouch = active && (intent.crouch || status.touchCrouch)
    command.sprint = active && (intent.sprint || touch.forward > 0.92 || !!drive?.sprint) && forward > 0.3 && !aiming && !firing
    command.aim = aiming && !command.sprint
    scratch.walk = intent.walk || command.aim
    command.yaw = -(scratch.rotation.y + Math.PI / 2) / DEG
    command.pitch = scratch.rotation.x / DEG
    const character = als.pose.current.character
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
      const drive = controller.driver
      const firing = active && (controller.firing || !!drive?.fire)
      scratch.accumulated = Math.min(scratch.accumulated + step, 0.1)
      let reloading = active && controller.queued.reload
      controller.queued.reload = false
      while (scratch.accumulated >= runtime.fixedDeltaSeconds) {
        scratch.accumulated -= runtime.fixedDeltaSeconds
        const stance = { aiming: arms.aiming, moving: Math.min(1, speed / 3.75), crouched }
        const out = runtime.step({ tick: runtime.snapshot().nextTick, trigger: firing && !sprinting && controller.clock >= scratch.fireReadyAt, reload: reloading, selectWeaponId: controller.selected, aim, muzzle: controller.muzzle, stance }, queries)
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
          onSizeChange={noop} onOverlayModeBridgeChange={noop} inputEnabled={false} ragdollInputEnabled={false} inputSource={inputSource}
          ragdollRef={ragdollRef} teleportRef={controller.teleporter} gaitSpeedOverrides={controller.config.gaits} renderOverlayObject={renderWeapon}
          onSnapshot={events?.onSnapshot} snapshotRateHz={snapshotRateHz} gamepadEnabled={false} toggleRotationModeKey={null} showDebugControls={false} exposeDebugGlobals={false} />
      </Suspense>
    </group>
    <AlsCamera poseSample={als.pose} worldTime={worldTime} footstepAudioRuntime={sink} toggleViewModeKey={null} gamepadEnabled={false} controlRotationSource={controlRotation} nearClipPlane={null} />
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
