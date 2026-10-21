import * as THREE from 'three'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { WebGPURenderer } from 'three/webgpu'
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
import { VALLEY_GLYPHS, createWalker, yawOf } from './walker'
import { ValleyAudio } from './audio'
import { Landscape, type BarkSet, type LandscapeHandle } from './Landscape'
import { Probe, type ProbeApi } from './probe'
import { outfit } from './outfit'
import { locomotion, site, tiers, type Tier } from './model'
import { asset, buildValley, colliderHeights, type ValleyWorld } from './world'
import { atmosphereFor, cameraGrade, moods, sunlight } from './atmosphere'

export type Shared = {
  sound: ValleyAudio
  wind: Wind
  landscape: { current: LandscapeHandle | null }
  warm: { current: number }
  look: { current: LookHandle | null }
}

const SHADOW_LAYERS = [2] as const

function tierOf(): Tier {
  const requested = new URLSearchParams(location.search).get('tier')
  if (requested === 'high' || requested === 'medium' || requested === 'low') return requested
  return isTouchDevice() ? 'low' : 'high'
}

async function loadBark(): Promise<BarkSet> {
  const loader = new THREE.TextureLoader()
  const [color, normal] = await Promise.all([loader.loadAsync(asset('bark-pine/1k/c.webp')), loader.loadAsync(asset('bark-pine/1k/n.webp'))])
  color.colorSpace = THREE.SRGBColorSpace
  for (const texture of [color, normal]) { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4 }
  return { pine: { color, normal } }
}

function Warmup({ look, shared, onDone }: { look: LookHandle; shared: Shared; onDone: () => void }) {
  useEffect(() => {
    let active = true
    const landscape = new Promise<void>(resolve => {
      const poll = () => { if (shared.landscape.current || !active) resolve(); else requestAnimationFrame(poll) }
      poll()
    })
    void landscape.then(() => { if (!active) return; performance.mark('valley-compile-start'); return look.compile() }).then(() => {
      if (!active) return
      performance.mark('valley-compile-end')
      shared.warm.current = 1
      onDone()
    })
    return () => { active = false }
  }, [look, shared, onDone])
  return null
}

