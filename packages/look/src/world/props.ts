import type { LevelBuilder } from './builder'

type Vec3 = [number, number, number]

function random(seed: number) {
  let state = seed >>> 0
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296 }
}

function frame(at: Vec3, yaw: number) {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return (x: number, y: number, z: number): Vec3 => [at[0] + x * c + z * s, at[1] + y, at[2] - x * s + z * c]
}

export function apartmentBlock(level: LevelBuilder, { at, floors, bays, seed, facing = 0, depth = 12 }: { at: Vec3; floors: number; bays: number; seed: number; facing?: number; depth?: number }) {
  const rand = random(seed)
  const place = frame(at, facing)
  const bay = 3.6
  const storey = 3
  const width = bays * bay
  const ruined = Array.from({ length: bays }, (_, index) => index >= bays - 3 ? Math.floor(rand() * 3) + (index === bays - 1 ? 2 : 0) : rand() > 0.85 ? 1 : 0)
  for (let column = 0; column < bays; column++) {
    const height = (floors - ruined[column]!) * storey
    const z = -width / 2 + bay * (column + 0.5)
    level.box([depth, height, bay], { name: 'panel', color: '#a6a291' }, { at: place(depth / 2, height / 2, z), rotate: facing, collide: false })
    for (let floor = 0; floor < floors - ruined[column]!; floor++) {
      const y = floor * storey
      const shade = rand()
      const glass = shade > 0.9 ? '#4a4334' : shade > 0.45 ? '#16170f' : '#22231b'
      level.box([0.08, 1.45, 1.55], { name: 'metal', color: glass, ao: false }, { at: place(-0.02, y + 1.6, z), rotate: facing, collide: false, shadow: false })
      level.box([0.12, 0.16, bay], { name: 'cast', color: '#8f8b7c', ao: false }, { at: place(-0.04, y + storey, z), rotate: facing, collide: false, shadow: false })
      if (floor > 0 && column % 3 === 1 && rand() > 0.25) {
        level.box([1.1, 0.14, 2.9], { name: 'cast', ao: false }, { at: place(-0.55, y + 0.1, z), rotate: facing, collide: false, shadow: false })
        level.box([0.08, 0.95, 2.9], { name: 'panel', color: rand() > 0.5 ? '#8c9784' : '#a19c8a', ao: false }, { at: place(-1.06, y + 0.6, z), rotate: facing, collide: false, shadow: false })
      }
    }
  }
  level.box([depth + 0.6, 0.7, width + 0.6], { name: 'cast', color: '#7f7b6e' }, { at: place(depth / 2, 0.35, 0), rotate: facing, collide: false })
  for (let index = 0; index < 4; index++) level.box([2.2 + rand() * 2, 0.8 + rand() * 1.4, 2 + rand() * 2], { name: 'cast' }, { at: place(-2 - rand() * 4, 0.4, width / 2 - 2 - rand() * 8), rotate: [rand() * 0.3, facing + rand() * 2, rand() * 0.3], collide: false })
}

export function lada(level: LevelBuilder, at: Vec3, yaw: number, color = '#3b342d') {
  const place = frame(at, yaw)
  const body = { name: 'rust', color } as const
  const glass = { name: 'metal', color: '#20221d', ao: false } as const
  level.box([4.05, 0.5, 1.62], body, { at: place(0, 0.46, 0), rotate: [0.015, yaw, 0.02] })
  level.box([1.1, 0.14, 1.56], body, { at: place(1.45, 0.76, 0), rotate: [0, yaw, -0.06], collide: false, shadow: false })
  level.box([0.8, 0.12, 1.56], body, { at: place(-1.6, 0.75, 0), rotate: [0, yaw, 0.04], collide: false, shadow: false })
  level.box([1.55, 0.52, 1.44], body, { at: place(-0.3, 1.0, 0), rotate: yaw, collide: false })
  level.box([0.06, 0.62, 1.38], glass, { at: place(0.62, 0.98, 0), rotate: [0, yaw, -0.62], collide: false, shadow: false })
  level.box([0.06, 0.58, 1.38], glass, { at: place(-1.22, 0.98, 0), rotate: [0, yaw, 0.58], collide: false, shadow: false })
  level.box([1.3, 0.36, 1.46], glass, { at: place(-0.3, 1.02, 0), rotate: yaw, collide: false, shadow: false })
  level.box([1.75, 0.08, 1.5], body, { at: place(-0.3, 1.3, 0), rotate: yaw, collide: false, shadow: false })
  for (const [x, z] of [[1.25, 0.74], [1.25, -0.74], [-1.3, 0.74], [-1.3, -0.74]] as const) level.cylinder(0.29, 0.2, { name: 'metal', color: '#1d1c19', ao: false }, { at: place(x, 0.24, z), rotate: [Math.PI / 2, 0, -yaw], collide: false }, 10)
}

