import { useEffect, useRef, useState } from 'react'
import type { MeshletScene, MeshletStats } from '@blacksite/geometry'
import type { MotionProbe, WebGPULook } from '@blacksite/look/webgpu'

type Line = { id: string; label: string; detail: string; bad: boolean }

export function TelemetryReadout({ look, geometry, selection }: { look: { current: WebGPULook | null }; geometry: MeshletScene | null; selection: MeshletStats | null }) {
  const [lines, setLines] = useState<Line[]>([])
  const previous = useRef({ overflows: 0, fallbacks: 0, skipped: 0 })
  const latest = useRef(selection)
  latest.current = selection
  useEffect(() => {
    let pending = false
    const interval = setInterval(() => {
      const current = look.current
      if (!current || !geometry || pending) return
      pending = true
      const snapshot = current.telemetry.snapshot()
      const paging = geometry.pagingStats() as unknown as { requestOverflows: number; fallbackClusters: number; feedbackSkipped: number }
      const delta = { overflows: paging.requestOverflows - previous.current.overflows, fallbacks: paging.fallbackClusters - previous.current.fallbacks, skipped: paging.feedbackSkipped - previous.current.skipped }
      previous.current = { overflows: paging.requestOverflows, fallbacks: paging.fallbackClusters, skipped: paging.feedbackSkipped }
      const window = snapshot.window
      const recovered = latest.current?.instancesRecovered ?? 0
      void current.probeMotion().catch((): MotionProbe | null => null).then(motion => {
        const staticMoving = motion && !motion.cameraMoved ? motion.movingFraction : null
        setLines([
          { id: 'A', label: 'Pass cameras', detail: window.cameraMismatch ? `${window.cameraMismatch} mismatched passes / ${window.frames} frames` : 'ok', bad: window.cameraMismatch > 0 },
          { id: 'B', label: 'Pipelines', detail: window.notReadyDraws ? `${window.notReadyDraws} draws recorded before ready` : 'ok', bad: window.notReadyDraws > 0 },
          { id: 'C', label: 'Targets', detail: window.targetReallocations || window.passOrderChanges ? `${window.targetReallocations} reallocated, ${window.passOrderChanges} order changes` : 'ok', bad: window.targetReallocations + window.passOrderChanges > 0 },
          { id: 'D', label: 'Budget', detail: delta.overflows || delta.fallbacks > 50000 ? `${delta.overflows} overflows, ${delta.fallbacks} fallback clusters per s` : 'ok', bad: delta.overflows > 0 },
          { id: 'E', label: 'Lit vs depth', detail: recovered ? `${recovered} recovered instances` : 'ok', bad: recovered > 0 },
          { id: 'F', label: 'Motion vectors', detail: motion ? `${(motion.movingFraction * 100).toFixed(0)}% nonzero, p95 ${motion.p95Length.toFixed(3)}, camera ${motion.cameraMoved ? 'moving' : 'still'}` : 'unavailable', bad: staticMoving !== null && staticMoving > 0.2 || Boolean(motion && motion.p95Length > 0.5) },
          { id: 'G', label: 'History', detail: window.historyResets || window.resumedFrames ? `${window.historyResets} resets, ${window.resumedFrames} resumed frames, max dt ${window.maxDt.toFixed(0)} ms` : `ok, max dt ${window.maxDt.toFixed(0)} ms`, bad: window.historyResets > 0 },
        ])
      }).finally(() => { pending = false })
    }, 1000)
    return () => clearInterval(interval)
  }, [geometry, look])
  if (!lines.length) return null
  return <aside aria-label="Render telemetry" style={{ position: 'fixed', left: 16, bottom: 16, zIndex: 20, pointerEvents: 'none', font: '11px/1.35 monospace', color: '#cfe3d4', background: 'rgba(8,14,12,0.78)', padding: '6px 8px', borderRadius: 6, maxWidth: 420 }}>
    {lines.map(line => <div key={line.id} style={{ color: line.bad ? '#ff9a7a' : '#8fd6a3' }}>{line.id} {line.label}: {line.detail}</div>)}
  </aside>
}
