# Multiplayer

Netcode that feels local: your own movement answers instantly, other players move smoothly a little in the past, and a hit lands where you aimed when you aimed. Wiring for Relay, Blacksite's replication layer, is in [building-blocks.md](building-blocks.md#multiplayer-relay); the state ownership model and transport choice are in [architecture.md](architecture.md).

## Numbers

| Number | Value |
|---|---|
| Server tick | 60 Hz |
| Client move rate | 20 Hz |
| Remote interpolation delay | 100 ms |
| Players per room | 16 |
| Reconcile snap | Over 2 m of disagreement |
| Movement bounds | ≤ 15 m/s, displacement clamped by elapsed time |
| Respawn | 3 s, at the farthest spawn |
| Hit capsule | Radius 0.42 m, 1.75 m standing, 1.2 m crouched |

## What shipped shooters do

- **Predict your own movement, interpolate everyone else's.** The local player moves at once and reconciles with the server; remotes are drawn 100 ms in the past between two known snapshots.
- **The server owns hits.** Movement can be owner-authored and bounds-checked, but hits, damage, score and inventory belong to the server.
- **Rewind for hits.** Without lag compensation, hits test current server positions, so a fast mover at 100 ms of latency is hard to hit. Shipped shooters rewind targets to the shooter's view time: keep a position history per player and rewind before the ray. Relay doesn't do this yet.
- **Tell the user what's missing** before calling a multiplayer game ready for strangers: Relay has no lag compensation, interest management, delta encoding, reconnection or clock sync.

## Rules, and the failures that taught them

- **Replicate the recorded state.** The first remote pawn guessed running below 4 m/s, forced standing and grounded, and set the body's yaw to the view's. It failed 6 of 12 cases. Send gait, stance, grounded, rotation mode, body and view yaw, and actions.
- **Replicate actions.** Remotes slid up walls when mantling because the move message hard-coded action `'none'`.
- **A new life is a new remote.** Remotes interpolated across the map on respawn until a `life` epoch remounted them with a fresh buffer. A weapon switch that bumped the time without the matching position made remotes snap back on every switch.
- **Name the anchor and unit on the wire.** The old path treated the mesh root as the capsule's feet and placed remotes 2 cm low. Multiplying velocity by 100 would have been wrong: the graph converts already.
- **Server rays see cover.** Arena's hits went through cover until server rays tested obstacles. The online room has no level geometry unless you pass obstacles.
- **Step on elapsed time.** A server weapon simulation that advanced two ticks per received shot drifted from the clients'.
- **Remotes subscribe themselves.** One snapshot re-rendered the whole remote set at 40 Hz until each remote, keyed by `id#life`, subscribed to its own replica.
- **Subscribe after commit.** A subscription made during a Suspense render lost the welcome message when React threw that render away. The player spawned at the origin inside another, and neither could move.
