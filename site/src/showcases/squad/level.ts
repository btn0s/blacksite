import * as THREE from 'three'
import { LevelBuilder, groundMaterial, puddleMaterial, worldPlaneGeometry, apartmentBlock, apc, deadTree, lada, shed, waterTower } from '@blacksite/look/world'
import { blocks, DEPTH, objective, WIDTH, type Block } from './compound'

function random(seed: number) {
  let state = seed
  return () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296 }
}

const cast = { name: 'cast' } as const
const metal = { name: 'metal' } as const
const dark = { name: 'metal', color: '#2a2b25', ao: false } as const

function container(level: LevelBuilder, b: Block) {
  const along = b.width >= b.depth
  const length = along ? b.width : b.depth
  const body = { name: 'corrugated', color: b.tint } as const
  level.box([b.width, b.height, b.depth], body, { at: [b.x, b.height / 2, b.z], collide: false })
  for (const end of [-1, 1]) {
    const offset = end * (length / 2 - 0.04)
    level.box(along ? [0.1, b.height + 0.04, b.depth + 0.04] : [b.width + 0.04, b.height + 0.04, 0.1], { name: 'rust', color: '#4d4335' }, { at: along ? [b.x + offset, b.height / 2, b.z] : [b.x, b.height / 2, b.z + offset], collide: false, shadow: false })
  }
  level.box(along ? [length + 0.02, 0.12, b.depth + 0.06] : [b.width + 0.06, 0.12, length + 0.02], { name: 'rust', color: '#4d4335' }, { at: [b.x, b.height - 0.06, b.z], collide: false, shadow: false })
}

function garage(level: LevelBuilder, b: Block, rand: () => number) {
  level.box([b.width, b.height, b.depth], { name: 'panel', color: '#b2ad9b' }, { at: [b.x, b.height / 2, b.z], collide: false })
  level.box([b.width + 0.5, 0.24, b.depth + 0.7], cast, { at: [b.x, b.height + 0.12, b.z], collide: false })
  const along = b.width >= b.depth
  const length = along ? b.width : b.depth
  const bays = Math.max(1, Math.floor(length / 3.6))
  for (let index = 0; index < bays; index++) {
    const offset = -length / 2 + (index + 0.5) * (length / bays)
    for (const side of [-1, 1]) {
      const open = rand() > 0.8
      const color = rand() > 0.5 ? '#5d6552' : '#6b4e3d'
      const face = side * ((along ? b.depth : b.width) / 2 + 0.03)
      level.box(along ? [2.6, open ? 0.9 : 2.5, 0.06] : [0.06, open ? 0.9 : 2.5, 2.6], { name: 'metal', color: open ? '#141510' : color }, { at: along ? [b.x + offset, open ? 2.05 : 1.28, b.z + face] : [b.x + face, open ? 2.05 : 1.28, b.z + offset], collide: false, shadow: false })
    }
  }
}

function barrier(level: LevelBuilder, b: Block) {
  const along = b.width >= b.depth
  const base = along ? [b.width, 0.4, b.depth] as const : [b.width, 0.4, b.depth] as const
  level.box([...base], cast, { at: [b.x, 0.2, b.z], collide: false })
  level.box(along ? [b.width - 0.04, b.height - 0.4, b.depth * 0.45] : [b.width * 0.45, b.height - 0.4, b.depth - 0.04], cast, { at: [b.x, 0.4 + (b.height - 0.4) / 2, b.z], collide: false })
  level.box(along ? [b.width - 0.1, 0.06, b.depth * 0.5] : [b.width * 0.5, 0.06, b.depth - 0.1], { name: 'paint', color: '#b04936' }, { at: [b.x, b.height - 0.25, b.z], collide: false, shadow: false })
}

function sandbags(level: LevelBuilder, b: Block, rand: () => number) {
  const along = b.width >= b.depth
  const length = along ? b.width : b.depth
  const rows = Math.round(b.height / 0.24)
  for (let row = 0; row < rows; row++) {
    const count = Math.max(1, Math.round(length / 0.62))
    for (let index = 0; index < count; index++) {
      const offset = -length / 2 + (index + 0.5 + (row % 2) * 0.25) * (length / (count + 0.25))
      const y = row * 0.24 + 0.13
      const tint = rand() > 0.5 ? '#8d8468' : '#7c7559'
      level.box(along ? [0.6, 0.24, b.depth * (0.95 - row * 0.03)] : [b.width * (0.95 - row * 0.03), 0.24, 0.6], { name: 'dirt', color: tint, ao: false }, { at: along ? [b.x + offset, y, b.z] : [b.x, y, b.z + offset], rotate: (rand() - 0.5) * 0.12, collide: false, shadow: row === 0 })
    }
  }
}

