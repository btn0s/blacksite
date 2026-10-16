import { useEffect, useState } from 'react'
import { WebGLRenderer } from 'three'

export type PerfSample = { fps: number; p50: number; p95: number; drawCalls: number; triangles: number; activeBodies?: number }
const messageType = 'blacksite:perf'
let bodies: number | undefined

export function reportActiveBodies(count: number) { bodies = count }

export function installPerfProbe() {
  Object.assign(window, { __blacksitePerf: attachPerfProbe, __blacksiteBodies: reportActiveBodies })
}

export function attachPerfProbe(renderer: WebGLRenderer) {
  const original = renderer.render.bind(renderer)
  const durations: number[] = []
  let last: number | null = null
  let reported = performance.now()
  let frames = 0
  let pending = false
  let frameCalls = 0
  let frameTriangles = 0
  renderer.render = function (scene, camera) {
    const previousCalls = renderer.info.autoReset ? 0 : renderer.info.render.calls
    const previousTriangles = renderer.info.autoReset ? 0 : renderer.info.render.triangles
    original(scene, camera)
    frameCalls += renderer.info.render.calls - previousCalls
    frameTriangles += renderer.info.render.triangles - previousTriangles
    if (pending) return
    pending = true
    queueMicrotask(() => {
      pending = false
      const drawCalls = frameCalls
      const triangles = frameTriangles
      frameCalls = frameTriangles = 0
      const now = performance.now()
      if (last !== null) durations.push(now - last)
      last = now
      frames++
      if (durations.length > 240) durations.shift()
      if (now - reported < 1000 || !durations.length) return
      const sorted = [...durations].sort((a, b) => a - b)
      const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!
      const elapsed = now - reported
      const value: PerfSample = { fps: frames * 1000 / elapsed, p50: percentile(.5), p95: percentile(.95), drawCalls, triangles, activeBodies: bodies }
      parent.postMessage({ type: messageType, value }, location.origin)
      durations.length = 0
      frames = 0
      reported = now
    })
  }
}

export function PerfOverlay({ source }: { source?: Window | null }) {
  const [sample, setSample] = useState<PerfSample>()
  useEffect(() => {
    setSample(undefined)
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== source || event.data?.type !== messageType) return
      setSample(event.data.value as PerfSample)
    }
    addEventListener('message', receive)
    return () => removeEventListener('message', receive)
  }, [source])
  return <div className="blacksite-perf" aria-label="Performance metrics">
    <strong>PERFORMANCE</strong>
    <span>Frame p50 / p95 <b>{sample ? `${sample.p50.toFixed(1)} / ${sample.p95.toFixed(1)} ms` : '—'}</b></span>
    <span>FPS <b>{sample ? sample.fps.toFixed(0) : '—'}</b></span>
    <span>Draw calls <b>{sample?.drawCalls ?? '—'}</b></span>
    <span>Triangles <b>{sample?.triangles.toLocaleString() ?? '—'}</b></span>
    {sample?.activeBodies !== undefined && <span>Active bodies <b>{sample.activeBodies}</b></span>}
  </div>
}
