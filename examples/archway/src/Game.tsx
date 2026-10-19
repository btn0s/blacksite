import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, createPortal, useFrame, useThree } from '@react-three/fiber'
import { CuboidCollider, Physics, RigidBody, TrimeshCollider } from '@react-three/rapier'
import { PerspectiveCamera, Vector3 } from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { InputProvider, makeInputDevices } from '@blacksite/input'
import { BODY_LAYER, CharacterController, CharacterOverlay, CharacterPause, useCharacterStatus, useLocalSession, type CharacterEvents, type CharacterHandle } from '@blacksite/subject'
import { MeshletScene } from '@blacksite/geometry'
import { createInspector } from '@blacksite/inspect'
import { InspectHud } from '@blacksite/inspect/react'
import { WebGPULook } from '@blacksite/look/webgpu-r3f'
import { NATURE, type Atmosphere } from '@blacksite/look'
import type { WebGPULook as Look } from '@blacksite/look/webgpu'
import { Loading, TitleCard } from '@blacksite/ui/hud'
import { preloadAlsCharacterGltf } from 'als-ue5-r3f/app/AlsCharacterGltf'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { createWalker } from '../../valley/src/walker'
import { outfit } from '../../valley/src/outfit'
import { SceneInspection, type InspectionContent, type TelemetryAction } from '../../shared/Inspection'
import { loadArchway, type ArchwayAsset } from './asset'
import { archwayViews, createArchwayCameras, type ArchwayView } from './views'

const atmosphere: Atmosphere = {
  ...NATURE,
  exposure: 1,
  sun: { ...NATURE.sun, direction: [-0.6, 0.65, 0.5], color: [1, 0.94, 0.84] },
  grade: { ...NATURE.grade, lut: null, saturation: 1, bloom: 0, vignette: 0, grain: 0 },
  physical: NATURE.physical && { ...NATURE.physical, clear: 100, heightFog: { density: 0.0001, base: 0, falloff: 90, tint: [0.68, 0.78, 0.94] } },
}
const sunlight = { sunLux: 63000, skyLux: 16000, ev100: 13 }
const cameraGrade = { contrast: 1, toe: 0 }
const shadowLayers = [2]
const home = { id: 1, name: 'Archway', position: [0, 0.1, 31] as [number, number, number], target: [0, 7, 0] as [number, number, number], note: '' }
const glyphs = { home: { label: 'Archway', keyboard: 'R', touch: 'Home', gamepad: { xbox: 'View', playstation: 'Create', generic: 'Back' } } }
const lodLegend = [{ color: '#ffc1aa', label: 'Source · 0' }, { color: '#adc4ef', label: 'Level 1' }, { color: '#e3ffa3', label: 'Level 2' }]

function Scene({ owned, walker, gameplayCamera, inspector, telemetry, shared }: {
  owned: ArchwayAsset
  walker: CharacterHandle
  gameplayCamera: PerspectiveCamera
  inspector: ReturnType<typeof createInspector>
  telemetry: TelemetryAction
  shared: { look: { current: Look | null }; warm: { current: number }; geometry: { current: MeshletScene | null } }
}) {
  const { gl, camera, scene } = useThree()
  const renderer = gl as unknown as WebGPURenderer
  const [look, setLook] = useState<Look | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const geometry = useMemo(() => new MeshletScene([{ asset: owned.asset, materials: owned.materials, instances: [owned.matrix] }], { pixelError: 1, occlusion: true, shadowLayer: 2, shadowPixelError: 1 }), [owned])
  const stats = useMemo(() => ({ sceneTriangles: 0, drawnTriangles: 0 }), [])
  const ground = useRef(null)
  const onLook = useCallback((value: Look | null) => { shared.look.current = value; shared.warm.current = 0; setLook(value) }, [shared])
  const onError = useCallback((value: unknown) => setError(value instanceof Error ? value : new Error(String(value))), [])
  const content = useCallback((): InspectionContent => ({
    identity: geometry,
    roots: [geometry.object],
    sources: [stats],
    techniques: [
      { id: 'meshlet-lod', label: 'Meshlet LOD', description: 'Select source detail within 120 m when disabled.', enabled: true, setEnabled: enabled => geometry.setLodEnabled(enabled) },
      { id: 'meshlet-occlusion', label: 'HiZ occlusion', description: 'GPU cluster visibility and recovery.', enabled: true, setEnabled: enabled => { geometry.occlusionEnabled = enabled; geometry.resetHistory() } },
      { id: 'meshlet-shadows', label: 'Cascade shadows', description: 'Independent light-view cluster selection.', enabled: true, setEnabled: enabled => geometry.setShadowEnabled(enabled) },
      { id: 'meshlet-debug', label: 'Meshlet colours', enabled: false, setEnabled: enabled => geometry.setDebugView(enabled ? 'meshlets' : inspector.getSnapshot().view === 'lod' ? 'lod' : 'normal') },
    ],
    setView: view => { geometry.setDebugView(view === 'lod' ? 'lod' : 'normal'); shared.look.current?.setDebug(view === 'lod') },
    details: () => ({ sourceTriangles: owned.asset.metadata.sourceTriangles, meshletCount: owned.asset.metadata.clusterCount, levels: owned.asset.metadata.levelCount, ...stats }),
  }), [geometry, inspector, owned, shared, stats])
  useEffect(() => {
    shared.geometry.current = geometry
    scene.add(geometry.object)
    return () => { shared.geometry.current = null; scene.remove(geometry.object); geometry.dispose() }
  }, [geometry, scene, shared])
  useEffect(() => geometry.resetHistory(), [camera, geometry])
  useEffect(() => look?.onBeforeShadow((gl, camera, size) => geometry.prepareShadow(gl, camera, size)), [geometry, look])
  useFrame(() => {
    if (!look) return
    camera.updateMatrixWorld()
    geometry.prepare(renderer, camera as PerspectiveCamera, { occluders: ground.current ? [ground.current] : [] })
    shared.warm.current++
  }, 0.5)
  useEffect(() => {
    let pending = false
    const interval = setInterval(() => {
      if (pending || shared.warm.current < 10) return
      pending = true
      void geometry.readStats(renderer).then(value => Object.assign(stats, value)).catch(onError).finally(() => { pending = false })
    }, 300)
    return () => clearInterval(interval)
  }, [geometry, onError, renderer, shared, stats])
  const events = useMemo<CharacterEvents>(() => ({ onAction: action => {
    if (action === 'home') { walker.respawn(undefined, [...home.position]); walker.face(new Vector3(...home.target)); geometry.resetHistory() }
  } }), [geometry, walker])
  if (error) throw error
  return <>
    <WebGPULook atmosphere={atmosphere} sunlight={sunlight} camera={cameraGrade} quality="high" shadowDistance={80} shadowMap={2048} shadowLayers={shadowLayers} onReady={onLook} onError={onError} />
    <mesh ref={ground} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[1000, 1000]} /><meshStandardMaterial color="#807c6b" roughness={0.95} /></mesh>
    <Physics gravity={[0, -9.8, 0]} timeStep={1 / 60} updatePriority={ALS_FRAME_PRIORITY.Physics}>
      {createPortal(<CharacterController controller={walker} events={events} />, scene, { camera: gameplayCamera })}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[500, 1, 500]} position={[0, -1, 0]} />
        <TrimeshCollider args={[owned.collider.vertices, owned.collider.indices]} />
      </RigidBody>
    </Physics>
    <SceneInspection name="archway" look={shared.look} warm={shared.warm} walker={walker} inspector={inspector} telemetry={telemetry} content={content} />
  </>
}

