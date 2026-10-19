import { mountTuning, type TuningOptions } from './tuning'
import './style.css'

export function createUI() {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <div id="viewport"></div>
    <header class="scene-title">
      <div class="eyebrow"><span class="status-dot"></span> BLACKSITE / FIELD STUDIES</div>
      <h1>Tidal Citadel<span class="edition">01</span></h1>
    </header>
    <aside id="tuning-shell" data-collapsed="true" aria-label="Scene tuning">
      <div id="tuning-controls"></div>
      <section id="diagnostics" hidden aria-label="Live rendering diagnostics">
        <div class="diagnostic"><span>Visible clusters</span><strong id="visible">—</strong><small id="culled">GPU counters pending</small></div>
        <div class="diagnostic"><span>Frame interval</span><strong id="frame">—</strong><small id="frame-detail">Rolling median · p95</small></div>
        <div class="diagnostic-note"><span>Triangle budget</span><p id="reduction">Source geometry</p></div>
        <div class="diagnostic-note"><span>GPU work</span><p id="gpu-detail">Render + compute timestamps</p></div>
        <p id="resolution"></p>
        <div class="scene-info"><strong id="source-total">Preparing geometry</strong><span id="source-meta"></span></div>
      </section>
    </aside>
    <div id="legend" role="status" hidden></div>
    <footer id="telemetry" aria-label="Live rendering statistics" hidden>
      <div class="metric"><span>GPU WORK</span><strong id="gpu">—</strong></div>
      <div class="metric"><span>DRAWN TRIANGLES</span><strong id="triangles">—</strong></div>
    </footer>
    <div class="help"><span class="help-desktop">Drag to orbit <i>·</i> Scroll to explore</span><span class="help-touch">Drag to orbit <i>·</i> Pinch to explore</span></div>
    <div id="loading"><div class="loading-card"><div class="eyebrow"><span class="status-dot"></span> BLACKSITE / FIELD STUDIES</div><h2>A coast worth exploring.</h2><p id="loading-status">Starting WebGPU…</p><div class="loading-track"></div></div></div>
  `
  const text = (id: string, value: string) => { document.getElementById(id)!.textContent = value }
  return {
    viewport: document.getElementById('viewport')!,
    text,
    mountTuning: (options: TuningOptions) => mountTuning(document.getElementById('tuning-controls')!, options),
    status: (message: string) => text('loading-status', message),
    ready: () => { document.getElementById('loading')!.hidden = true },
    fail: (error: unknown) => {
      document.getElementById('loading')!.hidden = false
      document.querySelector('#loading h2')!.textContent = 'Unable to start'
      text('loading-status', error instanceof Error ? error.message : String(error))
      document.querySelector('.loading-track')?.remove()
    },
  }
}
