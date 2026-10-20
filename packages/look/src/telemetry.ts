import { Matrix4, Vector3 } from 'three'
import type { Camera, RenderTarget } from 'three'
import type { WebGPURenderer } from 'three/webgpu'

export type PassTrace = {
  kind: string
  target: string
  width: number
  height: number
  position: number
  angle: number
  projection: number
  recorded: number
  notReady: number
  reallocated: boolean
  resized: boolean
}

export type FrameTrace = {
  frame: number
  at: number
  dt: number
  resumed: boolean
  passes: PassTrace[]
  order: string
  cascadeAge: number[]
  historyReset: boolean
}

export type MotionProbe = {
  frame: number
  samples: number
  cameraMoved: boolean
  movingFraction: number
  meanLength: number
  p95Length: number
  maxLength: number
  centre: number[]
  resolveDifference: { mean: number; p95: number; over25Percent: number }
}

export type LookTelemetrySnapshot = {
  frames: number
  frame: number
  dt: number
  temporal: { traa: boolean; gtao: boolean }
  events: { at: number; name: string }[]
  lastPasses: PassTrace[]
  window: {
    frames: number
    cameraMismatch: number
    notReadyDraws: number
    targetReallocations: number
    passOrderChanges: number
    historyResets: number
    maxCascadeAge: number[]
    maxDt: number
    resumedFrames: number
  }
}

const WINDOW = 120
const RING = 600
const half = (value: number) => {
  const sign = value & 0x8000 ? -1 : 1
  const exponent = (value >> 10) & 31
  const mantissa = value & 1023
  return exponent === 0 ? sign * 5.960464477539063e-8 * mantissa : exponent === 31 ? sign * Infinity : sign * 2 ** (exponent - 15) * (1 + mantissa / 1024)
}

export class LookTelemetry {
  readonly ring: FrameTrace[] = []
  readonly events: { at: number; name: string }[] = []
  readonly passes = new Map<string, PassTrace>()
  private current: FrameTrace | null = null
  private open: PassTrace | null = null
  private resumedPending = false
  private frameIndex = 0
  private lastAt = 0
  private lastOrder = ''
  private readonly targetIds = new WeakMap<object, number>()
  private readonly targetByKind = new Map<string, { gpu: number; width: number; height: number }>()
  private nextId = 1
  private historyKey = ''
  private readonly viewPosition = new Vector3()
  private readonly viewForward = new Vector3()
  private readonly activePosition = new Vector3()
  private readonly activeForward = new Vector3()
  readonly matrices = { view: new Matrix4(), projection: new Matrix4(), previousView: new Matrix4(), previousProjection: new Matrix4(), valid: false }

  constructor(private readonly renderer: WebGPURenderer, private readonly camera: Camera, private readonly cascadeCount: () => number, private readonly cascadeAge: (index: number) => number,
    private readonly history: () => { width: number; height: number } | null, readonly temporal: { traa: boolean; gtao: boolean }) {}

  mark(name: string) {
    this.events.push({ at: performance.now(), name })
    if (this.events.length > 64) this.events.shift()
    if (name === 'resume') this.resumedPending = true
  }

  beginFrame(dt: number) {
    const now = performance.now()
    const history = this.history()
    const key = history ? `${history.width}x${history.height}` : ''
    const frame = this.frameIndex++
    const ages: number[] = []
    for (let index = 0; index < this.cascadeCount(); index++) ages.push(this.cascadeAge(index))
    this.current = { frame, at: now, dt: this.lastAt ? now - this.lastAt : 0, resumed: this.resumedPending, passes: [], order: '', cascadeAge: ages, historyReset: key !== this.historyKey && this.historyKey !== '' }
    void dt
    this.historyKey = key
    this.resumedPending = false
    this.lastAt = now
    this.matrices.previousView.copy(this.matrices.view)
    this.matrices.previousProjection.copy(this.matrices.projection)
    this.matrices.view.copy(this.camera.matrixWorldInverse)
    this.matrices.projection.copy(this.camera.projectionMatrix)
    this.matrices.valid = this.frameIndex > 1
    this.camera.getWorldPosition(this.viewPosition)
    this.camera.getWorldDirection(this.viewForward)
    this.ring.push(this.current)
    if (this.ring.length > RING) this.ring.shift()
  }

  beginPass(kind: string, active: Camera, target: RenderTarget | null) {
    const trace = this.current
    if (!trace) return
    active.getWorldPosition(this.activePosition)
    active.getWorldDirection(this.activeForward)
    const comparable = kind === 'depth' || kind === 'lit'
    let projection = 0
    if (comparable) {
      const a = active.projectionMatrix.elements, b = this.camera.projectionMatrix.elements
      for (let i = 0; i < 16; i++) projection = Math.max(projection, Math.abs(a[i]! - b[i]!))
    }
    const texture = target?.texture
    const gpu = texture ? (this.renderer.backend.get(texture) as { texture?: object }).texture : undefined
    let id = 0
    if (gpu) { id = this.targetIds.get(gpu) ?? 0; if (!id) { id = this.nextId++; this.targetIds.set(gpu, id) } }
    const width = target?.width ?? 0, height = target?.height ?? 0
    const previous = this.targetByKind.get(kind)
    const pass: PassTrace = {
      kind, target: texture?.name || (target ? 'target' : 'canvas'), width, height,
      position: comparable ? this.activePosition.distanceTo(this.viewPosition) : 0,
      angle: comparable ? Math.acos(Math.min(1, Math.max(-1, this.activeForward.dot(this.viewForward)))) : 0,
      projection, recorded: 0, notReady: 0,
      reallocated: Boolean(previous && id && previous.gpu !== id), resized: Boolean(previous && (previous.width !== width || previous.height !== height)),
    }
    if (id) this.targetByKind.set(kind, { gpu: id, width, height })
    this.open = pass
    trace.passes.push(pass)
    if (!kind.startsWith("shadow")) trace.order += `${kind},`
  }