function crate(level: LevelBuilder, b: Block, rand: () => number) {
  level.box([b.width, b.height, b.depth], { name: 'paint', color: rand() > 0.5 ? '#56603f' : '#5e5236' }, { at: [b.x, b.height / 2, b.z], rotate: (rand() - 0.5) * 0.08, collide: false })
  level.box([b.width + 0.04, 0.08, b.depth + 0.04], dark, { at: [b.x, b.height * 0.66, b.z], collide: false, shadow: false })
}

function pallets(level: LevelBuilder, b: Block, rand: () => number) {
  const layers = Math.round(b.height / 0.3)
  for (let layer = 0; layer < layers; layer++) level.box([b.width - rand() * 0.2, 0.26, b.depth - rand() * 0.15], { name: 'rust', color: '#6e5a42' }, { at: [b.x + (rand() - 0.5) * 0.1, layer * 0.3 + 0.13, b.z], rotate: (rand() - 0.5) * 0.08, collide: false })
}

function generator(level: LevelBuilder, b: Block) {
  level.box([b.width, b.height * 0.75, b.depth], { name: 'paint', color: '#58664f' }, { at: [b.x, b.height * 0.375, b.z], collide: false })
  level.box([b.width * 0.6, b.height * 0.25, b.depth * 0.8], metal, { at: [b.x - b.width * 0.15, b.height * 0.875, b.z], collide: false })
  level.cylinder(0.12, 1.4, { name: 'rust' }, { at: [b.x + b.width * 0.35, b.height + 0.4, b.z], collide: false }, 8)
}

function kiosk(level: LevelBuilder, b: Block) {
  level.box([b.width, b.height, b.depth], { name: 'stained', color: '#9aa18e' }, { at: [b.x, b.height / 2, b.z], collide: false })
  level.box([b.width + 0.4, 0.14, b.depth + 0.4], { name: 'rust' }, { at: [b.x, b.height + 0.07, b.z], collide: false })
  level.box([b.width * 0.7, b.height * 0.3, 0.05], dark, { at: [b.x, b.height * 0.6, b.z + b.depth / 2 + 0.02], collide: false, shadow: false })
  level.box([b.width * 0.7, b.height * 0.3, 0.05], dark, { at: [b.x, b.height * 0.6, b.z - b.depth / 2 - 0.02], collide: false, shadow: false })
}

function truck(level: LevelBuilder, b: Block) {
  const along = b.width >= b.depth
  const length = along ? b.width : b.depth
  const wide = along ? b.depth : b.width
  const place = (offset: number, y: number, side = 0): [number, number, number] => along ? [b.x + offset, y, b.z + side] : [b.x + side, y, b.z + offset]
  const size = (l: number, h: number, w: number): [number, number, number] => along ? [l, h, w] : [w, h, l]
  const paint = { name: 'paint', color: b.tint } as const
  level.box(size(length * 0.66, b.height * 0.6, wide), { name: 'corrugated', color: b.tint }, { at: place(-length * 0.15, b.height * 0.6, 0), collide: false })
  level.box(size(length * 0.27, b.height * 0.72, wide * 0.94), paint, { at: place(length * 0.34, b.height * 0.52, 0), collide: false })
  level.box(size(0.05, b.height * 0.28, wide * 0.8), dark, { at: place(length * 0.48, b.height * 0.7, 0), collide: false, shadow: false })
  level.box(size(length * 0.98, 0.3, wide * 0.8), metal, { at: place(0, 0.62, 0), collide: false })
  for (const offset of [-0.32, -0.12, 0.34]) for (const side of [-1, 1]) level.cylinder(0.48, 0.34, { name: 'metal', color: '#22211c', ao: false }, { at: place(offset * length, 0.48, side * (wide / 2 - 0.12)), rotate: along ? [Math.PI / 2, 0, 0] : [0, 0, Math.PI / 2], collide: false }, 12)
}

