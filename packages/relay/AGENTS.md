# Relay v0

Relay shares typed messages and a match authority between Colyseus and loopback. `createLoopbackRoom()` returns an in-memory transport; call `connect()` twice for two peers sharing one authority. Camera presentation is local and absent from the protocol. Movement is owner authored and server bounded; Armory validates hits on the server. Snapshots are full state messages. Interest management, lag compensation, delta encoding, reconnection, network clock synchronization, and remote animation payloads are not implemented yet.

Keep the package transport agnostic at its match boundary. Contract tests cover the engine seam.
