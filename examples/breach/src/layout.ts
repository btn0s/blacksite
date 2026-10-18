import type { RoomId } from './model'

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]
export type Look = 'cast' | 'panel' | 'slab' | 'stained' | 'paint' | 'brick' | 'rust' | 'metal' | 'corrugated' | 'asphalt' | 'dirt' | 'grass' | 'gravel'
export type Hit = 'concrete' | 'brick' | 'metal' | 'wood' | 'dirt' | 'flesh'
export type Footing = 'concrete' | 'rubble' | 'metal' | 'wood' | 'dirt' | 'water'

export type Block = {
  id: string
  min: Vec3
  max: Vec3
  look: Look
  color?: string
  hit: Hit
  solid: boolean
  ray: boolean
  render: boolean
  cast: boolean
  contact: boolean
  hero?: boolean
}

export type Decor = {
  kind: 'box' | 'cylinder' | 'sandbag'
  size: Vec3
  at: Vec3
  rotate?: Vec3
  look: Look
  color?: string
  cast?: boolean
  segments?: number
  wood?: boolean
}

export type Room = { id: RoomId; name: string; min: Vec2; max: Vec2; ceiling: number; floor: Footing; sees: RoomId[] }

export type Patch = { min: Vec2; max: Vec2; footing: Footing }

export type Opening = { from: number; to: number; bottom: number; top: number }

export type Spawn = { id: string; at: Vec2; facing: number; crouch?: boolean }

export type Encounter = { id: 'lobby' | 'hall' | 'office'; room: RoomId; objective: Vec2; trigger: { min: Vec2; max: Vec2 }; soldiers: Spawn[]; callout: string }

export type Practical = { kind: 'bulb' | 'tube' | 'fire' | 'emergency'; at: Vec3; room: RoomId }

export type Shaft = { at: Vec3; size: Vec2; room: RoomId }

const blocks: Block[] = []
const decor: Decor[] = []
const voids: Array<{ min: Vec2; max: Vec2 }> = []
let serial = 0

type BlockOptions = { look: Look; color?: string; hit?: Hit; solid?: boolean; ray?: boolean; render?: boolean; cast?: boolean; contact?: boolean; hero?: boolean; id?: string }

const hitOf: Record<Look, Hit> = { cast: 'concrete', panel: 'concrete', slab: 'concrete', stained: 'concrete', paint: 'concrete', brick: 'brick', rust: 'metal', metal: 'metal', corrugated: 'metal', asphalt: 'concrete', dirt: 'dirt', grass: 'dirt', gravel: 'dirt' }

function block(min: Vec3, max: Vec3, options: BlockOptions) {
  const item: Block = {
    id: options.id ?? `b${serial++}`,
    min, max,
    look: options.look,
    ...(options.color ? { color: options.color } : {}),
    hit: options.hit ?? hitOf[options.look],
    solid: options.solid ?? true,
    ray: options.ray ?? true,
    render: options.render ?? true,
    cast: options.cast ?? true,
    contact: options.contact ?? min[1] < 0.05,
    ...(options.hero ? { hero: true } : {}),
  }
  blocks.push(item)
  return item
}

function box(center: Vec3, size: Vec3, options: BlockOptions) {
  return block([center[0] - size[0] / 2, center[1] - size[1] / 2, center[2] - size[2] / 2], [center[0] + size[0] / 2, center[1] + size[1] / 2, center[2] + size[2] / 2], options)
}

function standing(x: number, z: number, size: Vec3, options: BlockOptions) {
  return box([x, size[1] / 2, z], size, options)
}

function dress(item: Decor) { decor.push(item) }

export const WINDOWS: Array<{ at: Vec3; radius: number }> = []

function wall(axis: 'x' | 'z', line: number, from: number, to: number, height: number, thickness: number, look: Look, openings: Opening[] = [], color?: string, dado: -1 | 0 | 1 = 0) {
  const sorted = [...openings].sort((a, b) => a.from - b.from)
  for (const opening of sorted) if (opening.bottom > 0.5) WINDOWS.push({ at: axis === 'x' ? [(opening.from + opening.to) / 2, (opening.bottom + opening.top) / 2, line] : [line, (opening.bottom + opening.top) / 2, (opening.from + opening.to) / 2], radius: Math.max(opening.to - opening.from, opening.top - opening.bottom) / 2 })
  const segment = (a: number, b: number, y0: number, y1: number) => {
    if (b - a < 0.01 || y1 - y0 < 0.01) return
    const min: Vec3 = axis === 'x' ? [a, y0, line - thickness / 2] : [line - thickness / 2, y0, a]
    const max: Vec3 = axis === 'x' ? [b, y1, line + thickness / 2] : [line + thickness / 2, y1, b]
    block(min, max, { look, color, contact: false })
    if (y0 > 0.05 || dado === 0) return
    const sides = dado === 1 ? [1] : dado === -1 ? [-1] : []
    for (const side of sides) {
      const face = line + side * (thickness / 2 + 0.001)
      const rail = line + side * (thickness / 2 + 0.011)
      const top = Math.min(1.35, y1)
      dress(axis === 'x'
        ? { kind: 'box', size: [b - a - 0.012, top - 0.115, 0.022], at: [(a + b) / 2, (top + 0.085) / 2, face], look: 'paint', color: '#5f7562', cast: false }
        : { kind: 'box', size: [0.022, top - 0.115, b - a - 0.012], at: [face, (top + 0.085) / 2, (a + b) / 2], look: 'paint', color: '#5f7562', cast: false })
      dress(axis === 'x'
        ? { kind: 'box', size: [b - a - 0.002, 0.05, 0.03], at: [(a + b) / 2, top, rail], look: 'paint', color: '#3f4a3e', cast: false }
        : { kind: 'box', size: [0.03, 0.056, b - a - 0.002], at: [rail, top, (a + b) / 2], look: 'paint', color: '#3f4a3e', cast: false })
    }
  }
  let cursor = from
  for (const opening of sorted) {
    segment(cursor, opening.from, 0, height)
    segment(opening.from, opening.to, 0, opening.bottom)
    segment(opening.from, opening.to, opening.top, height)
    cursor = opening.to
  }
  segment(cursor, to, 0, height)
}

function slab(minX: number, maxX: number, minZ: number, maxZ: number, y0: number, y1: number, holes: Array<{ min: Vec2; max: Vec2 }>, look: Look = 'slab') {
  const zs = [...new Set([minZ, maxZ, ...holes.flatMap(hole => [hole.min[1], hole.max[1]])])].sort((a, b) => a - b)
  for (let band = 0; band < zs.length - 1; band++) {
    const z0 = zs[band]!
    const z1 = zs[band + 1]!
    const cuts = holes.filter(hole => hole.min[1] < z1 - 1e-6 && hole.max[1] > z0 + 1e-6).sort((a, b) => a.min[0] - b.min[0])
    let x = minX
    for (const hole of cuts) {
      if (hole.min[0] > x) block([x, y0, z0], [hole.min[0], y1, z1], { look, solid: false, cast: true, contact: false })
      x = Math.max(x, hole.max[0])
    }
    if (x < maxX) block([x, y0, z0], [maxX, y1, z1], { look, solid: false, cast: true, contact: false })
  }
}

function drum(x: number, z: number, color = '#4f5a44', tipped = false) {
  if (tipped) {
    box([x, 0.3, z], [0.9, 0.6, 0.6], { look: 'rust', color, render: false })
    dress({ kind: 'cylinder', size: [0.29, 0.88, 0.29], at: [x, 0.29, z], rotate: [0, 0, Math.PI / 2], look: 'rust', color, segments: 14 })
    return
  }
  box([x, 0.45, z], [0.58, 0.9, 0.58], { look: 'rust', color, render: false })
  dress({ kind: 'cylinder', size: [0.29, 0.9, 0.29], at: [x, 0.45, z], look: 'rust', color, segments: 14 })
  dress({ kind: 'cylinder', size: [0.3, 0.03, 0.3], at: [x, 0.3, z], look: 'metal', color: '#2f312b', segments: 14, cast: false })
  dress({ kind: 'cylinder', size: [0.3, 0.03, 0.3], at: [x, 0.62, z], look: 'metal', color: '#2f312b', segments: 14, cast: false })
}

