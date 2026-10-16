import { describe, expect, it } from 'vitest'
import { createShowcaseFrame } from './showcase-frame'

describe('createShowcaseFrame', () => {
  it('authors a reusable grounded frame with an approach point', () => {
    const manifest = createShowcaseFrame({ name: 'test-yard', baysX: 2, baysZ: 1, storeys: 2 })
    expect(manifest.name).toContain('test-yard')
    expect(manifest.fragments.length).toBeGreaterThan(20)
    expect(manifest.level?.spawn.position[2]).toBeGreaterThan(0)
    expect(manifest.bonds.some(bond => bond.b === -1)).toBe(true)
  })
})
