# AI

Warden (`@blacksite/warden`) is squad AI that perceives, remembers, plans and moves as a team: vision cones and hearing, beliefs that decay, squad orders (bound, flank, crossfire, breach), cover reservation and a motor layer with reaction time and aim acquisition. It runs in a worker at 30 Hz and renders nothing. `@blacksite/warden-react` adds a session, a hook and a debug view.

## Guides

- `docs/warden.md`: integration, the headless runtime, custom maps and rules, the `TacticalAuthority` adapter for an existing game, navmesh build, tactics bake and crowd avoidance.
- `packages/warden/AGENTS.md`: knowledge comes only from observation, replays are deterministic, and Warden doesn't own the pawn.
- `site/src/showcases/squad/`: the complete reference. A 5v5 courtyard with ALS puppets, ragdolls, tracers, synthesized gunfire and pose LOD.

## Standard use

- `createWardenSession({ detail: 'render' })`, then `session.connect(config, world)` with `{ seed, agentsPerTeam, maxTicks, scenarioId }`.
- Author a `TacticalMap` (bounds, obstacle rectangles, regions, objectives, spawns per team) and bake `map.nodes = bakeTacticalNodes(map, anchors)`. For real geometry, build a navmesh with `buildNavigationMesh` and `bakeNavigationTactics`.
- Subscribe to `RenderSnapshot`s and interpolate each agent through an `AlsSnapshotBuffer` at a 125 ms delay, drawn with `AlsRemoteActor`.
- For an existing game's physics, weapons or ECS, write a `TacticalAuthority` adapter (`docs/warden.md`).

## Numbers

| Number | Value |
|---|---|
| Tick | 30 Hz; observations at 15 Hz |
| Replanning | Each agent every 6 ticks, staggered, or on a new threat |
| Cover rescoring | Every 30 ticks; squad plan every 15; team order every 60 |
| Vision | 37 m, about 155° wide |
| Hearing | 32 m |
| Memory | Sightings last 5 s; belief confidence decays at exp(−0.12·age) |
| Reaction | 0.12 + (1 − skill) × 0.28 s, about 0.22 s at default skill |
| Radio latency | 0.4 s |
| Agents | Up to 8 per team, two teams |

## What isn't there yet

- Agents aren't driven through ALS characters; the showcase replays snapshots into puppets.
- The reference simulation is planar and has its own weapon model, not Armory. Elevation and Armory need a custom `TacticalAuthority`.
- Two teams only. No civilians, creatures or single-NPC behaviour API.
- Grenades, smoke and lean are declared but not simulated.
- No trained models ship; the policy is symbolic.

For a single enemy type, a small state machine (patrol, investigate, search, attack, flee) with the same perception numbers often reads better than a squad. What players read as smart is barks: say out loud what the enemy is doing ("Flanking left!", "Reloading!") so they can counter it.

## Rules, and the failures that taught them

- **Snapshots sized for rendering.** The worker sent 557 KB a tick including decision traces and the map. `detail: 'render'` cut it to a few KB.
- **A cheap pre-reject on hot searches.** A heap-based search with a bounding-box pre-reject was 3.5× faster with identical results; a 5v5 tick fell from 15–18 ms to 4–7 ms.
- **Animate far agents less often.** Pose LOD took a 5v5 round from about 21 ms to 6–10 ms a frame (`performance.md`).