function crate(x: number, z: number, size: number, y = 0, color = '#5c4a38', yaw = 0) {
  if (y === 0) box([x, size / 2, z], [size, size, size], { look: 'paint', color, hit: 'wood', render: false })
  dress({ kind: 'box', size: [size, size, size], at: [x, y + size / 2, z], rotate: [0, yaw, 0], look: 'paint', color, wood: true })
  dress({ kind: 'box', size: [size + 0.04, 0.07, size + 0.04], at: [x, y + size * 0.72, z], rotate: [0, yaw, 0], look: 'metal', color: '#2c2b25', cast: false })
  dress({ kind: 'box', size: [size + 0.04, 0.07, size + 0.04], at: [x, y + size * 0.2, z], rotate: [0, yaw, 0], look: 'metal', color: '#2c2b25', cast: false })
  const c = Math.cos(yaw), s = Math.sin(yaw), h = size / 2
  const local = (lx: number, ly: number, lz: number): Vec3 => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c]
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) dress({ kind: 'box', size: [0.08, size + 0.012, 0.08], at: local(lx * (h - 0.03), size / 2, lz * (h - 0.03)), rotate: [0, yaw, 0], look: 'paint', color: '#3e3a2a', cast: false, wood: true })
  dress({ kind: 'box', size: [size + 0.01, 0.025, size * 0.18], at: local(0, size + 0.012, -size * 0.2), rotate: [0, yaw, 0], look: 'paint', color: '#6b5a44', cast: false, wood: true })
  dress({ kind: 'box', size: [size * 0.42, size * 0.2, 0.012], at: local(0, size * 0.47, h + 0.008), rotate: [0, yaw, 0], look: 'stained', color: '#c1c0bc', cast: false })
}

function lathe(x: number, z: number) {
  box([x, 0.55, z], [2.6, 1.1, 0.8], { look: 'paint', color: '#55645a', hit: 'metal', render: false })
  dress({ kind: 'box', size: [2.6, 0.18, 0.62], at: [x, 0.98, z], look: 'metal', color: '#4c5450' })
  dress({ kind: 'box', size: [0.5, 0.86, 0.7], at: [x - 1.0, 0.43, z], look: 'paint', color: '#55645a' })
  dress({ kind: 'box', size: [0.5, 0.86, 0.7], at: [x + 1.0, 0.43, z], look: 'paint', color: '#55645a' })
  dress({ kind: 'box', size: [0.62, 0.5, 0.66], at: [x - 1.0, 1.32, z], look: 'paint', color: '#4e5d53' })
  dress({ kind: 'cylinder', size: [0.12, 0.16, 0.12], at: [x - 0.62, 1.3, z], rotate: [0, 0, Math.PI / 2], look: 'metal', color: '#707470', segments: 10 })
  dress({ kind: 'box', size: [0.3, 0.32, 0.4], at: [x + 0.7, 1.22, z], look: 'paint', color: '#4e5d53' })
  dress({ kind: 'cylinder', size: [0.03, 1.5, 0.03], at: [x, 1.12, z + 0.25], rotate: [0, 0, Math.PI / 2], look: 'metal', color: '#9a9d92', segments: 6, cast: false })
  dress({ kind: 'box', size: [0.24, 0.3, 0.06], at: [x - 1.0, 1.25, z + 0.36], look: 'metal', color: '#1f201c', cast: false })
  for (const side of [-0.2, 0.2]) dress({ kind: 'box', size: [2.48, 0.035, 0.07], at: [x + 0.05, 1.085, z + side], look: 'metal', color: '#9a9d92', cast: false })
  dress({ kind: 'box', size: [0.34, 0.26, 0.4], at: [x + 1.05, 1.2, z], look: 'metal', color: '#4c5450' })
  dress({ kind: 'cylinder', size: [0.05, 0.3, 0.05], at: [x + 0.78, 1.24, z], rotate: [0, 0, Math.PI / 2], look: 'metal', color: '#707470', segments: 8, cast: false })
  dress({ kind: 'box', size: [0.3, 0.12, 0.5], at: [x + 0.3, 1.15, z + 0.05], look: 'metal', color: '#3b3f3a' })
  dress({ kind: 'cylinder', size: [0.11, 0.03, 0.11], at: [x + 0.3, 1.08, z + 0.37], rotate: [Math.PI / 2, 0, 0], look: 'metal', color: '#707470', segments: 10, cast: false })
  dress({ kind: 'box', size: [1.5, 0.05, 0.62], at: [x, 0.5, z], look: 'rust', color: '#6a5a44', cast: false })
  dress({ kind: 'box', size: [0.42, 0.32, 0.26], at: [x - 1.0, 0.62, z - 0.46], look: 'paint', color: '#4e5d53' })
  dress({ kind: 'cylinder', size: [0.02, 0.5, 0.02], at: [x - 0.2, 1.42, z - 0.2], rotate: [0.5, 0, 0.3], look: 'metal', color: '#2a2a26', segments: 4, cast: false })
  for (const end of [-1.0, 1.0]) dress({ kind: 'box', size: [0.62, 0.06, 0.82], at: [x + end, 0.03, z], look: 'rust', color: '#3f3a30', cast: false })
}

function desk(x: number, z: number, yaw: 0 | 1 = 0, typewriter = true) {
  const size: Vec3 = yaw ? [0.8, 0.76, 1.4] : [1.4, 0.76, 0.8]
  box([x, 0.38, z], size, { look: 'paint', color: '#6b5a44', hit: 'wood', render: false })
  dress({ kind: 'box', size: [size[0] + 0.04, 0.04, size[2] + 0.04], at: [x, 0.76, z], look: 'paint', color: '#6b5a44' })
  dress({ kind: 'box', size: yaw ? [0.76, 0.72, 0.42] : [0.42, 0.72, 0.76], at: yaw ? [x, 0.36, z - 0.46] : [x - 0.46, 0.36, z], look: 'paint', color: '#5d4e3b' })
  dress({ kind: 'box', size: yaw ? [0.76, 0.72, 0.04] : [0.04, 0.72, 0.76], at: yaw ? [x, 0.36, z + 0.66] : [x + 0.66, 0.36, z], look: 'paint', color: '#5d4e3b' })
  dress({ kind: 'box', size: yaw ? [0.04, 0.5, 1.3] : [1.3, 0.5, 0.04], at: yaw ? [x + 0.35, 0.48, z] : [x, 0.48, z - 0.35], look: 'paint', color: '#5d4e3b', cast: false })
  if (typewriter) {
    dress({ kind: 'box', size: [0.42, 0.12, 0.34], at: [x + 0.1, 0.84, z + 0.04], rotate: [0, yaw ? 1.4 : 0.1, 0], look: 'metal', color: '#2b2d29' })
    dress({ kind: 'box', size: [0.44, 0.06, 0.08], at: [x + 0.1, 0.94, z - 0.08], rotate: [0, yaw ? 1.4 : 0.1, 0], look: 'metal', color: '#1e1f1c', cast: false })
  }
  for (const [index, y] of [0.16, 0.38, 0.6].entries()) {
    dress({ kind: 'box', size: yaw ? [0.012, 0.18, 0.36] : [0.36, 0.18, 0.012], at: yaw ? [x - 0.386, y, z - 0.46] : [x - 0.46, y, z + 0.386], look: 'paint', color: index % 2 ? '#75634b' : '#6b5a44', cast: false })
    dress({ kind: 'box', size: yaw ? [0.02, 0.025, 0.12] : [0.12, 0.025, 0.02], at: yaw ? [x - 0.396, y + 0.04, z - 0.46] : [x - 0.46, y + 0.04, z + 0.396], look: 'metal', color: '#2b2d29', cast: false })
  }
  dress({ kind: 'box', size: yaw ? [0.02, 0.03, size[2] + 0.06] : [size[0] + 0.06, 0.03, 0.02], at: yaw ? [x - size[0] / 2 - 0.02, 0.758, z] : [x, 0.758, z + size[2] / 2 + 0.02], look: 'metal', color: '#2b2d29', cast: false })
  dress({ kind: 'box', size: [0.3, 0.012, 0.22], at: [x - 0.3, 0.785, z + 0.1], rotate: [0, 0.4, 0], look: 'stained', color: '#d0cecc', cast: false })
  dress({ kind: 'box', size: [0.24, 0.012, 0.32], at: [x - 0.42, 0.79, z - 0.08], rotate: [0, -0.3, 0], look: 'stained', color: '#c1c0bc', cast: false })
}

