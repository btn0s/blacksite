# Multiplayer

Relay (`@blacksite/relay`) is the replication seam: a transport-agnostic match authority, client prediction and reconciliation, interpolation, and two transports, Colyseus and an in-memory loopback. `@blacksite/subject` mounts it as `MultiplayerSubject` or `MultiplayerScene` with first-person arms, ALS remote bodies and Armory hits checked on the server.

## Guides

- `packages/relay/AGENTS.md`: the v0 contract and what it doesn't do.
- `docs/player-templates.md`: the `mp` profile, `/relay`, the offline loopback, `LoopbackSplitView` and `cameraMode`.
- `templates/multiplayer-server/README.md`: the scaffolded server.
- `vendor/als-web/docs/guide/recipes/remote.md`: remote ALS bodies.
- `site/src/showcases/multiplayer/` (Arena): loopback plus a bot, with snapshots, interpolation and server hits.
- `architecture.md`: the Controller → Pawn → Intent model and transport choice.

## Standard use

- Scaffold with `--profile mp`. `pnpm dev` runs the Colyseus match server on port 2567 and Vite together; Vite proxies `/relay` with WebSocket upgrades.
- Client: `createColyseusTransport(import.meta.env.VITE_RELAY_URL || \`${location.origin}/relay\`)`, or `createLoopbackRoom()` offline, then `connect()`.
- Mount `<MultiplayerSubject connection={…} cameraMode="switchable" />`, or `<MultiplayerScene>` inside your own canvas.
- Server: `startMatchServer(port)` from `@blacksite/relay/server`; `createMatch({ spawns, obstacles, respawnMs })` for the level.

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

## What isn't there yet

- **No lag compensation.** Hits test current server positions, so a fast mover at 100 ms of latency is hard to hit. Shipped shooters rewind targets to the shooter's view time; add a position history per player and rewind before the ray.
- No interest management, delta encoding, reconnection, clock sync, lobbies, teams, scoring or authentication.
- Movement is owner-authored and bounds-checked; only hits are authoritative.
- `PawnState.t` is the server's clock compared against the client's. It works in loopback and drifts over a real network.
- The online `MatchRoom` has no level geometry, so its rays ignore cover. Pass obstacles.
- The deploy templates are incomplete (`ship.md`).

## Rules, and the failures that taught them

- **A new life is a new remote.** Remotes interpolated across the map on respawn until a `life` epoch remounted them with a fresh buffer. A weapon switch that bumped the time without the matching position made remotes snap back on every switch.
- **Name the anchor and unit on the wire.** The old path treated the mesh root as the capsule's feet and placed remotes 2 cm low. Multiplying velocity by 100 would have been wrong: the graph converts already.
- **Remotes subscribe themselves.** One snapshot re-rendered the whole remote set at 40 Hz until each remote, keyed by `id#life`, subscribed to its own replica.
- **Replicate actions.** Remotes slid up walls when mantling because the move message hard-coded action `'none'`.
- **Subscribe after commit.** A subscription made during render lost the welcome message in a discarded Suspense render.
