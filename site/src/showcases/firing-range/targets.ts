import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { surface } from '../../look/look'
import type { Solid } from './hits'
import { rangeMaterial } from './materials'

export type SteelKind = 'popper' | 'gong'

export type Steel = {
  id: string
  kind: SteelKind
  points: number
  pitch: number
  position: THREE.Vector3
  solids: Solid[]
  plate: THREE.Object3D
  cleared: boolean
  down: boolean
  hit(local: THREE.Vector3, strength: number): void
  update(dt: number): void
  reset(): void
}

let splashTexture: THREE.Texture | null = null
function splash() {
  if (splashTexture) return splashTexture
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')!
  context.translate(size / 2, size / 2)
  for (let index = 0; index < 18; index++) {
    const angle = Math.random() * Math.PI * 2
    const length = size * (0.18 + Math.random() * 0.3)
    context.strokeStyle = `rgba(206,204,196,${0.5 + Math.random() * 0.5})`
    context.lineWidth = 1 + Math.random() * 2.5
    context.beginPath()
    context.moveTo(0, 0)
    context.lineTo(Math.cos(angle) * length, Math.sin(angle) * length)
    context.stroke()
  }
  const core = context.createRadialGradient(0, 0, 0, 0, 0, size * 0.2)
  core.addColorStop(0, 'rgba(120,120,116,1)')
  core.addColorStop(0.45, 'rgba(214,212,204,1)')
  core.addColorStop(1, 'rgba(214,212,204,0)')
  context.fillStyle = core
  context.beginPath()
  context.arc(0, 0, size * 0.2, 0, Math.PI * 2)
  context.fill()
  splashTexture = new THREE.CanvasTexture(canvas)
  splashTexture.colorSpace = THREE.SRGBColorSpace
  return splashTexture
}

const splashGeometry = new THREE.PlaneGeometry(1, 1)
let splashMaterial: THREE.MeshStandardMaterial | null = null

function marks(plate: THREE.Object3D, depth: number) {
  splashMaterial ??= new THREE.MeshStandardMaterial({ map: splash(), transparent: true, depthWrite: false, roughness: 0.4, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -4 })
  const pool: THREE.Mesh[] = []
  let next = 0
  return {
    add(local: THREE.Vector3) {
      let mark = pool[next]
      if (!mark) { mark = new THREE.Mesh(splashGeometry, splashMaterial!); mark.renderOrder = 3; plate.add(mark); pool[next] = mark }
      next = (next + 1) % 10
      mark.position.set(local.x, local.y, depth + 0.0015)
      mark.rotation.set(0, 0, Math.random() * Math.PI * 2)
      mark.scale.setScalar(0.05 + Math.random() * 0.03)
      mark.visible = true
    },
    clear() { for (const mark of pool) mark.visible = false },
  }
}

function popperGeometry() {
  const shape = new THREE.Shape()
  shape.moveTo(-0.15, 0)
  shape.lineTo(0.15, 0)
  shape.lineTo(0.09, 0.5)
  shape.lineTo(0.06, 0.56)
  shape.absarc(0, 0.68, 0.14, -Math.PI * 0.35, Math.PI * 1.35, false)
  shape.lineTo(-0.09, 0.5)
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false, curveSegments: 10 })
  geometry.translate(0, 0, -0.006)
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
  for (let index = 0; index < uv.count; index++) uv.setXY(index, uv.getX(index) / 0.7, uv.getY(index) / 0.7)
  return geometry
}

