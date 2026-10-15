import { afterEach, expect, test } from 'vitest'
import { createServer } from 'node:net'
import { createLoopbackRoom, createMatch, createReplica, interpolate, Ownership, ReplicatedPosition, projectTrait } from './index'
import { createColyseusTransport } from './colyseus'
import { startMatchServer } from './server'
import type { Server } from '@colyseus/core'
import { isClientMessage } from '@blacksite/protocol'
import type { ServerMessage } from '@blacksite/protocol'

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