function tank(level: LevelBuilder, b: Block) {
  const along = b.width >= b.depth
  const length = along ? b.width : b.depth
  const radius = Math.min(b.width, b.depth) / 2
  level.cylinder(radius, length, { name: 'rust', color: '#7a6b57' }, { at: [b.x, radius + 0.1, b.z], rotate: along ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0], collide: false }, 16)
  for (const end of [-0.3, 0.3]) level.box(along ? [0.3, 0.6, radius * 1.6] : [radius * 1.6, 0.6, 0.3], cast, { at: along ? [b.x + end * length, 0.3, b.z] : [b.x, 0.3, b.z + end * length], collide: false })
}

function brick(level: LevelBuilder, b: Block, rand: () => number) {
  level.box([b.width, b.height, b.depth], { name: 'brick' }, { at: [b.x, b.height / 2, b.z], collide: false })
  const along = b.width >= b.depth
  level.box(along ? [b.width + 0.1, 0.18, b.depth + 0.12] : [b.width + 0.12, 0.18, b.depth + 0.1], cast, { at: [b.x, b.height + 0.09, b.z], collide: false, shadow: false })
  for (let index = 0; index < 3; index++) {
    const size = 0.2 + rand() * 0.35
    level.box([size, size * 0.6, size], { name: 'brick' }, { at: [b.x + (rand() - 0.5) * b.width, size * 0.3, b.z + (along ? 1 : -1) * (b.depth / 2 + 0.3 + rand() * 0.4)], rotate: [rand(), rand() * 3, rand()], collide: false })
  }
}

