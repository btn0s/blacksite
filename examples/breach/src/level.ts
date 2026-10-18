import * as THREE from 'three'
import type { BakeLamp } from '@blacksite/look'
import { LevelBuilder, PROPS, decalBias, fitOut, scatterProps, apartmentBlock, apc, clutter, deadTree, groundMaterial, lada, puddleMaterial, skylight, surface, waterTower, weatherSpaces, worldBoxGeometry, worldPlaneGeometry, type SurfaceName } from '@blacksite/look/world'
import { APC_AT, CLUTTER, EXFIL, FURNISHING, INTERIOR, LEVEL, PATCHES, PRACTICALS, ROOMS, SHAFTS, WINDOWS, type Block, type Practical, type Room, type Vec3 } from './layout'
import { BUDGET, type RoomId } from './model'

export type BreachLevel = {
  group: THREE.Group
  heroes: Map<string, THREE.Mesh>
  practicals: Array<{ light: THREE.PointLight; room: RoomId; base: number; kind: Practical['kind'] }>
  lamps: BakeLamp[]
  flicker: number
  update(time: number, dt: number, visibleRooms: ReadonlySet<RoomId>, listener?: { x: number; y: number; z: number }): void
  dispose(): void
}

type Paint = { name: SurfaceName; color?: string; ao?: false }
type Face = 'x+' | 'x-' | 'z+' | 'z-' | 'y+' | 'y-'
type Cell = 'blotch' | 'streak' | 'crack' | 'soot'
type Fixture = 'pendant' | 'cage' | 'tube' | 'fire' | 'emergency' | 'lamp' | 'sodium'
type Spot = { kind: Practical['kind']; fixture: Fixture; at: Vec3; room: RoomId; color?: string; intensity?: number; distance?: number; housing?: boolean }
type Tape = { from: number; count: number; base: Float32Array; across: THREE.Vector3; loose: boolean; seed: number }
type LightSource = { position: THREE.Vector3; color: THREE.Color; room: RoomId; base: number; kind: Practical['kind']; distance: number; seed: number; score: number; selected: boolean }

const LIGHTS: Record<Practical['kind'], { color: string; intensity: number; distance: number }> = {
  bulb: { color: '#ffe8cc', intensity: 14, distance: 8 },
  tube: { color: '#e4ecf4', intensity: 3.5, distance: 8 },
  fire: { color: '#ff8a3a', intensity: 4, distance: 4.5 },
  emergency: { color: '#ff3020', intensity: 3.5, distance: 5.5 },
}
const FIXTURE: Record<Practical['kind'], Fixture> = { bulb: 'pendant', tube: 'tube', fire: 'fire', emergency: 'emergency' }

const SPOTS: Spot[] = [
  ...PRACTICALS.map(practical => ({ kind: practical.kind, fixture: FIXTURE[practical.kind], at: practical.at, room: practical.room })),
  { kind: 'bulb', fixture: 'cage', at: [0, 2.7, -1.5], room: 'corridor', intensity: 11, distance: 6.5 },
  { kind: 'bulb', fixture: 'cage', at: [0, 2.7, -4.1], room: 'corridor', intensity: 3, distance: 3 },
  { kind: 'bulb', fixture: 'cage', at: [3.3, 2.65, -1.7], room: 'side', intensity: 8, distance: 6 },
  { kind: 'tube', fixture: 'tube', at: [-3.6, 4.36, -14.4], room: 'hall', housing: true, intensity: 4, distance: 8 },
  { kind: 'bulb', fixture: 'lamp', at: [-2.1, 0.79, -22.85], room: 'office', color: '#ffe2c0', intensity: 6, distance: 4.5 },
  { kind: 'bulb', fixture: 'sodium', at: [4.3, 6.38, 29.25], room: 'yard', color: '#ffb35a', intensity: 24, distance: 16 },
  { kind: 'fire', fixture: 'fire', at: [7.8, 0.96, 12.8], room: 'yard' },
  { kind: 'emergency', fixture: 'emergency', at: [-7.4, 1.95, 29.8], room: 'yard', color: '#ffb35a', intensity: 2.5, distance: 3.5 },
  { kind: 'emergency', fixture: 'emergency', at: [15.8, 2.15, -23.4], room: 'exfil', color: '#ffb35a', intensity: 4, distance: 5 },
  { kind: 'emergency', fixture: 'emergency', at: [13.8, 2.15, -26.8], room: 'exfil', color: '#ffb35a', intensity: 3, distance: 4 },
]


const GAPS: Partial<Record<RoomId, Array<{ face: Face; from: number; to: number; floor: boolean }>>> = {
  lobby: [{ face: 'z-', from: -0.8, to: 0.8, floor: true }, { face: 'z-', from: -4.2, to: -2.6, floor: false }, { face: 'z-', from: 2.6, to: 4.2, floor: false }, { face: 'z+', from: -0.75, to: 0.75, floor: true }],
  corridor: [{ face: 'x-', from: -2.2, to: -0.8, floor: true }, { face: 'z-', from: -0.75, to: 0.75, floor: true }, { face: 'z+', from: -0.8, to: 0.8, floor: true }],
  side: [{ face: 'x+', from: -2.2, to: -0.8, floor: true }, { face: 'z+', from: 3.6, to: 5.0, floor: true }],
  hall: [{ face: 'z-', from: -0.8, to: 0.8, floor: true }, { face: 'z-', from: 3.6, to: 5.0, floor: true }, { face: 'z+', from: -4.9, to: -3.5, floor: true }],
  office: [{ face: 'z-', from: -4.9, to: -3.5, floor: true }, { face: 'x-', from: -22.6, to: -20.4, floor: true }, { face: 'x+', from: -23.5, to: -21.5, floor: false }, { face: 'z+', from: -5, to: -3.4, floor: false }],
}

const AXES: Record<Face, [Vec3, Vec3, Vec3]> = {
  'x+': [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  'x-': [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
  'z+': [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  'z-': [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
  'y+': [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  'y-': [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
}
const CELLS: Record<Cell, [number, number]> = { blotch: [0, 0.5], streak: [0.5, 0.5], crack: [0, 0], soot: [0.5, 0] }

const hash = (n: number) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s) }
const noise = (x: number) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u }
const wrap = (value: number, period: number) => period ? ((value % period) + period) % period : value
const lattice = (x: number, y: number, px: number, py: number) => hash(wrap(x, px) * 157.31 + wrap(y, py) * 311.7 + 0.5)
function value2(x: number, y: number, px = 0, py = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  return (lattice(ix, iy, px, py) * (1 - ux) + lattice(ix + 1, iy, px, py) * ux) * (1 - uy) + (lattice(ix, iy + 1, px, py) * (1 - ux) + lattice(ix + 1, iy + 1, px, py) * ux) * uy
}
const fbm = (x: number, y: number, px = 0, py = 0) => value2(x, y, px, py) * 0.5 + value2(x * 2, y * 2, px * 2, py * 2) * 0.3 + value2(x * 4, y * 4, px * 4, py * 4) * 0.2
const smooth = (from: number, to: number, x: number) => { const t = Math.max(0, Math.min(1, (x - from) / (to - from))); return t * t * (3 - 2 * t) }

function flicker(kind: Practical['kind'], time: number, seed: number) {
  if (kind === 'fire') return 1 + 0.18 * ((noise(time * 4.2 + seed) * 0.65 + noise(time * 9.7 + seed * 3.1) * 0.35) * 2 - 1)
  if (kind === 'bulb') return 1 + 0.03 * (noise(time * 0.5 + seed) * 2 - 1)
  if (kind === 'emergency') return 0.94 + 0.06 * Math.sin(time * 1.6 + seed)
  return 1 - 0.16 * Math.pow(Math.max(0, Math.sin((time + seed) * 0.6)), 16) * (0.5 + 0.5 * Math.sin(time * 38))
}

function floorOf(room: Room): Paint | null {
  if (room.floor === 'dirt' || room.floor === 'water') return null
  if (room.floor === 'wood') return { name: 'paint', color: '#4f3f2f', ao: false }
  if (room.floor === 'metal') return { name: 'metal', color: '#5a5d54', ao: false }
  return room.id === 'hall' ? { name: 'slab', color: '#8b8b8a', ao: false } : { name: 'cast', color: '#969695', ao: false }
}

function texture(width: number, height: number, texel: (u: number, v: number) => [number, number, number, number], options: { srgb?: boolean; mips?: boolean; repeat?: boolean } = {}) {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = texel((x + 0.5) / width, (y + 0.5) / height)
    for (let c = 0; c < 4; c++) data[(y * width + x) * 4 + c] = Math.round(Math.max(0, Math.min(1, value[c]!)) * 255)
  }
  const map = new THREE.DataTexture(data, width, height)
  map.magFilter = THREE.LinearFilter
  map.minFilter = options.mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
  map.generateMipmaps = !!options.mips
  if (options.srgb) map.colorSpace = THREE.SRGBColorSpace
  if (options.repeat) map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.needsUpdate = true
  return map
}

function partsOf(meshes: THREE.Mesh[]) {
  const parts: Array<{ start: number; count: number; label: string }> = []
  let start = 0
  for (const mesh of meshes) {
    const triangles = (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3
    const own: Array<{ start: number; count: number; label: string }> = mesh.userData.parts ?? [{ start: 0, count: triangles, label: mesh.name }]
    for (const part of own) parts.push({ start: start + part.start, count: part.count, label: part.label })
    start += triangles
  }
  return parts
}

function merge(geometries: THREE.BufferGeometry[]) {
  const parts = geometries.map(item => item.index ? item.toNonIndexed() : item)
  const merged = new THREE.BufferGeometry()
  for (const name of Object.keys(parts[0]!.attributes)) {
    const size = parts[0]!.getAttribute(name).itemSize
    const array = new Float32Array(parts.reduce((total, part) => total + part.getAttribute(name).array.length, 0))
    let offset = 0
    for (const part of parts) { const source = part.getAttribute(name).array as Float32Array; array.set(source, offset); offset += source.length }
    merged.setAttribute(name, new THREE.BufferAttribute(array, size))
  }
  for (const item of new Set([...geometries, ...parts])) item.dispose()
  merged.computeBoundingSphere()
  return merged
}

function crossed(width: number, height: number, count: number, rows = 1) {
  return merge(Array.from({ length: count }, (_, index) => new THREE.PlaneGeometry(width, height, 1, rows).translate(0, height / 2, 0).rotateY(index * Math.PI / count)))
}

function plume(width: number, height: number, flare: number) {
  const geometry = crossed(width, height, 2, 8)
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 4)
  for (let vertex = 0; vertex < position.count; vertex++) {
    const t = Math.max(0, position.getY(vertex) / height)
    const spread = 1 + flare * t
    position.setXYZ(vertex, position.getX(vertex) * spread, position.getY(vertex), position.getZ(vertex) * spread)
    colors.set([1, 1, 1, Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, t * 1.15))), 0.8) * smooth(0, 0.12, t)], vertex * 4)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4))
  return geometry
}

