import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame, type RootState } from '@react-three/fiber'
import { Physics, CuboidCollider, RigidBody, useRapier } from '@react-three/rapier'
import { Vector3 } from 'three'
import { Character, type CharacterProps } from 'als-ue5-r3f/app/Character'
import { AlsCamera } from 'als-ue5-r3f/app/AlsCamera'
import { AlsRemoteActor, type AlsRagdollHandle } from 'als-ue5-r3f/app/AlsRemoteActor'
import { AlsSnapshotBuffer } from 'als-ue5-r3f/als/AlsSnapshotBuffer'
import type { AlsCharacterSnapshot } from 'als-ue5-r3f/als/AlsCharacterSnapshot'
import { createWorldTimeState } from 'als-ue5-r3f/engine/timeDilation'
import { AlsFootstepAudioRuntime } from 'als-ue5-r3f/engine/alsAudioBridge'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { ArmsViewmodel, createArmsState, type ArmsPresentation, type ArmsState } from '@blacksite/subject-fpp/arms'
import { ALS_WEAPONS, createWeaponRuntime, type WeaponRuntime } from '@blacksite/armory'
import { createWorld, trait } from 'koota'
import { Subject, createSubject } from './index'
import type { PawnState, Connection, ServerMessage } from '@blacksite/relay'
import { createReplica, createLoopbackRoom, shotOrigin } from '@blacksite/relay'
import { createSubjectInputSource, hasControl, type CameraMode, type FpsView, type SubjectState } from './controller'
import { useSubjectSpawn } from './spawn'
import { createMultiplayerSession } from './multiplayer-session'
import { createPawnMoveMessage, toAlsRemoteSnapshot } from './remote-snapshot'

const Controller = trait({ pawn: '' })
const Pawn = trait({ owner: '', x: 0, y: 0, z: 0 })
const Intent = trait({ forward: 0, right: 0, jump: false })
const DEFAULT_SPAWN = [0, 0, 0] as const
const LOOPBACK_SPAWNS = [[0, 0, 0], [3, 0, 0]] as const
export const REMOTE_INTERPOLATION_MS = 100
export const SNAPSHOT_RATE_HZ = 20

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
  spawn: number[]
  spawnRevision: number
  rigidBodyPosition: { x: number; y: number; z: number } | null
  replicaPosition: { x: number; y: number; z: number } | null
  initialServerSpawn: { x: number; y: number; z: number } | null
}

export type MultiplayerReplica = ReturnType<typeof createReplica>
export type MultiplayerStatus = { room: string; players: number; hits: number; view: FpsView; health: number; alive: boolean }
export type MultiplayerShot = { origin: Vector3; direction: Vector3; point: Vector3 | null }

export interface MultiplayerSceneProps {
  connection: Connection
  offline?: boolean
  cameraMode?: CameraMode
  subject?: SubjectState
  initialSpawn?: readonly [number, number, number]
  onArmsPresentation?: (presentation: ArmsPresentation | null) => void
  input?: 'dom' | 'external'
  gaitSpeedOverrides?: CharacterProps['gaitSpeedOverrides']
  footsteps?: Pick<AlsFootstepAudioRuntime, 'PlayFootstepSound' | 'SetListenerTransform'>
  children?: ReactNode
  onReplica?: (replica: MultiplayerReplica | null) => void
  onStatus?: (status: MultiplayerStatus) => void
  onShot?: (shot: MultiplayerShot) => void
  onDiagnostics?: (value: Diagnostics) => void
  physicsProbe?: ReactNode
}

const deathImpulse = (direction: { x: number; y: number; z: number } | undefined, point?: { x: number; y: number; z: number }) => ({
  boneName: 'spine_03',
  impulse: { x: (direction?.x ?? 0) * 70, y: 25, z: (direction?.z ?? 0) * 70 },
  location: point && { ...point },
})

