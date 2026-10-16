import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

type Vec = { x: number; y: number; z: number }
type Live = { mesh: THREE.Mesh; age: number; life: number; grow: number }

let puffTexture: THREE.Texture | null = null
function puff() {
  if (puffTexture) return puffTexture
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, '#ffffffff')
  gradient.addColorStop(0.35, '#ffffff99')
  gradient.addColorStop(1, '#ffffff00')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  puffTexture = new THREE.CanvasTexture(canvas)
  return puffTexture
}

export function createEffects() {
  const group = new THREE.Group()
  group.name = 'shot-effects'
  const tracerGeometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5)
  const quad = new THREE.PlaneGeometry(1, 1)
  const tracers: Live[] = []
  const puffs: Live[] = []
  const flash = new THREE.PointLight('#ffc27a', 0, 9, 2)
  group.add(flash)
  let flashAge = 1
  const tracerMaterial = () => {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3.6, 1.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true })
    return material
  }
  for (let index = 0; index < 18; index++) {
    const mesh = new THREE.Mesh(tracerGeometry, tracerMaterial())
    mesh.frustumCulled = false
    group.add(mesh)
    tracers.push({ mesh, age: 0.07, life: 0.07, grow: 0 })
  }
  for (let index = 0; index < 24; index++) {
    const mesh = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({ map: puff(), transparent: true, depthWrite: false, fog: true, blending: index % 2 ? THREE.AdditiveBlending : THREE.NormalBlending }))
    mesh.frustumCulled = false
    group.add(mesh)
    puffs.push({ mesh, age: 0.4, life: 0.4, grow: 1 })
  }
  let nextTracer = 0
  let nextPuff = 0
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
    puff(point: Vec, kind: 'dust' | 'blood' | 'spark') {
      const live = puffs[nextPuff++ % puffs.length]!
      const material = live.mesh.material as THREE.MeshBasicMaterial
      material.color.set(kind === 'blood' ? '#5e1712' : kind === 'spark' ? '#d8c9a8' : '#8f8a7b')
      material.blending = kind === 'spark' ? THREE.AdditiveBlending : THREE.NormalBlending
      live.mesh.position.set(point.x, point.y, point.z)
      live.mesh.visible = true
      live.age = 0
      live.life = kind === 'blood' ? 0.45 : kind === 'spark' ? 0.12 : 0.6
      live.grow = kind === 'blood' ? 0.9 : kind === 'spark' ? 0.25 : 0.7
    },
    flash(at: Vec) {
      flash.position.set(at.x, at.y, at.z)
      flashAge = 0
    },
    update(dt: number, camera: THREE.Camera) {
      flashAge += dt
      flash.intensity = flashAge < 0.05 ? 7 * (1 - flashAge / 0.05) : 0
      for (const live of tracers) {
        if (!live.mesh.visible) continue
        live.age += dt
        const material = live.mesh.material as THREE.MeshBasicMaterial
        material.opacity = Math.max(0, 1 - live.age / live.life)
        if (live.age > live.life) live.mesh.visible = false
      }
      for (const live of puffs) {
        if (!live.mesh.visible) continue
        live.age += dt
        const t = Math.min(1, live.age / live.life)
        const material = live.mesh.material as THREE.MeshBasicMaterial
        material.opacity = Math.max(0, 0.85 * (1 - t))
        live.mesh.scale.setScalar(0.12 + live.grow * Math.sqrt(t))
        live.mesh.quaternion.copy(camera.quaternion)
        if (live.age > live.life) live.mesh.visible = false
      }
    },
    dispose() {
      tracerGeometry.dispose()
      quad.dispose()
      for (const live of [...tracers, ...puffs]) (live.mesh.material as THREE.Material).dispose()
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
  useFrame(({ camera }, dt) => effects.update(Math.min(dt, 0.1), camera), 0.9)
  return null
}

export function useEffects() {
  const effects = useMemo(createEffects, [])
  useEffect(() => () => effects.dispose(), [effects])
  return effects
}
