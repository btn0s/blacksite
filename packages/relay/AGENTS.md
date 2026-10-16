# Relay v0

Relay shares typed messages and a match authority between Colyseus and loopback. `createLoopbackRoom()` returns an in-memory transport; call `connect()` twice for two peers sharing one authority. Camera presentation is local and absent from the protocol. Movement is owner authored and server bounded; Armory validates hits on the server. Snapshots are full state messages. Optional locomotion state preserves the owner's gait, stance, grounded state, body rotation, and acceleration for remote animation; position and velocity use metres and metres per second. Interest management, lag compensation, delta encoding, reconnection, and network clock synchronization are not implemented yet.

Keep the package transport agnostic at its match boundary. Contract tests cover the engine seam.
