import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Canvas, createPortal, useFrame, useThree } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { PerspectiveCamera, Vector3 } from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { InputProvider, makeInputDevices } from '@blacksite/input'
import { BODY_LAYER, CharacterController, CharacterOverlay, CharacterPause, useCharacterStatus, useLocalSession, type CharacterEvents, type CharacterHandle } from '@blacksite/subject'
import { MeshletScene, type MeshletStats } from '@blacksite/geometry'
import { createInspector } from '@blacksite/inspect'
import { InspectHud } from '@blacksite/inspect/react'
import { WebGPULook } from '@blacksite/look/webgpu-r3f'
import type { WebGPULook as Look } from '@blacksite/look/webgpu'
import { Loading, TitleCard } from '@blacksite/ui/hud'
import { preloadAlsCharacterGltf } from 'als-ue5-r3f/app/AlsCharacterGltf'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { createWalker } from '../../valley/src/walker'
import { outfit } from '../../valley/src/outfit'
import { SceneInspection, type InspectionContent, type TelemetryAction } from '../../shared/Inspection'
import { createScanMaterialStreaming, residentScanTextures } from '../../shared/scan-material'
import { loadRuins, type RuinsAsset } from './asset'
import { RuinsCollision } from './collision'
import { levelAtmosphere } from './environment'
import { ruinsViews, createRuinsCameras, type RuinsView } from './views'

const cameraGrade = { contrast: 1, toe: 0 }
const shadowLayers = [2]
const glyphs = { home: { label: 'Archway', keyboard: 'R', touch: 'Home', gamepad: { xbox: 'View', playstation: 'Create', generic: 'Back' } } }
const lodLegend = [{ color: '#ffc1aa', label: 'Source · 0' }, { color: '#adc4ef', label: 'Level 1' }, { color: '#e3ffa3', label: 'Level 2' }]

