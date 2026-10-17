---
name: blacksite
description: Build browser games that look, sound and feel like shipped games, with Blacksite's building blocks, templates and checks. Use for anything game-related, even if the user never says engine or Blacksite. That includes a game idea, a level, a mechanic, a character, a weapon, enemies, destruction, multiplayer, game feel, lighting and atmosphere, game audio, frame rate, a prototype, or shipping a game.
argument-hint: <idea>
---

# Blacksite

Use `$ARGUMENTS` as the idea. If it's empty, ask **What would you like to make?** and offer: a new game from an idea; continue a game; one mechanic; make an existing game look, feel or run better; ship a game; use assets you already own. Ask one question at a time and keep every choice the user makes.

## Build the version shipped games built

A request names a feature. Shipped games solved that feature years ago, and players know the solved version by feel even when they can't name it. Build that version from the start. The naive version runs, so it passes every test, and it reads as a student project in the first second.

| You ask for | The naive version | The solved version |
|---|---|---|
| Footsteps | One sample on a timer | Triggered by the animation's foot plants. A set of 3–5 samples per surface, never the same one twice in a row, ±5% pitch and ±2 dB volume. A landing sound scaled by fall speed. Attenuated by distance. |
| A forest | One tree copied over a flat green plane | 3–4 species at 0.7–1.3× scale with random yaw, clustered around clearings. Undergrowth, rocks and fallen trunks. Instanced, with far trees as impostors. Fog layering the depth. Wind moving the crowns in the vertex shader. |
| A flashlight | A spotlight glued to the camera | A cookie texture, about 0.08 s of lag behind the view, the only shadow-casting light near the player, a little bounce light, and a beam you can see in the haze. |
| An explosion | A sprite and an impulse | A flash light for 0.1 s, a fireball, smoke that hangs for 5–10 s, debris with contact shadows, a scorch decal, camera shake falling off with distance, and the sound arriving at 343 m/s with a low-pass tail. |
| A gun | A ray and a muzzle flash | A 600 RPM fixed-step weapon, per-shot recoil the view recovers from, viewmodel kick, a tracer on one round in three, impact decals and dust per surface, shell casings, and a tail that matches the room. |
| Smart enemies | A chase in a straight line with perfect aim | Vision cones and hearing, a 0.2 s reaction delay, cover, squad roles, callouts that tell the player what they're doing, and aim that starts wide and tightens. |
| A jump | Upward velocity on a key press | About 0.9 m apex at 9.8 m/s², 0.1 s of coyote time, a 0.1 s jump buffer, a landing dip in the camera and a landing sound. |
| A third-person camera | A fixed offset behind the player | A shoulder offset, a collision-traced spring arm, lag on position but not on aim, and a narrower FOV when aiming. |
| A big world | One scene loaded at start | Streamed cells, levels of detail and impostors, a horizon hidden in fog, a per-frame streaming budget, and nothing visibly popping in. |
| Health | A number in a corner | Hit direction indicators, a red vignette that pulses with the heartbeat, muffled audio at low health, and regeneration you can hear start. |

When a request isn't in the table, ask the same question first: what did the games that shipped this do? Then build that version.

## Two ways to fail

- **Tutorial-grade.** Everything works and nothing is dressed: grey boxes, one light, default fog, no sound, every material the same matte. The test: would a stranger take a screenshot of it for a shipped game with an art direction?
- **Feature soup.** Twelve systems started and none finished: an inventory, crafting, a skill tree and a day–night cycle around a loop that isn't fun yet. The test: can you name the one loop, and does every part on screen serve it?

Depth beats breadth. One room, finished, beats a continent of grey boxes.

## Size it first

| Size | What it is | Time | When |
|---|---|---|---|
| **Mechanic** | One verb in one space, finished to shipped quality: a gun on a range, a jump across rooftops. | Hours | When the user asks for one mechanic, or a Slice has one risky part. |
| **Slice** | One complete loop in one dressed space, 5–10 minutes of play with a start, a way to fail and an end. | A day or a few sessions | **The default.** |
| **Game** | Several loops, many spaces, progression. | Months | Don't start one. Propose the Slice that proves its core loop, and say what the Slice will prove. |

## Workflow

Each step leaves a file, so the work can resume in a fresh context.

