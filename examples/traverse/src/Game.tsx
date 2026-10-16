import * as THREE from 'three'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Physics, useRapier } from '@react-three/rapier'
import { InputProvider, makeInputDevices } from '@blacksite/input'
import { Look } from '@blacksite/look/r3f'
import { internalPixelRatio, isTouchDevice, texturesReady } from '@blacksite/look/world'
import { attachPerfProbe } from '@blacksite/ui/perf-overlay'
import { Hints, Loading, Prompt, Screen, TitleCard, TouchPad, useTouch } from '@blacksite/ui/hud'
import { preloadAlsCharacterGltf } from 'als-ue5-r3f/app/AlsCharacterGltf'
import { createCharacterPoseSample } from 'als-ue5-r3f/app/CharacterPoseSample'
import { createWorldTimeState } from 'als-ue5-r3f/engine/timeDilation'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { createCommand, type Command } from './controls'
import { Player, type Spawn } from './player'
import { buildRoute, type Route } from './route'
import { Atmosphere, Level, Markers, Practicals } from './world'
import { createRace, elapsed, stepRace, type Race, type RaceEvent } from './race'
import { GhostPlayer, GhostRecorder, loadTake, modelOf, saveTake, type GhostTake } from './ghost'
import { TraverseAudio } from './audio'
import { Effects, type EffectsHandle } from './fx'
import { Probe, type ProbeApi } from './probe'
import { Clock, type ClockHandle } from './hud'
import { outfit } from './outfit'
import { formatSplit, formatTime, locomotion } from './model'

const bestKey = 'blacksite.traverse.best'
const readBest = (): number[] | null => { try { const value = JSON.parse(localStorage.getItem(bestKey) ?? 'null'); return Array.isArray(value) ? value : null } catch { return null } }

type Shared = {
  route: Route
  command: Command
  pose: { current: ReturnType<typeof createCharacterPoseSample> }
  race: { current: Race }
  scripted: { current: boolean }
  touchLook: { current: { x: number; y: number } }
  touchMove: { current: { forward: number; right: number } }
  sound: TraverseAudio
  effects: { current: EffectsHandle | null }
  clock: { current: ClockHandle | null }
}

function RaceDriver({ shared, onEvent, ghostVisible }: { shared: Shared; onEvent: (event: RaceEvent, now: number) => void; ghostVisible: boolean }) {
  const { scene } = useThree()
  const recorder = useRef<GhostRecorder | null>(null)
  const ghost = useRef<GhostPlayer | null>(null)
  const pending = useRef<GhostTake | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadTake().then(take => { if (!cancelled && take) { pending.current = take; ghost.current?.load(take) } })
    return () => { cancelled = true }
  }, [])
  useEffect(() => () => { if (ghost.current) scene.remove(ghost.current.object) }, [scene])
  useFrame(({ clock }) => {
    const sample = shared.pose.current
    if (!sample.ready || !sample.rootBone) return
    if (!recorder.current || !ghost.current) {
      const model = modelOf(sample.rootBone)
      if (!model) return
      recorder.current = new GhostRecorder(model)
      ghost.current = new GhostPlayer(model)
      ghost.current.load(pending.current)
      scene.add(ghost.current.object)
    }
    const now = clock.elapsedTime
    const race = shared.race.current
    const event = stepRace(race, shared.route.gates, now, sample.pelvis.x, sample.pelvis.y, sample.pelvis.z)
    if (event?.kind === 'start') recorder.current.reset()
    if (race.state === 'running') recorder.current.sample(now - race.start)
    if (event?.kind === 'finish') {
      recorder.current.sample(now - race.start)
      if (event.record) {
        const take = recorder.current.take(event.time)
        ghost.current.load(take)
        void saveTake(take)
        localStorage.setItem(bestKey, JSON.stringify(race.best))
      }
    }
    if (event) onEvent(event, now)
    ghost.current.pose(ghostVisible && race.state === 'running' ? now - race.start : null)
    shared.clock.current?.set(elapsed(race, now), race.state)
  }, ALS_FRAME_PRIORITY.Camera + 0.1)
  return null
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