function Scene({ owned, geometry, walker, gameplayCamera, inspector, telemetry, shared, onStats, onReady }: {
  onStats(value: MeshletStats): void
  onReady(): void
  owned: RuinsAsset
  geometry: MeshletScene
  walker: CharacterHandle
  gameplayCamera: PerspectiveCamera
  inspector: ReturnType<typeof createInspector>
  telemetry: TelemetryAction
  shared: { look: { current: Look | null }; warm: { current: number }; geometry: { current: MeshletScene | null } }
}) {
  const { gl, camera, scene } = useThree()
  const renderer = gl as unknown as WebGPURenderer
  const textures = useMemo(() => createScanMaterialStreaming(renderer), [renderer])
  useEffect(() => () => textures.dispose(), [textures])
  const [look, setLook] = useState<Look | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const { atmosphere, sunlight } = useMemo(() => levelAtmosphere(owned.environment), [owned])
  const home = owned.home
  const stats = useMemo(() => ({ sceneTriangles: 0, drawnTriangles: 0 }), [])
  const onLook = useCallback((value: Look | null) => { shared.look.current = value; shared.warm.current = 0; setLook(value) }, [shared])
  const onError = useCallback((value: unknown) => setError(value instanceof Error ? value : new Error(String(value))), [])
  const content = useCallback((): InspectionContent => ({
    identity: geometry,
    roots: [geometry.object],
    sources: [stats],
    techniques: [
      { id: 'meshlet-lod', label: 'Meshlet LOD', description: 'Select the finest resident cut within 120 m when disabled.', enabled: true, setEnabled: enabled => geometry.setLodEnabled(enabled) },
      { id: 'meshlet-occlusion', label: 'HiZ occlusion', description: 'GPU cluster visibility and recovery.', enabled: true, setEnabled: enabled => { geometry.occlusionEnabled = enabled; geometry.resetHistory() } },
      { id: 'meshlet-shadows', label: 'Cascade shadows', description: 'Independent light-view cluster selection.', enabled: true, setEnabled: enabled => geometry.setShadowEnabled(enabled) },
      { id: 'meshlet-debug', label: 'Meshlet colours', enabled: false, setEnabled: enabled => geometry.setDebugView(enabled ? 'meshlets' : inspector.getSnapshot().view === 'lod' ? 'lod' : 'normal') },
    ],
    setView: view => { geometry.setDebugView(view === 'lod' ? 'lod' : 'normal'); shared.look.current?.setDebug(view === 'lod') },
    textures: () => residentScanTextures(renderer),
    details: () => ({ placements: owned.placements.length, minimumWorldError: owned.manifest.minimumWorldError, residentTriangles: owned.manifest.residentTriangles, sourceTriangles: owned.manifest.sourceTriangles, ...stats }),
  }), [geometry, inspector, owned, renderer, shared, stats])
  useEffect(() => {
    shared.geometry.current = geometry
    scene.add(geometry.object)
    return () => { shared.geometry.current = null; scene.remove(geometry.object); geometry.dispose() }
  }, [geometry, scene, shared])
  useEffect(() => geometry.resetHistory(), [camera, geometry])
  useEffect(() => {
    if (!look) return
    const remove = [
      look.onBeforeDepth((gl, camera, size) => geometry.prepare(gl, camera as PerspectiveCamera, size)),
      look.onAfterDepth((gl, _camera, depth) => geometry.recover(gl, depth)),
      look.onBeforeShadow((gl, camera, size) => geometry.prepareShadow(gl, camera, size)),
    ]
    return () => { for (const dispose of remove) dispose() }
  }, [geometry, look])
  useFrame(() => {
    if (!look) return
    if (shared.warm.current >= 10) textures.update()
    shared.warm.current++
    if (shared.warm.current === 10) onReady()
  }, 0.5)
  useEffect(() => {
    let pending = false
    const interval = setInterval(() => {
      if (pending || shared.warm.current < 10) return
      pending = true
      void geometry.readStats(renderer, shared.look.current?.timings() ?? undefined).then(value => { Object.assign(stats, value); onStats(value) }).catch(onError).finally(() => { pending = false })
    }, 300)
    return () => clearInterval(interval)
  }, [geometry, onError, renderer, shared, stats])
  const events = useMemo<CharacterEvents>(() => ({ onAction: action => {
    if (action === 'home') { walker.respawn(undefined, [...home.position]); walker.face(new Vector3(...home.target)); geometry.resetHistory() }
  } }), [geometry, walker])
  if (error) throw error
  return <>
    <WebGPULook atmosphere={atmosphere} sunlight={sunlight} camera={cameraGrade} quality="high" shadowDistance={80} shadowMap={2048} shadowLayers={shadowLayers} onReady={onLook} onError={onError} />
    <Physics gravity={[0, -9.8, 0]} timeStep={1 / 60} updatePriority={ALS_FRAME_PRIORITY.Physics}>
      {createPortal(<CharacterController controller={walker} events={events} />, scene, { camera: gameplayCamera })}
      <RuinsCollision owned={owned} walker={walker} />
    </Physics>
    <SceneInspection name="ruins" look={shared.look} warm={shared.warm} walker={walker} inspector={inspector} telemetry={telemetry} content={content} />
  </>
}

