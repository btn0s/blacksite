import { useImperativeHandle, useMemo, useRef, type MutableRefObject, type RefObject } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import type { CharacterPoseSample } from 'als-ue5-r3f/app/CharacterPoseSample'
import type { Route } from './route'
import type { Soundscape } from './audio'
import { input as tuning, look } from './model'
import { isTouchDevice } from '@blacksite/look/world'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'

export type EffectsHandle = { flash(at: readonly [number, number, number]): void; dust(at: THREE.Vector3, amount: number): void }

const vertex = `
attribute float size;
attribute float alpha;
attribute vec3 tint;
uniform float scale;
varying float vAlpha;
varying vec3 vTint;
#include <fog_pars_vertex>
void main() {
  vAlpha = alpha;
  vTint = tint;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = alpha <= 0.0 ? 0.0 : size * scale / max(0.1, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`

const fragment = `
varying float vAlpha;
varying vec3 vTint;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0) discard;
  gl_FragColor = vec4(vTint, vAlpha * (1.0 - d) * (1.0 - d));
  #include <fog_fragment>
}`

function pointsMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { scale: { value: 600 } }]),
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    fog: true,
  })
}

function cloud(count: number) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('size', new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage))
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
  const points = new THREE.Points(geometry, pointsMaterial())
  points.frustumCulled = false
  points.renderOrder = 2
  return points
}

type Puff = { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number; grow: number; shade: [number, number, number]; peak: number }

const dustShade: [number, number, number] = [0.56, 0.53, 0.47]
const smokeShade: [number, number, number] = [0.3, 0.29, 0.27]
const flashShade: [number, number, number] = [1.0, 0.75, 0.38]

