import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
import { AlsPhysicsStepper } from 'als-ue5-r3f/app/AlsPhysicsStepper'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { createWalker } from '../../valley/src/walker'
import { outfit } from '../../valley/src/outfit'
import { SceneInspection, type InspectionContent, type TelemetryAction } from '../../shared/Inspection'
import { createScanMaterialStreaming, residentScanTextures } from '../../shared/scan-material'
import { loadRuins, type RuinsAsset } from './asset'
import { RuinsCollision, type RegionalCollision } from './collision'
import type { Contact } from './contacts'
import { scanEnvironment } from '../../shared/scan-environment'
import type { ScanFlames } from '../../shared/scan-flames'
import { ruinsViews, ruinsNearRadius, createRuinsCameras, type RuinsView } from './views'

const shadowLayers = [2]
const glyphs = { home: { label: 'Spawn', keyboard: 'R', touch: 'Home', gamepad: { xbox: 'View', playstation: 'Create', generic: 'Back' } } }
const outwardReach = 1e30
const nearTimeoutMs = 20000
const loadingFrameMs = 6
const loadingUploadBytes = 32 * 1048576
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
const lodLegend = [{ color: '#ffc1aa', label: 'Source · 0' }, { color: '#adc4ef', label: 'Level 1' }, { color: '#e3ffa3', label: 'Level 2' }]

