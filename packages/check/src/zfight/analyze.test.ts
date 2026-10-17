import { describe, expect, it } from 'vitest'
import { analyzeFrames, decodePackedDepth } from './analyze.mjs'

const W = 16
const H = 16
const depth = { near: 0.1, far: 400 }
const ndc = (z: number) => (((depth.far + depth.near) - (2 * depth.far * depth.near) / z) / (depth.far - depth.near) + 1) / 2

function frames(idsFor: (f: number, x: number, y: number) => number, zFor: (id: number) => number, count = 6) {
  const ids: Uint32Array[] = []
  const depths: Float32Array[] = []
  for (let f = 0; f < count; f++) {
    const a = new Uint32Array(W * H)
    const d = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const id = idsFor(f, x, y); a[y * W + x] = id; d[y * W + x] = ndc(zFor(id)) }
    ids.push(a)
    depths.push(d)
  }
  return { ids, depths }
}

describe('analyzeFrames', () => {
  const flip = (f: number, x: number, y: number) => (((x * 7 + y * 13 + f * 5) % 3) === 0 ? 2 : 1)

  it('counts a block of flipping IDs at the same depth as z-fighting', () => {
    const { ids, depths } = frames(flip, () => 40)
    const result = analyzeFrames(ids, W, H, { depths, depth })
    expect(result.pixels).toBeGreaterThan(100)
    expect(result.edges).toBe(0)
  })

  it('treats flips between surfaces metres apart as an edge', () => {
    const { ids, depths } = frames(flip, id => (id === 1 ? 40 : 46))
    const result = analyzeFrames(ids, W, H, { depths, depth })
    expect(result.pixels).toBe(0)
    expect(result.edges).toBeGreaterThan(100)
  })

  it('without depth it cannot tell and counts both', () => {
    const { ids } = frames(flip, id => (id === 1 ? 40 : 46))
    expect(analyzeFrames(ids, W, H, {}).pixels).toBeGreaterThan(100)
  })
})

describe('packed depth', () => {
  it('round-trips a depth value through three bytes', () => {
    const value = 0.73125987
    const scaled = value * 255
    const hi = Math.floor(scaled)
    const rest = (scaled - hi) * 255
    const mid = Math.floor(rest)
    const bytes = new Uint8Array([hi, mid, Math.round((rest - mid) * 255), 255])
    const decoded = decodePackedDepth(bytes, 1, 1)
    expect(Math.abs(decoded[0] - value)).toBeLessThan(1e-6)
  })
})
