import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Euler, Quaternion, Vector3 } from 'three'
import { readStandaloneIntent, type StandaloneIntent } from './intent'
import { createAimRecoil, type RecoilTuning } from './feel/recoil'

export type { StandaloneIntent } from './intent'

export type StandaloneTouch = { forward: number; right: number; lookX: number; lookY: number; fire: boolean }
export type StandaloneRecoil = { pitch: number; yaw: number }
export type StandaloneRecovery = { fraction: number; seconds: number }
export type StandaloneView = { yaw: number; pitch: number; reset?: boolean }
export type StandalonePose = { x: number; y: number; z: number; pitch: number; yaw: number; roll: number }
export type StandaloneLook = { pitch: number; yaw: number }

export const createStandaloneTouch = (): StandaloneTouch => ({ forward: 0, right: 0, lookX: 0, lookY: 0, fire: false })
export const createStandaloneRecoil = (): StandaloneRecoil => ({ pitch: 0, yaw: 0 })

export type StandaloneSubjectProps = {
  onIntent: (intent: StandaloneIntent, dt: number) => { x: number; y: number; z: number }
  onFire: (firing: boolean, aim: { origin: Vector3; direction: Vector3 }) => void
  onReload: () => void
  touch?: StandaloneTouch
  recoil?: StandaloneRecoil
  sensitivity?: number
  recoilKept?: number
  recovery?: StandaloneRecovery
  view?: StandaloneView
  pose?: StandalonePose
  look?: StandaloneLook
  recoilFeel?: RecoilTuning
}

