import * as THREE from 'three'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Physics, useRapier } from '@react-three/rapier'
import { InputProvider, glyphText, useInputSource } from '@blacksite/input'
import { Look } from '@blacksite/look/r3f'
import { internalPixelRatio, isTouchDevice, texturesReady } from '@blacksite/look/world'
import { autoQuality, depthDefaults } from '@blacksite/look/quality'
import { attachPerfProbe } from '@blacksite/ui/perf-overlay'
import { Loading, Screen, TitleCard } from '@blacksite/ui/hud'
import { CharacterController, CharacterOverlay, CharacterPause, useCharacterStatus, useLocalSession, useTouchActive, type CharacterEvents, type CharacterHandle } from '@blacksite/subject'
import { preloadAlsCharacterGltf } from 'als-ue5-r3f/app/AlsCharacterGltf'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { TRAVERSE_GLYPHS, TRAVERSE_HINTS, createRunner, yawOf } from './runner'
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
import creditsUrl from '../CREDITS.md?url'

const bestKey = 'blacksite.traverse.best'
const readBest = (): number[] | null => { try { const value = JSON.parse(localStorage.getItem(bestKey) ?? 'null'); return Array.isArray(value) ? value : null } catch { return null } }

type Shared = {
  route: Route
  runner: CharacterHandle
  race: { current: Race }
  sound: TraverseAudio
  ghost: { current: GhostPlayer | null }
  effects: { current: EffectsHandle | null }
  clock: { current: ClockHandle | null }
}

