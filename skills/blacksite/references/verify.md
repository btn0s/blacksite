# Verify

Judge the game the way a player with a good eye would after ten minutes, before anyone else plays it. Your eye is not enough on its own. A hitch every 40 seconds, a building that pops in at 60 m, a jump that is 20% floaty and the same footstep sample twice in a row all look fine in one screenshot. `blacksite check` measures them, and each check ends in a pass or a fail with numbers.

## The checks

```sh
pnpm build && pnpm preview --port 4173 &
blacksite check http://localhost:4173/                     # every check, desktop and phone
blacksite check dist                                       # serves a built folder itself
blacksite check dist --page frames/game.html               # a page inside it
blacksite check http://localhost:4173/ --only feel,pop --profile desktop
blacksite check http://localhost:4173/ --out shots/check --seconds 20 --json
blacksite check http://localhost:4173/ --only shimmer,flyover               # opt-in: foliage, thin lines, far field
```

It starts headless Chrome with the GPU on (WebGL and WebGPU), loads the page once per profile and writes `report.json` and PNGs to `--out` (default `blacksite-check/<time>/`). It exits 1 if any check fails and 2 if the only problem is a timing result inside the measurement noise.

Every phase has a time limit of 4× what it should take: loading against `budget.firstPlayableMs`, the scripted run against `model.scripts.perf` or `--seconds`, and every capture phase against its frames at `budget.hitchMs` and its screenshots at the time the first one took. A phase that throws or runs out of time fails with the phase, the message, where `player()` was and how long it had been standing still, the first error, and a capture in `failures/`. After a phase runs out of time the page is closed, the rest of that profile is reported as not run, and the next profile starts. A check always finishes.

Perf and hitch measure time, so they run one at a time on a machine. Before loading for them, the check takes a slot that every `blacksite check` on the machine respects, and prints who holds it while it waits in the queue. Every other check draws on the same GPU, so the others share the slot: they render together, but step aside while a timed run is in progress, and their page stays paused while it waits.

| Check | What it does | Passes when |
|---|---|---|
| `perf` | Runs the game's `perf` script, or flies the camera through every bookmark for `--seconds` (12), then hands the camera back for 1.5 s. Records every frame. | Main-thread time per frame p95 ≤ `budget.frameMs` (8.3 desktop) or `budget.phoneFrameMs` (16.7 phone), and frame spacing p95 within 1.25× the vsync interval. The p95 of each quarter of the run gives the spread; when the p95 is closer to the budget than that spread, or it misses while the machine had more runnable work than cores, the result is `????` inconclusive instead of pass or fail. |
| `hitch` | Same run. Counts every frame slower than `budget.hitchMs` (33) after first playable, and times first playable from navigation start. | No frame over the threshold, and first playable ≤ `budget.firstPlayableMs` (5000). A miss while the machine had more runnable work than cores is `????` inconclusive. |
| `pop` | Moves the camera between consecutive bookmarks in 10 steps and photographs each step with the HUD hidden; then holds each bookmark still for one second, with `scripts.freeze` holding wind and animation if the game has it. Writes `pop-sheet.png` and `pop-still.png`. | No moving frame changes more than 2.5× its neighbours (more than the motion explains), and no still view changes more than 2% of its pixels in a second. Flagged frames are outlined red on the sheet. |
| `feel` | Desktop only. Hands the camera back, runs `scripts.feelStart` if present, holds `input.move` for 3 s, adds `input.sprint` for 3 s, releases, then taps `input.jump`. Reads `player()` every frame and derives speed from positions. | Steady move speed, sprint speed, time to 90% of top speed and jump apex are each within `feel.tolerance` (10%) of `model.feel`. Numbers without a model value are reported, not judged. |
| `critic` | At every bookmark: a 1× capture with the HUD on (desktop and phone), and on desktop a 4 × 4 grid of 4× crops rendered at full resolution through `camera.setViewOffset`, tiled into `critic/desktop-<name>-4x.png`. | Every capture is taken with no console errors and no failed requests. Passing proves only that the pictures exist. Reading them is your job. |
| `zfight` | At every bookmark renders an object-ID buffer several times, each with a sub-pixel projection jitter and a 0.7 mm camera nudge, then again with the nudges alone, using the game's own materials, render target and depth format. Pixels whose winning ID flips between frames, and still flips under the nudges alone, are z-fighting. Pixels that flip only under jitter are edge aliasing, reported as `edgeFlicker` per bookmark but not counted. Writes `zfight/<profile>-<bookmark>.png` with the pixels ringed, and `-raw.png` beside it. | Ringed pixels at every bookmark ≤ max(32, 0.003% of the frame), and the ID pass covered at least 2% of the view (an empty buffer proves nothing). Edges don't count: a pixel only counts when it sits in a patch at least 4 px across, and when the two IDs that flip are within a few centimetres of each other in depth (the ID pass stores depth in alpha), so a thin bar flickering against the wall behind it is not reported. |
| `audio` | Polls `audio()` every 250 ms through the perf and feel runs. | Peak active voices ≤ `budget.voices` (32), and no cue plays the same sample twice in a row. |
| `stress` | Runs last, with the frame loop driven at 144 Hz, so frames come faster than a 60 Hz fixed physics step and some frames run no physics substep at all. Six pointer-lock and release rounds, which re-render the scene while the player stands still; six rounds of moving, sprinting and jumping that end with a respawn; the tab hidden for 2 s; a 2.5 s main-thread stall while sprinting; fullscreen and three viewport sizes; then the player sprinting and jumping into each corner of the world bounds. The respawn and edge steps drive `character`; without it they skip. Each step has 4× its own length to finish. | No error, unhandled rejection or `console.error` from first playable to the end. It stops at the first one and reports the step and the stack. |
| `shimmer` | Opt-in. At every bookmark, with `scripts.freeze` holding wind and animation: reads 8 consecutive frames with the camera still, then shifts the view by ¼, ½ and ¾ of a render pixel across and down through `camera.setViewOffset`. Still flicker is the per-pixel luminance change between frames. Motion shimmer is what is left after the shifted frame is compared with the still frames resampled by the same shift, both lightly blurred, so true motion cancels and only aliasing survives. Writes `shimmer/<profile>-<name>.png` heatmaps and `shimmer-<profile>.png`. | Mean still flicker ≤ `quality.shimmerStill` (0.01) and mean motion shimmer ≤ `quality.shimmerMotion` (0.03) at every bookmark, in 0–1 luminance. p99 and max are reported, not judged. |
| `flyover` | Opt-in. Flies a smooth spline through `flyover` with 16 frames a segment, wind frozen, and records the mean squared luminance change between consecutive frames. Writes `flyover-<profile>.png`, a contact sheet with flagged frames outlined red, and `flyover-<profile>.json`. | No more than `quality.popLimit` (0) of the frames change more than 2.5× the median of the two frames either side. |

