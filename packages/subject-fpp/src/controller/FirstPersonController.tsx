import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Euler, Quaternion, Vector3, type PerspectiveCamera } from 'three'
import type { WeaponEvent, WeaponQueries } from '@blacksite/armory'
import { createAimAssist, type AimCandidate, type InputDevice } from '@blacksite/input'
import { ArmsViewmodel, portraitFov, type ArmsPresentation } from '../ArmsViewmodel'
import type { ArmsWeapon } from '../arms/state'
import { RECOIL_TUNING } from '../feel/recoil'
import { aimCandidates, fppInput, padLookDegrees, type AimTarget } from '../input'
import { readActionIntent } from '../intent'
import { eyePosition, stepBody } from './body'
import type { Collision } from './collision'
import type { FirstPerson } from './player'

export type FirstPersonEvents = {
  onWeapon?: (event: WeaponEvent) => void
  onStep?: (volume: number) => void
  onLand?: (speed: number) => void
  onJump?: () => void
  onAction?: (action: string, device: InputDevice) => void
}

export type FirstPersonControllerProps = {
  player: FirstPerson
  collision: Collision
  queries: WeaponQueries
  events?: FirstPersonEvents
  aimTargets?: () => ReadonlyArray<AimTarget>
  onPresentation?: (presentation: ArmsPresentation | null) => void
  manifestUrl?: string
}

const ASSIST_CONE = 6
const DEG = Math.PI / 180

