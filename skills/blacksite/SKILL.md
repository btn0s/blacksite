---
name: blacksite
description: "Game development know-how for coding agents building 3D browser games with three.js and React Three Fiber: what good games do and how to build it fast in the browser (game feel, weapons and hit feedback, enemy AI, game audio, lighting and grading, open worlds and LOD, phone performance, multiplayer), plus building blocks, templates, example games and checks. Use for anything game-related, even if the user never says engine or Blacksite. That includes a game idea, a level, a mechanic, a character, a weapon, enemies, destruction, multiplayer, game feel, lighting and atmosphere, game audio, frame rate, a prototype, or shipping a game."
argument-hint: <idea>
---

# Blacksite

**Build what shipped games build, because players feel the difference.** A request names a feature. Shipped games solved that feature years ago, and players know the solved version by feel even when they can't name it. The naive version runs, passes every test, and reads as a student project in the first second. Build the solved version from the start, and build it so it holds its frame rate in a browser, on a phone too.

Use `$ARGUMENTS` as the idea. If it's empty, ask **What would you like to make?** and offer: a new game from an idea; continue a game; one mechanic; make an existing game look, feel or run better; ship a game; use assets you already own. Ask one question at a time and keep every choice the user makes.

**Setup.** The building blocks, templates and checks come with the `blacksite` command. If it isn't installed (`blacksite doctor` fails), tell the user, and with their OK run the official installer with `--skip-agents`, since this skill is already installed: `curl -fsSL https://raw.githubusercontent.com/btn0s/blacksite/main/install.sh | sh -s -- --skip-agents`, or in PowerShell on Windows `& ([scriptblock]::Create((irm https://raw.githubusercontent.com/btn0s/blacksite/main/install.ps1))) '--skip-agents'`. It needs Node, git and pnpm, clones Blacksite into `~/.blacksite`, puts `blacksite` on the PATH and leaves every agent's skills alone. Then continue.

## The solved version

| You ask for | The naive version | The solved version |
|---|---|---|
| Footsteps | One sample on a timer | Triggered by the animation's foot plants. A set of 3–5 samples per surface, never the same one twice in a row, ±5% pitch and ±1.5 dB volume. A landing sound scaled by fall speed. Attenuated by distance. |
| A forest | One tree copied over a flat green plane | 3–4 species at 0.7–1.3× scale with random yaw, clustered around clearings. Undergrowth, rocks and fallen trunks. Instanced, with far trees as impostors. Fog layering the depth. Wind moving the crowns in the vertex shader. |
| A flashlight | A spotlight glued to the camera | A cookie texture, about 0.08 s of lag behind the view, the only shadow-casting light near the player, a little bounce light, and a beam you can see in the haze. |
| An explosion | A sprite and an impulse | A flash light for 0.1 s, a fireball, smoke that hangs for 5–10 s, debris with contact shadows, a scorch decal, camera shake falling off with distance, and the sound arriving at 343 m/s with a low-pass tail. |
| A gun | A ray and a muzzle flash | A 600 RPM fixed-step weapon, per-shot recoil the view recovers from, viewmodel kick, a tracer on one round in three, impact decals and dust per surface, shell casings, and a tail that matches the room. |
| Smart enemies | A chase in a straight line with perfect aim | Vision cones and hearing, a 0.2 s reaction delay, cover, squad roles, callouts that tell the player what they're doing, and aim that starts wide and tightens. |
| A jump | Upward velocity on a key press | About 0.9 m apex at 9.8 m/s², 0.1 s of coyote time, a 0.1 s jump buffer, a landing dip in the camera and a landing sound. |
| A third-person camera | A fixed offset behind the player | A shoulder offset, a collision-traced spring arm, lag on position but not on aim, and a narrower FOV when aiming. |
| A big world | One scene loaded at start | Streamed cells, levels of detail and impostors, a horizon hidden in fog, a per-frame streaming budget, and nothing visibly popping in. |
| Health | A number in a corner | Hit direction indicators, a red vignette that pulses with the heartbeat, muffled audio at low health, and regeneration you can hear start. |
| The first shot | Shaders compile when the gun first fires, and the frame stalls | Every material, light count and post pass compiled behind the loading screen, with one real frame rendered before the game reports ready. |