function cabinet(x: number, z: number, along: 'x' | 'z' = 'x') {
  const size: Vec3 = along === 'x' ? [0.5, 1.32, 0.62] : [0.62, 1.32, 0.5]
  box([x, 0.66, z], size, { look: 'metal', color: '#6d7366', render: false })
  dress({ kind: 'box', size, at: [x, 0.66, z], look: 'metal', color: '#6d7366' })
  dress({ kind: 'box', size: [size[0] + 0.02, 0.025, size[2] + 0.02], at: [x, 1.33, z], look: 'metal', color: '#4c5450', cast: false })
  dress({ kind: 'box', size: along === 'x' ? [0.48, 0.08, 0.02] : [0.02, 0.08, 0.48], at: along === 'x' ? [x, 0.05, z + 0.315] : [x + 0.315, 0.05, z], look: 'paint', color: '#2e332c', cast: false })
  for (const y of [0.24, 0.56, 0.88, 1.16]) dress({ kind: 'box', size: along === 'x' ? [0.1, 0.05, 0.012] : [0.012, 0.05, 0.1], at: along === 'x' ? [x - 0.12, y + 0.08, z + 0.316] : [x + 0.316, y + 0.08, z - 0.12], look: 'stained', color: '#d1cfcc', cast: false })
  for (const y of [0.3, 0.62, 0.94, 1.22]) dress({ kind: 'box', size: along === 'x' ? [0.12, 0.03, 0.02] : [0.02, 0.03, 0.12], at: along === 'x' ? [x, y, z + 0.32] : [x + 0.32, y, z], look: 'metal', color: '#2b2c28', cast: false })
}

function shelving(x: number, z: number, length: number, along: 'x' | 'z') {
  const size: Vec3 = along === 'x' ? [length, 2.2, 0.6] : [0.6, 2.2, length]
  box([x, 1.1, z], size, { look: 'metal', color: '#59604f', render: false })
  for (const y of [0.12, 0.7, 1.3, 1.9]) dress({ kind: 'box', size: [size[0], 0.04, size[2]], at: [x, y, z], look: 'metal', color: '#59604f', cast: true })
  for (const end of [-1, 1]) for (const side of [-1, 1]) {
    const offset = end * (length / 2 - 0.03)
    const across = side * 0.27
    dress({ kind: 'box', size: [0.04, 2.2, 0.04], at: along === 'x' ? [x + offset, 1.1, z + across] : [x + across, 1.1, z + offset], look: 'metal', color: '#3e4339' })
  }
  for (let index = 0; index < Math.floor(length / 0.6); index++) {
    const offset = -length / 2 + 0.35 + index * 0.6
    const y = [0.14, 0.72, 1.32][index % 3]!
    dress({ kind: 'box', size: [0.4, 0.3, 0.36], at: along === 'x' ? [x + offset, y + 0.15, z] : [x, y + 0.15, z + offset], rotate: [0, index * 0.3, 0], look: 'paint', color: index % 2 ? '#6a5d40' : '#585b45' })
  }
}

function rubble(x: number, z: number, radius: number, seed: number, look: Look = 'cast', collide = true) {
  let state = seed >>> 0
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296 }
  if (collide) box([x, 0.16, z], [radius * 1.2, 0.32, radius * 1.2], { look, render: false })
  for (let index = 0; index < 9; index++) {
    const size = 0.12 + random() * radius * 0.5
    const angle = random() * Math.PI * 2
    const distance = random() * radius
    dress({ kind: 'box', size: [size, size * (0.4 + random() * 0.5), size * (0.6 + random() * 0.6)], at: [x + Math.cos(angle) * distance, size * 0.22, z + Math.sin(angle) * distance], rotate: [random() * 0.6, random() * 3, random() * 0.6], look, color: random() > 0.5 ? '#9c978a' : undefined })
  }
  dress({ kind: 'box', size: [radius * 1.4, 0.1, radius * 1.1], at: [x, 0.04, z], rotate: [0.03, random() * 3, 0.02], look: 'gravel', cast: false })
}

function radiator(x: number, z: number, along: 'x' | 'z') {
  for (let index = 0; index < 8; index++) {
    const offset = -0.42 + index * 0.12
    dress({ kind: 'box', size: along === 'x' ? [0.07, 0.56, 0.1] : [0.1, 0.56, 0.07], at: along === 'x' ? [x + offset, 0.48, z] : [x, 0.48, z + offset], look: 'paint', color: '#a49f8a', cast: false })
  }
}

function pipe(from: Vec3, to: Vec3, radius = 0.05, color = '#5c5a4c') {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2]
  const length = Math.hypot(dx, dy, dz)
  const rotate: Vec3 = Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > Math.abs(dz) ? [0, 0, 0] : Math.abs(dx) > Math.abs(dz) ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]
  dress({ kind: 'cylinder', size: [radius, length, radius], at: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2], rotate, look: 'rust', color, segments: 8, cast: false })
}

function pallet(x: number, z: number, layers = 1, along: 'x' | 'z' = 'x', y = 0, solid = true) {
  const size: Vec3 = along === 'x' ? [1.2, 0.14 * layers, 0.8] : [0.8, 0.14 * layers, 1.2]
  if (solid && y === 0) box([x, size[1] / 2, z], size, { look: 'paint', color: '#6b5a44', hit: 'wood', render: false })
  for (let layer = 0; layer < layers; layer++) {
    const base = y + layer * 0.14 + (layer % 2 ? 0.02 : 0)
    const shift = (layer % 3 - 1) * 0.04
    for (const offset of [-0.34, 0, 0.34]) dress({ kind: 'box', size: along === 'x' ? [1.2, 0.09, 0.1] : [0.1, 0.09, 1.2], at: along === 'x' ? [x + shift, base + 0.045, z + offset] : [x + offset, base + 0.045, z + shift], look: 'paint', color: '#5e4e3a', cast: layer === layers - 1, wood: true })
    for (let slat = 0; slat < 5; slat++) {
      const offset = -0.5 + slat * 0.25
      dress({ kind: 'box', size: along === 'x' ? [0.12, 0.025, 0.8] : [0.8, 0.025, 0.12], at: along === 'x' ? [x + shift + offset, base + 0.1, z] : [x + offset, base + 0.1, z + shift], look: 'paint', color: slat % 2 ? '#75634b' : '#6b5a44', cast: false, wood: true })
    }
  }
}

function dumpster(x: number, z: number) {
  box([x, 0.62, z], [1.9, 1.25, 1.1], { look: 'metal', color: '#4c5a48', render: false })
  dress({ kind: 'box', size: [1.9, 0.95, 1.1], at: [x, 0.66, z], look: 'metal', color: '#4c5a48' })
  dress({ kind: 'box', size: [1.96, 0.1, 1.16], at: [x, 1.13, z], look: 'rust', color: '#5a4a3a', cast: false })
  dress({ kind: 'box', size: [0.94, 0.05, 1.12], at: [x - 0.47, 1.2, z], rotate: [0, 0, 0.04], look: 'metal', color: '#3c4638' })
  dress({ kind: 'box', size: [0.94, 0.05, 1.12], at: [x + 0.47, 1.5, z - 0.48], rotate: [1.15, 0, 0], look: 'metal', color: '#3c4638' })
  for (const side of [-1, 1]) dress({ kind: 'box', size: [0.08, 0.2, 1.16], at: [x + side * 0.99, 0.95, z], look: 'rust', color: '#5a4a3a', cast: false })
  for (const [dx, dz] of [[-0.75, -0.4], [0.75, -0.4], [-0.75, 0.4], [0.75, 0.4]] as const) dress({ kind: 'cylinder', size: [0.09, 0.06, 0.09], at: [x + dx, 0.1, z + dz], rotate: [Math.PI / 2, 0, 0], look: 'metal', color: '#1d1c19', segments: 8, cast: false })
  dress({ kind: 'box', size: [1.4, 0.32, 0.012], at: [x, 0.7, z + 0.556], look: 'paint', color: '#a68a3a', cast: false })
}

function tyres(x: number, z: number, count: number, solid = true) {
  if (solid) box([x, count * 0.11, z], [0.66, count * 0.22, 0.66], { look: 'rust', color: '#1d1c19', hit: 'dirt', render: false })
  for (let index = 0; index < count; index++) {
    dress({ kind: 'cylinder', size: [0.33, 0.21, 0.33], at: [x + (index % 2) * 0.05, 0.105 + index * 0.215, z - (index % 3) * 0.03], rotate: [0.04 * (index % 2), index, 0], look: 'metal', color: '#1d1c19', segments: 12 })
    dress({ kind: 'cylinder', size: [0.17, 0.215, 0.17], at: [x + (index % 2) * 0.05, 0.105 + index * 0.215, z - (index % 3) * 0.03], look: 'metal', color: '#0f0f0d', segments: 10, cast: false })
  }
}

