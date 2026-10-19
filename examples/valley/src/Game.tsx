import * as THREE from 'three'
import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { WebGPURenderer } from 'three/webgpu'
import { Canvas, useFrame } from '@react-three/fiber'
import { CuboidCollider, HeightfieldCollider, Physics, RigidBody, type HeightfieldArgs } from '@react-three/rapier'
import { InputProvider, makeInputDevices } from '@blacksite/input'
import { CharacterController, CharacterOverlay, CharacterPause, useCharacterStatus, useLocalSession, type CharacterEvents, type CharacterHandle } from '@blacksite/subject'
import { WebGPULook } from '@blacksite/look/webgpu-r3f'
import type { WebGPULook as LookHandle } from '@blacksite/look/webgpu'
import { internalPixelRatio, isTouchDevice } from '@blacksite/look/world'
import { BREEZE, createWind, type Wind } from '@blacksite/landscape'
import { Loading, TitleCard, useTouch } from '@blacksite/ui/hud'
import { preloadAlsCharacterGltf } from 'als-ue5-r3f/app/AlsCharacterGltf'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { VALLEY_GLYPHS, createWalker } from './walker'
import { ValleyAudio } from './audio'
import { Landscape, type LandscapeHandle } from './Landscape'
import { Probe } from './probe'
import { createInspector } from '@blacksite/inspect'
import { InspectHud } from '@blacksite/inspect/react'
import { Inspection, type TelemetryAction } from './inspection'
import { outfit } from './outfit'
import { locomotion, site, tiers, type Tier } from './model'
import { buildValley, colliderHeights, type ValleyWorld } from './world'
import { atmosphereFor, sunlight, cameraGrade } from './atmosphere'
import { loadOwned, type Owned } from './owned'

const SHADOW_LAYERS = [2] as const

export type Shared = {
  sound: ValleyAudio
  wind: Wind
  landscape: { current: LandscapeHandle | null }
  warm: { current: number }
  look: { current: LookHandle | null }
}

function tierOf(): Tier {
  const requested = new URLSearchParams(location.search).get('tier')
  if (requested === 'high' || requested === 'medium' || requested === 'low') return requested
  return isTouchDevice() ? 'low' : 'high'
}


function Ground({ world }: { world: ValleyWorld }) {
  const size = site.nearSize
  const extent = site.walkable
  const args = useMemo<HeightfieldArgs>(() => [size - 1, size - 1, colliderHeights(world, size, extent) as unknown as number[], { x: extent, y: 1, z: extent }], [world, size, extent])
  const half = extent / 2
  return <RigidBody type="fixed" colliders={false}>
    <HeightfieldCollider args={args} />
    <CuboidCollider args={[half, 400, 1]} position={[0, 300, -half + 6]} />
    <CuboidCollider args={[half, 400, 1]} position={[0, 300, half - 6]} />
    <CuboidCollider args={[1, 400, half]} position={[-half + 6, 300, 0]} />
    <CuboidCollider args={[1, 400, half]} position={[half - 6, 300, 0]} />
  </RigidBody>
}

function Listener({ shared }: { shared: Shared }) {
  const forward = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera }, delta) => {
    camera.getWorldDirection(forward)
    const landscape = shared.landscape.current
    const near = landscape ? Math.min(1, landscape.forest.stats.near / 40) : 0
    shared.sound.listen(camera.position, forward, shared.wind, near, delta)
  }, ALS_FRAME_PRIORITY.Camera + 0.3)
  return null
}

function Scene({ shared, walker, world, owned, tier, events, inspector, telemetry }: { shared: Shared; walker: CharacterHandle; world: ValleyWorld; owned: Owned; tier: Tier; events: CharacterEvents; inspector: ReturnType<typeof createInspector>; telemetry: TelemetryAction }) {
  const [look, setLook] = useState<LookHandle | null>(null)
  const [fault, setFault] = useState<Error | null>(null)
  const onError = useCallback((error: unknown) => setFault(error instanceof Error ? error : new Error(String(error))), [])
  const atmosphere = useMemo(() => atmosphereFor(tier), [tier])
  const onLook = useCallback((value: LookHandle | null) => { shared.look.current = value; shared.warm.current = value ? 1 : 0; setLook(value) }, [shared])
  if (fault) throw fault
  return <>
    <WebGPULook atmosphere={atmosphere} sunlight={sunlight} camera={cameraGrade} quality={tier} shadowDistance={tiers[tier].shadowDistance} shadowMap={tiers[tier].shadowMap} shadowLayers={SHADOW_LAYERS} onReady={onLook} onError={onError} />
    {look && <Landscape world={world} tier={tier} wind={shared.wind} look={look} owned={owned} handle={shared.landscape} />}
    <Physics gravity={[0, -locomotion.gravity, 0]} timeStep={locomotion.physicsStep} updatePriority={ALS_FRAME_PRIORITY.Physics}>
      <CharacterController controller={walker} events={events} />
      <Ground world={world} />
      <Probe shared={shared} walker={walker} world={world} />
    </Physics>
    <Listener shared={shared} />
    <Inspection shared={shared} walker={walker} inspector={inspector} telemetry={telemetry} />
  </>
}