export function Effects({ route, pose, handle, sound }: { route: Route; pose: MutableRefObject<CharacterPoseSample>; handle: { current: EffectsHandle | null }; sound: Soundscape }) {
  const { camera, gl } = useThree()
  const count = useMemo(() => Math.round(look.ash * (isTouchDevice() ? look.phoneDensity : 1)), [])
  const ash = useMemo(() => {
    const points = cloud(count)
    const size = points.geometry.getAttribute('size') as THREE.BufferAttribute
    const alpha = points.geometry.getAttribute('alpha') as THREE.BufferAttribute
    const tint = points.geometry.getAttribute('tint') as THREE.BufferAttribute
    const position = points.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < count; i++) {
      size.setX(i, 0.018 + Math.random() * 0.03)
      alpha.setX(i, 0.55 + Math.random() * 0.35)
      const shade = 0.62 + Math.random() * 0.2
      tint.setXYZ(i, shade, shade * 0.98, shade * 0.94)
      position.setXYZ(i, (Math.random() - 0.5) * 2 * look.ashRadius, Math.random() * 14, (Math.random() - 0.5) * 2 * look.ashRadius)
    }
    return { points, seeds: Float32Array.from({ length: count }, () => Math.random() * 100) }
  }, [])
  const puffs = useMemo(() => cloud(160), [])
  const live = useRef<Puff[]>([])
  const smokeClock = useRef(0)
  const previous = useRef<{ mode: string | null; action: string | null; vz: number; airborne: number }>({ mode: null, action: null, vz: 0, airborne: 0 })
  const forward = useMemo(() => new THREE.Vector3(), [])
  const spot = useMemo(() => new THREE.Vector3(), [])
  const dip = useRef({ y: 0, v: 0 })

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 20)
    const state = dip.current
    const omega = tuning.landingDipRecovery
    state.v += (-omega * omega * state.y - 2 * omega * state.v) * dt
    state.y += state.v * dt
    if (Math.abs(state.y) < 1e-4 && Math.abs(state.v) < 1e-3) state.y = state.v = 0
    camera.position.y += state.y
  }, ALS_FRAME_PRIORITY.Camera + 0.02)

  const spawn = (puff: Omit<Puff, 'age'>) => { if (live.current.length < 160) live.current.push({ ...puff, age: 0 }) }
  const api = useMemo<EffectsHandle>(() => ({
    flash(at) {
      for (let i = 0; i < 26; i++) {
        const angle = (i / 26) * Math.PI * 2
        spawn({ x: at[0], y: at[1] - 0.6 + Math.random() * 1.6, z: at[2], vx: Math.cos(angle) * 0.4, vy: 0.6 + Math.random() * 0.8, vz: Math.sin(angle) * 1.6, life: 0.7 + Math.random() * 0.4, size: 0.1, grow: 0.05, shade: flashShade, peak: 0.9 })
      }
    },
    dust(at, amount) {
      const count = Math.round(6 + amount * 12)
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = 0.5 + Math.random() * 1.2 * amount
        spawn({ x: at.x, y: at.y + 0.05, z: at.z, vx: Math.cos(angle) * speed, vy: 0.15 + Math.random() * 0.35, vz: Math.sin(angle) * speed, life: 0.9 + Math.random() * 0.7, size: 0.25 + Math.random() * 0.2, grow: 0.9, shade: dustShade, peak: 0.42 * Math.min(1, 0.5 + amount) })
      }
    },
  }), [])
  useImperativeHandle(handle as RefObject<EffectsHandle>, () => api, [api])

  const fires = useMemo(() => route.emitters.filter(emitter => emitter.kind === 'fire'), [route])

  useFrame(({ clock }, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 20)
    const t = clock.elapsedTime
    const scale = gl.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov) / 2))
    ;(ash.points.material as THREE.ShaderMaterial).uniforms.scale!.value = scale
    ;(puffs.material as THREE.ShaderMaterial).uniforms.scale!.value = scale

    const position = ash.points.geometry.getAttribute('position') as THREE.BufferAttribute
    const array = position.array as Float32Array
    const r = look.ashRadius
    const cx = camera.position.x
    const cz = camera.position.z
    const cy = camera.position.y
    for (let i = 0; i < count; i++) {
      const seed = ash.seeds[i]!
      let x = array[i * 3]! + (0.22 + Math.sin(t * 0.7 + seed) * 0.18) * dt
      let y = array[i * 3 + 1]! - (0.18 + (seed % 1) * 0.16) * dt
      let z = array[i * 3 + 2]! + Math.cos(t * 0.5 + seed * 1.7) * 0.14 * dt
      if (x - cx > r) x -= 2 * r; else if (cx - x > r) x += 2 * r
      if (z - cz > r) z -= 2 * r; else if (cz - z > r) z += 2 * r
      if (y < cy - 4) y += 14; else if (y > cy + 10) y -= 14
      array[i * 3] = x
      array[i * 3 + 1] = y
      array[i * 3 + 2] = z
    }
    position.needsUpdate = true

    smokeClock.current += dt
    if (smokeClock.current > 0.16) {
      smokeClock.current = 0
      for (const fire of fires) {
        if (Math.hypot(fire.at[0] - cx, fire.at[2] - cz) > 45) continue
        spawn({ x: fire.at[0] + (Math.random() - 0.5) * 0.3, y: fire.at[1] + 0.4, z: fire.at[2] + (Math.random() - 0.5) * 0.3, vx: 0.15 + Math.random() * 0.1, vy: 0.7 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.1, life: 3.2, size: 0.35, grow: 0.7, shade: smokeShade, peak: 0.32 })
        if (Math.random() < 0.5) spawn({ x: fire.at[0], y: fire.at[1] + 0.25, z: fire.at[2], vx: (Math.random() - 0.5) * 0.6, vy: 1.6 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 0.6, life: 0.6 + Math.random() * 0.5, size: 0.035, grow: 0, shade: flashShade, peak: 1 })
      }
    }

    const sample = pose.current
    const character = sample.character
    if (sample.ready && character) {
      const state = previous.current
      const vz = character.movement.velocity.z
      const mode = character.locomotionMode
      const action = character.locomotionAction
      if (mode === 'InAir') state.airborne += dt
      if (state.mode === 'InAir' && mode === 'Grounded' && state.airborne > 0.12) {
        const strength = Math.min(1, Math.max(0, (-state.vz - 2) / 6))
        if (strength > 0) {
          spot.copy(sample.leftFoot).add(sample.rightFoot).multiplyScalar(0.5)
          spot.y = sample.ground.y
          api.dust(spot, strength)
          sound.play('land', strength)
          dip.current.v -= tuning.landingDip * strength * tuning.landingDipRecovery * Math.E
        }
      }
      if (mode === 'Grounded') state.airborne = 0
      if (action !== state.action) {
        if (action === 'Mantling') sound.play('mantle')
        if (action === 'Rolling') { sound.play('roll'); spot.copy(sample.ground); api.dust(spot, 0.4) }
        if (action === 'Ragdolling') { sound.play('ragdoll', 0.8); spot.copy(sample.pelvis); spot.y = sample.ground.y; api.dust(spot, 0.9) }
      }
      state.mode = mode
      state.action = action
      state.vz = vz
    }

    camera.getWorldDirection(forward)
    sound.listen(camera.position, forward, sample.ready ? sample.ground.y : 0)

    const puffPosition = puffs.geometry.getAttribute('position') as THREE.BufferAttribute
    const puffSize = puffs.geometry.getAttribute('size') as THREE.BufferAttribute
    const puffAlpha = puffs.geometry.getAttribute('alpha') as THREE.BufferAttribute
    const puffTint = puffs.geometry.getAttribute('tint') as THREE.BufferAttribute
    const list = live.current
    let write = 0
    for (let i = 0; i < list.length; i++) {
      const puff = list[i]!
      puff.age += dt
      if (puff.age >= puff.life) continue
      const drag = Math.exp(-dt * 2.2)
      puff.vx *= drag
      puff.vz *= drag
      puff.vy = puff.vy * Math.exp(-dt * 0.8) + (puff.grow > 0 ? 0 : -3) * dt
      puff.x += puff.vx * dt
      puff.y += puff.vy * dt
      puff.z += puff.vz * dt
      list[write++] = puff
    }
    list.length = write
    for (let i = 0; i < 160; i++) {
      const puff = list[i]
      if (!puff) { puffAlpha.setX(i, 0); continue }
      const k = puff.age / puff.life
      puffPosition.setXYZ(i, puff.x, puff.y, puff.z)
      puffSize.setX(i, puff.size * (1 + puff.grow * k * 3))
      puffAlpha.setX(i, puff.peak * Math.min(1, k * 8) * (1 - k) * (1 - k))
      puffTint.setXYZ(i, ...puff.shade)
    }
    puffPosition.needsUpdate = puffSize.needsUpdate = puffAlpha.needsUpdate = puffTint.needsUpdate = true
  })

  return <>
    <primitive object={ash.points} />
    <primitive object={puffs} />
  </>
}