function bench(x: number, z: number, along: 'x' | 'z', broken = false) {
  box([x, 0.22, z], along === 'x' ? [1.6, 0.45, 0.45] : [0.45, 0.45, 1.6], { look: 'cast', color: '#8b8b89', render: false })
  const place = (offset: number, y: number, across: number): Vec3 => along === 'x' ? [x + offset, y, z + across] : [x + across, y, z + offset]
  const size = (length: number, height: number, depth: number): Vec3 => along === 'x' ? [length, height, depth] : [depth, height, length]
  for (const end of [-0.62, 0.62]) dress({ kind: 'box', size: size(0.16, 0.42, 0.42), at: place(end, 0.21, 0), look: 'cast', color: '#8b8b89' })
  for (const [index, across] of [-0.14, 0, 0.14].entries()) {
    if (broken && index === 2) continue
    dress({ kind: 'box', size: size(1.6, 0.04, 0.11), at: place(0, 0.44, across), rotate: broken && index === 1 ? (along === 'x' ? [0, 0, 0.12] : [0.12, 0, 0]) : undefined, look: 'paint', color: '#4f5a46', cast: false })
  }
  if (broken) dress({ kind: 'box', size: size(1.2, 0.04, 0.11), at: place(0.3, 0.06, 0.32), rotate: [0, 0.3, 0.05], look: 'paint', color: '#4f5a46', cast: false })
}

function footings(x: number, z: number, along: 'x' | 'z', layers: number, columns = 2) {
  const size: Vec3 = along === 'x' ? [2.4, 0.6, 0.6] : [0.6, 0.6, 2.4]
  const width = columns * 0.62
  box([x, layers * 0.3, z], along === 'x' ? [2.5, layers * 0.6, width] : [width, layers * 0.6, 2.5], { look: 'cast', color: '#959593', render: false })
  for (let layer = 0; layer < layers; layer++) for (let column = 0; column < columns; column++) {
    const across = (column - (columns - 1) / 2) * 0.62
    const shift = ((layer * 3 + column * 5) % 4 - 1.5) * 0.04
    dress({ kind: 'box', size, at: along === 'x' ? [x + shift, layer * 0.6 + 0.3, z + across] : [x + across, layer * 0.6 + 0.3, z + shift], rotate: [0, ((layer + column) % 3 - 1) * 0.02, 0], look: 'cast', color: (layer + column) % 2 ? '#9a9585' : '#8f8b7c' })
  }
}

function container(x: number, z: number, along: 'x' | 'z', color: string) {
  const size: Vec3 = along === 'x' ? [6.06, 2.6, 2.44] : [2.44, 2.6, 6.06]
  box([x, 1.3, z], size, { look: 'corrugated', color, hit: 'metal', render: false })
  dress({ kind: 'box', size, at: [x, 1.3, z], look: 'corrugated', color })
  for (const end of [-1, 1]) dress({ kind: 'box', size: along === 'x' ? [0.1, 2.64, 2.48] : [2.48, 2.64, 0.1], at: along === 'x' ? [x + end * 3.0, 1.3, z] : [x, 1.3, z + end * 3.0], look: 'rust', color: '#4d4335', cast: false })
  dress({ kind: 'box', size: along === 'x' ? [6.08, 0.12, 2.5] : [2.5, 0.12, 6.08], at: [x, 2.56, z], look: 'rust', color: '#4d4335', cast: false })
  dress({ kind: 'box', size: along === 'x' ? [6.08, 0.12, 2.5] : [2.5, 0.12, 6.08], at: [x, 0.06, z], look: 'rust', color: '#4d4335', cast: false })
}

function spool(x: number, z: number) {
  box([x, 0.6, z], [0.7, 1.2, 1.2], { look: 'paint', color: '#6b5a44', hit: 'wood', render: false })
  for (const side of [-0.3, 0.3]) dress({ kind: 'cylinder', size: [0.6, 0.06, 0.6], at: [x + side, 0.6, z], rotate: [0, 0, Math.PI / 2], look: 'paint', color: '#6b5a44', segments: 16 })
  dress({ kind: 'cylinder', size: [0.3, 0.56, 0.3], at: [x, 0.6, z], rotate: [0, 0, Math.PI / 2], look: 'metal', color: '#2b2d29', segments: 12 })
}

function booth(x: number, z: number) {
  box([x, 1.2, z], [1.8, 2.4, 1.8], { look: 'stained', color: '#9c9d9c', render: false })
  dress({ kind: 'box', size: [1.8, 2.3, 1.8], at: [x, 1.15, z], look: 'stained', color: '#9c9d9c' })
  dress({ kind: 'box', size: [2.2, 0.14, 2.2], at: [x, 2.37, z], look: 'rust', color: '#5a4a3a' })
  dress({ kind: 'box', size: [1.3, 0.6, 0.04], at: [x, 1.55, z + 0.91], look: 'metal', color: '#22231b' })
  dress({ kind: 'box', size: [0.04, 0.6, 1.1], at: [x + 0.91, 1.55, z], look: 'metal', color: '#16170f' })
  dress({ kind: 'box', size: [1.4, 0.06, 0.18], at: [x, 1.2, z + 0.98], look: 'paint', color: '#55645a', cast: false })
  dress({ kind: 'box', size: [0.04, 1.9, 0.8], at: [x - 0.91, 0.95, z + 0.3], look: 'paint', color: '#55645a', cast: false })
}

function workbench(x: number, z: number, along: 'x' | 'z') {
  const size: Vec3 = along === 'x' ? [1.6, 0.9, 0.7] : [0.7, 0.9, 1.6]
  box([x, 0.45, z], size, { look: 'metal', color: '#4c5450', render: false })
  dress({ kind: 'box', size: [size[0], 0.06, size[2]], at: [x, 0.87, z], look: 'metal', color: '#707470' })
  dress({ kind: 'box', size: [size[0] - 0.1, 0.03, size[2] - 0.1], at: [x, 0.25, z], look: 'rust', color: '#5a4a3a', cast: false })
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) dress({ kind: 'box', size: [0.06, 0.84, 0.06], at: [x + dx * (size[0] / 2 - 0.05), 0.42, z + dz * (size[2] / 2 - 0.05)], look: 'paint', color: '#4e5d53', cast: false })
  const end: Vec3 = along === 'x' ? [x + 0.55, 1.0, z + 0.2] : [x + 0.2, 1.0, z + 0.55]
  dress({ kind: 'box', size: [0.2, 0.16, 0.2], at: end, look: 'paint', color: '#55645a' })
  dress({ kind: 'cylinder', size: [0.015, 0.3, 0.015], at: [end[0], 1.08, end[2]], rotate: along === 'x' ? [Math.PI / 2, 0, 0] : [0, 0, Math.PI / 2], look: 'metal', color: '#9a9d92', segments: 4, cast: false })
  dress({ kind: 'box', size: [0.36, 0.14, 0.2], at: along === 'x' ? [x - 0.4, 0.97, z] : [x, 0.97, z - 0.4], rotate: [0, 0.2, 0], look: 'paint', color: '#8a2f24' })
  dress({ kind: 'box', size: along === 'x' ? [0.3, 0.02, 0.06] : [0.06, 0.02, 0.3], at: along === 'x' ? [x - 0.05, 0.91, z - 0.1] : [x - 0.1, 0.91, z - 0.05], rotate: [0, 0.5, 0], look: 'metal', color: '#2a2a26', cast: false })
}

function cylinders(x: number, z: number, colors: string[]) {
  box([x, 0.7, z], [0.3, 1.4, colors.length * 0.3], { look: 'metal', color: colors[0], render: false })
  colors.forEach((color, index) => {
    const at: Vec3 = [x + (index % 2) * 0.03, 0.68, z + (index - (colors.length - 1) / 2) * 0.29]
    dress({ kind: 'cylinder', size: [0.12, 1.3, 0.12], at, rotate: [0.04 * (index % 2 ? 1 : -1), 0, 0.03], look: 'paint', color, segments: 12 })
    dress({ kind: 'cylinder', size: [0.04, 0.12, 0.04], at: [at[0], 1.38, at[2]], look: 'metal', color: '#707470', segments: 6, cast: false })
  })
}

export const WORLD = { width: 35, depth: 56 }