When a request isn't in the table, ask the same question first: what did the games that shipped this do? Then build that version.

## What shipped games know, by area

Each area's reference holds the numbers, the way to build it fast in the browser, and the failure behind each rule. Read it before building in that area. Sections marked *proposed* come from one flagship's tuning; use them as the starting point and record what changed.

**Feel: movement, camera, aim** ([feel.md](references/feel.md))
- Walk 1.75, run 3.75, sprint 6.5 m/s; 90% of top speed in about 0.25 s; jump apex 0.9 m with 0.1 s of coyote time and a 0.1 s buffer.
- First-person eye at 1.63 m, world FOV 75°, the viewmodel at 56° in its own pass. Scale look by aim FOV over hip FOV while aiming.
- **One owner for the view.** Two readers of the mouse at different rates made a 1.75° sawtooth.
- **Frame order:** control rotation, character, physics, pose, animation, camera, then attachments.
- **Send gait, not speed.** Speed in the wrong unit played the walk at 2.5×. Prove locomotion by foot slip: 3 cm per plant.
- **One set of arms.** In first person, the arms viewmodel or the body from the head, never both.
- Touch is playable at 390 px: a 124 px stick, a look zone on the right 60%, buttons of at least 44 px. Pointer lock is optional.

**Combat and feedback** ([combat.md](references/combat.md))
- **Every action has three responses:** something you see, something you hear, and something the camera or controller does.
- One tracer in three; every round on fire read as bars of light.
- Shake is one trauma value, applied squared, falling off with distance. Hit markers confirm hits; the target flinches.
- **Don't hide the payoff.** Smoke hid a collapse and the charges landed 10 s late; check that a scripted moment happens where the camera looks.
- **One action clock:** foley from the clip's events, the same duration in the weapon.
- Physics never runs slower than the wall clock: drop fidelity, never rate.

**Enemies** ([enemies.md](references/enemies.md))
- Vision 37 m and 155°, hearing 32 m, a reaction of about 0.2 s, memory that decays.
- **Barks are what players read as smart.** Announce the move before it happens, so the player can counter it.
- The first burst misses; aim starts wide and tightens; only a couple of enemies shoot at once.
- One enemy type needs a small state machine, not a squad.

**Sound** ([sound.md](references/sound.md))
- A bed, spot sounds, foley, events, interface, music and voice. Nothing silent.
- **Sound travels:** delay distant sounds at 343 m/s, but never the player's own gun.
- The listener's room sets the reverb tail. Cap voices at 32 and steal with a fade, never cutting a transient.
- Weapons duck ambience, dialogue ducks everything, and the master ends in a limiter with headroom left.

**Light, materials and dressing** ([craft.md](references/craft.md))
- **Light has a source.** One key, a fill at about a third of it, and practicals that explain the light; two per interior.
- Shadows from the key only, near the player. Bloom only on emissives, above a 1.35 threshold. One tonemapper and one exposure, owned by the look.
- **No flat materials:** colour, roughness and normal variation from 512 px textures at real-world scale. A prop with no contact shadow floats.
- **Two surfaces never share a plane.** A 1 cm gap that held at 2 m flickered across 20,000 pixels at 150 m. Pick the near plane for the depth buffer, not the eye, and resolve coplanar faces when the level is built.
- The post stack is one HDR chain ending in a single grade pass; it costs real time, so phones run the low tier.
- **Dress in clusters** of 3–7 against walls and at corners, with clear paths. Open floor at even spacing reads as a test map.
- **Make it live.** Nothing perfectly still for more than a second.

