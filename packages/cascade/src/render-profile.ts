/** Bounded, local-only telemetry attached to the demo's replay download. */
export class RenderProfile {
  private startedAt = 0;
  private windowAt = 0;
  private metrics = new Map<string, { count: number; sum: number; max: number; samples: number[] }>();
  private windows: object[] = [];
  private windowCursor = 0;
  private frames: object[] = [];
  private frameCursor = 0;
  private events: object[] = [];
  private eventCursor = 0;
  private frameCount = 0;
  private totalFrames = 0;
  private totalWindows = 0;
  private totalEvents = 0;
  private currentState: object = {};

  reset(now: number) {
    this.startedAt = this.windowAt = now;
    this.metrics.clear();
    this.windows = []; this.frames = []; this.events = [];
    this.windowCursor = this.frameCursor = this.eventCursor = 0;
    this.frameCount = this.totalFrames = this.totalWindows = this.totalEvents = 0;
    this.currentState = {};
  }

  record(name: string, ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return;
    let metric = this.metrics.get(name);
    if (!metric) {
      metric = { count: 0, sum: 0, max: 0, samples: [] };
      this.metrics.set(name, metric);
    }
    metric.count++; metric.sum += ms; metric.max = Math.max(metric.max, ms);
    // Mean/max/count use all observations; quantiles are bounded to 1024 per window.
    if (metric.samples.length < 1024) metric.samples.push(ms);
  }

  event(now: number, type: string, detail: object = {}) {
    if (now < this.startedAt) return;
    this.events[this.eventCursor] = { atMs: now - this.startedAt, type, ...detail };
    this.eventCursor = (this.eventCursor + 1) % 256;
    this.totalEvents++;
  }

  frame(now: number, timings: Record<string, number>, state: object) {
    for (const [name, ms] of Object.entries(timings)) this.record(name, ms);
    this.frames[this.frameCursor] = { atMs: now - this.startedAt, ...timings, ...state };
    this.frameCursor = (this.frameCursor + 1) % 3600;
    this.frameCount++; this.totalFrames++;
    this.currentState = state;
    if (now - this.windowAt >= 1000) {
      this.windows[this.windowCursor] = this.window(now);
      this.windowCursor = (this.windowCursor + 1) % 600;
      this.totalWindows++;
      this.metrics.clear(); this.frameCount = 0; this.windowAt = now;
    }
  }

  private window(now: number) {
    const metrics: Record<string, object> = {};
    for (const [name, metric] of this.metrics) {
      const sorted = [...metric.samples].sort((a, b) => a - b);
      metrics[name] = {
        count: metric.count, mean: metric.sum / metric.count, max: metric.max,
        p50: sorted[Math.ceil(sorted.length * .5) - 1],
        p95: sorted[Math.ceil(sorted.length * .95) - 1],
        quantileSamples: sorted.length,
      };
    }
    const durationMs = now - this.windowAt;
    return { fromMs: this.windowAt - this.startedAt, toMs: now - this.startedAt,
      durationMs, frames: this.frameCount, fps: durationMs > 0 ? this.frameCount * 1000 / durationMs : null,
      metrics, state: this.currentState };
  }

  export(now: number, environment: object) {
    const ordered = (items: object[], cursor: number) => [...items.slice(cursor), ...items.slice(0, cursor)];
    return {
      schemaVersion: 1, build: 'secondary-growth-3', baseCommit: '195b891', capturedAt: new Date().toISOString(),
      durationMs: now - this.startedAt, environment,
      units: 'All timings are milliseconds. Counts and renderer statistics are unitless.',
      notes: [
        'callbackMs excludes final telemetry recording, reported separately as telemetryMs. GPU samples are summarized when resolved; gpuSampleAgeMs reports that delay.',
        'worker.* metrics sample received snapshots, not every worker tick. workerStepMs includes snapshotMs; workerMs excludes snapshotMs; physicsMs includes nativeStepMs plus physics bookkeeping. Do not sum overlapping scopes.',
        'renderer.secondary.* and renderer.edges.* are nested scopes; edges.compactionMs is part of edges.insertionMs. Secondary growth counters distinguish buffer resizing from full rebuilding.',
        'edgeRebuilds counts allocated edge batches; edgeGeometryBuilds counts generated faces. edgeFacesAdded/RemovedThisUpdate track incremental changes.',
        'CPU scopes are instrumented elapsed wall time, not a sampled JavaScript call graph.',
        'renderer.* are children of syncMs; do not add them to syncMs or callbackMs.',
        'submitMs measures CPU time in gl.render, not GPU completion. GPU is sampled asynchronously every eighth draw; absent samples mean unavailable/pending/disjoint, never zero.',
        'frameIntervalMs includes browser scheduling, other tasks, GPU/vsync waits and background throttling; it cannot attribute those by itself.',
        'workerMessageMs excludes browser structured-clone/deserialization before the handler starts.',
        'Draw statistics include shadow passes. Windows use real elapsed time and include visibility/paused state.',
      ],
      retention: { windowLimit: 600, frameLimit: 3600, eventLimit: 256,
        totalFrames: this.totalFrames, totalWindows: this.totalWindows, totalEvents: this.totalEvents },
      windows: ordered(this.windows, this.windowCursor), currentWindow: this.window(now),
      recentFrames: ordered(this.frames, this.frameCursor), events: ordered(this.events, this.eventCursor),
    };
  }
}
