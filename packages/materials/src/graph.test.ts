import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { evaluate, image, KERNELS } from './cpu'
import { compile, GraphError, parseGraph, validate, type MaterialGraph, type NodeSpec, type Step } from './graph'
import { diff } from './parity'
import { createGpuEvaluator } from './gpu'

const flat: MaterialGraph = { name: 'fixture', size: 1, depth: 0.01, seed: 17, nodes: {}, outputs: { color: '#aaa', height: 0.5, roughness: 0.8 } }
const fixture = (node: NodeSpec): MaterialGraph => ({ ...flat, nodes: { value: node }, outputs: { color: 'value', height: 'value' } })
const average = (data: Float32Array, channel: number) => data.reduce((sum, value, i) => sum + (i % 4 === channel ? value : 0), 0) / (data.length / 4)
const signature = (graph: MaterialGraph) => evaluate(compile(graph, 32)).color.data

describe('material graph contract', () => {
  it('compiles every starter graph at both bake resolutions without shader overflow', async () => {
    const directory = new URL('../library/', import.meta.url)
    for (const file of await readdir(directory)) {
      if (!file.endsWith('.json')) continue
      const graph = parseGraph(JSON.parse(await readFile(new URL(file, directory), 'utf8')))
      for (const res of [512, 1024]) {
        const program = compile(graph, res)
        expect(program.steps.length, file).toBeGreaterThan(0)
        expect(program.steps.every(step => step.params.every(Number.isFinite)), file).toBe(true)
      }
    }
  })

  it.each([
    null,
    { ...flat, size: Infinity },
    { ...flat, depth: -1 },
    { ...flat, outputs: {} },
    { ...flat, outputs: { color: '#invalid' } },
    { ...flat, outputs: { color: [1, 2] } },
    { ...flat, outputs: { color: [1, 2, NaN] } },
    { ...flat, weather: { moisture: NaN } },
    { ...flat, weather: { rust: 1.1 } },
    { ...flat, finish: { normal: Infinity } },
    { ...flat, porosity: -0.1 },
    { ...flat, nodes: { unused: { op: 'unknown' } } },
    { ...flat, nodes: { unused: { op: 'blur', input: 'missing' } } },
    { ...flat, nodes: { a: { op: 'blur', input: 'b' }, b: { op: 'blur', input: 'a' } } },
    fixture({ op: 'fbm', cell: 0 }),
    fixture({ op: 'fbm', cell: [0.1, NaN] }),
    fixture({ op: 'fbm', gain: -1 }),
    fixture({ op: 'rivets', radius: 0 }),
    fixture({ op: 'levels', input: 1, gamma: 0 }),
    fixture({ op: 'seamless', input: 1, width: 0 }),
    fixture({ op: 'ramp', input: 0.5, stops: [[0.8, '#fff'], [0.2, '#000']] }),
    fixture({ op: 'transform', input: 0.5, rotate: 45 }),
    fixture({ op: 'transform', input: 0.5, repeat: 1.5 }),
    { ...flat, nodes: { typo: { op: 'blur', input: 1, raduis: 0.1 } } },
  ])('rejects malformed graph %# with a graph error', graph => {
    expect(validate(graph)).toHaveLength(1)
  })

  it.each([0, -1, NaN, Infinity, 1.5, 4097])('rejects unsafe resolution %s before allocating', res => {
    expect(() => compile(flat, res)).toThrow(GraphError)
  })

  it('rejects invalid compile overrides', () => {
    expect(() => compile(flat, 32, { weather: { damage: { bullets: Infinity } } })).toThrow(GraphError)
  })

  it('prunes unused image dependencies', () => {
    const program = compile({ ...flat, nodes: { unused: { op: 'image', src: 'unused.webp' } } }, 32)
    expect(program.images).toEqual([])
    expect(program.steps.some(step => step.kernel === 'image')).toBe(false)
  })

  it('is byte deterministic after a JSON round trip and responds to seed changes', () => {
    const graph = fixture({ op: 'fbm', cell: 0.2, octaves: 4 })
    expect(signature(graph)).toEqual(signature(parseGraph(JSON.parse(JSON.stringify(graph)))))
    expect(signature(graph)).not.toEqual(signature({ ...graph, seed: 18 }))
  })

  it('lets an explicit seed align companion shape nodes regardless of their IDs', () => {
    const shared: NodeSpec = { op: 'scatter', seed: 42, cell: 0.2, radius: 0.06, shape: 'disc' }
    const graph: MaterialGraph = { ...flat, nodes: { relief: shared, coverage: { ...shared, output: 'mask' } }, outputs: { color: 'coverage', height: 'relief' } }
    const result = evaluate(compile(graph, 64))
    for (let i = 0; i < result.color.data.length; i += 4) expect(result.color.data[i]).toBe(result.normal.data[i + 3])
  })
})