export function StandaloneSubject({ onIntent, onFire, onReload, touch, recoil, sensitivity = 1, recoilKept = 0.55, recovery, view, pose, look, recoilFeel }: StandaloneSubjectProps) {
  const { camera, gl } = useThree()
  const keys = useRef(new Set<string>())
  const pointer = useRef({ locked: false, yaw: 0, pitch: 0, fire: false })
  const kick = useRef({ pitch: 0, yaw: 0, climbPitch: 0, climbYaw: 0, sprayPitch: 0, sprayYaw: 0, restorePitch: 0, restoreYaw: 0, firing: false })
  const scale = useRef(sensitivity)
  scale.current = sensitivity
  const rotation = useRef(new Euler(0, 0, 0, 'YXZ'))
  const quaternion = useRef(new Quaternion())
  const direction = useRef(new Vector3())
  const origin = useRef(new Vector3())
  const shift = useRef(new Vector3())
  const posed = useRef(new Euler(0, 0, 0, 'YXZ'))
  const turned = useRef(new Euler(0, 0, 0, 'YXZ'))
  const aimRecoil = useRef(createAimRecoil())
  const lookRef = useRef(look)
  lookRef.current = look
  useEffect(() => {
    const canvas = gl.domElement
    const doc = canvas.ownerDocument
    const lock = (event: MouseEvent) => { if ((event as PointerEvent).pointerType === 'touch') return; Promise.resolve(canvas.requestPointerLock()).catch(() => undefined) }
    const lockChange = () => { pointer.current.locked = doc.pointerLockElement === canvas; if (!pointer.current.locked) { keys.current.clear(); pointer.current.fire = false } }
    const move = (event: PointerEvent) => { if (!pointer.current.locked) return; const yaw = event.movementX * 0.0022 * scale.current; const pitch = event.movementY * 0.0022 * scale.current; pointer.current.yaw -= yaw; pointer.current.pitch = Math.max(-1.48, Math.min(1.48, pointer.current.pitch - pitch)); compensate(kick.current, pitch); if (lookRef.current) { lookRef.current.yaw -= yaw; lookRef.current.pitch -= pitch } }
    const down = (event: KeyboardEvent) => { if (!pointer.current.locked) return; keys.current.add(event.code); if (event.code === 'KeyR' && !event.repeat) onReload() }
    const up = (event: KeyboardEvent) => keys.current.delete(event.code)
    const fire = (event: MouseEvent) => { if (event.button === 0 && pointer.current.locked) pointer.current.fire = true }
    const stopFire = (event: MouseEvent) => { if (event.button === 0) pointer.current.fire = false }
    canvas.addEventListener('click', lock)
    canvas.addEventListener('mousedown', fire)
    doc.addEventListener('mouseup', stopFire)
    doc.addEventListener('pointerlockchange', lockChange)
    doc.addEventListener('pointermove', move)
    doc.addEventListener('keydown', down)
    doc.addEventListener('keyup', up)
    return () => { canvas.removeEventListener('click', lock); canvas.removeEventListener('mousedown', fire); doc.removeEventListener('mouseup', stopFire); doc.removeEventListener('pointerlockchange', lockChange); doc.removeEventListener('pointermove', move); doc.removeEventListener('keydown', down); doc.removeEventListener('keyup', up) }
  }, [gl, onReload])
  useFrame((_, dt) => {
    const state = pointer.current
    if (view?.reset) {
      state.yaw = view.yaw
      state.pitch = view.pitch
      Object.assign(kick.current, { pitch: 0, yaw: 0, climbPitch: 0, climbYaw: 0, sprayPitch: 0, sprayYaw: 0, restorePitch: 0, restoreYaw: 0 })
      aimRecoil.current.reset()
      if (recoil) recoil.pitch = recoil.yaw = 0
      view.reset = false
    }
    if (touch) {
      state.yaw -= touch.lookX * 0.0042 * scale.current
      state.pitch = Math.max(-1.48, Math.min(1.48, state.pitch - touch.lookY * 0.0042 * scale.current))
      if (look) { look.yaw -= touch.lookX * 0.0042 * scale.current; look.pitch -= touch.lookY * 0.0042 * scale.current }
      compensate(kick.current, touch.lookY * 0.0042 * scale.current)
      touch.lookX = touch.lookY = 0
    }
    const offset = kick.current
    if (recoilFeel) {
      if (recoil && (recoil.pitch || recoil.yaw)) {
        const kept = aimRecoil.current.shot(recoil.pitch, recoil.yaw, recoilFeel)
        state.pitch = Math.max(-1.48, Math.min(1.48, state.pitch + kept.pitch))
        state.yaw -= kept.yaw
        recoil.pitch = recoil.yaw = 0
      }
      const settled = aimRecoil.current.step(dt)
      offset.pitch = settled.pitch
      offset.yaw = settled.yaw
    } else if (recoil && (recoil.pitch || recoil.yaw)) {
      offset.climbPitch += recoil.pitch * recoilKept
      offset.climbYaw += recoil.yaw * recoilKept
      offset.pitch += recoil.pitch * (1 - recoilKept)
      offset.yaw += recoil.yaw * (1 - recoilKept)
      recoil.pitch = recoil.yaw = 0
    }
    const climb = recoilFeel ? 0 : 1 - Math.exp(-28 * dt)
    state.pitch = Math.max(-1.48, Math.min(1.48, state.pitch + offset.climbPitch * climb))
    state.yaw -= offset.climbYaw * climb
    offset.sprayPitch += offset.climbPitch * climb
    offset.sprayYaw += offset.climbYaw * climb
    const firing = state.fire || !!touch?.fire
    if (recovery && offset.firing && !firing) {
      offset.restorePitch = Math.max(0, offset.sprayPitch) * recovery.fraction
      offset.restoreYaw = offset.sprayYaw * recovery.fraction
      offset.sprayPitch = offset.sprayYaw = 0
    }
    if (firing && !offset.firing) offset.sprayPitch = offset.sprayYaw = offset.restorePitch = offset.restoreYaw = 0
    offset.firing = firing
    if (recovery && (offset.restorePitch || offset.restoreYaw)) {
      const back = 1 - Math.exp(-4 * dt / Math.max(0.01, recovery.seconds))
      state.pitch = Math.max(-1.48, Math.min(1.48, state.pitch - offset.restorePitch * back))
      state.yaw += offset.restoreYaw * back
      offset.restorePitch *= 1 - back
      offset.restoreYaw *= 1 - back
      if (Math.abs(offset.restorePitch) < 1e-5 && Math.abs(offset.restoreYaw) < 1e-5) offset.restorePitch = offset.restoreYaw = 0
    }
    offset.climbPitch *= 1 - climb
    offset.climbYaw *= 1 - climb
    if (!recoilFeel) {
      const settle = Math.exp(-11 * dt)
      offset.pitch *= settle
      offset.yaw *= settle
    }
    rotation.current.set(Math.max(-1.5, Math.min(1.5, state.pitch + offset.pitch)), state.yaw - offset.yaw, 0)
    if (view) { view.yaw = state.yaw; view.pitch = state.pitch }
    quaternion.current.setFromEuler(rotation.current)
    camera.quaternion.copy(quaternion.current)
    const intent = readStandaloneIntent(keys.current)
    if (touch && (touch.forward || touch.right)) {
      const length = Math.max(1, Math.hypot(touch.forward, touch.right))
      intent.forward = touch.forward / length
      intent.right = touch.right / length
    }
    const position = onIntent(intent, dt)
    direction.current.set(0, 0, -1).applyQuaternion(quaternion.current)
    origin.current.set(position.x, position.y, position.z)
    camera.position.copy(origin.current)
    if (pose) {
      const aimed = rotation.current
      posed.current.set(Math.max(-1.55, Math.min(1.55, aimed.x + pose.pitch)), aimed.y + pose.yaw, pose.roll)
      camera.quaternion.setFromEuler(posed.current)
      shift.current.set(pose.x, pose.y, pose.z).applyEuler(turned.current.set(0, aimed.y, 0))
      camera.position.add(shift.current)
    }
    onFire(state.fire || !!touch?.fire, { origin: origin.current, direction: direction.current })
  })
  return null
}

function compensate(offset: { sprayPitch: number; restorePitch: number }, down: number) {
  if (down <= 0) return
  offset.sprayPitch = Math.max(0, offset.sprayPitch - down)
  offset.restorePitch = Math.max(0, offset.restorePitch - down)
}
