import { Suspense, useEffect, useMemo, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Physics, CuboidCollider, RigidBody } from '@react-three/rapier'
import { Character } from 'als-ue5-r3f/app/Character'
import { AlsCamera } from 'als-ue5-r3f/app/AlsCamera'
import { AlsRemoteActor } from 'als-ue5-r3f/app/AlsRemoteActor'
import { AlsSnapshotBuffer } from 'als-ue5-r3f/als/AlsSnapshotBuffer'
import { createWorldTimeState } from 'als-ue5-r3f/engine/timeDilation'
import { AlsFootstepAudioRuntime } from 'als-ue5-r3f/engine/alsAudioBridge'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { ArmsViewmodel, createArmsState } from '@blacksite/subject-fpp/arms'
import { ALS_WEAPONS, createWeaponRuntime } from '@blacksite/armory'
import { createWorld, trait } from 'koota'
import { Subject, createSubject } from './index'
import type { PawnState, Connection } from '@blacksite/relay'
import { createReplica, createLoopbackRoom } from '@blacksite/relay'
import { createSubjectInputSource, type CameraMode } from './controller'
import { useSubjectSpawn } from './spawn'

const Controller = trait({ pawn: '' })
const Pawn = trait({ owner: '', x: 0, y: 0, z: 0 })
const Intent = trait({ forward: 0, right: 0, jump: false })

const noHits = { castRay: () => null, sweepSphere: () => null }
type AnimationClock = { readonly elapsedSeconds: number; readonly updates: number }
type ClockSample = { seconds: number; updates: number; wallSeconds: number; rate: number }
type Diagnostics = {
  clocks: Record<string, ClockSample>
  arms: Record<string, unknown>
  speed: number
  gait: string
  locked: boolean
  keys: string[]
  command: Record<string, unknown>
  position: number[]
  locomotionMode: string | null
}

function RemotePawn({ state, onClock }: { state: PawnState; onClock: (id: string, clock: AnimationClock) => void }) {
  const buffer = useMemo(() => new AlsSnapshotBuffer({ interpolationDelayMs: 100 }), [])
  useEffect(() => { buffer.push({
    t: state.t, pos: [state.position.x, state.position.y + 0.9, state.position.z],
    vel: [state.velocity.x, state.velocity.y, state.velocity.z],
    actorYaw: state.yaw, viewYaw: state.yaw, viewPitch: state.pitch,
    gait: Math.hypot(state.velocity.x, state.velocity.z) > 4 ? 'sprinting' : 'running',
    stance: 'standing', rotationMode: 'viewDirection', locomotionMode: 'grounded',
    action: 'none', actionSeq: 0, overlay: state.weapon === 'pistol' ? 'pistol' : 'rifle', aiming: state.aiming ?? false, seq: state.seq,
  }) }, [buffer, state])
  return <Suspense fallback={null}><AlsRemoteActor snapshots={buffer} now={Date.now} onAnimationClock={clock => onClock(`remote:${state.id}`, clock)} /></Suspense>
}

