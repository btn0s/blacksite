import * as THREE from 'three'
import type { Obstacle, Spawn } from '@blacksite/relay'
import { LevelBuilder, groundMaterial, puddleMaterial, worldPlaneGeometry, apartmentBlock, apc, deadTree, lada, shed, waterTower, type Collider } from '@blacksite/look/world'

export const HALF = { x: 22, z: 14 }

export const SPAWNS: Spawn[] = [
  { position: { x: -19, y: 0, z: 0 }, yaw: 0 },
  { position: { x: 19, y: 0, z: 0 }, yaw: 180 },
  { position: { x: -18.5, y: 0, z: -7.5 }, yaw: 25 },
  { position: { x: 18.5, y: 0, z: 7.5 }, yaw: -155 },
  { position: { x: -18.5, y: 0, z: 7.5 }, yaw: -25 },
  { position: { x: 18.5, y: 0, z: -7.5 }, yaw: 155 },
]

const HALF_ROUTE: Array<[number, number]> = [[-17, 0], [-12.5, -4.5], [-8.5, -12.2], [-0.5, -12.4], [4.5, -6], [8.5, -10.5], [14, -11.5], [17.5, -5]]
export const ROUTE: Array<[number, number]> = [...HALF_ROUTE, ...HALF_ROUTE.map(([x, z]): [number, number] => [-x, -z])]

function boxBounds(collider: Collider): Obstacle {
  const rotation = new THREE.Euler(...collider.rotation)
  const extent = collider.kind === 'box' ? new THREE.Vector3(...collider.half) : new THREE.Vector3(collider.radius, collider.halfHeight, collider.radius)
  const box = new THREE.Box3(extent.clone().negate(), extent).applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rotation))
  box.translate(new THREE.Vector3(...collider.position))
  return { min: { x: box.min.x, y: box.min.y, z: box.min.z }, max: { x: box.max.x, y: box.max.y, z: box.max.z } }
}

function random(seed: number) {
  let state = seed
  return () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296 }
}

