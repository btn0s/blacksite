import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Canvas, createPortal, useFrame, useThree } from '@react-three/fiber'
import { Physics, useRapier } from '@react-three/rapier'
import { PerspectiveCamera, Vector3 } from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { InputProvider, makeInputDevices } from '@blacksite/input'
import { BODY_LAYER, CharacterController, CharacterOverlay, CharacterPause, useCharacterStatus, useLocalSession, type CharacterEvents, type CharacterHandle } from '@blacksite/subject'
import { MeshletScene } from '@blacksite/geometry'
import { createInspector } from '@blacksite/inspect'
import { InspectHud } from '@blacksite/inspect/react'
import { WebGPULook } from '@blacksite/look/webgpu-r3f'
import type { WebGPULook as Look } from '@blacksite/look/webgpu'
import { Loading, TitleCard } from '@blacksite/ui/hud'
import { preloadAlsCharacterGltf } from 'als-ue5-r3f/app/AlsCharacterGltf'
import { AlsPhysicsStepper } from 'als-ue5-r3f/app/AlsPhysicsStepper'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { createWalker } from '../../valley/src/walker'
import { outfit } from '../../valley/src/outfit'
import { SceneInspection, type InspectionContent, type TelemetryAction } from '../../shared/Inspection'
import { createScanMaterialStreaming, residentScanTextures } from '../../shared/scan-material'
import { loadArchway, type ArchwayAsset } from './asset'
import { courtyardEnvironment } from './environment'
import { archwayViews, createArchwayCameras, createArchwayHome, type ArchwayView } from './views'

const cameraGrade = { contrast: 1, toe: 0 }
const shadowLayers = [2]
const glyphs = { home: { label: 'Archway', keyboard: 'R', touch: 'Home', gamepad: { xbox: 'View', playstation: 'Create', generic: 'Back' } } }
const lodLegend = [{ color: '#ffc1aa', label: 'Source · 0' }, { color: '#adc4ef', label: 'Level 1' }, { color: '#e3ffa3', label: 'Level 2' }]

function CourtyardColliders({ owned, onReady, onError }: { owned: ArchwayAsset; onReady(): void; onError(error: unknown): void }) {
  const { world, rapier } = useRapier()
  useEffect(() => {
    const controller = new AbortController()
    let remove: (() => void) | undefined
    void owned.createColliders({ world, rapier }, controller.signal).then(dispose => {
      if (controller.signal.aborted) dispose()
      else { remove = dispose; onReady() }
    }).catch(error => { if (!controller.signal.aborted) onError(error) })
    return () => { controller.abort(); remove?.() }
  }, [onError, onReady, owned, rapier, world])
  return null
}

