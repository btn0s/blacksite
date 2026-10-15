import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, createPortal, useFrame, useThree } from '@react-three/fiber'
import { Physics, RigidBody } from '@react-three/rapier'
import { createWorld, trait } from 'koota'
import { Vector3 } from 'three'
import { StandaloneSubject } from '@blacksite/subject-fpp'
import type { StandaloneIntent } from '@blacksite/subject-fpp'
import { ALS_WEAPONS, createWeaponRuntime } from '@blacksite/armory'

const Position = trait({ x: 0, y: 1.63, z: 0 })
const Intent = trait({ forward: 0, right: 0, jump: false })
const noHits = { castRay: () => null, sweepSphere: () => null }

function Arms() {
  const { camera, scene } = useThree()
  useEffect(() => {
    scene.add(camera)
    return () => { scene.remove(camera) }
  }, [camera, scene])
  return createPortal(<group position={[0.27, -0.29, -0.48]} rotation={[0, -0.13, 0]}>
    <mesh position={[-0.2, -0.1, 0.06]} rotation-z={-0.38}><capsuleGeometry args={[0.055, 0.31, 4, 8]} /><meshStandardMaterial color="#b99a79" /></mesh>
    <mesh position={[0.12, -0.12, 0.03]} rotation-z={0.28}><capsuleGeometry args={[0.055, 0.29, 4, 8]} /><meshStandardMaterial color="#b99a79" /></mesh>
    <mesh position={[0, 0, -0.17]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.045, 0.06, 0.64, 10]} /><meshStandardMaterial color="#586871" metalness={0.6} roughness={0.4} /></mesh>
  </group>, camera)
}

function Scene({ onShot }: { onShot: () => void }) {
  const world = useMemo(createWorld, [])
  const pawn = useMemo(() => world.spawn(Position, Intent), [world])
  const weapon = useMemo(() => createWeaponRuntime({ ownerId: 'local', seed: 1, definitions: ALS_WEAPONS }), [])
  const firing = useRef(false)
  const reload = useRef(false)
  const aim = useRef({ origin: new Vector3(), direction: new Vector3(0, 0, -1) })
  const accumulated = useRef(0)
  const writeIntent = (intent: StandaloneIntent) => {
    pawn.set(Intent, intent)
    return pawn.get(Position)!
  }
  useFrame((_, dt) => {
    accumulated.current = Math.min(accumulated.current + dt, 0.1)
    while (accumulated.current >= 1 / 60) {
      accumulated.current -= 1 / 60
      const position = pawn.get(Position)!
      const intent = pawn.get(Intent)!
      const direction = aim.current.direction
      const step = 3 / 60
      const horizontal = Math.hypot(direction.x, direction.z) || 1
      pawn.set(Position, { x: position.x + (direction.x * intent.forward - direction.z * intent.right) * step / horizontal, y: position.y, z: position.z + (direction.z * intent.forward + direction.x * intent.right) * step / horizontal })
      const events = weapon.step({ tick: weapon.snapshot().nextTick, trigger: firing.current, reload: reload.current, aim: { origin: aim.current.origin, direction: aim.current.direction }, muzzle: aim.current.origin }, noHits)
      reload.current = false
      for (const event of events) if (event.type === 'shot') onShot()
    }
  })
  return <><ambientLight intensity={1.3} /><directionalLight position={[4, 8, 2]} intensity={2} /><Physics><RigidBody type="fixed"><mesh position={[0, -0.15, 0]}><boxGeometry args={[30, 0.3, 30]} /><meshStandardMaterial color="#293743" /></mesh></RigidBody></Physics><gridHelper args={[30, 30, '#506d77', '#394c58']} /><Arms /><StandaloneSubject onIntent={writeIntent} onFire={(pressed, nextAim) => { firing.current = pressed; aim.current = nextAim }} onReload={() => { reload.current = true }} /></>
}

export default function Mode() {
  const [shots, setShots] = useState(0)
  return <><Canvas camera={{ position: [0, 1.63, 0], fov: 75 }}><Scene onShot={() => setShots(value => value + 1)} /></Canvas><div className="hud"><strong>First person · arms only</strong><span>Click scene · WASD move · Mouse look · R reload · Left click fire</span><span>Shots: {shots}</span></div><div className="reticle">+</div></>
}
