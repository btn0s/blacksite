import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Frustum, Matrix4, Mesh, type Object3D } from 'three'
import { sampleView } from '@blacksite/check'
import type { Inspector } from '@blacksite/inspect'
import type { CharacterHandle } from '@blacksite/subject'
import type { WebGPURenderer } from 'three/webgpu'
import type { Shared } from './Game'
import type { LandscapeHandle } from './Landscape'

export type TelemetryAction = {
  current: (() => Promise<void>) | null
  status(value: 'idle' | 'sending' | 'saved' | 'error'): void
}

export function Inspection({ shared, walker, inspector, telemetry }: { shared: Shared; walker: CharacterHandle; inspector: Inspector; telemetry: TelemetryAction }) {
  const { gl, scene, camera, size } = useThree()
  const renderer = gl as unknown as WebGPURenderer
  const active = useRef<LandscapeHandle | null>(null)
  const cleanup = useRef<Array<() => void>>([])
  const resumed = useRef(false)
  const otherMeshes = useRef<Mesh[]>([])
  const frustum = useRef(new Frustum())
  const projection = useRef(new Matrix4())

  useFrame((_, delta) => {
    if (document.hidden) return
    if (resumed.current) { resumed.current = false; return }
    const landscape = shared.landscape.current
    if (!landscape || !shared.look.current || shared.warm.current < 10 || !walker.als.pose.current.ready) return
    if (active.current !== landscape) {
      cleanup.current.forEach(dispose => dispose())
      active.current = landscape
      const lod = inspector.getSnapshot().view === 'lod'
      landscape.terrain.setLodView(lod)
      landscape.forest.setLodView(lod)
      shared.look.current.setDebug(lod)
      otherMeshes.current = []
      const landscapeRoots = new Set<Object3D>([landscape.terrain.object, landscape.cover.object, landscape.forest.object])
      for (const child of scene.children) {
        if (landscapeRoots.has(child)) continue
        child.traverse(object => { if (object instanceof Mesh) otherMeshes.current.push(object) })
      }
      cleanup.current = [
        inspector.registerTechnique({ id: 'terrain-lod', label: 'Terrain LOD', description: 'Off: finest grid within 256 m; LOD beyond the cap.', enabled: true, setEnabled: landscape.terrain.setLodEnabled }),
        inspector.registerTechnique({ id: 'tree-lod', label: 'Tree LOD / impostors', description: 'Off: nearest 256 trees as full meshes.', enabled: true, setEnabled: landscape.forest.setLodEnabled }),
        inspector.registerTechnique({ id: 'cover-culling', label: 'Ground-cover culling', description: 'Off: all patches inside the tier’s cover radius.', enabled: true, setEnabled: landscape.cover.setCullingEnabled }),
      ]
    }
    const stats = [landscape.terrain.stats, landscape.cover.stats, landscape.forest.stats]
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
    inspector.sample({
      frameMs: delta * 1000,
      sceneTriangles,
      drawnTriangles,
      drawCalls: renderer.info.render.drawCalls,
      culledPercent: sceneTriangles ? Math.max(0, 100 * (1 - drawnTriangles / sceneTriangles)) : 0,
      gpuMs: shared.look.current.timings() ?? undefined,
    })
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
      const landscape = shared.landscape.current
      const snapshot = {
        version: 1,
        scene: 'valley',
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
        landscape: landscape && { terrain: { ...landscape.terrain.stats }, cover: { ...landscape.cover.stats }, forest: { ...landscape.forest.stats } },
        submissions: { triangles: renderer.info.render.triangles, drawCalls: renderer.info.render.drawCalls, passes: renderer.info.render.frameCalls },
      }
      try {
        const response = await fetch('/__valley/telemetry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot), signal: AbortSignal.timeout(10000) })
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
    Object.assign(window, { __valleyInspect: inspector })
    addEventListener('keydown', press)
    return () => {
      clearTimeout(confirmation)
      telemetry.current = null
      removeEventListener('keydown', press)
      if ((window as { __valleyInspect?: unknown }).__valleyInspect === inspector) delete (window as { __valleyInspect?: unknown }).__valleyInspect
    }
  }, [camera, inspector, renderer, shared, size.height, size.width, telemetry, walker])

  useEffect(() => {
    const visibility = () => { resumed.current = true }
    addEventListener('visibilitychange', visibility)
    return () => { removeEventListener('visibilitychange', visibility); cleanup.current.forEach(dispose => dispose()) }
  }, [])
  return null
}
