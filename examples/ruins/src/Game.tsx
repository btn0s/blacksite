import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, createPortal, useFrame, useThree } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { PerspectiveCamera, Vector3 } from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { InputProvider, makeInputDevices } from '@blacksite/input'
import { BODY_LAYER, CharacterController, CharacterOverlay, CharacterPause, useCharacterStatus, useLocalSession, useTouchActive, type CharacterEvents, type CharacterHandle } from '@blacksite/subject'
import { MeshletScene, type MeshletStats } from '@blacksite/geometry'
import { createInspector } from '@blacksite/inspect'
import { DebugBlock, InspectHud } from '@blacksite/inspect/react'
import { WebGPULook } from '@blacksite/look/webgpu-r3f'
import { LOOK_CONTROLS, type LookFeatures, type LookTuning, type WebGPULook as Look, type WebGPULookStage } from '@blacksite/look/webgpu'
import type { Parameter } from '@blacksite/inspect'
import { Compass, Loading, Notice } from '@blacksite/ui/hud'
import { preloadAlsCharacterGltf } from 'als-ue5-r3f/app/AlsCharacterGltf'
import { AlsPhysicsStepper } from 'als-ue5-r3f/app/AlsPhysicsStepper'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { createWalker } from '../../valley/src/walker'
import { survivorRim, wearSurvivor } from './survivor'
import savedLook from './look.json'
import { AxesGizmo } from '../../shared/AxesGizmo'
import { Screenshot } from '../../shared/Screenshot'
import { SceneInspection, type InspectionContent, type TelemetryAction } from '../../shared/Inspection'
import { createScanMaterialStreaming, residentScanTextures } from '../../shared/scan-material'
import { loadRuins, type RuinsAsset } from './asset'
import { RuinsCollision, TerrainCollision, type RegionalCollision } from './collision'
import { Landscape } from './Landscape'
import { loadLandscape, type LandscapeAsset } from './landscape-asset'
import type { Contact } from './contacts'
import { scanEnvironment } from '../../shared/scan-environment'
import type { ScanFlames } from '../../shared/scan-flames'
import { TelemetryReadout } from './TelemetryReadout'
import { ruinsViews, ruinsNearRadius, createRuinsCameras, type RuinsView } from './views'

const shadowLayers = [2]
const { rim: defaultRim, ...defaultTuning } = savedLook
const defaultLook: Partial<LookTuning> = defaultTuning
survivorRim.value = defaultRim
const FEATURES: ReadonlyArray<{ id: keyof LookFeatures; label: string; description: string }> = [
  { id: 'shafts', label: 'Sun shafts', description: 'Half a millisecond or less: eight shadow-map taps per pixel through the fog, jittered and resolved by the temporal pass.' },
  { id: 'bloom', label: 'Bloom', description: 'About 0.3 to 0.6 ms: a high-pass and a five-level blur chain at half resolution.' },
  { id: 'lens', label: 'Chromatic aberration', description: 'About 0.1 to 0.2 ms: one extra full-screen copy and three taps.' },
  { id: 'clouds', label: 'Clouds', description: 'Sky pixels only, and the sky light is re-baked when this changes.' },
]
const disabledStages = (new URLSearchParams(location.search).get('off') ?? '').split(',').filter(Boolean) as WebGPULookStage[]
const glyphs = {
  home: { label: 'Spawn', keyboard: 'R', touch: 'Home', gamepad: { xbox: 'View', playstation: 'Create', generic: 'Back' } },
  screenshot: { label: 'Screenshot', keyboard: 'P', gamepad: { generic: 'P key' } },
}
const noticeMs = 2200
const touchGizmoBottom = 230
const outwardReach = 1e30
const nearTimeoutMs = 20000
const loadingFrameMs = 6
const loadingUploadBytes = 32 * 1048576
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
const lodLegend = [{ color: '#ffc1aa', label: 'Source · 0' }, { color: '#adc4ef', label: 'Level 1' }, { color: '#e3ffa3', label: 'Level 2' }]

