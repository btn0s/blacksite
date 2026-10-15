import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Canvas, createPortal, useFrame, useThree, type RootState } from '@react-three/fiber'
import { Physics, CuboidCollider, RigidBody } from '@react-three/rapier'
import { Character } from 'als-ue5-r3f/app/Character'
import { AlsCamera } from 'als-ue5-r3f/app/AlsCamera'
import { AlsRemoteActor } from 'als-ue5-r3f/app/AlsRemoteActor'
import { AlsSnapshotBuffer } from 'als-ue5-r3f/als/AlsSnapshotBuffer'
import { createWorldTimeState } from 'als-ue5-r3f/engine/timeDilation'
import { AlsFootstepAudioRuntime } from 'als-ue5-r3f/engine/alsAudioBridge'
import { createWorld, trait } from 'koota'
import { Subject, createSubject } from './index'
import type { PawnState, Connection } from '@blacksite/relay'
import { createReplica, createLoopbackRoom } from '@blacksite/relay'
import type { CameraMode } from './controller'

const Controller = trait({ pawn: '' })
const Pawn = trait({ owner: '', x: 0, y: 0, z: 0 })
const Intent = trait({ forward: 0, right: 0, jump: false })
const DEFAULT_SPAWN = [0, 0, 0] as const
const LOOPBACK_SPAWNS = [[0, 0, 0], [3, 0, 0]] as const

function Arms({ visible }: { visible: boolean }) {
  const { camera } = useThree()
  if (!visible) return null
  return createPortal(<group position={[0.27, -0.29, -0.48]} rotation={[0, -0.13, 0]}>
    <mesh position={[-0.2, -0.1, 0.06]} rotation-z={-0.38}><capsuleGeometry args={[0.055, 0.31, 4, 8]} /><meshStandardMaterial color="#b99a79" /></mesh>
    <mesh position={[0.12, -0.12, 0.03]} rotation-z={0.28}><capsuleGeometry args={[0.055, 0.29, 4, 8]} /><meshStandardMaterial color="#b99a79" /></mesh>
    <mesh position={[0, 0, -0.17]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.045, 0.06, 0.64, 10]} /><meshStandardMaterial color="#586871" metalness={0.6} roughness={0.4} /></mesh>
  </group>, camera)
}

function RemotePawn({ state }: { state: PawnState }) {
  const buffer = useMemo(() => new AlsSnapshotBuffer({ interpolationDelayMs: 100 }), [])
  useEffect(() => { buffer.push({
    t: state.t, pos: [state.position.x, state.position.y + 0.9, state.position.z],
    vel: [state.velocity.x, state.velocity.y, state.velocity.z],
    actorYaw: state.yaw, viewYaw: state.yaw, viewPitch: state.pitch,
    gait: Math.hypot(state.velocity.x, state.velocity.z) > 4 ? 'sprinting' : 'running',
    stance: 'standing', rotationMode: 'viewDirection', locomotionMode: 'grounded',
    action: 'none', actionSeq: 0, overlay: 'default', aiming: false, seq: state.seq,
  }) }, [buffer, state])
  return <Suspense fallback={null}><AlsRemoteActor snapshots={buffer} now={Date.now} /></Suspense>
}

