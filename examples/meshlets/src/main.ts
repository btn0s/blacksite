import { ACESFilmicToneMapping, PerspectiveCamera, Vector2, WebGPURenderer } from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { MeshletScene } from '@blacksite/geometry'
import type { MeshletDebugView } from '@blacksite/geometry'
import { createUI } from './ui'
import { createCoastalScene } from './scene'
import { createPost } from './post'

const ui = createUI()
const params = new URLSearchParams(location.search)
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const compact = (value: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
const percentile = (values: number[], fraction: number) => {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
}
type GpuSample = { render: number; compute: number; total: number }

async function start() {
  if (!navigator.gpu) throw new Error('This scene requires a browser with WebGPU, served over HTTPS or localhost.')
  const renderer = new WebGPURenderer({ antialias: false, trackTimestamp: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
  renderer.setSize(innerWidth, innerHeight)
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  ui.viewport.appendChild(renderer.domElement)
  await renderer.init()
  if (!renderer.backend.isWebGPUBackend) throw new Error('WebGPU is unavailable. This scene requires GPU compute and indirect drawing.')
  const timestamps = renderer.hasFeature('timestamp-query')
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  const adapterInfo = adapter ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description } : null
  const world = await createCoastalScene(ui.status)
  const meshlets = await MeshletScene.create(renderer, world.entries, { pixelError: 1, occlusion: true })
  world.scene.add(meshlets.object)
  const camera = new PerspectiveCamera(55, innerWidth / innerHeight, 0.2, 1600)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.075
  controls.maxPolarAngle = Math.PI * 0.9
  controls.minDistance = 3
  controls.maxDistance = 600
  const setCamera = (preset: 'overview' | 'channel') => {
    const view = world.cameraPresets[preset]
    camera.position.fromArray(view.position)
    controls.target.fromArray(view.target)
    camera.position.sub(controls.target).multiplyScalar(Math.max(1, Math.sqrt(0.9 / camera.aspect))).add(controls.target)
    controls.update()
    camera.updateMatrixWorld()
    meshlets.resetHistory()
  }
  setCamera(params.get('camera') === 'channel' ? 'channel' : 'overview')
  let debugView: MeshletDebugView = 'normal'
  let frameNumber = 0
  let lastTime = 0
  const frameIntervals: number[] = []
  const gpuSamples: GpuSample[] = []
  let gpuPending = false
  let statsPending = false
  let currentStats: Awaited<ReturnType<typeof meshlets.readStats>> | null = null
  const setView = (view: MeshletDebugView) => {
    debugView = view
    meshlets.setDebugView(view)
    const legend = document.getElementById('legend')!
    legend.hidden = view === 'normal'
    legend.textContent = view === 'meshlets' ? 'One colour per cluster · the entire scene uses meshlets' : 'Colour shows the selected hierarchy level'
  }
  const readStats = async () => {
    if (statsPending) return
    statsPending = true
    try { currentStats = await meshlets.readStats(renderer) }
    finally { statsPending = false }
  }
  const updateHud = () => {
    const drawn = currentStats?.drawnTriangles
    ui.text('triangles', drawn === undefined ? '—' : compact(drawn))
    ui.text('reduction', drawn === undefined ? 'Awaiting GPU readback' : `${(100 * drawn / meshlets.totalTriangles).toFixed(2)}% of source · ${compact(currentStats!.submittedTriangles)} submitted`)
    ui.text('visible', currentStats ? currentStats.visibleClusters.toLocaleString('en-US') : '—')
    ui.text('culled', currentStats ? `${compact(currentStats.frustumCulled)} frustum · ${compact(currentStats.occludedClusters)} occluded` : 'GPU counters pending')
    ui.text('gpu', !timestamps ? 'Unavailable' : gpuSamples.length ? `${percentile(gpuSamples.map(sample => sample.total), 0.5).toFixed(2)} ms` : 'Sampling…')
    ui.text('gpu-detail', timestamps && gpuSamples.length ? `Render ${percentile(gpuSamples.map(sample => sample.render), 0.5).toFixed(2)} + compute ${percentile(gpuSamples.map(sample => sample.compute), 0.5).toFixed(2)} ms` : 'Timestamp queries unavailable')
    ui.text('frame', frameIntervals.length ? `${percentile(frameIntervals, 0.5).toFixed(1)} ms` : '—')
    ui.text('frame-detail', frameIntervals.length ? `p95 ${percentile(frameIntervals, 0.95).toFixed(1)} ms · browser paced` : 'Rolling median · p95')
  }
  ui.mountTuning({
    setView,
    setPixelError: value => { meshlets.pixelError = value; meshlets.resetHistory() },
    setOcclusion: enabled => { meshlets.occlusionEnabled = enabled; meshlets.resetHistory() },
    setCamera,
    setExposure: value => { renderer.toneMappingExposure = value },
    setSunIntensity: value => { world.sunlight.intensity = value },
    setFogDensity: value => { world.fog.density = value },
    initial: { pixelError: meshlets.pixelError, exposure: renderer.toneMappingExposure, sunIntensity: world.sunlight.intensity, fogDensity: world.fog.density },
  })
  const resize = () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
    meshlets.resetHistory()
    const size = renderer.getDrawingBufferSize(new Vector2())
    ui.text('resolution', `${size.x} × ${size.y} · WebGPU`)
  }
  window.addEventListener('resize', resize)
  resize()
  ui.text('source-total', `${compact(meshlets.totalTriangles)} source triangles`)
  ui.text('source-meta', `${world.entries.reduce((sum, entry) => sum + entry.instances.length, 0).toLocaleString()} placements · terrain, stonework, plants and water`)
  const post = createPost(renderer, world.scene, camera)
  const renderFrame = (time: number) => {
    const interval = lastTime ? time - lastTime : 0
    lastTime = time
    frameNumber++
    world.update(reducedMotion.matches ? 0 : time / 1000)
    controls.update()
    if (interval > 0) {
      frameIntervals.push(interval)
      if (frameIntervals.length > 180) frameIntervals.shift()
    }
    camera.updateMatrixWorld()
    meshlets.prepare(renderer, camera)
    post.render()
    if (timestamps && !gpuPending) {
      gpuPending = true
      Promise.all([renderer.resolveTimestampsAsync('render'), renderer.resolveTimestampsAsync('compute')]).then(([renderMs, computeMs]) => {
        gpuSamples.push({ render: renderMs ?? 0, compute: computeMs ?? 0, total: (renderMs ?? 0) + (computeMs ?? 0) })
        if (gpuSamples.length > 120) gpuSamples.shift()
      }).catch(console.error).finally(() => { gpuPending = false })
    }
    if (frameNumber % 30 === 0) void readStats()
    if (frameNumber % 15 === 0) updateHud()
    if (frameNumber === 2) ui.ready()
  }
  const snapshot = () => ({
    capturedAt: new Date().toISOString(), userAgent: navigator.userAgent, adapter: adapterInfo,
    resolution: renderer.getDrawingBufferSize(new Vector2()).toArray(), view: debugView,
    camera: { position: camera.position.toArray(), target: controls.target.toArray() },
    totalTriangles: meshlets.totalTriangles, candidates: meshlets.candidateClusters,
    stats: currentStats, pixelError: meshlets.pixelError, occlusion: meshlets.occlusionEnabled,
    gpuMedianMs: gpuSamples.length ? percentile(gpuSamples.map(sample => sample.total), 0.5) : null,
    frameMedianMs: percentile(frameIntervals, 0.5), frameP95Ms: percentile(frameIntervals, 0.95),
  })
  Object.assign(window, { meshletLab: { ready: true, setView, setCamera, snapshot, renderer, camera, controls, meshlets, world, post } })
  renderer.setAnimationLoop(renderFrame)
}

start().catch(error => { console.error(error); ui.fail(error) })
