import { useSyncExternalStore } from 'react'
import type { Inspector } from './index'
import './style.css'

export type DumpControl = {
  onDump: () => void
  status?: 'idle' | 'sending' | 'saved' | 'error'
  message?: string
}

const count = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const ms = (value: number) => value.toFixed(1)

export function InspectHud({ inspector, dump, className = '' }: { inspector: Inspector; dump?: DumpControl; className?: string }) {
  const snapshot = useSyncExternalStore(inspector.subscribe, inspector.getSnapshot, inspector.getSnapshot)
  const metrics = snapshot.metrics
  const gpu = Object.entries(metrics?.gpuMs ?? {})
  return <section className={`bs-inspect ${className}`} aria-label="Performance inspector" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <header className="bs-inspect-heading"><strong>{snapshot.renderer}</strong><span>{snapshot.tier} tier</span></header>
    <dl className="bs-inspect-metrics">
      <div><dt>Frame p50 / p95</dt><dd>{metrics ? `${ms(metrics.p50)} / ${ms(metrics.p95)} ms` : '—'}</dd></div>
      <div><dt>Triangles <small>drawn / scene</small></dt><dd>{metrics ? `${count.format(metrics.drawnTriangles)} / ${count.format(metrics.sceneTriangles)}` : '—'}</dd></div>
      <div><dt>Draw calls</dt><dd>{metrics ? count.format(metrics.drawCalls) : '—'}</dd></div>
      <div><dt>Geometry culled</dt><dd>{metrics ? `${ms(metrics.culledPercent)}%` : '—'}</dd></div>
      <div><dt>GPU total</dt><dd>{gpu.length ? `${ms(gpu.reduce((sum, [, time]) => sum + time, 0))} ms` : 'Unavailable'}</dd></div>
    </dl>
    <div className="bs-inspect-view" role="group" aria-label="Inspection controls">
      <button type="button" aria-pressed={snapshot.view === 'lod'} onClick={() => inspector.setView(snapshot.view === 'lod' ? 'lit' : 'lod')}>LOD colours</button>
      {dump && <button type="button" disabled={dump.status === 'sending'} onClick={dump.onDump}>{dump.status === 'sending' ? 'Saving…' : 'Dump stats · T'}</button>}
    </div>
    {snapshot.view === 'lod' && <p className="bs-inspect-legend"><span style={{ color: '#62d995' }}>Near</span><span style={{ color: '#f2c45a' }}>Mid</span><span style={{ color: '#80a6ff' }}>Far</span></p>}
    {(snapshot.techniques.length > 0 || gpu.length > 0) && <details className="bs-inspect-techniques">
      <summary>Techniques{gpu.length > 0 && ' · GPU passes'}</summary>
      {snapshot.techniques.map(technique => <label key={technique.id} title={technique.description}>
        <input type="checkbox" checked={technique.enabled} onChange={event => inspector.setTechnique(technique.id, event.currentTarget.checked)} />
        <span>{technique.label}{technique.description && <small>{technique.description}</small>}</span>
      </label>)}
      {gpu.length > 0 && <dl className="bs-inspect-metrics bs-inspect-pass-list">{gpu.map(([pass, time]) => <div key={pass}><dt>{pass}</dt><dd>{ms(time)} ms</dd></div>)}</dl>}
    </details>}
    {dump && <div className="bs-inspect-status" role="status">
      {dump.status === 'saved' && <p>Stats saved to the dev server.</p>}
      {dump.status === 'error' && <p>Stats could not be saved. Tap to retry.</p>}
      {dump.message && <p>{dump.message}</p>}
    </div>}
  </section>
}