function NetworkScene({ connection, offline, cameraMode, onStatus, physicsProbe, initialSpawn }: { connection: Connection; offline: boolean; cameraMode: CameraMode; onStatus: (status: { room: string; players: number; hits: number; view: string }) => void; physicsProbe?: ReactNode; initialSpawn: readonly [number, number, number] }) {
  const subject = useMemo(() => createSubject({ cameraMode, spawn: initialSpawn }), [cameraMode, initialSpawn])
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
  const [spawn, setSpawn] = useState<readonly [number, number, number]>(initialSpawn)
  const [hits, setHits] = useState(0)
  const [view, setView] = useState<'first-person' | 'third-person'>('first-person')
  const [status, setStatus] = useState(offline ? 'Offline room' : 'Online room')
  useEffect(() => onStatus({ room: status, players: players.length, hits, view }), [onStatus, status, players.length, hits, view])
  useEffect(() => {
    const update = () => setPlayers([...replica.states.values()])
    const initial = replica.states.get(connection.id)
    if (initial) {
      const next = [initial.position.x, initial.position.y, initial.position.z] as const
      subject.respawn(next, initial.yaw)
      setSpawn(next)
    }
    const unsubscribe = replica.onMessage(message => {
      if (message.type === 'welcome') {
        const own = message.states.find(state => state.id === connection.id)
        if (own && (own.position.x !== subject.player.spawn[0] || own.position.y !== subject.player.spawn[1] || own.position.z !== subject.player.spawn[2])) {
          const next = [own.position.x, own.position.y, own.position.z] as const
          subject.respawn(next, own.yaw)
          setSpawn(next)
        }
      }
      update()
      if (message.type === 'hit' && message.shooter === connection.id) setHits(value => value + 1)
      if (message.type === 'rejected') setStatus(message.reason)
    })
    update()
    return () => { unsubscribe(); replica.close(); controller.destroy(); pawn.destroy(); world.reset() }
  }, [replica, connection.id, controller, pawn, world, subject])
  useEffect(() => subject.subscribe(() => setView(subject.view)), [subject])
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (event.button !== 0 || document.pointerLockElement === null) return
      const direction = subject.frame.aimDirection
      replica.send({ type: 'fire', seq: Math.floor(performance.now() * 1000), direction: { x: direction.x, y: direction.y, z: direction.z } })
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [replica, subject])
  const next = useMemo(() => ({ seq: 0, last: 0 }), [])
  useFrame(() => {
    if (!subject.frame.ready || performance.now() - next.last < 50) return
    next.last = performance.now()
    const frame = subject.frame
    const position = { x: frame.position.x, y: frame.position.y, z: frame.position.z }
    const velocity = { x: frame.velocity.x / 100, y: frame.velocity.y / 100, z: frame.velocity.z / 100 }
    pawn.set(Pawn, { owner: connection.id, ...position })
    const command = subject.player.command
    const intent = { forward: command.forward, right: command.right, jump: false, yaw: command.yaw, pitch: command.pitch }
    pawn.set(Intent, { forward: intent.forward, right: intent.right, jump: intent.jump })
    if (controller.get(Controller)?.pawn !== connection.id) return
    replica.send({ type: 'move', seq: ++next.seq, position, velocity, intent })
  })
  return <>
    <ambientLight intensity={1.5} /><directionalLight position={[5, 12, 4]} intensity={2.5} />
    <Physics gravity={[0, -9.8, 0]} timeStep={1 / 60}>
      <group visible={view === 'third-person'}><Character key={spawn.join(':')} initialPosition={spawn} poseSample={subject.player.pose} worldTime={worldTime} footstepSoundSink={audio} onSizeChange={() => {}} onOverlayModeBridgeChange={() => {}} inputEnabled={false} inputSource={() => {
        const command = subject.player.command
        return { movementDirection: { x: command.forward, z: command.right }, desiredSpeed: command.sprint ? 600 : 300, viewYawAngle: command.yaw, viewPitchAngle: command.pitch, aiming: command.aim, overlayMode: command.overlay }
      }} /></group>
      {view === 'third-person' && <AlsCamera poseSample={subject.player.pose} worldTime={worldTime} footstepAudioRuntime={audio} toggleViewModeKey={null} />}
      <RigidBody type="fixed" colliders={false}><CuboidCollider args={[30, 0.1, 30]} position={[0, -0.1, 0]} /></RigidBody>
      {physicsProbe}
      {players.filter(player => player.id !== connection.id).map(player => <RemotePawn key={player.id} state={player} />)}
      <Subject controller={subject} />
    </Physics>
    <Arms visible={view === 'first-person'} />
    <mesh rotation-x={-Math.PI / 2} position-y={-0.01}><planeGeometry args={[60, 60]} /><meshStandardMaterial color="#293743" /></mesh>
    <gridHelper args={[60, 30, '#506d77', '#394c58']} />
  </>
}

export function MultiplayerSubject({ connection, offline = false, cameraMode = 'switchable', onCreated, physicsProbe, initialSpawn = DEFAULT_SPAWN }: { connection: Connection; offline?: boolean; cameraMode?: CameraMode; onCreated?: (state: RootState) => void; physicsProbe?: ReactNode; initialSpawn?: readonly [number, number, number] }) {
  const [status, setStatus] = useState({ room: offline ? 'Offline room' : 'Online room', players: 0, hits: 0, view: 'first-person' })
  return <><Canvas onCreated={onCreated} camera={{ position: [0, 1.63, 0], fov: 75 }}><NetworkScene connection={connection} offline={offline} cameraMode={cameraMode} onStatus={setStatus} physicsProbe={physicsProbe} initialSpawn={initialSpawn} /></Canvas><div className="hud"><strong>{status.room} · {status.view}</strong><span>Players: {status.players} · Hits: {status.hits}</span><span>Click scene · WASD move · {cameraMode === 'switchable' ? 'V switch view · ' : ''}Click fire</span></div><div className="reticle">+</div></>
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