The `phone` profile is 390 × 844 at device pixel ratio 3, with touch and a coarse pointer, and the CPU throttled 4×. `desktop` is 1440 × 900 at ratio 1.

Read the numbers the way they were measured:

- **Main-thread time is the frame budget you can measure headless.** Headless Chrome presents at the display's vsync (60 Hz on most hosts), so frame spacing can't show a 120 fps miss. Instead the check times every `requestAnimationFrame` callback, which is where React Three Fiber, the physics step, animation and the draw calls all run. GPU time isn't in it. A scene that is GPU-bound needs a real device.
- **Never turn vsync off to see more frames.** Headless runs with `--disable-gpu-vsync` showed 300–600 ms stalls in Air Strike that never happened with vsync on: the GPU fell far behind and buffer reallocations waited on it. A team chased them for an afternoon.
- **Headless is a lower bound.** The host shares its CPU with other agents and their builds. The timing slot keeps other checks out of a perf run, but not builds, so perf and hitch record the load average per core before and after the run. Load only makes frames slower, so a pass under load stands, but a miss at a load of one or more per core, or a p95 inside the run's own spread, comes back `????`. Rerun those when the machine is quieter instead of reading them. Give the load in your report, and leave 120 fps and phone claims to a playtest on the device.

## The contract

A game is checkable when it sets `window.__blacksite` once its first playable frame is on screen. A scaffolded game has it in `src/game/check.tsx`, reading `src/game/model.ts`, so a fresh scaffold passes. The types and two helpers come from `@blacksite/check`:

```ts
import { applyCameraPose, exposeCheck, type Bookmark } from '@blacksite/check'

const check = exposeCheck({
  bookmarks,                                   // named camera poses, at least two
  camera(pose) { override.current = pose },    // a pose takes the camera over; null hands it back
  player() { return { position: [x, y, z] } }, // the player's position in metres, every frame
  audio() { return mixer.sample() },           // { voices, plays: [{ cue, sample }] } since the last call
  scripts: { perf: tour, feelStart },          // optional
  input: { move: 'KeyW', sprint: 'ShiftLeft', jump: 'Space' },
  character: player.check,                     // the Character Controller's check driver
  model: { feel: FEEL, budget: BUDGET },       // the same numbers the game runs on
})
check.ready()                                  // when the first playable frame is on screen
```

