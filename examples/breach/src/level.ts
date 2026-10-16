import * as THREE from 'three'
import { LevelBuilder, apartmentBlock, apc, deadTree, groundMaterial, lada, puddleMaterial, surface, waterTower, worldBoxGeometry, worldPlaneGeometry, type SurfaceName } from '@blacksite/look/world'
import { APC_AT, BOUNCES, EXFIL, LEVEL, PATCHES, PRACTICALS, ROOMS, SHAFTS, roomAt, type Block, type Practical, type Room, type Vec3 } from './layout'
import type { RoomId } from './model'

export type BreachLevel = {
  group: THREE.Group
  heroes: Map<string, THREE.Mesh>
  practicals: Array<{ light: THREE.PointLight; room: RoomId; base: number; kind: Practical['kind'] }>
  update(time: number, dt: number, visibleRooms: ReadonlySet<RoomId>): void
  dispose(): void
}

type Paint = { name: SurfaceName; color?: string; ao?: false }
type Motes = { points: THREE.Points; room: RoomId; base: Float32Array; speed: Float32Array; height: number; bottom: number; range: number }

const LIGHTS: Record<Practical['kind'], { color: string; intensity: number; distance: number; lift: number }> = {
  bulb: { color: '#ffcf8a', intensity: 6, distance: 7, lift: 0 },
  tube: { color: '#d8e6ff', intensity: 14, distance: 9, lift: -0.08 },
  fire: { color: '#ff8a3a', intensity: 5, distance: 5.5, lift: 0.35 },
  emergency: { color: '#ff3020', intensity: 3, distance: 5, lift: 0 },
}

const hash = (n: number) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s) }
const noise = (x: number) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u }

function flicker(kind: Practical['kind'], time: number, seed: number) {
  if (kind === 'fire') return 1 + 0.18 * ((noise(time * 4.2 + seed) * 0.65 + noise(time * 9.7 + seed * 3.1) * 0.35) * 2 - 1)
  if (kind === 'bulb') return 1 + 0.03 * (noise(time * 0.5 + seed) * 2 - 1)
  if (kind === 'emergency') return 0.94 + 0.06 * Math.sin(time * 1.6 + seed)
  return 1
}

function floorOf(room: Room): Paint | null {
  if (room.floor === 'dirt' || room.floor === 'water') return null
  if (room.floor === 'wood') return { name: 'paint', color: '#4f3f2f', ao: false }
  if (room.floor === 'metal') return { name: 'metal', color: '#5a5d54', ao: false }
  return room.id === 'hall' ? { name: 'slab', color: '#8f8b7e', ao: false } : { name: 'cast', color: '#9a968a', ao: false }
}

function texture(width: number, height: number, texel: (u: number, v: number) => [number, number, number, number]) {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = texel((x + 0.5) / width, (y + 0.5) / height)
    for (let c = 0; c < 4; c++) data[(y * width + x) * 4 + c] = Math.round(Math.max(0, Math.min(1, value[c]!)) * 255)
  }
  const map = new THREE.DataTexture(data, width, height)
  map.magFilter = map.minFilter = THREE.LinearFilter
  map.needsUpdate = true
  return map
}

function merge(geometries: THREE.BufferGeometry[]) {
  const parts = geometries.map(item => item.index ? item.toNonIndexed() : item)
  const merged = new THREE.BufferGeometry()
  for (const name of Object.keys(parts[0]!.attributes)) {
    const size = parts[0]!.getAttribute(name).itemSize
    merged.setAttribute(name, new THREE.Float32BufferAttribute(parts.flatMap(part => Array.from(part.getAttribute(name).array as Float32Array)), size))
  }
  for (const item of new Set([...geometries, ...parts])) item.dispose()
  merged.computeBoundingSphere()
  return merged
}

function crossed(width: number, height: number, count: number) {
  return merge(Array.from({ length: count }, (_, index) => new THREE.PlaneGeometry(width, height).translate(0, height / 2, 0).rotateY(index * Math.PI / count)))
}

const sizeOf = (block: Block): Vec3 => [block.max[0] - block.min[0], block.max[1] - block.min[1], block.max[2] - block.min[2]]
const centerOf = (block: Block): Vec3 => [(block.min[0] + block.max[0]) / 2, (block.min[1] + block.max[1]) / 2, (block.min[2] + block.max[2]) / 2]
const roomOf = (id: RoomId) => ROOMS.find(room => room.id === id)!
const rgbOf = (hex: string) => { const digits = hex.length === 4 ? [...hex.slice(1)].map(c => c + c).join('') : hex.slice(1, 7); return [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16) / 255) }

