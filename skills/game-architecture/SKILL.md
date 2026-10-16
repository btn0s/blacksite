---
name: game-architecture
description: Game architecture reference for Koota, XState, Effect, transport, input intent, shared protocol, and the synchronous tick. Use when wiring a starter, prototype, offline session, or multiplayer game.
---

# Game architecture

Use this ownership map for generated games and prototypes. Koota owns entity identity and all gameplay data. XState owns discrete transitions: weapon, life, seat, app, and room phases. Effect owns services, decoding, typed errors, streams, retries, and resource lifetime through Layers and Scope. Colyseus owns transport and projections. The 60 Hz tick is plain synchronous code.

| Need | Owner | Never place it in |
| --- | --- | --- |
| Position, health, ammo, team, inventory, cooldown deadline | Koota trait | React state, XState context shadow copy |
| Alive/dead, reload phase, seat occupancy, room phase | XState actor | Per-frame switch spread across components |
| Input listener, asset load, persistence, retry, telemetry | Effect service and scope | Simulation tick |
| Message decoding and validation | Shared protocol with Effect Schema | Ad hoc room handler |
| Snapshot broadcast and command delivery | Colyseus room | Simulation authority |
| Movement, combat, AI stepping | Synchronous systems | Effects or statechart interpreter in the hot loop |

## Package shape

`packages/protocol/src/combat` contains pure rules and event types. `packages/protocol/src/ecs` contains shared traits, queries, and the `InSimulation` relation. `packages/protocol/src/wire.ts` defines every named message with Effect Schema. `packages/sim` owns the sync tick and authority. `packages/client` maps input to intent and renders projections. An offline session calls the same protocol and sim functions as a server room. A server can host many sessions in one Koota world; tag each entity with `InSimulation(simulationEntity)` and filter every room query by that relation. Keep game-specific protocol in the generated game until it earns a shared package.

## Working pattern

The starter's `src/architecture.ts` is executable. It creates one Koota world and `Pawn`/`PawnIntent` traits, a life machine, an Effect event service, an input writer, a synchronous tick, and a snapshot. Extend that seam rather than inventing another state store.

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

Define the simulation relation once in `protocol/src/ecs/traits.ts`. A room and the offline session both call the same `step` from `sim`, with the same world and traits. In a multi-room server, every entity has exactly one simulation target.

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

Keep wire names and schemas together in `protocol/src/wire.ts`. Decode before enqueuing commands; distinguish invalid input from service failure with typed errors. Do not put Koota entities or Three objects on the wire.

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

Single-player FPP uses arms only, `@blacksite/subject-fpp`, `@blacksite/armory`, a Koota Pawn/Intent, and a synchronous weapon tick. TPP uses ALS with `@blacksite/subject` when its player bridge is needed. Warden owns squad decisions and Cascade owns destruction; neither owns the Pawn or app phase. `mp` uses local FPP arms, the local ALS body in TPP, ALS remote bodies, Controller→Pawn→Intent, client-authored movement with server bounds, Armory-validated hits, `@blacksite/protocol`, and `@blacksite/relay` with the same match policy in Colyseus and offline loopback. The local camera defaults to FPP, V switches views through `@blacksite/input` while the canvas has focus, with or without pointer lock, and `cameraMode="fpp"` or `cameraMode="tpp"` locks presentation without sending camera mode over Relay. Relay v0 sends full snapshots and does not yet include interest management or lag compensation.

Choose transport from the game's topology:

| Need | Transport |
| --- | --- |
| Room matchmaking, reconnection, state sync, roughly 2–64 players | Colyseus default |
| Serverless edge rooms | Durable Objects or PartyKit |
| Low-latency few-peer co-op, fighting, or voice | WebRTC |
| Large RTS unit counts with deterministic commands | Lockstep |
| Custom sharding, MMO interest management, unusual tick topology | Custom WebSocket |

Keep transport behind Relay (`@blacksite/relay`). Colyseus is the local and deployed default: the client uses `${location.origin}/relay`, Vite proxies that path to port 2567 with WebSocket upgrades, and `VITE_RELAY_URL` can override it. Dev previews accept `*.getbb.app` and `*.ts.net` by default; set `VITE_ALLOWED_HOSTS` to add comma-separated hostnames. Use `createLoopbackRoom()` for static demos or tests; `LoopbackSplitView` from `@blacksite/subject` mounts two players in separate canvases on one page. Its v0 Colyseus and loopback adapters share typed messages, ownership, replicated Koota traits, prediction/reconciliation, and interpolation. Relevancy and lag compensation remain planned. For one-domain deployment, route `/relay` through Workers VPC → Tunnel → Docker as described in `skills/ship-game/SKILL.md`; set `VITE_RELAY_URL` when the room uses another origin.