**Worlds and scale** ([worlds.md](references/worlds.md))
- Fog between the camera and the far plane on every outdoor shot, in the horizon's colour. Ridges step back in four or five paler layers.
- A low sun, 20–30° up, for grazing light and back-lit grass.
- **Every handover is a band, and both sides draw.** Dither between mesh, impostor and canopy; never cut, never alpha-blend.
- Terrain LOD on fixed world nodes that morph, never a grid that follows the camera. The horizon is fog, not a far plane. Streaming isn't built yet; phone first playable is a world-build cost.
- Ground cover thins blade by blade on world-stable patches; tiers change density, not the look.
- **One wind** for grass, trees, particles and sound, with gusts that travel.

**Performance** ([performance.md](references/performance.md))
- **Budget:** 8.3 ms of main-thread time a frame on desktop (120 fps), 16.7 ms on phones (60 fps), no frame over 33 ms, first playable within 5 s.
- When over budget, cut resolution first, then effect resolution, distance and density, update rates, and materials and lighting last. Phones get no AO or bloom and a pixel ratio of at most 1.25.
- **Measure the bound thread.** A physics win that doesn't move main-thread p95 isn't a frame-rate win. The periodic heavy frame sets p95.
- Animate far characters less often; merge draws by material; send definitions once, then changes.
- **Warm everything before ready.** Compile the scene as played, with the real light count and one frame through the post stack; build audio graphs at load; never toggle a light, since that recompiles every lit shader.
- Step simulation at a fixed 1/60 s; workers cap their catch-up and send patches, not worlds.
- Blacksite renders with WebGL2 and GLSL today. WebGPU isn't built; don't promise it.

**Multiplayer** ([multiplayer.md](references/multiplayer.md))
- Predict your own movement, interpolate others 100 ms in the past, and let the server own hits.
- Replicate the recorded state (gait, stance, actions), not a guess from speed. A new life is a new remote.

## Two ways to fail

- **Tutorial-grade.** Everything works and nothing is dressed: grey boxes, one light, default fog, no sound, every material the same matte. The test: would a stranger take a screenshot of it for a shipped game with an art direction?
- **Feature soup.** Twelve systems started and none finished: an inventory, crafting, a skill tree and a day–night cycle around a loop that isn't fun yet. The test: can you name the one loop, and does every part on screen serve it?

Depth beats breadth. One room, finished, beats a continent of grey boxes.

## Building blocks

Read [building-blocks.md](references/building-blocks.md) before wiring a block; it has each block's calls, guides and gaps. Paths like `docs/cascade.md` are relative to the Blacksite repository; inside a generated game they're under `vendor/blacksite/`.

| Block | Package |
|---|---|
| Characters: an animated body, first and third person | `@blacksite/subject`, `@blacksite/subject-fpp`, ALS |
| Weapons | Armory, `@blacksite/armory` |
| AI: squads that perceive, plan and take cover | Warden, `@blacksite/warden` |
| Destruction: buildings that break by structure | Cascade, `@blacksite/cascade` |
| Multiplayer | Relay, `@blacksite/relay` |
| Input: keyboard, gamepad, touch | `@blacksite/input`, `@blacksite/ui/hud` |
| The look: post stack, atmosphere, the ruins world kit | `@blacksite/look`, `@blacksite/look/world` |
| Materials: authored, weathered and baked | `@blacksite/materials` |
| Open worlds: terrain to the horizon, ground cover, forests, one wind | `@blacksite/landscape` |
| Sound: mixer, spatial sound, rooms | `@blacksite/soundscape` |
| Checks | `@blacksite/check` ([verify.md](references/verify.md)) |

Run `blacksite catalog --json` for the live list; [catalog.md](references/catalog.md) is its release snapshot. [architecture.md](references/architecture.md) says who owns which state: Koota, XState, Effect, the tick and the wire.