  endPass() {
    if (this.open) this.passes.set(this.open.kind, this.open)
    this.open = null
  }

  recordDraw(ready: boolean) {
    if (!this.open) return
    this.open.recorded++
    if (!ready) this.open.notReady++
  }

  endFrame() {
    const trace = this.current
    if (!trace) return
    if (trace.order !== this.lastOrder) trace.order = `!${trace.order}`
    else trace.order = `=${trace.order}`
    this.lastOrder = trace.order.slice(1)
  }

  snapshot(): LookTelemetrySnapshot {
    const frames = this.ring.slice(-WINDOW)
    const last = this.ring.at(-1) ?? null
    const maxAge: number[] = []
    let cameraMismatch = 0, notReadyDraws = 0, targetReallocations = 0, passOrderChanges = 0, historyResets = 0, maxDt = 0, resumedFrames = 0
    for (const frame of frames) {
      for (const pass of frame.passes) {
        if (pass.position > 1e-4 || pass.angle > 1e-4 || pass.projection > 0.5) cameraMismatch++
        notReadyDraws += pass.notReady
        if (pass.reallocated || pass.resized) targetReallocations++
      }
      if (frame.order.startsWith('!') && frame.frame > 2) passOrderChanges++
      if (frame.historyReset) historyResets++
      if (frame.resumed) resumedFrames++
      maxDt = Math.max(maxDt, frame.dt)
      frame.cascadeAge.forEach((age, index) => { maxAge[index] = Math.max(maxAge[index] ?? 0, age) })
    }
    return {
      frames: this.ring.length, frame: last?.frame ?? 0, dt: last?.dt ?? 0, temporal: { ...this.temporal }, events: this.events.slice(-16),
      lastPasses: [...this.passes.values()],
      window: { frames: frames.length, cameraMismatch, notReadyDraws, targetReallocations, passOrderChanges, historyResets, maxCascadeAge: maxAge, maxDt, resumedFrames },
    }
  }

  recent(count = 240) { return this.ring.slice(-count) }

  async probeMotion(target: RenderTarget, velocityIndex: number, current: RenderTarget, resolved: RenderTarget): Promise<MotionProbe> {
    const cameraMoved = !this.matrices.view.equals(this.matrices.previousView)
    const frame = this.frameIndex - 1
    const [velocity, beauty, resolve] = await Promise.all([
      this.renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height, velocityIndex) as Promise<Uint16Array>,
      this.renderer.readRenderTargetPixelsAsync(current, 0, 0, current.width, current.height) as Promise<Uint16Array>,
      this.renderer.readRenderTargetPixelsAsync(resolved, 0, 0, resolved.width, resolved.height) as Promise<Uint16Array>,
    ])
    const width = target.width, height = target.height
    const lengths: number[] = [], differences: number[] = []
    let moving = 0
    for (let y = 8; y < height; y += 24) for (let x = 8; x < width; x += 24) {
      const i = (y * width + x) * 4
      const length = Math.hypot(half(velocity[i]!), half(velocity[i + 1]!))
      lengths.push(length)
      if (length > 5e-4) moving++
      const a = (half(beauty[i]!) + half(beauty[i + 1]!) + half(beauty[i + 2]!)) / 3, b = (half(resolve[i]!) + half(resolve[i + 1]!) + half(resolve[i + 2]!)) / 3
      differences.push(Math.abs(a - b) / Math.max(a, b, 1e-7))
    }
    lengths.sort((a, b) => a - b)
    differences.sort((a, b) => a - b)
    const i = ((height >> 1) * width + (width >> 1)) * 4
    return {
      frame, samples: lengths.length, cameraMoved, movingFraction: moving / Math.max(1, lengths.length),
      meanLength: lengths.reduce((sum, value) => sum + value, 0) / Math.max(1, lengths.length), p95Length: lengths[Math.floor(lengths.length * 0.95)] ?? 0, maxLength: lengths.at(-1) ?? 0,
      centre: [half(velocity[i]!), half(velocity[i + 1]!)],
      resolveDifference: {
        mean: differences.reduce((sum, value) => sum + value, 0) / Math.max(1, differences.length), p95: differences[Math.floor(differences.length * 0.95)] ?? 0,
        over25Percent: differences.filter(value => value > 0.25).length / Math.max(1, differences.length),
      },
    }
  }
}