describe('wrapped filtering and PBR channels', () => {
  it('blurs an impulse equally across all four tile edges', () => {
    const source = image(16, 16)
    source.data[0] = 1
    const graph = fixture({ op: 'blur', input: 'source', radius: 0.15 })
    const result = evaluate(compile({ ...graph, nodes: { source: { op: 'image', src: 'impulse' }, ...graph.nodes } }, 16), new Map([['impulse', source]]))
    const at = (x: number, y: number) => result.color.data[(y * 16 + x) * 4]!
    expect(at(1, 0)).toBeGreaterThan(0)
    expect(at(1, 0)).toBeCloseTo(at(15, 0), 8)
    expect(at(0, 1)).toBeCloseTo(at(0, 15), 8)
    expect(at(1, 1)).toBeCloseTo(at(15, 15), 8)
  })

  it('derives normals across the seam with the same physical slope as inside the tile', () => {
    const graph = fixture({ op: 'wave', axis: 'u', period: 1 })
    const res = 64
    const result = evaluate(compile(graph, res))
    for (const x of [0, 1, 31, 62, 63]) {
      const u = (x + 0.5) / res
      const derivative = Math.cos(2 * Math.PI * u) * Math.sin(2 * Math.PI / res) * graph.depth * res / 2
      const expected = 0.5 - 0.5 * derivative / Math.hypot(derivative, 1)
      expect(result.normal.data[x * 4]).toBeCloseTo(expected, 5)
    }
  })

  it('keeps a full-tile translation unchanged after warping and filtering', () => {
    const nodes: Record<string, NodeSpec> = {
      noise: { op: 'fbm', cell: [0.2, 0.3] },
      warped: { op: 'warp', input: 'noise', by: 'noise', amount: 0.08 },
      blurred: { op: 'slopeBlur', input: 'warped', slope: 'noise', amount: 0.05 },
      shifted: { op: 'transform', input: 'blurred', offset: [1, -1] },
    }
    const original = signature({ ...flat, nodes, outputs: { color: 'blurred' } })
    expect(signature({ ...flat, nodes, outputs: { color: 'shifted' } })).toEqual(original)
  })

  it('packs independent height, roughness, metalness and AO into documented channels', () => {
    const result = evaluate(compile({ ...flat, depth: 0, outputs: { color: '#fff', height: 0.3, roughness: 0.4, metalness: 0.6, ao: 0.7 } }, 8))
    expect(Array.from(result.normal.data.slice(0, 4))).toEqual([0.5, 0.5, 1, Math.fround(0.3)])
    expect(Array.from(result.orm.data.slice(0, 4))).toEqual([Math.fround(0.7), Math.fround(0.4), Math.fround(0.6), 1])
    expect(result.masks.data.every(value => value === 0)).toBe(true)
  })

  it.each([0, 2])('defines zero scatter density as no shapes for output %s', output => {
    const out = image(16, 16)
    const params = new Float32Array([4, 4, 0.08, 0.5, 0, 0, 1, 0, output, 1, 1 / 16, 1, 1, 1])
    const step: Step = { id: 'scatter', kernel: 'scatter', params, inputs: [] }
    KERNELS.scatter(out, params, [], step, { images: new Map() })
    expect(average(out.data, 0)).toBe(0)
  })

  it('keeps elongated scatter shapes from disappearing at cell boundaries', () => {
    const graph = fixture({ op: 'scatter', cell: 0.25, radius: 0.08, stretch: 6, shape: 'disc', rotate: false, density: 1 })
    const result = evaluate(compile(graph, 128)).color
    const seams: number[] = []
    const interior: number[] = []
    for (let y = 1; y < 128; y++) for (let x = 0; x < 128; x++) {
      const delta = Math.abs(result.data[(y * 128 + x) * 4]! - result.data[((y - 1) * 128 + x) * 4]!)
      ;(y % 32 === 0 ? seams : interior).push(delta)
    }
    expect(Math.max(...seams)).toBeLessThanOrEqual(Math.max(...interior) + 0.00001)
  })
})