function RemotePawn({ id, life, replica, onClock }: { id: string; life: number; replica: MultiplayerReplica; onClock: (id: string, clock: AnimationClock) => void }) {
  const buffer = useMemo(() => new AlsSnapshotBuffer({ interpolationDelayMs: REMOTE_INTERPOLATION_MS }), [])
  const ragdoll = useRef<AlsRagdollHandle | null>(null)
  useEffect(() => {
    let last: PawnState | undefined
    const push = (state: PawnState | undefined) => {
      if (!state || state === last || (state.life ?? 0) !== life) return
      last = state
      buffer.push(toAlsRemoteSnapshot(state))
    }
    push(replica.states.get(id))
    return replica.onMessage(message => {
      if (message.type === 'state' && message.state.id === id) push(message.state)
      if (message.type === 'hit' && message.target === id && message.health <= 0 && ragdoll.current && !ragdoll.current.active) ragdoll.current.StartRagdolling({ initialImpulse: deathImpulse(message.direction, message.point) })
    })
  }, [buffer, replica, id, life])
  const clock = useCallback((value: AnimationClock) => onClock(`remote:${id}`, value), [onClock, id])
  return <Suspense fallback={null}><AlsRemoteActor snapshots={buffer} now={Date.now} ragdollRef={ragdoll} onAnimationClock={clock} onUnsupportedState={() => {}} /></Suspense>
}

const remoteKeys = (replica: MultiplayerReplica, self: string) => [...replica.states.values()].filter(state => state.id !== self).map(state => `${state.id}#${state.life ?? 0}`).sort()

function WeaponDriver({ subject, replica, weapon, arms, alive, onShot }: { subject: SubjectState; replica: MultiplayerReplica; weapon: WeaponRuntime; arms: ArmsState; alive: { current: boolean }; onShot?: (shot: MultiplayerShot) => void }) {
  const { world, rapier } = useRapier()
  const step = useMemo(() => ({ accumulated: 0, reloadSequence: 0, shotSequence: 0, weaponSequence: 0 }), [])
  const scratch = useMemo(() => ({ direction: new Vector3(), origin: new Vector3(), point: new Vector3(), server: new Vector3() }), [])
  useFrame((_, dt) => {
    if (!subject.frame.ready) return
    const frame = subject.frame
    const selectedWeapon = subject.weapon === 'pistol' ? 'pistol' : 'rifle'
    step.accumulated += dt
    while (step.accumulated >= weapon.fixedDeltaSeconds) {
      step.accumulated -= weapon.fixedDeltaSeconds
      const events = weapon.step({
        tick: weapon.snapshot().nextTick,
        trigger: alive.current && subject.enabled && hasControl(subject) && subject.input.fire,
        reload: subject.input.reloadSequence !== step.reloadSequence,
        selectWeaponId: selectedWeapon,
        aim: { origin: frame.aimOrigin, direction: frame.aimDirection },
        muzzle: frame.muzzlePosition,
      }, noHits)
      step.reloadSequence = subject.input.reloadSequence
      for (const event of events) {
        if (event.type === 'shot') {
          arms.fireSequence++
          subject.addRecoil(event.recoil.pitch * 180 / Math.PI, event.recoil.yaw * 180 / Math.PI)
          scratch.direction.set(event.direction.x, event.direction.y, event.direction.z)
          const ray = new rapier.Ray(frame.aimOrigin, scratch.direction)
          const hit = world.castRay(ray, 250, true, undefined, undefined, undefined, undefined, collider => !frame.ownerColliderHandles.has(collider.handle))
          const point = hit ? scratch.point.copy(frame.aimOrigin).addScaledVector(scratch.direction, hit.timeOfImpact) : null
          const own = replica.states.get(replica.id)
          let direction = event.direction
          if (own) {
            const origin = shotOrigin(own)
            scratch.server.copy(point ?? scratch.point.copy(frame.aimOrigin).addScaledVector(scratch.direction, 250)).sub(scratch.origin.set(origin.x, origin.y, origin.z))
            if (scratch.server.lengthSq() > 0.25) {
              scratch.server.normalize()
              if (scratch.server.dot(scratch.direction) > 0.7) direction = { x: scratch.server.x, y: scratch.server.y, z: scratch.server.z }
            }
          }
          replica.send({ type: 'fire', seq: ++step.shotSequence, direction: { ...direction } })
          onShot?.({ origin: frame.muzzlePosition.clone(), direction: scratch.direction.clone(), point: point && point.clone() })
        }
        if (event.type === 'reload-started') {
          arms.reloadSequence++
          replica.send({ type: 'weapon', seq: ++step.weaponSequence, weapon: selectedWeapon, reload: true })
        }
        if (event.type === 'switch-started') replica.send({ type: 'weapon', seq: ++step.weaponSequence, weapon: selectedWeapon, reload: false })
      }
    }
    arms.weapon = selectedWeapon
    arms.aiming = frame.aiming
    arms.speed = Math.hypot(frame.velocity.x, frame.velocity.z)
    arms.sprinting = frame.sprinting
  }, -0.01)
  return null
}

