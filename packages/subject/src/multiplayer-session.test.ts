import { expect, it, vi } from 'vitest'
import { createLoopbackRoom, type Connection, type ServerMessage } from '@blacksite/relay'
import { createSubject } from './controller'
import { createMultiplayerSession } from './multiplayer-session'

it('abandoned pre-commit sessions do not drain welcome, and committed reconnects retain the owner spawn', async () => {
  const room = createLoopbackRoom()
  const first = await room.connect()
  const second = await room.connect()
  const subscribe = vi.spyOn(second, 'onMessage')
  const close = vi.spyOn(second, 'close')
  createMultiplayerSession(second, createSubject())
  createMultiplayerSession(second, createSubject())
  expect(subscribe).not.toHaveBeenCalled()
  const subject = createSubject()
  const session = createMultiplayerSession(second, subject)
  const positions: number[][] = []
  let disconnect = session.connect(() => positions.push([...subject.player.spawn]))
  try {
    await Promise.resolve()
    expect(positions).toEqual([[3, 0, 0]])
    expect(subscribe).toHaveBeenCalledTimes(1)
    disconnect()
    expect(close).not.toHaveBeenCalled()
    disconnect = session.connect(() => positions.push([...subject.player.spawn]))
    await Promise.resolve()
    expect(positions).toEqual([[3, 0, 0], [3, 0, 0]])
    expect(subscribe).toHaveBeenCalledTimes(2)
  } finally { disconnect(); second.close(); first.close() }
})

it('does not expose the character until its own authoritative snapshot arrives', () => {
  let receive: ((message: ServerMessage) => void) | undefined
  const connection: Connection = { id: 'owner', send() {}, close() {}, onMessage(listener) { receive = listener; return () => { receive = undefined } } }
  const subject = createSubject()
  const ready = vi.fn(() => [...subject.player.spawn])
  const disconnect = createMultiplayerSession(connection, subject).connect(ready)
  try {
    expect(ready).not.toHaveBeenCalled()
    receive!({ type: 'welcome', id: 'owner', states: [{ id: 'owner', owner: 'owner', authority: 'owner', seq: 0, t: 1, position: { x: 3, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, health: 100 }] })
    expect(ready).toHaveBeenCalledTimes(1)
    expect(ready.mock.results[0]!.value).toEqual([3, 0, 0])
  } finally { disconnect() }
})
