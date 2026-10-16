import { createWorld, trait } from 'koota'
import { ALS_WEAPONS, createWeaponRuntime } from '@blacksite/armory'
import type { WeaponRuntime, RayQuery, WeaponEvent } from '@blacksite/armory'
import { isClientMessage } from '@blacksite/protocol'
import type { ClientMessage, ServerMessage, PawnState, PawnLocomotion, Vec3, WeaponId } from '@blacksite/protocol'

export type { ClientMessage, ServerMessage, PawnState, PawnIntent, PawnLocomotion } from '@blacksite/protocol'
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
const copyLocomotion = (value: PawnLocomotion | undefined): PawnLocomotion | undefined => value && { ...value, relativeAcceleration: { ...value.relativeAcceleration }, mantle: value.mantle && { ...value.mantle }, rolling: value.rolling && { ...value.rolling } }
const applyMovement = (state: PawnState, message: Extract<ClientMessage, { type: 'move' }>): PawnState => ({
  ...state, seq: message.seq, position: { ...message.position }, velocity: { ...message.velocity },
  yaw: message.intent.yaw, pitch: message.intent.pitch, aiming: message.intent.aiming ?? false,
  locomotion: copyLocomotion(message.locomotion),
})

export type Spawn = { position: Vec3; yaw?: number }
export type Obstacle = { min: Vec3; max: Vec3 }
export type MatchOptions = {
  now?: () => number
  spawns?: readonly Spawn[]
  obstacles?: readonly Obstacle[]
  respawnMs?: number
}

export const EYE_HEIGHT = { standing: 1.5, crouching: 1 } as const
export const shotOrigin = (state: PawnState): Vec3 => ({ ...state.position, y: state.position.y + EYE_HEIGHT[state.locomotion?.stance ?? 'standing'] })

function rayBox(origin: Vec3, direction: Vec3, box: Obstacle, maxDistance: number) {
  let near = 0
  let far = maxDistance
  for (const axis of ['x', 'y', 'z'] as const) {
    const d = direction[axis]
    if (Math.abs(d) < 1e-9) { if (origin[axis] < box.min[axis] || origin[axis] > box.max[axis]) return null; continue }
    let a = (box.min[axis] - origin[axis]) / d
    let b = (box.max[axis] - origin[axis]) / d
    if (a > b) [a, b] = [b, a]
    near = Math.max(near, a)
    far = Math.min(far, b)
    if (near > far) return null
  }
  return near
}

function rayCapsule(origin: Vec3, direction: Vec3, bottom: Vec3, top: Vec3, radius: number, maxDistance: number) {
  const axis = subtract(top, bottom)
  const offset = subtract(origin, bottom)
  const e = dot(axis, axis)
  const b = dot(direction, axis)
  const c = dot(direction, offset)
  const f = dot(axis, offset)
  const denominator = e - b * b
  let ray = denominator > 1e-9 ? Math.max(0, (b * f - c * e) / denominator) : Math.max(0, -c)
  let along = (b * ray + f) / e
  if (along < 0) { along = 0; ray = Math.max(0, -c) }
  else if (along > 1) { along = 1; ray = Math.max(0, b - c) }
  const centre = add(bottom, axis, along)
  const gap = distance(add(origin, direction, ray), centre)
  if (gap > radius) return null
  const entry = Math.max(0, ray - Math.sqrt(radius * radius - gap * gap))
  if (entry > maxDistance) return null
  return { distance: entry, point: add(origin, direction, entry) }
}

