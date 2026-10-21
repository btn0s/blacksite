import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { button, folder, LevaPanel, useControls, useCreateStore } from 'leva'
import type { Schema } from 'leva/dist/declarations/src/types'
import type { Inspector } from './index'
import './style.css'

export type DumpControl = {
  onDump: () => void
  status?: 'idle' | 'sending' | 'saved' | 'error'
  message?: string
}

const count = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const ms = (value: number) => value.toFixed(1)

const distanceLegend = [{ color: '#62d995', label: 'Near' }, { color: '#f2c45a', label: 'Mid' }, { color: '#80a6ff', label: 'Far' }]

const theme = {
  colors: {
    elevation1: '#142124', elevation2: '#1b2b2e', elevation3: '#283b3e',
    accent1: '#869d83', accent2: '#a6b89b', accent3: '#d4dec0',
    highlight1: '#6e8586', highlight2: '#b1c0bb', highlight3: '#edf0e5',
    folderWidgetColor: '#b1c0bb', folderTextColor: '#d4ded4', rootText: '#edf0e5',
  },
  fonts: { sans: 'Inter, ui-sans-serif, system-ui, sans-serif', mono: 'ui-monospace, SFMono-Regular, monospace' },
  fontSizes: { root: '11px' },
  sizes: { rootWidth: '300px', controlWidth: '150px', rowHeight: '30px', folderTitleHeight: '30px', titleBarHeight: '34px', checkboxSize: '20px' },
  space: { rowGap: '4px', colGap: '8px', md: '10px', lg: '12px' },
  radii: { xs: '3px', sm: '5px', lg: '10px' },
}

export function DebugBlock({ children }: { children: ReactNode }) {
  return <div className="bs-debug-block">{children}</div>
}

function InspectControls({ inspector, dump, logs, onLogs }: { inspector: Inspector; dump?: DumpControl; logs: boolean; onLogs: (on: boolean) => void }) {
  const snapshot = useSyncExternalStore(inspector.subscribe, inspector.getSnapshot, inspector.getSnapshot)
  const store = useCreateStore()
  const latest = useRef({ dump, onLogs })
  latest.current = { dump, onLogs }
  const { techniques, view } = snapshot
  const layout = JSON.stringify([Boolean(dump), techniques.map(technique => [technique.id, technique.label, technique.description, technique.group])])
  const [, set] = useControls(() => {
    const schema: Schema = {}
    schema.logs = { label: 'Debug logs', value: logs, onChange: (on: boolean) => latest.current.onLogs(on) }
    if (dump) schema['Dump stats · T'] = button(() => latest.current.dump?.onDump())
    const groups: Record<string, Schema> = { Views: { lod: { label: 'LOD colours', value: view === 'lod', onChange: (on: boolean) => inspector.setView(on ? 'lod' : 'lit') } } }
    for (const technique of techniques) {
      (groups[technique.group ?? 'Techniques'] ??= {})[technique.id] = {
        label: technique.label,
        hint: technique.description,
        value: technique.enabled,
        onChange: (enabled: boolean) => { if (inspector.getSnapshot().techniques.some(({ id }) => id === technique.id)) inspector.setTechnique(technique.id, enabled) },
      }
    }
    for (const [name, entries] of Object.entries(groups)) schema[name] = folder(entries)
    return schema
  }, { store }, [layout])
  useEffect(() => {
    set({ lod: view === 'lod', ...Object.fromEntries(techniques.map(technique => [technique.id, technique.enabled])) })
  }, [layout, set, techniques, view])
  const release = () => {
    const focused = document.activeElement
    if (focused instanceof HTMLInputElement && focused.type === 'checkbox') focused.blur()
  }
  return <div className="bs-inspect-controls" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onChange={release}>
    <LevaPanel store={store} fill hideCopyButton titleBar={{ title: 'Debug', drag: false, filter: false }} theme={theme} />
  </div>
}

export function InspectHud({ inspector, dump, lodLegend = distanceLegend, children }: {
  inspector: Inspector
  dump?: DumpControl
  lodLegend?: readonly { color: string; label: string }[]
  children?: ReactNode
}) {
  const snapshot = useSyncExternalStore(inspector.subscribe, inspector.getSnapshot, inspector.getSnapshot)
  const [logs, setLogs] = useState(true)
  const metrics = snapshot.metrics
  const gpu = Object.entries(metrics?.gpuMs ?? {})
  const rows: Array<[string, string]> = [
    ['CPU p50 / p95', metrics ? `${ms(metrics.cpu.p50)} / ${ms(metrics.cpu.p95)} ms` : '—'],
    ['GPU p50 / p95', metrics?.gpu ? `${ms(metrics.gpu.p50)} / ${ms(metrics.gpu.p95)} ms` : 'n/a'],
    ['GPU longest pass', gpu.length ? `${ms(Math.max(...gpu.map(([, time]) => time)))} ms` : 'n/a'],
    ['Triangles', metrics ? `${count.format(metrics.drawnTriangles)} / ${count.format(metrics.sceneTriangles)}` : '—'],
    ['Draw calls', metrics ? count.format(metrics.drawCalls) : '—'],
    ['Geometry culled', metrics ? `${ms(metrics.culledPercent)}%` : '—'],
    ['FPS', metrics ? `${Math.round(metrics.fps)}` : '—'],
  ]
  return <>
    {logs && <div className="bs-debug" aria-label="Debug readout" role="log">
      <DebugBlock>
        <div>{snapshot.renderer} · {snapshot.tier} tier</div>
        <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {dump?.message && <div>{dump.message}</div>}
        {snapshot.view === 'lod' && <div>{lodLegend.map(entry => <span key={entry.label} style={{ color: entry.color, marginRight: '1.5ch' }}>{entry.label}</span>)}</div>}
        {dump?.status === 'sending' && <div>Saving stats…</div>}
        {dump?.status === 'saved' && <div>Stats saved to the dev server.</div>}
        {dump?.status === 'error' && <div>Stats could not be saved. Press T to retry.</div>}
      </DebugBlock>
      {gpu.length > 0 && <DebugBlock><dl>{gpu.map(([pass, time]) => <div key={pass}><dt>{pass}</dt><dd>{ms(time)} ms</dd></div>)}</dl></DebugBlock>}
      {children}
    </div>}
    <InspectControls inspector={inspector} dump={dump} logs={logs} onLogs={setLogs} />
  </>
}
