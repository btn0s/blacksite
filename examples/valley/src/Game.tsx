import * as THREE from 'three'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CuboidCollider, HeightfieldCollider, Physics, RigidBody } from '@react-three/rapier'
import { InputProvider, makeInputDevices } from '@blacksite/input'
import { Look } from '@blacksite/look/r3f'
import { internalPixelRatio, isTouchDevice } from '@blacksite/look/world'
import { BREEZE, createWind, type Wind } from '@blacksite/landscape'
import { attachPerfProbe } from '@blacksite/ui/perf-overlay'
import { Hints, Loading, Prompt, Screen, TitleCard, TouchPad, useTouch } from '@blacksite/ui/hud'
import { preloadAlsCharacterGltf } from 'als-ue5-r3f/app/AlsCharacterGltf'
import { createCharacterPoseSample } from 'als-ue5-r3f/app/CharacterPoseSample'
import { createWorldTimeState } from 'als-ue5-r3f/engine/timeDilation'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { createCommand, type Command } from './controls'
import { Player, type Spawn } from './player'
import { ValleyAudio } from './audio'
import { Landscape, type BarkSet, type LandscapeHandle } from './Landscape'
import { Probe, type ProbeApi } from './probe'
import { outfit } from './outfit'
import { locomotion, site, type Tier } from './model'
import { asset, buildValley, colliderHeights, type ValleyWorld } from './world'
import { atmosphereFor } from './atmosphere'

export type Shared = {
  command: Command
  pose: { current: ReturnType<typeof createCharacterPoseSample> }
  scripted: { current: boolean }
  touchLook: { current: { x: number; y: number } }
  touchMove: { current: { forward: number; right: number } }
  sound: ValleyAudio
  wind: Wind
  landscape: { current: LandscapeHandle | null }
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
  const heights = useMemo(() => colliderHeights(world, size, extent), [world, size, extent])
  const half = extent / 2
  return <RigidBody type="fixed" colliders={false}>
    <HeightfieldCollider args={[size - 1, size - 1, heights as unknown as number[], { x: extent, y: 1, z: extent }]} />
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

function Scene({ shared, world, bark, tier, spawn, onAction, api }: { shared: Shared; world: ValleyWorld; bark: BarkSet; tier: Tier; spawn: Spawn; onAction: (action: string) => void; api: ProbeApi }) {
  const time = useMemo(createWorldTimeState, [])
  const [compiled, setCompiled] = useState(false)
  const done = useCallback(() => setCompiled(true), [])
  const sun = useMemo(() => new THREE.DirectionalLight(), [])
  const fill = useMemo(() => new THREE.HemisphereLight(), [])
  const atmosphere = useMemo(() => atmosphereFor(tier), [tier])
  return <>
    <primitive object={fill} />
    <Landscape world={world} tier={tier} wind={shared.wind} sun={sun} bark={bark} handle={shared.landscape} />
    {compiled ? <Look atmosphere={atmosphere} quality={tier} sky fog environment sun={sun} fill={fill} /> : <Warmup onDone={done} />}
    <Physics gravity={[0, -locomotion.gravity, 0]} timeStep={locomotion.physicsStep} updatePriority={ALS_FRAME_PRIORITY.Physics}>
      <Player command={shared.command} pose={shared.pose} time={time} audio={shared.sound} spawn={spawn} scripted={shared.scripted} touchLook={shared.touchLook} touchMove={shared.touchMove} onAction={onAction} />
      <Ground world={world} />
      {compiled && <Probe shared={shared} world={world} api={api} />}
    </Physics>
    <Listener shared={shared} />
  </>
}

export function Game() {
  const runtime = useMemo(makeInputDevices, [])
  const touch = useTouch()
  const tier = useMemo(tierOf, [])
  const shared = useMemo<Shared>(() => ({
    command: createCommand(site.spawnYaw * 180 / Math.PI),
    pose: { current: createCharacterPoseSample() },
    scripted: { current: false },
    touchLook: { current: { x: 0, y: 0 } },
    touchMove: { current: { forward: 0, right: 0 } },
    sound: new ValleyAudio(tier === 'low' ? 'phone' : 'desktop'),
    wind: createWind(BREEZE),
    landscape: { current: null },
  }), [tier])
  const [world, setWorld] = useState<ValleyWorld | null>(null)
  const [bark, setBark] = useState<BarkSet | null>(null)
  const [progress, setProgress] = useState(0.04)
  const [locked, setLocked] = useState(false)
  const [spawn, setSpawn] = useState<Spawn | null>(null)

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
      setProgress(1)
      setBark(barkSet)
      setWorld(built)
      setSpawn({ revision: 0, position: [built.spawn[0], built.spawn[1], built.spawn[2]], yaw: site.spawnYaw })
    })
    const onLock = () => setLocked(document.pointerLockElement !== null)
    document.addEventListener('pointerlockchange', onLock)
    const unlock = () => shared.sound.unlock()
    addEventListener('pointerdown', unlock)
    addEventListener('keydown', unlock)
    return () => {
      cancelled = true
      document.removeEventListener('pointerlockchange', onLock)
      removeEventListener('pointerdown', unlock)
      removeEventListener('keydown', unlock)
      shared.sound.dispose()
    }
  }, [shared])

  const respawn = useCallback((position: [number, number, number], yaw: number) => {
    shared.command.yaw = yaw * 180 / Math.PI
    shared.command.pitch = -8
    shared.command.crouch = false
    setSpawn(previous => ({ revision: (previous?.revision ?? 0) + 1, position, yaw }))
  }, [shared])

  const onAction = useCallback((action: string) => {
    if (action === 'home' && world) respawn([world.spawn[0], world.spawn[1], world.spawn[2]], site.spawnYaw)
  }, [respawn, world])

  const api = useMemo<ProbeApi>(() => ({ respawn }), [respawn])
  const ready = world !== null && bark !== null && spawn !== null
  return <InputProvider runtime={runtime}><Screen>
    <Canvas shadows dpr={internalPixelRatio()} camera={{ fov: 55, near: 0.1, far: site.horizon[tier], position: [0, 260, 0] }} gl={{ antialias: false, powerPreference: 'high-performance' }}
      onCreated={state => { state.gl.domElement.style.filter = 'none'; attachPerfProbe(state.gl) }}>
      {ready && <Scene shared={shared} world={world} bark={bark} tier={tier} spawn={spawn} onAction={onAction} api={api} />}
    </Canvas>
    <TitleCard title={touch ? 'Valley' : 'Valley · The High Meadow'} />
    <Hints visible={!touch} items={[['WASD', 'Move'], ['Shift', 'Sprint'], ['Space', 'Jump'], ['R', 'Meadow']]} />
    <Prompt text="Click to look around · walk down the path into the forest" visible={ready && !touch && !locked} />
    {touch && ready && <TouchPad
      onMove={(x, y) => { shared.touchMove.current.right = x; shared.touchMove.current.forward = -y }}
      onLook={(dx, dy) => { shared.touchLook.current.x += dx; shared.touchLook.current.y += dy }}
      onButton={(id, pressed) => {
        if (id === 'home') { if (pressed) onAction('home'); return }
        runtime.actions.setTouchButton(id, pressed)
      }}
      buttons={[{ id: 'jump', label: 'Jump' }, { id: 'crouch', label: 'Crouch' }, { id: 'home', label: 'Home' }]} />}
    <Loading title="Valley" detail={progress < 0.5 ? 'Loading the walker' : 'Growing the forest'} progress={progress} done={ready} />
  </Screen></InputProvider>
}