export function createMatch({ now = Date.now, spawns, obstacles = [], respawnMs = 3000 }: MatchOptions = {}) {
  const world = createWorld()
  const peers = new Map<string, Send>()
  const states = new Map<string, PawnState>()
  const entities = new Map<string, ReturnType<typeof world.spawn>>()
  const weapons = new Map<string, { runtime: WeaponRuntime; startedAt: number; fire?: Vec3; selection?: WeaponId; reload: boolean }>()
  const shotSequence = new Map<string, number>()
  const weaponSequence = new Map<string, number>()
  const deaths = new Map<string, number>()
  let currentTime = now()
  const clock = () => { currentTime = Math.max(currentTime, now()); return currentTime }
  const broadcast = (message: ServerMessage) => { for (const send of peers.values()) send(message) }
  const spawnAt = (index: number): Spawn => spawns?.length ? spawns[index % spawns.length]! : { position: { x: index * 3, y: 0, z: 0 } }
  const clear = (spawn: Spawn) => ![...states.values()].some(state => Math.hypot(state.position.x - spawn.position.x, state.position.z - spawn.position.z) < 3)
  function freeSpawn() {
    const count = spawns?.length ?? Infinity
    for (let index = 0; index < Math.min(count, 64); index++) if (clear(spawnAt(index))) return { spawn: spawnAt(index), index }
    return { spawn: spawnAt(states.size), index: states.size }
  }
  function farthestSpawn(id: string) {
    if (!spawns?.length) return freeSpawn().spawn
    const others = [...states.values()].filter(state => state.id !== id && state.health > 0)
    let best = spawns[0]!
    let bestDistance = -1
    for (const spawn of spawns) {
      const nearest = Math.min(Infinity, ...others.map(state => Math.hypot(state.position.x - spawn.position.x, state.position.z - spawn.position.z)))
      if (nearest > bestDistance) { best = spawn; bestDistance = nearest }
    }
    return best
  }
  function join(id: string, send: Send) {
    if (peers.has(id)) throw new Error('Duplicate player')
    const { spawn, index } = freeSpawn()
    const state: PawnState = { id, owner: id, authority: 'owner', seq: 0, t: clock(), position: { ...spawn.position }, velocity: { x: 0, y: 0, z: 0 }, yaw: spawn.yaw ?? 0, pitch: 0, health: 100, life: 0, weapon: 'rifle', aiming: false }
    send({ type: 'welcome', id, states: [...states.values(), state] })
    peers.set(id, send)
    states.set(id, state)
    entities.set(id, world.spawn(Ownership({ owner: id, authority: 'owner' }), ReplicatedPosition({ ...state.position, seq: 0 }), ReplicatedHealth))
    weapons.set(id, { runtime: createWeaponRuntime({ ownerId: id, seed: index + 1, definitions: ALS_WEAPONS.filter(weapon => weapon.id === 'rifle' || weapon.id === 'pistol') }), startedAt: state.t, reload: false })
    broadcast({ type: 'state', state })
  }
  function leave(id: string) {
    peers.delete(id); states.delete(id); entities.get(id)?.destroy(); entities.delete(id); weapons.get(id)?.runtime.dispose(); weapons.delete(id); shotSequence.delete(id); weaponSequence.delete(id); deaths.delete(id)
    broadcast({ type: 'leave', id })
  }
  function castRay(id: string, query: RayQuery) {
    let nearest: { targetId?: string; distance: number; point: Vec3 } | null = null
    for (const target of states.values()) {
      if (target.id === id || target.health <= 0) continue
      const top = target.locomotion?.stance === 'crouching' ? 1.2 : 1.75
      const hit = rayCapsule(query.origin, query.direction, { ...target.position, y: target.position.y + 0.35 }, { ...target.position, y: target.position.y + top - 0.35 }, 0.42, query.maxDistance)
      if (!hit || nearest && nearest.distance <= hit.distance) continue
      nearest = { targetId: target.id, distance: hit.distance, point: hit.point }
    }
    for (const box of obstacles) {
      const hit = rayBox(query.origin, query.direction, box, nearest?.distance ?? query.maxDistance)
      if (hit === null || nearest && nearest.distance <= hit) continue
      nearest = { distance: hit, point: add(query.origin, query.direction, hit) }
    }
    if (!nearest) return null
    return { colliderId: nearest.targetId ?? 'world', targetId: nearest.targetId, point: nearest.point, normal: { x: -query.direction.x, y: -query.direction.y, z: -query.direction.z }, distance: nearest.distance }
  }
  function applyEvents(id: string, events: readonly WeaponEvent[], time: number) {
    for (const event of events) {
      if (event.type === 'shot') broadcast({ type: 'shot', shooter: id, weapon: event.weaponId as WeaponId, origin: { ...event.origin }, direction: { ...event.direction }, end: { ...event.end } })
      if (event.type === 'switch-started') {
        const previous = states.get(id)!
        const state = { ...previous, weapon: event.weaponId as WeaponId }
        states.set(id, state)
        broadcast({ type: 'state', state })
      }
      if (event.type === 'damage') {
        const target = states.get(event.targetId)
        if (!target) continue
        if (target.health <= 0) continue
        const next = { ...target, health: Math.max(0, target.health - event.amount) }
        states.set(target.id, next)
        entities.get(target.id)?.set(ReplicatedHealth, { value: next.health })
        if (next.health <= 0) deaths.set(target.id, time)
        broadcast({ type: 'hit', shooter: id, target: target.id, damage: event.amount, health: next.health, point: { ...event.point }, direction: { ...event.direction } })
        broadcast({ type: 'state', state: next })
      }
    }
  }
  function respawn(id: string, time: number) {
    deaths.delete(id)
    const previous = states.get(id)
    if (!previous) return
    const spawn = farthestSpawn(id)
    const state: PawnState = { ...previous, t: time, position: { ...spawn.position }, velocity: { x: 0, y: 0, z: 0 }, yaw: spawn.yaw ?? previous.yaw, pitch: 0, health: 100, life: (previous.life ?? 0) + 1, aiming: false, locomotion: undefined }
    states.set(id, state)
    entities.get(id)?.set(ReplicatedPosition, { ...state.position, seq: state.seq })
    entities.get(id)?.set(ReplicatedHealth, { value: state.health })
    broadcast({ type: 'state', state })
  }
  function advance() {
    const time = clock()
    for (const [id, diedAt] of deaths) if (time - diedAt >= respawnMs) respawn(id, time)
    for (const [id, weapon] of weapons) {
      const dueTicks = Math.floor((time - weapon.startedAt) / (weapon.runtime.fixedDeltaSeconds * 1000))
      while (weapon.runtime.snapshot().nextTick < dueTicks) {
        const previous = states.get(id)!
        const origin = shotOrigin(previous)
        const events = weapon.runtime.step({ tick: weapon.runtime.snapshot().nextTick, trigger: !!weapon.fire && previous.health > 0, reload: weapon.reload, selectWeaponId: weapon.selection, aim: { origin, direction: weapon.fire ?? { x: 0, y: 0, z: -1 } }, muzzle: origin }, { castRay: query => castRay(id, query), sweepSphere: () => null })
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
      if (previous.health <= 0) return
      if (raw.seq <= previous.seq || raw.seq > previous.seq + 10000 || distance(raw.position, previous.position) > Math.max(1, Math.min(5, (clock() - previous.t) * 0.02)) || distance(raw.velocity, { x: 0, y: 0, z: 0 }) > 15 || Math.abs(raw.intent.forward) > 1 || Math.abs(raw.intent.right) > 1 || Math.abs(raw.intent.pitch) > 90) {
        peers.get(id)?.({ type: 'rejected', reason: 'invalid movement' }); return
      }
      const state = { ...applyMovement(states.get(id)!, raw), t: clock() }
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
    match.join(id, message => { if (!listeners.size) pending.push(message); queueMicrotask(() => { for (const listener of listeners) listener(message) }) })
    connections++
    timer ??= setInterval(match.advance, 1000 / 60)
    let closed = false
    return { id, send: message => match.receive(id, message), onMessage(listener) { listeners.add(listener); for (const message of pending) listener(message); pending.length = 0; match.sync(id); return () => { listeners.delete(listener) } }, close() {
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
  const blendYaw = (x: number, y: number) => x + (((y - x + 180) % 360 + 360) % 360 - 180) * alpha
  const locomotion = a.locomotion && b.locomotion ? {
    ...b.locomotion,
    actorYaw: blendYaw(a.locomotion.actorYaw, b.locomotion.actorYaw),
    inputYaw: blendYaw(a.locomotion.inputYaw, b.locomotion.inputYaw),
    targetYaw: blendYaw(a.locomotion.targetYaw, b.locomotion.targetYaw),
    relativeAcceleration: { x: blend(a.locomotion.relativeAcceleration.x, b.locomotion.relativeAcceleration.x), y: blend(a.locomotion.relativeAcceleration.y, b.locomotion.relativeAcceleration.y) },
  } : copyLocomotion(b.locomotion)
  return { ...b, position: { x: blend(a.position.x, b.position.x), y: blend(a.position.y, b.position.y), z: blend(a.position.z, b.position.z) }, velocity: { x: blend(a.velocity.x, b.velocity.x), y: blend(a.velocity.y, b.velocity.y), z: blend(a.velocity.z, b.velocity.z) }, yaw: blendYaw(a.yaw, b.yaw), pitch: blend(a.pitch, b.pitch), locomotion }
}

export function createReplica(connection: Connection, reconcile?: (authoritative: PawnState, pending: ClientMessage[]) => void, { closeConnection = true }: { closeConnection?: boolean } = {}) {
  const world = createWorld()
  let closed = false
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
          states.set(connection.id, applyMovement(message.state, latest))
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
      if (previous) { states.set(connection.id, applyMovement(previous, message)); entities.get(connection.id)?.set(ReplicatedPosition, { ...message.position, seq: message.seq }) }
    }
    connection.send(message)
  }, sample(id: string, time: number) { const pair = history.get(id); return pair ? interpolate(pair[0], pair[1], time) : states.get(id) }, onMessage(listener: (message: ServerMessage) => void) { listeners.add(listener); return () => { listeners.delete(listener) } }, close() { if (closed) return; closed = true; unsubscribe(); if (closeConnection) connection.close(); world.destroy() } }
}
