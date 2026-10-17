# Architecture

Who owns which state in a Blacksite game: entities and data, transitions, services, the tick and the wire. Use this ownership map for generated games and prototypes. Koota owns entity identity and all gameplay data. XState owns discrete transitions: weapon, life, seat, app, and room phases. Effect owns services, decoding, typed errors, streams, retries, and resource lifetime through Layers and Scope. Colyseus owns transport and projections. The 60 Hz tick is plain synchronous code.

| Need | Owner | Never place it in |
| --- | --- | --- |
| Position, health, ammo, team, inventory, cooldown deadline | Koota trait | React state, XState context shadow copy |
| Alive/dead, reload phase, seat occupancy, room phase | XState actor | Per-frame switch spread across components |
| Input listener, asset load, persistence, retry, telemetry | Effect service and scope | Simulation tick |
| Message decoding and validation | Shared protocol with Effect Schema | Ad hoc room handler |
| Snapshot broadcast and command delivery | Colyseus room | Simulation authority |
| Movement, combat, AI stepping | Synchronous systems | Effects or statechart interpreter in the hot loop |

## Package shape

`src/game/model.ts` holds the numbers and rules as pure data and functions. Everything else imports it. In a multiplayer game, `@blacksite/protocol` holds the shared wire types (`PawnState`, `PawnIntent`, the client and server messages) and a hand-written `isClientMessage` guard, and `@blacksite/relay` holds the match authority, client prediction and reconciliation, interpolation and the replicated Koota traits. An offline session calls the same match functions as a server room through `createLoopbackRoom()`. A server that hosts many sessions in one Koota world tags each entity with an `InSimulation(simulationEntity)` relation and filters every room query by it. Keep game-specific protocol in the game until it earns a shared package. `@blacksite/sim-core` is Warden's planar simulation, not player netcode.

## Working pattern

The starter's `src/architecture.ts` is executable. It creates one Koota world and `Pawn`/`PawnIntent` traits, the life and phase machines, an Effect event service, an intent writer, a `mirror` for the pawn's position, and a snapshot. Input comes from `@blacksite/input` through `src/game/input.ts`, and the frame loop belongs to the stage. Extend that seam rather than inventing another state store.

```ts
const Controller = trait({ player: 0 })
const Pawn = trait({ x: 0, z: 0 })
const Intent = trait({ forward: 0, right: 0, jump: false })
const world = createWorld()
const controller = world.spawn(Controller({ player: 1 }))
const pawn = world.spawn(Pawn, Intent)
function writeIntent(command: { forward: number; right: number; jump: boolean }) {
  if (controller.has(Controller)) pawn.set(Intent, command)
}
function tick(dt: number) {
  const position = pawn.get(Pawn)!
  const intent = pawn.get(Intent)!
  pawn.set(Pawn, { x: position.x + intent.right * dt, z: position.z + intent.forward * dt })
}
```

A Player Controller or AI Controller writes the same Intent onto its possessed Pawn. Possession is exclusive. The Pawn does not call its controller. The fixed tick reads Intent and writes Koota traits; it never awaits work or constructs an Effect. A machine transition reads a Koota snapshot at its edge and writes Koota once through an action. For example, `DIE` transitions the life actor and an entry action writes health or movement eligibility to the Pawn; continuous health stays in Koota. Keep machine context to transition bookkeeping, not copies of world data.

An Effect service is provided once at session startup: `const GameEvents = Context.Service<{ emit(name: string): void }>('GameEvents')` and `Layer.succeed(GameEvents, implementation)`. Acquire listeners, network streams, and actors in one Scope; release the Scope on room or session shutdown. Decode wire commands through `Schema.decodeUnknown(CommandSchema)` before they reach the sim. Model decode errors and unavailable services as typed errors. Retries belong at the I/O boundary with an explicit schedule; never retry a tick.

A Colyseus room accepts decoded commands, maps controller identity to a Pawn, and queues Intent for the next tick. After the tick, project only public fields into a snapshot. The client applies the projection to presentation state and may predict local movement, but the server owns hits, damage, score, and inventory. Copy durable events before sending; never leak mutable Koota records across the wire.

Determinism: fixed `dt`, ordered command queue, stable entity IDs, seeded random, explicit tick number, no wall clock or I/O in systems. Replay the same commands through the offline session and room sim. Use unit tests for protocol and authority invariants; generated game scenes use the cheap gate and user playtest.

Avoid parallel shadow state in React, one Koota world per server room, Effect inside `useFrame`, XState for numerical integration, direct Colyseus mutation of entities, and implicit conversion of wire payloads. A prototype contract names its traits, machine events, service interfaces, inputs, outputs, and persisted state before promotion.