export function buildCompound() {
  const level = new LevelBuilder()
  const rand = random(19)

  const ground = new THREE.Mesh(worldPlaneGeometry(360, 360, 4), groundMaterial())
  ground.receiveShadow = true
  level.mesh(ground)
  level.collider({ kind: 'box', half: [180, 0.5, 180], position: [0, -0.5, 0], rotation: [0, 0, 0] })
  level.plane(WIDTH, DEPTH, { name: 'asphalt', ao: false }, { at: [0, 0.012, 0] })
  level.plane(14, 12, { name: 'slab', ao: false }, { at: [0, 0.02, 0] })
  level.plane(WIDTH, 7, { name: 'slab', ao: false }, { at: [0, 0.018, -15] })
  level.plane(WIDTH, 7, { name: 'slab', ao: false }, { at: [0, 0.018, 15] })

  for (const b of blocks) {
    level.collider({ kind: 'box', half: [b.width / 2, b.height / 2, b.depth / 2], position: [b.x, b.height / 2, b.z], rotation: [0, 0, 0] })
    switch (b.kind) {
      case 'container': container(level, b); break
      case 'garage': garage(level, b, rand); break
      case 'barrier': barrier(level, b); break
      case 'sandbag': sandbags(level, b, rand); break
      case 'crate': crate(level, b, rand); break
      case 'pallet': pallets(level, b, rand); break
      case 'generator': generator(level, b); break
      case 'kiosk': kiosk(level, b); break
      case 'truck': truck(level, b); break
      case 'tank': tank(level, b); break
      case 'brick': brick(level, b, rand); break
      case 'lada': lada(level, [b.x, 0, b.z], b.width >= b.depth ? 0 : Math.PI / 2, b.tint); break
      case 'apc': apc(level, [b.x, 0, b.z], b.width >= b.depth ? 0 : Math.PI / 2); break
      case 'panel': level.box([b.width, b.height, b.depth], { name: 'panel' }, { at: [b.x, b.height / 2, b.z], collide: false }); break
    }
  }

  const fence = { name: 'panel', color: '#b9b4a2' } as const
  const post = { name: 'cast', color: '#9c978a' } as const
  for (const [axis, side, length] of [['x', -1, WIDTH], ['x', 1, WIDTH], ['z', -1, DEPTH], ['z', 1, DEPTH]] as const) {
    const count = Math.round(length / 4)
    for (let index = 0; index < count; index++) {
      const offset = -length / 2 + (index + 0.5) * (length / count)
      const broken = rand() > 0.88
      const height = broken ? 0.9 + rand() * 0.8 : 2.4
      const at: [number, number, number] = axis === 'x' ? [offset, height / 2, side * (DEPTH / 2 + 0.15)] : [side * (WIDTH / 2 + 0.15), height / 2, offset]
      level.box(axis === 'x' ? [length / count - 0.05, height, 0.16] : [0.16, height, length / count - 0.05], fence, { at, collide: false })
      level.box([0.3, 2.7, 0.3], post, { at: axis === 'x' ? [offset + length / count / 2, 1.35, at[2]] : [at[0], 1.35, offset + length / count / 2], collide: false, shadow: false })
    }
  }

  level.cylinder(0.09, 9, { name: 'rust', color: '#5d544a' }, { at: [objective.x + 0.6, 4.5, objective.z - 0.4], collide: false }, 8)
  for (let index = 0; index < 4; index++) level.box([0.9 - index * 0.15, 0.05, 0.05], dark, { at: [objective.x + 0.6, 6.4 + index * 0.75, objective.z - 0.4], rotate: index * 0.7, collide: false, shadow: false })
  level.box([0.7, 0.9, 0.5], { name: 'paint', color: '#4e5845' }, { at: [objective.x + 0.6, 0.45, objective.z - 0.4], collide: false })

  for (let index = 0; index < 34; index++) {
    const size = 0.18 + rand() * 0.5
    const x = (rand() - 0.5) * (WIDTH - 2)
    const z = (rand() - 0.5) * (DEPTH - 2)
    if (blocks.some(b => Math.abs(x - b.x) < b.width / 2 + 0.5 && Math.abs(z - b.z) < b.depth / 2 + 0.5)) continue
    level.box([size * (1 + rand()), size * 0.5, size], index % 3 ? cast : { name: 'brick' }, { at: [x, size * 0.2, z], rotate: [rand() * 0.4, rand() * 3, rand() * 0.4], collide: false, shadow: false })
  }

  apartmentBlock(level, { at: [-18, 0, -46], floors: 9, bays: 10, seed: 3, facing: -Math.PI / 2 })
  apartmentBlock(level, { at: [30, 0, -44], floors: 6, bays: 7, seed: 9, facing: -Math.PI / 2 + 0.2 })
  apartmentBlock(level, { at: [58, 0, 10], floors: 9, bays: 9, seed: 21, facing: 0 })
  apartmentBlock(level, { at: [-60, 0, -8], floors: 7, bays: 8, seed: 5, facing: Math.PI })
  apartmentBlock(level, { at: [10, 0, 50], floors: 5, bays: 9, seed: 13, facing: Math.PI / 2 })
  shed(level, [-46, 0, 30], [22, 6.5, 12], 0.15)
  shed(level, [44, 0, 34], [18, 5.5, 10], -0.3, '#6c6e5d')
  waterTower(level, [-44, 0, -30])
  apc(level, [-38, 0, 12], 1.1)
  lada(level, [38, 0, -16], 2.2, '#4a3b30')
  lada(level, [-36, 0, -18], 0.4)
  level.cylinder(1.8, 48, { name: 'brick', color: '#7a6a5f' }, { at: [74, 24, -52], collide: false }, 16)
  for (const [x, z, h, r] of [[-38, -4, 7, 0.3], [-40, 20, 6, 1.4], [38, 22, 8, 2.2], [40, -26, 7.5, 0.8], [-24, 30, 6.5, 3.1], [24, -30, 8.5, 1.9], [-12, -32, 9, 0.2], [12, 31, 7, 1.1], [52, -4, 8, 2.6], [-52, 6, 7.2, 0.9]] as const) deadTree(level, [x, 0, z], h, r, false)
  for (let index = 0; index < 9; index++) {
    const x = -48 + index * 12
    level.box([0.28, 9, 0.28], cast, { at: [x, 4.5, -28], collide: false })
    level.box([2.4, 0.16, 0.18], cast, { at: [x, 8.55, -28], rotate: [0, Math.PI / 2, 0], collide: false, shadow: false })
  }

  const puddles = puddleMaterial()
  for (const [x, z, w, d, r] of [[-20, 1.5, 2.6, 1.4, 0.3], [-4, -14, 3.4, 1.8, -0.2], [9, 15, 4.2, 2.4, 0.6], [22, -2, 2.2, 1.3, 1.2], [3, 3.6, 2, 1.1, 0.1], [-12, 15, 3, 1.5, 0.4]] as const) {
    for (const [ox, oz, k] of [[0, 0, 1], [w * 0.32, d * 0.18, 0.62], [-w * 0.28, -d * 0.12, 0.55]] as const) {
      const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.5, 18), puddles)
      puddle.rotation.set(-Math.PI / 2, 0, r + k)
      puddle.scale.set(w * k, d * k, 1)
      puddle.position.set(x + ox, 0.03, z + oz)
      puddle.receiveShadow = true
      puddle.renderOrder = 2
      level.mesh(puddle)
    }
  }

  const group = level.build()
  return { group, colliders: level.colliders }
}
