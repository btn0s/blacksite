import * as THREE from 'three'
import { SoftParticles } from '@blacksite/look/soft'
import type { Surface } from './hits'

type Decal = 'hole' | 'paper' | 'scuff'

const dustTint: Record<Surface, string> = { concrete: '#b3ad9c', metal: '#8f8b80', wood: '#a48d68', dirt: '#857659', canvas: '#a29674', paper: '#d6ccb0', steel: '#a8a69c' }
const sparkTint = new THREE.Color(1, 0.55, 0.18)
const chipTint: Record<Surface, string> = { concrete: '#9e998a', metal: '#5a5b54', wood: '#a58b5f', dirt: '#5e5440', canvas: '#8b8064', paper: '#d9cfb4', steel: '#bdbbb2' }
const decalOf: Record<Surface, Decal | null> = { concrete: 'hole', metal: 'hole', wood: 'hole', dirt: 'scuff', canvas: 'hole', paper: 'paper', steel: null }
const decalSize: Record<Decal, [number, number]> = { hole: [0.05, 0.035], paper: [0.016, 0.006], scuff: [0.11, 0.06] }

function canvasTexture(size: number, draw: (context: CanvasRenderingContext2D, size: number) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')!
  draw(context, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function blob(context: CanvasRenderingContext2D, radius: number, jag: number, points = 14) {
  context.beginPath()
  for (let index = 0; index <= points; index++) {
    const angle = index / points * Math.PI * 2
    const r = radius * (1 - jag + Math.random() * jag * 2)
    if (index === 0) context.moveTo(Math.cos(angle) * r, Math.sin(angle) * r)
    else context.lineTo(Math.cos(angle) * r, Math.sin(angle) * r)
  }
  context.closePath()
}

const decalTextures: Record<Decal, () => THREE.Texture> = {
  hole: () => canvasTexture(64, (context, size) => {
    context.translate(size / 2, size / 2)
    context.fillStyle = 'rgba(232,228,214,0.55)'
    blob(context, size * 0.46, 0.35, 18)
    context.fill()
    context.fillStyle = 'rgba(120,114,100,0.85)'
    blob(context, size * 0.3, 0.3)
    context.fill()
    context.fillStyle = 'rgba(18,16,13,1)'
    blob(context, size * 0.15, 0.25)
    context.fill()
  }),
  paper: () => canvasTexture(32, (context, size) => {
    context.translate(size / 2, size / 2)
    context.fillStyle = 'rgba(90,82,66,0.6)'
    blob(context, size * 0.48, 0.2)
    context.fill()
    context.fillStyle = 'rgba(10,10,8,1)'
    blob(context, size * 0.36, 0.15)
    context.fill()
  }),
  scuff: () => canvasTexture(64, (context, size) => {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(30,26,20,0.95)')
    gradient.addColorStop(0.35, 'rgba(48,42,32,0.7)')
    gradient.addColorStop(1, 'rgba(60,52,40,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
  }),
}

const forward = new THREE.Vector3(0, 0, 1)
const scratch = { matrix: new THREE.Matrix4(), quaternion: new THREE.Quaternion(), roll: new THREE.Quaternion(), position: new THREE.Vector3(), scale: new THREE.Vector3(), color: new THREE.Color(), vector: new THREE.Vector3() }

export function createEffects(scene: THREE.Scene) {
  const root = new THREE.Group()
  root.name = 'effects'
  scene.add(root)

  const decals = Object.fromEntries((Object.keys(decalTextures) as Decal[]).map(kind => {
    const count = kind === 'paper' ? 80 : 160
    const material = new THREE.MeshStandardMaterial({ map: decalTextures[kind](), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count)
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.renderOrder = 2
    mesh.receiveShadow = true
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    for (let index = 0; index < count; index++) mesh.setColorAt(index, scratch.color.set('#ffffff'))
    root.add(mesh)
    return [kind, { mesh, next: 0, capacity: count }]
  })) as unknown as Record<Decal, { mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>; next: number; capacity: number }>

  const particles = new SoftParticles({ capacity: 400 })
  root.add(particles)

  const tracerCount = 12
  const tracerPositions = new Float32Array(tracerCount * 6)
  const tracerColors = new Float32Array(tracerCount * 6)
  const tracerGeometry = new THREE.BufferGeometry()
  tracerGeometry.setAttribute('position', new THREE.BufferAttribute(tracerPositions, 3).setUsage(THREE.DynamicDrawUsage))
  tracerGeometry.setAttribute('color', new THREE.BufferAttribute(tracerColors, 3).setUsage(THREE.DynamicDrawUsage))
  const tracerLines = new THREE.LineSegments(tracerGeometry, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, fog: false }))
  tracerLines.frustumCulled = false
  root.add(tracerLines)
  const tracers = Array.from({ length: tracerCount }, () => ({ alive: false, from: new THREE.Vector3(), to: new THREE.Vector3(), travelled: 0, length: 0 }))
  let tracerNext = 0

  const chipCount = 180
  const chipMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 1 }), chipCount)
  chipMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  chipMesh.frustumCulled = false
  chipMesh.castShadow = false
  root.add(chipMesh)
  const chips = Array.from({ length: chipCount }, () => ({ life: 0, max: 1, position: new THREE.Vector3(), velocity: new THREE.Vector3(), spin: new THREE.Vector3(), rotation: new THREE.Euler(), size: 0.02 }))
  let chipNext = 0
  for (let index = 0; index < chipCount; index++) { chipMesh.setMatrixAt(index, scratch.matrix.makeScale(0, 0, 0)); chipMesh.setColorAt(index, scratch.color.set('#888888')) }

  const casingCount = 40
  const casingGeometry = new THREE.CylinderGeometry(0.0048, 0.0048, 0.044, 8)
  casingGeometry.rotateZ(Math.PI / 2)
  const casingMesh = new THREE.InstancedMesh(casingGeometry, new THREE.MeshStandardMaterial({ color: '#b8904f', metalness: 0.85, roughness: 0.32 }), casingCount)
  casingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  casingMesh.frustumCulled = false
  root.add(casingMesh)
  const casings = Array.from({ length: casingCount }, () => ({ life: 0, alive: false, position: new THREE.Vector3(), velocity: new THREE.Vector3(), rotation: new THREE.Euler(), spin: new THREE.Vector3(), resting: false, bounced: false, scale: 1 }))
  let casingNext = 0
  for (let index = 0; index < casingCount; index++) casingMesh.setMatrixAt(index, scratch.matrix.makeScale(0, 0, 0))

  const random = (min: number, max: number) => min + Math.random() * (max - min)
  const cone = (normal: THREE.Vector3, spread: number, target: THREE.Vector3) => {
    target.set(random(-1, 1), random(-1, 1), random(-1, 1)).normalize().multiplyScalar(spread).add(normal).normalize()
    return target
  }

  function decal(surface: Surface, point: THREE.Vector3, normal: THREE.Vector3) {
    const kind = decalOf[surface]
    if (!kind) return
    const pool = decals[kind]
    const [base, variance] = decalSize[kind]
    scratch.quaternion.setFromUnitVectors(forward, normal)
    scratch.roll.setFromAxisAngle(forward, Math.random() * Math.PI * 2)
    scratch.quaternion.multiply(scratch.roll)
    scratch.position.copy(point).addScaledVector(normal, 0.002)
    const size = base + Math.random() * variance
    scratch.scale.set(size, size, size)
    pool.mesh.setMatrixAt(pool.next, scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale))
    pool.mesh.setColorAt(pool.next, scratch.color.set(surface === 'metal' ? '#9aa0a0' : surface === 'wood' ? '#d8b98a' : surface === 'canvas' ? '#c9bd98' : '#ffffff'))
    pool.next = (pool.next + 1) % pool.capacity
    pool.mesh.count = Math.max(pool.mesh.count, pool.next === 0 ? pool.capacity : pool.next)
    pool.mesh.instanceMatrix.needsUpdate = true
    if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true
  }

  function spark(point: THREE.Vector3, normal: THREE.Vector3, count: number, speed: number) {
    for (let index = 0; index < count; index++) {
      particles.emit({ position: point, velocity: cone(normal, 0.9, scratch.vector).multiplyScalar(speed * random(0.35, 1)), acceleration: { x: 0, y: -9.8, z: 0 }, drag: 1.5, life: random(0.12, 0.42), size: 0.02, tint: sparkTint, glow: random(0.7, 1.3), stretch: 0.02 })
    }
  }

  function puff(point: THREE.Vector3, normal: THREE.Vector3, surface: Surface, scale: number) {
    for (let index = 0; index < 2; index++) {
      const reach = 0.12 + random(0.5, 0.9) * scale
      particles.emit({
        position: scratch.position.copy(point).addScaledVector(normal, 0.05),
        velocity: scratch.vector.copy(normal).multiplyScalar(random(0.5, 1.4) * scale).add({ x: random(-0.2, 0.2), y: random(0.1, 0.4), z: random(-0.2, 0.2) }),
        acceleration: { x: 0, y: 0.25, z: 0 },
        drag: 2.6,
        life: random(0.7, 1.3) * scale,
        size: reach * 0.3,
        grow: 2.3,
        opacity: surface === 'dirt' ? 0.75 : 0.6,
        tint: scratch.color.set(dustTint[surface]),
      })
    }
  }

  function chip(point: THREE.Vector3, normal: THREE.Vector3, surface: Surface, count: number) {
    for (let index = 0; index < count; index++) {
      const item = chips[chipNext]!
      chipMesh.setColorAt(chipNext, scratch.color.set(chipTint[surface]).multiplyScalar(random(0.75, 1.15)))
      chipNext = (chipNext + 1) % chipCount
      item.position.copy(point).addScaledVector(normal, 0.01)
      cone(normal, 0.8, item.velocity).multiplyScalar(random(1.5, 5))
      item.spin.set(random(-20, 20), random(-20, 20), random(-20, 20))
      item.size = surface === 'paper' ? random(0.006, 0.012) : random(0.008, 0.024)
      item.max = item.life = random(1.4, 2.4)
    }
    if (chipMesh.instanceColor) chipMesh.instanceColor.needsUpdate = true
  }

  return {
    impact(surface: Surface, point: THREE.Vector3, normal: THREE.Vector3, power: number) {
      decal(surface, point, normal)
      if (surface === 'steel') { spark(point, normal, 16 + Math.round(power * 10), 7); puff(point, normal, surface, 0.45); return }
      if (surface === 'metal') { spark(point, normal, 8, 5); chip(point, normal, surface, 3); puff(point, normal, surface, 0.5); return }
      if (surface === 'paper') { chip(point, normal.clone().negate(), 'wood', 4); chip(point, normal, surface, 2); return }
      chip(point, normal, surface, surface === 'dirt' ? 6 : 9)
      puff(point, normal, surface, surface === 'dirt' ? 1.25 : 0.9)
    },
    tracer(from: THREE.Vector3, to: THREE.Vector3) {
      const item = tracers[tracerNext]!
      tracerNext = (tracerNext + 1) % tracerCount
      item.alive = true
      item.from.copy(from)
      item.to.copy(to)
      item.length = from.distanceTo(to)
      item.travelled = 0
    },
    eject(camera: THREE.Camera, pistol: boolean) {
      const item = casings[casingNext]!
      casingNext = (casingNext + 1) % casingCount
      const right = scratch.vector.set(1, 0, 0).applyQuaternion(camera.quaternion)
      item.position.copy(camera.position).addScaledVector(right, 0.12).add(new THREE.Vector3(0, -0.08, 0)).add(new THREE.Vector3(0, 0, -0.3).applyQuaternion(camera.quaternion))
      item.velocity.copy(right).multiplyScalar(random(1.6, 2.6)).add(new THREE.Vector3(random(-0.3, 0.3), random(1.4, 2.2), random(-0.2, 0.4)))
      item.spin.set(random(-25, 25), random(-30, 30), random(-25, 25))
      item.rotation.set(0, camera.rotation.y + Math.PI / 2, 0)
      item.alive = true
      item.resting = false
      item.bounced = false
      item.life = 9
      item.scale = pistol ? 0.62 : 1
    },
    update(dt: number, onCasing: (position: THREE.Vector3) => void) {
      const step = Math.min(dt, 1 / 30)
      particles.advance(step)

      for (let index = 0; index < tracerCount; index++) {
        const item = tracers[index]!
        const offset = index * 6
        if (!item.alive) { tracerPositions.fill(0, offset, offset + 6); continue }
        item.travelled += 520 * step
        const head = Math.min(item.travelled, item.length)
        const tail = Math.max(0, item.travelled - 5)
        if (tail >= item.length) { item.alive = false; tracerPositions.fill(0, offset, offset + 6); continue }
        scratch.vector.subVectors(item.to, item.from).divideScalar(item.length || 1)
        tracerPositions[offset] = item.from.x + scratch.vector.x * head
        tracerPositions[offset + 1] = item.from.y + scratch.vector.y * head
        tracerPositions[offset + 2] = item.from.z + scratch.vector.z * head
        tracerPositions[offset + 3] = item.from.x + scratch.vector.x * tail
        tracerPositions[offset + 4] = item.from.y + scratch.vector.y * tail
        tracerPositions[offset + 5] = item.from.z + scratch.vector.z * tail
        tracerColors.set([9, 6.5, 3, 1.2, 0.5, 0.15], offset)
      }
      tracerGeometry.attributes.position!.needsUpdate = true
      tracerGeometry.attributes.color!.needsUpdate = true

      let chipsChanged = false
      for (let index = 0; index < chipCount; index++) {
        const item = chips[index]!
        if (item.life <= 0) continue
        chipsChanged = true
        item.life -= step
        item.velocity.y -= 9.8 * step
        item.position.addScaledVector(item.velocity, step)
        if (item.position.y < item.size / 2) { item.position.y = item.size / 2; item.velocity.y *= -0.3; item.velocity.x *= 0.6; item.velocity.z *= 0.6; item.spin.multiplyScalar(0.5) }
        item.rotation.x += item.spin.x * step
        item.rotation.y += item.spin.y * step
        item.rotation.z += item.spin.z * step
        const size = item.life <= 0 ? 0 : item.size * Math.min(1, item.life * 3)
        scratch.quaternion.setFromEuler(item.rotation)
        chipMesh.setMatrixAt(index, scratch.matrix.compose(item.position, scratch.quaternion, scratch.scale.set(size, size * 0.6, size * 0.8)))
      }
      if (chipsChanged) chipMesh.instanceMatrix.needsUpdate = true

      let casingsChanged = false
      for (let index = 0; index < casingCount; index++) {
        const item = casings[index]!
        if (!item.alive) continue
        casingsChanged = true
        item.life -= step
        if (item.life <= 0) { item.alive = false; casingMesh.setMatrixAt(index, scratch.matrix.makeScale(0, 0, 0)); continue }
        if (!item.resting) {
          item.velocity.y -= 9.8 * step
          item.position.addScaledVector(item.velocity, step)
          item.rotation.x += item.spin.x * step
          item.rotation.y += item.spin.y * step
          item.rotation.z += item.spin.z * step
          const onBench = Math.abs(item.position.x) < 9.3 && item.position.z > -1.48 && item.position.z < -0.76
          const floor = onBench ? 1.02 : 0.03
          if (item.position.y < floor && item.velocity.y < 0) {
            item.position.y = floor
            if (!item.bounced || Math.abs(item.velocity.y) > 0.8) onCasing(item.position)
            item.bounced = true
            item.velocity.y *= -0.35
            item.velocity.x *= 0.5
            item.velocity.z *= 0.5
            item.spin.multiplyScalar(0.4)
            if (Math.abs(item.velocity.y) < 0.35) { item.resting = true; item.rotation.x = Math.PI / 2 * Math.round(item.rotation.x / (Math.PI / 2)); item.rotation.z = 0 }
          }
        }
        const scale = item.scale * Math.min(1, item.life * 2)
        scratch.quaternion.setFromEuler(item.rotation)
        casingMesh.setMatrixAt(index, scratch.matrix.compose(item.position, scratch.quaternion, scratch.scale.set(scale, scale, scale)))
      }
      if (casingsChanged) casingMesh.instanceMatrix.needsUpdate = true
    },
    dispose() {
      particles.dispose()
    },
  }
}

export type Effects = ReturnType<typeof createEffects>
