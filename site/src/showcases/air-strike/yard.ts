import * as THREE from 'three'
import { LevelBuilder } from '../../look/builder'
import { groundMaterial, puddleMaterial, worldPlaneGeometry } from '../../look/look'
import { apartmentBlock, deadTree, lada, shed, waterTower } from '../../look/props'

function random(seed: number) {
  let state = seed
  return () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296 }
}

export function buildYard() {
  const level = new LevelBuilder()
  const rand = random(11)
  const cast = { name: 'cast' } as const

  const ground = new THREE.Mesh(worldPlaneGeometry(520, 520, 4), groundMaterial())
  ground.receiveShadow = true
  ground.name = 'ground'
  level.mesh(ground)
  level.plane(46, 22, { name: 'slab', ao: false }, { at: [0, 0.01, 0] })
  level.plane(320, 8, { name: 'asphalt', ao: false }, { at: [0, 0.012, 30] })
  level.plane(320, 2.4, { name: 'slab', ao: false }, { at: [0, 0.016, 25] })
  level.plane(2.6, 14, { name: 'asphalt', ao: false }, { at: [-9, 0.014, 17] })
  level.plane(2.6, 14, { name: 'asphalt', ao: false }, { at: [9, 0.014, 17] })

  for (let i = 0; i < 16; i++) {
    const x = -120 + i * 16
    level.box([0.26, 8.5, 0.26], cast, { at: [x, 4.25, 35.5], collide: false })
    level.box([2.2, 0.15, 0.16], cast, { at: [x, 8.1, 35.5], collide: false, shadow: false })
  }
  for (let i = 0; i < 10; i++) level.box([0.16, 6.5, 0.16], { name: 'metal', color: '#565a50' }, { at: [-60 + i * 14, 3.25, 24.2], collide: false })

  lada(level, [-15, 0, 27.4], 0.02)
  lada(level, [-9.5, 0, 27.6], -0.04, '#454a3c')
  lada(level, [16, 0, 27.3], Math.PI + 0.05, '#4a3b30')
  lada(level, [24, 0, 12], 1.2, '#3a3d36')

  for (const [x, z] of [[-26, 14], [27, 18], [-34, -4], [33, -12], [-20, 40], [42, 44], [-48, 20], [8, 44]] as const) deadTree(level, [x, 0, z], 6 + rand() * 4, rand() * 6, false)
  for (let i = 0; i < 4; i++) level.cylinder(0.05, 2.4, { name: 'rust', color: '#5c4c3f' }, { at: [-25 + i * 2.2, 1.2, 11], collide: false }, 6)
  level.cylinder(0.05, 6.6, { name: 'rust', color: '#5c4c3f' }, { at: [-21.7, 2.4, 11], rotate: [0, 0, Math.PI / 2], collide: false }, 6)
  level.box([3, 0.4, 1.2], { name: 'paint', color: '#7b6a4c' }, { at: [-14, 0.45, 14], collide: false })
  for (const x of [-15.2, -12.8]) level.box([0.14, 0.45, 0.14], cast, { at: [x, 0.22, 14], collide: false })

  for (let i = 0; i < 18; i++) {
    const size = 0.3 + rand() * 0.9
    level.box([size * (1 + rand()), size * 0.6, size], { name: i % 2 ? 'cast' : 'stained' }, { at: [-30 + rand() * 60, size * 0.25, 9 + rand() * 12], rotate: [rand() * 0.4, rand() * 3, rand() * 0.4], collide: false })
  }

  apartmentBlock(level, { at: [-66, 0, -16], floors: 9, bays: 9, seed: 4, facing: -0.35 })
  apartmentBlock(level, { at: [52, 0, -46], floors: 7, bays: 8, seed: 17, facing: -Math.PI / 2 + 0.2 })
  apartmentBlock(level, { at: [-30, 0, -70], floors: 9, bays: 10, seed: 23, facing: -Math.PI / 2 })
  shed(level, [52, 0, 6], [24, 4, 7], Math.PI / 2 - 0.08, '#6c6e5d')
  shed(level, [64, 0, 8], [24, 4, 7], Math.PI / 2 - 0.08, '#77735f')
  waterTower(level, [-52, 0, -52])
  level.cylinder(2, 58, { name: 'brick', color: '#7a6a5f' }, { at: [-120, 29, -120], collide: false }, 16)

  const puddles = puddleMaterial()
  for (const [x, z, w, d, r] of [[-4, 21, 3.2, 1.6, 0.2], [12, 31, 4, 2, -0.3], [-22, 30.5, 2.6, 1.4, 0.8], [30, 22, 3.4, 1.8, 0.4]] as const) {
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
  return { group: level.build(), ground }
}