function Scene({ owned, landscape, geometry, flames, walker, gameplayCamera, inspector, telemetry, shared, gizmoBottom, onStats, onReady, onSaved }: {
  onStats(value: MeshletStats): void
  onReady(): void
  onSaved(file: string): void
  gizmoBottom: number
  owned: RuinsAsset
  landscape: LandscapeAsset
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
  const [playable, setPlayable] = useState(false)
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
    parameters: [
      ...LOOK_CONTROLS.map<Parameter>(control => ({
        id: `look-${control.key}`, group: 'Look', label: control.label, description: control.hint, min: control.min, max: control.max, step: control.step,
        value: shared.look.current?.tuning[control.key] ?? 0,
        setValue: value => shared.look.current?.tune({ [control.key]: value }),
      })),
      { id: 'look-rim', group: 'Look', label: 'Character rim', description: 'Cool edge light on the survivor so it reads against the fog.', min: 0, max: 6000, step: 50, value: survivorRim.value, setValue: value => { survivorRim.value = value } },
    ],
    actions: [{ id: 'look-save', group: 'Look', label: 'Save look', run: () => saveLook(shared.look.current) }],
    techniques: [
      ...FEATURES.map(feature => ({ id: `feature-${feature.id}`, group: 'Rendering', label: feature.label, description: feature.description, enabled: true, setEnabled: (enabled: boolean) => shared.look.current?.setFeature(feature.id, enabled) })),
      { id: 'meshlet-debug', group: 'Overlays', label: 'Colour by meshlet', enabled: false, setEnabled: enabled => geometry.setDebugView(enabled ? 'meshlets' : inspector.getSnapshot().view === 'lod' ? 'lod' : 'normal') },
      { id: 'collision-overlay', group: 'Overlays', label: 'Show collision', description: 'Resident collision: green walkable, red steep, blue overhang.', enabled: false, setEnabled: enabled => shared.collision.current?.setOverlay(enabled ? 0 : null) },
      { id: 'collision-hidden', group: 'Overlays', label: 'Show invisible collision', description: 'Only collision standing 0.5 m or more in front of the drawn surface.', enabled: false, setEnabled: enabled => shared.collision.current?.setOverlay(enabled ? 0.5 : null) },
      { id: 'temporal-aa', group: 'Rendering', label: 'Temporal anti-aliasing', description: 'TRAA resolve with camera jitter. Off bypasses the resolve and the jitter.', enabled: true, setEnabled: enabled => shared.look.current?.setTemporal({ traa: enabled }) },
      { id: 'gtao-temporal', group: 'Rendering', label: 'Temporal ambient occlusion', description: 'Per-frame rotation of the occlusion sampling pattern.', enabled: true, setEnabled: enabled => shared.look.current?.setTemporal({ gtao: enabled }) },
      { id: 'meshlet-shadows', group: 'Rendering', label: 'Level shadows', description: 'Independent light-view cluster selection.', enabled: true, setEnabled: enabled => geometry.setShadowEnabled(enabled) },
      { id: 'meshlet-lod', group: 'Culling & LOD', label: 'Level of detail', description: 'Select the finest resident cut within 120 m when disabled.', enabled: true, setEnabled: enabled => geometry.setLodEnabled(enabled) },
      { id: 'meshlet-occlusion', group: 'Culling & LOD', label: 'Occlusion culling', description: 'GPU cluster visibility and recovery.', enabled: true, setEnabled: enabled => { geometry.occlusionEnabled = enabled; geometry.resetHistory() } },
      { id: 'bundle-refresh', group: 'Diagnostics', label: 'Re-record draws every frame', description: 'Re-records every lit material bundle each frame instead of on binding changes.', enabled: false, setEnabled: enabled => geometry.setBundleRefresh(enabled) },
    ],
    setView: view => { geometry.setDebugView(view === 'lod' ? 'lod' : 'normal'); shared.look.current?.setDebug(view === 'lod') },
    textures: () => residentScanTextures(renderer),
    probe: async () => ({ motion: await Promise.race([shared.look.current?.probeMotion(), new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 2000))]), look: shared.look.current?.telemetry.snapshot(), frames: shared.look.current?.telemetry.recent(240) }),
    details: () => ({ look: shared.look.current?.telemetry.snapshot(), collisionContacts: shared.collision.current?.contactReport(), placements: owned.placements.length, minimumWorldError: owned.manifest.minimumWorldError, sourceTriangles: owned.sourceTriangles, cappedTriangles: owned.cappedTriangles, bounds: { min: owned.bounds.min.toArray(), max: owned.bounds.max.toArray() }, untranslated: owned.manifest.untranslated, excluded: owned.manifest.excluded, geometryPaging: geometry.pagingStats(), textureStreaming: textures.snapshot(), regionalCollision: shared.collision.current?.stats(), ...stats }),
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
      setPlayable(true)
    })().catch(error => { if (active) onError(error) })
    return () => { active = false }
  }, [collisionReady, geometry, look, onError, onReady, renderer, shared, walker])
  useEffect(() => {
    if (!look || !playable) return
    const { origin, extent } = landscape.sources.far
    look.setGroundExtent(origin, [origin[0] + extent, origin[1] + extent], 2500)
  }, [look, landscape, playable])
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
    <WebGPULook atmosphere={atmosphere} sunlight={sunlight} film={film} tuning={defaultLook} quality="high" shadowDistance={400} shadowMap={2048} shadowCascades={4} shadowLayers={shadowLayers} disable={disabledStages} onReady={onLook} onError={onError} />
    {playable && look && <Landscape asset={landscape} look={look} onError={onError} />}
    <Physics gravity={[0, -9.8, 0]} paused timeStep={1 / 60} updatePriority={ALS_FRAME_PRIORITY.Physics}>
      <AlsPhysicsStepper />
      {collisionReady && createPortal(<CharacterController controller={walker} events={events} />, scene, { camera: gameplayCamera })}
      <RuinsCollision directory={owned.collision} describe={owned.describe} root={owned.collisionRoot} walker={walker} onReady={onCollisionReady} onError={onError} handle={shared.collision} />
      {playable && <TerrainCollision asset={landscape} />}
    </Physics>
    <SceneInspection name="ruins" look={shared.look} warm={shared.warm} walker={walker} inspector={inspector} telemetry={telemetry} content={content} />
    <Screenshot name="ruins" look={shared.look} warm={shared.warm} walker={walker} onSaved={onSaved} />
    <AxesGizmo bottom={gizmoBottom} />
  </>
}