function SoundOcclusion({ sound }: { sound: TraverseAudio }) {
  const { world, rapier } = useRapier()
  useEffect(() => {
    const ray = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })
    sound.setOcclusion((listener, source) => {
      const dx = source[0] - listener[0]
      const dy = source[1] - listener[1]
      const dz = source[2] - listener[2]
      const length = Math.hypot(dx, dy, dz)
      if (length < 0.6) return false
      ray.origin = { x: listener[0], y: listener[1], z: listener[2] }
      ray.dir = { x: dx / length, y: dy / length, z: dz / length }
      return world.castRay(ray, length - 0.3, true, rapier.QueryFilterFlags.ONLY_FIXED) !== null
    })
    return () => sound.setOcclusion(null)
  }, [rapier, sound, world])
  return null
}

function Scene({ shared, spawn, onAction, onEvent, ghostVisible, api }: { shared: Shared; spawn: Spawn; onAction: (action: string) => void; onEvent: (event: RaceEvent, now: number) => void; ghostVisible: boolean; api: ProbeApi }) {
  const time = useMemo(createWorldTimeState, [])
  const [compiled, setCompiled] = useState(false)
  const done = useCallback(() => setCompiled(true), [])
  return <>
    <Atmosphere />
    {compiled ? <Look atmosphere="zone" sky={false} fog={false} /> : <Warmup onDone={done} />}
    <Physics gravity={[0, -locomotion.gravity, 0]} timeStep={locomotion.physicsStep} updatePriority={ALS_FRAME_PRIORITY.Physics}>
      <Player command={shared.command} pose={shared.pose} time={time} audio={shared.sound} spawn={spawn} scripted={shared.scripted} touchLook={shared.touchLook} touchMove={shared.touchMove} onAction={onAction} />
      <Level route={shared.route} />
      {compiled && <Probe shared={shared} api={api} />}
      <SoundOcclusion sound={shared.sound} />
    </Physics>
    <Practicals route={shared.route} />
    <Markers route={shared.route} race={shared.race} />
    <Effects route={shared.route} pose={shared.pose} handle={shared.effects} sound={shared.sound} />
    <RaceDriver shared={shared} onEvent={onEvent} ghostVisible={ghostVisible} />
  </>
}

type Banner = { title: string; detail: string; tone: 'ahead' | 'behind' | 'even'; key: number }

