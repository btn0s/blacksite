import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useThree, type RootState } from '@react-three/fiber'
import { Physics, RigidBody } from '@react-three/rapier'
import { createWorld, trait } from 'koota'
import { Vector3 } from 'three'
import { StandaloneSubject } from '@blacksite/subject-fpp'
import type { StandaloneIntent } from '@blacksite/subject-fpp'
import { ALS_WEAPONS, createWeaponRuntime } from '@blacksite/armory'
import { ArmsViewmodel, createArmsState } from '@blacksite/subject-fpp/arms'

const Position = trait({ x: 0, y: 1.63, z: 0 })
const Intent = trait({ forward: 0, right: 0, jump: false })
const noHits = { castRay: () => null, sweepSphere: () => null }

function Scene({ onShot, physicsProbe }: { onShot: () => void; physicsProbe?: ReactNode }) {
  const { camera, gl } = useThree()
  const arms = useMemo(createArmsState, [])
  const controls = useRef({ sprinting: false, weapon: 'rifle' as 'rifle' | 'pistol' })
  const world = useMemo(createWorld, [])
  const pawn = useMemo(() => world.spawn(Position, Intent), [world])
  const weapon = useMemo(() => createWeaponRuntime({ ownerId: 'local', seed: 1, definitions: ALS_WEAPONS }), [])
  const firing = useRef(false)
  const reload = useRef(false)
  const aim = useRef({ origin: new Vector3(), direction: new Vector3(0, 0, -1) })
  const accumulated = useRef(0)
  useEffect(() => {
    const canvas = gl.domElement
    const doc = canvas.ownerDocument
    const active = () => doc.pointerLockElement === canvas
    const down = (event: KeyboardEvent) => {
      if (!active()) return
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') controls.current.sprinting = true
      if (event.code === 'Digit1') controls.current.weapon = 'rifle'
      if (event.code === 'Digit2') controls.current.weapon = 'pistol'
    }
    const up = (event: KeyboardEvent) => { if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') controls.current.sprinting = false }
    const aimDown = (event: MouseEvent) => { if (event.button === 2 && active()) arms.aiming = true }
    const aimUp = (event: MouseEvent) => { if (event.button === 2) arms.aiming = false }
    const release = () => { if (!active()) { arms.aiming = false; controls.current.sprinting = false } }
    const context = (event: MouseEvent) => event.preventDefault()
    doc.addEventListener('keydown', down)
    doc.addEventListener('keyup', up)
    doc.addEventListener('mousedown', aimDown)
    doc.addEventListener('mouseup', aimUp)
    doc.addEventListener('pointerlockchange', release)
    canvas.addEventListener('contextmenu', context)
    return () => { doc.removeEventListener('keydown', down); doc.removeEventListener('keyup', up); doc.removeEventListener('mousedown', aimDown); doc.removeEventListener('mouseup', aimUp); doc.removeEventListener('pointerlockchange', release); canvas.removeEventListener('contextmenu', context) }
  }, [arms, gl])
  const writeIntent = (intent: StandaloneIntent, dt: number) => {
    pawn.set(Intent, intent)
    camera.getWorldDirection(aim.current.direction)
    arms.sprinting = controls.current.sprinting
    arms.speed = Math.hypot(intent.forward, intent.right) * (arms.sprinting ? 6.5 : 3.5)
    accumulated.current = Math.min(accumulated.current + dt, 0.1)
    while (accumulated.current >= 1 / 60) {
      accumulated.current -= 1 / 60
      const position = pawn.get(Position)!
      const intent = pawn.get(Intent)!
      const direction = aim.current.direction
      const step = (arms.sprinting ? 6.5 : 3.5) / 60
      const horizontal = Math.hypot(direction.x, direction.z) || 1
      pawn.set(Position, { x: position.x + (direction.x * intent.forward - direction.z * intent.right) * step / horizontal, y: position.y, z: position.z + (direction.z * intent.forward + direction.x * intent.right) * step / horizontal })
      aim.current.origin.copy(pawn.get(Position)!)
      const events = weapon.step({ tick: weapon.snapshot().nextTick, trigger: firing.current, reload: reload.current, selectWeaponId: controls.current.weapon, aim: { origin: aim.current.origin, direction: aim.current.direction }, muzzle: aim.current.origin }, noHits)
      reload.current = false
      for (const event of events) {
        if (event.type === 'shot') { arms.fireSequence++; onShot() }
        if (event.type === 'reload-started') arms.reloadSequence++
        if (event.type === 'switch-started') { arms.weapon = controls.current.weapon; arms.equipSequence++ }
      }
    }
    return pawn.get(Position)!
  }
  return <><ambientLight intensity={1.3} /><directionalLight position={[4, 8, 2]} intensity={2} /><Physics><RigidBody type="fixed"><mesh position={[0, -0.15, 0]}><boxGeometry args={[30, 0.3, 30]} /><meshStandardMaterial color="#293743" /></mesh></RigidBody>{physicsProbe}</Physics><gridHelper args={[30, 30, '#506d77', '#394c58']} /><ArmsViewmodel state={arms} /><StandaloneSubject onIntent={writeIntent} onFire={(pressed, nextAim) => { firing.current = pressed; aim.current = nextAim }} onReload={() => { reload.current = true }} /></>
}

export default function Mode({ onCreated, physicsProbe }: { onCreated?: (state: RootState) => void; physicsProbe?: ReactNode } = {}) {
  const [shots, setShots] = useState(0)
  return <><Canvas onCreated={onCreated} camera={{ position: [0, 1.63, 0], fov: 75 }}><Scene physicsProbe={physicsProbe} onShot={() => setShots(value => value + 1)} /></Canvas><div className="hud"><strong>First person · arms only</strong><span>Click scene · WASD move · Mouse look · Shift sprint · 1 rifle / 2 pistol · Right click aim · R reload · Left click fire</span><span>Shots: {shots}</span></div><div className="reticle">+</div></>
}