1. **Truth first.** Write `src/game/model.ts`: a pure module with no rendering that holds the real numbers and rules. Speeds, acceleration, jump apex, fire rate, damage, ranges, budgets and timings go here, taken from the references, not invented. Everything else imports it, including the check contract. When a number is wrong, there's one place to fix it.
2. **Parts list.** Before building, write what the shipped version has, with a minimum count for each part, into `docs/game-design.md`. For a Slice in a ruined yard: at least 3 light sources including 2 practicals, 4 surface materials, 12 prop types placed in clusters, decals on every wall at eye height, 3 sound layers (ambience, foley, events) and 2 enemy behaviours. `craft.md` has the counts by kind of space. The list is the scope: nothing goes in that isn't on it, and nothing on it is skipped.
3. **Build.** Set up the project, build each risky part as an isolated prototype, then combine them into one loop. Use the building blocks; read the matching reference before wiring one.
4. **Make it live.** Nothing on screen should be perfectly still and nothing should be silent. Add wind, dust motes, flickering practicals, idle animation, distant ambience, and a reaction to every player action: a sound, a particle, a camera response.
5. **Verify like a critic.** Run `blacksite check` on desktop and phone until every line passes, then read every picture it writes as a harsh critic would. Fix, rerun, and hand the user a URL. `verify.md` has the details.

## Starting from an existing game

Read `docs/game-design.md`, `docs/prototypes/*.md` and `src/game/model.ts`, then run `blacksite check` to see where the game stands before changing anything. For a narrow request:

- **"Make it look better."** Read the critic captures against the parts list and `craft.md`. Fix the biggest gap first, usually light, fog or dressing density, not post effects.
- **"It feels floaty" or "sluggish."** Run `blacksite check --only feel` and compare with `feel.md`. Change the model's numbers, not the code around them.
- **"It stutters."** Run `--only perf,hitch` on both profiles and follow `optimise.md`.
- **"Add a feature."** Find its row in the table above, or work out what the shipped version had, and add it to the parts list first.

## Handing over

Serve the game (`pnpm dev --host 0.0.0.0`) and give the user a link; with bb, `bb connect expose 5173`. Say:

- what was built, counted against the parts list;
- the `blacksite check` summary lines, and the host's load while it ran;
- what only the user can confirm: 120 fps on a 120 Hz display, frames bound by the GPU, touch on a real phone, the mix in headphones;
- the open questions, one line each.

Never call something done that a gate didn't pass or that nobody played.

## Craft rules

The references hold the numbers, and each rule's story. These are the ones to never break.

- **Light has a source.** One key light, a fill at about a third of its intensity, and practicals (lamps, screens, fire) that explain where light comes from. Fog between the camera and the far plane on every outdoor shot.
- **No flat materials.** Every surface has colour, roughness and normal variation, from textures of at least 512 px mapped at real-world scale. A prop with no contact shadow floats.
- **Dress in clusters.** Props sit in groups of 3–7 against walls and at corners, with clear paths between them. Open floor at even spacing reads as a test map.
- **Every action has three responses:** something you see, something you hear, and something the camera or controller does.
- **Movement:** walk 1.75, run 3.75, sprint 6.5 m/s. 90% of top speed in about 0.25 s. First-person eye at 1.63 m, world FOV 75°, the viewmodel at 56° in its own pass.
- **One owner for the view.** Exactly one thing reads the mouse. Two readers at different rates made a 1.75° sawtooth.
- **One set of arms.** In first person, show the arms viewmodel or the body from the head, never both.
- **Sound travels.** Delay distant sounds at 343 m/s, cap active voices at 32, and never play the same sample twice in a row.
- **Budget:** 8.3 ms of main-thread time per frame on desktop (120 fps), 16.7 ms on phones (60 fps), no frame over 33 ms, first playable within 5 s. Phones get no AO or bloom and a pixel ratio of at most 1.25.
- **Measure the bound thread.** A physics win that doesn't move main-thread p95 isn't a frame-rate win.

## Building blocks

Read the reference before wiring a block. Paths like `docs/cascade.md` are relative to the Blacksite repository; inside a generated game they're under `vendor/blacksite/`.