## Shared simulation and wire examples

Define the simulation relation once, in the game's shared module. A room and the offline session both call the same `step`, with the same world and traits. In a multi-room server, every entity has exactly one simulation target.

```ts
import { createQuery, createWorld, relation, trait } from 'koota'

export const InSimulation = relation({ exclusive: true })
export const Position = trait({ x: 0, z: 0 })
export const Velocity = trait({ x: 0, z: 0 })
export const movement = createQuery(Position, Velocity)
export const world = createWorld()

export function step(simulation: ReturnType<typeof world.spawn>, dt: number) {
  world.query(movement, InSimulation(simulation)).updateEach(([position, velocity]) => {
    position.x += velocity.x * dt
    position.z += velocity.z * dt
  })
}
```

Keep a game's own wire names and schemas together in one module, decoded with Effect Schema. (`@blacksite/protocol` predates this and uses a hand-written guard.) Decode before enqueuing commands; distinguish invalid input from service failure with typed errors. Do not put Koota entities or Three objects on the wire.

```ts
import { Schema } from 'effect'

export const IntentMessage = Schema.Struct({
  type: Schema.Literal('intent'),
  tick: Schema.Int,
  forward: Schema.Number,
  right: Schema.Number,
  jump: Schema.Boolean,
})
export type IntentMessage = typeof IntentMessage.Type
export const decodeIntent = Schema.decodeUnknownEffect(IntentMessage)

export function projectPawn(pawn: { id: string; x: number; z: number; health: number }) {
  return { id: pawn.id, x: pawn.x, z: pawn.z, health: pawn.health }
}
```

At the room boundary, `Effect.runPromise(decodeIntent(payload))` yields a typed command or a schema error. Queue the result with the connection's Controller identity. On each fixed step, write queued Intent into the possessed Pawn's trait, run synchronous systems, and send `projectPawn` snapshots through Colyseus. An offline session calls the identical command queue and `step` functions with a local transport adapter. XState event actions write one transition result into Koota; XState context holds only phase-local bookkeeping. Effect Layers provide the decoder, asset loader, and event sink at startup; their Scope closes when the room or offline session ends.

## Player pieces and transport

Every character game uses the Character Controller from `@blacksite/subject` and picks its views: `['arms']` for first person, `['shoulder']` or `['shoulder', 'head']` for third person. It runs ALS, the arms and Armory with a synchronous weapon tick. Warden owns squad decisions and Cascade owns destruction; neither owns the Pawn or app phase. `mp` uses the controller with `['arms', 'shoulder']` under `Replication`, ALS remote bodies, Controller→Pawn→Intent, client-authored movement with server bounds, Armory-validated hits, `@blacksite/protocol`, and `@blacksite/relay` with the same match policy in Colyseus and offline loopback. The local camera defaults to FPP, V switches views through `@blacksite/input` while the canvas has focus, with or without pointer lock, and a single entry in `views` locks presentation; the view is never sent over Relay. Relay v0 sends full snapshots and does not yet include interest management or lag compensation (`multiplayer.md`).

Read the ALS guide (`building-blocks.md`, Characters) before wiring an ALS local body, remote body, camera, overlay, action, or FPP arms viewmodel. Its `vendor/als-web/docs/guide/` recipes define the consumer API and unit boundary.

Choose transport from the game's topology:

| Need | Transport |
| --- | --- |
| Room matchmaking, reconnection, state sync, roughly 2–64 players | Colyseus default |
| Serverless edge rooms | Durable Objects or PartyKit |
| Low-latency few-peer co-op, fighting, or voice | WebRTC |
| Large RTS unit counts with deterministic commands | Lockstep |
| Custom sharding, MMO interest management, unusual tick topology | Custom WebSocket |

Keep transport behind Relay (`@blacksite/relay`). Colyseus is the local and deployed default: the client uses `${location.origin}/relay`, Vite proxies that path to port 2567 with WebSocket upgrades, and `VITE_RELAY_URL` can override it. Dev previews accept `*.getbb.app` and `*.ts.net` by default; set `VITE_ALLOWED_HOSTS` to add comma-separated hostnames. Use `createLoopbackRoom()` for static demos or tests; the arena showcase puts a bot-driven second controller on the same loopback room. Its v0 Colyseus and loopback adapters share typed messages, ownership, replicated Koota traits, prediction/reconciliation, and interpolation. Relevancy and lag compensation remain planned. For one-domain deployment, route `/relay` through Workers VPC → Tunnel → Docker as described in `process.md` (Ship); set `VITE_RELAY_URL` when the room uses another origin.