const sizeOf = (block: Block): Vec3 => [block.max[0] - block.min[0], block.max[1] - block.min[1], block.max[2] - block.min[2]]
const centerOf = (block: Block): Vec3 => [(block.min[0] + block.max[0]) / 2, (block.min[1] + block.max[1]) / 2, (block.min[2] + block.max[2]) / 2]
const roomOf = (id: RoomId) => ROOMS.find(room => room.id === id)!
const rgbOf = (hex: string) => { const digits = hex.length === 4 ? [...hex.slice(1)].map(c => c + c).join('') : hex.slice(1, 7); return [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16) / 255) }
const indoor = ROOMS.filter(room => room.ceiling < 50)
const edgesOf = (room: Room): Array<{ face: Face; plane: number; from: number; to: number }> => [
  { face: 'x+', plane: room.min[0], from: room.min[1], to: room.max[1] },
  { face: 'x-', plane: room.max[0], from: room.min[1], to: room.max[1] },
  { face: 'z+', plane: room.min[1], from: room.min[0], to: room.max[0] },
  { face: 'z-', plane: room.max[1], from: room.min[0], to: room.max[0] },
]

function palette(tolerance: number) {
  const swatches = new Map<string, string[]>()
  return (name: SurfaceName, color?: string, ao?: false): Paint => {
    if (!color) return { name, ao }
    const key = `${name}${ao === false ? '-flat' : ''}`
    const list = swatches.get(key) ?? []
    swatches.set(key, list)
    const [r, g, b] = rgbOf(color)
    const near = list.find(swatch => { const [sr, sg, sb] = rgbOf(swatch); return Math.hypot(r! - sr!, g! - sg!, b! - sb!) <= tolerance })
    if (near) return { name, color: near, ao }
    list.push(color)
    return { name, color, ao }
  }
}

function still<T extends THREE.Object3D>(object: T) {
  object.updateMatrix()
  object.matrixAutoUpdate = false
  return object
}

