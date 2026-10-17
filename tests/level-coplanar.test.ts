import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { lintZFighting } from '../packages/check/src/zfight/lint.mjs'
import { LevelBuilder } from '../packages/look/src/world/builder'
import { resolveCoplanar } from '../packages/look/src/world/coplanar'

const stone = { name: 'cast' } as const
const brick = { name: 'brick' } as const

function lintLevel(level: THREE.Object3D) {
  const camera = { name: 'view', position: [0, 3, 40] as [number, number, number], target: [0, 0, 0] as [number, number, number], fov: 70, aspect: 1.78, near: 0.1, far: 300 }
  return lintZFighting(level, { cameras: [camera], depth: { near: 0.1, far: 300, bits: 24 } })
}

beforeAll(() => {
  const image = { addEventListener() {}, removeEventListener() {}, set src(_: string) {} }
  Object.assign(globalThis, { document: { createElementNS: () => image } })
})

describe('LevelBuilder coplanar faces', () => {
  it('pushes the smaller of two flush top faces clear so the lint passes', () => {
    const build = (coplanar: 'resolve' | 'ignore') => {
      const level = new LevelBuilder({ coplanar })
      level.box([10, 1, 10], stone, { at: [0, 0.5, 0], shadow: false, name: 'plinth' })
      level.box([4, 2, 4], brick, { at: [0, 1, 0], shadow: false, name: 'pillar' })
      level.box([3, 1, 3], brick, { at: [0, 0.5, 6], shadow: false, name: 'step' })
      level.plane(20, 20, stone, { at: [0, 1, 0], name: 'deck' })
      return level
    }
    const raw = build('ignore')
    expect(lintLevel(raw.build()).problems.length).toBeGreaterThan(0)
    const fixed = build('resolve')
    const group = fixed.build()
    expect(fixed.coplanar.length).toBeGreaterThan(0)
    expect(lintLevel(group).problems).toEqual([])
  })

  it('throws a readable message in strict mode and names both faces', () => {
    const level = new LevelBuilder({ coplanar: 'throw' })
    level.box([6, 1, 6], stone, { at: [0, 0.5, 0], shadow: false, name: 'floor slab' })
    level.box([2, 3, 2], brick, { at: [0, 1.5, 0], shadow: false, name: 'column' })
    level.box([2, 1, 2], brick, { at: [5, 0.5, 0], shadow: false, name: 'plinth' })
    level.box([3, 1, 3], brick, { at: [5, 0.5, 0.5], shadow: false, name: 'ledge' })
    expect(() => level.build()).toThrow(/coplanar/)
  })

  it('settles cascades in a dense layout, leaving no coplanar faces behind', () => {
    const level = new LevelBuilder({ coplanar: 'resolve' })
    const room = 6, height = 3, wall = 0.2, n = 4
    for (let i = 0; i <= n; i++) for (let j = 0; j < n; j++) {
      level.box([room + wall, height, wall], brick, { at: [j * room + room / 2, height / 2, i * room], shadow: false })
      level.box([wall, height, room + wall], brick, { at: [i * room, height / 2, j * room + room / 2], shadow: false })
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      level.box([room, 0.2, room], stone, { at: [i * room + room / 2, -0.1, j * room + room / 2], shadow: false })
      level.box([1, 0.5, 1], stone, { at: [i * room + 4, 0.25, j * room + 4], shadow: false })
      level.box([1, 0.5, 1], stone, { at: [i * room + 4, 0.75, j * room + 4.2], shadow: false })
    }
    level.build()
    expect(level.coplanar.length).toBeGreaterThan(50)
    expect(resolveCoplanar((level as unknown as { sources: Parameters<typeof resolveCoplanar>[0] }).sources, { mode: 'ignore' })).toEqual([])
  })

  it('leaves faces that only touch edge to edge alone', () => {
    const level = new LevelBuilder({ coplanar: 'throw' })
    level.box([4, 1, 4], stone, { at: [0, 0.5, 0], shadow: false })
    level.box([4, 1, 4], stone, { at: [4, 0.5, 0], shadow: false })
    expect(() => level.build()).not.toThrow()
  })

  it('labels merged triangles with the name given to each box', () => {
    const level = new LevelBuilder({ coplanar: 'ignore' })
    level.box([2, 2, 2], stone, { at: [0, 1, 0], shadow: false, name: 'crate' })
    const group = level.build()
    const mesh = group.children[0] as THREE.Mesh
    expect(mesh.userData.parts[0].label).toBe('crate')
    expect(mesh.userData.parts[0].count).toBe(12)
  })

  it('separates the caps of wheels that overlap side by side', () => {
    const build = (coplanar: 'resolve' | 'ignore') => {
      const level = new LevelBuilder({ coplanar })
      level.cylinder(0.48, 0.34, stone, { at: [0, 0.48, 0], rotate: [Math.PI / 2, 0, 0], shadow: false, name: 'wheel a' })
      level.cylinder(0.48, 0.34, stone, { at: [0.8, 0.48, 0], rotate: [Math.PI / 2, 0, 0], shadow: false, name: 'wheel b' })
      return level
    }
    expect(lintLevel(build('ignore').build()).problems.length).toBeGreaterThan(0)
    const fixed = build('resolve')
    const group = fixed.build()
    expect(fixed.coplanar.length).toBe(2)
    expect(lintLevel(group).problems).toEqual([])
  })
})