function Archway({ owned, runtime }: { owned: ArchwayAsset; runtime: ReturnType<typeof makeInputDevices> }) {
  const walker = useMemo(() => createWalker(home, runtime), [runtime])
  const cameras = useMemo(createArchwayCameras, [])
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
    const storageSize = Math.max(owned.asset.positions.length / 3 * 32, owned.asset.indices.byteLength)
    const gl = new WebGPURenderer({ ...props, antialias: false, powerPreference: 'high-performance', trackTimestamp: true, requiredLimits: { maxStorageBufferBindingSize: storageSize, maxBufferSize: storageSize } })
    await gl.init()
    if (!gl.backend.isWebGPUBackend) throw new Error('A WebGPU adapter is required')
    gl.info.autoReset = false
    return gl
  }, [owned])
  return <>
    <Canvas frameloop={session.frameloop} shadows dpr={1} camera={cameras[view]} gl={renderer}>
      <Scene owned={owned} walker={walker} gameplayCamera={cameras.walk} inspector={inspector} telemetry={telemetry} shared={shared} />
    </Canvas>
    <section className="bs-inspect" aria-label="Camera views" style={{ top: 44, right: 'auto', left: 16, width: 240 }}>
      <div className="bs-inspect-view" role="group" aria-label="View bookmarks" style={{ marginTop: 0 }}>
        {(Object.keys(archwayViews) as Array<keyof typeof archwayViews>).map(id => <button key={id} type="button" aria-pressed={view === id} onClick={() => selectView(id)}>{archwayViews[id].label}</button>)}
        <button type="button" aria-pressed={view === 'walk'} onClick={() => selectView('walk')}>Walk</button>
      </div>
    </section>
    <InspectHud inspector={inspector} lodLegend={lodLegend} dump={{ onDump: () => { void telemetry.current?.() }, status: dumpStatus, message: `${owned.asset.metadata.sourceTriangles.toLocaleString()} source triangles · ${owned.asset.metadata.clusterCount.toLocaleString()} meshlets` }} />
    <CharacterOverlay controller={walker} visible={view === 'walk'} glyphs={glyphs} hints={['move', 'sprint', 'jump', 'roll', 'home']} prompt="Click to look around · T saves telemetry" buttons={[{ id: 'jump', label: 'Jump' }, { id: 'roll', label: 'Roll' }, { id: 'crouch', label: 'Crouch' }, { id: 'home', label: 'Home' }]} />
    {status.paused && view === 'walk' && <CharacterPause controller={walker} items={[{ id: 'home', label: 'Return to the archway', onPress: () => { walker.respawn(undefined, [...home.position]); walker.face(new Vector3(...home.target)) } }]} />}
  </>
}

export function Game() {
  const runtime = useMemo(makeInputDevices, [])
  const [owned, setOwned] = useState<ArchwayAsset | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void Promise.all([loadArchway(), preloadAlsCharacterGltf().then(outfit)]).then(([asset]) => setOwned(asset)).catch(error => setError(String(error)))
  }, [])
  return <InputProvider runtime={runtime}><div className="hud-screen">
    <RenderBoundary>{owned && <Archway owned={owned} runtime={runtime} />}</RenderBoundary>
    {error && <div className="hud-menu" role="alert"><strong>Archway could not load</strong><span>{error}</span></div>}
    <TitleCard title="The Archway" />
    <Loading title="The Archway" detail="Loading source geometry, surfaces and walker" progress={owned ? 1 : 0.35} done={owned !== null || error !== null} />
  </div></InputProvider>
}

class RenderBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() { return this.state.error ? <div className="hud-menu" role="alert"><strong>Archway could not start</strong><span>{this.state.error}</span></div> : this.props.children }
}