function Ground({ world }: { world: ValleyWorld }) {
  const { near } = world.sources
  const size = near.size
  const extent = near.extent
  const origin = near.origin
  const args = useMemo<HeightfieldArgs>(() => [size - 1, size - 1, colliderHeights(world, size, extent, origin) as unknown as number[], { x: extent, y: 1, z: extent }], [world, size, extent, origin])
  const half = extent / 2
  const centre = [origin[0] + half, origin[1] + half] as const
  const floor = Math.min(near.min, world.sources.far.min) - 10
  const ceiling = Math.max(near.max, world.sources.far.max) + 10
  const wallY = (floor + ceiling) / 2
  const wallHeight = (ceiling - floor) / 2
  return <RigidBody type="fixed" colliders={false} position={[centre[0], 0, centre[1]]}>
    <HeightfieldCollider args={args} />
    <CuboidCollider args={[half, wallHeight, 1]} position={[0, wallY, -half + 6]} />
    <CuboidCollider args={[half, wallHeight, 1]} position={[0, wallY, half - 6]} />
    <CuboidCollider args={[1, wallHeight, half]} position={[-half + 6, wallY, 0]} />
    <CuboidCollider args={[1, wallHeight, half]} position={[half - 6, wallY, 0]} />
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

function Scene({ shared, walker, world, bark, tier, events, api, onPlayable }: { shared: Shared; walker: CharacterHandle; world: ValleyWorld; bark: BarkSet; tier: Tier; events: CharacterEvents; api: ProbeApi; onPlayable: () => void }) {
  const [look, setLook] = useState<LookHandle | null>(null)
  const [compiled, setCompiled] = useState(false)
  const [fault, setFault] = useState<Error | null>(null)
  const atmosphere = useMemo(() => atmosphereFor(tier), [tier])
  const tuning = useMemo(() => moods[new URLSearchParams(location.search).get('mood') ?? ''], [])
  const onLook = useCallback((value: LookHandle | null) => { shared.look.current = value; shared.warm.current = 0; setLook(value) }, [shared])
  const onError = useCallback((error: unknown) => setFault(error instanceof Error ? error : new Error(String(error))), [])
  const done = useCallback(() => { setCompiled(true); onPlayable() }, [onPlayable])
  if (fault) throw fault
  return <>
    <WebGPULook atmosphere={atmosphere} sunlight={sunlight} camera={cameraGrade} tuning={tuning} quality={tier} shadowDistance={tiers[tier].shadowDistance} shadowMap={tiers[tier].shadowMap} shadowLayers={SHADOW_LAYERS} onReady={onLook} onError={onError} />
    {look && <Landscape world={world} tier={tier} wind={shared.wind} look={look} bark={bark} handle={shared.landscape} />}
    {look && !compiled && <Warmup look={look} shared={shared} onDone={done} />}
    <Physics gravity={[0, -locomotion.gravity, 0]} timeStep={locomotion.physicsStep} updatePriority={ALS_FRAME_PRIORITY.Physics}>
      <CharacterController controller={walker} events={events} />
      <Ground world={world} />
      {compiled && <Probe shared={shared} walker={walker} world={world} api={api} />}
    </Physics>
    <Listener shared={shared} />
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
  const [bark, setBark] = useState<BarkSet | null>(null)
  const [progress, setProgress] = useState(0.04)
  const [playable, setPlayable] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const onPlayable = useCallback(() => setPlayable(true), [])
  const walker = useMemo(() => world && createWalker(world.spawn, runtime), [world, runtime])

  useEffect(() => {
    let cancelled = false
    let character = 0
    let terrain = 0
    const report = () => { if (!cancelled) setProgress(0.04 + character * 0.4 + terrain * 0.5) }
    void Promise.all([
      preloadAlsCharacterGltf(undefined, { onProgress: value => { if (value !== undefined) { character = value; report() } } }).then(outfit),
      buildValley(value => { terrain = value; report() }),
      loadBark(),
      Promise.resolve().then(() => shared.sound.prepare()),
    ]).then(([, built, barkSet]) => {
      if (cancelled) return
      setProgress(0.95)
      setBark(barkSet)
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

  const ready = world !== null && bark !== null && walker !== null
  return <InputProvider runtime={runtime}><div className="hud-screen">
    {loadError && <div className="hud-menu" role="alert"><strong>Valley could not load</strong><span>{loadError}</span></div>}
    {ready && <Valley shared={shared} walker={walker} world={world} bark={bark} tier={tier} onPlayable={onPlayable} />}
    <TitleCard title={touch ? 'Valley' : 'Valley · Sea, River and Range'} />
    <Loading title="Valley" detail={!ready ? progress < 0.5 ? 'Loading the walker' : 'Reading the valley' : 'Growing the forest'} progress={progress} done={playable || loadError !== null} />
  </div></InputProvider>
}

function Valley({ shared, walker, world, bark, tier, onPlayable }: { shared: Shared; walker: CharacterHandle; world: ValleyWorld; bark: BarkSet; tier: Tier; onPlayable: () => void }) {
  const status = useCharacterStatus(walker)
  const session = useLocalSession(walker)
  const home = useCallback(() => walker.respawn(), [walker])
  const renderer = useCallback(async (props: object) => {
    if (!(navigator as Navigator & { gpu?: unknown }).gpu) throw new Error('WebGPU is unavailable. Open Valley in a browser with WebGPU enabled.')
    const gl = new WebGPURenderer({ ...props, antialias: false, powerPreference: 'high-performance', trackTimestamp: true, requiredLimits: { maxStorageBuffersPerShaderStage: 12 } })
    await gl.init()
    if (!(gl.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) { gl.dispose(); throw new Error('A WebGPU adapter is required to open Valley.') }
    gl.info.autoReset = false
    return gl
  }, [])
  const respawn = useCallback((position: [number, number, number], heading: number) => walker.teleport(position, yawOf(heading)), [walker])
  const events = useMemo<CharacterEvents>(() => ({
    onFootstep: request => shared.sound.PlayFootstepSound(request),
    onAction: action => { if (action === 'home') home() },
  }), [home, shared])
  const api = useMemo<ProbeApi>(() => ({ respawn }), [respawn])
  return <>
    <Canvas frameloop={session.frameloop} shadows dpr={tiers[tier].pixelRatio ? Math.min(devicePixelRatio, tiers[tier].pixelRatio) : internalPixelRatio()} camera={{ fov: 55, near: 0.1, far: site.far, position: [0, 260, 0] }} gl={renderer}>
      <Scene shared={shared} walker={walker} world={world} bark={bark} tier={tier} events={events} api={api} onPlayable={onPlayable} />
    </Canvas>
    <CharacterOverlay controller={walker} glyphs={VALLEY_GLYPHS} hints={['move', 'sprint', 'jump', 'roll', 'view', 'home']} prompt="Click to look around · follow the creek down to the river and the sea"
      buttons={[{ id: 'jump', label: 'Jump' }, { id: 'roll', label: 'Roll' }, { id: 'crouch', label: 'Crouch' }, { id: 'home', label: 'Home' }]} />
    {status.paused && <CharacterPause controller={walker} items={[{ id: 'home', label: 'Back to the tarn', onPress: home }]} />}
  </>
}
