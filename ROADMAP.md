# Roadmap

Status: public direction, October 2026. Reference hardware: TBD.

## Thesis

Many browser games are slow because the engine does nothing by default: no LOD, no streaming, no culling beyond the frustum, no budgets, physics and AI on the main thread, every object simulated at full fidelity forever. Unreal and Unity ship these as defaults, which gives teams a practical starting point for large worlds.

Blacksite should ship them as defaults too. The target is **extremely performant by default on desktop and mobile from the first scaffold**: 120 fps on desktop reference hardware, and a sustained 60 fps on mobile reference devices (120 where the display and thermals allow). Fidelity is a separate dial you raise later, and scaling down for mobile should cost resolution and density before it costs the look. The tech floor is not optional and not something the agent has to remember to add.

Three ideas carry the whole roadmap:

1. **Scale profile.** The camera and scale of the game (first person, third person, top-down, vehicle, air) set the defaults for every system. Destruction detail, LOD distances, streaming radius, animation update rate, VFX density and AI tick rate all read from one profile. This is how Cascade gives bullet holes to an FPS and only macro collapse to an air-strike game. **Status: planned.**
2. **Significance.** Every expensive thing (a skeleton, a physics body, an AI agent, an emitter, a destructible) asks "how much do I matter right now" from distance, screen size and visibility, and degrades its update rate and detail accordingly. One manager, used by every system (Unreal's Significance Manager plus URO). **Status: usable.**
3. **Find → capture → prototype → default.** Each capability enters the engine through the same pipeline, and only becomes a default once a benchmark scene proves it at 120 fps. **Status: planned.**

## Performance targets and scalability

Two device classes, one codebase:

| Class | Target | Reference devices |
|---|---|---|
| Desktop | 120 fps | TBD: e.g. M-series MacBook, mid-range Windows GPU (reference desktop) |
| Mobile | 60 fps sustained for 20+ minutes without thermal throttling; 120 on high-refresh devices where headroom exists | TBD: e.g. recent iPhone (Safari/WebGPU), mid-range Android (Chrome) |

**Scale without nuking the graphics.** Scalability is a set of quality tiers chosen automatically at startup (GPU/device probe plus a short warmup benchmark) and adjusted at runtime to hold the target. The order of what gives way is deliberate; the look (materials, lighting style, silhouettes, animation quality near the camera) is protected longest:

1. **Render resolution first**: dynamic resolution with temporal upscaling (TAAU-style) and sharpening, so mobile renders fewer pixels, not uglier ones. **Status: planned.**
2. **Expensive screen effects at reduced resolution**: half-res SSAO, bloom, volumetrics, particles composited at lower res. **Status: usable.**
3. **Distance and density**: LOD bias, impostor distance, foliage and debris density, streaming radius, shadow distance and cascade count. **Status: planned.**
4. **Update rates via significance**: animation, AI, physics and destruction detail for far and off-screen things. **Status: planned.**
5. **Only last**: material and lighting complexity. **Status: planned.**

**Mobile-friendly defaults** that cost desktop nothing: KTX2/Basis textures transcoded to ASTC/ETC2 on device, meshopt geometry, texture and memory budgets per tier, low overdraw (sorted transparents, alpha-tested foliage cards over blended), tile-GPU-friendly passes (few render-target switches, no unnecessary MRT), baked or probe lighting as the default path, frame pacing to the display's refresh rather than spinning, thermal-aware backoff, touch and gamepad input already covered by `@blacksite/input`.

Every lab is benchmarked on both device classes; a capability is only a default when it holds both targets.

## The pipeline for each capability

| Stage | Output | Done when |
|---|---|---|
| **Find** | One line in the backlog below: engine analog, why it matters, which profiles need it | Ranked by leverage |
| **Capture** | `docs/capture/<name>.md`: what UE/Unity/Godot do and why, browser constraints (WebGPU/WebGL2, workers, memory), prior art in the three.js/R3F ecosystem, the proposed Blacksite shape and its default per profile | Reviewed; a benchmark and target metric named |
| **Prototype** | A lab scene in `chambers/<name>/` plus benchmark runs on the reference desktop and on reference mobile devices | Hits the desktop and mobile targets |
| **Default** | Promoted into a package, wired into the scale profiles, added to `blacksite-kit`, used by `setup-project`/`build-prototype` | Every newly scaffolded game gets it without asking |

ALS Web is the precedent: an animation graph for three.js did not exist, so we built one. Several items below are the same kind of work.

## Scale profiles

One file per game, `blacksite.profile.ts`, chosen at `design-game` and overridable per system. Starting presets:

| Concern | First person | Third person | Top-down / RTS | Vehicle / tank | Air / pilot |
|---|---|---|---|---|---|
| Destruction tier | micro + meso (impacts, decals, chips, wall breach) | meso (props, walls), micro reduced | meso/macro | meso/macro | macro only (buildings, craters) |
| Near-field detail radius | ~30 m | ~60 m | camera footprint | ~150 m | ~1–2 km |
| Streaming radius | ~300 m | ~500 m | map region | ~1.5 km | whole theatre at low LOD |
| Animation LOD | full near, URO beyond 20 m | full near, URO beyond 40 m | VAT crowds | crew only | none near |
| Foliage | full + impostors past ~80 m | impostors past ~120 m | impostors/cards only | cards past ~200 m | ground texture + clusters |
| Shadows | 3–4 cascades, short range | 3 cascades | 1–2 cascades | 3 cascades, long | 2 cascades, long, low res |
| AI tick | per-frame near, 10 Hz far | same | 5–10 Hz batched | 10 Hz | 2–5 Hz |

These numbers are starting points for the capture docs, not decisions.

## Dimensions: 3D, 2.5D and 2D

Any game you can prompt should have a starting point, so Blacksite grows two more scaffold profiles beside the 3D ones (`fpp`, `tpp`, `mp`). Both stay on the same stack (R3F, Three, Koota, XState, Effect, Relay) and the same performance targets; they are camera and render presets, not separate engines.

| Profile | Look | Camera | Physics | Status |
|---|---|---|---|---|
| **`2.5d`** (diorama) | Pixel-art billboard sprites standing in a lit 3D world, HD-2D style: tilt-shift depth of field, bloom, warm/teal grade, time of day | Narrow-FOV perspective (~28°), high pitch, far back, limited yaw | Rapier 3D, or grid + height lookup for tile games | Planned |
| **`2d`** | Sprites, tilemaps and parallax layers; optional pixel-perfect mode | Orthographic | `@dimforge/rapier2d` | Planned |

**Why not a separate 2D renderer.** 2D stays on Three with an orthographic camera rather than PixiJS: one renderer, one reconciler, one post stack, one editor, and sprites can still take lights, normal maps and shadows. PixiJS only wins for very large unlit sprite counts; that case gets a sprite batcher instead.

**2.5D capabilities** (reference: [Lumina](https://gitlab.com/stubborn-hug/lumina), studied in [`docs/capture/diorama-2.5d.md`](docs/capture/diorama-2.5d.md); it has no licence, so we take ideas only and write our own implementation):

1. **Diorama post stack**: half-res tilt-shift DOF that follows a focus target, bloom above HDR 1.0 so only emissives glow, one tone map, a grade pass (white balance, teal shadows/warm highlights, vignette, grain, dither). Most of the look lives here.
2. **Diorama camera preset** with look-ahead, focus bounds and limited yaw.
3. **Billboard sprite material**: shared camera-yaw uniform, bent normal plus wrap diffuse so flat sprites light like volumes, alpha-test with depth write, dithered fades instead of blending.
4. **Sprite shadows**: sun-facing shadow proxy per sprite, self-shadow skip, instanced blob shadows.
5. **One texel density** (pixels per unit) enforced by the import pipeline, nearest filtering, world-space UVs.
6. **Time-of-day keyframes** driving sun, ambient, fog colour and exposure; emissive masks ramped at night.
7. **Light pool**: a fixed light count (no shader recompiles) with scored selection and cross-fades on large levels.
8. **Tile + height level format** and an editor whose 3D preview uses the runtime builders.
9. **X-ray silhouette** for characters behind roofs and walls.

**2D capabilities:** sprite batcher (instanced atlas), tilemap chunking, Y-sort and explicit layers, parallax layers, a pixel-perfect mode (low-res target, integer upscale, camera and sprite snapping), Rapier 2D bodies and character controller. The 2.5D post stack and light pool apply as options.

Both run the find → capture → prototype → default pipeline, each with a chamber, as a separate track after Phase 1, alongside Phases 2–4. The diorama shader-warmup and constant-program discipline (compile every variant at load, keep the program count fixed) is useful to every profile and goes into backlog item 6.

## Capability backlog

Ranked roughly by leverage. "Have" means Blacksite or ALS Web already has a version.

### A. Frame and runtime (everything depends on these)
1. **Performance HUD and benchmark harness** (UE `stat unit`, Unity Profiler): frame, CPU, GPU, draw calls, triangles, memory, per-system timings; headless benchmark runs on the reference desktop with JSON output for budgets and regression gates. *Nothing else can be accepted without this.* **Status: planned.**
2. **Frame scheduler** (UE task graph): fixed-step sim (have), render decoupled (have, Cascade), per-system time budgets, deferred work queues. **Status: usable.**
3. **Workers by default**: physics, AI and destruction sim off the main thread, SharedArrayBuffer with COOP/COEP set in dev and deploy templates. **Status: planned.**
4. **Significance manager**: the shared "how much do I matter" service above. **Status: planned.**
5. **Adaptive scalability** (UE scalability groups, dynamic resolution): quality tiers plus automatic resolution scaling to hold the frame target. **Status: planned.**
6. **WebGPU-first renderer** with WebGL2 fallback, TSL materials, and pipeline/shader precompile at load (warmup exists, extend to WebGPU pipelines). **Status: planned.**

### B. World scale (the open-world RPG case)
7. **World partition / cell streaming**: grid cells with load radius from the profile, async load/unload of meshes, colliders, navmesh and AI per cell. **Status: planned.**
8. **HLOD**: merged, simplified proxy per cell (or cell cluster) for distance, generated at import. **Status: planned.**
9. **Automatic LOD chains** at import (meshoptimizer simplify), with screen-size switching and dithered crossfade. **Status: planned.**
10. **Foliage system**: instanced/BatchedMesh, per-instance culling, GPU-driven where WebGPU allows; **octahedral impostors** baked at import so trees become cards at distance. **Status: planned.**
11. **Terrain**: clipmap/CDLOD heightfield, splat/virtual texturing, streamed tiles, collision from the same tiles. **Status: planned.**
12. **Occlusion culling**: Hi-Z on WebGPU, portal/PVS option for interiors. **Status: planned.**
13. **Texture streaming**: KTX2 mip tails first, full mips by distance/importance. **Status: planned.**

### C. Destruction (Cascade) as tiers
14. **Micro tier**: bullet impacts, decals, chip debris, material-aware particles and sound; no structural graph. Default for first person. **Status: planned.**
15. **Meso tier**: current Cascade (member support, fracture, debris), with significance-driven fidelity. **Status: usable.**
16. **Macro tier**: building collapse, craters, terrain deformation, airstrike scale; far collapses can play baked or simplified simulations. **Status: planned.**
17. **Destruction LOD**: the same building is a live structural sim near, a pre-fractured/baked collapse far, and a swap to a ruin mesh off-screen. **Status: planned.**

### D. Characters and animation
18. **Animation LOD (URO)**: update rate and graph complexity by significance; ALS graph (have) gains LOD tiers. **Status: experimental.**
19. **Crowds**: vertex animation textures for hundreds of instanced characters, promoted to full ALS near the camera. **Status: planned.**
20. **IK and retargeting**: foot/hand IK, weapon grip (last-light has a version), compiled retarget for non-ALS rigs. **Status: planned.**

### E. Effects, lighting, audio
21. **GPU particles** (Niagara-lite) on WebGPU compute, pooled, with LOD and budgets. **Status: planned.**
22. **Lighting defaults**: cascaded shadows tuned per profile, sky/atmosphere, height fog, light probes/irradiance volumes; baked lighting option; dynamic GI (DDGI-style) as a later fidelity item. **Status: planned.**
23. **Audio**: concurrency/voice limits, priority, occlusion, distance attenuation presets per profile. **Status: planned.**

### F. AI and network at scale
24. **AI LOD** in Warden: tick rate by significance, batched far agents, navmesh streaming per cell. **Status: experimental.**
25. **Interest management** (UE replication graph): per-cell relevancy for Colyseus rooms. **Status: planned.**

### G. Agent tooling
26. **Budgets per profile** enforced by `blacksite budget` and `optimize-game` (have, basic). **Status: usable.**
27. **Import pipeline** generates LODs, impostors, collision proxies and compressed textures for every owned asset (pipeline exists, extend). **Status: usable.**
28. **Chamber benchmark scenes** as the engine's proof set (below). **Status: planned.**

## Planned systems

| System | Scope | Status |
| --- | --- | --- |
| Relay (`@blacksite/relay`) | Replication, prediction, and transport adapters | Planned; no package yet |
| Sector | World streaming, HLOD, and terrain | Planned; no package yet |
| Scanner | Significance and LOD management | Planned; no package yet |
| Flare | GPU VFX | Planned; no package yet |
| Horde | Crowds | Planned; no package yet |

## Player templates and networking

**Which player template** (agents must apply this, `design-game` asks single-player or multiplayer early):

| Game | Player template | Why |
|---|---|---|
| Single-player first person | **FPP solo**: arms-only first-person (Subject + Armory), no ALS body | Nobody sees your body; the ALS third-person stack is wasted cost |
| Single-player third person | **TPP**: ALS character + ALS camera | |
| Multiplayer first person (or FPP/TPP switchable) | **FPP+TPP multiplayer player**: arms-only first person for the local player, ALS third-person body for everyone else (and for the local player in third person), Controller → Pawn → Intent, **networked by default** | Other players must see a full animated body |
| Multiplayer third person | TPP, networked by default | |

**Relay networking subsystem** (`@blacksite/relay`, Unreal's replication model, transport-agnostic):

- Concepts: authority and ownership per entity, replicated Koota traits (with conditions: owner-only, initial-only, skip-owner), server/client/multicast RPCs as typed messages, client-side prediction and reconciliation for owned pawns, interpolation for remote ones, relevancy/interest management per cell, network significance (send rate by distance), snapshot and delta encoding, lag compensation for hits.
- Transport adapters behind one interface: **Colyseus (default)**, plain WebSocket server, WebRTC data channels (unreliable, P2P or SFU), Cloudflare Durable Objects / PartyKit, and a loopback adapter so single-player and offline sessions run the same code (the offline loopback pattern).
- The current game pattern (client-authoritative movement, server-authoritative hits, shared protocol package) becomes the default policy, configurable per game.

**Choosing a transport** (taught in `game-architecture`, applied in `design-game`):

- Start with **Colyseus**: rooms, matchmaking, state sync and reconnection out of the box; fits session games of roughly 2–64 players on our Workers VPC → Tunnel → Docker deploy.
- Switch to **Durable Objects / PartyKit** when you want edge-hosted rooms with no servers to run and modest per-room load.
- Switch to **WebRTC** when latency between a few peers matters more than authority (co-op, fighting games), or for voice.
- Use **lockstep over any transport** for RTS-scale unit counts (send inputs, not state); needs the deterministic sim.
- **Roll your own** WebSocket server when you need a custom tick, sharding or MMO-style interest management Colyseus cannot express.
- The planned adapter seam will make future transport changes local to the network layer. Relay does not ship yet.

Roadmap placement: Relay with the Colyseus and loopback adapters is a **Phase 1** foundation item (capture → prototype → default like everything else; chamber: 16-player FPP+TPP arena at 120 fps client-side with prediction). Other adapters follow in Phase 4 with interest management.

## Proof scenes (`chambers/`)

Each phase ends with one of these holding the desktop (120 fps) and mobile (60 fps sustained) targets on reference devices.

| Chamber | Proves | Target |
|---|---|---|
| **RPG valley** | third person, ~4 km² terrain, forest with impostors, streaming, HLOD, 50 AI | 120 fps |
| **Close quarters** | first person, micro + meso destruction, 30 AI, full impacts | 120 fps |
| **Air strike city** | air profile, macro destruction across a city block grid | 120 fps |
| **Battalion** | top-down, 500 units, VAT crowds, batched AI | 120 fps |
| **Crowd plaza** | third person, 300 characters with animation LOD | 120 fps |
| **Diorama village** | `2.5d`: sprite characters in a lit 3D village, full diorama post stack, time of day, 12-light pool | 120 fps |
| **Pixel platformer** | `2d`: pixel-perfect mode, parallax, tilemap chunks, Rapier 2D, 2,000 sprites | 120 fps |

## Phases

- **Phase 0, measure (now, alongside the CLI/skills work).** Define desktop and mobile reference devices. Automatic quality tiers and dynamic resolution baseline, perf HUD, headless benchmark harness on the reference desktop, budgets per profile, `chambers/` skeleton. Exit: every lab reports a frame-time breakdown.
- **Phase 1, foundations.** Relay (Colyseus + loopback adapters, replication model), scale profiles, significance manager, workers by default, frame scheduler, adaptive resolution, WebGPU-first path, automatic LOD chains at import. Exit: scaffolded games pick a profile and get these without asking.
- **Phase 2, open world.** Cell streaming, HLOD, foliage and impostors, terrain, occlusion, texture streaming. Exit: RPG valley at 120 fps.
- **Phase 3, destruction tiers and VFX.** Micro/meso/macro tiers, destruction LOD, GPU particles. Exit: Close quarters and Air strike city at 120 fps.
- **Phase 4, scale of characters.** Animation LOD, VAT crowds, AI LOD, interest management. Exit: Battalion and Crowd plaza at 120 fps.
- **Track 2.5D/2D (after Phase 1, parallel to Phases 2–4).** `2.5d` and `2d` scaffold profiles, diorama post stack, billboard sprite material and shadows, sprite batcher, pixel-perfect mode, Rapier 2D. Exit: Diorama village and Pixel platformer at 120 fps.
- **Phase 5, fidelity dials.** Lighting quality, GI, material quality. Visual work on top of a fixed performance floor.
- **Phase 6, Rust path.** Rust core (sim, physics, destruction, AI) compiled to WASM and driven from R3F first; later a Rust/wgpu renderer targeting WebGPU, likely becoming the default. To keep that door open now: sim stays headless, data-oriented and deterministic in Koota; render reads projections only; no gameplay logic in React components.

Phases 0 and 1 are sequential because everything else is measured against them. Inside Phases 2–4, each capability runs the find → capture → prototype → default pipeline in parallel, one worker per capability.