export function MultiplayerScene(props: MultiplayerSceneProps) {
  const { connection, cameraMode = 'switchable', initialSpawn = DEFAULT_SPAWN, onReplica } = props
  const owned = useMemo(() => props.subject ? null : createSubject({ cameraMode, spawn: initialSpawn }), [props.subject, cameraMode, initialSpawn])
  const subject = props.subject ?? owned!
  const session = useMemo(() => createMultiplayerSession(connection, subject), [connection, subject])
  const [mounted, setMounted] = useState<{ session: typeof session; replica: MultiplayerReplica } | null>(null)
  useEffect(() => session.connect(replica => setMounted({ session, replica })), [session])
  const replica = mounted?.session === session ? mounted.replica : null
  useEffect(() => {
    onReplica?.(replica)
    return () => onReplica?.(null)
  }, [onReplica, replica])
  return replica ? <Suspense fallback={null}><ReplicatedScene {...props} subject={subject} replica={replica} /></Suspense> : null
}

function ReplicatedScene({ connection, offline = false, onStatus, onDiagnostics, onShot, physicsProbe, onArmsPresentation, input = 'dom', gaitSpeedOverrides, footsteps, children, subject, replica }: MultiplayerSceneProps & { subject: SubjectState; replica: MultiplayerReplica }) {
  const inputSource = useMemo(() => createSubjectInputSource(subject), [subject])
  const controlRotationSource = useMemo(() => () => ({ yaw: subject.player.command.yaw, pitch: subject.player.command.pitch }), [subject])
  const arms = useMemo(createArmsState, [])
  const weapon = useMemo(() => createWeaponRuntime({ ownerId: connection.id, seed: 1, definitions: ALS_WEAPONS.slice(0, 2) }), [connection.id])
  const telemetry = useMemo(() => {
    const origins = new Map<string, { clock: AnimationClock; seconds: number; updates: number; wall: number }>()
    const clocks: Record<string, ClockSample> = {}
    return { clocks, initialServerSpawn: null as { x: number; y: number; z: number } | null, record(id: string, clock: AnimationClock) {
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
  const world = useMemo(createWorld, [])
  const controller = useMemo(() => world.spawn(Controller({ pawn: connection.id })), [world, connection.id])
  const pawn = useMemo(() => world.spawn(Pawn({ owner: connection.id }), Intent), [world, connection.id])
  const worldTime = useMemo(createWorldTimeState, [])
  const audio = useMemo(() => footsteps ?? new AlsFootstepAudioRuntime({ AutoInstallUserGestureUnlock: true }), [footsteps])
  const ragdoll = useRef<AlsRagdollHandle | null>(null)
  const alive = useRef(true)
  const [remotes, setRemotes] = useState<string[]>(() => remoteKeys(replica, connection.id))
  const spawn = useSubjectSpawn(subject.player)
  const [hits, setHits] = useState(0)
  const [health, setHealth] = useState(() => replica.states.get(connection.id)?.health ?? 100)
  const [view, setView] = useState<FpsView>(subject.view)
  const [status, setStatus] = useState(offline ? 'Offline room' : 'Online room')
  useEffect(() => onStatus?.({ room: status, players: remotes.length + 1, hits, view, health, alive: health > 0 }), [onStatus, status, remotes.length, hits, view, health])
  useEffect(() => {
    let life = replica.states.get(connection.id)?.life ?? 0
    let viewBeforeDeath: FpsView | null = null
    let lastHit: Extract<ServerMessage, { type: 'hit' }> | null = null
    const updateRemotes = () => {
      const next = remoteKeys(replica, connection.id)
      setRemotes(previous => previous.length === next.length && previous.every((key, index) => key === next[index]) ? previous : next)
    }
    const applySpawn = (own: PawnState | undefined) => {
      if (own) telemetry.initialServerSpawn ??= { ...own.position }
      if (!own || own.position.x === subject.player.spawn[0] && own.position.y === subject.player.spawn[1] && own.position.z === subject.player.spawn[2]) return
      subject.respawn([own.position.x, own.position.y, own.position.z], own.yaw)
    }
    const die = () => {
      alive.current = false
      if (subject.options.cameraMode === 'switchable' && subject.view === 'first-person') { viewBeforeDeath = 'first-person'; subject.setView('third-person') }
      subject.setEnabled(false)
      ragdoll.current?.StartRagdolling({ initialImpulse: deathImpulse(lastHit?.direction, lastHit?.point) })
    }
    const revive = (own: PawnState) => {
      life = own.life ?? 0
      alive.current = true
      subject.respawn([own.position.x, own.position.y, own.position.z], own.yaw)
      if (viewBeforeDeath) subject.setView(viewBeforeDeath)
      viewBeforeDeath = null
    }
    const unsubscribe = replica.onMessage(message => {
      if (message.type === 'welcome') applySpawn(message.states.find(state => state.id === connection.id))
      if (message.type === 'state' && message.state.id === connection.id) {
        const own = message.state
        if ((own.life ?? 0) !== life) revive(own)
        else if (own.health <= 0 && alive.current) die()
        setHealth(own.health)
      }
      if (message.type === 'hit' && message.target === connection.id) lastHit = message
      if (message.type === 'hit' && message.shooter === connection.id) setHits(value => value + 1)
      if (message.type === 'rejected') setStatus(message.reason)
      if (message.type === 'welcome' || message.type === 'state' || message.type === 'leave') updateRemotes()
    })
    applySpawn(replica.states.get(connection.id))
    updateRemotes()
    return () => { unsubscribe(); controller.destroy(); pawn.destroy(); world.reset() }
  }, [replica, connection.id, controller, pawn, world, subject, telemetry])
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
      spawn: [...subject.player.spawn],
      spawnRevision: subject.player.getRevision(),
      rigidBodyPosition: subject.player.pose.current.ownerRigidBody?.isValid() ? { ...subject.player.pose.current.ownerRigidBody.translation() } : null,
      replicaPosition: replica.states.get(connection.id)?.position ?? null,
      initialServerSpawn: telemetry.initialServerSpawn,
    }), 250)
    return () => clearInterval(timer)
  }, [onDiagnostics, telemetry, arms, subject, replica, connection.id])
  useFrame(() => {
    const clock = subject.player.pose.current.animationClock
    if (clock) telemetry.record('local', clock)
  }, -0.02)
  const next = useMemo(() => ({ seq: 0, jumpSequence: 0 }), [])
  const publishSnapshot = useCallback((snapshot: AlsCharacterSnapshot) => {
    if (!subject.frame.ready || !alive.current) return
    const command = subject.player.command
    const intent = { forward: command.forward, right: command.right, jump: command.jumpSequence !== next.jumpSequence, yaw: command.yaw, pitch: command.pitch, aiming: command.aim }
    next.jumpSequence = command.jumpSequence
    if (controller.get(Controller)?.pawn !== connection.id) return
    const message = createPawnMoveMessage(snapshot, intent, ++next.seq)
    pawn.set(Pawn, { owner: connection.id, ...message.position })
    pawn.set(Intent, { forward: intent.forward, right: intent.right, jump: intent.jump })
    replica.send(message)
  }, [subject, next, controller, connection.id, pawn, replica])
  const ignoreSize = useCallback(() => {}, [])
  return <>
    <Suspense fallback={null}><Physics gravity={[0, -9.8, 0]} timeStep={1 / 60} updatePriority={ALS_FRAME_PRIORITY.Physics}>
      <group visible={view === 'third-person'}><Character showDebugControls={false} key={spawn.revision} initialPosition={spawn.position} poseSample={subject.player.pose} worldTime={worldTime} footstepSoundSink={audio} onSizeChange={ignoreSize} onOverlayModeBridgeChange={ignoreSize} inputEnabled={false} ragdollInputEnabled={false} ragdollRef={ragdoll} inputSource={inputSource} gaitSpeedOverrides={gaitSpeedOverrides} onSnapshot={publishSnapshot} snapshotRateHz={SNAPSHOT_RATE_HZ} /></group>
      <AlsCamera poseSample={subject.player.pose} worldTime={worldTime} footstepAudioRuntime={audio} toggleViewModeKey={null} controlRotationSource={controlRotationSource} />
      <WeaponDriver subject={subject} replica={replica} weapon={weapon} arms={arms} alive={alive} onShot={onShot} />
      {physicsProbe}
      {children}
      {remotes.map(key => { const [id, life] = key.split('#'); return <RemotePawn key={key} id={id!} life={Number(life)} replica={replica} onClock={telemetry.record} /> })}
    </Physics></Suspense>
    <Subject controller={subject} input={input} /><Suspense fallback={null}><ArmsViewmodel state={arms} visible={view === 'first-person'} render={onArmsPresentation ? 'external' : 'composite'} onPresentation={onArmsPresentation} /></Suspense>
  </>
}

