import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Canvas, type RootState } from '@react-three/fiber'
import { CuboidCollider, CylinderCollider, Physics, RigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { Look } from '@blacksite/look/r3f'
import { QUALITY, autoQuality, depthDefaults, type QualityTier } from '@blacksite/look/quality'
import { internalPixelRatio, texturesReady } from '@blacksite/look/world'
import { PLAY, input, requestLock } from './input'
import { FEEL, FIXED_STEP } from './model'
import { yard } from './yard'

export const tier: QualityTier = autoQuality()

let surfaces = false
const loading = texturesReady().then(() => { surfaces = true })
export const surfacesReady = () => surfaces

export function useSurfaces() {
  const [ready, setReady] = useState(surfaces)
  useEffect(() => { void loading.then(() => setReady(true)) }, [])
  return ready
}

function Lights({ onLights }: { onLights: (lights: { sun: THREE.DirectionalLight; fill: THREE.HemisphereLight }) => void }) {
  const lights = useMemo(() => {
    const sun = new THREE.DirectionalLight('#ffffff', 1.5)
    sun.castShadow = true
    sun.shadow.mapSize.setScalar(tier === 'low' ? 1024 : 2048)
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.03
    sun.shadow.radius = 3
    Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 140 })
    sun.shadow.camera.updateProjectionMatrix()
    sun.target.position.set(24, 0, 0)
    const fill = new THREE.HemisphereLight('#ffffff', '#222222', 1)
    return { sun, fill }
  }, [])
  useEffect(() => onLights(lights), [lights, onLights])
  return <><primitive object={lights.sun} /><primitive object={lights.sun.target} /><primitive object={lights.fill} /></>
}

export function Yard() {
  return <>
    <primitive object={yard.group} />
    <RigidBody type="fixed" colliders={false}>
      {yard.colliders.map((collider, index) => collider.kind === 'box'
        ? <CuboidCollider key={index} args={collider.half} position={collider.position} rotation={collider.rotation} />
        : <CylinderCollider key={index} args={[collider.halfHeight, collider.radius]} position={collider.position} rotation={collider.rotation} />)}
    </RigidBody>
  </>
}

export function Stage({ children, overlay = null, physics = true, physicsPriority, onCreated }: {
  children: ReactNode
  physics?: boolean
  overlay?: { scene: THREE.Scene; camera: THREE.Camera } | null
  physicsPriority?: number
  onCreated?: (state: RootState) => void
}) {
  const [lights, setLights] = useState<{ sun: THREE.DirectionalLight; fill: THREE.HemisphereLight } | null>(null)
  const ready = useSurfaces()
  useEffect(() => input.mount(), [])
  useEffect(() => input.actions.addContext(PLAY), [])
  const dpr = Math.min(QUALITY[tier].maxPixelRatio, internalPixelRatio())
  return <Canvas shadows="percentage" dpr={[1, dpr]} camera={{ fov: FEEL.fov, near: depthDefaults(tier).near, far: 400, position: [-4, FEEL.eyeHeight, 0] }} gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }} onCreated={state => { const canvas = state.gl.domElement; canvas.addEventListener('click', () => requestLock(canvas)); onCreated?.(state) }}>
    <Lights onLights={setLights} />
    {lights && <Look atmosphere="zone" quality={tier} environment sun={lights.sun} fill={lights.fill} overlay={overlay} />}
    {ready && !physics && children}
    {ready && physics && <Physics timeStep={FIXED_STEP} gravity={[0, -FEEL.gravity, 0]} updatePriority={physicsPriority}>
      <Yard />
      {children}
    </Physics>}
  </Canvas>
}