export function Game() {
  const runtime = useMemo(makeInputDevices, [])
  const touch = useTouch()
  const tier = useMemo(tierOf, [])
  const shared = useMemo<Shared>(() => ({
    sound: new ValleyAudio(tier === 'low' ? 'phone' : 'desktop'),
    wind: createWind(BREEZE),
    landscape: { current: null },
    warm: { current: 0 },
    look: { current: null },
  }), [tier])
  const [world, setWorld] = useState<ValleyWorld | null>(null)
  const [owned, setOwned] = useState<Owned | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0.04)
  const walker = useMemo(() => world && createWalker(world.spawn, runtime), [world, runtime])

  useEffect(() => {
    let cancelled = false
    let character = 0
    let terrain = 0
    const report = () => { if (!cancelled) setProgress(0.04 + character * 0.4 + terrain * 0.5) }
    void Promise.all([
      preloadAlsCharacterGltf(undefined, { onProgress: value => { if (value !== undefined) { character = value; report() } } }).then(outfit),
      buildValley(tier, value => { terrain = value; report() }),
      loadOwned(),
      Promise.resolve().then(() => shared.sound.prepare()),
    ]).then(([, built, ownedSet]) => {
      if (cancelled) return
      setProgress(1)
      setOwned(ownedSet)
      setWorld(built)
    }).catch(error => { if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error)) })
    const unlock = () => shared.sound.unlock()
    addEventListener('pointerdown', unlock)
    addEventListener('keydown', unlock)
    return () => {
      cancelled = true
      removeEventListener('pointerdown', unlock)
      removeEventListener('keydown', unlock)
      shared.sound.dispose()
    }
  }, [shared])

  const ready = world !== null && owned !== null && walker !== null
  return <InputProvider runtime={runtime}><div className="hud-screen">
    {loadError && <div className="hud-menu" role="alert"><strong>Valley could not load</strong><span>{loadError}</span></div>}
    {ready && <Valley shared={shared} walker={walker} world={world} owned={owned} tier={tier} />}
    <TitleCard title={touch ? 'Valley' : 'Valley · The High Meadow'} />
    <Loading title="Valley" detail={progress < 0.5 ? 'Loading the walker' : 'Growing the forest'} progress={progress} done={ready} />
  </div></InputProvider>
}

function Valley({ shared, walker, world, owned, tier }: { shared: Shared; walker: CharacterHandle; world: ValleyWorld; owned: Owned; tier: Tier }) {
  const status = useCharacterStatus(walker)
  const session = useLocalSession(walker)
  const home = useCallback(() => walker.respawn(), [walker])
  const events = useMemo<CharacterEvents>(() => ({
    onFootstep: request => shared.sound.PlayFootstepSound(request),
    onAction: action => { if (action === 'home') home() },
  }), [home, shared])
  const inspector = useMemo(() => createInspector({ renderer: 'WebGPU', tier, windowFrames: 600, onViewChange: view => {
    const landscape = shared.landscape.current
    landscape?.terrain.setLodView(view === 'lod')
    landscape?.forest.setLodView(view === 'lod')
    landscape?.cover.setLodView(view === 'lod')
    landscape?.rocks.setLodView(view === 'lod')
    shared.look.current?.setDebug(view === 'lod')
  } }), [shared, tier])
  const [dumpStatus, setDumpStatus] = useState<'idle' | 'sending' | 'saved' | 'error'>('idle')
  const telemetry = useMemo<TelemetryAction>(() => ({ current: null, status: setDumpStatus }), [])
  const renderer = useCallback(async (props: object) => {
    if (!navigator.gpu) throw new Error('WebGPU is unavailable. Open Valley in a browser with WebGPU enabled.')
    const gl = new WebGPURenderer({ ...props, antialias: false, powerPreference: 'high-performance', trackTimestamp: true })
    await gl.init()
    if (!gl.backend.isWebGPUBackend) { gl.dispose(); throw new Error('A WebGPU adapter is required to open Valley.') }
    gl.info.autoReset = false
    return gl
  }, [])
  return <>
    <RenderBoundary><Canvas frameloop={session.frameloop} shadows dpr={tiers[tier].pixelRatio ? Math.min(devicePixelRatio, tiers[tier].pixelRatio) : internalPixelRatio()} camera={{ fov: 55, near: 0.1, far: site.far, position: [0, 260, 0] }} gl={renderer}>
      <Scene shared={shared} walker={walker} world={world} owned={owned} tier={tier} events={events} inspector={inspector} telemetry={telemetry} />
    </Canvas></RenderBoundary>
    <InspectHud inspector={inspector} dump={{ onDump: () => { void telemetry.current?.() }, status: dumpStatus }} />
    <CharacterOverlay controller={walker} glyphs={VALLEY_GLYPHS} hints={['move', 'sprint', 'jump', 'roll', 'home']} prompt="Click to look around · T saves telemetry"
      buttons={[{ id: 'jump', label: 'Jump' }, { id: 'roll', label: 'Roll' }, { id: 'crouch', label: 'Crouch' }, { id: 'home', label: 'Home' }]} />
    {status.paused && <CharacterPause controller={walker} items={[{ id: 'home', label: 'Back to the meadow', onPress: home }]} />}
  </>
}

class RenderBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() {
    return this.state.error ? <div className="hud-menu" role="alert"><strong>Valley could not start</strong><span>{this.state.error}</span></div> : this.props.children
  }
}