function FlyDisplay({ walker }: { walker: CharacterHandle }) {
  const { flying } = useCharacterStatus(walker)
  return <DebugBlock><div>Flying {flying ? 'on' : 'off'} · double-tap jump</div></DebugBlock>
}

function ContactDisplay({ shared }: { shared: { collision: { current: RegionalCollision | null } } }) {
  const [contacts, setContacts] = useState<Contact[]>([])
  useEffect(() => {
    const interval = setInterval(() => setContacts(current => { const next = shared.collision.current?.contacts() ?? []; return next.length === 0 && current.length === 0 ? current : [...next] }), 150)
    return () => clearInterval(interval)
  }, [shared])
  if (!contacts.length) return null
  const shown = [...contacts].sort((a, b) => Number(b.blocking) - Number(a.blocking)).slice(0, 3)
  return <DebugBlock>
    <div>Contacts {contacts.length} · T saves them</div>
    {shown.map((contact, index) => {
      const owner = contact.owners?.[0]
      const surface = owner?.surface as { mesh?: string; drawn?: boolean; material?: string } | undefined
      const what = contact.kind === 'residency-guard' ? 'residency guard (not level geometry)' : owner ? `#${owner.placement} ${surface?.mesh?.split('/').at(-2)?.slice(0, 34)} · ${surface?.drawn ? 'drawn' : 'NOT DRAWN'}` : contact.note ?? 'resolving'
      return <div key={index}>{contact.blocking ? 'WALL ' : 'floor'} {contact.directions.join(' ')} n({contact.normal.join(', ')}) · {what}</div>
    })}
  </DebugBlock>
}

