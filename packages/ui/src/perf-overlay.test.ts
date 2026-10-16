import { afterEach, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Scene, type WebGLRenderer } from 'three'
import { attachPerfProbe, type PerfSample } from './perf-overlay'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each([1, 2])('counts one frame with %i render passes and sums their geometry', async passes => {
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const messages: PerfSample[] = []
  vi.stubGlobal('parent', { postMessage: (message: { value: PerfSample }) => messages.push(message.value) })
  vi.stubGlobal('location', { origin: 'https://blacksite.test' })
  const info = { autoReset: true, render: { calls: 0, triangles: 0 } }
  let pass = 0
  const renderer = {
    info,
    render: () => {
      info.render.calls = pass === 0 ? 4 : 2
      info.render.triangles = pass === 0 ? 1200 : 300
    },
  } as unknown as WebGLRenderer
  attachPerfProbe(renderer)
  const scene = new Scene()
  const camera = new PerspectiveCamera()
  for (let frame = 1; frame <= 60; frame++) {
    now = frame * 1000 / 60
    for (pass = 0; pass < passes; pass++) renderer.render(scene, camera)
    await Promise.resolve()
  }
  expect(messages).toHaveLength(1)
  expect(messages[0]!.fps).toBeCloseTo(60, 8)
  expect(messages[0]!.p50).toBeCloseTo(1000 / 60, 8)
  expect(messages[0]!.p95).toBeCloseTo(1000 / 60, 8)
  expect(messages[0]!.drawCalls).toBe(passes === 1 ? 4 : 6)
  expect(messages[0]!.triangles).toBe(passes === 1 ? 1200 : 1500)
})