export function buildLevel(options: { quality: 'low' | 'medium' | 'high'; phone: boolean }): BreachLevel {
  const ceilingOf = (id: RoomId) => ROOMS.find(room => room.id === id)!.ceiling
  weatherSpaces({
    rooms: ROOMS.filter(room => room.ceiling < 50).map(room => ({ min: room.min, max: room.max, ceiling: room.ceiling })),
    openings: [...SHAFTS.map(shaft => ({ at: [shaft.at[0], ceilingOf(shaft.room), shaft.at[2]] as const, radius: Math.max(...shaft.size) / 2 })), ...WINDOWS],
  })
  const level = new LevelBuilder()
  const dressing = new LevelBuilder({ coplanar: 'ignore' })
  const group = new THREE.Group()
  group.name = 'breach-level'
  const heroes = new Map<string, THREE.Mesh>()
  const owned: Array<{ dispose(): void }> = []
  const tint = palette(options.phone || options.quality === 'low' ? 0.12 : options.quality === 'medium' ? 0.07 : 0.04)
  const own = <T extends { dispose(): void }>(item: T) => { owned.push(item); return item }
  const add = <T extends THREE.Object3D>(object: T, parent: THREE.Object3D = group) => { parent.add(still(object)); return object }
  const up = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3(), turn = new THREE.Quaternion(), euler = new THREE.Euler()

  const put = (size: Vec3, paint: Paint, at: Vec3, rotate?: Vec3, cast = false) => (cast ? level : dressing).box(size, tint(paint.name, paint.color, paint.ao), { at, rotate, collide: false, cast, shadow: false })
  const rod = (from: Vec3, to: Vec3, radius: number, paint: Paint, segments = 6, cast = false) => {
    direction.set(to[0] - from[0], to[1] - from[1], to[2] - from[2])
    const length = direction.length()
    if (length < 1e-3) return
    euler.setFromQuaternion(turn.setFromUnitVectors(up, direction.normalize()))
    dressing.cylinder(radius, length, tint(paint.name, paint.color, paint.ao), { at: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2], rotate: [euler.x, euler.y, euler.z], collide: false, cast, shadow: false }, segments)
  }
  const onFace = (face: Face, plane: number, along: number, y: number, out = 0): Vec3 => {
    const normal = AXES[face][2]
    const base: Vec3 = face[0] === 'x' ? [plane, y, along] : [along, y, plane]
    return [base[0] + normal[0] * out, base[1] + normal[1] * out, base[2] + normal[2] * out]
  }
  const mount = (face: Face, plane: number, along: number, y: number, size: Vec3, paint: Paint, out = 0, tilt = 0, cast = false) => {
    const [width, height, visible] = size
    const depth = out === 0 && !tilt ? visible + 0.015 : visible
    put(face[0] === 'x' ? [depth, height, width] : [width, height, depth], paint, onFace(face, plane, along, y, out + visible - depth / 2), tilt ? (face[0] === 'x' ? [tilt, 0, 0] : [0, 0, tilt]) : undefined, cast)
  }
  const disc = (face: Face, plane: number, along: number, y: number, radius: number, depth: number, paint: Paint, out = 0) => {
    dressing.cylinder(radius, depth, tint(paint.name, paint.color, paint.ao), { at: onFace(face, plane, along, y, out + depth / 2), rotate: face[0] === 'x' ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0], collide: false, cast: false, shadow: false }, 16)
  }

  const glows: THREE.BufferGeometry[] = []
  const glow = (geometry: THREE.BufferGeometry, at: Vec3, color: string, boost: number) => {
    const tone = new THREE.Color(color).multiplyScalar(boost)
    geometry.translate(...at)
    const count = geometry.getAttribute('position').count
    const colors = new Float32Array(count * 3)
    for (let vertex = 0; vertex < count; vertex++) colors.set([tone.r, tone.g, tone.b], vertex * 3)
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    glows.push(geometry)
  }
  const glowBox = (face: Face, plane: number, along: number, y: number, width: number, height: number, out: number, color: string, boost: number) =>
    glow(face[0] === 'x' ? new THREE.BoxGeometry(0.012, height, width) : new THREE.BoxGeometry(width, height, 0.012), onFace(face, plane, along, y, out + 0.006), color, boost)

  const decals = { position: [] as number[], normal: [] as number[], uv: [] as number[] }
  const decal = (cell: Cell, face: Face, center: Vec3, width: number, height: number, flip = false) => {
    const [u, v, n] = AXES[face]
    const [u0, v0] = CELLS[cell]
    const lift = face[0] === 'y' ? 0.012 : 0.016
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]] as const) {
      for (let axis = 0; axis < 3; axis++) decals.position.push(center[axis]! + n[axis]! * lift + u[axis]! * a * width / 2 + v[axis]! * b * height / 2)
      decals.normal.push(...n)
      decals.uv.push(u0 + 0.01 + ((flip ? -a : a) + 1) / 2 * 0.48, v0 + 0.01 + (b + 1) / 2 * 0.48)
    }
  }
  const wallDecal = (cell: Cell, face: Face, plane: number, along: number, y: number, width: number, height: number, flip = false) => decal(cell, face, onFace(face, plane, along, y), width, height, flip)

  const panel: Paint = { name: 'panel', color: '#a4a3a2' }
  const trim: Paint = { name: 'cast', color: '#8b8b89', ao: false }
  const dark: Paint = { name: 'metal', color: '#16170f', ao: false }
  const dull: Paint = { name: 'metal', color: '#22231b', ao: false }
  const frame: Paint = { name: 'metal', color: '#3a3c30', ao: false }
  const iron: Paint = { name: 'metal', color: '#2a2a26', ao: false }
  const wire: Paint = { name: 'metal', color: '#1e1e1b', ao: false }
  const rebar: Paint = { name: 'rust', color: '#5a4030' }
  const drain: Paint = { name: 'rust', color: '#5c5a4c' }
  const plank: Paint = { name: 'paint', color: '#6b5a44' }
  const paper: Paint = { name: 'stained', color: '#d1cfcc' }
  const red: Paint = { name: 'paint', color: '#8a2f24' }
  const ink: Paint = { name: 'paint', color: '#2b2d29' }
  const PRINTS = ['#8a4a3a', '#4a5a6a', '#a08a5a', '#5a6a48']

  const ground = new THREE.Mesh(worldPlaneGeometry(300, 300, 4), groundMaterial())
  ground.receiveShadow = true
  ground.name = 'ground'
  add(ground)

  ROOMS.forEach((room, index) => {
    const paint = floorOf(room)
    if (!paint) return
    const width = room.max[0] - room.min[0] + 0.5, depth = room.max[1] - room.min[1] + 0.5
    const at: Vec3 = [(room.min[0] + room.max[0]) / 2, 0.006 + index * 0.0012, (room.min[1] + room.max[1]) / 2]
    if (room.floor === 'wood') {
      const wood = surface('wood', { ao: false })
      const floor = new THREE.Mesh(worldPlaneGeometry(width, depth, wood.userData.tile as number), wood)
      floor.position.set(...at)
      floor.receiveShadow = true
      floor.name = 'office-plank-floor'
      add(floor)
    } else level.plane(width, depth, paint, { at })
  })

  const asphalt: Paint = { name: 'asphalt', color: '#757575', ao: false }
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

  const footprints = [
    ...LEVEL.blocks.filter(block => block.min[1] < 0.6 && block.solid).map(block => ({ min: [block.min[0], block.min[2]] as [number, number], max: [block.max[0], block.max[2]] as [number, number] })),
    ...LEVEL.decor.filter(item => item.at[1] - item.size[1] / 2 < 0.6).map(item => {
      const reach = Math.hypot(item.size[0], item.size[2]) / 2
      return { min: [item.at[0] - reach, item.at[2] - reach] as [number, number], max: [item.at[0] + reach, item.at[2] + reach] as [number, number] }
    }),
  ]
  for (const [index, spec] of CLUTTER.entries()) {
    const room = ROOMS.find(candidate => candidate.id === spec.room)!
    const area = { min: [room.min[0] + 0.2, room.min[1] + 0.2] as [number, number], max: [room.max[0] - 0.2, room.max[1] - 0.2] as [number, number] }
    add(clutter({ area, blocked: footprints, clear: spec.clear, seed: index + 7, density: spec.density }))
  }
  add(scatterProps(FURNISHING))
  for (const item of FURNISHING) {
    const { min, max } = PROPS[item.name]
    if (item.height > 0.12) level.contact(max[0] - min[0], max[2] - min[2], [item.at[0], item.at[2]], item.yaw)
  }

  const customParts = new Map<THREE.MeshStandardMaterial, THREE.BufferGeometry[]>()
  for (const item of LEVEL.decor) {
    const paint = tint(item.look, item.color)
    const place = { at: item.at, rotate: item.rotate, collide: false, cast: item.cast ?? true, shadow: false }
    if (item.wood || item.kind === 'sandbag') {
      const material = item.wood ? surface('wood') : surface(paint.name, { color: paint.color })
      const geometry = item.wood ? worldBoxGeometry(...item.size, material.userData.tile as number) : new THREE.CapsuleGeometry(0.5, 1, 2, 8).rotateZ(Math.PI / 2).scale(item.size[0] / 2, item.size[1], item.size[2])
      if (item.kind === 'sandbag') {
        const uv = geometry.getAttribute('uv')
        for (let vertex = 0; vertex < uv.count; vertex++) uv.setXY(vertex, uv.getX(vertex) * 0.3, uv.getY(vertex) * 0.3)
      }
      const rotation = item.rotate ?? [0, 0, 0]
      geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation))).translate(...item.at)
      const parts = customParts.get(material) ?? []
      parts.push(geometry)
      customParts.set(material, parts)
    } else if (item.kind === 'box') dressing.box(item.size, paint, place)
    else dressing.cylinder(item.size[0], item.size[1], paint, place, item.segments ?? 12)
  }
  for (const [material, parts] of customParts) {
    const mesh = new THREE.Mesh(merge(parts), material)
    mesh.castShadow = mesh.receiveShadow = true
    level.mesh(mesh)
  }

  const windowBay = (face: Face, plane: number, along: number, y: number, width: number, height: number, state: number) => {
    mount(face, plane, along, y, [width, height, 0.1], state === 1 ? dull : dark, -0.08)
    mount(face, plane, along, y + height / 2 + 0.07, [width + 0.2, 0.14, 0.14], trim, -0.04)
    mount(face, plane, along, y - height / 2 - 0.035, [width + 0.26, 0.07, 0.2], trim, -0.02)
    for (const side of [-1, 1]) mount(face, plane, along + side * (width / 2 + 0.05), y, [0.1, height, 0.12], trim, -0.04)
    if (state === 1) {
      mount(face, plane, along, y, [0.05, height - 0.01, 0.04], frame, 0)
      mount(face, plane, along, y + height * 0.22, [width - 0.01, 0.05, 0.033], frame, 0.002)
    } else if (state === 2) {
      for (const [index, offset] of [-0.45, -0.05, 0.38].entries()) mount(face, plane, along, y + offset * height, [width + 0.08, 0.18, 0.03], plank, 0, (hash(along + index + y) - 0.5) * 0.16)
    } else {
      mount(face, plane, along - width * 0.3, y + height * 0.36, [width * 0.3, height * 0.22, 0.03], dull, -0.02, 0.5)
    }
  }

  const front = 10.39
  put([6.59, 6.55, 8.68], panel, [-2.095, 6.725, 6.05], undefined, true)
  for (const y of [4.0, 7.0]) {
    mount('z+', front, y < 5 ? -0.05 : -2.16, y, [y < 5 ? 10.9 : 6.68, 0.24, 0.1], trim, 0, 0, true)
    mount('x-', -5.39, 6.05, y, [8.7, 0.26, 0.1], trim, 0, 0, true)
    mount('z-', 1.71, -2.11, y, [6.58, 0.24, 0.1], trim)
  }
  put([6.59, 0.6, 0.25], panel, [-2.095, 10.3, 10.265], undefined, true)
  put([0.25, 0.6, 8.68], panel, [-5.265, 10.3, 6.05], undefined, true)
  put([6.59, 0.6, 0.25], panel, [-2.095, 10.3, 1.835], undefined, true)
  put([6.75, 0.08, 0.36], trim, [-2.095, 10.64, 10.28])
  put([0.36, 0.08, 8.76], trim, [-5.27, 10.65, 6.05])
  put([6.75, 0.08, 0.36], trim, [-2.095, 10.64, 1.83])
  ;[[-4.3, 5.65, 1], [-2.1, 5.65, 0], [0.1, 5.65, 2], [-4.3, 8.65, 0], [-2.1, 8.65, 1], [0.1, 8.65, 0]].forEach(([x, y, state]) => {
    windowBay('z+', front, x!, y!, 1.4, 1.5, state!)
    wallDecal('streak', 'z+', front, x! + 0.1, y! - 1.55, 0.9, 1.5, x! > -3)
    windowBay('z-', 1.71, x!, y!, 1.4, 1.5, (state! + 1) % 3)
  })
  for (const [z, y, state] of [[6.4, 5.65, 0], [8.8, 5.65, 1], [6.4, 8.65, 2], [8.8, 8.65, 0]] as const) windowBay('x-', -5.39, z, y, 1.4, 1.5, state)
  for (const x of [-4.8, -1.4, 0.7]) wallDecal('streak', 'z+', front, x, 9.4, 1.0, 1.4)
  wallDecal('soot', 'z+', front, -2.1, 6.4, 1.8, 1.8)
  wallDecal('blotch', 'x-', -5.39, 4.0, 5.2, 2.2, 2.2)

  for (const [z0, z1] of [[2.0, 4.5], [4.7, 7.3], [7.5, 10.1]] as const) for (const [y0, y1] of [[3.6, 6.85], [7.25, 9.85]] as const) put([0.06, y1 - y0, z1 - z0], dark, [1.2, (y0 + y1) / 2, (z0 + z1) / 2])
  for (const y of [7.05, 10.0]) put([0.14, 0.26, 8.6], { name: 'slab' }, [1.25, y, 6.05], undefined, true)
  for (const [z, y, rx, rz] of [[2.6, 7.0, 0.3, 0.6], [9.6, 7.1, -0.4, 0.4], [5.9, 10.0, 0.2, -0.5], [8.4, 9.9, 0.5, 0.3], [3.3, 4.1, -0.3, 0.5]] as const) put([0.5, 0.36, 0.6], { name: 'cast' }, [1.3, y, z], [rx, 0.2, rz], true)
  for (const [x0, x1, top] of [[1.2, 2.3, 6.6], [2.3, 3.3, 5.0], [3.3, 4.4, 4.5], [4.4, 5.4, 5.8]] as const) {
    put([x1 - x0, top - 4.0, 0.4], panel, [(x0 + x1) / 2, (top + 4.0) / 2, 10.2], undefined, true)
    put([0.55, 0.32, 0.4], panel, [x1 - 0.2, top + 0.05, 10.2], [0, 0, 0.55], true)
    rod([x0 + 0.3, top - 0.1, 10.2], [x0 + 0.45, top + 0.55, 10.3], 0.012, rebar)
    rod([x1 - 0.35, top - 0.1, 10.15], [x1 - 0.1, top + 0.4, 10.0], 0.012, rebar)
  }
  windowBay('z+', 10.4, 1.75, 5.65, 0.8, 1.5, 0)
  for (const [z0, z1, top] of [[7.6, 10.4, 5.4], [4.4, 7.6, 4.6], [1.7, 4.4, 6.2]] as const) {
    put([0.4, top - 4.0, z1 - z0], panel, [5.2, (top + 4.0) / 2, (z0 + z1) / 2], undefined, true)
    put([0.4, 0.3, 0.6], panel, [5.2, top + 0.04, z0 + 0.3], [0.5, 0, 0], true)
  }
  put([4.2, 0.8, 0.3], panel, [3.3, 4.4, 1.85], undefined, true)
  put([2.9, 0.24, 3.8], { name: 'slab' }, [2.32, 6.1, 4.3], [0, 0, -0.71], true)
  for (let z = 2.6; z < 6.1; z += 0.55) rod([3.38, 5.2, z], [3.62 + hash(z) * 0.2, 4.7 - hash(z + 1) * 0.3, z + 0.08], 0.011, rebar)
  for (let z = 6.6; z < 10.2; z += 0.5) rod([1.2, 7.05, z], [1.55 + hash(z) * 0.25, 6.75 - hash(z + 2) * 0.25, z + 0.04], 0.011, rebar)
  for (let z = 2.2; z < 10.2; z += 0.7) rod([1.2, 9.95, z], [1.6 + hash(z + 3) * 0.3, 9.65 - hash(z + 4) * 0.3, z + 0.05], 0.011, rebar)
  for (const [x, z, s, rx, ry] of [[1.8, 3.2, 0.8, 0.2, 0.4], [4.4, 4.0, 0.6, -0.3, 1.2], [4.6, 9.0, 0.9, 0.1, 2.2], [1.9, 9.4, 0.5, 0.4, 0.3], [2.6, 5.6, 0.7, -0.2, 1.7], [4.2, 6.2, 0.45, 0.3, 0.9]] as const) put([s, s * 0.45, s * 0.8], { name: hash(x + z) > 0.5 ? 'cast' : 'slab' }, [x, 3.45 + s * 0.18, z], [rx, ry, 0.15], true)
  put([1.6, 0.2, 1.2], { name: 'slab' }, [4.1, 4.15, 9.35], [0.9, 0.2, 0.15], true)

  put([2.79, 11.6, 2.8], panel, [-6.805, 5.8, 3.4], undefined, true)
  put([3.0, 0.1, 3.0], trim, [-6.805, 11.65, 3.4])
  put([1.0, 1.6, 1.0], panel, [-7.4, 12.45, 3.0], undefined, true)
  for (let index = 0; index < 6; index++) {
    const y = 2.2 + index * 1.6
    windowBay('z+', 4.8, -6.8, y, 0.7, 0.9, index % 3 === 1 ? 0 : index % 3 === 2 ? 2 : 1)
    if (index % 2 === 0) windowBay('x-', -8.2, 3.4, y + 0.8, 0.6, 0.8, index % 4 === 0 ? 1 : 0)
    wallDecal('streak', 'z+', 4.8, -6.6, y - 1.0, 0.6, 1.2)
  }

  put([2.2, 1.8, 2.4], panel, [-3.6, 10.9, 4.2], undefined, true)
  put([2.4, 0.1, 2.6], trim, [-3.6, 11.85, 4.2])
  rod([-1.0, 10.0, 3.0], [-1.0, 11.2, 3.0], 0.12, drain, 8, true)
  rod([-0.4, 10.0, 3.4], [-0.4, 10.8, 3.4], 0.09, drain, 8, true)
  rod([-4.6, 10.6, 8.6], [-4.6, 14.2, 8.6], 0.03, frame, 5, true)
  for (const y of [12.6, 13.6]) rod([-5.1, y, 8.6], [-4.1, y, 8.6], 0.015, frame, 4)

  const sign = [[1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1], [1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1], [1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1], [], [1, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1]]
  mount('z+', 10.4, -0.17, 3.12, [2.3, 0.62, 0.05], { name: 'paint', color: '#3c4a58' }, 0)
  sign.forEach((glyph, index) => glyph.forEach((on, pixel) => {
    if (!on) return
    mount('z+', 10.4, -0.995 + index * 0.42 + (pixel % 3) * 0.085, 3.32 - Math.floor(pixel / 3) * 0.085, [0.075, 0.075, 0.02], paper, 0.045)
  }))
  wallDecal('streak', 'z+', 10.4, 0.6, 2.2, 0.8, 1.4)
  wallDecal('streak', 'z+', 10.4, -1.2, 2.3, 0.6, 1.2, true)

  for (const [x, top, bottom] of [[-5.28, 10.0, 0.15], [1.02, 10.0, 7.6], [1.02, 4.4, 0.15], [5.28, 5.6, 0.15]] as const) {
    rod([x, bottom, 10.5], [x, top, 10.5], 0.055, drain, 8, true)
    for (let y = bottom + 0.8; y < top; y += 2) put([0.06, 0.05, 0.14], iron, [x, y, 10.46])
    if (bottom < 1) rod([x, 0.15, 10.5], [x, 0.05, 10.75], 0.055, drain, 8)
    wallDecal('streak', 'z+', 10.4, x + 0.15, Math.max(bottom, 0.4) + 0.9, 0.5, 1.8)
  }
  rod([1.02, 7.55, 10.5], [1.3, 6.4, 10.62], 0.055, drain, 8, true)
  wallDecal('blotch', 'z+', 10.4, -4.6, 0.45, 1.6, 0.9)
  wallDecal('blotch', 'z+', 10.4, 4.7, 0.5, 1.4, 1.0, true)
  wallDecal('crack', 'z+', 10.4, -2.4, 2.5, 1.0, 1.0)
  wallDecal('crack', 'z+', 10.4, 4.6, 3.0, 1.2, 1.2, true)
  for (const x of [-3.4, 3.4]) wallDecal('streak', 'z+', 10.4, x, 0.45, 1.2, 0.9)

  const tooth = 12.45 / 4
  const hallHoles = SHAFTS.filter(shaft => shaft.room === 'hall').map(shaft => ({ x0: shaft.at[0] - shaft.size[0] / 2 - 0.3, x1: shaft.at[0] + shaft.size[0] / 2 + 0.3, z0: shaft.at[2] - shaft.size[1] / 2, z1: shaft.at[2] + shaft.size[1] / 2 }))
  const roofParts: THREE.BufferGeometry[] = []
  const corrugated = surface('corrugated', { color: '#5f5a4b' })
  for (let index = 0; index < 4; index++) {
    const z0 = -17.3 + index * tooth, z1 = z0 + tooth
    const gaps = hallHoles.filter(hole => hole.z0 < z1 && hole.z1 > z0).sort((a, b) => a.x0 - b.x0)
    const spans: Array<[number, number]> = []
    let cursor = -7.3
    for (const gap of gaps) { spans.push([cursor, gap.x0]); cursor = gap.x1 }
    spans.push([cursor, 7.3])
    for (const [x0, x1] of spans) {
      const shape = new THREE.Shape([new THREE.Vector2(-z0, 5.31), new THREE.Vector2(-z1, 5.31), new THREE.Vector2(-z1, 6.9)])
      const prism = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false }).rotateY(Math.PI / 2).translate(x0, 0, 0)
      const uv = prism.getAttribute('uv')
      for (let vertex = 0; vertex < uv.count; vertex++) uv.setXY(vertex, uv.getX(vertex) / (corrugated.userData.tile as number), uv.getY(vertex) / (corrugated.userData.tile as number))
      roofParts.push(prism)
      put([x1 - x0, 0.08, 0.14], { name: 'rust', color: '#4d4335' }, [(x0 + x1) / 2, 6.92, z1])
      for (let x = x0 + 0.5; x < x1 - 0.2; x += 1.0) {
        const broken = hash(x * 3 + index) > 0.7
        put([0.96, 1.4, 0.03], broken ? dark : dull, [x, 6.1, z1 + 0.02])
        put([0.05, 1.5, 0.06], frame, [x + 0.5, 6.1, z1 + 0.03])
      }
    }
    for (const gap of gaps) for (const [edge, side] of [[gap.x0, 1], [gap.x1, -1]] as const) put([0.9, 0.04, 1.4], { name: 'corrugated', color: '#5f5a4b' }, [edge + side * 0.15, 5.75, (Math.max(z0, gap.z0) + Math.min(z1, gap.z1)) / 2], [0.25 * side, 0, side * 1.25], true)
  }
  for (const [x, z] of [[7.42, -5.0], [7.42, -17.2], [-7.42, -5.0], [-7.42, -17.2]] as const) {
    rod([x, 0.15, z], [x, 5.3, z], 0.055, drain, 8, true)
    wallDecal('streak', x > 0 ? 'x+' : 'x-', x > 0 ? 7.3 : -7.3, z + (z > -10 ? -0.4 : 0.4), 3.0, 0.7, 2.8)
  }
  for (const [x, z] of [[7.3, -11], [-7.3, -11], [7.3, -14.6], [-7.3, -7.6]] as const) wallDecal(hash(z) > 0.5 ? 'streak' : 'blotch', x > 0 ? 'x+' : 'x-', x, z, 1.8, 1.2, 1.6)

  for (const [index, shaft] of SHAFTS.entries()) if (shaft.room === 'hall') skylight(level, { at: [shaft.at[0], 5.12, shaft.at[2]], size: shaft.size, seed: index + 3 })

  apartmentBlock(level, { at: [-14, 0, -64], floors: 9, bays: 10, seed: 3, facing: Math.PI / 2 })
  apartmentBlock(level, { at: [42, 0, -38], floors: 6, bays: 8, seed: 9, facing: Math.PI / 4 })
  apartmentBlock(level, { at: [-26, 0, 66], floors: 7, bays: 9, seed: 21, facing: -Math.PI / 2 })
  waterTower(level, [-48, 0, -50])
  level.cylinder(1.8, 46, { name: 'brick', color: '#7a6a5f' }, { at: [58, 23, -76], collide: false }, 14)
  lada(level, [-13.5, 0, 18.5], 0, '#3b342d')
  lada(level, [-3.6, 0, 38], 0.35, '#55604f')
  apc(level, APC_AT, -Math.PI / 2 + 0.08)
  const apcYaw = -Math.PI / 2 + 0.08
  level.contact(6.8, 2.7, [APC_AT[0], APC_AT[2]], apcYaw)
  for (const x of [-2.4, -0.8, 0.8, 2.4]) for (const z of [-1.35, 1.35]) {
    level.contact(1.0, 0.55, [APC_AT[0] + x * Math.cos(apcYaw) + z * Math.sin(apcYaw), APC_AT[2] - x * Math.sin(apcYaw) + z * Math.cos(apcYaw)], apcYaw)
  }
  for (const [x, z, height, yaw] of [[-25, 16, 7, 0.3], [26, 24, 8, 1.4], [-27, 36, 6.5, 2.2], [14, 38, 7.5, 0.8], [-16, -34, 8.5, 3.1], [22, -31, 7, 1.9], [-31, -8, 9, 0.2], [30, 2, 7.2, 1.1]] as const) deadTree(level, [x, 0, z], height, yaw, false)
  for (let index = 0; index < 7; index++) {
    const x = -42 + index * 12
    level.box([0.26, 9, 0.26], { name: 'cast' }, { at: [x, 4.5, 44], collide: false, shadow: false })
    level.box([2.4, 0.16, 0.18], { name: 'cast' }, { at: [x, 8.5, 44], collide: false, cast: false, shadow: false })
  }

  const poster = (face: Face, plane: number, along: number, y: number, kind: 'paper' | 'sign' | 'hazard' | 'board' | 'clock' | 'exit', seed: number) => {
    const tilt = (hash(seed) - 0.5) * 0.08
    if (kind === 'paper') {
      mount(face, plane, along, y, [0.44, 0.62, 0.006], { name: 'stained', color: '#c7c5c2' }, 0.014, tilt)
      mount(face, plane, along, y + 0.1, [0.36, 0.3, 0.004], { name: 'paint', color: PRINTS[Math.floor(hash(seed + 1) * PRINTS.length)] }, 0.02, tilt)
      for (const offset of [-0.12, -0.17, -0.22]) mount(face, plane, along, y + offset, [0.3, 0.022, 0.004], ink, 0.02, tilt)
      if (hash(seed + 2) > 0.5) mount(face, plane, along + 0.14, y - 0.24, [0.18, 0.16, 0.006], { name: 'stained', color: '#c7c5c2' }, 0.016, 0.6)
    } else if (kind === 'sign') {
      mount(face, plane, along, y, [0.36, 0.48, 0.01], red, 0.014)
      mount(face, plane, along, y + 0.08, [0.3, 0.24, 0.006], paper, 0.024)
      mount(face, plane, along, y + 0.08, [0.16, 0.04, 0.004], ink, 0.03)
      mount(face, plane, along, y + 0.14, [0.05, 0.05, 0.004], ink, 0.03)
      mount(face, plane, along, y - 0.14, [0.3, 0.1, 0.006], paper, 0.024)
    } else if (kind === 'hazard') {
      mount(face, plane, along, y, [0.34, 0.34, 0.01], { name: 'paint', color: '#b89a3a' }, 0.014, Math.PI / 4)
      mount(face, plane, along, y + 0.03, [0.05, 0.15, 0.004], ink, 0.024)
      mount(face, plane, along, y - 0.09, [0.05, 0.05, 0.004], ink, 0.024)
    } else if (kind === 'board') {
      mount(face, plane, along, y, [0.92, 0.62, 0.02], iron, 0.014)
      mount(face, plane, along, y, [0.84, 0.54, 0.01], plank, 0.03)
      for (const [index, [dx, dy, w]] of ([[-0.24, 0.08, 0.26], [0.1, 0.12, 0.2], [0.26, -0.1, 0.22], [-0.1, -0.12, 0.3]] as const).entries()) mount(face, plane, along + dx, y + dy, [w, w * 1.3, 0.004], { name: 'stained', color: '#c7c5c2' }, 0.042 + index * 0.003, (hash(seed + dx) - 0.5) * 0.2)
    } else if (kind === 'clock') {
      disc(face, plane, along, y, 0.17, 0.04, ink, 0.014)
      disc(face, plane, along, y, 0.145, 0.01, paper, 0.054)
      mount(face, plane, along, y + 0.05, [0.016, 0.1, 0.006], ink, 0.064)
      mount(face, plane, along + 0.03, y - 0.02, [0.016, 0.08, 0.006], ink, 0.075, 2.1)
    } else {
      mount(face, plane, along, y, [0.4, 0.2, 0.05], { name: 'metal', color: '#2a2b26', ao: false }, 0.014)
      glowBox(face, plane, along, y, 0.32, 0.12, 0.064, '#4fd27a', 1.5)
    }
  }
  const cable = (face: Face, plane: number, from: number, to: number, y: number) => {
    rod(onFace(face, plane, from, y, 0.03), onFace(face, plane, to, y, 0.03), 0.011, wire, 4)
    for (let along = Math.min(from, to) + 0.3; along < Math.max(from, to); along += 0.8) mount(face, plane, along, y, [0.03, 0.04, 0.035], iron, 0.005)
  }
  const junction = (face: Face, plane: number, along: number, y: number) => {
    mount(face, plane, along, y, [0.18, 0.22, 0.08], { name: 'metal', color: '#59604f' }, 0.005)
    mount(face, plane, along, y + 0.02, [0.08, 0.05, 0.004], paper, 0.085)
  }

  const gapAt = (room: RoomId, face: Face, along: number, margin: number, floor?: boolean) => (GAPS[room] ?? []).some(gap => gap.face === face && along > gap.from - margin && along < gap.to + margin && (floor === undefined || gap.floor === floor))
  for (const room of indoor) {
    for (const edge of edgesOf(room)) {
      const doors = (GAPS[room.id] ?? []).filter(gap => gap.face === edge.face && gap.floor).sort((a, b) => a.from - b.from)
      let cursor = edge.from
      for (const span of [...doors.map(gap => [gap.from, gap.to] as const), [edge.to, edge.to] as const]) {
        const end = Math.min(span[0], edge.to)
        if (end - cursor > 0.05) mount(edge.face, edge.plane, (cursor + end) / 2, edge.face[0] === 'x' ? 0.06 : 0.062, [end - cursor - 0.008, edge.face[0] === 'x' ? 0.12 : 0.124, 0.022], { name: 'paint', color: '#2e332c' })
        cursor = Math.max(cursor, span[1])
      }
      for (let along = edge.from + 0.7, step = 0; along < edge.to - 0.5; along += 1.6 + hash(along * 7 + step) * 0.8, step++) {
        if (gapAt(room.id, edge.face, along, 0.45)) continue
        const pick = hash(along * 13 + room.ceiling + step)
        const cell: Cell = pick < 0.34 ? 'crack' : pick < 0.66 ? 'streak' : 'blotch'
        const size = 0.7 + hash(along * 5 + step) * 0.6
        wallDecal(cell, edge.face, edge.plane, along, cell === 'streak' ? room.ceiling - size * 0.9 : 1.1 + hash(along + step) * 0.8, size, cell === 'streak' ? size * 1.6 : size, hash(step + along) > 0.5)
        if (hash(along * 3 + step) > 0.55) wallDecal('blotch', edge.face, edge.plane, along + 0.4, 0.3, 1.0, 0.6)
      }
    }
    const width = room.max[0] - room.min[0], depth = room.max[1] - room.min[1]
    const holes = SHAFTS.filter(shaft => shaft.room === room.id)
    for (let index = 0; index < Math.round(width * depth / 7); index++) {
      const x = room.min[0] + 0.5 + hash(index * 3.1 + room.ceiling * 7 + room.min[0]) * (width - 1)
      const z = room.min[1] + 0.5 + hash(index * 5.7 + room.min[1]) * (depth - 1)
      if (holes.some(shaft => Math.abs(x - shaft.at[0]) < shaft.size[0] / 2 + 0.8 && Math.abs(z - shaft.at[2]) < shaft.size[1] / 2 + 0.8)) continue
      const size = 0.8 + hash(index + x) * 1.4
      decal(index % 4 === 0 ? 'crack' : 'blotch', 'y-', [x, room.ceiling, z], size, size * 0.8, index % 2 === 0)
      const fx = room.min[0] + 0.4 + hash(index * 9.3 + room.max[0]) * (width - 0.8), fz = room.min[1] + 0.4 + hash(index * 4.1 + room.max[1]) * (depth - 0.8)
      decal('blotch', 'y+', [fx, 0.005, fz], size * 1.2, size, index % 2 === 1)
    }
    for (const shaft of holes) decal('soot', 'y-', [shaft.at[0], room.ceiling, shaft.at[2] + shaft.size[1] / 2 + 0.5], shaft.size[0] + 1, 1.2)
  }

  const WALL = { 'x+': 'west', 'x-': 'east', 'z+': 'south', 'z-': 'north' } as const
  const PIPES: Partial<Record<RoomId, number>> = { lobby: 1, corridor: 2, side: 1, hall: 2, office: 1 }
  for (const [index, room] of indoor.entries()) fitOut(dressing, {
    room: { min: room.min, max: room.max, ceiling: room.ceiling },
    openings: (GAPS[room.id] ?? []).filter(gap => gap.face[0] !== 'y').map(gap => ({ wall: WALL[gap.face as keyof typeof WALL], from: gap.from, to: gap.to, bottom: gap.floor ? 0 : 0.95, top: gap.floor ? 2.3 : 2.25 })),
    holes: SHAFTS.filter(shaft => shaft.room === room.id).map(shaft => ({ min: [shaft.at[0] - shaft.size[0] / 2, shaft.at[2] - shaft.size[1] / 2], max: [shaft.at[0] + shaft.size[0] / 2, shaft.at[2] + shaft.size[1] / 2] })),
    seed: index + 11,
    pipes: PIPES[room.id] ?? 0,
  })

  poster('x-', 5.0, 5.6, 1.65, 'paper', 1)
  poster('x-', 5.0, 8.8, 1.6, 'sign', 2)
  poster('x+', -5.0, 7.2, 1.6, 'paper', 3)
  poster('x+', -5.0, 2.8, 1.6, 'hazard', 4)
  poster('x+', -5.0, 4.2, 2.4, 'clock', 5)
  poster('z+', 2.0, 0, 2.55, 'exit', 6)
  poster('z+', 2.0, 3.3, 1.6, 'sign', 7)
  poster('z+', 2.0, -3.9, 1.6, 'paper', 8)
  poster('z-', 10.0, 1.7, 1.6, 'sign', 9)
  poster('z-', 10.0, -1.7, 1.65, 'paper', 10)
  cable('z-', 10.0, -4.9, 4.9, 2.95)
  cable('x-', 5.0, 2.3, 9.8, 2.95)
  junction('z-', 10.0, -1.2, 2.75)
  rod([4.75, 0.25, 9.5], [4.75, 0.72, 9.5], 0.08, red, 10, true)
  mount('x-', 5.0, 9.5, 0.6, [0.12, 0.1, 0.06], iron, 0)
  rod([4.75, 0.72, 9.5], [4.68, 0.82, 9.42], 0.02, ink, 4)

  mount('x+', -1.2, -0.6, 1.25, [0.55, 0.72, 0.2], red, 0, 0, true)
  mount('x+', -1.2, -0.6, 1.25, [0.42, 0.5, 0.01], dull, 0.2)
  mount('x+', -1.2, -0.6, 1.66, [0.4, 0.07, 0.01], paper, 0.2)
  poster('x+', -1.2, 1.1, 1.6, 'paper', 11)
  poster('x-', 1.2, 0.7, 1.6, 'paper', 12)
  poster('x-', 1.2, -3.4, 1.6, 'sign', 13)
  junction('x-', 1.2, -2.7, 2.2)
  cable('x-', 1.2, -2.7, -4.7, 2.45)
  rod(onFace('x-', 1.2, -2.7, 2.3, 0.03), onFace('x-', 1.2, -2.7, 2.95, 0.03), 0.011, wire, 4)

  poster('x-', 5.0, -0.65, 1.8, 'hazard', 14)
  poster('x-', 5.0, 1.0, 2.3, 'paper', 15)
  poster('z-', 1.7, 2.1, 1.7, 'paper', 16)
  poster('z+', -4.85, 4.3, 2.45, 'exit', 17)
  poster('z+', -4.85, 2.0, 1.6, 'sign', 18)
  for (const side of [0.72, 1.22]) rod([1.62, 0.02, side], [1.56, 2.7, side - 0.05], 0.02, { name: 'metal', color: '#707470' }, 5, true)
  for (let y = 0.3; y < 2.6; y += 0.32) rod([1.6, y, 0.72], [1.6, y, 1.17], 0.012, { name: 'metal', color: '#707470' }, 4)
  cable('z-', 1.7, 1.6, 4.9, 2.7)

  put([1.2, 1.9, 0.5], { name: 'paint', color: '#55645a' }, [-2.8, 0.95, -5.42], undefined, true)
  for (const x of [-3.1, -2.5]) put([0.012, 1.7, 0.012], ink, [x + 0.3, 0.98, -5.68])
  put([1.24, 0.08, 0.54], iron, [-2.8, 1.94, -5.42])
  for (const [index, x] of [-3.2, -2.95, -2.7].entries()) {
    disc('z-', -5.67, x, 1.5, 0.06, 0.02, paper, 0)
    glowBox('z-', -5.67, -2.6 + index * 0.16, 1.5 - index * 0.12, 0.04, 0.04, 0.002, ['#ff4030', '#60e070', '#ffb040'][index]!, 1.6)
  }
  mount('z-', -5.67, -2.8, 1.15, [0.3, 0.3, 0.01], { name: 'paint', color: '#b89a3a' }, 0, Math.PI / 4)
  rod([-2.8, 1.98, -5.3], [-2.8, 5.0, -5.3], 0.03, iron, 6)
  poster('z-', -5.15, -5.6, 1.6, 'paper', 19)
  poster('z-', -5.15, 2.2, 1.7, 'sign', 20)
  poster('z+', -17.0, -4.2, 2.55, 'exit', 21)
  poster('z+', -17.0, -1.8, 1.6, 'paper', 22)
  poster('z+', -17.0, 6.4, 1.6, 'hazard', 23)
  poster('x+', -7.0, -13.6, 1.7, 'sign', 24)
  poster('x+', -7.0, -6.6, 1.7, 'hazard', 25)
  poster('x-', 7.0, -14.3, 1.6, 'paper', 26)
  poster('x-', 7.0, -6.0, 1.75, 'sign', 27)
  cable('x+', -7.0, -5.6, -16.6, 2.9)
  cable('x-', 7.0, -5.6, -16.6, 2.9)
  junction('x+', -7.0, -10.0, 2.6)
  junction('x-', 7.0, -13.0, 2.6)
  rod([-5.0, 4.86, -5.4], [-5.0, 4.86, -16.8], 0.07, drain, 8, true)
  rod([2.0, 4.84, -5.4], [2.0, 4.84, -16.8], 0.05, { name: 'metal', color: '#4a4a40' }, 8, true)
  for (let z = -6.2; z > -16.8; z -= 2.1) for (const [x, y] of [[-5.0, 4.86], [2.0, 4.84]] as const) rod([x, y, z], [x, 5.0, z], 0.01, iron, 4)
  for (const [x, length] of [[-2.2, 1.6], [-4.8, 1.1]] as const) {
    rod([x, 4.37, -11], [x, 4.37 - length, -11], 0.018, iron, 4)
    put([0.08, 0.14, 0.04], iron, [x, 4.3 - length, -11])
  }
  const outline = (x0: number, x1: number, z0: number, z1: number) => {
    for (const z of [z0, z1]) put([x1 - x0, 0.004, 0.08], { name: 'paint', color: '#a68a3a' }, [(x0 + x1) / 2, 0.016, z])
    for (const x of [x0, x1]) put([0.08, 0.004, z1 - z0], { name: 'paint', color: '#a68a3a' }, [x, 0.0165, (z0 + z1) / 2])
  }
  outline(-6.3, -2.9, -8.4, -6.8)
  outline(-6.3, -2.9, -15.0, -13.4)
  for (const z of [-7.6, -14.2]) decal('blotch', 'y+', [-4.4, 0.005, z], 2.2, 1.2)
  decal('soot', 'y-', [-1.1, 5.0, -10.6], 2.4, 2.4)
  decal('soot', 'y+', [-1.1, 0.005, -10.6], 1.6, 1.6)

  for (let index = 0; index < 10; index++) put([0.07, 0.3, 0.24], { name: 'paint', color: PRINTS[index % 4]! }, [-1.95 + index * 0.16 + (index > 6 ? 0.1 : 0), 1.92, -17.46], index === 7 ? [0, 0, 0.35] : undefined)
  mount('z-', -17.3, -1.2, 1.76, [1.7, 0.03, 0.3], plank, 0)
  for (const x of [-1.9, -0.5]) mount('z-', -17.3, x, 1.68, [0.03, 0.14, 0.26], iron, 0)
  mount('z-', -17.3, 1.4, 1.8, [0.5, 0.62, 0.03], plank, 0.014)
  mount('z-', -17.3, 1.4, 1.8, [0.4, 0.52, 0.006], { name: 'stained', color: '#918f8c' }, 0.044)
  poster('x-', 3.0, -18.4, 2.3, 'clock', 28)
  poster('x-', 3.0, -24.0, 1.6, 'paper', 29)
  poster('z+', -25.0, -1.8, 1.6, 'paper', 30)
  poster('z+', -25.0, -6.1, 1.85, 'board', 31)
  poster('x+', -7.0, -20.4, 1.5, 'sign', 32)
  cable('x+', -7.0, -19.2, -17.5, 2.45)
  rod([-5.6, 0.02, -17.75], [-5.6, 1.8, -17.75], 0.02, iron, 5, true)
  for (const yaw of [0, Math.PI / 2]) put([0.5, yaw ? 0.034 : 0.03, 0.04], iron, [-5.6, 0.02, -17.75], [0, yaw, 0])
  put([0.42, 0.9, 0.12], { name: 'paint', color: '#3e3a2a' }, [-5.6, 1.3, -17.67], [0.08, 0.2, 0.04], true)
  for (const [x, z] of [[-3.8, -20.0], [0.6, -22.0], [-5.5, -23.2]] as const) rod([x, 3.0, z], [x + 0.12, 2.25, z + 0.06], 0.008, wire, 4)
  put([1.0, 0.03, 0.6], panel, [-3.6, 0.06, -24.1], [0.05, 0.4, 0.08])
  decal('soot', 'y-', [-3.4, 3.0, -24.0], 1.4, 1.0)
  decal('streak', 'x+', [-7.0, 0.5, -22.5], 1.0, 1.0)

  for (const [x, z, s] of [[-3.0, 13.6, 1.2], [5.2, 15.6, 1.5], [-6.5, 21.0, 1.8], [9.5, 19.0, 1.4], [2.6, 27.5, 1.6], [-10.5, 26.2, 1.3]] as const) decal('blotch', 'y+', [x, 0.006, z], s * 1.5, s, x > 0)
  for (let index = 0; index < 5; index++) decal('streak', 'y+', [-1.6 + index * 0.9, 0.016, 26 - index * 1.9], 0.35, 3.2, index % 2 === 0)
  for (const [face, plane, from, to] of [['z+', 10.48, -19, -6], ['z+', 10.48, 6, 19], ['x+', -19.92, 11, 29], ['x-', 19.92, 11, 29], ['z-', 29.92, -19, -3.4], ['z-', 29.92, 3.4, 19]] as const) {
    for (let along = from + 1; along < to; along += 2.6 + hash(along) * 1.2) {
      const pick = hash(along * 3.3 + plane)
      wallDecal(pick < 0.4 ? 'streak' : pick < 0.75 ? 'blotch' : 'crack', face, plane, along, pick < 0.4 ? 1.7 : 0.5 + hash(along) * 1.0, 1.0 + hash(along + 1) * 0.6, pick < 0.4 ? 1.4 : 1.0, pick > 0.5)
    }
  }
  poster('z+', 10.48, -14.2, 1.45, 'paper', 33)
  poster('z+', 10.48, -11.6, 1.5, 'paper', 34)
  poster('z+', 10.48, 12.4, 1.45, 'paper', 35)
  poster('z-', 29.97, -1.5, 1.4, 'sign', 36)
  poster('z-', 29.97, 1.4, 1.5, 'hazard', 37)
  rod([5.6, 0, 29.4], [5.6, 6.3, 29.4], 0.08, frame, 8, true)
  put([0.4, 0.3, 0.4], { name: 'cast' }, [5.6, 0.15, 29.4], undefined, true)
  rod([5.6, 6.25, 29.4], [4.5, 6.42, 29.27], 0.04, frame, 6, true)
  put([0.6, 0.14, 0.28], iron, [4.3, 6.4, 29.25], undefined, true)
  for (const [x, z] of [[4.8, 12.4], [6.9, 12.35]] as const) rod([x, 0, z], [x + 0.03, 1.0, z], 0.022, frame, 5, true)
  for (const [x, z, yaw] of [[3.0, 11.6, 0.4], [3.9, 12.0, 2.1], [-8.3, 12.0, 1.0], [-6.6, 12.4, 2.6], [-16.8, 22.9, 0.3], [9.0, 12.2, 1.7], [-2.6, 28.9, 0.9]] as const) put([0.22, 0.004, 0.3], { name: 'stained', color: '#c7c5c2' }, [x, 0.012, z], [0.05, yaw, 0.03])

  const dot = own(texture(16, 16, (u, v) => { const a = Math.pow(Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) * 2), 1.8); return [a, a, a, a] }))
  const flameMap = own(texture(32, 64, (u, v) => {
    const radius = 0.9 * Math.pow(1 - v, 0.75) * Math.min(1, v * 6 + 0.4)
    const heat = Math.pow(Math.max(0, 1 - Math.abs(u - 0.5) * 2 / Math.max(radius, 1e-3)), 1.4) * Math.pow(1 - v, 0.6)
    return [heat, 0.55 * Math.pow(heat, 1.3), 0.16 * Math.pow(heat, 2.4), heat]
  }))
  const smokeMap = own(texture(32, 128, (u, v) => {
    const a = Math.pow(Math.max(0, 1 - Math.abs(u - 0.5) * 2), 1.5) * (0.25 + 0.75 * smooth(0.3, 0.75, fbm(u * 3, v * 4, 0, 4)))
    return [1, 1, 1, a]
  }, { repeat: true }))
  const atlasSize = options.phone || options.quality === 'low' ? 128 : 256
  const atlas = own(texture(atlasSize, atlasSize, (u, v) => {
    const cx = u < 0.5 ? 0 : 1, cy = v < 0.5 ? 0 : 1
    const x = (u - cx * 0.5) * 2, y = (v - cy * 0.5) * 2
    const n = fbm(x * 4 + cx * 17, y * 4 + cy * 31)
    const edge = smooth(0, 0.08, x) * smooth(0, 0.08, 1 - x) * smooth(0, 0.08, y) * smooth(0, 0.08, 1 - y)
    if (cy === 1 && cx === 0) return [0.17, 0.14, 0.1, edge * smooth(1.0, 0.35, Math.hypot(x - 0.5, y - 0.5) * 2 + (n - 0.5) * 0.8) * (0.35 + 0.55 * n)]
    if (cy === 1 && cx === 1) {
      const width = 0.14 + 0.12 * value2(x * 3, y * 2 + 5)
      return [0.16, 0.15, 0.12, edge * Math.exp(-Math.pow((x - 0.5 + (value2(y * 3, 9) - 0.5) * 0.2) / width, 2) * 2) * Math.pow(y, 0.6) * (0.35 + 0.6 * fbm(x * 10, y * 2.5))]
    }
    if (cy === 0 && cx === 0) {
      const line = Math.abs(value2(x * 5 + 3, y * 5 + 7) - 0.5) + Math.abs(value2(x * 13, y * 13) - 0.5) * 0.18
      return [0.07, 0.065, 0.055, edge * smooth(0.03, 0.0, line) * smooth(0.5, 0.25, Math.hypot(x - 0.5, y - 0.5)) * 0.9]
    }
    return [0.05, 0.05, 0.045, edge * Math.pow(Math.max(0, 1 - Math.hypot((x - 0.5) * 1.6, (y - 0.35) * 1.1) * 1.4), 1.3) * (0.55 + 0.45 * n)]
  }, { srgb: true, mips: true }))
  const weedMap = own(texture(64, 64, (u, v) => {
    for (let blade = 0; blade < 9; blade++) {
      const height = 0.45 + hash(blade + 0.7) * 0.55, t = v / height
      if (t >= 1) continue
      const center = 0.1 + hash(blade + 0.1) * 0.8 + (hash(blade + 0.3) - 0.5) * 0.5 * t * t
      if (Math.abs(u - center) < (0.03 + hash(blade + 0.9) * 0.03) * (1 - t)) {
        const shade = 0.8 + hash(blade + 0.5) * 0.3
        return [(0.3 + 0.25 * t) * shade, (0.32 + 0.2 * t) * shade, (0.17 + 0.12 * t) * shade, 1]
      }
    }
    return [0.3, 0.3, 0.2, 0]
  }, { srgb: true, mips: true }))
  const tapeMap = own(texture(32, 4, u => (Math.floor(u * 8) % 2 ? [0.86, 0.84, 0.78, 1] : [0.66, 0.16, 0.12, 1]), { srgb: true, repeat: true }))

  const practicals: BreachLevel['practicals'] = []
  const sources: LightSource[] = []
  const flames: Array<{ mesh: THREE.Mesh; room: RoomId; seed: number }> = []
  const embers: THREE.BufferGeometry[] = []
  const fixtures: Array<{ object: THREE.Object3D; room: RoomId }> = []
  const flameMaterial = own(new THREE.MeshBasicMaterial({ map: flameMap, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }))
  SPOTS.forEach((spot, index) => {
    const [x, y, z] = spot.at
    const room = roomOf(spot.room)
    let light: Vec3 = [x, y, z]
    if (spot.fixture === 'pendant') {
      glow(new THREE.SphereGeometry(0.045, 10, 8), [x, y, z], '#fff1dc', 3)
      dressing.cylinder(0.018, 0.06, iron, { at: [x, y + 0.06, z], collide: false, cast: false, shadow: false }, 8)
      dressing.cylinder(0.15, 0.05, { name: 'metal', color: '#3a4a44', ao: false }, { at: [x, y + 0.1, z], collide: false, cast: false, shadow: false }, 14)
      const cord = room.ceiling - y - 0.12
      if (cord > 0) rod([x, y + 0.12, z], [x, room.ceiling, z], 0.005, wire, 4)
    } else if (spot.fixture === 'cage') {
      glow(new THREE.SphereGeometry(0.04, 10, 8), [x, y, z], '#fff1dc', 3)
      for (let bar = 0; bar < 4; bar++) {
        const angle = bar * Math.PI / 2 + 0.4
        rod([x + Math.cos(angle) * 0.065, y - 0.07, z + Math.sin(angle) * 0.065], [x + Math.cos(angle) * 0.065, y + 0.07, z + Math.sin(angle) * 0.065], 0.004, iron, 3)
      }
      dressing.cylinder(0.07, 0.012, iron, { at: [x, y + 0.075, z], collide: false, cast: false, shadow: false }, 10)
      dressing.cylinder(0.025, 0.012, iron, { at: [x, y - 0.075, z], collide: false, cast: false, shadow: false }, 8)
      rod([x, y + 0.08, z], [x, room.ceiling - 0.03, z], 0.012, iron, 5)
      put([0.14, 0.04, 0.14], iron, [x, room.ceiling - 0.02, z])
    } else if (spot.fixture === 'tube') {
      glow(new THREE.BoxGeometry(1.2, 0.035, 0.035), [x, y, z], '#eef4ff', 2.4)
      light = [x, y - 0.08, z]
      if (spot.housing) {
        put([1.3, 0.04, 0.12], { name: 'metal', color: '#3a3a34' }, [x, y + 0.04, z])
        for (const side of [-0.5, 0.5]) rod([x + side, y + 0.06, z], [x + side, room.ceiling, z], 0.006, wire, 3)
      }
    } else if (spot.fixture === 'emergency') {
      const edges = [[x - room.min[0], room.min[0], 1, 0], [room.max[0] - x, room.max[0], -1, 0], [z - room.min[1], room.min[1], 0, 1], [room.max[1] - z, room.max[1], 0, -1]] as const
      const [, edge, nx, nz] = edges.reduce((best, item) => item[0] < best[0] ? item : best)
      const across = nx !== 0
      dressing.box(across ? [0.1, 0.16, 0.26] : [0.26, 0.16, 0.1], { name: 'metal', color: '#2a2b26', ao: false }, { at: across ? [edge + nx * 0.05, y, z] : [x, y, edge + nz * 0.05], collide: false, cast: false, shadow: false })
      glow(new THREE.BoxGeometry(across ? 0.02 : 0.22, 0.12, across ? 0.22 : 0.02), across ? [edge + nx * 0.11, y, z] : [x, y, edge + nz * 0.11], spot.color ?? '#ff3a26', 2)
    } else if (spot.fixture === 'lamp') {
      dressing.cylinder(0.07, 0.02, iron, { at: [x, y, z], collide: false, cast: false, shadow: false }, 10)
      rod([x, y + 0.01, z], [x + 0.04, y + 0.33, z + 0.02], 0.01, iron, 4)
      dressing.cylinder(0.085, 0.12, { name: 'paint', color: '#4f5a46' }, { at: [x + 0.12, y + 0.33, z + 0.04], rotate: [0, 0, -0.6], collide: false, cast: false, shadow: false }, 12)
      glow(new THREE.SphereGeometry(0.03, 8, 6), [x + 0.15, y + 0.28, z + 0.05], '#ffd9a0', 3)
      light = [x + 0.17, y + 0.22, z + 0.05]
    } else if (spot.fixture === 'sodium') {
      glow(new THREE.BoxGeometry(0.48, 0.03, 0.2), [x, y - 0.08, z], '#ffb35a', 3)
      light = [x, y - 0.35, z]
    } else {
      const flame = new THREE.Mesh(own(crossed(0.42, 0.62, 3)), flameMaterial)
      flame.position.set(x, y - 0.08, z)
      flame.name = 'fire'
      flames.push({ mesh: add(flame), room: spot.room, seed: index * 7.3 })
      embers.push(new THREE.PlaneGeometry(0.56, 0.56).rotateX(-Math.PI / 2).translate(x, y - 0.055, z))
      light = [x, y + 0.35, z]
      decal('soot', 'y+', [x, 0.006, z], 1.4, 1.4)
    }
    const spec = LIGHTS[spot.kind]
    const base = spot.intensity ?? spec.intensity
    sources.push({ position: new THREE.Vector3(...light), color: new THREE.Color(spot.color ?? spec.color), room: spot.room, base, kind: spot.kind, distance: spot.distance ?? spec.distance, seed: index * 3.7, score: 0, selected: false })
  })
  const baked = (source: LightSource) => [0, 1, 2].every(axis => source.position.getComponent(axis) > INTERIOR.min[axis]! && source.position.getComponent(axis) < INTERIOR.max[axis]!)
  const lamps: BakeLamp[] = sources.filter(baked).map(source => ({ position: source.position.toArray(), color: [source.color.r, source.color.g, source.color.b], intensity: source.base, distance: source.distance, flicker: source.kind === 'fire' }))
  const fire = sources.find(source => baked(source) && source.kind === 'fire')
  const ranked = sources.filter(source => !baked(source))
  const lightSlots = Array.from({ length: Math.max(0, BUDGET.pointLights[options.quality] - 2) }, (_, index) => {
    const light = new THREE.PointLight('#ffffff', 0, 1, 2)
    light.name = `practical-pool-${index}`
    const practical = { light: add(light), room: 'yard' as RoomId, base: 0, kind: 'bulb' as Practical['kind'] }
    practicals.push(practical)
    return { practical, source: null as LightSource | null, target: null as LightSource | null, gain: 0 }
  })
  if (embers.length) {
    const glowBed = new THREE.Mesh(merge(embers), own(new THREE.MeshBasicMaterial({ map: dot, color: new THREE.Color('#ff6a20').multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })))
    glowBed.name = 'embers'
    add(glowBed)
  }

  const smokeMaterial = own(new THREE.MeshBasicMaterial({ map: smokeMap, color: '#8c8f88', vertexColors: true, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, fog: true }))
  const smoke = new THREE.Mesh(merge([plume(0.8, 3.4, 1.4).translate(7.8, 1.0, 12.8), plume(5, 26, 1.2).translate(24, 0, -40)]), smokeMaterial)
  smoke.name = 'smoke'
  smoke.renderOrder = 3
  add(smoke)

  const weeds: THREE.BufferGeometry[] = []
  const clump = (x: number, z: number, seed: number) => {
    const scale = 0.6 + hash(seed) * 0.7
    weeds.push(crossed(0.6 * scale, 0.42 * scale, 2).rotateY(hash(seed + 1) * 3).translate(x, 0, z))
  }
  let seed = 0
  const row = (x0: number, z0: number, x1: number, z1: number, step: number) => {
    const length = Math.hypot(x1 - x0, z1 - z0)
    for (let t = 0; t < length; t += step * (0.6 + hash(seed) * 0.8)) {
      seed++
      const k = t / length
      clump(x0 + (x1 - x0) * k + (hash(seed + 0.2) - 0.5) * 0.4, z0 + (z1 - z0) * k + (hash(seed + 0.4) - 0.5) * 0.4, seed)
    }
  }
  row(-19.6, 11, -19.6, 29.6, 1.0)
  row(19.6, 11, 19.6, 29.6, 1.0)
  row(-19.5, 10.7, -8.6, 10.7, 1.1)
  row(10.2, 10.7, 19.5, 10.7, 1.1)
  row(-19.5, 29.7, -3.4, 29.7, 1.2)
  row(3.4, 29.7, 19.5, 29.7, 1.2)
  row(-5.1, 10.6, -1.6, 10.6, 0.9)
  row(15.8, -26.8, 15.8, -17.6, 1.0)
  row(3.6, -26.8, 15.6, -26.8, 1.1)
  for (const [x, z] of [[-11.8, 14.6], [-10.0, 12.6], [12.0, 15.8], [13.4, 13.8], [-2.9, 12.6], [2.9, 12.3], [-12.6, 24.2], [-8.6, 20.3]] as const) { seed++; clump(x, z, seed) }
  const weedGeometry = merge(weeds)
  const normals = weedGeometry.getAttribute('normal')
  for (let vertex = 0; vertex < normals.count; vertex++) normals.setXYZ(vertex, 0, 1, 0)
  const weedMesh = new THREE.Mesh(weedGeometry, own(new THREE.MeshStandardMaterial({ map: weedMap, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, color: '#c8c6a8' })))
  weedMesh.receiveShadow = true
  weedMesh.name = 'weeds'
  add(weedMesh)

  const tapes: Tape[] = []
  const tapeVertices: number[] = [], tapeUvs: number[] = [], tapeIndex: number[] = []
  for (const [from, to, sag, loose] of [
    [[5.42, 0.95, 10.5], [4.8, 0.92, 12.4], 0.08, false],
    [[4.8, 0.92, 12.4], [6.9, 0.88, 12.35], 0.1, false],
    [[6.9, 0.88, 12.35], [7.25, 0.35, 12.65], 0, true],
    [[-11.0, 1.8, 10.56], [-10.8, 1.05, 10.72], 0, true],
    [[-2.9, 1.8, 29.9], [2.9, 1.8, 29.9], 0.2, false],
  ] as Array<[Vec3, Vec3, number, boolean]>) {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2])
    const count = Math.max(6, Math.round(length / 0.2))
    const across = new THREE.Vector3(to[2] - from[2], 0, -(to[0] - from[0])).normalize()
    if (across.lengthSq() < 0.5) across.set(1, 0, 0)
    const start = tapeVertices.length / 3
    for (let step = 0; step <= count; step++) {
      const t = step / count
      const x = from[0] + (to[0] - from[0]) * t, y = from[1] + (to[1] - from[1]) * t - sag * 4 * t * (1 - t), z = from[2] + (to[2] - from[2]) * t
      tapeVertices.push(x, y + 0.025, z, x, y - 0.025, z)
      tapeUvs.push(t * length / 0.5, 1, t * length / 0.5, 0)
      if (step < count) { const o = start + step * 2; tapeIndex.push(o, o + 1, o + 2, o + 1, o + 3, o + 2) }
    }
    tapes.push({ from: start, count: (count + 1) * 2, base: new Float32Array(tapeVertices.slice(start * 3)), across, loose, seed: tapes.length * 2.3 })
  }
  const tapeGeometry = new THREE.BufferGeometry()
  tapeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(tapeVertices, 3))
  tapeGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(tapeUvs, 2))
  tapeGeometry.setIndex(tapeIndex)
  tapeGeometry.computeVertexNormals()
  tapeGeometry.computeBoundingSphere()
  const tapeMesh = new THREE.Mesh(tapeGeometry, own(new THREE.MeshStandardMaterial({ map: tapeMap, side: THREE.DoubleSide, roughness: 0.6 })))
  tapeMesh.name = 'tape'
  add(tapeMesh)

  const marker = new THREE.Group()
  marker.name = 'exfil-marker'
  marker.position.set(EXFIL.at[0], 0, EXFIL.at[1])
  const halo = new THREE.Mesh(own(new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2)), own(new THREE.MeshBasicMaterial({ map: dot, color: '#4f6b4c', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })))
  halo.position.y = 0.03
  halo.renderOrder = 2
  add(halo, marker)
  const signal = new THREE.Mesh(own(plume(0.9, 3.0, 0.8)), own(new THREE.MeshBasicMaterial({ map: smokeMap, color: '#8f9a8c', vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide, fog: true })))
  signal.position.set(0.05, 0.02, -0.04)
  signal.renderOrder = 3
  add(signal, marker)
  const flare = new THREE.Mesh(own(new THREE.CylinderGeometry(0.022, 0.022, 0.24, 8)), own(new THREE.MeshBasicMaterial({ color: new THREE.Color('#cfe8b8').multiplyScalar(1.5), fog: true })))
  flare.position.set(0, 0.024, 0)
  flare.rotation.set(0, 0.6, Math.PI / 2)
  add(flare, marker)
  add(marker)

  const decalGeometry = new THREE.BufferGeometry()
  decalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(decals.position, 3))
  decalGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(decals.normal, 3))
  decalGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(decals.uv, 2))
  decalGeometry.computeBoundingSphere()
  const decalMesh = new THREE.Mesh(decalGeometry, own(decalBias(new THREE.MeshStandardMaterial({ name: 'breach-decal', map: atlas, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 0.95 }))))
  decalMesh.receiveShadow = true
  decalMesh.renderOrder = 1
  decalMesh.name = 'decals'
  add(decalMesh)

  const glowMesh = new THREE.Mesh(merge(glows), own(new THREE.MeshBasicMaterial({ vertexColors: true, fog: true })))
  glowMesh.name = 'practical-glow'
  add(glowMesh)

  const roof = new THREE.Mesh(merge(roofParts), corrugated)
  roof.castShadow = true
  roof.receiveShadow = true
  roof.name = 'hall-roof'
  add(roof)

  const built = [...level.build().children, ...dressing.build().children]
  const shared = new Map<string, THREE.Mesh[]>()
  for (const child of built) {
    if (!(child instanceof THREE.Mesh) || child.renderOrder !== 0) { add(child); continue }
    const key = `${(child.material as THREE.Material).uuid}|${Object.keys(child.geometry.attributes).sort().join()}`
    shared.set(key, [...shared.get(key) ?? [], child])
  }
  for (const list of shared.values()) {
    const mesh = list[0]!
    if (list.length > 1) {
      mesh.userData.parts = partsOf(list)
      mesh.geometry = merge(list.map(item => item.geometry))
      mesh.castShadow = list.some(item => item.castShadow)
    }
    add(mesh)
  }

  const fixed = new Set(heroes.values())
  const tinted = new Map<string, THREE.Mesh[]>()
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh) || fixed.has(child) || child.renderOrder !== 0 || !(child.material instanceof THREE.MeshStandardMaterial)) continue
    const material = child.material
    if (!material.name.startsWith('look-') || material.name === 'look-ground' || material.name === 'look-puddle' || material.vertexColors || material.transparent) continue
    const maps = (['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const).map(key => material[key]?.uuid ?? '').join()
    const key = `${material.name}|${maps}|${material.roughness}|${material.metalness}|${material.side}|${material.normalScale.x}|${material.customProgramCacheKey()}|${child.castShadow}|${child.receiveShadow}|${Object.keys(child.geometry.attributes).sort().join()}`
    tinted.set(key, [...tinted.get(key) ?? [], child])
  }
  for (const list of tinted.values()) {
    if (list.length < 2) continue
    const geometries = list.map(item => {
      item.updateMatrix()
      const geometry = item.geometry.clone().applyMatrix4(item.matrix)
      const color = (item.material as THREE.MeshStandardMaterial).color
      const count = geometry.getAttribute('position').count
      const colors = new Float32Array(count * 3)
      for (let index = 0; index < count * 3; index += 3) { colors[index] = color.r; colors[index + 1] = color.g; colors[index + 2] = color.b }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      return geometry
    })
    const base = list[0]!.material as THREE.MeshStandardMaterial
    const material = own(base.clone())
    material.onBeforeCompile = base.onBeforeCompile
    material.customProgramCacheKey = base.customProgramCacheKey
    material.vertexColors = true
    material.color.set('#ffffff')
    const mesh = new THREE.Mesh(merge(geometries), material)
    mesh.userData.parts = partsOf(list)
    mesh.castShadow = list[0]!.castShadow
    mesh.receiveShadow = list[0]!.receiveShadow
    for (const item of list) { item.removeFromParent(); item.geometry.dispose() }
    add(mesh)
  }

  const tapePosition = tapeGeometry.getAttribute('position') as THREE.BufferAttribute
  const update = (time: number, dt: number, visibleRooms: ReadonlySet<RoomId>, listener = { x: 0, y: 1.63, z: 23 }) => {
    if (fire) breach.flicker = flicker('fire', time, fire.seed)
    for (const source of ranked) {
      const x = listener.x - source.position.x, y = listener.y - source.position.y, z = listener.z - source.position.z
      source.score = visibleRooms.has(source.room) ? (x * x + y * y + z * z) * (source.selected ? 0.82 : 1) : Infinity
      source.selected = false
    }
    ranked.sort((a, b) => a.score - b.score)
    for (let index = 0; index < lightSlots.length; index++) if (ranked[index] && Number.isFinite(ranked[index]!.score)) ranked[index]!.selected = true
    for (const slot of lightSlots) {
      if (slot.target?.selected) continue
      slot.target = null
      for (const candidate of ranked) {
        if (!candidate.selected || lightSlots.some(other => other !== slot && other.target === candidate)) continue
        slot.target = candidate
        break
      }
    }
    const blend = 1 - Math.exp(-18 * Math.max(0, dt))
    for (const slot of lightSlots) {
      const changing = slot.source !== slot.target
      slot.gain += ((changing || !slot.target ? 0 : 1) - slot.gain) * blend
      if (changing && slot.gain < 0.015) {
        slot.source = slot.target
        slot.gain = 0
        if (slot.source) {
          slot.practical.room = slot.source.room
          slot.practical.base = slot.source.base
          slot.practical.kind = slot.source.kind
          slot.practical.light.position.copy(slot.source.position)
          slot.practical.light.updateMatrix()
          slot.practical.light.color.copy(slot.source.color)
          slot.practical.light.distance = slot.source.distance
        }
      }
      slot.practical.light.intensity = slot.source ? slot.source.base * slot.gain * flicker(slot.source.kind, time, slot.source.seed) : 0
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
    smokeMap.offset.y = -time * 0.05
    if (visibleRooms.has('yard')) {
      for (const tape of tapes) {
        const steps = tape.count / 2 - 1
        for (let vertex = 0; vertex < tape.count; vertex++) {
          const t = Math.floor(vertex / 2) / steps
          const weight = tape.loose ? t : Math.sin(Math.PI * t)
          const sway = (Math.sin(time * 2.3 + t * 5 + tape.seed) * 0.6 + Math.sin(time * 3.7 + t * 9 + tape.seed * 2) * 0.4) * weight * (tape.loose ? 0.09 : 0.035)
          const lift = Math.sin(time * 1.9 + t * 4 + tape.seed) * weight * 0.015
          tapePosition.setXYZ(tape.from + vertex, tape.base[vertex * 3]! + tape.across.x * sway, tape.base[vertex * 3 + 1]! + lift, tape.base[vertex * 3 + 2]! + tape.across.z * sway)
        }
      }
      tapePosition.needsUpdate = true
    }
  }
  const breach: BreachLevel = {
    group,
    heroes,
    practicals,
    lamps,
    flicker: 1,
    update,
    dispose() {
      group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose() })
      for (const item of owned) item.dispose()
      group.removeFromParent()
      group.clear()
      heroes.clear()
    },
  }
  update(0, 0, new Set(ROOMS.map(room => room.id)))
  return breach
}
