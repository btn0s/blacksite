import { useEffect, useRef } from 'react'
import { addAfterEffect, useFrame, useThree } from '@react-three/fiber'
import { Frustum, Matrix4, Mesh, type Object3D, type Texture } from 'three'
import { sampleView } from '@blacksite/check'
import type { FrameSample, Inspector, Technique, InspectView } from '@blacksite/inspect'
import type { WebGPULook } from '@blacksite/look/webgpu'
import type { CharacterHandle } from '@blacksite/subject'
import type { WebGPURenderer } from 'three/webgpu'

export type TelemetryAction = {
  current: (() => Promise<void>) | null
  status(value: 'idle' | 'sending' | 'saved' | 'error'): void
}

export type InspectionContent = {
  identity: object
  roots: readonly Object3D[]
  sources: readonly { sceneTriangles: number; drawnTriangles: number }[]
  techniques: Technique[]
  setView(view: InspectView): void
  details(): unknown
  probe?(): Promise<unknown>
  textures?(): readonly { texture: Texture; reportedBytes: number; residentBytes: number }[]
}

export function SceneInspection({ name, look, warm, walker, inspector, telemetry, content }: {
  name: string
  look: { current: WebGPULook | null }
  warm: { current: number }
  walker: CharacterHandle
  inspector: Inspector
  telemetry: TelemetryAction
  content(): InspectionContent | null
}) {
  const { gl, scene, camera, size } = useThree()
  const renderer = gl as unknown as WebGPURenderer
  const active = useRef<object | null>(null)
  const cleanup = useRef<Array<() => void>>([])
  const resumed = useRef(false)
  const previousFrame = useRef<number | null>(null)
  const callbackStart = useRef(0)
  const pendingSample = useRef<Omit<FrameSample, 'cpuMs'> | null>(null)
  const otherMeshes = useRef<Mesh[]>([])
  const frustum = useRef(new Frustum())
  const projection = useRef(new Matrix4())

  useFrame(() => {
    callbackStart.current = performance.now()
    pendingSample.current = null
  }, -Infinity)

  useEffect(() => addAfterEffect(() => {
    const frame = pendingSample.current
    if (!frame) return
    pendingSample.current = null
    inspector.sample({ ...frame, cpuMs: performance.now() - callbackStart.current })
  }), [inspector])

  useFrame(() => {
    const now = performance.now()
    const previous = previousFrame.current
    previousFrame.current = now
    if (document.hidden || walker.status().paused) { previousFrame.current = null; return }
    if (resumed.current || previous === null) { resumed.current = false; return }
    const current = content()
    if (!current || !look.current || warm.current < 10 || !walker.als.pose.current.ready) return
    if (active.current !== current.identity) {
      cleanup.current.forEach(dispose => dispose())
      active.current = current.identity
      current.setView(inspector.getSnapshot().view)
      otherMeshes.current = []
      const roots = new Set<Object3D>(current.roots)
      for (const child of scene.children) {
        if (roots.has(child)) continue
        child.traverse(object => { if (object instanceof Mesh) otherMeshes.current.push(object) })
      }
      cleanup.current = current.techniques.map(technique => inspector.registerTechnique(technique))
    }
    const stats = current.sources
    let sceneTriangles = stats.reduce((sum, entry) => sum + entry.sceneTriangles, 0)
    let drawnTriangles = stats.reduce((sum, entry) => sum + entry.drawnTriangles, 0)
    frustum.current.setFromProjectionMatrix(projection.current.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem)
    for (const mesh of otherMeshes.current) {
      if (!mesh.visible || !mesh.layers.test(camera.layers)) continue
      let visible = true
      mesh.traverseAncestors(parent => { if (!parent.visible) visible = false })
      if (!visible) continue
      const geometry = mesh.geometry
      const elements = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0
      const triangles = Math.max(0, Math.min(elements - geometry.drawRange.start, geometry.drawRange.count)) / 3
      sceneTriangles += triangles
      if (!mesh.frustumCulled || frustum.current.intersectsObject(mesh)) drawnTriangles += triangles
    }
    pendingSample.current = {
      frameMs: now - previous,
      sceneTriangles,
      drawnTriangles,
      drawCalls: renderer.info.render.drawCalls,
      culledPercent: sceneTriangles ? Math.max(0, 100 * (1 - drawnTriangles / sceneTriangles)) : 0,
      gpuMs: look.current.timings() ?? undefined,
    }
  }, 2)

  useEffect(() => {
    let sending = false
    let confirmation = 0
    const dump = async () => {
      if (sending) return
      sending = true
      clearTimeout(confirmation)
      telemetry.status('sending')
      inspector.flush()
      const stats = inspector.getSnapshot()
      const device = renderer.backend.device
      const adapter = device.adapterInfo
      const current = content()
      const memory = { ...renderer.info.memory }
      for (const { residentBytes, reportedBytes } of current?.textures?.() ?? []) {
        memory.texturesSize += residentBytes - reportedBytes
        memory.total += residentBytes - reportedBytes
      }
      const snapshot = {
        version: 1,
        scene: name,
        capturedAt: new Date().toISOString(),
        renderer: 'WebGPU',
        tier: stats.tier,
        device: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          hardwareConcurrency: navigator.hardwareConcurrency,
          touchPoints: navigator.maxTouchPoints,
          screen: { width: screen.width, height: screen.height, pixelRatio: devicePixelRatio },
          adapter: adapter ? { vendor: adapter.vendor, architecture: adapter.architecture, device: adapter.device, description: adapter.description } : null,
          features: [...device.features],
        },
        viewport: { width: size.width, height: size.height, pixelRatio: renderer.getPixelRatio() },
        player: { position: walker.position.toArray(), velocity: walker.velocity.toArray(), grounded: walker.grounded, gait: walker.als.pose.current.character?.gait, yaw: walker.control.yaw, pitch: walker.control.pitch, view: sampleView(camera) },
        stats: stats.metrics,
        history: inspector.history(),
        view: stats.view,
        techniques: stats.techniques,
        content: current?.details(),
        probe: await current?.probe?.().catch(error => ({ error: String(error) })),
        memory,
        submissions: { triangles: renderer.info.render.triangles, drawCalls: renderer.info.render.drawCalls, passes: renderer.info.render.frameCalls },
      }
      try {
        const response = await fetch('/__inspect/telemetry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot), signal: AbortSignal.timeout(10000) })
        if (!response.ok) throw new Error(`Telemetry upload returned ${response.status}`)
        telemetry.status('saved')
        confirmation = window.setTimeout(() => telemetry.status('idle'), 3500)
      } catch {
        telemetry.status('error')
      } finally {
        sending = false
      }
    }
    const press = (event: KeyboardEvent) => {
      if (event.code !== 'KeyT' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))) return
      event.preventDefault()
      void dump()
    }
    telemetry.current = dump
    Object.assign(window, { __sceneInspect: inspector })
    addEventListener('keydown', press)
    return () => {
      clearTimeout(confirmation)
      telemetry.current = null
      removeEventListener('keydown', press)
      if ((window as { __sceneInspect?: unknown }).__sceneInspect === inspector) delete (window as { __sceneInspect?: unknown }).__sceneInspect
    }
  }, [camera, content, inspector, name, renderer, size.height, size.width, telemetry, walker])

  useEffect(() => {
    const visibility = () => { resumed.current = true }
    let paused = walker.status().paused
    const unsubscribe = walker.subscribe(() => {
      const next = walker.status().paused
      if (next !== paused) { resumed.current = true; previousFrame.current = null; paused = next; look.current?.telemetry.mark(next ? 'pause' : 'resume') }
    })
    addEventListener('visibilitychange', visibility)
    return () => { unsubscribe(); removeEventListener('visibilitychange', visibility); cleanup.current.forEach(dispose => dispose()) }
  }, [walker])
  return null
}
