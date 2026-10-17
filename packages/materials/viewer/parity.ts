import * as THREE from 'three'
import { image, type Img } from '../src/cpu'
import { compile, parseGraph, type MaterialGraph, type NodeSpec } from '../src/graph'
import { parity, type Diff } from '../src/parity'

const library = import.meta.glob('../library/*.json', { eager: true, import: 'default' })
const imageUrls = import.meta.glob('../images/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

export type MaterialParityCase = {
  readonly name: string
  readonly resolution: number
  readonly outputs: Readonly<Record<string, Diff>>
  readonly kernels: Readonly<Record<string, Diff>>
  readonly passed: boolean
}

export type MaterialParityResult = {
  readonly passed: boolean
  readonly threshold: number
  readonly renderer: string
  readonly elapsedMs: number
  readonly cases: readonly MaterialParityCase[]
}

async function sourceImage(url: string): Promise<{ cpu: Img; gpu: THREE.Texture }> {
  const source = new Image()
  source.src = url
  await source.decode()
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(source, 0, 0)
  const pixels = context.getImageData(0, 0, source.width, source.height).data
  const cpu = image(source.width, source.height)
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const from = ((source.height - 1 - y) * source.width + x) * 4
    const to = (y * source.width + x) * 4
    for (let c = 0; c < 4; c++) cpu.data[to + c] = pixels[from + c]! / 255
  }
  const gpu = new THREE.Texture(source)
  gpu.colorSpace = THREE.NoColorSpace
  gpu.generateMipmaps = false
  gpu.minFilter = THREE.NearestFilter
  gpu.magFilter = THREE.NearestFilter
  gpu.needsUpdate = true
  return { cpu, gpu }
}

const additionalGraphs: MaterialGraph[] = [
  { name: 'extended-scatter', size: 1, depth: 0.01, seed: 19, nodes: { scatter: { op: 'scatter', cell: 0.25, radius: 0.08, stretch: 6, rotate: false } }, outputs: { color: 'scatter', height: 'scatter' } },
  ...([
    { op: 'value', cell: 0.2 },
    { op: 'perlin', cell: 0.2 },
    { op: 'cellular', cell: 0.2, mode: 'f2' },
    { op: 'fbm', basis: 'cellular', cell: 0.3 },
    { op: 'transform', input: 'noise', rotate: 270, repeat: 2, offset: [0.25, -0.375], flip: true },
  ] satisfies NodeSpec[]).map((node, index): MaterialGraph => ({ name: `node-contract-${index}`, size: 1, depth: 0.01, seed: 8388619, nodes: { noise: { op: 'fbm', cell: 0.2 }, value: node }, outputs: { color: 'value', height: 'value' } })),
]

export async function runMaterialParity(renderer: THREE.WebGLRenderer, resolutions: readonly number[] = [64, 128], bakeResolutionCases: readonly string[] = ['poured-concrete', 'poured-concrete-image', 'painted-metal', 'wet-tile']): Promise<MaterialParityResult> {
  const start = performance.now()
  const threshold = 0.02
  const cases: MaterialParityCase[] = []
  const graphs = [...Object.values(library).map(parseGraph), ...additionalGraphs]
  for (const graph of graphs) {
    const sources = new Map<string, Awaited<ReturnType<typeof sourceImage>>>()
    try {
      const sizes = [...new Set([...resolutions, ...(bakeResolutionCases.includes(graph.name) ? [512] : [])])]
      for (const resolution of sizes) {
        const program = compile(graph, resolution)
        for (const source of program.images) {
          if (sources.has(source)) continue
          const url = imageUrls[source]
          if (!url) throw new Error(`${graph.name}: no image URL for ${source}`)
          sources.set(source, await sourceImage(url))
        }
        const cpu = new Map([...sources].map(([name, source]) => [name, source.cpu]))
        const gpu = new Map([...sources].map(([name, source]) => [name, source.gpu]))
        const report = parity(renderer, program, { cpu, gpu })
        const kernels = Object.fromEntries([...report.steps.values()].map(({ kernel, ...difference }) => [kernel, difference]))
        const passed = [...Object.values(report.outputs), ...Object.values(kernels)].every(value => Number.isFinite(value.mean) && value.p99 <= threshold)
        cases.push({ name: graph.name, resolution, outputs: report.outputs, kernels, passed })
        await new Promise<void>(resolve => setTimeout(resolve, 0))
      }
    } finally {
      for (const source of sources.values()) source.gpu.dispose()
    }
  }
  const gl = renderer.getContext()
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  return {
    passed: cases.every(result => result.passed), threshold,
    renderer: String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
    elapsedMs: performance.now() - start, cases,
  }
}