| Field | Meaning |
|---|---|
| `version` | `1`. Set by `exposeCheck`. |
| `ready` | `true` once a player could act: assets loaded, shaders warmed, the first frame drawn. The time to this is first playable. Set it with `check.ready()`. |
| `bookmarks` | `{ name, position, target, fov?, note? }[]` in metres. Pick the views a critic would judge the game from: the spawn, the hero view, the densest corner, a long view down the biggest sightline, an overview. Order them as a walk through the level; the pop check flies between neighbours. |
| `camera(pose)` | While a pose is set, apply it every frame after the game's own camera and before render, with `applyCameraPose(camera, pose, size)`, which also handles the `view` crop the critic grid uses. `null` hands the camera back. The game keeps simulating. |
| `player()` | `{ position }` of the controlled player, or `null`. Read the physics body, not the mesh. |
| `audio()` | `{ voices, plays }`: voices playing now, and each sound started since the last call as `{ cue, sample }`. `createAudioLog()` keeps both if you call its `start(cue, sample)` and `end()` from your mixer. |
| `scripts.perf` | A representative run that resolves when done: the busiest fight, the biggest explosion, the longest sightline. Without it the check flies through the bookmarks. When it can't go on, throw with where it stopped (`stuck before waypoint 33 at [122.4, 5.6, -3.3]`); the check adds the capture. |
| `model.scripts` | Seconds each script should take, such as `{ perf: route.parSeconds }`. A script without one should take `--seconds` (12). The check gives a script 4× its time. |
| `scripts.feelStart` | Puts the player at rest with at least 30 m of flat, open ground along `input.move`. Without it the run starts wherever the player is. |
| `input` | Key codes for the feel and stress runs. `move` is whatever runs the player along the open ground. Checkpoint uses `KeyS` because its runway lies behind the spawn. |
| `character` | `controller.check` from the Character Controller: `respawn`, `move`, `face` and `bounds`. The stress run respawns the player mid-stride and drives it into each corner of the world. |
| `model.feel` | `moveSpeed`, `sprintSpeed` (m/s), `timeToTopSpeed` (s to 90%), `jumpApex` (m), `tolerance` (fraction). Import them from the model module the game runs on, never retype them. |
| `model.budget` | `frameMs`, `phoneFrameMs`, `hitchMs`, `firstPlayableMs`, `voices`. |
| `model.quality` | `shimmerStill`, `shimmerMotion` and `popLimit` for the opt-in checks. Set them once you have measured a view you are happy with, a little above the measurement. |
| `flyover` | `{ position, target, fov? }[]`: a camera path that crosses every level-of-detail band, low over the near ground, through the mid-distance and out to the horizon. Without it `flyover` skips. |
| `scripts.freeze`, `scripts.unfreeze` | Stop and restart wind, foliage sway, particles and anything else that moves with no input, so frame differences are rendering, not motion. |

With React Three Fiber, apply the pose in a `useFrame` whose priority is after your camera's and below the post stack's render (Look renders at priority 1). With ALS that is `ALS_FRAME_PRIORITY.Camera + 0.05`. `site/src/showcases/characters/check.tsx` is a complete example in 50 lines.

A page without the contract still gets `perf`, `hitch` (first playable is then unknown and fails) and one critic capture. The rest report `skip` with the reason.

## Z-fighting

Two surfaces at the same depth look fine in a still and shimmer as soon as the camera moves; the check above finds them by what flips, and `blacksite lint` finds them before anything renders:

```sh
blacksite lint dist --page frames/game.html          # static: triangles, BVH, depth maths
blacksite lint dist --page frames/game.html --near 0.1 --far 300 --bits 24
blacksite lint scene.glb                             # a glTF, in Node, no browser
```

The lint takes every mesh in the scene (instanced and batched meshes included; skinned meshes at their current pose), finds triangle pairs that are within 1° of coplanar and overlap with real area, and asks whether the gap between them is smaller than the depth buffer can resolve at the distance each camera bookmark sees them. It reports both mesh names (or the `userData.parts` labels `LevelBuilder` writes), the world position, the overlap area, the gap and the gap that would be needed, so a 1 mm gap at 2 m passes and the same gap at 300 m fails. It exits 1 on any problem and runs in well under a second on a 250,000-triangle scene. From code: `lintZFighting(scene, options)` from `@blacksite/check`.

Reading a line:

```
zfight  look-panel#21 and look-cast#29 overlap 909.4 m² at (-3.6, 0, -112), 0 mm apart; 34.6 mm needed at 120.4 m from view
```

