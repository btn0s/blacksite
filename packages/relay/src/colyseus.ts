import { Client as ColyseusClient, type Room as ClientRoom } from '@colyseus/sdk'
import type { ClientMessage, ServerMessage } from '@blacksite/protocol'
import type { Connection, Transport } from './index'

export function createColyseusTransport(endpoint = 'http://localhost:2567'): Transport {
  return { async connect(): Promise<Connection> {
    const room: ClientRoom = await new ColyseusClient(endpoint).joinOrCreate('match')
    const listeners = new Set<(message: ServerMessage) => void>()
    const pending: ServerMessage[] = []
    room.onMessage('relay', (message: ServerMessage) => { if (!listeners.size) pending.push(message); for (const listener of listeners) listener(message) })
    room.send('sync')
    return { id: room.sessionId, send(message: ClientMessage) { room.send('relay', message) }, onMessage(listener) { listeners.add(listener); for (const message of pending) listener(message); pending.length = 0; return () => { listeners.delete(listener) } }, close() { void room.leave() } }
  } }
}
