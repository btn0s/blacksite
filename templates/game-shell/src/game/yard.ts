import * as THREE from 'three'
import type { Bookmark } from '@blacksite/check'
import { LevelBuilder, apartmentBlock, apc, deadTree, groundMaterial, lada, puddleMaterial, shed, waterTower, worldPlaneGeometry } from '@blacksite/look/world'

export type Surface = 'concrete' | 'metal' | 'dirt' | 'water'

const puddleSpots = [[3, -1.4, 2.6, 1.4, 0.3], [17, 1.8, 3.4, 1.8, -0.2], [35, -2.2, 4, 2.2, 0.6], [50, 2.4, 2.4, 1.3, 1.2]] as const

export function surfaceAt(x: number, y: number, z: number): Surface {
  if (y < 0.25 && puddleSpots.some(([px, pz, width, depth]) => {
    const dx = (x - px) * 2 / width
    const dz = (z - pz) * 2 / depth
    return dx * dx + dz * dz < 1
  })) return 'water'
  if (y > 2.2 && x > 20.5 && x < 28 && z > -11 && z < -7.5) return 'metal'
  if (y > 2.2 && x > 28.8 && x < 31.6 && z > -11 && z < -4.7) return 'metal'
  if ((x > -10 && x < 74 && Math.abs(z) < 4) || (x > 13 && x < 35 && Math.abs(z) < 9)) return 'concrete'
  return 'dirt'
}

function random(seed: number) {
  let state = seed
  return () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296 }
}