function palette(tolerance: number) {
  const swatches = new Map<SurfaceName, string[]>()
  return (name: SurfaceName, color?: string): Paint => {
    if (!color) return { name }
    const list = swatches.get(name) ?? []
    swatches.set(name, list)
    const [r, g, b] = rgbOf(color)
    const near = list.find(swatch => { const [sr, sg, sb] = rgbOf(swatch); return Math.hypot(r! - sr!, g! - sg!, b! - sb!) <= tolerance })
    if (near) return { name, color: near }
    list.push(color)
    return { name, color }
  }
}

function still<T extends THREE.Object3D>(object: T) {
  object.updateMatrix()
  object.matrixAutoUpdate = false
  return object
}

export function buildLevel(options: { quality: 'low' | 'medium' | 'high'; phone: boolean }): BreachLevel {
  const level = new LevelBuilder()
  const group = new THREE.Group()
  group.name = 'breach-level'
  const heroes = new Map<string, THREE.Mesh>()
  const owned: Array<{ dispose(): void }> = []
  const tint = palette(options.phone || options.quality === 'low' ? 0.12 : options.quality === 'medium' ? 0.07 : 0.04)
  const own = <T extends { dispose(): void }>(item: T) => { owned.push(item); return item }
  const basic = (color: string, boost = 1) => own(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(boost), fog: true }))
  const add = <T extends THREE.Object3D>(object: T, parent: THREE.Object3D = group) => { parent.add(still(object)); return object }

  const ground = new THREE.Mesh(worldPlaneGeometry(300, 300, 4), groundMaterial())
  ground.receiveShadow = true
  ground.name = 'ground'
  add(ground)

  ROOMS.forEach((room, index) => {
    const paint = floorOf(room)
    if (!paint) return
    const width = room.max[0] - room.min[0] + 0.5, depth = room.max[1] - room.min[1] + 0.5
    level.plane(width, depth, paint, { at: [(room.min[0] + room.max[0]) / 2, 0.006 + index * 0.0012, (room.min[1] + room.max[1]) / 2] })
  })

  const asphalt: Paint = { name: 'asphalt', color: '#76766e', ao: false }
  PATCHES.forEach((patch, index) => {
    const width = patch.max[0] - patch.min[0], depth = patch.max[1] - patch.min[1]
    const at: Vec3 = [(patch.min[0] + patch.max[0]) / 2, 0.013, (patch.min[1] + patch.max[1]) / 2]
    if (patch.footing === 'concrete') level.plane(width, depth, asphalt, { at })
    else if (patch.footing === 'rubble') level.plane(width * 0.92, depth * 0.92, { name: 'gravel', color: '#8d877a', ao: false }, { at, rotate: (hash(index) - 0.5) * 0.3 })
    else if (patch.footing === 'metal') level.box([width, 0.02, depth], { name: 'metal', color: '#55584f', ao: false }, { at: [at[0], 0.01, at[2]], collide: false, cast: false, shadow: false })
  })
  level.plane(7, 120, asphalt, { at: [0.5, 0.013, 90] })

  const puddles = PATCHES.filter(patch => patch.footing === 'water').flatMap((patch, index) => {
    const width = patch.max[0] - patch.min[0], depth = patch.max[1] - patch.min[1]
    const x = (patch.min[0] + patch.max[0]) / 2, z = (patch.min[1] + patch.max[1]) / 2
    return [[x, z, width, depth, 1], [x + width * 0.3, z + depth * 0.2, width * 0.55, depth * 0.6, 0.6]].map(([cx, cz, w, d, k]) =>
      new THREE.CircleGeometry(0.5, 22).rotateX(-Math.PI / 2).scale(w!, 1, d!).rotateY(hash(index + k!) * 0.8 - 0.4).translate(cx!, 0.02, cz!))
  })
  if (puddles.length) {
    const water = new THREE.Mesh(merge(puddles), own(puddleMaterial()))
    water.receiveShadow = true
    water.renderOrder = 2
    water.name = 'puddles'
    add(water)
  }

  for (const block of LEVEL.blocks) {
    const size = sizeOf(block), at = centerOf(block)
    if (block.render === false) {
      if (block.contact && block.solid) level.contact(size[0], size[2], [at[0], at[2]])
      continue
    }
    const paint = tint(block.look, block.color)
    if (block.hero) {
      const material = surface(paint.name, { color: paint.color })
      const mesh = new THREE.Mesh(worldBoxGeometry(size[0], size[1], size[2], material.userData.tile as number), material)
      mesh.position.set(...at)
      mesh.castShadow = block.cast
      mesh.receiveShadow = true
      mesh.name = block.id
      heroes.set(block.id, add(mesh))
      continue
    }
    level.box(size, paint, { at, collide: false, cast: block.cast, shadow: block.contact })
  }

  for (const item of LEVEL.decor) {
    const paint = tint(item.look, item.color)
    const place = { at: item.at, rotate: item.rotate, collide: false, cast: item.cast ?? true, shadow: false }
    if (item.kind === 'box') level.box(item.size, paint, place)
    else level.cylinder(item.size[0], item.size[1], paint, place, item.segments ?? 12)
  }

  apartmentBlock(level, { at: [-14, 0, -64], floors: 9, bays: 10, seed: 3, facing: Math.PI / 2 })
  apartmentBlock(level, { at: [42, 0, -38], floors: 6, bays: 8, seed: 9, facing: Math.PI / 4 })
  apartmentBlock(level, { at: [-26, 0, 66], floors: 7, bays: 9, seed: 21, facing: -Math.PI / 2 })
  waterTower(level, [-48, 0, -50])
  level.cylinder(1.8, 46, { name: 'brick', color: '#7a6a5f' }, { at: [58, 23, -76], collide: false }, 14)
  lada(level, [-13.5, 0, 18.5], Math.PI / 2, '#3b342d')
  lada(level, [-3.6, 0, 38], 0.35, '#55604f')
  apc(level, APC_AT, -Math.PI / 2 + 0.08)
  for (const [x, z, height, yaw] of [[-25, 16, 7, 0.3], [26, 24, 8, 1.4], [-27, 36, 6.5, 2.2], [14, 38, 7.5, 0.8], [-16, -34, 8.5, 3.1], [22, -31, 7, 1.9], [-31, -8, 9, 0.2], [30, 2, 7.2, 1.1]] as const) deadTree(level, [x, 0, z], height, yaw, false)
  for (let index = 0; index < 7; index++) {
    const x = -42 + index * 12
    level.box([0.26, 9, 0.26], { name: 'cast' }, { at: [x, 4.5, 44], collide: false, shadow: false })
    level.box([2.4, 0.16, 0.18], { name: 'cast' }, { at: [x, 8.5, 44], collide: false, cast: false, shadow: false })
  }

  const dot = own(texture(16, 16, (u, v) => { const a = Math.pow(Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) * 2), 1.8); return [a, a, a, a] }))
  const flameMap = own(texture(32, 64, (u, v) => {
    const radius = 0.9 * Math.pow(1 - v, 0.75) * Math.min(1, v * 6 + 0.4)
    const heat = Math.pow(Math.max(0, 1 - Math.abs(u - 0.5) * 2 / Math.max(radius, 1e-3)), 1.4) * Math.pow(1 - v, 0.6)
    return [heat, 0.55 * Math.pow(heat, 1.3), 0.16 * Math.pow(heat, 2.4), heat]
  }))
  const smokeMap = own(texture(16, 64, (u, v) => {
    const a = Math.pow(Math.max(0, 1 - Math.abs(u - 0.5) * 2), 2) * Math.min(1, v * 5) * Math.pow(1 - v, 1.4)
    return [1, 1, 1, a]
  }))

  const practicals: BreachLevel['practicals'] = []
  const flames: Array<{ mesh: THREE.Mesh; room: RoomId; seed: number }> = []
  const fixtures: Array<{ object: THREE.Object3D; room: RoomId }> = []
  PRACTICALS.forEach((practical, index) => {
    const spec = LIGHTS[practical.kind]
    const [x, y, z] = practical.at
    const light = new THREE.PointLight(spec.color, spec.intensity, spec.distance, 2)
    light.castShadow = false
    light.name = `practical-${practical.kind}-${index}`
    light.position.set(x, y + spec.lift, z)
    practicals.push({ light: add(light), room: practical.room, base: spec.intensity, kind: practical.kind })
    const room = roomOf(practical.room)
    if (practical.kind === 'bulb') {
      add(new THREE.Mesh(own(new THREE.SphereGeometry(0.045, 10, 8)), basic('#ffe3b0', 3))).position.set(x, y, z)
      const cord = room.ceiling - y - 0.06
      level.cylinder(0.018, 0.06, { name: 'metal', color: '#2a2a26', ao: false }, { at: [x, y + 0.06, z], collide: false, cast: false, shadow: false }, 8)
      if (cord > 0) level.cylinder(0.005, cord, { name: 'metal', color: '#1e1e1b', ao: false }, { at: [x, y + 0.06 + cord / 2, z], collide: false, cast: false, shadow: false }, 4)
    } else if (practical.kind === 'tube') {
      add(new THREE.Mesh(own(new THREE.BoxGeometry(1.2, 0.035, 0.035)), basic('#eef4ff', 2.4))).position.set(x, y, z)
    } else if (practical.kind === 'emergency') {
      const edges = [[x - room.min[0], room.min[0], 1, 0], [room.max[0] - x, room.max[0], -1, 0], [z - room.min[1], room.min[1], 0, 1], [room.max[1] - z, room.max[1], 0, -1]] as const
      const [, edge, nx, nz] = edges.reduce((best, item) => item[0] < best[0] ? item : best)
      const across = nx !== 0
      const housing: Vec3 = across ? [edge + nx * 0.05, y, z] : [x, y, edge + nz * 0.05]
      level.box(across ? [0.1, 0.16, 0.26] : [0.26, 0.16, 0.1], { name: 'metal', color: '#2a2b26', ao: false }, { at: housing, collide: false, cast: false, shadow: false })
      add(new THREE.Mesh(own(new THREE.BoxGeometry(across ? 0.02 : 0.22, 0.12, across ? 0.22 : 0.02)), basic('#ff3a26', 2))).position.set(across ? edge + nx * 0.11 : x, y, across ? z : edge + nz * 0.11)
    } else {
      const flame = new THREE.Mesh(own(crossed(0.42, 0.62, 3)), own(new THREE.MeshBasicMaterial({ map: flameMap, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true })))
      flame.position.set(x, y - 0.08, z)
      flame.name = 'fire'
      flames.push({ mesh: add(flame), room: practical.room, seed: index * 7.3 })
      const embers = new THREE.Mesh(own(new THREE.PlaneGeometry(0.56, 0.56).rotateX(-Math.PI / 2)), own(new THREE.MeshBasicMaterial({ map: dot, color: new THREE.Color('#ff6a20').multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true })))
      embers.position.set(x, y - 0.055, z)
      fixtures.push({ object: add(embers), room: practical.room })
    }
  })

  const bounces = options.phone || options.quality === 'low' ? [] : BOUNCES.map((at, index) => {
    const light = new THREE.PointLight('#ffe2b8', 1.2, 4, 2)
    light.castShadow = false
    light.name = `bounce-${index}`
    light.position.set(...at)
    return { light: add(light), room: roomAt(at[0], at[2]).id, base: 1.2 }
  })

  const shaftMaterial = own(new THREE.MeshBasicMaterial({ color: '#efe6d2', vertexColors: true, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }))
  const moteMaterial = own(new THREE.PointsMaterial({ map: dot, color: '#e6dcc4', size: 0.018, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }))
  const moteCount = options.quality === 'high' && !options.phone ? 60 : options.quality === 'low' ? 24 : 40
  const motes: Motes[] = []
  SHAFTS.forEach((shaft, index) => {
    const height = Math.max(shaft.at[1] * 2, roomOf(shaft.room).ceiling) + 0.3
    const geometry = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2 * 1.25, height, 4, 1, true).rotateY(Math.PI / 4).scale(shaft.size[0], 1, shaft.size[1]).translate(0, height / 2, 0)
    const position = geometry.getAttribute('position')
    const colors = new Float32Array(position.count * 3)
    for (let vertex = 0; vertex < position.count; vertex++) colors.fill(0.15 + 0.85 * Math.pow(position.getY(vertex) / height, 1.5), vertex * 3, vertex * 3 + 3)
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const volume = new THREE.Mesh(own(geometry), shaftMaterial)
    volume.position.set(shaft.at[0], 0, shaft.at[2])
    volume.renderOrder = 3
    volume.name = `shaft-${index}`
    fixtures.push({ object: add(volume), room: shaft.room })

    const bottom = 0.15, range = height - 0.6
    const base = new Float32Array(moteCount * 4)
    const speed = new Float32Array(moteCount)
    for (let mote = 0; mote < moteCount; mote++) {
      const seed = index * 101 + mote
      base.set([(hash(seed + 0.1) - 0.5) * shaft.size[0] * 0.9, hash(seed + 0.2) * range, (hash(seed + 0.3) - 0.5) * shaft.size[1] * 0.9, hash(seed + 0.4) * Math.PI * 2], mote * 4)
      speed[mote] = 0.015 + hash(seed + 0.5) * 0.025
    }
    const cloud = new THREE.BufferGeometry()
    cloud.setAttribute('position', new THREE.BufferAttribute(new Float32Array(moteCount * 3), 3))
    cloud.setAttribute('color', new THREE.BufferAttribute(new Float32Array(moteCount * 3), 3))
    cloud.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height / 2, 0), Math.hypot(shaft.size[0], height, shaft.size[1]) / 2 + 0.3)
    const points = new THREE.Points(own(cloud), moteMaterial)
    points.position.set(shaft.at[0], 0, shaft.at[2])
    points.renderOrder = 3
    points.name = `motes-${index}`
    motes.push({ points: add(points), room: shaft.room, base, speed, height, bottom, range })
  })

  const marker = new THREE.Group()
  marker.name = 'exfil-marker'
  marker.position.set(EXFIL.at[0], 0, EXFIL.at[1])
  const glow = new THREE.Mesh(own(new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2)), own(new THREE.MeshBasicMaterial({ map: dot, color: '#4f6b4c', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: true })))
  glow.position.y = 0.03
  glow.renderOrder = 2
  add(glow, marker)
  const smoke = new THREE.Mesh(own(crossed(1.0, 3.0, 2)), own(new THREE.MeshBasicMaterial({ map: smokeMap, color: '#8f9a8c', transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, fog: true })))
  smoke.position.set(0.05, 0.02, -0.04)
  smoke.renderOrder = 3
  add(smoke, marker)
  const flare = new THREE.Mesh(own(new THREE.CylinderGeometry(0.022, 0.022, 0.24, 8)), basic('#cfe8b8', 1.5))
  flare.position.set(0, 0.024, 0)
  flare.rotation.set(0, 0.6, Math.PI / 2)
  add(flare, marker)
  add(marker)

  const built = level.build()
  for (const child of [...built.children]) add(child)

  const update = (time: number, _dt: number, visibleRooms: ReadonlySet<RoomId>) => {
    practicals.forEach((practical, index) => {
      const on = visibleRooms.has(practical.room)
      practical.light.intensity = on ? practical.base * flicker(practical.kind, time, index * 3.7) : 0
    })
    for (const bounce of bounces) {
      const on = visibleRooms.has(bounce.room)
      bounce.light.intensity = on ? bounce.base : 0
    }
    for (const fixture of fixtures) fixture.object.visible = visibleRooms.has(fixture.room)
    for (const flame of flames) {
      flame.mesh.visible = visibleRooms.has(flame.room)
      if (!flame.mesh.visible) continue
      const lick = noise(time * 3.1 + flame.seed) * 2 - 1
      flame.mesh.scale.set(1 + lick * 0.04, 1 + lick * 0.12, 1 + lick * 0.04)
      flame.mesh.rotation.y = time * 0.35
      flame.mesh.updateMatrix()
    }
    for (const cloud of motes) {
      cloud.points.visible = visibleRooms.has(cloud.room)
      if (!cloud.points.visible) continue
      const position = cloud.points.geometry.getAttribute('position') as THREE.BufferAttribute
      const color = cloud.points.geometry.getAttribute('color') as THREE.BufferAttribute
      for (let mote = 0; mote < cloud.speed.length; mote++) {
        const o = mote * 4, phase = cloud.base[o + 3]!
        const rise = ((cloud.base[o + 1]! - time * cloud.speed[mote]!) % cloud.range + cloud.range) % cloud.range
        const y = cloud.bottom + rise
        position.setXYZ(mote, cloud.base[o]! + Math.sin(time * 0.23 + phase) * 0.07, y, cloud.base[o + 2]! + Math.cos(time * 0.19 + phase * 1.3) * 0.07)
        const fade = Math.min(1, rise / 0.4, (cloud.range - rise) / 0.4) * (0.35 + 0.65 * y / cloud.height)
        color.setXYZ(mote, fade, fade, fade)
      }
      position.needsUpdate = true
      color.needsUpdate = true
    }
  }
  update(0, 0, new Set(ROOMS.map(room => room.id)))

  return {
    group,
    heroes,
    practicals,
    update,
    dispose() {
      group.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.Points) object.geometry.dispose() })
      for (const item of owned) item.dispose()
      group.removeFromParent()
      group.clear()
      heroes.clear()
    },
  }
}