function NetworkScene({ connection, offline, cameraMode, onStatus, onDiagnostics }: { connection: Connection; offline: boolean; cameraMode: CameraMode; onStatus: (status: { room: string; players: number; hits: number; view: string }) => void; onDiagnostics?: (value: Diagnostics) => void }) {
  const subject = useMemo(() => createSubject({ cameraMode }), [cameraMode])
  const inputSource = useMemo(() => createSubjectInputSource(subject), [subject])
  const controlRotationSource = useMemo(() => () => ({ yaw: subject.player.command.yaw, pitch: subject.player.command.pitch }), [subject])
  const arms = useMemo(createArmsState, [])
  const weapon = useMemo(() => createWeaponRuntime({ ownerId: connection.id, seed: 1, definitions: ALS_WEAPONS.slice(0, 2) }), [connection.id])
  const weaponStep = useMemo(() => ({ accumulated: 0, reloadSequence: 0, shotSequence: 0, weaponSequence: 0 }), [])
  const telemetry = useMemo(() => {
    const origins = new Map<string, { clock: AnimationClock; seconds: number; updates: number; wall: number }>()
    const clocks: Record<string, ClockSample> = {}
    return { clocks, record(id: string, clock: AnimationClock) {
      const now = performance.now()
      let origin = origins.get(id)
      if (!origin || origin.clock !== clock || clock.elapsedSeconds < origin.seconds) {
        origin = { clock, seconds: clock.elapsedSeconds, updates: clock.updates, wall: now }
        origins.set(id, origin)
      }
      const seconds = clock.elapsedSeconds - origin.seconds
      const wallSeconds = (now - origin.wall) / 1000
      clocks[id] = { seconds, updates: clock.updates - origin.updates, wallSeconds, rate: wallSeconds > 0 ? seconds / wallSeconds : 1 }
    } }
  }, [])
  const replica = useMemo(() => createReplica(connection, state => {
    const local = subject.frame.position
    if (local.distanceToSquared(state.position) > 4) subject.respawn([state.position.x, state.position.y, state.position.z], state.yaw)
  }), [connection, subject])
  const world = useMemo(createWorld, [])
  const controller = useMemo(() => world.spawn(Controller({ pawn: connection.id })), [world, connection.id])
  const pawn = useMemo(() => world.spawn(Pawn({ owner: connection.id }), Intent), [world, connection.id])
  const worldTime = useMemo(createWorldTimeState, [])
  const audio = useMemo(() => new AlsFootstepAudioRuntime({ AutoInstallUserGestureUnlock: true }), [])
  const [players, setPlayers] = useState<PawnState[]>([])
  const spawn = useSubjectSpawn(subject.player)
  const [hits, setHits] = useState(0)
  const [view, setView] = useState<'first-person' | 'third-person'>('first-person')
  const [status, setStatus] = useState(offline ? 'Offline room' : 'Online room')
  useEffect(() => onStatus({ room: status, players: players.length, hits, view }), [onStatus, status, players.length, hits, view])
  useEffect(() => {
    const update = () => setPlayers([...replica.states.values()])
    const applySpawn = (own: PawnState | undefined) => {
      if (!own || own.position.x === subject.player.spawn[0] && own.position.y === subject.player.spawn[1] && own.position.z === subject.player.spawn[2]) return
      const next = [own.position.x, own.position.y, own.position.z] as const
      subject.respawn(next, own.yaw)
    }
    const unsubscribe = replica.onMessage(message => {
      if (message.type === 'welcome') applySpawn(message.states.find(state => state.id === connection.id))
      update()
      if (message.type === 'hit' && message.shooter === connection.id) setHits(value => value + 1)
      if (message.type === 'rejected') setStatus(message.reason)
    })
    applySpawn(replica.states.get(connection.id))
    update()
    return () => { unsubscribe(); replica.close(); controller.destroy(); pawn.destroy(); world.reset() }
  }, [replica, connection.id, controller, pawn, world, subject])
  useEffect(() => subject.subscribe(() => setView(subject.view)), [subject])
  useEffect(() => () => weapon.dispose(), [weapon])
  useEffect(() => {
    if (!onDiagnostics) return
    const timer = setInterval(() => onDiagnostics({
      clocks: { ...telemetry.clocks },
      arms: { ...arms.debug },
      speed: Math.hypot(subject.frame.velocity.x, subject.frame.velocity.z),
      gait: subject.player.pose.current.character?.gait ?? 'loading',
      locked: subject.frame.locked,
      keys: [...subject.keys],
      command: { ...subject.player.command },
      position: subject.frame.position.toArray(),
      locomotionMode: subject.player.pose.current.character?.locomotionMode ?? null,
    }), 250)
    return () => clearInterval(timer)
  }, [onDiagnostics, telemetry, arms, subject])
  useFrame((_, dt) => {
    if (!subject.frame.ready) return
    const clock = subject.player.pose.current.animationClock
    if (clock) telemetry.record('local', clock)
    const frame = subject.frame
    const selectedWeapon = subject.weapon === 'pistol' ? 'pistol' : 'rifle'
    weaponStep.accumulated += dt
    while (weaponStep.accumulated >= weapon.fixedDeltaSeconds) {
      weaponStep.accumulated -= weapon.fixedDeltaSeconds
      const events = weapon.step({
        tick: weapon.snapshot().nextTick,
        trigger: subject.enabled && subject.frame.locked && subject.input.fire,
        reload: subject.input.reloadSequence !== weaponStep.reloadSequence,
        selectWeaponId: selectedWeapon,
        aim: { origin: frame.aimOrigin, direction: frame.aimDirection },
        muzzle: frame.muzzlePosition,
      }, noHits)
      weaponStep.reloadSequence = subject.input.reloadSequence
      for (const event of events) {
        if (event.type === 'shot') {
          arms.fireSequence++
          subject.addRecoil(event.recoil.pitch * 180 / Math.PI, event.recoil.yaw * 180 / Math.PI)
          replica.send({ type: 'fire', seq: ++weaponStep.shotSequence, direction: { ...event.direction } })
        }
        if (event.type === 'reload-started') {
          arms.reloadSequence++
          replica.send({ type: 'weapon', seq: ++weaponStep.weaponSequence, weapon: selectedWeapon, reload: true })
        }
        if (event.type === 'switch-started') replica.send({ type: 'weapon', seq: ++weaponStep.weaponSequence, weapon: selectedWeapon, reload: false })
      }
    }
    arms.weapon = selectedWeapon
    arms.aiming = frame.aiming
    arms.speed = Math.hypot(frame.velocity.x, frame.velocity.z)
    arms.sprinting = frame.sprinting
  }, -0.01)
  const next = useMemo(() => ({ seq: 0, last: 0 }), [])
  useFrame(() => {
    if (!subject.frame.ready || performance.now() - next.last < 50) return
    next.last = performance.now()
    const frame = subject.frame
    const position = { x: frame.position.x, y: frame.position.y, z: frame.position.z }
    const velocity = { x: frame.velocity.x, y: frame.velocity.y, z: frame.velocity.z }
    pawn.set(Pawn, { owner: connection.id, ...position })
    const command = subject.player.command
    const intent = { forward: command.forward, right: command.right, jump: false, yaw: command.yaw, pitch: command.pitch, aiming: command.aim }
    pawn.set(Intent, { forward: intent.forward, right: intent.right, jump: intent.jump })
    if (controller.get(Controller)?.pawn !== connection.id) return
    replica.send({ type: 'move', seq: ++next.seq, position, velocity, intent })
  })
  return <>
    <ambientLight intensity={1.5} /><directionalLight position={[5, 12, 4]} intensity={2.5} />
    <Physics gravity={[0, -9.8, 0]} timeStep={1 / 60} updatePriority={ALS_FRAME_PRIORITY.Physics}>
      <group visible={view === 'third-person'}><Character showDebugControls={false} key={spawn.revision} initialPosition={spawn.position} poseSample={subject.player.pose} worldTime={worldTime} footstepSoundSink={audio} onSizeChange={() => {}} onOverlayModeBridgeChange={() => {}} inputEnabled={false} inputSource={inputSource} /></group>
      <AlsCamera poseSample={subject.player.pose} worldTime={worldTime} footstepAudioRuntime={audio} toggleViewModeKey={null} controlRotationSource={controlRotationSource} />
      <RigidBody type="fixed" colliders={false}><CuboidCollider args={[30, 0.1, 30]} position={[0, -0.1, 0]} /></RigidBody>
      {players.filter(player => player.id !== connection.id).map(player => <RemotePawn key={player.id} state={player} onClock={telemetry.record} />)}
    </Physics>
    <Subject controller={subject} /><Suspense fallback={null}><ArmsViewmodel state={arms} visible={view === 'first-person'} /></Suspense>
    <mesh rotation-x={-Math.PI / 2} position-y={-0.01}><planeGeometry args={[60, 60]} /><meshStandardMaterial color="#293743" /></mesh>
    <gridHelper args={[60, 30, '#506d77', '#394c58']} />
  </>
}