export function buildYard() {
  const level = new LevelBuilder()
  const rand = random(11)
  const cast = { name: 'cast' } as const
  const panel = { name: 'panel' } as const
  const rust = { name: 'rust' } as const
  const stained = { name: 'stained' } as const

  const ground = new THREE.Mesh(worldPlaneGeometry(360, 360, 4), groundMaterial())
  ground.position.set(30, 0, 0)
  ground.receiveShadow = true
  level.mesh(ground)
  level.collider({ kind: 'box', half: [180, 0.5, 180], position: [30, -0.5, 0], rotation: [0, 0, 0] })
  level.plane(84, 8, { name: 'asphalt', ao: false }, { at: [32, 0.012, 0] })
  level.plane(22, 18, { name: 'slab', ao: false }, { at: [24, 0.02, 0] })

  for (const [x, z, r] of [[6, -4.9, 0.06], [8.6, -5.1, -0.04], [6.4, 4.8, -0.08], [9, 5.2, 0.1], [40, -4.8, 0.2]] as const) level.box([2.2, 0.82, 0.62], cast, { at: [x, 0.41, z], rotate: r })
  level.box([2.2, 0.82, 0.62], cast, { at: [42.6, 0.31, -5.6], rotate: [0.18, 0.5, -0.35] })

  shed(level, [20, 0, 9.5], [8, 3.2, 5], 0.04)
  level.box([1.2, 1.2, 1.2], rust, { at: [15, 0.6, 6.4], rotate: 0.2 })
  level.box([0.9, 0.9, 0.9], stained, { at: [15.4, 1.65, 6.3], rotate: 0.7 })
  level.box([1.1, 0.8, 1.6], cast, { at: [24.6, 0.4, 6.2], rotate: -0.1 })
  for (const [x, z] of [[13.2, 8.2], [13.9, 8.8], [13.1, 9.4], [26.4, 7.4]] as const) level.cylinder(0.3, 0.9, { name: 'rust', color: x > 20 ? '#3f5a4c' : undefined }, { at: [x, 0.45, z] }, 14)
  level.cylinder(0.3, 0.9, rust, { at: [14.8, 0.3, 9.6], rotate: [Math.PI / 2, 0.6, 0] }, 14)
  lada(level, [4.5, 0, 7.5], 0.45)

  level.box([6.1, 2.6, 2.44], { name: 'corrugated', color: '#7d7a64' }, { at: [24, 1.3, -9.2], rotate: 0.04 })
  level.box([6.1, 2.6, 2.44], { name: 'corrugated', color: '#8a5d45' }, { at: [24.8, 3.9, -9.5], rotate: -0.06 })
  level.box([6.1, 2.6, 2.44], { name: 'corrugated', color: '#5f6a63' }, { at: [30.2, 1.3, -7.8], rotate: Math.PI / 2 + 0.08 })
  level.box([1.3, 1.25, 1.3], rust, { at: [20.3, 0.625, -7.6], rotate: 0.3 })
  level.box([1.1, 1.3, 1.1], { name: 'metal' }, { at: [23.2, 3.25, -9.3], rotate: 0.5 })

  for (const side of [-1, 1]) {
    for (let i = 0; i < 16; i++) {
      const x = -8 + i * 4.1
      if (side === 1 && i === 11) continue
      if (side === -1 && i === 6) {
        level.box([4, 2.4, 0.18], panel, { at: [x, 0.62, side * 13.7], rotate: [0.42 * side, 0, 0] })
        continue
      }
      level.box([4, 2.4, 0.18], panel, { at: [x, 1.2, side * 13] })
      level.box([0.32, 2.7, 0.32], cast, { at: [x + 2.05, 1.35, side * 13] })
    }
  }

  for (let i = 0; i < 20; i++) {
    const size = 0.25 + rand() * 0.8
    const x = -6 + rand() * 64
    const z = (rand() - 0.5) * 22
    if (Math.abs(z) < 5.2) continue
    level.box([size * (1 + rand()), size * 0.7, size], i % 3 ? cast : stained, { at: [x, size * 0.3, z], rotate: [rand() * 0.4, rand() * 3, rand() * 0.4], collide: size > 0.6 })
  }

  for (const [x, z] of [[2, 4.6], [30, -4.6], [56, 4.6]] as const) {
    level.box([0.22, 6.5, 0.22], { name: 'metal', color: '#565a50' }, { at: [x, 3.25, z] })
    level.box([1.6, 0.12, 0.14], { name: 'metal', color: '#565a50' }, { at: [x, 6.4, z - Math.sign(z) * 0.7], rotate: Math.PI / 2, collide: false, shadow: false })
  }

  apc(level, [58, 0, -2.2], -0.32)
  lada(level, [64, 0, 7.5], 2.4, '#4a3b30')
  apartmentBlock(level, { at: [84, 0, -4], floors: 9, bays: 10, seed: 3 })
  apartmentBlock(level, { at: [-34, 0, 30], floors: 5, bays: 7, seed: 9, facing: Math.PI / 2 })
  apartmentBlock(level, { at: [40, 0, -46], floors: 7, bays: 8, seed: 21, facing: -Math.PI / 2 })
  shed(level, [46, 0, 30], [22, 6, 12], -0.1, '#6c6e5d')
  waterTower(level, [36, 0, -28])
  for (const [x, z, h, r] of [[-4, -10, 7, 0.3], [-10, 9, 6, 1.4], [18, 20, 8, 2.2], [52, -20, 7.5, 0.8], [70, 22, 6.5, 3.1], [-24, -18, 8.5, 1.9]] as const) deadTree(level, [x, 0, z], h, r, Math.abs(z) < 14)

  const puddles = puddleMaterial()
  for (const [x, z, w, d, r] of puddleSpots) {
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

  return { group: level.build(), colliders: level.colliders, spawn: [0, 0, 0] as [number, number, number] }
}

export const yard = buildYard()

export const bookmarks: Bookmark[] = [
  { name: 'spawn', position: [-4, 2.1, 0.6], target: [14, 1.2, 0] },
  { name: 'shed', position: [8, 1.8, 2], target: [20, 1.6, 9] },
  { name: 'containers', position: [14, 2, -2], target: [26, 2.4, -9] },
  { name: 'street', position: [36, 1.7, 2], target: [84, 9, -4] },
  { name: 'overview', position: [-14, 16, 22], target: [28, 0, -2] },
]