export function buildSteel() {
  const group = new THREE.Group()
  group.name = 'steel'
  const steel: Steel[] = []
  const frame = surface('metal', { color: '#45473f' })
  const plateBase = rangeMaterial('plate')
  const tinted = (color: string) => { const material = plateBase.clone(); material.color.set(color); return material }
  const frameParts: THREE.BufferGeometry[] = []
  const frameSolids: Solid[] = []
  const bar = (size: [number, number, number], at: [number, number, number]) => {
    const geometry = new THREE.BoxGeometry(...size)
    geometry.translate(...at)
    frameParts.push(geometry)
    const matrix = new THREE.Matrix4().makeTranslation(...at)
    frameSolids.push({ id: `frame:${frameSolids.length}`, surface: 'metal', shape: 'box', half: new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2), matrix, inverse: matrix.clone().invert() })
  }

  const popperShape = popperGeometry()
  const popperMaterial = tinted('#efe6cf')
  for (let index = 0; index < 5; index++) {
    const x = -1.6 + index * 0.8
    const z = -15
    bar([0.42, 0.06, 0.34], [x, 0.03, z - 0.05])
    bar([0.05, 0.22, 0.05], [x, 0.14, z - 0.16])
    const hinge = new THREE.Group()
    hinge.position.set(x, 0.24, z)
    const plate = new THREE.Mesh(popperShape, popperMaterial)
    plate.castShadow = true
    plate.receiveShadow = true
    hinge.add(plate)
    const head = new THREE.Object3D()
    head.position.set(0, 0.68, 0)
    plate.add(head)
    group.add(hinge)
    const body: Solid = { id: `popper-${index}`, surface: 'steel', shape: 'box', half: new THREE.Vector3(0.12, 0.28, 0.006), matrix: new THREE.Matrix4(), inverse: new THREE.Matrix4(), object: plate, targetId: `popper-${index}` }
    const top: Solid = { id: `popper-${index}`, surface: 'steel', shape: 'box', half: new THREE.Vector3(0.14, 0.14, 0.006), matrix: new THREE.Matrix4(), inverse: new THREE.Matrix4(), object: head, disc: 0.14, targetId: `popper-${index}` }
    const bodyOffset = new THREE.Object3D()
    bodyOffset.position.set(0, 0.28, 0)
    plate.add(bodyOffset)
    body.object = bodyOffset
    const splashes = marks(plate, 0.006)
    let angle = 0
    let velocity = 0
    let raising = 0
    const target: Steel = {
      id: `popper-${index}`, kind: 'popper', points: 10, pitch: 1.35 + index * 0.06, position: new THREE.Vector3(x, 0.7, z), solids: [body, top], plate, cleared: false, down: false,
      hit(local, strength) {
        splashes.add(local)
        if (target.down || raising > 0) return
        target.down = true
        velocity = -1.8 - strength * 1.6
      },
      update(dt) {
        if (raising > 0) {
          raising = Math.max(0, raising - dt)
          const t = 1 - raising / 0.45
          angle = -Math.PI / 2 * (1 - t * t * (3 - 2 * t))
          if (raising === 0) { angle = 0; velocity = 0 }
        } else if (target.down) {
          velocity -= 14 * Math.sin(-angle + 0.08) * dt
          angle += velocity * dt
          if (angle < -Math.PI / 2 + 0.06) { angle = -Math.PI / 2 + 0.06; velocity = Math.abs(velocity) > 0.6 ? -velocity * 0.28 : 0 }
        }
        hinge.rotation.x = angle
      },
      reset() {
        splashes.clear()
        target.cleared = false
        if (target.down) { target.down = false; raising = 0.45 }
      },
    }
    steel.push(target)
  }

  const gong = (id: string, x: number, y: number, z: number, shape: 'disc' | 'square', size: number, chain: number, color: string, points: number, pitch: number) => {
    const pivot = new THREE.Group()
    pivot.position.set(x, y, z)
    group.add(pivot)
    const geometry = shape === 'disc' ? new THREE.CylinderGeometry(size, size, 0.014, 28) : new THREE.BoxGeometry(size * 2, size * 2, 0.014)
    if (shape === 'disc') geometry.rotateX(Math.PI / 2)
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
    for (let index = 0; index < uv.count; index++) uv.setXY(index, uv.getX(index) * size * 2 / 0.7, uv.getY(index) * size * 2 / 0.7)
    const plate = new THREE.Mesh(geometry, tinted(color))
    plate.position.y = -chain - size
    plate.castShadow = true
    plate.receiveShadow = true
    pivot.add(plate)
    const chainMaterial = surface('metal', { color: '#2f302b', ao: false })
    for (const side of [-1, 1]) {
      const link = new THREE.Mesh(new THREE.BoxGeometry(0.012, chain + size * 0.6, 0.012), chainMaterial)
      link.position.set(side * size * 0.55, -(chain + size * 0.6) / 2, 0)
      link.castShadow = true
      pivot.add(link)
    }
    const solid: Solid = { id, surface: 'steel', shape: 'box', half: new THREE.Vector3(size, size, 0.007), matrix: new THREE.Matrix4(), inverse: new THREE.Matrix4(), object: plate, targetId: id, ...(shape === 'disc' ? { disc: size } : {}) }
    const splashes = marks(plate, 0.007)
    const length = chain + size
    const inertia = (size / 0.22) ** 2
    let swing = 0
    let swingVelocity = 0
    let twist = 0
    let twistVelocity = 0
    const target: Steel = {
      id, kind: 'gong', points, pitch, position: new THREE.Vector3(x, y - length, z), solids: [solid], plate, cleared: false, down: false,
      hit(local, strength) {
        splashes.add(local)
        swingVelocity += strength * 1.5 / inertia
        twistVelocity += -local.x / size * strength * 1.4 / inertia
      },
      update(dt) {
        const step = Math.min(dt, 1 / 30)
        swingVelocity += (-9.81 / length * Math.sin(swing) - 0.55 * swingVelocity) * step
        swing += swingVelocity * step
        twistVelocity += (-38 * twist - 1.6 * twistVelocity) * step
        twist += twistVelocity * step
        pivot.rotation.set(swing, twist, 0)
      },
      reset() { splashes.clear(); target.cleared = false },
    }
    steel.push(target)
    return target
  }

  bar([0.08, 2.0, 0.08], [3.2, 1.0, -25])
  bar([0.08, 2.0, 0.08], [6.8, 1.0, -25])
  bar([3.8, 0.08, 0.08], [5.0, 2.0, -25])
  gong('gong-a', 3.9, 1.96, -25, 'disc', 0.24, 0.42, '#e9dfc6', 15, 0.95)
  gong('gong-b', 5.0, 1.96, -25, 'square', 0.2, 0.36, '#d48a3a', 15, 1.12)
  gong('gong-c', 6.1, 1.96, -25, 'disc', 0.16, 0.5, '#e9dfc6', 20, 1.42)

  bar([0.1, 2.4, 0.1], [-1.1, 1.2, -50])
  bar([0.1, 2.4, 0.1], [1.1, 1.2, -50])
  bar([2.3, 0.1, 0.1], [0, 2.4, -50])
  gong('gong-far', 0, 2.36, -50, 'disc', 0.42, 0.5, '#c65a30', 50, 0.62)

  const frameMesh = new THREE.Mesh(mergeGeometries(frameParts.map(part => part.index ? part.toNonIndexed() : part), false), frame)
  frameMesh.castShadow = true
  frameMesh.receiveShadow = true
  group.add(frameMesh)

  return { group, steel, solids: [...steel.flatMap(target => target.solids), ...frameSolids] }
}
