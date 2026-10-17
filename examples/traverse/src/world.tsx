import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
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
  const atmosphere = useRef<ReturnType<typeof createAtmosphere> | null>(null)
  useLayoutEffect(() => {
    const created = createAtmosphere(scene, gl, lookModel.atmosphere)
    atmosphere.current = created
    return () => {
      atmosphere.current = null
      scene.remove(created.sun, created.sun.target, created.hemisphere, created.dome)
      created.sun.shadow.dispose()
      created.dome.geometry.dispose()
    }
  }, [scene, gl])
  const focus = useRef(new THREE.Vector3())
  useFrame(() => {
    if (!atmosphere.current) return
    camera.getWorldDirection(focus.current)
    focus.current.multiplyScalar(12).add(camera.position)
    focus.current.y = 0
    atmosphere.current.follow(focus.current)
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
    const glow = new THREE.Mesh(
      light.kind === 'tube' ? new THREE.BoxGeometry(0.06, 0.04, 1.1) : light.kind === 'sodium' ? new THREE.SphereGeometry(0.13, 10, 6) : new THREE.SphereGeometry(0.01, 4, 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(light.color).multiplyScalar(light.kind === 'fire' ? 0 : 3.2), toneMapped: false }),
    )
    glow.position.set(...light.at)
    glow.visible = light.kind !== 'fire'
    if (light.kind === 'tube') glow.position.y -= 0.02
    return { light, glow, level: 1 }
  }), [route])
  const points = useMemo(() => Array.from({ length: Math.min(frame.pointLights, lights.length) }, () => new THREE.PointLight('#ffffff', 0, 0, 2)), [lights])
  const order = useMemo(() => lights.map((_, index) => index), [lights])
  const distance = useMemo(() => new Float32Array(lights.length), [lights])
  const nearer = useMemo(() => (a: number, b: number) => distance[a]! - distance[b]!, [distance])
  useEffect(() => () => {
    for (const { glow } of lights) { glow.geometry.dispose(); glow.material.dispose() }
    for (const point of points) point.dispose()
  }, [lights, points])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    for (let index = 0; index < lights.length; index++) {
      const fixture = lights[index]!
      const { light, glow } = fixture
      distance[index] = glow.position.distanceToSquared(camera.position)
      const level = light.kind === 'tube' ? flicker(t, index * 2.7) : light.kind === 'fire' ? 0.75 + 0.25 * Math.sin(t * 17 + Math.sin(t * 5.3) * 2) * Math.sin(t * 3.1) : 1
      fixture.level = level
      glow.material.color.set(light.color).multiplyScalar(light.kind === 'fire' ? 0 : 3.2 * level)
    }
    order.sort(nearer)
    for (let rank = 0; rank < points.length; rank++) {
      const point = points[rank]!
      const { light, level } = lights[order[rank]!]!
      point.position.set(...light.at)
      point.color.set(light.color)
      point.distance = light.distance
      point.intensity = light.intensity * level
    }
  })
  return <>{points.map((point, index) => <primitive key={`light-${index}`} object={point} />)}{lights.map(({ glow }, index) => <primitive key={`glow-${index}`} object={glow} />)}</>
}

export function Markers({ route, race }: { route: Route; race: { current: Race } }) {
  const markers = useMemo(() => {
    const count = route.gates.length
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 2.6, 6), new THREE.MeshStandardMaterial({ color: '#2b2a24', roughness: 0.6, metalness: 0.4 }), count * 2)
    const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.42, 0.09), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), count * 2)
    const tapes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 0.08), new THREE.MeshBasicMaterial({ color: '#d8c9a8', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }), count)
    const place = new THREE.Object3D()
    route.gates.forEach((gate, index) => {
      const baseY = gate.at[1] - gate.half[1]
      const c = Math.cos(gate.yaw)
      const s = Math.sin(gate.yaw)
      ;[-1, 1].forEach((side, k) => {
        const lz = side * (gate.half[2] + 0.05)
        const x = gate.at[0] + lz * s
        const z = gate.at[2] + lz * c
        place.position.set(x, baseY + 1.3, z)
        place.rotation.set(0, 0, 0)
        place.scale.set(1, 1, 1)
        place.updateMatrix()
        poles.setMatrixAt(index * 2 + k, place.matrix)
        place.position.y = baseY + 2.45
        place.updateMatrix()
        lamps.setMatrixAt(index * 2 + k, place.matrix)
      })
      place.position.set(gate.at[0], baseY + 2.3, gate.at[2])
      place.rotation.set(0, Math.PI / 2 + gate.yaw, 0)
      place.scale.set(gate.half[2] * 2 + 0.1, 1, 1)
      place.updateMatrix()
      tapes.setMatrixAt(index, place.matrix)
    })
    const tint = new THREE.Color()
    for (let index = 0; index < count * 2; index++) lamps.setColorAt(index, tint.set('#8a7a5a'))
    for (const mesh of [poles, lamps, tapes]) mesh.frustumCulled = false
    return { poles, lamps, tapes, tint }
  }, [route])
  useEffect(() => () => { for (const mesh of [markers.poles, markers.lamps, markers.tapes]) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose() } }, [markers])
  useFrame(({ clock }) => {
    const r = race.current
    const { lamps, tint } = markers
    const pulse = 0.65 + 0.35 * Math.sin(clock.elapsedTime * 5)
    route.gates.forEach((_, index) => {
      const next = r.state === 'ready' ? index === 0 : index === r.next
      const passed = r.state !== 'ready' && index < r.next
      if (next) tint.set('#ffb347').multiplyScalar(2.4 * pulse)
      else if (passed) tint.set('#6f8f6a').multiplyScalar(0.8)
      else tint.set('#8a7a5a').multiplyScalar(0.7)
      lamps.setColorAt(index * 2, tint)
      lamps.setColorAt(index * 2 + 1, tint)
    })
    lamps.instanceColor!.needsUpdate = true
  })
  return <><primitive object={markers.poles} /><primitive object={markers.lamps} /><primitive object={markers.tapes} /></>
}
