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
  let last = 0
  let reported = performance.now()
  renderer.render = function (scene, camera) {
    original(scene, camera)
    const now = performance.now()
    if (last) durations.push(now - last)
    last = now
    if (durations.length > 240) durations.shift()
    if (now - reported < 1000 || !durations.length) return
    const sorted = [...durations].sort((a, b) => a - b)
    const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!
    const elapsed = now - reported
    const value: PerfSample = { fps: durations.length * 1000 / elapsed, p50: percentile(.5), p95: percentile(.95), drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, activeBodies: bodies }
    parent.postMessage({ type: messageType, value }, location.origin)
    durations.length = 0
    reported = now
  }
}

export function PerfOverlay({ source, corner = 'top-right' }: { source?: Window | null; corner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' }) {
  const [sample, setSample] = useState<PerfSample>()
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    setSample(undefined)
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== source || event.data?.type !== messageType) return
      setSample(event.data.value as PerfSample)
    }
    addEventListener('message', receive)
    return () => removeEventListener('message', receive)
  }, [source])
  return <div className={`blacksite-perf blacksite-perf--${corner}`}>
    <button type="button" aria-label="Performance metrics" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {sample ? `${sample.fps.toFixed(0)} fps · p95 ${sample.p95.toFixed(1)} ms` : '— fps · p95 — ms'} <span aria-hidden="true">{expanded ? '−' : '+'}</span>
    </button>
    {expanded && <div className="blacksite-perf-details">
      <strong>PERFORMANCE</strong>
      <span>Frame p50 / p95 <b>{sample ? `${sample.p50.toFixed(1)} / ${sample.p95.toFixed(1)} ms` : '—'}</b></span>
      <span>Draw calls <b>{sample?.drawCalls ?? '—'}</b></span>
      <span>Triangles <b>{sample?.triangles.toLocaleString() ?? '—'}</b></span>
      {sample?.activeBodies !== undefined && <span>Active bodies <b>{sample.activeBodies}</b></span>}
    </div>}
  </div>
}