export const ROOMS: Room[] = [
  { id: 'yard', name: 'Yard', min: [-20, 10.4], max: [20, 30], ceiling: 99, floor: 'dirt', sees: ['yard', 'lobby'] },
  { id: 'lobby', name: 'Lobby', min: [-5, 2], max: [5, 10], ceiling: 3.2, floor: 'concrete', sees: ['yard', 'lobby', 'corridor'] },
  { id: 'corridor', name: 'Corridor', min: [-1.2, -4.85], max: [1.2, 1.7], ceiling: 3, floor: 'concrete', sees: ['lobby', 'corridor', 'side', 'hall'] },
  { id: 'side', name: 'Store room', min: [1.5, -4.85], max: [5, 1.7], ceiling: 3, floor: 'concrete', sees: ['corridor', 'side', 'hall'] },
  { id: 'hall', name: 'Machine hall', min: [-7, -17], max: [7, -5.15], ceiling: 5, floor: 'concrete', sees: ['corridor', 'side', 'hall', 'office'] },
  { id: 'office', name: 'Records office', min: [-7, -25], max: [3, -17.3], ceiling: 3, floor: 'wood', sees: ['hall', 'office', 'exfil'] },
  { id: 'exfil', name: 'Exfil yard', min: [3.3, -27], max: [16, -17.3], ceiling: 99, floor: 'dirt', sees: ['office', 'exfil'] },
]

export const PATCHES: Patch[] = [
  { min: [-4, 18], max: [5, 30], footing: 'concrete' },
  { min: [1.9, 6.6], max: [4.2, 8.6], footing: 'rubble' },
  { min: [-4.6, -10.6], max: [-1.4, -7.4], footing: 'rubble' },
  { min: [2.1, -14.4], max: [4.9, -11.6], footing: 'rubble' },
  { min: [-1.4, -16.6], max: [6.6, -15.4], footing: 'metal' },
  { min: [5.6, -9.4], max: [6.9, -6.4], footing: 'metal' },
  { min: [3.3, -23.2], max: [5.4, -19.8], footing: 'rubble' },
  { min: [-9, 14.2], max: [-6.6, 16.2], footing: 'water' },
  { min: [6.2, 24.4], max: [9.2, 26.2], footing: 'water' },
  { min: [5.6, -25.4], max: [8.4, -23.6], footing: 'water' },
]

const lobbyFront: Opening[] = [{ from: -0.8, to: 0.8, bottom: 0, top: 2.4 }, { from: -4.2, to: -2.6, bottom: 0.95, top: 2.25 }, { from: 2.6, to: 4.2, bottom: 0.95, top: 2.25 }]
wall('x', 10.2, -5.4, 5.4, 4, 0.4, 'panel', lobbyFront, '#a9a8a4', -1)
wall('z', -5.2, 1.7, 10.4, 4, 0.4, 'panel', [], '#a9a8a4', 1)
wall('z', 5.2, -5.15, 10.4, 4, 0.4, 'panel', [], '#a9a8a4', -1)
wall('x', 1.85, -5, 5, 3.2, 0.3, 'stained', [{ from: -0.75, to: 0.75, bottom: 0, top: 2.3 }], undefined, 1)
slab(-5.4, 5.4, 1.7, 10.4, 3.2, 3.45, [{ min: [2.2, 6.8], max: [3.8, 8.2] }])
block([-5.4, 3.45, 10.0], [5.4, 4.0, 10.4], { look: 'panel', color: '#a4a3a2', solid: false, contact: false })

wall('z', -1.35, -4.85, 1.7, 3, 0.3, 'stained', [], undefined, 1)
wall('z', 1.35, -4.85, 1.7, 3, 0.3, 'stained', [{ from: -2.2, to: -0.8, bottom: 0, top: 2.2 }], undefined, 0)
slab(-1.5, 5.0, -4.85, 1.7, 3.0, 3.25, [])
voids.push({ min: [-5.4, -4.85], max: [-1.5, 1.7] })
block([-5.4, 0, -4.85], [-1.5, 3.25, 1.7], { look: 'stained', color: '#a4a3a2', contact: false })

const hallSouth: Opening[] = [{ from: -0.8, to: 0.8, bottom: 0, top: 2.4 }, { from: 3.6, to: 5.0, bottom: 0, top: 2.2 }]
wall('x', -5, -7.3, 7.3, 5.0, 0.3, 'stained', hallSouth, '#b8b7b3', -1)
const clerestory = (from: number, to: number): Opening => ({ from, to, bottom: 3.3, top: 4.4 })
wall('z', -7.15, -17.3, -4.85, 5.3, 0.3, 'brick', [clerestory(-9, -7), clerestory(-13, -11), clerestory(-16.2, -14.5)], undefined, 1)
wall('z', 7.15, -17.3, -4.85, 5.3, 0.3, 'brick', [clerestory(-9, -7), clerestory(-13, -11), clerestory(-16.2, -14.5)], undefined, -1)
wall('x', -17.15, -7.3, 7.3, 5.3, 0.3, 'stained', [{ from: -4.9, to: -3.5, bottom: 0, top: 2.3 }], '#b8b7b3', 1)
slab(-7.3, 7.3, -17.3, -4.85, 5.0, 5.3, [{ min: [-4, -10], max: [-2, -8] }, { min: [2.5, -14], max: [4.5, -12] }], 'cast')

wall('z', -7.15, -25.3, -17.3, 3.3, 0.3, 'panel', [{ from: -23.5, to: -21.5, bottom: 1.0, top: 2.1 }], '#a9a8a4', 1)
wall('x', -25.15, -7.3, 3.3, 3.3, 0.3, 'panel', [{ from: -5, to: -3.4, bottom: 1.0, top: 2.1 }], '#a9a8a4', 1)
wall('z', 3.15, -25.3, -17.3, 3.3, 0.3, 'panel', [{ from: -22.6, to: -20.4, bottom: 0, top: 2.4 }], '#a9a8a4', -1)
slab(-7.3, 3.3, -25.3, -17.3, 3.0, 3.25, [])

const fence = (axis: 'x' | 'z', line: number, from: number, to: number, gaps: Opening[] = []) => {
  wall(axis, line, from, to, 2.4, 0.16, 'cast', gaps, '#a6a5a1')
  for (let at = from; at <= to + 1e-6; at += 3) {
    if (gaps.some(gap => at > gap.from - 0.1 && at < gap.to + 0.1)) continue
    dress({ kind: 'box', size: axis === 'x' ? [0.22, 2.6, 0.24] : [0.24, 2.6, 0.22], at: axis === 'x' ? [at, 1.3, line] : [line, 1.3, at], look: 'cast', color: '#8a8a89' })
  }
}
fence('x', 30, -20, 20, [{ from: -3, to: 3, bottom: 0, top: 2.4 }])
fence('z', -20, 10.4, 30)
standing(-1.5, 30, [2.9, 2.1, 0.06], { look: 'rust', color: '#7d6a58', contact: false })
standing(1.5, 30.08, [2.9, 2.1, 0.06], { look: 'rust', color: '#6f5f50', contact: false })
standing(-13.5, 18.5, [4.1, 1.4, 1.7], { look: 'rust', hit: 'metal', render: false, cast: false, contact: false })
block([9.6, 0, -25.9], [12.8, 2.3, -18.2], { look: 'metal', hit: 'metal', render: false, cast: false, contact: false })
fence('z', 20, 10.4, 30)
fence('x', 10.4, -20, -5.4)
fence('x', 10.4, 5.4, 20)
fence('z', 16, -27, -17.3)
fence('x', -27, 3.3, 16)
fence('x', -17.3, 7.3, 16)

voids.push(
  { min: [-17.5, 14], max: [17.5, 28] },
  { min: [-17.5, -28], max: [-7.3, 14] },
  { min: [-7.3, -4.85], max: [-5.4, 10.4] },
  { min: [5.4, -4.85], max: [17.5, 10.4] },
  { min: [7.3, -17.3], max: [17.5, -4.85] },
  { min: [16, -28], max: [17.5, -17.3] },
  { min: [-7.3, -28], max: [3.3, -25.3] },
  { min: [3.3, -28], max: [17.5, -27] },
)

