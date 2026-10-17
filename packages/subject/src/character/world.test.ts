import { describe, expect, it } from 'vitest'
import { colliderBounds } from './world'

const still = { x: 0, y: 0, z: 0, w: 1 }
const collider = (shape: unknown, at = { x: 0, y: 0, z: 0 }, rotation = still) => ({ shape, translation: () => at, rotation: () => rotation })

describe('character world bounds', () => {
  it('unions boxes, meshes and heightfields', () => {
    const bounds = colliderBounds([
      collider({ halfExtents: { x: 10, y: 0.5, z: 10 } }, { x: 0, y: -0.5, z: 0 }),
      collider({ vertices: new Float32Array([0, 0, 0, 30, 4, 2]) }, { x: 5, y: 0, z: 0 }),
      collider({ heights: new Float32Array([0, 2]), scale: { x: 8, y: 3, z: 8 } }, { x: 0, y: 0, z: -20 }),
    ])
    expect(bounds).toEqual({ min: [-10, -1, -24], max: [35, 6, 10] })
  })

  it('turns a rotated box before bounding it', () => {
    const quarter = Math.SQRT1_2
    const bounds = colliderBounds([collider({ halfExtents: { x: 4, y: 1, z: 1 } }, { x: 0, y: 0, z: 0 }, { x: 0, y: quarter, z: 0, w: quarter })])!
    expect(bounds.max[0]).toBeCloseTo(1)
    expect(bounds.max[2]).toBeCloseTo(4)
  })

  it('reports nothing for an empty world', () => {
    expect(colliderBounds([])).toBeNull()
  })
})
