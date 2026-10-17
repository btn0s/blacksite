import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { AlsRemoteActor, type AlsRagdollHandle } from 'als-ue5-r3f/app/AlsRemoteActor'
import { AlsSnapshotBuffer } from 'als-ue5-r3f/als/AlsSnapshotBuffer'
import type { AlsCharacterSnapshot } from 'als-ue5-r3f/als/AlsCharacterSnapshot'
import type { WeaponEvent } from '@blacksite/armory'
import { createReplica, shotOrigin, type ClientMessage, type Connection, type PawnState, type ServerMessage } from '@blacksite/relay'
import { WorldWeapon } from '../found/WorldWeapon'
import { createPawnMoveMessage, toAlsRemoteSnapshot } from '../remote-snapshot'
import { CharacterController, type CharacterControllerProps, type CharacterEvents } from './CharacterController'
import type { CharacterView } from './state'

export const REMOTE_INTERPOLATION_MS = 100
export const SNAPSHOT_RATE_HZ = 20

export type Replica = ReturnType<typeof createReplica>
export type ReplicationStatus = { players: number; health: number; hits: number }
export type ReplicationProps = CharacterControllerProps & {
  connection: Connection
  onReplica?: (replica: Replica | null) => void
  onStatus?: (status: ReplicationStatus) => void
}

type WeaponId = Extract<ClientMessage, { type: 'weapon' }>['weapon']
type Point = { x: number; y: number; z: number }

const DEG = Math.PI / 180
export const pawnYaw = (degrees: number) => -degrees * DEG - Math.PI / 2
const at = (point: Point) => [point.x, point.y, point.z] as const

const deathImpulse = (direction: Point | undefined, point?: Point) => ({
  boneName: 'spine_03',
  impulse: { x: (direction?.x ?? 0) * 70, y: 25, z: (direction?.z ?? 0) * 70 },
  location: point && { ...point },
})

const remoteKeys = (replica: Replica) => [...replica.states.values()].filter(state => state.id !== replica.id).map(state => `${state.id}#${state.life ?? 0}`).sort()

export function Replication({ connection, onReplica, onStatus, events, ragdollRef, ...props }: ReplicationProps) {
  const controller = props.controller
  const [replica, setReplica] = useState<Replica | null>(null)
  useEffect(() => {
    const next = createReplica(connection, state => {
      if (controller.als.pose.current.ready && controller.position.distanceToSquared(state.position) > 4) controller.teleport(at(state.position), controller.control.yaw, controller.control.pitch)
    }, { closeConnection: false })
    setReplica(next)
    onReplica?.(next)
    return () => { onReplica?.(null); next.close() }
  }, [connection, controller, onReplica])
  return replica ? <Replicated {...props} replica={replica} events={events} ragdollRef={ragdollRef} onStatus={onStatus} /> : null
}