export function Game() {
  const runtime = useMemo(makeInputDevices, [])
  const touch = useTouch()
  const shared = useMemo<Shared>(() => {
    const route = buildRoute()
    const sound = new TraverseAudio(route, isTouchDevice() ? 'phone' : 'desktop')
    return {
      route,
      command: createCommand(route.spawnYaw),
      pose: { current: createCharacterPoseSample() },
      race: { current: createRace(readBest()) },
      scripted: { current: false },
      touchLook: { current: { x: 0, y: 0 } },
      touchMove: { current: { forward: 0, right: 0 } },
      sound,
      effects: { current: null },
      clock: { current: null },
    }
  }, [])
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0.05)
  const [locked, setLocked] = useState(false)
  const [spawn, setSpawn] = useState<Spawn>({ revision: 0, position: shared.route.spawn, yaw: shared.route.spawnYaw })
  const [banner, setBanner] = useState<Banner | null>(null)
  const [finish, setFinish] = useState<{ time: number; best: number; record: boolean } | null>(null)
  const [ghostVisible, setGhostVisible] = useState(true)
  const [checkpoint, setCheckpoint] = useState(0)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      preloadAlsCharacterGltf(undefined, { onProgress: value => { if (!cancelled && value !== undefined) setProgress(0.05 + value * 0.85) } }).then(outfit),
      texturesReady(),
      new Promise<void>(resolve => setTimeout(() => { shared.sound.prepare(); resolve() }, 0)),
    ]).then(() => { if (!cancelled) { setProgress(1); setReady(true) } })
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
    shared.command.pitch = -12
    shared.command.crouch = false
    setSpawn(previous => ({ revision: previous.revision + 1, position, yaw }))
  }, [shared])

  const restart = useCallback(() => {
    shared.race.current = createRace(shared.race.current.best)
    setFinish(null)
    setBanner(null)
    setCheckpoint(0)
    respawn(shared.route.spawn, shared.route.spawnYaw)
  }, [respawn, shared])

  const onAction = useCallback((action: string) => {
    if (action === 'restart') restart()
    else if (action === 'ghost') setGhostVisible(value => !value)
    else if (action === 'checkpoint') {
      const race = shared.race.current
      if (race.state !== 'running') { restart(); return }
      const gate = shared.route.gates[Math.max(0, race.next - 1)]!
      respawn([gate.at[0] + 1, gate.at[1] - gate.half[1], gate.at[2]], gate.yaw)
    }
  }, [respawn, restart, shared])

  const onEvent = useCallback((event: RaceEvent, now: number) => {
    const effects = shared.effects.current
    const gates = shared.route.gates
    if (event.kind === 'start') { shared.sound.play('start'); setCheckpoint(0); return }
    if (event.kind === 'split') {
      shared.sound.play('checkpoint', 1, event.index)
      effects?.flash(gates[event.index + 1]!.at)
      setCheckpoint(event.index + 1)
      setBanner({ title: gates[event.index + 1]!.name, detail: event.delta === null ? formatTime(event.time) : formatSplit(event.delta), tone: event.delta === null ? 'even' : event.delta < 0 ? 'ahead' : 'behind', key: now })
      return
    }
    shared.sound.play(event.record ? 'record' : 'finish')
    effects?.flash(gates[gates.length - 1]!.at)
    setCheckpoint(gates.length - 1)
    const best = shared.race.current.best
    setFinish({ time: event.time, best: best ? best[best.length - 1]! : event.time, record: event.record })
  }, [shared])

  useEffect(() => {
    if (!banner) return
    const timer = setTimeout(() => setBanner(null), 2200)
    return () => clearTimeout(timer)
  }, [banner])

  const api = useMemo<ProbeApi>(() => ({ respawn, restart }), [respawn, restart])
  const total = shared.route.gates.length - 1
  return <InputProvider runtime={runtime}><Screen>
    <Canvas shadows dpr={internalPixelRatio()} camera={{ fov: 60, near: 0.1, far: 600, position: [-4, 2, 0] }} gl={{ antialias: false, powerPreference: 'high-performance' }}
      onCreated={state => { state.gl.domElement.style.filter = 'none'; attachPerfProbe(state.gl) }}>
      {ready && <Scene shared={shared} spawn={spawn} onAction={onAction} onEvent={onEvent} ghostVisible={ghostVisible} api={api} />}
    </Canvas>
    <TitleCard title="Traverse · The Block" />
    <Clock handle={shared.clock} checkpoint={checkpoint} total={total} best={shared.race.current.best} banner={banner} finish={finish} touch={touch} />
    <Hints visible={!touch && !finish} items={[['WASD', 'Move'], ['Shift', 'Sprint · tap roll'], ['Space', 'Mantle'], ['C', 'Shoulder'], ['R', 'Restart']]} />
    <Prompt text="Click to look around · run through the gate to start the clock" visible={ready && !touch && !locked} />
    {touch && ready && <TouchPad
      onMove={(x, y) => { shared.touchMove.current.right = x; shared.touchMove.current.forward = -y }}
      onLook={(dx, dy) => { shared.touchLook.current.x += dx; shared.touchLook.current.y += dy }}
      onButton={(id, pressed) => {
        if (id === 'restart') { if (pressed) restart(); return }
        runtime.actions.setTouchButton(id, pressed)
      }}
      buttons={[{ id: 'jump', label: 'Jump' }, { id: 'sprint', label: 'Sprint' }, { id: 'roll', label: 'Roll' }, { id: 'crouch', label: 'Crouch' }, { id: 'shoulder', label: 'Shoulder' }, { id: 'restart', label: 'Restart' }]} />}
    <Loading title="Traverse" detail={progress < 0.9 ? 'Loading the runner' : 'Pouring the concrete'} progress={progress} done={ready} />
  </Screen></InputProvider>
}

export type { Shared }
