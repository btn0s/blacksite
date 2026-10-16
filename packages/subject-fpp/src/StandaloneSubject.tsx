import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Euler, Quaternion, Vector3 } from 'three'
import { readStandaloneIntent, type StandaloneIntent } from './intent'

export type { StandaloneIntent } from './intent'

export type StandaloneTouch = { forward: number; right: number; lookX: number; lookY: number; fire: boolean }
export type StandaloneRecoil = { pitch: number; yaw: number }

export const createStandaloneTouch = (): StandaloneTouch => ({ forward: 0, right: 0, lookX: 0, lookY: 0, fire: false })
export const createStandaloneRecoil = (): StandaloneRecoil => ({ pitch: 0, yaw: 0 })

export type StandaloneSubjectProps = {
  onIntent: (intent: StandaloneIntent, dt: number) => { x: number; y: number; z: number }
  onFire: (firing: boolean, aim: { origin: Vector3; direction: Vector3 }) => void
  onReload: () => void
  touch?: StandaloneTouch
  recoil?: StandaloneRecoil
  sensitivity?: number
}

const recoilKept = 0.55

export function StandaloneSubject({ onIntent, onFire, onReload, touch, recoil, sensitivity = 1 }: StandaloneSubjectProps) {
  const { camera, gl } = useThree()
  const keys = useRef(new Set<string>())
  const pointer = useRef({ locked: false, yaw: 0, pitch: 0, fire: false })
  const kick = useRef({ pitch: 0, yaw: 0, climbPitch: 0, climbYaw: 0 })
  const scale = useRef(sensitivity)
  scale.current = sensitivity
  const rotation = useRef(new Euler(0, 0, 0, 'YXZ'))
  const quaternion = useRef(new Quaternion())
  const direction = useRef(new Vector3())
  const origin = useRef(new Vector3())
  useEffect(() => {
    const canvas = gl.domElement
    const doc = canvas.ownerDocument
    const lock = (event: MouseEvent) => { if ((event as PointerEvent).pointerType === 'touch') return; Promise.resolve(canvas.requestPointerLock()).catch(() => undefined) }
    const lockChange = () => { pointer.current.locked = doc.pointerLockElement === canvas; if (!pointer.current.locked) { keys.current.clear(); pointer.current.fire = false } }
    const move = (event: PointerEvent) => { if (!pointer.current.locked) return; pointer.current.yaw -= event.movementX * 0.0022 * scale.current; pointer.current.pitch = Math.max(-1.48, Math.min(1.48, pointer.current.pitch - event.movementY * 0.0022 * scale.current)) }
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
    if (touch) {
      state.yaw -= touch.lookX * 0.0042 * scale.current
      state.pitch = Math.max(-1.48, Math.min(1.48, state.pitch - touch.lookY * 0.0042 * scale.current))
      touch.lookX = touch.lookY = 0
    }
    const offset = kick.current
    if (recoil && (recoil.pitch || recoil.yaw)) {
      offset.climbPitch += recoil.pitch * recoilKept
      offset.climbYaw += recoil.yaw * recoilKept
      offset.pitch += recoil.pitch * (1 - recoilKept)
      offset.yaw += recoil.yaw * (1 - recoilKept)
      recoil.pitch = recoil.yaw = 0
    }
    const climb = 1 - Math.exp(-28 * dt)
    state.pitch = Math.max(-1.48, Math.min(1.48, state.pitch + offset.climbPitch * climb))
    state.yaw -= offset.climbYaw * climb
    offset.climbPitch *= 1 - climb
    offset.climbYaw *= 1 - climb
    const settle = Math.exp(-11 * dt)
    offset.pitch *= settle
    offset.yaw *= settle
    rotation.current.set(Math.max(-1.5, Math.min(1.5, state.pitch + offset.pitch)), state.yaw - offset.yaw, 0)
    quaternion.current.setFromEuler(rotation.current)
    camera.quaternion.copy(quaternion.current)
    const intent = readStandaloneIntent(keys.current)
    if (touch && (touch.forward || touch.right)) {
      const length = Math.max(1, Math.hypot(touch.forward, touch.right))
      intent.forward = touch.forward / length
      intent.right = touch.right / length
    }
    const position = onIntent(intent, dt)
    camera.getWorldDirection(direction.current)
    camera.position.set(position.x, position.y, position.z)
    camera.getWorldPosition(origin.current)
    onFire(state.fire || !!touch?.fire, { origin: origin.current, direction: direction.current })
  })
  return null
}