function Replicated({ replica, events, ragdollRef, onStatus, ...props }: CharacterControllerProps & { replica: Replica; onStatus?: (status: ReplicationStatus) => void }) {
  const controller = props.controller
  const owned = useRef<AlsRagdollHandle | null>(null)
  const ragdoll = ragdollRef ?? owned
  const hooks = useRef(events)
  hooks.current = events
  const [remotes, setRemotes] = useState(() => remoteKeys(replica))
  const [status, setStatus] = useState<ReplicationStatus>(() => ({ players: 1, health: replica.states.get(replica.id)?.health ?? 100, hits: 0 }))
  const net = useMemo(() => ({ seq: 0, jumpSequence: 0, shots: 0, weapons: 0, alive: true, direction: new Vector3(), aim: new Vector3() }), [])
  useEffect(() => { onStatus?.(status) }, [onStatus, status])
  useEffect(() => {
    let life = replica.states.get(replica.id)?.life ?? 0
    let restore: CharacterView | null = null
    let lastHit: Extract<ServerMessage, { type: 'hit' }> | null = null
    const update = () => {
      const next = remoteKeys(replica)
      setRemotes(previous => previous.length === next.length && previous.every((key, index) => key === next[index]) ? previous : next)
      setStatus(previous => previous.players === next.length + 1 ? previous : { ...previous, players: next.length + 1 })
    }
    const place = (own: PawnState | undefined) => {
      if (own && controller.position.distanceToSquared(own.position) > 0.01) controller.teleport(at(own.position), pawnYaw(own.yaw))
    }
    const die = () => {
      net.alive = false
      controller.active = false
      if (controller.status().view === 'arms' && controller.config.views.includes('shoulder')) { restore = 'arms'; controller.setView('shoulder') }
      ragdoll.current?.StartRagdolling({ initialImpulse: deathImpulse(lastHit?.direction, lastHit?.point) })
    }
    const revive = (own: PawnState) => {
      life = own.life ?? 0
      net.alive = true
      controller.respawn(undefined, at(own.position), pawnYaw(own.yaw))
      controller.active = true
      if (restore) controller.setView(restore)
      restore = null
    }
    const unsubscribe = replica.onMessage(message => {
      if (message.type === 'welcome') place(message.states.find(state => state.id === replica.id))
      if (message.type === 'state' && message.state.id === replica.id) {
        const own = message.state
        if ((own.life ?? 0) !== life) revive(own)
        else if (own.health <= 0 && net.alive) die()
        setStatus(previous => previous.health === own.health ? previous : { ...previous, health: own.health })
      }
      if (message.type === 'hit' && message.target === replica.id) lastHit = message
      if (message.type === 'hit' && message.shooter === replica.id) setStatus(previous => ({ ...previous, hits: previous.hits + 1 }))
      if (message.type === 'welcome' || message.type === 'state' || message.type === 'leave') update()
    })
    place(replica.states.get(replica.id))
    update()
    return unsubscribe
  }, [replica, controller, ragdoll, net])

  const merged = useMemo<CharacterEvents>(() => ({
    onFootstep: request => hooks.current?.onFootstep?.(request),
    onLand: speed => hooks.current?.onLand?.(speed),
    onJump: () => hooks.current?.onJump?.(),
    onAction: (action, device) => hooks.current?.onAction?.(action, device),
    onSnapshot(snapshot: AlsCharacterSnapshot) {
      hooks.current?.onSnapshot?.(snapshot)
      if (!net.alive || !replica.states.has(replica.id)) return
      const command = controller.als.command
      const intent = { forward: command.forward, right: command.right, jump: command.jumpSequence !== net.jumpSequence, yaw: command.yaw, pitch: command.pitch, aiming: command.aim }
      net.jumpSequence = command.jumpSequence
      replica.send(createPawnMoveMessage(snapshot, intent, ++net.seq))
    },
    onWeapon(event: WeaponEvent) {
      hooks.current?.onWeapon?.(event)
      const weapon = event.weaponId as WeaponId
      if (event.type === 'shot') {
        const own = replica.states.get(replica.id)
        let direction = event.direction
        if (own) {
          const origin = shotOrigin(own)
          const aim = net.aim.set(event.direction.x, event.direction.y, event.direction.z)
          const server = net.direction.set(event.end.x - origin.x, event.end.y - origin.y, event.end.z - origin.z)
          if (server.lengthSq() > 0.25 && server.normalize().dot(aim) > 0.7) direction = { x: server.x, y: server.y, z: server.z }
        }
        replica.send({ type: 'fire', seq: ++net.shots, direction: { ...direction } })
      }
      if (event.type === 'reload-started') replica.send({ type: 'weapon', seq: ++net.weapons, weapon, reload: true })
      if (event.type === 'switch-started') replica.send({ type: 'weapon', seq: ++net.weapons, weapon, reload: false })
    },
  }), [replica, controller, net])

  return <>
    <CharacterController {...props} events={merged} ragdollRef={ragdoll} snapshotRateHz={props.snapshotRateHz ?? SNAPSHOT_RATE_HZ} />
    {remotes.map(key => { const [id, life] = key.split('#'); return <RemotePawn key={key} id={id!} life={Number(life)} replica={replica} /> })}
  </>
}

function RemotePawn({ id, life, replica }: { id: string; life: number; replica: Replica }) {
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
  const weapon = useMemo(() => () => replica.states.get(id)?.weapon ?? 'rifle', [replica, id])
  return <Suspense fallback={null}>
    <AlsRemoteActor snapshots={buffer} now={Date.now} ragdollRef={ragdoll} onUnsupportedState={ignore}
      renderOverlayObject={scene => <Suspense fallback={null}><WorldWeapon characterScene={scene} weapon={weapon} /></Suspense>} />
  </Suspense>
}

const ignore = () => {}