function Scene({ owned, geometry, walker, gameplayCamera, inspector, telemetry, shared, onReady }: {
  owned: ArchwayAsset
  geometry: MeshletScene
  walker: CharacterHandle
  gameplayCamera: PerspectiveCamera
  inspector: ReturnType<typeof createInspector>
  telemetry: TelemetryAction
  shared: { look: { current: Look | null }; warm: { current: number }; geometry: { current: MeshletScene | null } }
  onReady(): void
}) {
  const { gl, camera, scene } = useThree()
  const renderer = gl as unknown as WebGPURenderer
  const textures = useMemo(() => createScanMaterialStreaming(renderer), [renderer])
  useEffect(() => () => textures.dispose(), [textures])
  const home = useMemo(() => createArchwayHome(owned.manifest.centre), [owned])
  const [look, setLook] = useState<Look | null>(null)
  const [collidersReady, setCollidersReady] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const stats = useMemo(() => ({ sceneTriangles: 0, drawnTriangles: 0 }), [])
  const { atmosphere, sunlight } = useMemo(() => courtyardEnvironment(owned), [owned])
  const onLook = useCallback((value: Look | null) => { shared.look.current = value; shared.warm.current = 0; setLook(value) }, [shared])
  const onError = useCallback((value: unknown) => setError(value instanceof Error ? value : new Error(String(value))), [])
  const onCollidersReady = useCallback(() => setCollidersReady(true), [])
  const content = useCallback((): InspectionContent => ({
    identity: geometry,
    roots: [geometry.object],
    sources: [stats],
    techniques: [
      { id: 'meshlet-lod', label: 'Meshlet LOD', description: 'Select finest resident detail within 120 m when disabled.', enabled: true, setEnabled: enabled => geometry.setLodEnabled(enabled) },
      { id: 'meshlet-occlusion', label: 'HiZ occlusion', description: 'GPU cluster visibility and recovery.', enabled: true, setEnabled: enabled => { geometry.occlusionEnabled = enabled; geometry.resetHistory() } },
      { id: 'meshlet-shadows', label: 'Cascade shadows', description: 'Independent light-view cluster selection.', enabled: true, setEnabled: enabled => geometry.setShadowEnabled(enabled) },
      { id: 'meshlet-debug', label: 'Meshlet colours', enabled: false, setEnabled: enabled => geometry.setDebugView(enabled ? 'meshlets' : inspector.getSnapshot().view === 'lod' ? 'lod' : 'normal') },
    ],
    setView: view => { geometry.setDebugView(view === 'lod' ? 'lod' : 'normal'); shared.look.current?.setDebug(view === 'lod') },
    textures: () => residentScanTextures(renderer),
    details: () => ({ placements: owned.manifest.placements.length, uniqueMeshes: owned.uniqueMeshes, sourceTriangles: owned.sourceTriangles, meshletCount: owned.meshlets, levels: owned.levels, residentGeometryBytes: geometry.residentGeometryBytes, untranslated: owned.manifest.untranslated, excluded: owned.manifest.excluded, textureStreaming: textures.snapshot(), geometryPaging: geometry.pagingStats(), ...stats }),
  }), [geometry, inspector, owned, renderer, shared, stats, textures])
  useEffect(() => {
    shared.geometry.current = geometry
    geometry.object.visible = false
    scene.add(geometry.object)
    return () => { shared.geometry.current = null; scene.remove(geometry.object); geometry.dispose() }
  }, [geometry, scene, shared])
  useEffect(() => geometry.resetHistory(), [camera, geometry])
  useEffect(() => {
    if (!look) return
    const remove = [
      look.onBeforeDepth((gl, camera, size) => geometry.prepare(gl, camera as PerspectiveCamera, size)),
      look.onBeforeLit(() => geometry.prepareLit()),
      look.onAfterDepth((gl, _camera, depth) => geometry.recover(gl, depth)),
      look.onBeforeShadow((gl, camera, size, cascade) => geometry.prepareShadow(gl, camera, size, cascade)),
    ]
    return () => { for (const dispose of remove) dispose() }
  }, [geometry, look])
  useFrame(() => {
    if (!look) return
    const deadline = performance.now() + 0.5
    const uploaded = shared.warm.current >= 10 ? textures.update(deadline) : 0
    geometry.update(renderer, deadline, 8 * 1048576 - uploaded)
  }, 0.5)
  useFrame(() => { if (look) geometry.endFrame(renderer) }, 2)
  useEffect(() => {
    if (!look || !collidersReady) return
    let active = true
    geometry.object.visible = true
    void look.compile((gl, camera, scene, pass) => geometry.compile(gl, camera, scene, pass), [geometry.object]).then(() => geometry.completeFrame(renderer)).then(() => geometry.readStats(renderer, look.timings())).then(() => {
      if (!active) return
      shared.warm.current = 10
      onReady()
    }).catch(onError)
    return () => { active = false }
  }, [collidersReady, geometry, look, onError, onReady, renderer, shared])
  useEffect(() => {
    let pending = false
    const interval = setInterval(() => {
      if (pending || shared.warm.current < 10) return
      pending = true
      void geometry.readStats(renderer, shared.look.current?.timings()).then(value => Object.assign(stats, value)).catch(onError).finally(() => { pending = false })
    }, 300)
    return () => clearInterval(interval)
  }, [geometry, onError, renderer, shared, stats])
  const events = useMemo<CharacterEvents>(() => ({ onAction: action => {
    if (action === 'home') { walker.respawn(undefined, [...home.position]); walker.face(new Vector3(...home.target)); geometry.resetHistory() }
  } }), [geometry, home, walker])
  if (error) throw error
  return <>
    <WebGPULook atmosphere={atmosphere} sunlight={sunlight} camera={cameraGrade} quality="high" shadowDistance={80} shadowMap={2048} shadowLayers={shadowLayers} onReady={onLook} onError={onError} />
    <Physics gravity={[0, -9.8, 0]} paused timeStep={1 / 60} updatePriority={ALS_FRAME_PRIORITY.Physics}>
      <AlsPhysicsStepper />
      <CourtyardColliders owned={owned} onReady={onCollidersReady} onError={onError} />
      {collidersReady && createPortal(<CharacterController controller={walker} events={events} />, scene, { camera: gameplayCamera })}
    </Physics>
    <SceneInspection name="archway" look={shared.look} warm={shared.warm} walker={walker} inspector={inspector} telemetry={telemetry} content={content} />
  </>
}

