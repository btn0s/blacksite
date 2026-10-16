import { afterEach, expect, test } from 'vitest'
import { createServer } from 'node:net'
import { createLoopbackRoom, createMatch, createReplica, interpolate, Ownership, ReplicatedPosition, projectTrait } from './index'
import { createColyseusTransport } from './colyseus'
import { startMatchServer } from './server'
import type { Server } from '@colyseus/core'
import { isClientMessage } from '@blacksite/protocol'
import type { ClientMessage, PawnLocomotion, PawnState, ServerMessage } from '@blacksite/protocol'

const servers: Server[] = []
afterEach(async () => { for (const server of servers.splice(0)) await server.gracefullyShutdown(false) })
const wait = (replica: ReturnType<typeof createReplica>, predicate: (message: ServerMessage) => boolean) => new Promise<ServerMessage>((resolve, reject) => {
  const timer = setTimeout(() => { off(); reject(new Error('Timed out waiting for relay message')) }, 3000)
  const off = replica.onMessage(message => { if (predicate(message)) { clearTimeout(timer); off(); resolve(message) } })
})
const freePort = () => new Promise<number>((resolve, reject) => { const socket = createServer(); socket.once('error', reject); socket.listen(0, '127.0.0.1', () => { const address = socket.address(); if (!address || typeof address === 'string') return reject(new Error('No port')); socket.close(() => resolve(address.port)) }) })

