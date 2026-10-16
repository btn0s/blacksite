import { createReplica, type Connection } from '@blacksite/relay'
import type { SubjectState } from './controller'

export function createMultiplayerSession(connection: Connection, subject: SubjectState) {
  return {
    connect(onReady: (replica: ReturnType<typeof createReplica>) => void) {
      const replica = createReplica(connection, state => {
        if (subject.frame.ready && subject.frame.position.distanceToSquared(state.position) > 4) subject.respawn([state.position.x, state.position.y, state.position.z], state.yaw)
      }, { closeConnection: false })
      let ready = false
      const publish = () => {
        const own = replica.states.get(connection.id)
        if (ready || !own) return
        subject.respawn([own.position.x, own.position.y, own.position.z], own.yaw)
        ready = true
        onReady(replica)
      }
      const unsubscribe = replica.onMessage(publish)
      publish()
      return () => { unsubscribe(); replica.close() }
    },
  }
}
