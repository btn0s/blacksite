import { Server } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { MatchRoom } from './MatchRoom'

export async function startMatchServer(port = 2567) {
  const server = new Server({ transport: new WebSocketTransport() })
  server.define('match', MatchRoom)
  await server.listen(port)
  return server
}