export function MultiplayerSubject({ connection, offline = false, cameraMode = 'switchable' }: { connection: Connection; offline?: boolean; cameraMode?: CameraMode }) {
  const [status, setStatus] = useState({ room: offline ? 'Offline room' : 'Online room', players: 0, hits: 0, view: 'first-person' })
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null)
  const debug = new URLSearchParams(window.location.search).has('debug')
  return <><Canvas camera={{ position: [0, 1.63, 0], fov: 75 }}><NetworkScene connection={connection} offline={offline} cameraMode={cameraMode} onStatus={setStatus} onDiagnostics={debug ? setDiagnostics : undefined} /></Canvas><div className="hud"><strong>{status.room} · {status.view}</strong><span>Players: {status.players} · Hits: {status.hits}</span><span>Click scene · WASD move · {cameraMode === 'switchable' ? 'V switch view · ' : ''}1 rifle · 2 pistol · RMB aim · LMB fire · R reload</span></div><div className="reticle">+</div>{debug && <pre data-mp-debug style={{ position: 'absolute', bottom: 12, left: 12, margin: 0, padding: 10, fontSize: 10, color: '#fff', background: '#000b', pointerEvents: 'none' }}>{JSON.stringify(diagnostics, null, 2)}</pre>}</>
}

export function LoopbackSplitView({ cameraMode = 'switchable' }: { cameraMode?: CameraMode }) {
  const [peers, setPeers] = useState<Connection[]>([])
  useEffect(() => {
    const room = createLoopbackRoom()
    let active = true
    let joined: Connection[] = []
    void Promise.all([room.connect(), room.connect()]).then(connections => {
      joined = connections
      if (active) setPeers(connections)
      else connections.forEach(connection => connection.close())
    })
    return () => { active = false; joined.forEach(connection => connection.close()) }
  }, [])
  return <div style={{ display: 'flex', width: '100%', height: '100%' }}>{peers.map(peer => <div key={peer.id} style={{ position: 'relative', width: '50%', height: '100%' }}><MultiplayerSubject connection={peer} offline cameraMode={cameraMode} /></div>)}</div>
}
