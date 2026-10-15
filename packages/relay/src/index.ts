import { createWorld, trait } from 'koota'
import { ALS_WEAPONS, createWeaponRuntime } from '@blacksite/armory'
import type { WeaponRuntime, RayQuery, WeaponEvent } from '@blacksite/armory'
import { isClientMessage } from '@blacksite/protocol'
import type { ClientMessage, ServerMessage, PawnState, Vec3, WeaponId } from '@blacksite/protocol'

export type { ClientMessage, ServerMessage, PawnState, PawnIntent } from '@blacksite/protocol'
export const Ownership = trait({ owner: '', authority: 'server' as 'server' | 'owner' })
export const ReplicatedPosition = trait({ x: 0, y: 0, z: 0, seq: 0 })
export const ReplicatedHealth = trait({ value: 100 })
export type ReplicationCondition = 'all' | 'owner-only' | 'skip-owner' | 'initial-only'
export function projectTrait<T>(value: T, condition: ReplicationCondition, owner: string, recipient: string, initial: boolean): T | undefined {
  if (condition === 'owner-only' && owner !== recipient) return undefined
  if (condition === 'skip-owner' && owner === recipient) return undefined
  if (condition === 'initial-only' && !initial) return undefined
  return structuredClone(value)
}
export type Send = (message: ServerMessage) => void
export interface Connection { id: string; send(message: ClientMessage): void; onMessage(listener: (message: ServerMessage) => void): () => void; close(): void }
export interface Transport { connect(): Promise<Connection> }

const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
const subtract = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const add = (a: Vec3, b: Vec3, scale: number): Vec3 => ({ x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale })

export function createMatch({ now = Date.now }: { now?: () => number } = {}) {
  const world = createWorld()
  const peers = new Map<string, Send>()
  const states = new Map<string, PawnState>()
  const entities = new Map<string, ReturnType<typeof world.spawn>>()
  const weapons = new Map<string, { runtime: WeaponRuntime; startedAt: number; fire?: Vec3; selection?: WeaponId; reload: boolean }>()
  const shotSequence = new Map<string, number>()
  const weaponSequence = new Map<string, number>()
  let currentTime = now()
  const clock = () => { currentTime = Math.max(currentTime, now()); return currentTime }
  const broadcast = (message: ServerMessage) => { for (const send of peers.values()) send(message) }
  function join(id: string, send: Send) {
    if (peers.has(id)) throw new Error('Duplicate player')
    const index = peers.size
    const state: PawnState = { id, owner: id, authority: 'owner', seq: 0, t: clock(), position: { x: index * 3, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, health: 100, weapon: 'rifle', aiming: false }
    send({ type: 'welcome', id, states: [...states.values(), state] })
    peers.set(id, send)
    states.set(id, state)
    entities.set(id, world.spawn(Ownership({ owner: id, authority: 'owner' }), ReplicatedPosition({ ...state.position, seq: 0 }), ReplicatedHealth))
    weapons.set(id, { runtime: createWeaponRuntime({ ownerId: id, seed: index + 1, definitions: ALS_WEAPONS.filter(weapon => weapon.id === 'rifle' || weapon.id === 'pistol') }), startedAt: state.t, reload: false })
    broadcast({ type: 'state', state })
  }
  function leave(id: string) {
    peers.delete(id); states.delete(id); entities.get(id)?.destroy(); entities.delete(id); weapons.get(id)?.runtime.dispose(); weapons.delete(id); shotSequence.delete(id); weaponSequence.delete(id)
    broadcast({ type: 'leave', id })
  }
  function castRay(id: string, query: RayQuery) {
    let nearest: { targetId: string; distance: number; point: Vec3 } | null = null
    for (const target of states.values()) {
      if (target.id === id || target.health <= 0) continue
      const centre = { ...target.position, y: target.position.y + 1.1 }
      const projection = dot(subtract(centre, query.origin), query.direction)
      if (projection < 0 || projection > query.maxDistance) continue
      const point = add(query.origin, query.direction, projection)
      if (distance(point, centre) > 0.8 || (nearest && nearest.distance <= projection)) continue
      nearest = { targetId: target.id, distance: projection, point }
    }
    return nearest ? { colliderId: nearest.targetId, targetId: nearest.targetId, point: nearest.point, normal: { x: 0, y: 1, z: 0 }, distance: nearest.distance } : null
  }
  function applyEvents(id: string, events: readonly WeaponEvent[], time: number) {
    for (const event of events) {
      if (event.type === 'switch-started') {
        const previous = states.get(id)!
        const state = { ...previous, weapon: event.weaponId as WeaponId, t: time }
        states.set(id, state)
        broadcast({ type: 'state', state })
      }
      if (event.type === 'damage') {
        const target = states.get(event.targetId)
        if (!target) continue
        const next = { ...target, health: Math.max(0, target.health - event.amount) }
        states.set(target.id, next)
        entities.get(target.id)?.set(ReplicatedHealth, { value: next.health })
        broadcast({ type: 'hit', shooter: id, target: target.id, damage: event.amount, health: next.health })
        broadcast({ type: 'state', state: next })
      }
    }
  }
  function advance() {
    const time = clock()
    for (const [id, weapon] of weapons) {
      const dueTicks = Math.floor((time - weapon.startedAt) / (weapon.runtime.fixedDeltaSeconds * 1000))
      while (weapon.runtime.snapshot().nextTick < dueTicks) {
        const previous = states.get(id)!
        const origin = { ...previous.position, y: previous.position.y + 1.5 }
        const events = weapon.runtime.step({ tick: weapon.runtime.snapshot().nextTick, trigger: !!weapon.fire, reload: weapon.reload, selectWeaponId: weapon.selection, aim: { origin, direction: weapon.fire ?? { x: 0, y: 0, z: -1 } }, muzzle: origin }, { castRay: query => castRay(id, query), sweepSphere: () => null })
        weapon.fire = undefined
        weapon.selection = undefined
        weapon.reload = false
        applyEvents(id, events, time)
      }
    }
  }
  function receive(id: string, raw: unknown) {
    const previous = states.get(id)
    if (!previous || !isClientMessage(raw)) { peers.get(id)?.({ type: 'rejected', reason: 'invalid or unowned message' }); return }
    advance()
    if (raw.type === 'move') {
      if (raw.seq <= previous.seq || raw.seq > previous.seq + 10000 || distance(raw.position, previous.position) > Math.max(1, Math.min(5, (clock() - previous.t) * 0.02)) || distance(raw.velocity, { x: 0, y: 0, z: 0 }) > 15 || Math.abs(raw.intent.forward) > 1 || Math.abs(raw.intent.right) > 1 || Math.abs(raw.intent.pitch) > 90) {
        peers.get(id)?.({ type: 'rejected', reason: 'invalid movement' }); return
      }
      const state = { ...states.get(id)!, seq: raw.seq, t: clock(), position: { ...raw.position }, velocity: { ...raw.velocity }, yaw: raw.intent.yaw, pitch: raw.intent.pitch, aiming: raw.intent.aiming ?? false }
      states.set(id, state)
      entities.get(id)?.set(ReplicatedPosition, { ...state.position, seq: state.seq })
      broadcast({ type: 'state', state })
      return
    }
    const weapon = weapons.get(id)!
    if (raw.type === 'weapon') {
      if (raw.seq <= (weaponSequence.get(id) ?? -1)) { peers.get(id)?.({ type: 'rejected', reason: 'invalid weapon sequence' }); return }
      weaponSequence.set(id, raw.seq)
      weapon.selection = raw.weapon
      weapon.reload ||= raw.reload
      return
    }
    if (raw.seq <= (shotSequence.get(id) ?? -1) || distance(raw.direction, { x: 0, y: 0, z: 0 }) < 0.99 || distance(raw.direction, { x: 0, y: 0, z: 0 }) > 1.01) { peers.get(id)?.({ type: 'rejected', reason: 'invalid shot' }); return }
    shotSequence.set(id, raw.seq)
    weapon.fire = { ...raw.direction }
  }
  function sync(id: string) { advance(); peers.get(id)?.({ type: 'welcome', id, states: [...states.values()] }) }
  return { world, join, leave, receive, sync, states, advance }
}

export function createLoopbackRoom(match = createMatch()): Transport {
  let nextId = 0
  let connections = 0
  let timer: ReturnType<typeof setInterval> | undefined
  return { async connect() {
    const id = `offline-${++nextId}`
    const listeners = new Set<(message: ServerMessage) => void>()
    const pending: ServerMessage[] = []
    match.join(id, message => { pending.push(message); queueMicrotask(() => { for (const listener of listeners) listener(message) }) })
    connections++
    timer ??= setInterval(match.advance, 1000 / 60)
    let closed = false
    return { id, send: message => match.receive(id, message), onMessage(listener) { listeners.add(listener); for (const message of pending) listener(message); pending.length = 0; return () => { listeners.delete(listener) } }, close() {
      if (closed) return
      closed = true
      match.leave(id)
      if (--connections === 0) { clearInterval(timer); timer = undefined }
    } }
  } }
}

export const createLoopback = createLoopbackRoom

export function interpolate(a: PawnState, b: PawnState, time: number): PawnState {
  if (a.id !== b.id) throw new Error('Cannot interpolate different pawns')
  const alpha = Math.max(0, Math.min(1, (time - a.t) / Math.max(1, b.t - a.t)))
  const blend = (x: number, y: number) => x + (y - x) * alpha
  return { ...b, position: { x: blend(a.position.x, b.position.x), y: blend(a.position.y, b.position.y), z: blend(a.position.z, b.position.z) }, velocity: { x: blend(a.velocity.x, b.velocity.x), y: blend(a.velocity.y, b.velocity.y), z: blend(a.velocity.z, b.velocity.z) }, yaw: blend(a.yaw, b.yaw), pitch: blend(a.pitch, b.pitch) }
}

export function createReplica(connection: Connection, reconcile?: (authoritative: PawnState, pending: ClientMessage[]) => void) {
  const world = createWorld()
  const entities = new Map<string, ReturnType<typeof world.spawn>>()
  const states = new Map<string, PawnState>()
  const history = new Map<string, [PawnState, PawnState]>()
  const pending: ClientMessage[] = []
  const listeners = new Set<(message: ServerMessage) => void>()
  const unsubscribe = connection.onMessage(message => {
    if (message.type === 'welcome') for (const state of message.states) {
      states.set(state.id, state)
      if (!entities.has(state.id)) entities.set(state.id, world.spawn(Ownership({ owner: state.owner, authority: state.authority }), ReplicatedPosition({ ...state.position, seq: state.seq }), ReplicatedHealth({ value: state.health })))
    }
    if (message.type === 'state') {
      const previous = states.get(message.state.id)
      if (previous) history.set(message.state.id, [previous, message.state])
      states.set(message.state.id, message.state)
      if (!entities.has(message.state.id)) entities.set(message.state.id, world.spawn(Ownership({ owner: message.state.owner, authority: message.state.authority }), ReplicatedPosition({ ...message.state.position, seq: message.state.seq }), ReplicatedHealth({ value: message.state.health })))
      else { entities.get(message.state.id)!.set(ReplicatedPosition, { ...message.state.position, seq: message.state.seq }); entities.get(message.state.id)!.set(ReplicatedHealth, { value: message.state.health }) }
      if (message.state.id === connection.id) {
        while (pending.length && pending[0]!.seq <= message.state.seq) pending.shift()
        reconcile?.(message.state, [...pending])
        const latest = pending.at(-1)
        if (latest?.type === 'move') {
          states.set(connection.id, { ...message.state, position: latest.position, velocity: latest.velocity, seq: latest.seq })
          entities.get(connection.id)?.set(ReplicatedPosition, { ...latest.position, seq: latest.seq })
        }
      }
    }
    if (message.type === 'leave') { states.delete(message.id); history.delete(message.id); entities.get(message.id)?.destroy(); entities.delete(message.id) }
    for (const listener of listeners) listener(message)
  })
  return { id: connection.id, world, entities, states, send(message: ClientMessage) {
    if (message.type === 'move') {
      pending.push(message)
      const previous = states.get(connection.id)
      if (previous) { states.set(connection.id, { ...previous, position: message.position, velocity: message.velocity, seq: message.seq }); entities.get(connection.id)?.set(ReplicatedPosition, { ...message.position, seq: message.seq }) }
    }
    connection.send(message)
  }, sample(id: string, time: number) { const pair = history.get(id); return pair ? interpolate(pair[0], pair[1], time) : states.get(id) }, onMessage(listener: (message: ServerMessage) => void) { listeners.add(listener); return () => { listeners.delete(listener) } }, close() { unsubscribe(); connection.close(); world.reset() } }
}
