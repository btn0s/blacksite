import { createColyseusTransport } from '../packages/relay/src/colyseus'
import { createReplica } from '../packages/relay/src/index'
import type { ServerMessage } from '../packages/protocol/src/index'

const endpoint = process.env.RELAY_URL ?? 'http://127.0.0.1:5173/relay'
const transport = createColyseusTransport(endpoint)
const a = createReplica(await transport.connect())
const b = createReplica(await transport.connect())
const wait = (predicate: (message: ServerMessage) => boolean) => new Promise<ServerMessage>((resolve, reject) => {
  const timer = setTimeout(() => { off(); reject(new Error('Relay smoke timed out')) }, 5000)
  const off = b.onMessage(message => { if (predicate(message)) { clearTimeout(timer); off(); resolve(message) } })
})
try {
  if (b.states.size < 2) await wait(message => message.type === 'welcome' && message.states.length === 2)
  const before = b.states.get(a.id)
  if (!before) throw new Error('First player missing')
  const moved = wait(message => message.type === 'state' && message.state.id === a.id && message.state.seq === 1)
  a.send({ type: 'move', seq: 1, position: { x: before.position.x + 0.5, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 }, intent: { forward: 1, right: 0, jump: false, yaw: 0, pitch: 0 } })
  const state = await moved
  if (state.type !== 'state') throw new Error('Movement not replicated')
  const sampled = b.sample(a.id, (before.t + state.state.t) / 2)
  if (!sampled || sampled.position.x < before.position.x || sampled.position.x > state.state.position.x) throw new Error('Interpolation failed')
  const hit = wait(message => message.type === 'hit' && message.target === b.id)
  a.send({ type: 'fire', seq: 1, direction: { x: 1, y: 0, z: 0 } })
  const result = await hit
  if (result.type !== 'hit' || result.health >= 100) throw new Error('Server hit validation failed')
  process.stdout.write(`Two clients moved and hit in ${endpoint}\n`)
} finally { a.close(); b.close() }
