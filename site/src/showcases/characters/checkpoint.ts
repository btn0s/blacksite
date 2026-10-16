import * as THREE from 'three'
import { LevelBuilder } from '../../look/builder'
import { groundMaterial, puddleMaterial, worldPlaneGeometry } from '../../look/look'
import { apartmentBlock, apc, deadTree, lada, shed, waterTower } from '../../look/props'

function random(seed: number) {
  let state = seed
  return () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296 }
}

export function buildCheckpoint() {
  const level = new LevelBuilder()
  const rand = random(7)
  const cast = { name: 'cast' } as const
  const panel = { name: 'panel' } as const
  const brick = { name: 'brick' } as const
  const rust = { name: 'rust' } as const
  const paint = { name: 'paint' } as const
  const stained = { name: 'stained' } as const

  const ground = new THREE.Mesh(worldPlaneGeometry(420, 420, 4), groundMaterial())
  ground.position.set(60, 0, 0)
  ground.receiveShadow = true
  level.mesh(ground)
  level.collider({ kind: 'box', half: [210, 0.5, 210], position: [60, -0.5, 0], rotation: [0, 0, 0] })
  level.plane(260, 7.5, { name: 'asphalt', ao: false }, { at: [40, 0.012, 0] })
  level.plane(46, 26, { name: 'slab', ao: false }, { at: [44, 0.02, -2] })

  for (const [x, z, r] of [[9, -2.1, 0.08], [11.5, 1.6, -0.05], [14, -1.2, 0.12], [26, 1.4, -0.3], [27.4, 2.3, -0.1]] as const) level.box([2.2, 0.82, 0.62], cast, { at: [x, 0.41, z], rotate: Math.PI / 2 + r })
  level.box([2.2, 0.82, 0.62], cast, { at: [20.5, 0.31, 3.8], rotate: [0.18, 0.4, -0.35] })

  level.box([3.4, 2.7, 3.4], paint, { at: [15, 1.35, 6.2] })
  level.box([3.8, 0.22, 3.8], cast, { at: [15, 2.81, 6.2] })
  level.box([1.6, 0.9, 0.08], { name: 'metal', color: '#3b3d35' }, { at: [15, 1.6, 4.47], collide: false, shadow: false })
  level.box([0.08, 0.9, 1.6], { name: 'metal', color: '#3b3d35' }, { at: [13.27, 1.6, 6.2], collide: false, shadow: false })
  level.box([1.2, 1.2, 1.2], rust, { at: [17.4, 0.6, 7.2], rotate: 0.2 })
  level.cylinder(0.13, 1.2, rust, { at: [13.2, 0.6, 3.9] }, 8)
  for (let i = 0; i < 5; i++) level.box([0.14, 0.14, 1.2], { name: 'paint', color: i % 2 ? '#d8d1bf' : '#b04936' }, { at: [13.2, 1.15, 3.2 - i * 1.2], collide: false, shadow: false })

  for (const side of [-1, 1]) {
    for (let i = 0; i < 13; i++) {
      const x = 21 + i * 4.1
      if (side === 1 && (i === 6 || i === 7)) continue
      if (side === -1 && i === 9) {
        level.box([4, 2.4, 0.18], panel, { at: [x, 0.62, side * 15.3], rotate: [0.42 * side, 0, 0] })
        continue
      }
      level.box([4, 2.4, 0.18], panel, { at: [x, 1.2, side * 14.6] })
      level.box([0.32, 2.7, 0.32], cast, { at: [x + 2.05, 1.35, side * 14.6] })
    }
  }

  level.box([6.1, 2.6, 2.44], { name: 'corrugated', color: '#7d7a64' }, { at: [36, 1.3, -10.5], rotate: 0.04 })
  level.box([6.1, 2.6, 2.44], { name: 'corrugated', color: '#8a5d45' }, { at: [37, 3.9, -10.8], rotate: -0.06 })
  level.box([6.1, 2.6, 2.44], { name: 'corrugated', color: '#5f6a63' }, { at: [41.5, 1.3, -7.6], rotate: Math.PI / 2 + 0.08 })
  level.box([1.3, 1.25, 1.3], rust, { at: [32.3, 0.625, -9.3], rotate: 0.3 })
  level.box([1.1, 1.3, 1.1], { name: 'metal' }, { at: [35.2, 3.25, -10.6], rotate: 0.5 })

  level.box([18, 1.2, 4.2], cast, { at: [44, 0.6, 7.1] })
  for (let i = 0; i < 4; i++) level.box([1.2, 0.3 * (i + 1), 1.8], cast, { at: [34.4 + i * 0.4 - 1.2 + i * 0.0, 0.15 * (i + 1), 7.1], collide: true })
  const wall = (x: number, z: number, w: number, d: number, h: number, base = 0) => level.box([w, h, d], brick, { at: [x, base + h / 2, z] })
  wall(44, 9.45, 18, 0.5, 1.4)
  wall(36.2, 9.45, 2.4, 0.5, 6.4)
  wall(41.7, 9.45, 3.2, 0.5, 6.4)
  wall(48.7, 9.45, 4.6, 0.5, 6.4)
  wall(52.75, 9.45, 0.5, 0.5, 6.4)
  wall(44, 9.45, 18, 0.5, 1.2, 4.6)
  wall(35.25, 14.2, 0.5, 9.5, 6.4)
  wall(52.75, 14.2, 0.5, 9.5, 4.2)
  wall(44, 18.95, 18, 0.5, 6.4)
  level.box([8, 0.3, 9.5], cast, { at: [39.5, 3.4, 14.2] })
  level.box([0.4, 3.25, 0.4], cast, { at: [43.3, 1.62, 11] })
  level.box([0.4, 3.25, 0.4], cast, { at: [43.3, 1.62, 17.6] })
  for (let i = 0; i < 5; i++) level.box([1.4 + rand() * 0.6, 0.6, 1.6 + rand() * 0.4], cast, { at: [47.5 + i * 0.25, 0.3 + i * 0.6, 14 - i * 0.35], rotate: [0.1 * (rand() - 0.5), rand(), 0.15 * (rand() - 0.5)] })
  for (let i = 0; i < 4; i++) level.box([0.35, 0.5, 9.5], { name: 'rust' }, { at: [38 + i * 4.4, 6.65, 14.2], rotate: [0, 0, 0.04 * (i - 1.5)], collide: false })

  for (const [x, z] of [[26, -6.5], [27.1, -7], [26.5, -5.4], [52, -8], [30.5, 5]] as const) level.cylinder(0.3, 0.9, { name: 'rust', color: x > 50 ? '#3f5a4c' : undefined }, { at: [x, 0.45, z] }, 14)
  level.cylinder(0.3, 0.9, rust, { at: [28.2, 0.3, -6.2], rotate: [Math.PI / 2, 0.6, 0] }, 14)
  for (let i = 0; i < 26; i++) {
    const size = 0.25 + rand() * 0.9
    const x = 22 + rand() * 50
    const z = (rand() - 0.5) * 24
    if (Math.abs(z) < 4.6 && x < 34) continue
    level.box([size * (1 + rand()), size * 0.7, size], i % 3 ? cast : stained, { at: [x, size * 0.3, z], rotate: [rand() * 0.4, rand() * 3, rand() * 0.4], collide: size > 0.6 })
  }

  level.box([3.5, 1.1, 5], stained, { at: [58, 0.55, -4] })
  level.box([3.5, 2.1, 2.6], stained, { at: [61.5, 1.05, -4.8] })
  level.box([0.35, 3.4, 6], cast, { at: [64.6, 1.7, -4] })

  apartmentBlock(level, { at: [82, 0, -6], floors: 9, bays: 10, seed: 3 })
  apartmentBlock(level, { at: [-34, 0, 34], floors: 5, bays: 7, seed: 9, facing: Math.PI / 2 })
  lada(level, [6.5, 0, 5.6], 0.5)
  apc(level, [30, 0, -1.6], -0.32)
  lada(level, [62, 0, 9.5], 2.4, '#4a3b30')
  apartmentBlock(level, { at: [60, 0, -44], floors: 7, bays: 8, seed: 21, facing: -Math.PI / 2 })
  apartmentBlock(level, { at: [-40, 0, -30], floors: 9, bays: 9, seed: 5, facing: Math.PI / 2 + 0.4 })
  shed(level, [70, 0, 34], [26, 7, 14], 0.05)
  shed(level, [28, 0, 40], [18, 5.5, 10], -0.1, '#6c6e5d')
  shed(level, [-18, 0, -40], [22, 6, 12], 0.4, '#7a6f5c')
  waterTower(level, [44, 0, -32])
  for (const [x, z, h, r] of [[4, -12, 7, 0.3], [-8, 10, 6, 1.4], [24, 22, 8, 2.2], [58, -22, 7.5, 0.8], [74, 24, 6.5, 3.1], [-22, -16, 8.5, 1.9], [86, -30, 9, 0.2], [48, 30, 7, 1.1], [110, 22, 8, 2.6]] as const) deadTree(level, [x, 0, z], h, r, Math.abs(z) < 16)
  const puddles = puddleMaterial()
  for (const [x, z, w, d, r] of [[4.5, -1.2, 2.6, 1.4, 0.3], [18, 1.5, 3.4, 1.8, -0.2], [39, -3, 4.2, 2.4, 0.6], [47, 3.2, 2.2, 1.3, 1.2], [56, -1, 3, 1.5, 0.1], [-6, 1, 3.6, 2, 0.4]] as const) {
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
  level.cylinder(1.8, 52, { name: 'brick', color: '#7a6a5f' }, { at: [118, 26, -70], collide: false }, 16)
  level.cylinder(2.3, 2, cast, { at: [118, 1, -70], collide: false }, 16)
  for (let i = 0; i < 9; i++) {
    const x = -30 + i * 22
    level.box([0.28, 9, 0.28], cast, { at: [x, 4.5, -9.5], collide: i > 0 && i < 4 })
    level.box([2.4, 0.16, 0.18], cast, { at: [x, 8.55, -9.5], rotate: [0, Math.PI / 2, 0], collide: false, shadow: false })
    level.box([1.8, 0.14, 0.16], cast, { at: [x, 7.7, -9.5], rotate: [0, Math.PI / 2, 0], collide: false, shadow: false })
  }
  for (let i = 0; i < 6; i++) level.box([0.22, 7.5, 0.22], { name: 'metal', color: '#565a50' }, { at: [-6 + i * 26, 3.75, 4.6], collide: false })
  for (let i = 0; i < 6; i++) level.box([1.9, 0.12, 0.14], { name: 'metal', color: '#565a50' }, { at: [-6 + i * 26 - 0.85, 7.4, 4.6], collide: false, shadow: false })

  const group = level.build()
  return { group, colliders: level.colliders, spawn: [0, 0, 0] as [number, number, number], focus: new THREE.Vector3(30, 0, 0) }
}
