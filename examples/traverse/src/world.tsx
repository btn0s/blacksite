import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier'
import { createAtmosphere } from '@blacksite/look/world'
import type { Route } from './route'
import type { Race } from './race'
import { look as lookModel, frame } from './model'

export function Level({ route }: { route: Route }) {
  return <>
    <primitive object={route.group} />
    <RigidBody type="fixed" colliders={false}>
      {route.colliders.map((collider, index) => collider.kind === 'box'
        ? <CuboidCollider key={index} args={collider.half} position={collider.position} rotation={collider.rotation} />
        : <CylinderCollider key={index} args={[collider.halfHeight, collider.radius]} position={collider.position} rotation={collider.rotation} />)}
    </RigidBody>
  </>
}

export function Atmosphere() {
  const { scene, gl, camera } = useThree()
  const atmosphere = useMemo(() => createAtmosphere(scene, gl, lookModel.atmosphere), [scene, gl])
  const focus = useRef(new THREE.Vector3())
  useFrame(() => {
    camera.getWorldDirection(focus.current)
    focus.current.multiplyScalar(12).add(camera.position)
    focus.current.y = 0
    atmosphere.follow(focus.current)
  })
  return null
}

const flicker = (t: number, seed: number) => {
  const a = Math.sin(t * 13.1 + seed) * 0.5 + Math.sin(t * 7.3 + seed * 3) * 0.5
  return a > 0.86 ? 0.15 : 1
}

export function Practicals({ route }: { route: Route }) {
  const { camera } = useThree()
  const lights = useMemo(() => route.lights.map(light => {
    const point = new THREE.PointLight(light.color, 0, light.distance, 2)
    point.position.set(...light.at)
    const glow = new THREE.Mesh(
      light.kind === 'tube' ? new THREE.BoxGeometry(0.06, 0.04, 1.1) : light.kind === 'sodium' ? new THREE.SphereGeometry(0.13, 10, 6) : new THREE.SphereGeometry(0.01, 4, 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(light.color).multiplyScalar(light.kind === 'fire' ? 0 : 3.2), toneMapped: false }),
    )
    glow.position.set(...light.at)
    if (light.kind === 'tube') glow.position.y -= 0.02
    return { light, point, glow }
  }), [route])
  const order = useRef<number[]>([])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    order.current = lights.map((_, index) => index).sort((a, b) => lights[a]!.point.position.distanceToSquared(camera.position) - lights[b]!.point.position.distanceToSquared(camera.position))
    order.current.forEach((index, rank) => {
      const { light, point, glow } = lights[index]!
      const on = rank < frame.pointLights
      const level = light.kind === 'tube' ? flicker(t, index * 2.7) : light.kind === 'fire' ? 0.75 + 0.25 * Math.sin(t * 17 + Math.sin(t * 5.3) * 2) * Math.sin(t * 3.1) : 1
      point.intensity = on ? light.intensity * level : 0
      ;(glow.material as THREE.MeshBasicMaterial).color.set(light.color).multiplyScalar(light.kind === 'fire' ? 0 : 3.2 * level)
    })
  })
  return <>{lights.map(({ point, glow }, index) => <group key={index}><primitive object={point} /><primitive object={glow} /></group>)}</>
}

export function Markers({ route, race }: { route: Route; race: { current: Race } }) {
  const markers = useMemo(() => route.gates.map(gate => {
    const group = new THREE.Group()
    const baseY = gate.at[1] - gate.half[1]
    const pole = new THREE.CylinderGeometry(0.035, 0.035, 2.6, 6)
    const material = new THREE.MeshStandardMaterial({ color: '#2b2a24', roughness: 0.6, metalness: 0.4 })
    const stripe = new THREE.MeshBasicMaterial({ color: '#ffb347', toneMapped: false, transparent: true, opacity: 1 })
    const c = Math.cos(gate.yaw)
    const s = Math.sin(gate.yaw)
    for (const side of [-1, 1]) {
      const lz = side * (gate.half[2] + 0.05)
      const x = gate.at[0] + lz * s
      const z = gate.at[2] + lz * c
      const mesh = new THREE.Mesh(pole, material)
      mesh.position.set(x, baseY + 1.3, z)
      group.add(mesh)
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.42, 0.09), stripe)
      lamp.position.set(x, baseY + 2.45, z)
      group.add(lamp)
    }
    const tape = new THREE.Mesh(new THREE.PlaneGeometry(gate.half[2] * 2 + 0.1, 0.08), new THREE.MeshBasicMaterial({ color: '#d8c9a8', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }))
    tape.position.set(gate.at[0], baseY + 2.3, gate.at[2])
    tape.rotation.y = Math.PI / 2 + gate.yaw
    group.add(tape)
    return { group, stripe }
  }), [route])
  useFrame(({ clock }) => {
    const r = race.current
    markers.forEach(({ stripe }, index) => {
      const next = r.state === 'ready' ? index === 0 : index === r.next
      const passed = r.state !== 'ready' && index < r.next
      const pulse = 0.65 + 0.35 * Math.sin(clock.elapsedTime * 5)
      if (next) stripe.color.set('#ffb347').multiplyScalar(2.4 * pulse)
      else if (passed) stripe.color.set('#6f8f6a').multiplyScalar(0.8)
      else stripe.color.set('#8a7a5a').multiplyScalar(0.7)
    })
  })
  return <>{markers.map(({ group }, index) => <primitive key={index} object={group} />)}</>
}