function Scene({ owned, geometry, flames, walker, gameplayCamera, inspector, telemetry, shared, onStats, onReady }: {
  onStats(value: MeshletStats): void
  onReady(): void
  owned: RuinsAsset
  geometry: MeshletScene
  flames: ScanFlames
  walker: CharacterHandle
  gameplayCamera: PerspectiveCamera
  inspector: ReturnType<typeof createInspector>
  telemetry: TelemetryAction
  shared: { look: { current: Look | null }; warm: { current: number }; geometry: { current: MeshletScene | null }; collision: { current: RegionalCollision | null } }
}) {
  const { gl, camera, scene } = useThree()
  const renderer = gl as unknown as WebGPURenderer
  const textures = useMemo(() => createScanMaterialStreaming(renderer), [renderer])
  useEffect(() => () => textures.dispose(), [textures])
  const [look, setLook] = useState<Look | null>(null)
  const [collisionReady, setCollisionReady] = useState(false)
  const onCollisionReady = useCallback(() => setCollisionReady(true), [])
  const [error, setError] = useState<Error | null>(null)
  const { atmosphere, sunlight, film } = useMemo(() => scanEnvironment(owned.environment.components), [owned])
  const home = owned.home
  const stats = useMemo(() => ({ sceneTriangles: 0, drawnTriangles: 0 }), [])
  const startsAtSpawn = useRef(camera === gameplayCamera)
  const compiling = useRef(false)
  const onLook = useCallback((value: Look | null) => { shared.look.current = value; shared.warm.current = 0; if (value) performance.mark('ruins-look-ready'); setLook(value) }, [shared])
  const onError = useCallback((value: unknown) => setError(value instanceof Error ? value : new Error(String(value))), [])
  const content = useCallback((): InspectionContent => ({
    identity: geometry,
    roots: [geometry.object],
    sources: [stats],
    techniques: [
      { id: 'meshlet-lod', label: 'Meshlet LOD', description: 'Select the finest resident cut within 120 m when disabled.', enabled: true, setEnabled: enabled => geometry.setLodEnabled(enabled) },
      { id: 'meshlet-occlusion', label: 'HiZ occlusion', description: 'GPU cluster visibility and recovery.', enabled: true, setEnabled: enabled => { geometry.occlusionEnabled = enabled; geometry.resetHistory() } },
      { id: 'meshlet-shadows', label: 'Cascade shadows', description: 'Independent light-view cluster selection.', enabled: true, setEnabled: enabled => geometry.setShadowEnabled(enabled) },
      { id: 'collision-overlay', label: 'Collision', description: 'Resident collision: green walkable, red steep, blue overhang.', enabled: false, setEnabled: enabled => shared.collision.current?.setOverlay(enabled ? 0 : null) },
      { id: 'collision-hidden', label: 'Invisible collision', description: 'Only collision standing 0.5 m or more in front of the drawn surface.', enabled: false, setEnabled: enabled => shared.collision.current?.setOverlay(enabled ? 0.5 : null) },
      { id: 'meshlet-debug', label: 'Meshlet colours', enabled: false, setEnabled: enabled => geometry.setDebugView(enabled ? 'meshlets' : inspector.getSnapshot().view === 'lod' ? 'lod' : 'normal') },
    ],
    setView: view => { geometry.setDebugView(view === 'lod' ? 'lod' : 'normal'); shared.look.current?.setDebug(view === 'lod') },
    textures: () => residentScanTextures(renderer),
    details: () => ({ collisionContacts: shared.collision.current?.contactReport(), placements: owned.placements.length, minimumWorldError: owned.manifest.minimumWorldError, sourceTriangles: owned.sourceTriangles, cappedTriangles: owned.cappedTriangles, bounds: { min: owned.bounds.min.toArray(), max: owned.bounds.max.toArray() }, untranslated: owned.manifest.untranslated, excluded: owned.manifest.excluded, geometryPaging: geometry.pagingStats(), textureStreaming: textures.snapshot(), regionalCollision: shared.collision.current?.stats(), ...stats }),
  }), [geometry, inspector, owned, renderer, shared, stats, textures])
  useEffect(() => {
    shared.geometry.current = geometry
    geometry.object.visible = false
    scene.add(geometry.object)
    return () => { shared.geometry.current = null; scene.remove(geometry.object); geometry.dispose() }
  }, [geometry, scene, shared])
  useEffect(() => {
    scene.add(flames.object)
    return () => { scene.remove(flames.object); flames.dispose() }
  }, [flames, scene])
  useEffect(() => geometry.resetHistory(), [camera, geometry])
  useEffect(() => geometry.setRequestReach(startsAtSpawn.current ? ruinsNearRadius : outwardReach), [geometry])
  useEffect(() => {
    if (!look) return
    const remove = [
      look.onBeforeDepth((gl, camera, size) => geometry.prepare(gl, camera as PerspectiveCamera, size)),
      look.onBeforeLit(() => geometry.prepareLit()),
      look.onAfterDepth((gl, _camera, depth) => geometry.recover(gl, depth)),
      look.onBeforeShadow((gl, camera, size, cascade) => geometry.prepareShadow(gl, camera, size, cascade)),
    ]
    return () => { for (const dispose of remove) dispose() }
  }, [geometry, look, shared])
  useFrame(() => {
    if (!look) return
    const loading = shared.warm.current < 10
    const deadline = performance.now() + (loading ? loadingFrameMs : 0.5)
    const allowance = loading ? loadingUploadBytes : 8 * 1048576
    const uploaded = compiling.current ? 0 : textures.update(deadline, allowance)
    geometry.update(renderer, deadline, allowance - uploaded)
    flames.update(camera)
  }, 0.5)
  useFrame(() => { if (look) geometry.endFrame(renderer, shared.warm.current < 10) }, 2)
  useEffect(() => {
    if (!look || !collisionReady) return
    let active = true
    void (async () => {
      performance.mark('ruins-character-start')
      while (active && !walker.als.pose.current.ready) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      if (!active) return
      performance.measure('ruins-character', 'ruins-character-start')
      if (startsAtSpawn.current) {
        const start = performance.now()
        while (!(geometry.settled && textures.settled) && performance.now() - start < nearTimeoutMs) await nextFrame()
        performance.mark(geometry.settled && textures.settled ? 'ruins-near-settled' : 'ruins-near-timeout', { detail: { geometry: geometry.pagingStats(), textures: textures.snapshot() } })
        geometry.setRequestReach(outwardReach)
      }
      if (!active) return
      performance.mark('ruins-warmup-start')
      compiling.current = true
      try { await look.compile(passes => geometry.compile(passes), [geometry.object]) } finally { compiling.current = false }
      if (!active) return
      geometry.object.visible = true
      look.render()
      await geometry.completeFrame(renderer)
      if (!active) return
      performance.measure('ruins-warmup', 'ruins-warmup-start')
      performance.mark('ruins-first-playable')
      shared.warm.current = 10
      onReady()
    })().catch(error => { if (active) onError(error) })
    return () => { active = false }
  }, [collisionReady, geometry, look, onError, onReady, renderer, shared, walker])
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
    if (action === 'home') void shared.collision.current?.prepare(new Vector3(...home.position)).then(() => { walker.respawn(undefined, [...home.position]); walker.face(new Vector3(...home.target)); geometry.resetHistory() }).catch(onError)
  } }), [geometry, home, onError, shared, walker])
  if (error) throw error
  return <>
    <WebGPULook atmosphere={atmosphere} sunlight={sunlight} film={film} quality="high" shadowDistance={400} shadowMap={2048} shadowCascades={4} shadowLayers={shadowLayers} onReady={onLook} onError={onError} />
    <Physics gravity={[0, -9.8, 0]} paused timeStep={1 / 60} updatePriority={ALS_FRAME_PRIORITY.Physics}>
      <AlsPhysicsStepper />
      {collisionReady && createPortal(<CharacterController controller={walker} events={events} />, scene, { camera: gameplayCamera })}
      <RuinsCollision directory={owned.collision} describe={owned.describe} root={owned.collisionRoot} walker={walker} onReady={onCollisionReady} onError={onError} handle={shared.collision} />
    </Physics>
    <SceneInspection name="ruins" look={shared.look} warm={shared.warm} walker={walker} inspector={inspector} telemetry={telemetry} content={content} />
  </>
}

