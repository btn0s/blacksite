export type InspectView = 'lit' | 'lod'

export type FrameSample = {
  frameMs: number
  cpuMs: number
  sceneTriangles: number
  drawnTriangles: number
  drawCalls: number
  culledPercent: number
  gpuMs?: Readonly<Record<string, number>>
}

export type Distribution = {
  samples: number
  mean: number
  p50: number
  p95: number
  max: number
}

export type Technique = {
  id: string
  label: string
  description?: string
  /** Controls-panel folder; techniques without one go under Techniques. */
  group?: string
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

export type TechniqueState = Omit<Technique, 'setEnabled'>

export type Parameter = {
  id: string
  label: string
  description?: string
  /** Controls-panel folder, collapsed by default. */
  group: string
  value: number
  min: number
  max: number
  step: number
  setValue: (value: number) => void
}

export type ParameterState = Omit<Parameter, 'setValue'>

export type Action = {
  id: string
  label: string
  group: string
  /** The returned text is shown in the panel for a few seconds. */
  run: () => string | void | Promise<string | void>
}

export type ActionState = Omit<Action, 'run'>

export type InspectSnapshot = {
  renderer: string
  tier: string
  view: InspectView
  techniques: readonly TechniqueState[]
  parameters: readonly ParameterState[]
  actions: readonly ActionState[]
  notice: string | null
  metrics: (FrameSample & { cpu: Distribution; gpu: Distribution | null; fps: number }) | null
}

export type Inspector = ReturnType<typeof createInspector>

export function distribution(values: ArrayLike<number>): Distribution {
  if (!values.length) return { samples: 0, mean: 0, p50: 0, p95: 0, max: 0 }
  const sorted = Array.from(values).sort((a, b) => a - b)
  const at = (percentile: number) => sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)]!
  return {
    samples: sorted.length,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1]!,
  }
}

