import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Euler, Quaternion, Vector3 } from 'three'
import { readStandaloneIntent, type StandaloneIntent } from './intent'

export type { StandaloneIntent } from './intent'
export type StandaloneSubjectProps = {
  onIntent: (intent: StandaloneIntent, dt: number) => { x: number; y: number; z: number }
  onFire: (firing: boolean, aim: { origin: Vector3; direction: Vector3 }) => void
  onReload: () => void
}

export function StandaloneSubject({ onIntent, onFire, onReload }: StandaloneSubjectProps) {
  const { camera, gl } = useThree()
  const keys = useRef(new Set<string>())
  const pointer = useRef({ locked: false, yaw: 0, pitch: 0, fire: false })
  const rotation = useRef(new Euler(0, 0, 0, 'YXZ'))
  const quaternion = useRef(new Quaternion())
  const direction = useRef(new Vector3())
  const origin = useRef(new Vector3())
  useEffect(() => {
    const canvas = gl.domElement
    const doc = canvas.ownerDocument
    const lock = () => { void canvas.requestPointerLock() }
    const lockChange = () => { pointer.current.locked = doc.pointerLockElement === canvas; if (!pointer.current.locked) { keys.current.clear(); pointer.current.fire = false } }
    const move = (event: PointerEvent) => { if (!pointer.current.locked) return; pointer.current.yaw -= event.movementX * 0.0022; pointer.current.pitch = Math.max(-1.48, Math.min(1.48, pointer.current.pitch - event.movementY * 0.0022)) }
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
    rotation.current.set(state.pitch, state.yaw, 0)
    quaternion.current.setFromEuler(rotation.current)
    camera.quaternion.copy(quaternion.current)
    const position = onIntent(readStandaloneIntent(keys.current), dt)
    camera.getWorldDirection(direction.current)
    camera.position.set(position.x, position.y, position.z)
    camera.getWorldPosition(origin.current)
    onFire(state.fire, { origin: origin.current, direction: direction.current })
  })
  return null
}