function RaceDriver({ shared, now: clock, onEvent, ghostVisible }: { shared: Shared; now: () => number; onEvent: (event: RaceEvent, now: number) => void; ghostVisible: boolean }) {
  const { scene } = useThree()
  const recorder = useRef<GhostRecorder | null>(null)
  const ghost = shared.ghost
  const pending = useRef<GhostTake | null>(null)
  const sourceRoot = useRef<THREE.Object3D | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadTake().then(take => { if (!cancelled && take) { pending.current = take; ghost.current?.load(take) } })
    return () => { cancelled = true }
  }, [])
  useEffect(() => () => { ghost.current?.dispose() }, [scene])
  useFrame(() => {
    const sample = shared.runner.als.pose.current
    if (!sample.ready || !sample.rootBone) return
    if (sourceRoot.current !== sample.rootBone || !recorder.current || !ghost.current) {
      const model = modelOf(sample.rootBone)
      if (!model) return
      if (recorder.current) recorder.current.bind(model)
      else recorder.current = new GhostRecorder(model)
      if (!ghost.current) {
        ghost.current = new GhostPlayer(model)
        ghost.current.load(pending.current)
        scene.add(ghost.current.object)
      }
      sourceRoot.current = sample.rootBone
    }
    const now = clock() / 1000
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

function Warmup({ shared, onDone }: { shared: Shared; onDone: () => void }) {
  const { gl, scene, camera } = useThree()
  useFrame(() => {}, 1)
  useEffect(() => {
    let cancelled = false
    let frame = 0
    const compile = () => {
      const ghost = shared.ghost.current?.object
      if (!ghost || !shared.runner.als.pose.current.ready) { frame = requestAnimationFrame(compile); return }
      const visible = ghost.visible
      ghost.visible = true
      void gl.compileAsync(scene, camera).then(() => {
        ghost.visible = visible
        if (cancelled) return
        scene.traverse(object => {
          const material = (object as THREE.Mesh).material
          for (const entry of Array.isArray(material) ? material : material ? [material] : []) {
            for (const value of Object.values(entry)) if (value instanceof THREE.Texture) gl.initTexture(value)
          }
        })
        onDone()
      })
    }
    frame = requestAnimationFrame(compile)
    return () => { cancelled = true; cancelAnimationFrame(frame) }
  }, [gl, scene, camera, shared, onDone])
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

const Scene = memo(function Scene({ shared, now, events, onEvent, ghostVisible, api }: { shared: Shared; now: () => number; events: CharacterEvents; onEvent: (event: RaceEvent, now: number) => void; ghostVisible: boolean; api: ProbeApi }) {
  const [compiled, setCompiled] = useState(false)
  const done = useCallback(() => setCompiled(true), [])
  return <>
    <Atmosphere />
    {compiled ? <Look atmosphere="zone" sky={false} fog={false} /> : <Warmup shared={shared} onDone={done} />}
    <Physics gravity={[0, -locomotion.gravity, 0]} timeStep={locomotion.physicsStep} updatePriority={ALS_FRAME_PRIORITY.Physics}>
      <CharacterController controller={shared.runner} events={events} />
      <Level route={shared.route} />
      {compiled && <Probe shared={shared} api={api} />}
      <SoundOcclusion sound={shared.sound} />
    </Physics>
    <Practicals route={shared.route} />
    <Markers route={shared.route} race={shared.race} />
    <Effects route={shared.route} pose={shared.runner.als.pose} handle={shared.effects} sound={shared.sound} />
    <RaceDriver shared={shared} now={now} onEvent={onEvent} ghostVisible={ghostVisible} />
  </>
})

type Banner = { title: string; detail: string; tone: 'ahead' | 'behind' | 'even'; key: number }

export function Game() {
  const shared = useMemo<Shared>(() => {
    const route = buildRoute()
    const sound = new TraverseAudio(route, isTouchDevice() ? 'phone' : 'desktop')
    return {
      route,
      runner: createRunner(route),
      race: { current: createRace(readBest()) },
      sound,
      ghost: { current: null },
      effects: { current: null },
      clock: { current: null },
    }
  }, [])
  return <InputProvider runtime={shared.runner.input}><Shell shared={shared} /></InputProvider>
}

function Shell({ shared }: { shared: Shared }) {
  const runner = shared.runner
  const touch = useTouchActive()
  const status = useCharacterStatus(runner)
  const session = useLocalSession(runner)
  const { device, gamepadLayout } = useInputSource()
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0.05)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [finish, setFinish] = useState<{ time: number; best: number; record: boolean } | null>(null)
  const [ghostVisible, setGhostVisible] = useState(true)
  const [checkpoint, setCheckpoint] = useState(0)
  const [racing, setRacing] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      preloadAlsCharacterGltf(undefined, { onProgress: value => { if (!cancelled && value !== undefined) setProgress(0.05 + value * 0.85) } }).then(outfit),
      texturesReady(),
      Promise.resolve().then(() => shared.sound.prepare()),
    ]).then(() => { if (!cancelled) { setProgress(1); setReady(true) } })
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

  const respawn = useCallback((position: [number, number, number], heading: number) => runner.teleport(position, yawOf(heading)), [runner])

  const restart = useCallback(() => {
    shared.race.current = createRace(shared.race.current.best)
    setFinish(null)
    setBanner(null)
    setCheckpoint(0)
    setRacing(false)
    runner.respawn()
  }, [runner, shared])

  const onAction = useCallback((action: string) => {
    if (action === 'restart') restart()
    else if (action === 'ghost') setGhostVisible(value => !value)
    else if (action === 'checkpoint') {
      const race = shared.race.current
      if (race.state !== 'running') { restart(); return }
      const index = Math.max(0, race.next - 1)
      respawn(shared.route.respawns[index]!, shared.route.gates[index]!.yaw)
    }
  }, [respawn, restart, shared])

  const onEvent = useCallback((event: RaceEvent, now: number) => {
    const effects = shared.effects.current
    const gates = shared.route.gates
    if (event.kind === 'start') { shared.sound.play('start'); setCheckpoint(0); setRacing(true); return }
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

  const events = useMemo<CharacterEvents>(() => ({ onFootstep: request => shared.sound.PlayFootstepSound(request), onAction }), [onAction, shared])
  const api = useMemo<ProbeApi>(() => ({ respawn, restart }), [respawn, restart])
  const total = shared.route.gates.length - 1
  const glyph = (action: string) => glyphText(TRAVERSE_GLYPHS[action]!, device, gamepadLayout)
  const retry = touch ? 'Tap Retry to race your ghost' : `${glyph('restart')} to race your ghost · ${glyph('ghost')} hides it`
  return <Screen>
    <Canvas frameloop={session.frameloop} shadows dpr={internalPixelRatio()} camera={{ fov: 60, ...depthDefaults(autoQuality(), { far: 600 }).camera, position: [-4, 2, 0] }} gl={{ antialias: false, powerPreference: 'high-performance' }}
      onCreated={state => { state.gl.domElement.style.filter = 'none'; attachPerfProbe(state.gl) }}>
      {ready && <Scene shared={shared} now={session.now} events={events} onEvent={onEvent} ghostVisible={ghostVisible} api={api} />}
    </Canvas>
    <TitleCard title={touch ? 'Traverse' : 'Traverse · The Block'} />
    <a className="tr-credits" href={creditsUrl} target="_blank" rel="noreferrer">Credits</a>
    <Clock handle={shared.clock} checkpoint={checkpoint} total={total} best={shared.race.current.best} banner={banner} finish={finish} touch={touch} retry={retry} />
    {ready && <CharacterOverlay controller={runner} visible={!finish} glyphs={TRAVERSE_GLYPHS} hints={TRAVERSE_HINTS}
      prompt={racing ? 'Click to look around' : 'Click to look around · run through the gate to start the clock'}
      buttons={[{ id: 'jump', label: 'Jump' }, { id: 'roll', label: 'Roll' }, { id: 'crouch', label: 'Crouch' }, { id: 'shoulder', label: 'Shoulder' }, { id: 'ragdoll', label: 'Fall / up' }, { id: 'checkpoint', label: 'Retry' }]} />}
    {status.paused && <CharacterPause controller={runner} items={[
      { id: 'checkpoint', label: 'Back to last checkpoint', onPress: () => onAction('checkpoint') },
      { id: 'restart', label: 'Restart the run', onPress: restart },
      { id: 'ghost', label: ghostVisible ? 'Ghost off' : 'Ghost on', onPress: () => setGhostVisible(value => !value) },
    ]} />}
    <Loading title="Traverse" detail={progress < 0.9 ? 'Loading the runner' : 'Pouring the concrete'} progress={progress} done={ready} />
  </Screen>
}

export type { Shared }