export function shed(level: LevelBuilder, at: Vec3, size: [number, number, number], yaw: number, color = '#77735f') {
  const place = frame(at, yaw)
  const [length, height, width] = size
  const walls = { name: 'corrugated', color } as const
  level.box([length, height, width], walls, { at: place(0, height / 2, 0), rotate: yaw, collide: false })
  const pitch = 0.32
  const half = width / 2 / Math.cos(pitch) + 0.3
  for (const side of [-1, 1]) level.box([length + 0.6, 0.14, half], { name: 'corrugated', color: '#5f5a4b' }, { at: place(0, height + Math.tan(pitch) * width / 4, side * width / 4), rotate: [side * pitch, yaw, 0], collide: false })
  level.box([0.1, height * 0.7, width * 0.45], { name: 'metal', color: '#2a2a24', ao: false }, { at: place(-length / 2 - 0.03, height * 0.35, 0), rotate: yaw, collide: false, shadow: false })
}

export function waterTower(level: LevelBuilder, at: Vec3) {
  const steel = { name: 'rust', color: '#6b5c4f' } as const
  for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]] as const) level.cylinder(0.14, 16, steel, { at: [at[0] + x, 8, at[2] + z], collide: false }, 6)
  level.cylinder(3, 4.2, steel, { at: [at[0], 18, at[2]], collide: false }, 16)
  level.cylinder(3.3, 0.4, { name: 'rust', color: '#4f453c' }, { at: [at[0], 20.3, at[2]], collide: false }, 16)
}

export function apc(level: LevelBuilder, at: Vec3, yaw: number) {
  const place = frame(at, yaw)
  const hull = { name: 'metal', color: '#5c6048' } as const
  level.box([6.6, 1.25, 2.7], hull, { at: place(0, 1.25, 0), rotate: yaw })
  level.box([1.6, 0.9, 2.6], hull, { at: place(3.6, 1.15, 0), rotate: [0, yaw, 0.55], collide: false })
  level.box([5.2, 0.35, 2.3], hull, { at: place(-0.4, 2.05, 0), rotate: yaw })
  level.cylinder(0.62, 0.6, hull, { at: place(0.4, 2.45, 0), collide: false }, 12)
  level.cylinder(0.07, 2.2, { name: 'metal', color: '#3a3c30' }, { at: place(1.6, 2.5, 0), rotate: [0, yaw, Math.PI / 2 - 0.12], collide: false }, 8)
  for (const x of [-2.4, -0.8, 0.8, 2.4]) for (const z of [-1.35, 1.35]) level.cylinder(0.58, 0.42, { name: 'metal', color: '#24231e', ao: false }, { at: place(x, 0.56, z), rotate: [Math.PI / 2, 0, -yaw], collide: false }, 12)
}

export function deadTree(level: LevelBuilder, at: Vec3, height: number, yaw: number, collide: boolean) {
  const rand = random(Math.round(at[0] * 31 + at[2] * 17))
  const bark = { name: 'cast', color: '#4a4237' } as const
  level.cylinder(0.2, height, bark, { at: [at[0], height / 2, at[2]], collide }, 7)
  for (let index = 0; index < 5; index++) {
    const length = 1.4 + rand() * 2.2
    const tilt = 0.55 + rand() * 0.6
    const turn = yaw + index * 1.3 + rand() * 0.5
    const baseY = height * (0.45 + index * 0.1)
    const dx = -Math.sin(tilt) * Math.cos(turn)
    const dz = Math.sin(tilt) * Math.sin(turn)
    const dy = Math.cos(tilt)
    level.cylinder(0.06 + rand() * 0.04, length, bark, { at: [at[0] + dx * length / 2, baseY + dy * length / 2, at[2] + dz * length / 2], rotate: [0, turn, tilt], collide: false, shadow: false }, 5)
  }
}