function DefaultArena() {
  return <>
    <ambientLight intensity={1.5} /><directionalLight position={[5, 12, 4]} intensity={2.5} />
    <RigidBody type="fixed" colliders={false}><CuboidCollider args={[30, 0.1, 30]} position={[0, -0.1, 0]} /></RigidBody>
    <mesh rotation-x={-Math.PI / 2} position-y={-0.01}><planeGeometry args={[60, 60]} /><meshStandardMaterial color="#293743" /></mesh>
    <gridHelper args={[60, 30, '#506d77', '#394c58']} />
  </>
}

export function MultiplayerSubject({ connection, offline = false, cameraMode = 'switchable', onCreated, physicsProbe, initialSpawn = DEFAULT_SPAWN }: { connection: Connection; offline?: boolean; cameraMode?: CameraMode; onCreated?: (state: RootState) => void; physicsProbe?: ReactNode; initialSpawn?: readonly [number, number, number] }) {
  const [status, setStatus] = useState<MultiplayerStatus>({ room: offline ? 'Offline room' : 'Online room', players: 0, hits: 0, view: 'first-person', health: 100, alive: true })
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null)
  const debug = new URLSearchParams(window.location.search).has('debug')
  return <><Canvas onCreated={onCreated} camera={{ position: [0, 1.63, 0], fov: 75 }}><MultiplayerScene connection={connection} offline={offline} cameraMode={cameraMode} onStatus={setStatus} onDiagnostics={debug ? setDiagnostics : undefined} physicsProbe={physicsProbe} initialSpawn={initialSpawn}><DefaultArena /></MultiplayerScene></Canvas><div className="hud"><strong>{status.room} · {status.view}</strong><span>Players: {status.players} · Hits: {status.hits} · Health: {status.health}</span><span>Click scene · WASD move · {cameraMode === 'switchable' ? 'V switch view · ' : ''}1 rifle · 2 pistol · RMB aim · LMB fire · R reload</span></div><div className="reticle">+</div>{debug && <pre data-mp-debug style={{ position: 'absolute', bottom: 12, left: 12, margin: 0, padding: 10, fontSize: 10, maxHeight: '65%', overflow: 'auto', color: '#fff', background: '#000b', pointerEvents: 'none' }}>{JSON.stringify(diagnostics, null, 2)}</pre>}</>
}

export function LoopbackSplitView({ cameraMode = 'switchable', onCreated, physicsProbe }: { cameraMode?: CameraMode; onCreated?: (state: RootState) => void; physicsProbe?: ReactNode }) {
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
  return <div style={{ display: 'flex', width: '100%', height: '100%' }}>{peers.map((peer, index) => <div key={peer.id} style={{ position: 'relative', width: '50%', height: '100%' }}><MultiplayerSubject connection={peer} offline cameraMode={cameraMode} onCreated={onCreated} physicsProbe={physicsProbe} initialSpawn={LOOPBACK_SPAWNS[index] ?? DEFAULT_SPAWN} /></div>)}</div>
}