export function buildArena() {
  const level = new LevelBuilder()
  const rand = random(11)
  const cast = { name: 'cast' } as const
  const brick = { name: 'brick' } as const
  const panel = { name: 'panel' } as const
  const rust = { name: 'rust' } as const
  const stained = { name: 'stained' } as const

  const ground = new THREE.Mesh(worldPlaneGeometry(300, 300, 4), groundMaterial())
  ground.receiveShadow = true
  level.mesh(ground)
  level.collider({ kind: 'box', half: [150, 0.5, 150], position: [0, -0.5, 0], rotation: [0, 0, 0] })
  level.plane(44, 28, { name: 'slab', ao: false }, { at: [0, 0.015, 0] })
  level.plane(9, 28, { name: 'asphalt', ao: false }, { at: [0, 0.022, 0] })

  const wall = (x: number, z: number, w: number, d: number, h: number, material: { name: 'brick' | 'panel' | 'cast'; color?: string } = brick) => level.box([w, h, d], material, { at: [x, h / 2, z] })
  for (const side of [-1, 1]) {
    wall(-14, side * (HALF.z + 0.6), 16, 0.5, 3.4)
    wall(5, side * (HALF.z + 0.6), 14, 0.5, 2.6)
    wall(16.5, side * (HALF.z + 0.6), 11, 0.5, 3.8)
    wall(side * (HALF.x + 0.6), -8, 0.5, 13, 3.6)
    wall(side * (HALF.x + 0.6), 8, 0.5, 13, 3.1)
    for (const x of [-21.5, -6, 12, 21.5]) level.box([0.42, 4.1, 0.42], cast, { at: [x, 2.05, side * (HALF.z + 0.6)] })
  }
  level.collider({ kind: 'box', half: [HALF.x + 1, 3, 0.4], position: [0, 3, HALF.z + 0.6], rotation: [0, 0, 0] })
  level.collider({ kind: 'box', half: [HALF.x + 1, 3, 0.4], position: [0, 3, -HALF.z - 0.6], rotation: [0, 0, 0] })
  level.collider({ kind: 'box', half: [0.4, 3, HALF.z + 1], position: [HALF.x + 0.6, 3, 0], rotation: [0, 0, 0] })
  level.collider({ kind: 'box', half: [0.4, 3, HALF.z + 1], position: [-HALF.x - 0.6, 3, 0], rotation: [0, 0, 0] })

  apc(level, [0, 0, -1], 0)

  for (const side of [-1, 1]) {
    for (const z of [-4.2, 3.6]) level.box([0.62, 0.82, 2.2], cast, { at: [side * 6.5, 0.41, z * side] })
    level.box([6.1, 2.6, 2.44], { name: 'corrugated', color: side < 0 ? '#7d7a64' : '#5f6a63' }, { at: [side * 11.5, 1.3, -side * 7.2] })
    level.box([6.1, 2.6, 2.44], { name: 'corrugated', color: '#8a5d45' }, { at: [side * 12.2, 3.9, -side * 7.4] })
    level.box([1.3, 1.25, 1.3], rust, { at: [side * 8, 0.625, -side * 7.6] })
    level.box([0.5, 1.1, 4.8], brick, { at: [side * 15, 0.55, side * 1.2] })
    level.box([0.5, 2.4, 1.6], brick, { at: [side * 15, 1.2, side * 4.4] })
    level.box([3.4, 2.7, 3.4], { name: 'paint' }, { at: [side * 18.4, 1.35, side * 11] })
    level.box([3.8, 0.22, 3.8], cast, { at: [side * 18.4, 2.81, side * 11] })
    level.box([0.08, 0.9, 1.6], { name: 'metal', color: '#3b3d35' }, { at: [side * (18.4 - 1.73), 1.6, side * 11], collide: false, shadow: false })
    for (const [x, z] of [[13.2, -2.6], [13.8, -1.9]] as const) level.cylinder(0.3, 0.9, { name: 'rust', color: side < 0 ? '#3f5a4c' : undefined }, { at: [side * x, 0.45, side * z] }, 14)
  }

  level.box([10, 1.2, 3.6], cast, { at: [0, 0.6, 11.2] })
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) level.box([0.6, 0.3 * (i + 1), 2.2], cast, { at: [side * (6.3 - i * 0.6), 0.15 * (i + 1), 11.2] })
  level.box([10, 3.2, 0.5], brick, { at: [0, 2.8, 13.25] })
  level.box([0.4, 2.4, 0.4], cast, { at: [-4.6, 2.4, 9.6] })
  level.box([0.4, 2.4, 0.4], cast, { at: [4.6, 2.4, 9.6] })
  level.box([10.4, 0.3, 4.2], cast, { at: [0, 3.75, 11.3], collide: false })
  for (let i = 0; i < 4; i++) level.box([0.35, 0.4, 4.2], rust, { at: [-3.9 + i * 2.6, 4.1, 11.3], collide: false })

  lada(level, [-3.2, 0, -10.4], 0)
  lada(level, [13.6, 0, 12], Math.PI, '#4a3b30')
  level.box([2.2, 0.82, 0.62], cast, { at: [-10.5, 0.31, 1.8], rotate: [0.16, 0, -0.3] })

  for (let i = 0; i < 22; i++) {
    const size = 0.2 + rand() * 0.45
    const x = (rand() - 0.5) * 40
    const z = (rand() - 0.5) * 24
    if (Math.abs(x) < 4 && Math.abs(z) < 3) continue
    level.box([size * (1 + rand()), size * 0.6, size], i % 3 ? cast : stained, { at: [x, size * 0.25, z], rotate: [rand() * 0.4, rand() * 3, rand() * 0.4], collide: false })
  }

  apartmentBlock(level, { at: [38, 0, 6], floors: 9, bays: 9, seed: 3 })
  apartmentBlock(level, { at: [-12, 0, 32], floors: 6, bays: 8, seed: 9, facing: Math.PI / 2 })
  apartmentBlock(level, { at: [8, 0, -32], floors: 8, bays: 9, seed: 21, facing: -Math.PI / 2 })
  apartmentBlock(level, { at: [-40, 0, -4], floors: 7, bays: 8, seed: 5, facing: Math.PI })
  shed(level, [26, 0, 26], [20, 6.5, 12], 0.4)
  shed(level, [-30, 0, -24], [18, 5.5, 10], -0.3, '#6c6e5d')
  waterTower(level, [-27, 0, 22])
  for (const [x, z, h, r] of [[-25, 10, 7, 0.3], [27, -12, 7.5, 1.4], [-6, -20, 8, 2.2], [14, 20, 6.5, 0.8], [-20, -18, 8.5, 1.9]] as const) deadTree(level, [x, 0, z], h, r, false)
  level.cylinder(1.8, 48, { name: 'brick', color: '#7a6a5f' }, { at: [60, 24, -50], collide: false }, 16)

  const puddles = puddleMaterial()
  for (const [x, z, w, d, r] of [[-5, 3.5, 2.6, 1.4, 0.3], [6.5, -2.4, 3.2, 1.6, -0.2], [-14, -8, 2.4, 1.3, 0.8], [13, 6.5, 2.2, 1.2, 1.2]] as const) {
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
  for (let i = 0; i < 5; i++) level.box([0.22, 7.5, 0.22], { name: 'metal', color: '#565a50' }, { at: [-20 + i * 10, 3.75, -HALF.z - 1.6], collide: false })
  for (let i = 0; i < 4; i++) level.box([4, 2.4, 0.18], panel, { at: [-18 + i * 12, 1.2, HALF.z + 2.2], rotate: 0.05 * (i - 1.5), collide: false })

  const group = level.build()
  const obstacles = level.colliders.filter(collider => !(collider.kind === 'box' && collider.half[0] > 100)).map(boxBounds)
  return { group, colliders: level.colliders, obstacles }
}