test('replicated traits, ownership and interpolation', async () => {
  const match = createMatch()
  const transport = createLoopbackRoom(match)
  const a = createReplica(await transport.connect())
  const b = createReplica(await transport.connect())
  expect(a.states.size).toBe(2)
  expect(b.states.size).toBe(2)
  expect(a.world.query(Ownership).length).toBe(2)
  expect(a.entities.get(a.id)?.get(ReplicatedPosition)?.x).toBe(0)
  expect(projectTrait({ owner: a.id }, 'owner-only', a.id, b.id, true)).toBeUndefined()
  expect(projectTrait({ owner: a.id }, 'initial-only', a.id, a.id, false)).toBeUndefined()
  const first = a.states.get(a.id)!
  const moved = wait(b, message => message.type === 'state' && message.state.id === a.id && message.state.seq === 1)
  a.send({ type: 'move', seq: 1, position: { x: 0.5, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 }, intent: { forward: 1, right: 0, jump: false, yaw: 0, pitch: 0 } })
  const message = await moved
  if (message.type !== 'state') throw new Error('Missing state')
  const middle = interpolate(first, message.state, (first.t + message.state.t) / 2)
  expect(middle.position.x).toBeGreaterThanOrEqual(0)
  expect(middle.position.x).toBeLessThanOrEqual(0.5)
  const rejected = wait(b, message => message.type === 'rejected')
  b.send({ type: 'move', seq: 2, position: { x: 50, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, intent: { forward: 0, right: 0, jump: false, yaw: 0, pitch: 0 } })
  await rejected
  expect(match.states.get(b.id)?.position.x).toBe(3)
  a.close(); b.close()
})

test('loopback and in-process Colyseus share movement and server hit policy', async () => {
  const port = await freePort()
  const server = await startMatchServer(port)
  servers.push(server)
  for (const transport of [createLoopbackRoom(), createColyseusTransport(`http://127.0.0.1:${port}`)]) {
    const a = createReplica(await transport.connect())
    const b = createReplica(await transport.connect())
    if (b.states.size < 2) await wait(b, message => message.type === 'welcome' && message.states.length === 2)
    const moved = wait(b, message => message.type === 'state' && message.state.id === a.id && message.state.seq === 1)
    a.send({ type: 'move', seq: 1, position: { x: 0.5, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 }, intent: { forward: 1, right: 0, jump: false, yaw: 0, pitch: 0 } })
    const state = await moved as Extract<ServerMessage, { type: 'state' }>
    expect(state.state.position.x).toBe(0.5)
    const hit = wait(b, message => message.type === 'hit' && message.target === b.id)
    a.send({ type: 'fire', seq: 1, direction: { x: 1, y: 0, z: 0 } })
    const result = await hit as Extract<ServerMessage, { type: 'hit' }>
    expect(result.health).toBeLessThan(100)
    a.close(); b.close()
  }
})


test('weapon time follows elapsed server time and packet floods cannot bypass cadence', () => {
  let time = 0
  const match = createMatch({ now: () => time })
  const messages: ServerMessage[] = []
  match.join('a', message => messages.push(message))
  match.join('b', () => {})
  for (let seq = 0; seq < 100; seq++) match.receive('a', { type: 'fire', seq, direction: { x: 1, y: 0, z: 0 } })
  expect(match.states.get('b')!.health).toBe(100)
  time = 17
  match.advance()
  expect(match.states.get('b')!.health).toBe(76)
  for (let seq = 100; seq < 200; seq++) match.receive('a', { type: 'fire', seq, direction: { x: 1, y: 0, z: 0 } })
  time = 34
  match.advance()
  expect(match.states.get('b')!.health).toBe(76)
  time = 100
  match.receive('a', { type: 'fire', seq: 200, direction: { x: 1, y: 0, z: 0 } })
  time = 117
  match.advance()
  expect(match.states.get('b')!.health).toBe(52)
  match.receive('a', { type: 'fire', seq: 200, direction: { x: 1, y: 0, z: 0 } })
  expect(messages.at(-1)).toEqual({ type: 'rejected', reason: 'invalid shot' })
  time = -100
  match.advance()
  expect(match.states.get('b')!.health).toBe(52)
  match.leave('a'); match.leave('b')
})

test('authoritative pistol equip and reload use wall time and replicate weapon and aim', () => {
  let time = 0
  const match = createMatch({ now: () => time })
  const messages: ServerMessage[] = []
  match.join('a', message => messages.push(message))
  match.join('b', () => {})
  match.receive('a', { type: 'weapon', seq: 1, weapon: 'pistol', reload: false })
  time = 17
  match.advance()
  expect(match.states.get('a')!.weapon).toBe('pistol')
  match.receive('a', { type: 'fire', seq: 1, direction: { x: 1, y: 0, z: 0 } })
  time = 34
  match.advance()
  expect(match.states.get('b')!.health).toBe(100)
  time = 200
  match.receive('a', { type: 'fire', seq: 2, direction: { x: 1, y: 0, z: 0 } })
  time = 217
  match.advance()
  expect(match.states.get('b')!.health).toBe(62)
  match.receive('a', { type: 'weapon', seq: 2, weapon: 'pistol', reload: true })
  time = 234
  match.advance()
  time = 1000
  match.receive('a', { type: 'fire', seq: 3, direction: { x: 1, y: 0, z: 0 } })
  time = 1017
  match.advance()
  expect(match.states.get('b')!.health).toBe(62)
  time = 1600
  match.receive('a', { type: 'fire', seq: 4, direction: { x: 1, y: 0, z: 0 } })
  time = 1617
  match.advance()
  expect(match.states.get('b')!.health).toBe(24)
  match.receive('a', { type: 'move', seq: 1, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, intent: { forward: 0, right: 0, jump: false, yaw: 0, pitch: 0, aiming: true } })
  expect(match.states.get('a')).toMatchObject({ weapon: 'pistol', aiming: true })
  match.receive('a', { type: 'weapon', seq: 2, weapon: 'rifle', reload: false })
  expect(messages.at(-1)).toEqual({ type: 'rejected', reason: 'invalid weapon sequence' })
  time = 1700
  match.advance()
  expect(match.states.get('a')!.weapon).toBe('pistol')
  match.leave('a'); match.leave('b')
})

test('weapon and aiming protocol fields reject malformed messages', () => {
  expect(isClientMessage({ type: 'weapon', seq: 1, weapon: 'pistol', reload: false })).toBe(true)
  for (const message of [
    { type: 'weapon', seq: 1, weapon: 'bow', reload: false },
    { type: 'weapon', seq: 1, weapon: 'rifle', reload: 1 },
    { type: 'weapon', seq: -1, weapon: 'rifle', reload: false },
    { type: 'weapon', seq: NaN, weapon: 'pistol', reload: true },
    { type: 'move', seq: 1, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, intent: { forward: 0, right: 0, jump: false, yaw: 0, pitch: 0, aiming: 1 } },
  ]) expect(isClientMessage(message)).toBe(false)
})

test('new peers take an available spawn after departures and avoid occupied moved positions', () => {
  let time = 0
  const match = createMatch({ now: () => time })
  match.join('a', () => {})
  match.join('b', () => {})
  expect(match.states.get('a')!.position.x).toBe(0)
  expect(match.states.get('b')!.position.x).toBe(3)
  match.leave('a')
  match.join('c', () => {})
  expect(match.states.get('c')!.position.x).toBe(0)
  match.leave('c')
  time = 200
  match.receive('b', { type: 'move', seq: 1, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, intent: { forward: 0, right: 0, jump: false, yaw: 0, pitch: 0 } })
  expect(match.states.get('b')!.position.x).toBe(0)
  match.join('d', () => {})
  expect(match.states.get('d')!.position.x).toBe(3)
  match.leave('b'); match.leave('d')
})

test('detaching and reattaching a replica requests a fresh snapshot without closing its transport', async () => {
  const port = await freePort()
  servers.push(await startMatchServer(port))
  for (const transport of [createLoopbackRoom(), createColyseusTransport(`http://127.0.0.1:${port}`)]) {
    const first = await transport.connect()
    const connection = await transport.connect()
    let replica = createReplica(connection, undefined, { closeConnection: false })
    try {
      if (!replica.states.has(connection.id)) await wait(replica, message => message.type === 'welcome')
      expect(replica.states.get(connection.id)!.position.x).toBe(3)
      replica.close()
      replica = createReplica(connection, undefined, { closeConnection: false })
      if (!replica.states.has(connection.id)) await wait(replica, message => message.type === 'welcome')
      expect(replica.states.get(connection.id)!.position.x).toBe(3)
    } finally { replica.close(); connection.close(); first.close() }
  }
})

const locomotion: PawnLocomotion = {
  gait: 'running', stance: 'standing', mode: 'grounded', actorYaw: 175,
  rotationMode: 'viewDirection', hasInput: true, inputYaw: 170, targetYaw: 178,
  relativeAcceleration: { x: 0.4, y: -0.2 },
}

const movement = (seq = 1): Extract<ClientMessage, { type: 'move' }> => ({
  type: 'move', seq, position: { x: 0.5, y: 0, z: 0 }, velocity: { x: 3.75, y: 0, z: 0 },
  intent: { forward: 1, right: 0, jump: false, yaw: -179, pitch: 20, aiming: true },
  locomotion: structuredClone(locomotion),
})

test('locomotion protocol accepts legacy moves and rejects malformed locomotion', () => {
  expect(isClientMessage(movement())).toBe(true)
  expect(isClientMessage({ ...movement(), locomotion: undefined })).toBe(true)
  for (const invalid of [
    null, {}, { ...locomotion, gait: 'idle' }, { ...locomotion, stance: 'prone' },
    { ...locomotion, mode: 'flying' }, { ...locomotion, rotationMode: 'camera' },
    { ...locomotion, actorYaw: Infinity }, { ...locomotion, inputYaw: NaN },
    { ...locomotion, targetYaw: '0' }, { ...locomotion, hasInput: 1 },
    { ...locomotion, relativeAcceleration: null },
    { ...locomotion, relativeAcceleration: { x: 0, y: Infinity } },
    { ...locomotion, relativeAcceleration: { x: 1.01, y: 0 } },
  ]) expect(isClientMessage({ ...movement(), locomotion: invalid })).toBe(false)
})

test('loopback and Colyseus replicate actual locomotion independently from view yaw', async () => {
  const port = await freePort()
  servers.push(await startMatchServer(port))
  for (const transport of [createLoopbackRoom(), createColyseusTransport(`http://127.0.0.1:${port}`)]) {
    const a = createReplica(await transport.connect())
    const b = createReplica(await transport.connect())
    try {
      if (b.states.size < 2) await wait(b, message => message.type === 'welcome' && message.states.length === 2)
      for (const [index, mode] of ['grounded', 'inAir'].entries()) {
        const message = movement(index + 1)
        message.locomotion = { ...locomotion, mode: mode as PawnLocomotion['mode'], stance: index === 0 ? 'crouching' : 'standing', gait: index === 0 ? 'walking' : 'sprinting' }
        const received = wait(b, event => event.type === 'state' && event.state.id === a.id && event.state.seq === message.seq)
        a.send(message)
        await received
        expect(b.states.get(a.id)).toMatchObject({ yaw: -179, pitch: 20, aiming: true, velocity: message.velocity, locomotion: message.locomotion })
      }
    } finally { a.close(); b.close() }
  }
})

test('match owns a copy of locomotion and legacy moves clear obsolete state', () => {
  const match = createMatch()
  const events: ServerMessage[] = []
  match.join('a', event => events.push(event))
  const message = movement()
  match.receive('a', message)
  expect(match.states.get('a')?.locomotion).toEqual(locomotion)
  message.locomotion!.relativeAcceleration.x = -1
  message.locomotion!.gait = 'walking'
  expect(match.states.get('a')?.locomotion).toEqual(locomotion)
  match.receive('a', { ...movement(2), locomotion: { ...locomotion, actorYaw: NaN } })
  expect(events.at(-1)).toEqual({ type: 'rejected', reason: 'invalid or unowned message' })
  expect(match.states.get('a')?.seq).toBe(1)
  match.receive('a', { ...movement(2), locomotion: undefined })
  expect(match.states.get('a')?.locomotion).toBeUndefined()
  match.leave('a')
})

test('replica interpolation crosses wrapped actor, input and view yaw without full turns', () => {
  const match = createMatch({ now: () => 1000 })
  match.join('a', () => {})
  const a: PawnState = { ...match.states.get('a')!, yaw: 179, locomotion: { ...locomotion, actorYaw: 179, inputYaw: -179, targetYaw: 179 } }
  const b: PawnState = { ...a, t: 1050, yaw: -179, locomotion: { ...locomotion, actorYaw: -179, inputYaw: 179, targetYaw: -179, relativeAcceleration: { x: 0.8, y: 0.2 } } }
  const midpoint = interpolate(a, b, 1025)
  expect(Math.abs(midpoint.yaw)).toBeCloseTo(180)
  expect(Math.abs(midpoint.locomotion!.actorYaw)).toBeCloseTo(180)
  expect(Math.abs(midpoint.locomotion!.inputYaw)).toBeCloseTo(180)
  expect(Math.abs(midpoint.locomotion!.targetYaw)).toBeCloseTo(180)
  expect(midpoint.locomotion!.relativeAcceleration.x).toBeCloseTo(0.6)
  expect(midpoint.locomotion!.relativeAcceleration.y).toBeCloseTo(0)
  expect(interpolate({ ...a, locomotion: undefined }, b, 1025).locomotion).toEqual(b.locomotion)
  expect(interpolate(a, { ...b, locomotion: undefined }, 1025).locomotion).toBeUndefined()
  match.leave('a')
})

test('predicted and unacknowledged moves keep their own locomotion and view state', () => {
  const initial: PawnState = { id: 'a', owner: 'a', authority: 'owner', seq: 0, t: 0, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, health: 100 }
  let receive: (message: ServerMessage) => void = () => {}
  const replica = createReplica({ id: 'a', send() {}, close() {}, onMessage(listener) { receive = listener; listener({ type: 'welcome', id: 'a', states: [initial] }); return () => {} } })
  const first = movement(1)
  const second = movement(2)
  second.locomotion = { ...locomotion, gait: 'sprinting', mode: 'inAir', actorYaw: -160 }
  second.intent = { ...second.intent, yaw: -155, pitch: 30, aiming: false }
  replica.send(first)
  replica.send(second)
  expect(replica.states.get('a')).toMatchObject({ seq: 2, yaw: -155, pitch: 30, aiming: false, locomotion: second.locomotion })
  receive({ type: 'state', state: { ...initial, seq: 1, locomotion: first.locomotion } })
  expect(replica.states.get('a')).toMatchObject({ seq: 2, yaw: -155, pitch: 30, aiming: false, locomotion: second.locomotion })
  replica.close()
})

test('spawns, cover and respawn follow the match options', () => {
  let time = 0
  const match = createMatch({ now: () => time, spawns: [{ position: { x: -10, y: 0, z: 0 }, yaw: 0 }, { position: { x: 10, y: 0, z: 0 }, yaw: 180 }], obstacles: [{ min: { x: -1, y: 0, z: -2 }, max: { x: 1, y: 3, z: 2 } }], respawnMs: 500 })
  const messages: ServerMessage[] = []
  match.join('a', message => messages.push(message))
  match.join('b', () => {})
  expect(match.states.get('a')!.position.x).toBe(-10)
  expect(match.states.get('b')!.position).toEqual({ x: 10, y: 0, z: 0 })
  expect(match.states.get('b')!.yaw).toBe(180)
  match.receive('a', { type: 'fire', seq: 0, direction: { x: 1, y: 0, z: 0 } })
  time = 17
  match.advance()
  expect(match.states.get('b')!.health).toBe(100)
  expect(messages.some(message => message.type === 'shot' && message.shooter === 'a')).toBe(true)
  time = 300
  match.receive('b', { type: 'move', seq: 1, position: { x: 10, y: 0, z: 3 }, velocity: { x: 0, y: 0, z: 0 }, intent: { forward: 0, right: 0, jump: false, yaw: 0, pitch: 0 } })
  match.receive('a', { type: 'move', seq: 1, position: { x: -10, y: 0, z: 3 }, velocity: { x: 0, y: 0, z: 0 }, intent: { forward: 0, right: 0, jump: false, yaw: 0, pitch: 0 } })
  for (let shot = 1; shot <= 5; shot++) {
    match.receive('a', { type: 'fire', seq: shot, direction: { x: 1, y: 0, z: 0 } })
    time += 120
    match.advance()
  }
  expect(match.states.get('b')!.health).toBe(0)
  const kill = messages.filter(message => message.type === 'hit').at(-1) as Extract<ServerMessage, { type: 'hit' }>
  expect(kill.point!.x).toBeGreaterThan(9)
  expect(kill.direction!.x).toBeGreaterThan(0.99)
  match.receive('b', { type: 'move', seq: 2, position: { x: 10, y: 0, z: 3.2 }, velocity: { x: 0, y: 0, z: 0 }, intent: { forward: 0, right: 0, jump: false, yaw: 0, pitch: 0 } })
  expect(match.states.get('b')!.position.z).toBe(3)
  time += 600
  match.advance()
  const revived = match.states.get('b')!
  expect(revived.health).toBe(100)
  expect(revived.life).toBe(1)
  expect(revived.position.x).toBe(10)
})

test('weapon switches keep the movement timestamp so remotes never step back', () => {
  let time = 0
  const match = createMatch({ now: () => time })
  const states: PawnState[] = []
  match.join('a', () => {})
  match.join('b', message => { if (message.type === 'state' && message.state.id === 'a') states.push(message.state) })
  time = 50
  match.receive('a', { type: 'move', seq: 1, position: { x: 0.5, y: 0, z: 0 }, velocity: { x: 10, y: 0, z: 0 }, intent: { forward: 1, right: 0, jump: false, yaw: 0, pitch: 0 } })
  match.receive('a', { type: 'weapon', seq: 0, weapon: 'pistol', reload: false })
  time = 80
  match.advance()
  const switched = states.at(-1)!
  expect(switched.weapon).toBe('pistol')
  expect(switched.t).toBe(50)
})

test('mantle and roll presentation survive the wire and malformed actions are rejected', () => {
  const locomotion: PawnLocomotion = { gait: 'running', stance: 'standing', mode: 'grounded', actorYaw: 0, rotationMode: 'viewDirection', hasInput: true, inputYaw: 0, targetYaw: 0, relativeAcceleration: { x: 0, y: 0 }, action: 'mantle', actionSeq: 3, mantle: { settings: 'High', position: 0.4 } }
  const move = { type: 'move', seq: 1, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, intent: { forward: 0, right: 0, jump: false, yaw: 0, pitch: 0 }, locomotion }
  expect(isClientMessage(move)).toBe(true)
  expect(isClientMessage({ ...move, locomotion: { ...locomotion, action: 'teleport' } })).toBe(false)
  expect(isClientMessage({ ...move, locomotion: { ...locomotion, actionSeq: -1 } })).toBe(false)
  expect(isClientMessage({ ...move, locomotion: { ...locomotion, mantle: { settings: 'x'.repeat(65), position: 0 } } })).toBe(false)
  const match = createMatch()
  match.join('a', () => {})
  match.receive('a', move)
  locomotion.mantle!.position = 0.9
  expect(match.states.get('a')!.locomotion!.mantle).toEqual({ settings: 'High', position: 0.4 })
  expect(match.states.get('a')!.locomotion!.actionSeq).toBe(3)
})
