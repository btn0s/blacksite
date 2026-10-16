import { Room, type Client } from '@colyseus/core'
import { createMatch } from './index'

export class MatchRoom extends Room {
  maxClients = 16
  private match = createMatch()
  onCreate() {
    this.setSimulationInterval(() => this.match.advance(), 1000 / 60)
    this.onMessage('relay', (client: Client, message: unknown) => this.match.receive(client.sessionId, message))
    this.onMessage('sync', (client: Client) => this.match.sync(client.sessionId))
  }
  onJoin(client: Client) { this.match.join(client.sessionId, message => client.send('relay', message)) }
  onLeave(client: Client) { this.match.leave(client.sessionId) }
}