## Checks

| Gate | Run | Passes when |
|---|---|---|
| Build | `pnpm check` in the game | Lint, types, build and the bundle budget pass. |
| Bundle | `blacksite budget` | Chunks, total JavaScript and assets fit `budget.config.json`. |
| Play | `blacksite check <url>` | `perf`, `hitch`, `pop`, `feel`, `critic` and `audio` pass on desktop and phone. |
| Eye | You, reading `critic/` and the pop sheets | A stranger would take every capture for a shipped game. |
| Hands | The user, at the URL you hand over | They've played it on their own device. |

Never edit a budget, a threshold or an assertion to make a gate pass. Split code, cut cost or fix the bug instead. [verify.md](references/verify.md) has every check, the contract and how to read the pictures.

## How to work

[process.md](references/process.md) has the interview, the design files, setup, prototypes, combining, assets and shipping.

| Size | What it is | Time | When |
|---|---|---|---|
| **Mechanic** | One verb in one space, finished to shipped quality: a gun on a range, a jump across rooftops. | Hours | When the user asks for one mechanic, or a Slice has one risky part. |
| **Slice** | One complete loop in one dressed space, 5–10 minutes of play with a start, a way to fail and an end. | A day or a few sessions | **The default.** |
| **Game** | Several loops, many spaces, progression. | Months | Don't start one. Propose the Slice that proves its core loop, and say what the Slice will prove. |

1. **Numbers and parts first.** The real numbers go in `src/game/model.ts`, taken from the references, and a parts list with a minimum count per part goes in `docs/game-design.md`. The list is the scope.
2. **Prototype the risky mechanics alone**, each built to its shipped version, then join the ones that worked into one loop with one owner for every piece of state.
3. **Dress it and make it live**, then run the checks on desktop and phone until every line passes, read every picture as a harsh critic, and hand the user a URL.

Starting from an existing game, read `docs/game-design.md`, `docs/prototypes/*.md` and `src/game/model.ts`, and run `blacksite check` before changing anything:

- **"Make it look better."** Read the critic captures against the parts list and `craft.md`. Fix the biggest gap first, usually light, fog or dressing density, not post effects.
- **"It feels floaty" or "sluggish."** Run `blacksite check --only feel` and compare with `feel.md`. Change the model's numbers, not the code around them.
- **"It stutters."** Run `--only perf,hitch` on both profiles and follow `performance.md`.
- **"Add a feature."** Find its row in the table above, or work out what the shipped version had, and add it to the parts list first.

Hand over with a link (`pnpm dev --host 0.0.0.0`; with bb, `bb connect expose 5173`), and say what was built against the parts list, the `blacksite check` summary lines and the host's load, what only the user can confirm (120 fps on a 120 Hz display, GPU-bound frames, touch on a real phone, the mix in headphones), and the open questions, one line each. Never call something done that a gate didn't pass or that nobody played.

## Examples

Flagship games in `examples/`, each built only on public packages. Read the one closest to the request before starting.

| Example | Genre | What it shows | Status |
|---|---|---|---|
| Breach | First-person shooter | Gun feel, impact, squad AI | In progress |
| Traverse | Third-person action | Character feel, camera | In progress |
| Valley | Open world | Terrain to the horizon, foliage, wind, scale | Experimental |
| Blackout | Horror | Lighting, sound, atmosphere | Coming |
| Arena | Multiplayer | Netcode that feels local | Coming |

The site's showcases are smaller proofs of one block each: Checkpoint (characters), Squad (AI), Air Strike (destruction) and Arena (multiplayer), in `site/src/showcases/`.

## Rules

Never read credential stores or any file whose name contains login, token, secret, key or credential; the `blacksite` CLI never prints credentials. Never copy purchased assets into a repository. Ship only assets whose licence allows it, and credit them. Leave the user's other repositories untouched. Don't deploy, push or publish unless the user asks.