| Block | Package | Reference |
|---|---|---|
| Characters: an animated body, first and third person | `@blacksite/subject`, `@blacksite/subject-fpp`, ALS | [characters.md](references/characters.md), [als.md](references/als.md) |
| Weapons | Armory, `@blacksite/armory` | [weapons.md](references/weapons.md) |
| AI: squads that perceive, plan and take cover | Warden, `@blacksite/warden` | [ai.md](references/ai.md) |
| Destruction: buildings that break by structure | Cascade, `@blacksite/cascade` | [destruction.md](references/destruction.md) |
| Multiplayer | Relay, `@blacksite/relay` | [multiplayer.md](references/multiplayer.md) |
| Input: keyboard, gamepad, touch | `@blacksite/input`, `@blacksite/ui/hud` | [input.md](references/input.md) |
| The look: post stack, atmosphere, the ruins world kit | `@blacksite/look`, `@blacksite/look/world` | [craft.md](references/craft.md), [atmosphere.md](references/atmosphere.md) |
| Open worlds: terrain to the horizon, ground cover, forests, one wind | `@blacksite/landscape` | [far-field.md](references/far-field.md), [foliage.md](references/foliage.md), [wind.md](references/wind.md) |
| Checks | `@blacksite/check` | [verify.md](references/verify.md) |

Run `blacksite catalog --json` for the live list; [catalog.md](references/catalog.md) is its release snapshot.

## References

| When | Read |
|---|---|
| Interviewing the user, sizing, writing the design and parts list | [design.md](references/design.md) |
| Creating the project | [setup.md](references/setup.md) |
| Building one mechanic in isolation | [prototype.md](references/prototype.md) |
| Joining proven prototypes into the loop | [combine.md](references/combine.md) |
| Lighting, materials, dressing, atmosphere, feedback | [craft.md](references/craft.md) |
| Authoring, weathering, comparing or baking procedural and image-derived materials | [materials.md](references/materials.md) |
| Sky, sun, aerial perspective, height fog and clouds outdoors | [atmosphere.md](references/atmosphere.md) |
| Terrain to the horizon, impostors and crossfades that never pop | [far-field.md](references/far-field.md) |
| Grass, flowers, undergrowth and trees | [foliage.md](references/foliage.md) |
| One wind for grass, trees, particles and sound | [wind.md](references/wind.md) |
| Movement, camera, aiming, controller response | [feel.md](references/feel.md) |
| Footsteps, weapons, ambience, mixing | [sound.md](references/sound.md) |
| Frame budgets and what gives way first | [performance.md](references/performance.md) |
| A game that misses its budget | [optimise.md](references/optimise.md) |
| Who owns which state: Koota, XState, Effect, the tick, the wire | [architecture.md](references/architecture.md) |
| Running the checks and reading their output | [verify.md](references/verify.md) |
| Deploying, only when the user asks | [ship.md](references/ship.md) |
| Assets the user already owns from Fab or itch.io | [assets.md](references/assets.md) |

## Checks

| Gate | Run | Passes when |
|---|---|---|
| Build | `pnpm check` in the game | Lint, types, build and the bundle budget pass. |
| Bundle | `blacksite budget` | Chunks, total JavaScript and assets fit `budget.config.json`. |
| Play | `blacksite check <url>` | `perf`, `hitch`, `pop`, `feel`, `critic` and `audio` pass on desktop and phone. |
| Eye | You, reading `critic/` and the pop sheets | A stranger would take every capture for a shipped game. |
| Hands | The user, at the URL you hand over | They've played it on their own device. |

Never edit a budget, a threshold or an assertion to make a gate pass. Split code, cut cost or fix the bug instead.

## Examples

Flagship games in `examples/`, each built only on public packages. Read the one closest to the request before starting.

| Example | Genre | What it shows | Status |
|---|---|---|---|
| Breach | First-person shooter | Gun feel, impact, squad AI | In progress |
| Traverse | Third-person action | Character feel, camera | In progress |
| Blackout | Horror | Lighting, sound, atmosphere | Coming |
| Arena | Multiplayer | Netcode that feels local | Coming |
| Valley | Open world | Streaming, scale | Coming |

The site's showcases are smaller proofs of one block each: Checkpoint (characters), Firing Range (weapons), Squad (AI), Air Strike (destruction) and Arena (multiplayer), in `site/src/showcases/`.

## Rules

Never read credential stores or any file whose name contains login, token, secret, key or credential; the `blacksite` CLI never prints credentials. Never copy purchased assets into a repository. Ship only assets whose licence allows it, and credit them. Leave the user's other repositories untouched. Don't deploy, push or publish unless the user asks.
