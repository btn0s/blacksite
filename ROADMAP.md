# Roadmap

October 2026.

## What Blacksite is for

Blacksite is a skill that helps your coding agent build 3D browser games, plus the building blocks it builds them from. Everything on this page serves two promises:

1. **Agents use the blocks correctly.** Every block has a guide and a skill that tell an agent how it works and how to do common things with it, so it uses the block the standard way instead of guessing.
2. **Fast by default.** 120 fps on desktop and a sustained 60 fps on phones, without the agent having to remember to optimise. Desktop game engines turn on detail levels, streaming, budgets and background threads by default; browser games usually start with none of them. Blacksite's blocks do.

## What works today

| Area | What you get |
|---|---|
| Player templates | `fpp` (single-player first person, rigged arms), `tpp` (ALS third person), `mp` (multiplayer, first/third person switch), `blank` |
| Multiplayer | Colyseus rooms plus an in-browser loopback, owner movement, server-checked hits, remote bodies replaying full ALS state |
| Characters | ALS Web: the ALS Refactored animation system ported to three.js, with an [agent guide](vendor/als-web/docs/guide/overview.md) and the `als` reference |
| Weapons | Rifle and pistol with fire, reload, aim and recoil |
| World | Terrain to the horizon, ground cover, forests with impostors, one wind field; the physically based sky and nature look |
| Destruction | Structural collapse in a worker, walk mode with tools |
| AI | Squad AI and tactical simulation |
| Input | Keyboard, mouse, gamepad, touch |
| Agent tooling | `blacksite` CLI, the `blacksite` skill, `blacksite check`, budgets, owned-asset sync |
| Docs and demos | [Site](https://blacksite-sable.vercel.app) with live demos and a performance overlay |

## Now

Being built now, or next. Each item is done when the line after the dash is true.

- **Showcase demos.** Polished scenes per capability (movement, demolition, firing range, squad AI, arena) built only on the public packages — the site's demos look like a game, not a lab.
- **Agent guides for the remaining systems.** Cascade, Warden, Relay and Armory get what ALS now has: a mental model, units, the input contract, tested recipes and symptom-indexed gotchas, plus a skill — an agent can do a common task from the guide alone.
- **Touch controls for the player templates.** `fpp`, `tpp` and `mp` playable on a phone — the same check Cascade walk mode already passes.
- **Measurement.** Pick reference devices (a desktop and an iPhone/Android pair), a benchmark harness that runs headless and writes JSON, and a frame-time breakdown per system — every demo reports where its frame time goes.

## Next

The foundations that make "fast by default" automatic. These run in order because everything later is measured against them.

- **Quality tiers.** Detect the device, pick a tier, and adjust at runtime to hold the frame rate — a phone holds 60 fps without the game doing anything.
- **Scale profiles.** One setting per game type (first person, third person, top-down, vehicle, air) that sets defaults for detail distances, shadows, destruction detail, animation and AI update rates ([numbers](docs/capture/scale-profiles.md)) — a new game gets sensible defaults for its genre.
- **Scanner** (significance). One service every expensive thing asks "how much do I matter right now" (distance, screen size, visibility), then lowers its update rate and detail — far characters, bodies and emitters cost little.
- **Workers by default.** Physics, AI and destruction off the main thread, with the right server headers in the dev and deploy templates.
- **WebGPU first**, with WebGL2 fallback and shaders compiled at load so the game never freezes for a moment the first time an effect appears.
- **Automatic LOD at import.** Simplified meshes and compressed textures generated for every imported asset.

**When the frame rate is at risk, things give way in this order**, so phones get fewer pixels rather than an uglier game: render resolution (with upscaling) → expensive screen effects at lower resolution → distance and density (LOD, foliage, shadows) → update rates for far things → materials and lighting last.

## Later

Each of these is proved by a benchmark scene before it becomes a default.

| Track | What it adds | Proved by |
|---|---|---|
| Open worlds (**Sector**) | Streaming cells, merged distant geometry, terrain, foliage with impostors, occlusion, texture streaming | A ~4 km² valley with forest and 50 AI at 120 fps |
| Destruction tiers | Bullet impacts and decals (first person), the current structural tier, city-scale collapse, baked collapses at distance | Close-quarters fight and an air strike on a city block |
| Characters at scale (**Horde**) | Animation detail by distance, hundreds of instanced characters, AI update rates by distance | 300-character plaza and a 500-unit battle |
| Network scale | Interest management, delta snapshots, lag compensation, more transports (WebSocket, WebRTC, Durable Objects/PartyKit) | A 16-player `mp` arena at 120 fps |
| 2.5D and 2D | `2.5d` (pixel-art sprites in a lit 3D diorama, [notes](docs/capture/diorama-2.5d.md)) and `2d` (sprites, tilemaps, parallax, pixel-perfect mode, Rapier 2D), on the same stack | A diorama village and a pixel platformer |
| Effects (**Flare**) | GPU particles with budgets, lighting defaults per profile | Part of the scenes above |
| Fidelity | Higher lighting and material quality on top of a fixed performance floor | — |
| Rust core | Sim, physics, destruction and AI in Rust/WASM driven from React Three Fiber; later possibly a Rust/wgpu renderer | — |

To keep the Rust path open now: the sim stays headless, data-oriented and deterministic in Koota; rendering only reads the sim; no gameplay logic lives in React components.

## How a feature gets in

1. **Research**: what established game engines do, what the browser allows, written up in `docs/capture/<name>.md` with a target number.
2. **Prototype**: a benchmark scene that hits the desktop and phone targets.
3. **Default**: moved into a package and turned on for every new game.

## Choosing a player template and transport

- Single-player first person → `fpp`. Nobody sees your body, so there is no ALS body.
- Single-player third person → `tpp`.
- Multiplayer → `mp`: other players need a full animated body. Networked by default.
- Start multiplayer on **Colyseus** (2–64 players per room). Move to **Durable Objects/PartyKit** for edge-hosted rooms without servers, **WebRTC** for a few peers where latency matters most, **lockstep** for RTS unit counts, or your own server for custom ticks and sharding. Relay keeps that switch inside the network layer. The [game architecture reference](skills/blacksite/references/architecture.md) covers the details.
