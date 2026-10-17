import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SoftParticles } from '@blacksite/look/soft'

type Vec = { x: number; y: number; z: number }
type Live = { mesh: THREE.Mesh; age: number; life: number }

const puffs = {
  dust: { acceleration: { x: 0, y: 0.3, z: 0 }, drag: 2, life: 0.6, size: 0.27, grow: 2, opacity: 0.75, tint: new THREE.Color('#8f8a7b') },
  blood: { life: 0.45, size: 0.34, grow: 2, opacity: 0.75, tint: new THREE.Color('#5e1712') },
  spark: { life: 0.12, size: 0.2, grow: 0.85, glow: 0.8, tint: new THREE.Color(1, 0.85, 0.6) },
}

export function createEffects() {
  const group = new THREE.Group()
  group.name = 'shot-effects'
  const tracerGeometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5)
  const tracers: Live[] = []
  const particles = new SoftParticles({ capacity: 64 })
  const flash = new THREE.PointLight('#ffc27a', 0, 9, 2)
  group.add(flash, particles)
  let flashAge = 1
  const tracerMaterial = () => {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3.6, 1.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true })
    return material
  }
  for (let index = 0; index < 18; index++) {
    const mesh = new THREE.Mesh(tracerGeometry, tracerMaterial())
    mesh.frustumCulled = false
    group.add(mesh)
    tracers.push({ mesh, age: 0.07, life: 0.07 })
  }
  let nextTracer = 0
  const from = new THREE.Vector3()
  const to = new THREE.Vector3()
  return {
    group,
    tracer(start: Vec, end: Vec) {
      const live = tracers[nextTracer++ % tracers.length]!
      from.set(start.x, start.y, start.z)
      to.set(end.x, end.y, end.z)
      const length = from.distanceTo(to)
      if (length < 0.5) return
      live.mesh.position.copy(from)
      live.mesh.lookAt(to)
      live.mesh.scale.set(0.018, 0.018, length)
      live.mesh.visible = true
      live.age = 0
    },
    puff(point: Vec, kind: keyof typeof puffs) {
      particles.emit({ ...puffs[kind], position: point })
    },
    flash(at: Vec) {
      flash.position.set(at.x, at.y, at.z)
      flashAge = 0
    },
    update(dt: number) {
      particles.advance(dt)
      flashAge += dt
      flash.intensity = flashAge < 0.05 ? 7 * (1 - flashAge / 0.05) : 0
      for (const live of tracers) {
        if (!live.mesh.visible) continue
        live.age += dt
        const material = live.mesh.material as THREE.MeshBasicMaterial
        material.opacity = Math.max(0, 1 - live.age / live.life)
        if (live.age > live.life) live.mesh.visible = false
      }
    },
    dispose() {
      tracerGeometry.dispose()
      particles.dispose()
      for (const live of tracers) (live.mesh.material as THREE.Material).dispose()
    },
  }
}

export type Effects = ReturnType<typeof createEffects>

export function EffectsLayer({ effects }: { effects: Effects }) {
  const scene = useThree(state => state.scene)
  useEffect(() => {
    scene.add(effects.group)
    return () => { scene.remove(effects.group) }
  }, [scene, effects])
  useFrame((_, dt) => effects.update(Math.min(dt, 0.1)), 0.9)
  return null
}

export function useEffects() {
  const effects = useMemo(createEffects, [])
  useEffect(() => () => effects.dispose(), [effects])
  return effects
}