function Ruins({ owned, runtime, onReady }: { owned: RuinsAsset; runtime: ReturnType<typeof makeInputDevices>; onReady(): void }) {
  const [geometry, setGeometry] = useState<MeshletScene | null>(null)
  const [selection, setSelection] = useState<MeshletStats | null>(null)
  const home = owned.home
  const walker = useMemo(() => createWalker(home, runtime), [home, runtime])
  const cameras = useMemo(() => createRuinsCameras(owned.bounds), [owned])
  const [view, setView] = useState<RuinsView>(() => {
    const requested = new URLSearchParams(location.search).get('view')
    return requested === 'wide' || requested === 'close' ? requested : 'walk'
  })
  useEffect(() => {
    walker.active = view === 'walk'
    for (const camera of Object.values(cameras)) camera.layers.enable(BODY_LAYER)
  }, [cameras, view, walker])
  const selectView = (next: RuinsView) => {
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
    if (!navigator.gpu) throw new Error('WebGPU is required for Dark Ruins')
    const storageSize = owned.largestBuffer
    const gl = new WebGPURenderer({ ...props, antialias: false, powerPreference: 'high-performance', trackTimestamp: true, requiredLimits: { maxStorageBufferBindingSize: storageSize, maxBufferSize: storageSize } })
    await gl.init()
    if (!gl.backend.isWebGPUBackend) throw new Error('A WebGPU adapter is required')
    try { setGeometry(await owned.createGeometry(gl)) }
    catch (error) { gl.dispose(); throw error }
    gl.info.autoReset = false
    return gl
  }, [owned])
  return <>
    <Canvas frameloop={session.frameloop} shadows dpr={1} camera={cameras[view]} gl={renderer}>
      {geometry && <Scene owned={owned} geometry={geometry} walker={walker} gameplayCamera={cameras.walk} inspector={inspector} telemetry={telemetry} shared={shared} onStats={setSelection} onReady={onReady} />}
    </Canvas>
    <SelectionDisplay selection={selection} />
    <section className="bs-inspect" aria-label="Camera views" style={{ top: 44, right: 'auto', left: 16, width: 240 }}>
      <div className="bs-inspect-view" role="group" aria-label="View bookmarks" style={{ marginTop: 0 }}>
        {(Object.keys(ruinsViews) as Array<keyof typeof ruinsViews>).map(id => <button key={id} type="button" aria-pressed={view === id} onClick={() => selectView(id)}>{ruinsViews[id].label}</button>)}
        <button type="button" aria-pressed={view === 'walk'} onClick={() => selectView('walk')}>Walk</button>
      </div>
    </section>
    <InspectHud inspector={inspector} lodLegend={lodLegend} dump={{ onDump: () => { void telemetry.current?.() }, status: dumpStatus, message: `${owned.placements.length.toLocaleString()} placements | ${(owned.manifest.minimumWorldError * 100).toFixed(0)} cm resident error` }} />
    <CharacterOverlay controller={walker} visible={view === 'walk'} glyphs={glyphs} hints={['move', 'sprint', 'jump', 'roll', 'home']} prompt="Click to look around · T saves telemetry" buttons={[{ id: 'jump', label: 'Jump' }, { id: 'roll', label: 'Roll' }, { id: 'crouch', label: 'Crouch' }, { id: 'home', label: 'Home' }]} />
    {status.paused && view === 'walk' && <CharacterPause controller={walker} items={[{ id: 'home', label: 'Return to the archway', onPress: () => { walker.respawn(undefined, [...home.position]); walker.face(new Vector3(...home.target)) } }]} />}
  </>
}

export function Game() {
  const runtime = useMemo(makeInputDevices, [])
  const [owned, setOwned] = useState<RuinsAsset | null>(null)
  const [detail, setDetail] = useState('Waiting for the full-level asset build')
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const onReady = useCallback(() => setReady(true), [])
  useEffect(() => {
    void Promise.all([loadRuins(setDetail), preloadAlsCharacterGltf().then(outfit)]).then(([asset]) => setOwned(asset)).catch(error => setError(String(error)))
  }, [])
  return <InputProvider runtime={runtime}><div className="hud-screen">
    <RenderBoundary>{owned && <Ruins owned={owned} runtime={runtime} onReady={onReady} />}</RenderBoundary>
    {error && <div className="hud-menu" role="alert"><strong>Dark Ruins could not load</strong><span>{error}</span></div>}
    <TitleCard title="Dark Ruins" />
    <Loading title="Dark Ruins" detail={detail} progress={ready ? 1 : owned ? 0.7 : 0.35} done={ready || error !== null} />
  </div></InputProvider>
}

class RenderBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() { return this.state.error ? <div className="hud-menu" role="alert"><strong>Dark Ruins could not start</strong><span>{this.state.error}</span></div> : this.props.children }
}

function SelectionDisplay({ selection }: { selection: MeshletStats | null }) {
  if (!selection) return null
  const n = (value: number) => value.toLocaleString()
  return <aside className="bs-inspect" style={{ left: 16, top: 96, right: 'auto', width: 280, fontFamily: 'monospace', fontSize: 12 }} aria-label="Selection telemetry">
    <div>Instances tested {n(selection.instancesTested)}</div>
    <div>Frustum culled {n(selection.instancesFrustumCulled)}</div>
    <div>Occluded {n(selection.instancesOccluded)}</div>
    <div>Recovered instances {n(selection.instancesRecovered)}</div>
    <div>Hierarchy nodes {n(selection.nodesVisited)}</div>
    <div>Clusters visited {n(selection.clustersVisited)}</div>
    <div>Selection GPU {selection.selectionMs?.toFixed(2) ?? 'n/a'} ms</div>
    <div>Drawn triangles {n(selection.drawnTriangles)}</div>
    <div>Geometry buffers {(selection.residentBytes / 1073741824).toFixed(2)} GiB</div>
  </aside>
}