function Ruins({ owned, landscape, runtime, onReady }: { owned: RuinsAsset; landscape: LandscapeAsset; runtime: ReturnType<typeof makeInputDevices>; onReady(): void }) {
  const [geometry, setGeometry] = useState<MeshletScene | null>(null)
  const [flames, setFlames] = useState<ScanFlames | null>(null)
  const [selection, setSelection] = useState<MeshletStats | null>(null)
  const home = owned.home
  const walker = useMemo(() => createWalker(home, runtime, {}), [home, runtime])
  const cameras = useMemo(() => createRuinsCameras(owned.views), [owned])
  const [view] = useState<RuinsView>(() => {
    const requested = new URLSearchParams(location.search).get('view')
    return requested && Object.hasOwn(ruinsViews, requested) ? requested as RuinsView : 'spawn'
  })
  useEffect(() => {
    walker.active = view === 'spawn'
    for (const camera of Object.values(cameras)) camera.layers.enable(BODY_LAYER)
  }, [cameras, view, walker])
  const status = useCharacterStatus(walker)
  const touch = useTouchActive()
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef(0)
  const onSaved = useCallback(() => {
    clearTimeout(savedTimer.current)
    setSaved(true)
    savedTimer.current = window.setTimeout(() => setSaved(false), noticeMs)
  }, [])
  useEffect(() => () => clearTimeout(savedTimer.current), [])
  const heading = useMemo(() => {
    const direction = new Vector3()
    return () => { cameras[view].getWorldDirection(direction); return Math.atan2(direction.x, -direction.z) }
  }, [cameras, view])
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
  return <>
    <Canvas frameloop="always" shadows dpr={1} camera={cameras[view]} gl={renderer}>
      {geometry && flames && <Scene owned={owned} landscape={landscape} geometry={geometry} flames={flames} walker={walker} gameplayCamera={cameras.spawn} inspector={inspector} telemetry={telemetry} shared={shared} gizmoBottom={touch ? touchGizmoBottom : 16} onStats={setSelection} onReady={onReady} onSaved={onSaved} />}
    </Canvas>
    <InspectHud inspector={inspector} lodLegend={lodLegend} dump={{ onDump: () => { void telemetry.current?.() }, status: dumpStatus, message: `${owned.placements.length.toLocaleString()} placements | ${(owned.manifest.minimumWorldError * 1000).toFixed(0)} mm geometry cap` }}>
      <SelectionDisplay selection={selection} sourceTriangles={owned.sourceTriangles} cappedTriangles={owned.cappedTriangles} />
      <TelemetryReadout look={shared.look} geometry={geometry} selection={selection} />
      <FlyDisplay walker={walker} />
      <ContactDisplay shared={shared} />
    </InspectHud>
    <Compass heading={heading} />
    <Notice text="Saved screenshot" visible={saved} />
    <CharacterOverlay controller={walker} visible={view === 'spawn'} glyphs={glyphs} hints={['move', 'sprint', 'jump', 'roll', 'fly', 'home', 'screenshot']} prompt="Click to look around · T saves telemetry" buttons={[{ id: 'jump', label: 'Jump' }, { id: 'roll', label: 'Roll' }, { id: 'crouch', label: 'Crouch' }, { id: 'home', label: 'Home' }]} />
    {status.paused && view === 'spawn' && <CharacterPause controller={walker} items={[{ id: 'home', label: 'Return to spawn', onPress: () => { walker.setPaused(false); void shared.collision.current?.prepare(new Vector3(...home.position)).then(() => { walker.respawn(undefined, [...home.position]); walker.face(new Vector3(...home.target)) }) } }]} />}
  </>
}

export function Game() {
  const runtime = useMemo(makeInputDevices, [])
  const [owned, setOwned] = useState<RuinsAsset | null>(null)
  const [landscape, setLandscape] = useState<LandscapeAsset | null>(null)
  const [detail, setDetail] = useState('Loading the level directories')
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const onReady = useCallback(() => setReady(true), [])
  useEffect(() => {
    void Promise.all([loadRuins(setDetail), preloadAlsCharacterGltf().then(gltf => wearSurvivor(gltf)), loadLandscape()]).then(([asset, , land]) => { setOwned(asset); setLandscape(land) }).catch(error => setError(String(error)))
  }, [])
  return <InputProvider runtime={runtime}><div className="hud-screen">
    <RenderBoundary>{owned && landscape && <Ruins owned={owned} landscape={landscape} runtime={runtime} onReady={onReady} />}</RenderBoundary>
    {error && <div className="hud-menu" role="alert"><strong>Dark Ruins could not load</strong><span>{error}</span></div>}
    <Loading title="Dark Ruins" detail={detail} progress={ready ? 1 : owned && landscape ? 0.7 : 0.35} done={ready || error !== null} />
  </div></InputProvider>
}

async function saveLook(look: Look | null) {
  if (!look) return 'The look is not ready yet.'
  const values = { ...look.tuning, rim: survivorRim.value }
  console.info('[look]', JSON.stringify(values))
  try {
    const response = await fetch('/__inspect/look', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values), signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error(`Look upload returned ${response.status}`)
    const { saved } = await response.json() as { saved: string }
    return `Saved ${saved}. Copy it to examples/ruins/src/look.json to make it the default.`
  } catch {
    return 'The dev server could not save the look; the values are in the browser console.'
  }
}

class RenderBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() { return this.state.error ? <div className="hud-menu" role="alert"><strong>Dark Ruins could not start</strong><span>{this.state.error}</span></div> : this.props.children }
}

function SelectionDisplay({ selection, sourceTriangles, cappedTriangles }: { selection: MeshletStats | null; sourceTriangles: number; cappedTriangles: number }) {
  if (!selection) return null
  const n = (value: number) => value.toLocaleString()
  return <DebugBlock>
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
  </DebugBlock>
}