export function createInspector(options: {
  renderer: string
  tier: string
  techniques?: Technique[]
  onViewChange?: (view: InspectView) => void
  windowFrames?: number
  windowMs?: number
  publishIntervalMs?: number
}) {
  const times = new Float64Array(Math.max(1, Math.floor(options.windowFrames ?? 1200)))
  const cpuTimes = new Float64Array(times.length)
  const gpuTimes = new Float64Array(times.length)
  gpuTimes.fill(Number.NaN)
  const techniques = new Map<string, Technique>()
  const parameters = new Map<string, Parameter>()
  const actions = new Map<string, Action>()
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()
  let cursor = 0
  let count = 0
  let elapsed = 0
  let windowDuration = 0
  let latest: FrameSample | null = null
  let snapshot: InspectSnapshot = {
    renderer: options.renderer,
    tier: options.tier,
    view: 'lit',
    techniques: [],
    parameters: [],
    actions: [],
    notice: null,
    metrics: null,
  }

  function emit() {
    for (const listener of listeners) listener()
  }

  function publishTechniques() {
    snapshot = { ...snapshot, techniques: [...techniques.values()].map(({ setEnabled: _, ...technique }) => technique) }
    emit()
  }

  function publishControls() {
    snapshot = {
      ...snapshot,
      parameters: [...parameters.values()].map(({ setValue: _, ...parameter }) => parameter),
      actions: [...actions.values()].map(({ run: _, ...action }) => action),
    }
    emit()
  }

  function notify(text: string) {
    clearTimeout(noticeTimer)
    snapshot = { ...snapshot, notice: text }
    emit()
    noticeTimer = setTimeout(() => {
      snapshot = { ...snapshot, notice: null }
      emit()
    }, 5000)
  }

  function history() {
    const frameTimesMs = Array.from({ length: count }, (_, i) => times[(cursor - count + i + times.length) % times.length]!)
    const cpuTimesMs = Array.from({ length: count }, (_, i) => cpuTimes[(cursor - count + i + times.length) % times.length]!)
    const gpuTimesMs = Array.from({ length: count }, (_, i) => gpuTimes[(cursor - count + i + times.length) % times.length]!).filter(Number.isFinite)
    return {
      frameTimesMs,
      cpuTimesMs,
      gpuTimesMs,
      durationMs: windowDuration,
      frames: distribution(frameTimesMs),
      cpu: distribution(cpuTimesMs),
      gpu: gpuTimesMs.length ? distribution(gpuTimesMs) : null,
    }
  }

  function flush() {
    if (!latest) return
    const { frames, cpu, gpu } = history()
    snapshot = {
      ...snapshot,
      metrics: { ...latest, gpuMs: latest.gpuMs ? { ...latest.gpuMs } : undefined, cpu, gpu, fps: 1000 / frames.mean },
    }
    elapsed = 0
    emit()
  }

  for (const technique of options.techniques ?? []) {
    if (techniques.has(technique.id)) throw new Error(`Inspection technique already registered: ${technique.id}`)
    techniques.set(technique.id, { ...technique })
  }
  publishTechniques()

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    sample(frame: FrameSample) {
      if (!Number.isFinite(frame.frameMs) || frame.frameMs <= 0 || !Number.isFinite(frame.cpuMs) || frame.cpuMs < 0) return
      latest = frame
      if (count === times.length) windowDuration -= times[cursor]!
      times[cursor] = frame.frameMs
      cpuTimes[cursor] = frame.cpuMs
      gpuTimes[cursor] = frame.gpuMs ? Object.values(frame.gpuMs).reduce((sum, time) => sum + time, 0) : Number.NaN
      cursor = (cursor + 1) % times.length
      count = Math.min(count + 1, times.length)
      windowDuration += frame.frameMs
      while (count > 1) {
        const oldest = times[(cursor - count + times.length) % times.length]!
        if (windowDuration - oldest < (options.windowMs ?? 10000)) break
        windowDuration -= oldest
        count--
      }
      elapsed += frame.frameMs
      if (!snapshot.metrics || elapsed >= (options.publishIntervalMs ?? 250)) flush()
    },
    flush,
    history,
    setDevice(device: { renderer: string; tier: string }) {
      snapshot = { ...snapshot, ...device }
      emit()
    },
    setView(view: InspectView) {
      if (view === snapshot.view) return
      options.onViewChange?.(view)
      snapshot = { ...snapshot, view }
      emit()
    },
    setTechnique(id: string, enabled: boolean) {
      const technique = techniques.get(id)
      if (!technique) throw new Error(`Unknown inspection technique: ${id}`)
      if (technique.enabled === enabled) return
      technique.setEnabled(enabled)
      technique.enabled = enabled
      publishTechniques()
    },
    setParameter(id: string, value: number) {
      const parameter = parameters.get(id)
      if (!parameter) throw new Error(`Unknown inspection parameter: ${id}`)
      if (parameter.value === value) return
      parameter.setValue(value)
      parameter.value = value
      publishControls()
    },
    registerParameter(parameter: Parameter) {
      if (parameters.has(parameter.id)) throw new Error(`Inspection parameter already registered: ${parameter.id}`)
      const registered = { ...parameter }
      parameters.set(parameter.id, registered)
      publishControls()
      return () => {
        if (parameters.get(parameter.id) !== registered) return
        parameters.delete(parameter.id)
        publishControls()
      }
    },
    registerAction(action: Action) {
      if (actions.has(action.id)) throw new Error(`Inspection action already registered: ${action.id}`)
      const registered = { ...action }
      actions.set(action.id, registered)
      publishControls()
      return () => {
        if (actions.get(action.id) !== registered) return
        actions.delete(action.id)
        publishControls()
      }
    },
    async runAction(id: string) {
      const action = actions.get(id)
      if (!action) throw new Error(`Unknown inspection action: ${id}`)
      try {
        const text = await action.run()
        if (text) notify(text)
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error))
      }
    },
    registerTechnique(technique: Technique) {
      if (techniques.has(technique.id)) throw new Error(`Inspection technique already registered: ${technique.id}`)
      const registered = { ...technique }
      techniques.set(technique.id, registered)
      publishTechniques()
      return () => {
        if (techniques.get(technique.id) !== registered) return
        techniques.delete(technique.id)
        publishTechniques()
      }
    },
  }
}