function Archway({ owned, runtime, onReady }: { owned: ArchwayAsset; runtime: ReturnType<typeof makeInputDevices>; onReady(): void }) {
  const [geometry, setGeometry] = useState<MeshletScene | null>(null)
  const home = useMemo(() => createArchwayHome(owned.manifest.centre), [owned])
  const walker = useMemo(() => createWalker(home, runtime), [home, runtime])
  const cameras = useMemo(() => createArchwayCameras(owned.manifest.centre), [owned])
  const [view, setView] = useState<ArchwayView>(() => {
    const requested = new URLSearchParams(location.search).get('view')
    return requested === 'wide' || requested === 'close' ? requested : 'walk'
  })
  useEffect(() => {
    walker.active = view === 'walk'
    for (const camera of Object.values(cameras)) camera.layers.enable(BODY_LAYER)
  }, [cameras, view, walker])
  const selectView = (next: ArchwayView) => {
    walker.setPaused(false)
    setView(next)
    const url = new URL(location.href)
    url.searchParams.set('view', next)
    history.replaceState(null, '', url)
  }
  const status = useCharacterStatus(walker)
  const session = useLocalSession(walker)
  const shared = useMemo(() => ({ look: { current: null as Look | null }, warm: { current: 0 }, geometry: { current: null as MeshletScene | null } }), [])
  const inspector = useMemo(() => createInspector({ renderer: 'WebGPU', tier: 'high', windowFrames: 600, onViewChange: view => { shared.geometry.current?.setDebugView(view === 'lod' ? 'lod' : 'normal'); shared.look.current?.setDebug(view === 'lod') } }), [shared])
  const [dumpStatus, setDumpStatus] = useState<'idle' | 'sending' | 'saved' | 'error'>('idle')
  const telemetry = useMemo<TelemetryAction>(() => ({ current: null, status: setDumpStatus }), [])
  const renderer = useCallback(async (props: object) => {
    if (!navigator.gpu) throw new Error('WebGPU is required for the archway')
    const storageSize = owned.storageSize
    const gl = new WebGPURenderer({ ...props, antialias: false, powerPreference: 'high-performance', trackTimestamp: true, requiredLimits: { maxStorageBufferBindingSize: storageSize, maxBufferSize: storageSize, maxStorageBuffersPerShaderStage: 12 } })
    await gl.init()
    if (!gl.backend.isWebGPUBackend) throw new Error('A WebGPU adapter is required')
    try { setGeometry(await owned.createGeometry(gl)) }
    catch (error) { gl.dispose(); throw error }
    gl.info.autoReset = false
    return gl
  }, [owned])
  return <>
    <Canvas frameloop={session.frameloop} shadows dpr={1} camera={cameras[view]} gl={renderer}>
      {geometry && <Scene owned={owned} geometry={geometry} walker={walker} gameplayCamera={cameras.walk} inspector={inspector} telemetry={telemetry} shared={shared} onReady={onReady} />}
    </Canvas>
    <section className="bs-inspect" aria-label="Camera views" style={{ top: 44, right: 'auto', left: 16, width: 240 }}>
      <div className="bs-inspect-view" role="group" aria-label="View bookmarks" style={{ marginTop: 0 }}>
        {(Object.keys(archwayViews) as Array<keyof typeof archwayViews>).map(id => <button key={id} type="button" aria-pressed={view === id} onClick={() => selectView(id)}>{archwayViews[id].label}</button>)}
        <button type="button" aria-pressed={view === 'walk'} onClick={() => selectView('walk')}>Walk</button>
      </div>
    </section>
    <InspectHud inspector={inspector} lodLegend={lodLegend} dump={{ onDump: () => { void telemetry.current?.() }, status: dumpStatus, message: `${owned.sourceTriangles.toLocaleString()} source triangles · ${owned.meshlets.toLocaleString()} meshlets` }} />
    <CharacterOverlay controller={walker} visible={view === 'walk'} glyphs={glyphs} hints={['move', 'sprint', 'jump', 'roll', 'home']} prompt="Click to look around · T saves telemetry" buttons={[{ id: 'jump', label: 'Jump' }, { id: 'roll', label: 'Roll' }, { id: 'crouch', label: 'Crouch' }, { id: 'home', label: 'Home' }]} />
    {status.paused && view === 'walk' && <CharacterPause controller={walker} items={[{ id: 'home', label: 'Return to the archway', onPress: () => { walker.respawn(undefined, [...home.position]); walker.face(new Vector3(...home.target)) } }]} />}
  </>
}

function CourtyardGame() {
  const runtime = useMemo(makeInputDevices, [])
  const [owned, setOwned] = useState<ArchwayAsset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const onReady = useCallback(() => setReady(true), [])
  useEffect(() => {
    void Promise.all([loadArchway(), preloadAlsCharacterGltf().then(outfit)]).then(([asset]) => setOwned(asset)).catch(error => setError(String(error)))
  }, [])
  return <InputProvider runtime={runtime}><div className="hud-screen">
    <RenderBoundary>{owned && <Archway owned={owned} runtime={runtime} onReady={onReady} />}</RenderBoundary>
    {error && <div className="hud-menu" role="alert"><strong>Archway could not load</strong><span>{error}</span></div>}
    <TitleCard title="The Archway" />
    <Loading title="The Archway" detail="Loading source geometry, surfaces and walker" progress={ready ? 1 : owned ? 0.65 : 0.35} done={ready || error !== null} />
  </div></InputProvider>
}

class RenderBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() { return this.state.error ? <div className="hud-menu" role="alert"><strong>Archway could not start</strong><span>{this.state.error}</span></div> : this.props.children }
}

const FullLevel = lazy(() => import('../../ruins/src/Game').then(module => ({ default: module.Game })))

export function Game() {
  return new URLSearchParams(location.search).get('level') === 'full'
    ? <Suspense fallback={<Loading title="Dark Ruins" detail="Opening the level" progress={0.05} />}><FullLevel /></Suspense>
    : <CourtyardGame />
}