`0 mm apart` is exactly coplanar: no depth format fixes it, move one surface. A gap smaller than the one `needed` is a decal or overlay: use `decalBias`, or lift it by the stated amount. Meshes that draw without writing depth (blended decals) are only compared with meshes that do. Transforms that live on the GPU (the Cascade fragment pool) can't be read back, so the lint reports them as pooled; the runtime check covers those.

Fixes, in the order to try them: delete the hidden surface; trim the overlap; push the smaller face out by the `needed` gap plus margin; give flat overlays `decalBias`; raise the camera near plane. `LevelBuilder` does the third by default and says so. Reversed depth is not available as a default (N8AO renders white with it); logarithmic depth works with the Look composer but needs `logdepthbuf` chunks in every custom shader.

## Reading the output

`report.json` has every number. Print a summary with `blacksite check … | tail`:

```
pass  perf   desktop cpu p50 5.6 p95 6.9 p99 7.3 max 8 ms (budget 8.3, quarters ±0.4); interval p95 16.7 max 16.8 ms; load 0.31 → 0.33 per core
????  perf   phone   cpu p95 15.7 ms (budget 16.7): cpu p95 is 1 ms from the budget and the four quarters of the run spread ±1.6 ms; rerun when the machine is quieter (load 0.52 → 0.61 per core)
pass  hitch  desktop 0 frames over 33 ms, longest 16.8 ms; first playable 1102 ms (budget 5000)
FAIL  hitch  phone   2 frames over 33 ms, longest 33.4 ms; first playable 2832 ms (budget 5000)
pass  feel   desktop moveSpeed 3.74/3.75, sprintSpeed 6.49/6.5, timeToTopSpeed 0.23, jumpApex 0.82/0.9
pass  pop    desktop 0 moving frames and 0 still views flagged of 41
pass  critic desktop 10 captures, 0 console errors
FAIL  stress desktop first error during pointer: unreachable
```

That is Checkpoint, with a stress failure from an early Valley build. A script that stops reads like this:

```
FAIL  perf   phone   scripted run failed: performance route failed: stuck before waypoint 33 [121.6, 5.8, -3.0] at [122.4, 5.6, -3.3]; player at [122.4, 5.6, -3.3], still for 11.8 s; capture failures/phone-scripted-run.png
```
 Phone hitches are single missed vsyncs under a 4× throttle, and they still count: fix them or explain them in your report. Every check must reach zero before you call the game done.

Then read the pictures, critically:

1. `critic/desktop-*.png` and `critic/phone-*.png` at 1×. Ask the ten-second question: would a stranger take this screenshot for a shipped game with an art direction? Count against the parts list in `craft.md`: practicals lit, decals on walls, props in clusters, fog layering the distance, a readable silhouette at the focal point.
2. The `-4x` sheets, zoomed in. Every tile should still have something true in it. A blank wall, a stretched texture, a floating prop, a seam of light under a wall, a z-fighting decal and a prop with no contact shadow all show here and nowhere else. A decal that shimmers will also be ringed in `zfight/`.
3. `pop-sheet.png` frame by frame, and `pop-still.png` in pairs. A flagged frame is something that appeared, vanished or changed level of detail. A still pair that differs is streaming, a LOD swap or a shadow cascade jumping.
4. Phone captures: the HUD fits, touch controls don't cover the focal point, and text is at least 12 px.
5. With grass, trees or thin lines, run `shimmer` and open each heatmap. The left panel lights pixels that flicker with nothing moving: an unstable dither, temporal noise, a shadow cascade swimming. The right panel lights pixels that alias when the camera drifts by a fraction of a pixel. Expect grass tips and leaf edges to show faintly; solid yellow patches mean alpha-tested cards need alpha-to-coverage or sharpened alpha, or a texture needs mipmaps. See `worlds.md`.
6. With a far field, run `flyover` and read the contact sheet as a film strip. A red frame is a tree swapping to its impostor, terrain detail switching, grass ending in a ring or a shadow cascade jumping. The JSON gives the frame and its pose; put the camera there with a bookmark and look. See `worlds.md`.

## Before you hand it over

- Desktop and phone `blacksite check` runs with every line `pass`.
- Every PNG read at 1×, and every 4× sheet zoomed.
- A headless capture run isn't play. Hand the user a URL (`bb connect expose <port>` when available) and say what you measured and what only they can confirm on a real device: 120 fps on a 120 Hz display, GPU-bound frames, touch feel on a phone, audio in headphones.
