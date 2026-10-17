import * as THREE from 'three'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CuboidCollider, HeightfieldCollider, Physics, RigidBody, type HeightfieldArgs } from '@react-three/rapier'
import { InputProvider, makeInputDevices } from '@blacksite/input'
import { CharacterController, CharacterOverlay, CharacterPause, useCharacterStatus, useLocalSession, type CharacterEvents, type CharacterHandle } from '@blacksite/subject'
import { depthDefaults } from '@blacksite/look'
import { Look } from '@blacksite/look/r3f'
import { internalPixelRatio, isTouchDevice } from '@blacksite/look/world'
import { BREEZE, createWind, type Wind } from '@blacksite/landscape'
import { attachPerfProbe } from '@blacksite/ui/perf-overlay'
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
import { atmosphereFor } from './atmosphere'

export type Shared = {
  sound: ValleyAudio
  wind: Wind
  landscape: { current: LandscapeHandle | null }
  warm: { current: number }
}

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

function Warmup({ onDone }: { onDone: () => void }) {
  const { gl, scene, camera } = useThree()
  useFrame(() => {}, 1)
  useEffect(() => {
    let cancelled = false
    const frame = requestAnimationFrame(() => {
      void gl.compileAsync(scene, camera).then(() => {
        if (cancelled) return
        scene.traverse(object => {
          const material = (object as THREE.Mesh).material
          for (const entry of Array.isArray(material) ? material : material ? [material] : []) {
            for (const value of Object.values(entry)) if (value instanceof THREE.Texture) gl.initTexture(value)
          }
        })
        onDone()
      })
    })
    return () => { cancelled = true; cancelAnimationFrame(frame) }
  }, [gl, scene, camera, onDone])
  return null
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

function Scene({ shared, walker, world, bark, tier, events, api }: { shared: Shared; walker: CharacterHandle; world: ValleyWorld; bark: BarkSet; tier: Tier; events: CharacterEvents; api: ProbeApi }) {
  const [compiled, setCompiled] = useState(false)
  const done = useCallback(() => setCompiled(true), [])
  const sun = useMemo(() => new THREE.DirectionalLight(), [])
  const fill = useMemo(() => new THREE.HemisphereLight(), [])
  const atmosphere = useMemo(() => atmosphereFor(tier), [tier])
  const onLook = useCallback((look: unknown) => { shared.warm.current = look ? 1 : 0 }, [shared])
  return <>
    <primitive object={fill} />
    <Landscape world={world} tier={tier} wind={shared.wind} sun={sun} bark={bark} handle={shared.landscape} />
    {compiled ? <Look atmosphere={atmosphere} quality={tier} sky fog environment sun={sun} fill={fill} onReady={onLook} /> : <Warmup onDone={done} />}
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
  }), [tier])
  const [world, setWorld] = useState<ValleyWorld | null>(null)
  const [bark, setBark] = useState<BarkSet | null>(null)
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
      loadBark(),
      Promise.resolve().then(() => shared.sound.prepare()),
    ]).then(([, built, barkSet]) => {
      if (cancelled) return
      setProgress(1)
      setBark(barkSet)
      setWorld(built)
    })
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
    {ready && <Valley shared={shared} walker={walker} world={world} bark={bark} tier={tier} />}
    <TitleCard title={touch ? 'Valley' : 'Valley · The High Meadow'} />
    <Loading title="Valley" detail={progress < 0.5 ? 'Loading the walker' : 'Growing the forest'} progress={progress} done={ready} />
  </div></InputProvider>
}

function Valley({ shared, walker, world, bark, tier }: { shared: Shared; walker: CharacterHandle; world: ValleyWorld; bark: BarkSet; tier: Tier }) {
  const status = useCharacterStatus(walker)
  const session = useLocalSession(walker)
  const home = useCallback(() => walker.respawn(), [walker])
  const respawn = useCallback((position: [number, number, number], heading: number) => walker.teleport(position, yawOf(heading)), [walker])
  const events = useMemo<CharacterEvents>(() => ({
    onFootstep: request => shared.sound.PlayFootstepSound(request),
    onAction: action => { if (action === 'home') home() },
  }), [home, shared])
  const api = useMemo<ProbeApi>(() => ({ respawn }), [respawn])
  return <>
    <Canvas frameloop={session.frameloop} shadows dpr={tiers[tier].pixelRatio ? Math.min(devicePixelRatio, tiers[tier].pixelRatio) : internalPixelRatio()} camera={{ fov: 55, ...depthDefaults(tier, { far: site.far }).camera, position: [0, 260, 0] }} gl={{ antialias: false, powerPreference: 'high-performance' }}
      onCreated={state => { state.gl.domElement.style.filter = 'none'; attachPerfProbe(state.gl) }}>
      <Scene shared={shared} walker={walker} world={world} bark={bark} tier={tier} events={events} api={api} />
    </Canvas>
    <CharacterOverlay controller={walker} glyphs={VALLEY_GLYPHS} hints={['move', 'sprint', 'jump', 'roll', 'view', 'home']} prompt="Click to look around · walk down the path into the forest"
      buttons={[{ id: 'jump', label: 'Jump' }, { id: 'roll', label: 'Roll' }, { id: 'crouch', label: 'Crouch' }, { id: 'home', label: 'Home' }]} />
    {status.paused && <CharacterPause controller={walker} items={[{ id: 'home', label: 'Back to the meadow', onPress: home }]} />}
  </>
}
