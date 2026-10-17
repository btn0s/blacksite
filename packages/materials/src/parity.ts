import type * as THREE from 'three'
import { evaluate, type Img } from './cpu'
import type { Program } from './graph'
import { createGpuEvaluator } from './gpu'

export type Diff = { readonly mean: number; readonly p99: number; readonly max: number }
export type ParityReport = {
  readonly outputs: { readonly color: Diff; readonly normal: Diff; readonly orm: Diff; readonly masks: Diff }
  readonly steps: ReadonlyMap<string, Diff & { readonly kernel: string }>
}

export function diff(a: Float32Array, b: Float32Array): Diff {
  if (!a.length || a.length !== b.length) throw new Error('parity needs nonempty arrays of the same length')
  const d = new Float32Array(a.length)
  let sum = 0
  for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]! - b[i]!); d[i] = Number.isNaN(v) ? Infinity : v; sum += d[i]! }
  d.sort()
  return { mean: sum / a.length, p99: d[Math.min(d.length - 1, Math.floor(d.length * 0.99))]!, max: d[d.length - 1]! }
}

export function parity(renderer: THREE.WebGLRenderer, program: Program, images: { cpu: ReadonlyMap<string, Img>; gpu: ReadonlyMap<string, THREE.Texture> }, steps?: readonly string[]): ParityReport {
  const finals = new Set(Object.values(program.outputs))
  const kinds = new Set<string>()
  const ids = steps ?? program.steps.filter(step => !finals.has(step.id) && !kinds.has(step.kernel) && kinds.add(step.kernel)).map(step => step.id)
  const cpu = evaluate(program, images.cpu, ids)
  const gpu = createGpuEvaluator(renderer)
  try {
    gpu.evaluate(program, images.gpu, ids)
    const out = (name: 'color' | 'normal' | 'orm' | 'masks') => diff(cpu[name].data, gpu.readback(program.outputs[name]))
    const kernels = new Map(program.steps.map(step => [step.id, step.kernel]))
    return {
      outputs: { color: out('color'), normal: out('normal'), orm: out('orm'), masks: out('masks') },
      steps: new Map(ids.map(id => [id, { ...diff(cpu.kept.get(id)!.data, gpu.readback(id)), kernel: kernels.get(id)! }])),
    }
  } finally {
    gpu.dispose()
  }
}