function ContactDisplay({ shared }: { shared: { collision: { current: RegionalCollision | null } } }) {
  const [contacts, setContacts] = useState<Contact[]>([])
  useEffect(() => {
    const interval = setInterval(() => setContacts(current => { const next = shared.collision.current?.contacts() ?? []; return next.length === 0 && current.length === 0 ? current : [...next] }), 150)
    return () => clearInterval(interval)
  }, [shared])
  if (!contacts.length) return null
  const shown = [...contacts].sort((a, b) => Number(b.blocking) - Number(a.blocking)).slice(0, 3)
  return <aside className="bs-inspect" style={{ left: 16, bottom: 16, top: 'auto', right: 'auto', width: 460, fontFamily: 'monospace', fontSize: 11 }} aria-label="Collision contacts">
    <div>Contacts {contacts.length} · T saves them</div>
    {shown.map((contact, index) => {
      const owner = contact.owners?.[0]
      const surface = owner?.surface as { mesh?: string; drawn?: boolean; material?: string } | undefined
      const what = contact.kind === 'residency-guard' ? 'residency guard (not level geometry)' : owner ? `#${owner.placement} ${surface?.mesh?.split('/').at(-2)?.slice(0, 34)} · ${surface?.drawn ? 'drawn' : 'NOT DRAWN'}` : contact.note ?? 'resolving'
      return <div key={index}>{contact.blocking ? 'WALL ' : 'floor'} {contact.directions.join(' ')} n({contact.normal.join(', ')}) · {what}</div>
    })}
  </aside>
}