export function FirstPersonController({ player, collision, queries, events, aimTargets, onPresentation, manifestUrl }: FirstPersonControllerProps) {
  const camera = useThree(state => state.camera) as PerspectiveCamera
  const gl = useThree(state => state.gl)
  const hooks = useRef(events)
  hooks.current = events
  const targets = useRef(aimTargets)
  targets.current = aimTargets
  const context = useMemo(() => fppInput(player.config.bindings), [player])
  const scratch = useMemo(() => ({
    rotation: new Euler(0, 0, 0, 'YXZ'), quaternion: new Quaternion(), posed: new Euler(0, 0, 0, 'YXZ'), turned: new Euler(0, 0, 0, 'YXZ'), shift: new Vector3(),
    latch: { sprint: false, crouch: false }, mouse: { fire: false }, touch: { aim: false, crouch: false, jump: false }, candidates: [] as AimCandidate[],
    aimed: false, crouched: false, assist: createAimAssist(player.aimAssist || undefined),
    offset: { pitch: 0, yaw: 0 }, fireReadyAt: 0, accumulated: 0,
  }), [player])
  const held = useMemo(() => (action: string) => player.input.actions.isHeld(action), [player])

  useEffect(() => player.input.mount(), [player])
  useEffect(() => player.input.actions.addContext(context), [player, context])
  useEffect(() => {
    player.input.setGameplay(true)
    return () => player.input.setGameplay(false)
  }, [player])
  useEffect(() => player.input.actions.subscribe(({ action, device }) => {
    if (action === 'pause' && device === 'gamepad') { player.pause(!player.status().paused); return }
    if (player.status().paused) return
    if (action === 'reload') player.reload()
    else if (action === 'swap') player.cycle()
    else if (action === 'primary') player.select(player.config.weapons[0]!.definition.id)
    else if (action === 'secondary' && player.config.weapons[1]) player.select(player.config.weapons[1].definition.id)
    else if (action === 'inspect') player.inspect()
    else if (action === 'sprintToggle') scratch.latch.sprint = !scratch.latch.sprint
    else if (action === 'crouchToggle') scratch.latch.crouch = !scratch.latch.crouch
    hooks.current?.onAction?.(action, device)
  }), [player, scratch])

  useEffect(() => {
    const canvas = gl.domElement
    const doc = canvas.ownerDocument
    const locked = () => doc.pointerLockElement === canvas
    const lock = (event: MouseEvent) => {
      if ((event as PointerEvent).pointerType === 'touch' || player.status().paused) return
      Promise.resolve(canvas.requestPointerLock()).catch(() => undefined)
    }
    const lockChange = () => {
      const on = locked()
      if (!on) scratch.mouse.fire = false
      player.setStatus({ locked: on })
    }
    const move = (event: PointerEvent) => {
      if (!locked()) return
      const scale = player.look.mouse * player.sensitivity * player.feel.lookScale
      const yaw = event.movementX * scale
      const pitch = event.movementY * scale
      turn(yaw, pitch)
    }
    const fire = (event: MouseEvent) => { if (event.button === 0 && locked()) scratch.mouse.fire = true }
    const stopFire = (event: MouseEvent) => { if (event.button === 0) scratch.mouse.fire = false }
    const wheel = (event: WheelEvent) => { if (locked() && Math.abs(event.deltaY) > 4) player.cycle() }
    const menu = (event: MouseEvent) => event.preventDefault()
    canvas.addEventListener('click', lock)
    canvas.addEventListener('mousedown', fire)
    canvas.addEventListener('contextmenu', menu)
    doc.addEventListener('mouseup', stopFire)
    doc.addEventListener('pointerlockchange', lockChange)
    doc.addEventListener('pointermove', move)
    doc.addEventListener('wheel', wheel, { passive: true })
    return () => {
      canvas.removeEventListener('click', lock); canvas.removeEventListener('mousedown', fire); canvas.removeEventListener('contextmenu', menu)
      doc.removeEventListener('mouseup', stopFire); doc.removeEventListener('pointerlockchange', lockChange); doc.removeEventListener('pointermove', move); doc.removeEventListener('wheel', wheel)
    }
  }, [gl, player, scratch])

  const turn = (yaw: number, down: number) => {
    const view = player.view
    view.yaw -= yaw
    view.pitch = Math.max(-player.look.pitchLimit, Math.min(player.look.pitchLimit, view.pitch - down))
    player.sway.yaw -= yaw
    player.sway.pitch -= down
  }

  const handle = (event: WeaponEvent) => {
    const arms = player.arms
    if (event.type === 'switch-started') {
      arms.weapon = event.weaponId as ArmsWeapon
      arms.aimSeconds = player.weaponOf(event.weaponId).adsSeconds
      arms.equipSequence++
    } else if (event.type === 'reload-started') arms.reloadSequence++
    else if (event.type === 'trigger-blocked' && event.reason === 'empty') player.queued.reload = true
    else if (event.type === 'shot') {
      arms.fireSequence++
      const kick = arms.aiming ? player.aimKick : 1
      scratch.offset.pitch += event.recoil.pitch * kick
      scratch.offset.yaw += event.recoil.yaw * kick
      player.feel.shot(arms.debug.aimAmount)
      const rumble = player.weaponOf(event.weaponId).rumble
      if (rumble && player.input.snapshot().source === 'gamepad') player.input.rumble(rumble.ms, rumble.strong, rumble.weak, { left: 0, right: rumble.trigger })
    }
    hooks.current?.onWeapon?.(event)
  }

  useFrame((_, delta) => {
    if (player.status().paused) return
    const view = player.view
    const arms = player.arms
    const touch = player.touch
    const hub = player.input.actions
    const limit = player.look.pitchLimit
    const kick = player.kick
    if (view.reset) {
      scratch.fireReadyAt = scratch.accumulated = 0
      kick.pitch = kick.yaw = 0
      scratch.offset.pitch = scratch.offset.yaw = 0
      player.recoil.reset()
      scratch.assist.reset()
      view.reset = false
    }
    const lookScale = player.sensitivity * player.feel.lookScale
    if (touch.lookX || touch.lookY) {
      turn(touch.lookX * player.look.touch * lookScale, touch.lookY * player.look.touch * lookScale)
      touch.lookX = touch.lookY = 0
    }
    const stick = hub.value('look')
    const aimHeld = hub.isHeld('aim')
    const pad = player.input.snapshot().source === 'gamepad'
    if (stick.x || stick.y || (pad && player.aimAssist && targets.current)) {
      const shaped = padLookDegrees(stick.x, stick.y, player.padLook, delta)
      let yaw = shaped.yaw * lookScale, pitch = shaped.pitch * lookScale
      const source = targets.current
      if (pad && player.aimAssist && source) {
        const candidates = aimCandidates(source(), player.eye, scratch.rotation.y, scratch.rotation.x, ASSIST_CONE, scratch.candidates)
        const assisted = scratch.assist.modify({ yawDelta: yaw, pitchDelta: pitch, stickMagnitude: shaped.magnitude, aiming: aimHeld, aimPressed: aimHeld && !scratch.aimed, dt: delta }, candidates)
        yaw = assisted.yawDelta
        pitch = assisted.pitchDelta
      }
      if (yaw || pitch) turn(yaw * DEG, -pitch * DEG)
    }
    scratch.aimed = aimHeld
    if (scratch.offset.pitch || scratch.offset.yaw) {
      const kept = player.recoil.shot(scratch.offset.pitch, scratch.offset.yaw, RECOIL_TUNING[arms.weapon])
      view.pitch = Math.max(-limit, Math.min(limit, view.pitch + kept.pitch))
      view.yaw -= kept.yaw
      scratch.offset.pitch = scratch.offset.yaw = 0
    }
    const settled = player.recoil.step(delta)
    kick.pitch = settled.pitch
    kick.yaw = settled.yaw
    scratch.rotation.set(Math.max(-1.5, Math.min(1.5, view.pitch + kick.pitch)), view.yaw - kick.yaw, 0)
    scratch.quaternion.setFromEuler(scratch.rotation)
    camera.quaternion.copy(scratch.quaternion)
    player.aim.direction.set(0, 0, -1).applyQuaternion(scratch.quaternion)

    const step = Math.min(delta, 0.1)
    player.clock += step
    const intent = readActionIntent(hub.value('move'), held, scratch.latch)
    if (touch.forward || touch.right) {
      const length = Math.max(1, Math.hypot(touch.forward, touch.right))
      intent.forward = touch.forward / length
      intent.right = touch.right / length
    }
    const drive = player.driver
    const status = player.status()
    const active = player.active
    const forward = drive ? drive.forward : intent.forward
    const right = drive ? drive.right : intent.right
    const crouch = intent.crouch || status.touchCrouch
    const sprint = intent.sprint || touch.forward > 0.92 || !!drive?.sprint
    const jump = intent.jump || player.queued.jump || !!drive?.jump
    player.queued.jump = false
    if (drive) drive.jump = false
    player.firing = scratch.mouse.fire || touch.fire || hub.isHeld('fire')
    const firing = active && (player.firing || !!drive?.fire)
    if (player.sprinting) scratch.fireReadyAt = player.clock + player.move.sprintOutSeconds
    const stepped = stepBody(player.body, {
      forward: active ? forward : 0, right: active ? right : 0, yaw: view.yaw, sprint, crouch: active && crouch, jump: active && jump,
      aiming: arms.aiming, firing, walk: intent.walk,
    }, step, collision, player.move)
    player.sprinting = stepped.sprinting
    player.speed = stepped.speed
    if (stepped.step) hooks.current?.onStep?.(stepped.sprinting ? 1 : player.body.crouch > 0.5 ? 0.35 : 0.7)
    if (stepped.landed > 0) { hooks.current?.onLand?.(stepped.landed); player.feel.land(stepped.landed); arms.landSpeed = stepped.landed; arms.landSequence++ }
    if (stepped.jumped) { hooks.current?.onJump?.(); player.feel.jump() }
    const crouched = player.body.crouch > 0.5
    if (crouched !== scratch.crouched) { scratch.crouched = crouched; player.feel.crouch(crouched) }
    arms.speed = stepped.speed
    arms.sprinting = stepped.sprinting
    arms.aiming = active && (aimHeld || status.touchAim || !!drive?.aim) && !stepped.sprinting
    const body = player.body
    const sinYaw = Math.sin(view.yaw), cosYaw = Math.cos(view.yaw)
    const ahead = -sinYaw * body.velocity.x - cosYaw * body.velocity.z
    const lateral = cosYaw * body.velocity.x - sinYaw * body.velocity.z
    const weapon = player.weaponOf(arms.weapon)
    player.feel.step({ speed: stepped.speed, lateral, grounded: body.grounded, sprinting: stepped.sprinting, aim: arms.debug.aimAmount }, player.fov, weapon.adsFov, step, arms.kick)
    arms.motion = { forward: ahead, lateral, grounded: body.grounded, crouching: crouched, look: player.sway, walk: player.feel.phase, bob: player.feel.bob }
    const eye = eyePosition(body, player.eye)
    eye.y -= player.eyeDrop
    scratch.accumulated = Math.min(scratch.accumulated + step, 0.1)
    const runtime = player.weapon
    const reload = active && player.queued.reload
    player.queued.reload = false
    let reloading = reload
    while (scratch.accumulated >= runtime.fixedDeltaSeconds) {
      scratch.accumulated -= runtime.fixedDeltaSeconds
      player.aim.origin.set(eye.x, eye.y, eye.z)
      const stance = { aiming: arms.aiming, moving: Math.min(1, stepped.speed / player.move.run), crouched }
      const out = player.weapon.step({ tick: player.weapon.snapshot().nextTick, trigger: firing && !stepped.sprinting && player.clock >= scratch.fireReadyAt, reload: reloading, selectWeaponId: player.selected, aim: player.aim, muzzle: player.aim.origin, stance }, queries)
      reloading = false
      for (const event of out) handle(event)
    }
    if (reloading) player.queued.reload = true
    const snapshot = player.weapon.snapshot()
    arms.empty = (snapshot.weapons.find(entry => entry.id === snapshot.equippedWeaponId)?.magazine ?? 1) <= 0

    camera.position.set(eye.x, eye.y, eye.z)
    if (!player.override) {
      const pose = player.feel.pose
      const aimed = scratch.rotation
      scratch.posed.set(Math.max(-1.55, Math.min(1.55, aimed.x + pose.pitch)), aimed.y + pose.yaw, pose.roll)
      camera.quaternion.setFromEuler(scratch.posed)
      scratch.shift.set(pose.x, pose.y, pose.z).applyEuler(scratch.turned.set(0, aimed.y, 0))
      camera.position.add(scratch.shift)
      const fov = portraitFov(player.feel.fov, camera.aspect)
      if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix() }
    }
  })

  return <ArmsViewmodel state={player.arms} render="external" rig="found" manifestUrl={manifestUrl} onPresentation={onPresentation} />
}