standing(-2.4, 6.2, [0.5, 3.2, 0.5], { look: 'cast', hero: true, id: 'pillar-lobby-west' })
standing(2.4, 4.6, [0.5, 3.2, 0.5], { look: 'cast', hero: true, id: 'pillar-lobby-east' })
box([1.6, 0.5, 3.6], [2.2, 1.0, 0.62], { look: 'paint', color: '#6b5a44', hit: 'wood', render: false })
dress({ kind: 'box', size: [2.18, 0.06, 0.95], at: [1.6, 0.48, 3.62], rotate: [Math.PI / 2, 0, 0], look: 'paint', color: '#6b5a44' })
dress({ kind: 'box', size: [2.16, 0.95, 0.06], at: [1.6, 0.04, 3.2], rotate: [Math.PI / 2 - 0.06, 0, 0], look: 'paint', color: '#5c4c3a' })
dress({ kind: 'box', size: [0.06, 0.94, 0.58], at: [0.53, 0.475, 3.4], look: 'paint', color: '#5c4c3a' })
dress({ kind: 'box', size: [0.06, 0.94, 0.58], at: [2.67, 0.475, 3.4], look: 'paint', color: '#5c4c3a' })
standing(-4.45, 4.2, [0.85, 0.85, 2.0], { look: 'paint', color: '#6d4d3d', hit: 'wood' })
dress({ kind: 'box', size: [0.3, 0.5, 2.0], at: [-4.72, 1.1, 4.2], look: 'paint', color: '#5f4436' })
standing(4.6, 2.6, [0.6, 1.8, 1.0], { look: 'metal', color: '#6d7366' })
standing(-3.8, 8.6, [1.6, 0.9, 0.6], { look: 'cast', color: '#959593', hero: true, id: 'counter-lobby' })
rubble(3.0, 7.5, 0.9, 11)
dress({ kind: 'box', size: [1.5, 0.22, 1.2], at: [3.1, 0.42, 7.4], rotate: [0.42, 0.3, 0.12], look: 'slab' })
dress({ kind: 'cylinder', size: [0.012, 1.2, 0.012], at: [3.4, 0.9, 7.9], rotate: [0.6, 0, 0.3], look: 'rust', color: '#5a4030', segments: 4, cast: false })
dress({ kind: 'cylinder', size: [0.012, 1.4, 0.012], at: [2.6, 0.8, 7.0], rotate: [-0.4, 0, -0.5], look: 'rust', color: '#5a4030', segments: 4, cast: false })
radiator(-3.4, 9.86, 'x')
radiator(3.4, 9.86, 'x')
for (const [x, z, yaw] of [[-1.2, 4.6, 0.4], [-0.4, 3.0, 2.2], [3.9, 5.6, 1.4]] as const) {
  dress({ kind: 'box', size: [0.44, 0.04, 0.44], at: [x, 0.45, z], rotate: [0, yaw, 0], look: 'paint', color: '#4f5a46' })
  dress({ kind: 'box', size: [0.42, 0.46, 0.04], at: [x - Math.sin(yaw) * 0.21, 0.68, z - Math.cos(yaw) * 0.21], rotate: [0, yaw, 0], look: 'paint', color: '#4f5a46' })
  for (const [lx, lz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) dress({ kind: 'box', size: [0.03, 0.45, 0.03], at: [x + lx! * Math.cos(yaw) + lz! * Math.sin(yaw), 0.225, z - lx! * Math.sin(yaw) + lz! * Math.cos(yaw)], look: 'metal', color: '#2a2a26', cast: false })
}
dress({ kind: 'box', size: [0.44, 0.04, 0.44], at: [-0.9, 0.22, 7.6], rotate: [Math.PI / 2, 0.8, 0.2], look: 'paint', color: '#4f5a46' })
dress({ kind: 'box', size: [1.4, 0.9, 0.03], at: [-1.6, 1.7, 1.99], look: 'paint', color: '#4a4232', cast: false })
dress({ kind: 'box', size: [0.3, 0.42, 0.01], at: [-1.95, 1.75, 2.01], rotate: [0, 0, 0.05], look: 'stained', color: '#d1cfcc', cast: false })
dress({ kind: 'box', size: [0.24, 0.32, 0.01], at: [-1.4, 1.62, 2.01], rotate: [0, 0, -0.08], look: 'stained', color: '#c6c5c1', cast: false })
pipe([-4.8, 2.9, 2.1], [4.8, 2.9, 2.1], 0.06)
pipe([4.8, 0.2, 2.1], [4.8, 2.9, 2.1], 0.05)

dress({ kind: 'box', size: [0.4, 0.5, 1.6], at: [-0.85, 0.25, -3.4], rotate: [0, 0.08, 0], look: 'metal', color: '#59604f' })
box([-0.85, 0.25, -3.4], [0.42, 0.5, 1.6], { look: 'metal', render: false })
pipe([-1.1, 2.75, 1.6], [-1.1, 2.75, -4.8], 0.07)
pipe([-1.0, 2.55, 1.6], [-1.0, 2.55, -4.8], 0.04, '#454536')
dress({ kind: 'box', size: [0.3, 0.06, 6.4], at: [0.9, 2.8, -1.6], look: 'metal', color: '#4a4a40', cast: false })
rubble(0.4, -0.6, 0.4, 21, 'cast', false)

crate(3.0, 0.6, 1.0, 0, '#5c4a38')
crate(4.3, 0.9, 1.0, 0, '#5e5a3e', 0.1)
crate(4.3, 0.9, 0.8, 1.0, '#58503a', -0.2)
crate(2.3, -3.8, 0.9, 0, '#5c5238', 0.2)
shelving(4.65, -2.6, 2.2, 'z')
drum(2.1, -1.0)
drum(2.0, -0.3, '#5d4b36')
drum(3.0, -4.2, '#4f5a44', true)

standing(-3.0, -11, [0.45, 5, 0.45], { look: 'cast', hero: true, id: 'pillar-hall-west' })
standing(3.0, -11, [0.45, 5, 0.45], { look: 'cast', hero: true, id: 'pillar-hall-east' })
dress({ kind: 'box', size: [14, 0.36, 0.3], at: [0, 4.55, -11], look: 'rust', color: '#5a5040' })
dress({ kind: 'box', size: [0.5, 0.3, 0.7], at: [1.2, 4.3, -11], look: 'paint', color: '#a68a3a' })
dress({ kind: 'cylinder', size: [0.015, 2.4, 0.015], at: [1.2, 3.0, -11], look: 'metal', color: '#2a2a26', segments: 4, cast: false })
dress({ kind: 'box', size: [0.12, 0.2, 0.06], at: [1.2, 1.75, -11], look: 'metal', color: '#3b3b34' })
lathe(-4.6, -7.6)
lathe(-4.6, -14.2)
standing(1.6, -8.6, [1.8, 0.95, 0.6], { look: 'cast', color: '#9e9e9c', hero: true, id: 'plinth-south' })
standing(-0.8, -13.4, [1.8, 0.95, 0.6], { look: 'cast', color: '#9e9e9c', hero: true, id: 'plinth-middle' })
standing(3.4, -15.0, [0.6, 0.95, 1.8], { look: 'cast', color: '#9e9e9c', hero: true, id: 'plinth-north' })
standing(6.3, -8.0, [0.8, 0.9, 2.4], { look: 'metal', color: '#5b5f55' })
dress({ kind: 'box', size: [0.4, 0.3, 0.3], at: [6.3, 1.05, -7.4], look: 'paint', color: '#4a5a4a' })
dress({ kind: 'cylinder', size: [0.05, 0.4, 0.05], at: [6.2, 1.1, -8.6], look: 'metal', color: '#7d7f78', segments: 6 })
standing(6.3, -12.0, [0.8, 0.9, 2.4], { look: 'metal', color: '#5b5f55' })
dress({ kind: 'box', size: [0.5, 0.2, 0.36], at: [6.25, 1.0, -12.5], look: 'rust', color: '#6a5a44' })
standing(5.4, -15.6, [0.6, 1.9, 0.6], { look: 'paint', color: '#55645a', hit: 'metal' })
dress({ kind: 'box', size: [0.5, 0.4, 0.8], at: [5.4, 1.75, -15.4], look: 'paint', color: '#4e5d53' })
shelving(-6.45, -16.0, 2.0, 'z')
shelving(-6.45, -11.2, 2.0, 'z')
crate(0.6, -16.2, 1.2, 0, '#5c4a38')
crate(-0.8, -16.3, 1.0, 0, '#5e5a3e', 0.15)
crate(0.6, -16.2, 0.9, 1.2, '#585038', -0.3)
drum(5.9, -6.0)
drum(6.4, -6.3, '#5d4b36')
drum(5.6, -6.65, '#4f5a44')
drum(-6.3, -6.0, '#5d4b36')
drum(-5.7, -5.9)
drum(4.2, -16.4, '#4f5a44')
drum(4.8, -16.5, '#5d4b36', true)
box([-1.1, 0.42, -10.6], [0.6, 0.84, 0.6], { look: 'rust', color: '#3f3a30', render: false })
dress({ kind: 'cylinder', size: [0.29, 0.84, 0.29], at: [-1.1, 0.42, -10.6], look: 'rust', color: '#3f3a30', segments: 14 })
rubble(-3.0, -9.0, 1.2, 31)
dress({ kind: 'box', size: [1.8, 0.26, 1.4], at: [-2.9, 0.5, -9.1], rotate: [0.36, 0.6, -0.2], look: 'cast' })
rubble(3.5, -13.0, 1.1, 41)
dress({ kind: 'box', size: [1.6, 0.26, 1.2], at: [3.6, 0.45, -13.1], rotate: [-0.3, 1.1, 0.25], look: 'cast' })
pipe([-6.8, 4.0, -5.4], [-6.8, 4.0, -16.8], 0.09)
pipe([6.8, 3.6, -5.4], [6.8, 3.6, -16.8], 0.07)
pipe([6.8, 0.3, -9.8], [6.8, 3.6, -9.8], 0.06)
dress({ kind: 'box', size: [1.3, 0.04, 0.12], at: [1.0, 4.4, -8.0], look: 'metal', color: '#3a3a34', cast: false })
dress({ kind: 'cylinder', size: [0.006, 0.6, 0.006], at: [0.5, 4.7, -8.0], look: 'metal', color: '#222', segments: 3, cast: false })
dress({ kind: 'cylinder', size: [0.006, 0.6, 0.006], at: [1.5, 4.7, -8.0], look: 'metal', color: '#222', segments: 3, cast: false })
for (const x of [-6.6, -3.4, 0.4, 3.6, 6.6]) dress({ kind: 'box', size: [0.25, 0.4, 12.2], at: [x, 4.8, -11.07], look: 'rust', color: '#4d4538', cast: false })

desk(-4.6, -20.8)
desk(-1.6, -22.6)
desk(-4.6, -23.6, 0, false)
desk(1.8, -19.4, 1)
cabinet(0.4, -24.6)
cabinet(0.95, -24.6)
cabinet(1.5, -24.6)
cabinet(-6.6, -18.6, 'z')
standing(-2.9, -19.2, [0.08, 1.7, 2.2], { look: 'paint', color: '#6f7a66' })
standing(-0.2, -20.4, [2.0, 1.7, 0.08], { look: 'paint', color: '#6f7a66' })
standing(-6.4, -24.4, [0.7, 1.0, 0.7], { look: 'metal', color: '#3c4038' })
dress({ kind: 'box', size: [0.05, 0.3, 0.3], at: [-6.04, 0.6, -24.4], look: 'metal', color: '#22231f', cast: false })
dress({ kind: 'box', size: [1.9, 0.18, 0.85], at: [-5.8, 0.09, -18.4], rotate: [0, 0.2, 0], look: 'paint', color: '#6d6248' })
rubble(4.2, -21.5, 1.0, 51)
for (let index = 0; index < 14; index++) {
  const x = -6 + ((index * 37) % 80) / 10
  const z = -24.2 + ((index * 53) % 64) / 10
  dress({ kind: 'box', size: [0.21, 0.004, 0.29], at: [x, 0.004 + index * 0.0004, z], rotate: [0, index * 0.7, 0], look: 'stained', color: index % 3 ? '#d4ccb2' : '#bdb293', cast: false })
}
radiator(-6.86, -22.5, 'z')
pipe([-6.9, 2.7, -17.6], [-6.9, 2.7, -24.9], 0.05)

const blastEdge = [[3.15, 2.6, -22.8, 0.5, 0.5, 0.6], [3.2, 2.45, -20.2, 0.6, 0.4, 0.5], [3.1, 0.3, -22.8, 0.5, 0.6, 0.4], [3.2, 0.25, -20.2, 0.4, 0.5, 0.5]] as const
for (const [x, y, z, sx, sy, sz] of blastEdge) dress({ kind: 'box', size: [sx, sy, sz], at: [x, y, z], rotate: [0.4, 0.3, 0.5], look: 'panel', color: '#a4a3a2' })

for (const [x, z, h] of [[-9.6, 19.4, 0.72], [-8.4, 19.7, 0.72], [-7.2, 19.9, 0.72], [-2.6, 13.0, 0.96], [-1.6, 13.2, 0.96], [2.4, 12.8, 0.72]] as const) {
  box([x, h / 2, z], [1.1, h, 0.6], { look: 'dirt', color: '#8b8266', render: false })
  for (let row = 0; row < Math.round(h / 0.24); row++) for (const side of [-1, 1]) dress({ kind: 'sandbag', size: [0.58, 0.24, 0.56], at: [x + side * 0.27 + (row % 2) * 0.06, row * 0.24 + 0.12, z], rotate: [0, (row * 0.17) % 0.2 - 0.1, 0], look: 'dirt', color: row % 2 ? '#8d8468' : '#7c7559' })
}
rubble(-11.0, 13.6, 1.4, 61)
rubble(12.6, 14.8, 1.2, 71)
rubble(8.0, -19.0, 0.9, 81)
standing(-12.5, 25.0, [2.4, 0.6, 1.2], { look: 'cast', color: '#959593' })
standing(13.0, 12.6, [1.2, 1.1, 2.6], { look: 'cast', color: '#8b8b89' })

dumpster(-7.2, 11.3)
drum(-5.7, 10.95, '#5d4b36')
drum(-5.5, 11.9, '#4f5a44', true)
tyres(-9.0, 11.0, 3)
pallet(-10.3, 10.9, 1, 'x', 0, false)
dress({ kind: 'box', size: [1.2, 0.12, 0.8], at: [-11.7, 0.55, 10.62], rotate: [1.35, 0, 0], look: 'paint', color: '#6b5a44' })
rubble(6.2, 11.4, 1.1, 91, 'panel')
bench(3.4, 10.95, 'x', true)
pallet(8.4, 11.15, 3)
drum(7.8, 12.8, '#3f3a30')
drum(9.6, 11.05, '#4f5a44')
drum(9.75, 11.7, '#5d4b36')
footings(-19.0, 15.5, 'z', 2)
dress({ kind: 'box', size: [0.6, 0.6, 2.4], at: [-17.9, 0.42, 15.2], rotate: [0.3, 0.08, 0], look: 'cast', color: '#959593' })
container(-18.6, 26.4, 'z', '#5d6552')
tyres(-16.4, 24.0, 2)
pallet(-16.2, 28.7, 2, 'z')
container(18.6, 16.8, 'z', '#6b4e3d')
footings(18.9, 26.6, 'z', 2)
spool(16.6, 25.4)
drum(17.2, 28.6, '#4f5a44')
drum(16.6, 28.95, '#5d4b36', true)
booth(-7.4, 27.8)
tyres(-5.4, 29.3, 2)
bench(-10.2, 29.4, 'x')
standing(5.6, 29.4, [0.18, 6.4, 0.18], { look: 'metal', color: '#3a3c30', render: false })
cylinders(4.75, -0.65, ['#8a2f24', '#4a5a6a'])
workbench(3.5, 1.35, 'x')
tyres(1.95, -4.3, 2, false)
workbench(-6.6, -9.1, 'z')
standing(-2.8, -5.42, [1.2, 1.9, 0.5], { look: 'paint', color: '#55645a', hit: 'metal', render: false })

pallet(14.4, -25.8, 2)
crate(14.4, -25.8, 0.7, 0.28, '#5c4a38', 0.08)
crate(13.5, -26.1, 0.8, 0, '#5e5a3e', -0.12)
drum(15.0, -24.4, '#4f5a44')
drum(14.25, -24.65, '#5d4b36', true)
tyres(15.1, -22.8, 3)
spool(14.7, -20.6)
footings(13.6, -18.1, 'x', 2)
cylinders(15.55, -19.0, ['#8a2f24', '#4a5a6a'])
bench(5.5, -26.4, 'x', true)
for (const [x, z, yaw] of [[14.1, -23.8, 0.3], [13.8, -25.0, 1.5], [5.8, -25.8, 2.1]] as const) dress({ kind: 'box', size: [0.21, 0.004, 0.29], at: [x, 0.015, z], rotate: [0, yaw, 0], look: 'stained', color: '#c6c5c1', cast: false })

export const LEVEL = { blocks, decor, voids }

export const ENCOUNTERS: Encounter[] = [
  {
    id: 'lobby', room: 'lobby', objective: [0, 5.8], callout: 'Contact at the door!',
    trigger: { min: [-6, 9.4], max: [6, 14.5] },
    soldiers: [{ id: 'lobby-1', at: [-2.4, 5.4], facing: 0 }, { id: 'lobby-2', at: [1.6, 2.7], facing: 0.2, crouch: true }],
  },
  {
    id: 'hall', room: 'hall', objective: [0.2, -7.4], callout: 'They took the lobby. Set up on the corridor!',
    trigger: { min: [-1.3, -4.9], max: [5.1, 1.8] },
    soldiers: [
      { id: 'hall-1', at: [-2.6, -15.6], facing: 0 },
      { id: 'hall-2', at: [2.2, -16.6], facing: 0 },
      { id: 'hall-3', at: [1.4, -9.6], facing: 0, crouch: true },
      { id: 'hall-4', at: [5.6, -10.2], facing: -0.4 },
    ],
  },
  {
    id: 'office', room: 'office', objective: [-3.4, -18.6], callout: 'Hold the records room!',
    trigger: { min: [-7, -17.2], max: [7, -14.6] },
    soldiers: [{ id: 'office-1', at: [-4.6, -22.1], facing: 0, crouch: true }, { id: 'office-2', at: [-1.6, -23.9], facing: 0.4 }, { id: 'office-3', at: [7.6, -23.6], facing: -1.4 }],
  },
]

export const REGIONS = [
  { id: 'yard', name: 'Yard', center: [0, 12.2] as Vec2, neighbors: ['lobby'] },
  { id: 'lobby', name: 'Lobby', center: [0, 6] as Vec2, neighbors: ['yard', 'corridor'] },
  { id: 'corridor', name: 'Corridor', center: [0, -1.5] as Vec2, neighbors: ['lobby', 'side', 'hall-south'] },
  { id: 'side', name: 'Store room', center: [3.3, -1.6] as Vec2, neighbors: ['corridor', 'hall-east'] },
  { id: 'hall-south', name: 'Hall south', center: [0, -7] as Vec2, neighbors: ['corridor', 'hall-west', 'hall-east', 'hall-north'] },
  { id: 'hall-west', name: 'Hall west', center: [-5.2, -11] as Vec2, neighbors: ['hall-south', 'hall-north'] },
  { id: 'hall-east', name: 'Hall east', center: [5, -11] as Vec2, neighbors: ['hall-south', 'hall-north', 'side'] },
  { id: 'hall-north', name: 'Hall north', center: [-1.6, -15] as Vec2, neighbors: ['hall-west', 'hall-east', 'hall-south', 'office'] },
  { id: 'office', name: 'Records office', center: [-2.4, -21] as Vec2, neighbors: ['hall-north', 'exfil'] },
  { id: 'exfil', name: 'Exfil yard', center: [9, -22] as Vec2, neighbors: ['office'] },
]

export const ANCHORS = [
  { id: 'front-door', kind: 'entry' as const, x: 0, z: 10.2 },
  { id: 'lobby-door', kind: 'entry' as const, x: 0, z: 1.85 },
  { id: 'side-door', kind: 'entry' as const, x: 1.35, z: -1.5 },
  { id: 'hall-door', kind: 'entry' as const, x: 0, z: -5 },
  { id: 'hall-side-door', kind: 'entry' as const, x: 4.3, z: -5 },
  { id: 'office-door', kind: 'entry' as const, x: -4.2, z: -17.15 },
  { id: 'breach', kind: 'entry' as const, x: 3.15, z: -21.5 },
  { id: 'lobby-desk', kind: 'cover' as const, x: 1.6, z: 2.75 },
  { id: 'lobby-pillar', kind: 'cover' as const, x: -2.4, z: 5.45 },
  { id: 'hall-plinth', kind: 'cover' as const, x: 1.6, z: -9.4 },
  { id: 'hall-overwatch', kind: 'overwatch' as const, x: -1.6, z: -15.4 },
  { id: 'hall-crates', kind: 'cover' as const, x: 0.6, z: -15.2 },
  { id: 'office-desk', kind: 'cover' as const, x: -4.6, z: -21.8 },
]

export const PRACTICALS: Practical[] = [
  { kind: 'bulb', at: [-0.4, 2.6, 5.8], room: 'lobby' },
  { kind: 'tube', at: [1.0, 4.36, -8.0], room: 'hall' },
  { kind: 'fire', at: [-1.1, 0.9, -10.6], room: 'hall' },
  { kind: 'emergency', at: [-6.84, 2.45, -19.2], room: 'office' },
]

export const SHAFTS: Shaft[] = [
  { at: [3.0, 1.6, 7.5], size: [1.6, 1.4], room: 'lobby' },
  { at: [-3.0, 2.5, -9.0], size: [2.0, 2.0], room: 'hall' },
  { at: [3.5, 2.5, -13.0], size: [2.0, 2.0], room: 'hall' },
]

export const CLUTTER: { room: RoomId; density: number; clear: { min: Vec2; max: Vec2 }[] }[] = [
  { room: 'lobby', density: 0.9, clear: [{ min: [-1.2, 8.6], max: [1.2, 10] }, { min: [-1.1, 2], max: [1.1, 3.4] }] },
  { room: 'corridor', density: 0.7, clear: [{ min: [-1.2, 0.8], max: [1.2, 1.7] }, { min: [-1.2, -4.85], max: [1.2, -4] }, { min: [0.4, -2.4], max: [1.2, -0.6] }, { min: [-1.2, -2.4], max: [-0.4, -0.6] }] },
  { room: 'side', density: 1.1, clear: [{ min: [1.5, -2.4], max: [2.4, -0.6] }, { min: [3.4, -4.85], max: [5.2, -4] }] },
  { room: 'hall', density: 1, clear: [{ min: [-1, -7.2], max: [1, -5] }, { min: [3.4, -7], max: [5.2, -5] }, { min: [-5.1, -17.2], max: [-3.3, -15.4] }] },
  { room: 'office', density: 1.3, clear: [{ min: [-5.1, -18.4], max: [-3.3, -17.3] }, { min: [2, -23.7], max: [3, -21.3] }, { min: [-7, -22.8], max: [-6.2, -20.2] }] },
]
export const INTERIOR = { min: [-7.6, -0.25, -25.6] as Vec3, max: [7.6, 5.75, 10.6] as Vec3 }

export const START = { position: [0, 0, 23] as Vec3, yaw: 0 }

export const EXFIL = { at: [7.6, -21.4] as Vec2, radius: 1.6 }

export const APC_AT: Vec3 = [11.2, 0, -22.6]

export const BOOKMARKS = [
  { name: 'yard', position: [0, 1.63, 20] as Vec3, target: [0, 1.6, 10] as Vec3, note: 'Spawn: the facade, the Lada and the APC, the skyline' },
  { name: 'door', position: [-1.6, 1.63, 13.2] as Vec3, target: [0.4, 1.4, 8] as Vec3, note: 'Contact at the lobby door' },
  { name: 'lobby', position: [3.6, 1.63, 9.2] as Vec3, target: [-2, 1.2, 3] as Vec3, note: 'Pillars, the overturned desk, the bulb and the roof-hole shaft' },
  { name: 'corridor', position: [0, 1.63, 1.4] as Vec3, target: [0, 1.5, -6] as Vec3, note: 'The tight corridor and the store-room opening' },
  { name: 'hall', position: [0, 1.63, -5.8] as Vec3, target: [-1, 1.5, -15] as Vec3, note: 'Lathes, shafts, the burning barrel and the fluorescent tube' },
  { name: 'hall-north', position: [4.4, 1.63, -16.4] as Vec3, target: [-4, 1.4, -7] as Vec3, note: 'The longest sightline, back across the hall' },
  { name: 'office', position: [-1.4, 1.63, -21.0] as Vec3, target: [-6, 1.3, -21.8] as Vec3, note: 'Desks, cabinets, the red lamp' },
  { name: 'exfil', position: [-0.6, 1.63, -21.2] as Vec3, target: [9, 1.4, -22] as Vec3, note: 'The breach out to the APC' },
]

export const FEEL_START = { position: [-17, 0, 22] as Vec3, yaw: -Math.PI / 2 }

export function roomAt(x: number, z: number): Room {
  for (const room of ROOMS) if (room.id !== 'yard' && x >= room.min[0] - 0.2 && x <= room.max[0] + 0.2 && z >= room.min[1] - 0.2 && z <= room.max[1] + 0.2) return room
  return ROOMS[0]!
}

export function footingAt(x: number, z: number): Footing {
  for (const patch of PATCHES) if (x >= patch.min[0] && x <= patch.max[0] && z >= patch.min[1] && z <= patch.max[1]) return patch.footing
  return roomAt(x, z).floor
}