describe('weather parameters', () => {
  it('darkens porous material, lowers roughness and emits a wet mask', () => {
    const dry = evaluate(compile(flat, 32))
    const wet = evaluate(compile(flat, 32, { weather: { moisture: 0.8 } }))
    expect(average(wet.color.data, 0)).toBeLessThan(average(dry.color.data, 0))
    expect(average(wet.orm.data, 1)).toBeLessThan(average(dry.orm.data, 1))
    expect(average(wet.masks.data, 2)).toBeGreaterThan(0.75)
  })

  it('does not roughen an already polished surface when wetted', () => {
    const wet = evaluate(compile({ ...flat, outputs: { ...flat.outputs, roughness: 0.05 } }, 32, { weather: { moisture: 1 } }))
    expect(average(wet.orm.data, 1)).toBeLessThanOrEqual(0.050001)
  })

  it('changes damage with the graph seed and exports a nonempty damage mask', () => {
    const graph: MaterialGraph = { ...flat, weather: { damage: { bullets: 1 } } }
    const first = evaluate(compile(graph, 32))
    const second = evaluate(compile({ ...graph, seed: 18 }, 32))
    expect(average(first.masks.data, 3)).toBeGreaterThan(0.01)
    expect(first.masks.data).not.toEqual(second.masks.data)
    for (const map of ['color', 'normal', 'orm', 'masks'] as const) expect(first[map].data.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true)
  })

  it('honours an override dirt colour', () => {
    const graph: MaterialGraph = { ...flat, weather: { dirt: 1, dirtColor: '#ff0000' } }
    const first = evaluate(compile(graph, 32))
    const second = evaluate(compile(graph, 32, { weather: { dirt: 1, dirtColor: '#0000ff' } }))
    expect(first.color.data).not.toEqual(second.color.data)
  })
})

describe('parity comparison', () => {
  it('rejects mismatched or empty samples instead of returning a misleading score', () => {
    expect(() => diff(new Float32Array([1]), new Float32Array([1, 2]))).toThrow()
    expect(() => diff(new Float32Array(), new Float32Array())).toThrow()
  })
})

describe('GPU evaluator cleanup', () => {
  it('releases intermediate targets and restores renderer state after a render failure', () => {
    const previous = new THREE.WebGLRenderTarget(4, 4)
    const renderer = Object.assign(Object.create(THREE.WebGLRenderer.prototype), {
      extensions: { has: () => true }, capabilities: { getMaxAnisotropy: () => 1 }, autoClear: true,
      getRenderTarget: () => previous, getActiveCubeFace: () => 2, getActiveMipmapLevel: () => 1,
      setRenderTarget: vi.fn(), render: () => { throw new Error('render failed') },
    }) as THREE.WebGLRenderer
    const disposed = vi.spyOn(THREE.WebGLRenderTarget.prototype, 'dispose')
    const gpu = createGpuEvaluator(renderer)
    try {
      expect(() => gpu.evaluate(compile(flat, 8))).toThrow('render failed')
      expect(renderer.autoClear).toBe(true)
      expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(previous, 2, 1)
      gpu.dispose()
      expect(disposed).toHaveBeenCalledTimes(5)
    } finally {
      disposed.mockRestore()
      previous.dispose()
    }
  })
})