function Ruins({ owned, runtime, onReady }: { owned: RuinsAsset; runtime: ReturnType<typeof makeInputDevices>; onReady(): void }) {
  const [geometry, setGeometry] = useState<MeshletScene | null>(null)
  const [flames, setFlames] = useState<ScanFlames | null>(null)
  const [selection, setSelection] = useState<MeshletStats | null>(null)
  const home = owned.home
  const walker = useMemo(() => createWalker(home, runtime), [home, runtime])
  const cameras = useMemo(() => createRuinsCameras(owned.views), [owned])
  const [view, setView] = useState<RuinsView>(() => {
    const requested = new URLSearchParams(location.search).get('view')
    return requested && Object.hasOwn(ruinsViews, requested) ? requested as RuinsView : 'spawn'
  })
  useEffect(() => {
    walker.active = view === 'spawn'
    for (const camera of Object.values(cameras)) camera.layers.enable(BODY_LAYER)
  }, [cameras, view, walker])
  const [viewError, setViewError] = useState<Error | null>(null)
  const selectView = (next: RuinsView) => {
    const activate = () => {
      walker.setPaused(false)
      setView(next)
      const url = new URL(location.href)
      url.searchParams.set('view', next)
      history.replaceState(null, '', url)
    }
    if (next !== 'spawn') { activate(); return }
    void shared.collision.current?.prepare(new Vector3(...home.position)).then(() => {
      walker.respawn(undefined, [...home.position])
      walker.face(new Vector3(...home.target))
      geometry?.resetHistory()
      activate()
    }).catch(error => setViewError(error instanceof Error ? error : new Error(String(error))))
  }
  const status = useCharacterStatus(walker)
  const session = useLocalSession(walker)
  const shared = useMemo(() => ({ look: { current: null as Look | null }, warm: { current: 0 }, geometry: { current: null as MeshletScene | null }, collision: { current: null as RegionalCollision | null } }), [])
  const inspector = useMemo(() => createInspector({ renderer: 'WebGPU', tier: 'high', windowFrames: 600, onViewChange: view => { shared.geometry.current?.setDebugView(view === 'lod' ? 'lod' : 'normal'); shared.look.current?.setDebug(view === 'lod') } }), [shared])
  const [dumpStatus, setDumpStatus] = useState<'idle' | 'sending' | 'saved' | 'error'>('idle')
  const telemetry = useMemo<TelemetryAction>(() => ({ current: null, status: setDumpStatus }), [])
  const renderer = useCallback(async (props: object) => {
    if (!navigator.gpu) throw new Error('WebGPU is required for Dark Ruins')
    const storageSize = owned.largestBuffer
    const gl = new WebGPURenderer({ ...props, antialias: false, powerPreference: 'high-performance', trackTimestamp: true, requiredLimits: { maxStorageBufferBindingSize: storageSize, maxBufferSize: storageSize, maxStorageBuffersPerShaderStage: 12 } })
    await gl.init()
    if (!gl.backend.isWebGPUBackend) throw new Error('A WebGPU adapter is required')
    try {
      const created = await owned.createGeometry(gl)
      setGeometry(created.geometry)
      setFlames(created.flames)
    }
    catch (error) { gl.dispose(); throw error }
    gl.info.autoReset = false
    return gl
  }, [owned])
  if (viewError) throw viewError
  return <>
    <Canvas frameloop="always" shadows dpr={1} camera={cameras[view]} gl={renderer}>
      {geometry && flames && <Scene owned={owned} geometry={geometry} flames={flames} walker={walker} gameplayCamera={cameras.spawn} inspector={inspector} telemetry={telemetry} shared={shared} onStats={setSelection} onReady={onReady} />}
    </Canvas>
    <ContactDisplay shared={shared} />
    <SelectionDisplay selection={selection} sourceTriangles={owned.sourceTriangles} cappedTriangles={owned.cappedTriangles} />
    <section className="bs-inspect" aria-label="Camera views" style={{ top: 44, right: 'auto', left: 16, width: 360, maxWidth: 'calc(100vw - 32px)' }}>
      <div className="bs-inspect-view" role="group" aria-label="View bookmarks" style={{ marginTop: 0 }}>
        {(Object.keys(ruinsViews) as Array<keyof typeof ruinsViews>).map(id => <button key={id} type="button" aria-pressed={view === id} onClick={() => selectView(id)}>{ruinsViews[id]}</button>)}
      </div>
    </section>
    <InspectHud inspector={inspector} lodLegend={lodLegend} dump={{ onDump: () => { void telemetry.current?.() }, status: dumpStatus, message: `${owned.placements.length.toLocaleString()} placements | ${(owned.manifest.minimumWorldError * 1000).toFixed(0)} mm geometry cap` }} />
    <CharacterOverlay controller={walker} visible={view === 'spawn'} glyphs={glyphs} hints={['move', 'sprint', 'jump', 'roll', 'home']} prompt="Click to look around · T saves telemetry" buttons={[{ id: 'jump', label: 'Jump' }, { id: 'roll', label: 'Roll' }, { id: 'crouch', label: 'Crouch' }, { id: 'home', label: 'Home' }]} />
    {status.paused && view === 'spawn' && <CharacterPause controller={walker} items={[{ id: 'home', label: 'Return to spawn', onPress: () => { walker.setPaused(false); void shared.collision.current?.prepare(new Vector3(...home.position)).then(() => { walker.respawn(undefined, [...home.position]); walker.face(new Vector3(...home.target)) }) } }]} />}
  </>
}

export function Game() {
  const runtime = useMemo(makeInputDevices, [])
  const [owned, setOwned] = useState<RuinsAsset | null>(null)
  const [detail, setDetail] = useState('Loading the level directories')
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

function SelectionDisplay({ selection, sourceTriangles, cappedTriangles }: { selection: MeshletStats | null; sourceTriangles: number; cappedTriangles: number }) {
  if (!selection) return null
  const n = (value: number) => value.toLocaleString()
  return <aside className="bs-inspect" style={{ left: 16, top: 96, right: 'auto', width: 280, fontFamily: 'monospace', fontSize: 12 }} aria-label="Selection telemetry">
    <div>Source unique {n(sourceTriangles)}</div>
    <div>Retained unique {n(cappedTriangles)}</div>
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
