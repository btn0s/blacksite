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
```

It starts headless Chrome with the GPU on (WebGL and WebGPU), loads the page once per profile and writes `report.json` and PNGs to `--out` (default `blacksite-check/<time>/`). It exits 1 if any check fails.

| Check | What it does | Passes when |
|---|---|---|
| `perf` | Runs the game's `perf` script, or flies the camera through every bookmark for `--seconds` (12), then hands the camera back for 1.5 s. Records every frame. | Main-thread time per frame p95 ≤ `budget.frameMs` (8.3 desktop) or `budget.phoneFrameMs` (16.7 phone), and frame spacing p95 within 1.25× the vsync interval. |
| `hitch` | Same run. Counts every frame slower than `budget.hitchMs` (33) after first playable, and times first playable from navigation start. | No frame over the threshold, and first playable ≤ `budget.firstPlayableMs` (5000). |
| `pop` | Moves the camera between consecutive bookmarks in 10 steps and photographs each step with the HUD hidden; then holds each bookmark still for one second. Writes `pop-sheet.png` and `pop-still.png`. | No moving frame changes more than 2.5× its neighbours (more than the motion explains), and no still view changes more than 2% of its pixels in a second. Flagged frames are outlined red on the sheet. |
| `feel` | Desktop only. Hands the camera back, runs `scripts.feelStart` if present, holds `input.move` for 3 s, adds `input.sprint` for 3 s, releases, then taps `input.jump`. Reads `player()` every frame and derives speed from positions. | Steady move speed, sprint speed, time to 90% of top speed and jump apex are each within `feel.tolerance` (10%) of `model.feel`. Numbers without a model value are reported, not judged. |
| `critic` | At every bookmark: a 1× capture with the HUD on (desktop and phone), and on desktop a 4 × 4 grid of 4× crops rendered at full resolution through `camera.setViewOffset`, tiled into `critic/desktop-<name>-4x.png`. | Every capture is taken with no console errors and no failed requests. Passing proves only that the pictures exist. Reading them is your job. |
| `audio` | Polls `audio()` every 250 ms through the perf and feel runs. | Peak active voices ≤ `budget.voices` (32), and no cue plays the same sample twice in a row. |

The `phone` profile is 390 × 844 at device pixel ratio 3, with touch and a coarse pointer, and the CPU throttled 4×. `desktop` is 1440 × 900 at ratio 1.

Read the numbers the way they were measured:

- **Main-thread time is the frame budget you can measure headless.** Headless Chrome presents at the display's vsync (60 Hz on most hosts), so frame spacing can't show a 120 fps miss. Instead the check times every `requestAnimationFrame` callback, which is where React Three Fiber, the physics step, animation and the draw calls all run. GPU time isn't in it. A scene that is GPU-bound needs a real device.
- **Never turn vsync off to see more frames.** Headless runs with `--disable-gpu-vsync` showed 300–600 ms stalls in Air Strike that never happened with vsync on: the GPU fell far behind and buffer reallocations waited on it. A team chased them for an afternoon.
- **Headless is a lower bound.** The host shares its CPU with other agents. Say so in your report, give the load average, and leave 120 fps and phone claims to a playtest on the device.

## The contract

A game is checkable when it sets `window.__blacksite` once its first playable frame is on screen. The types and two helpers come from `@blacksite/check`:

```ts
import { applyCameraPose, exposeCheck, type Bookmark } from '@blacksite/check'

const check = exposeCheck({
  bookmarks,                                   // named camera poses, at least two
  camera(pose) { override.current = pose },    // a pose takes the camera over; null hands it back
  player() { return { position: [x, y, z] } }, // the player's position in metres, every frame
  audio() { return mixer.sample() },           // { voices, plays: [{ cue, sample }] } since the last call
  scripts: { perf: tour, feelStart },          // optional
  input: { move: 'KeyW', sprint: 'ShiftLeft', jump: 'Space' },
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
| `scripts.perf` | A representative run that resolves when done: the busiest fight, the biggest explosion, the longest sightline. Without it the check flies through the bookmarks. |
| `scripts.feelStart` | Puts the player at rest with at least 30 m of flat, open ground along `input.move`. Without it the run starts wherever the player is. |
| `input` | Key codes for the feel run. `move` is whatever runs the player along the open ground. Checkpoint uses `KeyS` because its runway lies behind the spawn. |
| `model.feel` | `moveSpeed`, `sprintSpeed` (m/s), `timeToTopSpeed` (s to 90%), `jumpApex` (m), `tolerance` (fraction). Import them from the model module the game runs on, never retype them. |
| `model.budget` | `frameMs`, `phoneFrameMs`, `hitchMs`, `firstPlayableMs`, `voices`. |

With React Three Fiber, apply the pose in a `useFrame` whose priority is after your camera's and below the post stack's render (Look renders at priority 1). With ALS that is `ALS_FRAME_PRIORITY.Camera + 0.05`. `site/src/showcases/characters/check.tsx` is a complete example in 50 lines.

A page without the contract still gets `perf`, `hitch` (first playable is then unknown and fails) and one critic capture. The rest report `skip` with the reason.

## Reading the output

`report.json` has every number. Print a summary with `blacksite check … | tail`:

```
pass  perf   desktop cpu p50 5.6 p95 6.9 p99 7.3 max 8 ms (budget 8.3); interval p95 16.7 max 16.8 ms
pass  perf   phone   cpu p50 12.4 p95 15.7 p99 17.1 max 18.6 ms (budget 16.7); interval p95 16.8 max 33.4 ms
pass  hitch  desktop 0 frames over 33 ms, longest 16.8 ms; first playable 1102 ms (budget 5000)
FAIL  hitch  phone   2 frames over 33 ms, longest 33.4 ms; first playable 2832 ms (budget 5000)
pass  feel   desktop moveSpeed 3.74/3.75, sprintSpeed 6.49/6.5, timeToTopSpeed 0.23, jumpApex 0.82/0.9
pass  pop    desktop 0 moving frames and 0 still views flagged of 41
pass  critic desktop 10 captures, 0 console errors
```

That is Checkpoint. Phone hitches are single missed vsyncs under a 4× throttle, and they still count: fix them or explain them in your report. Every check must reach zero before you call the game done.

Then read the pictures, critically:

1. `critic/desktop-*.png` and `critic/phone-*.png` at 1×. Ask the ten-second question: would a stranger take this screenshot for a shipped game with an art direction? Count against the parts list in `craft.md`: practicals lit, decals on walls, props in clusters, fog layering the distance, a readable silhouette at the focal point.
2. The `-4x` sheets, zoomed in. Every tile should still have something true in it. A blank wall, a stretched texture, a floating prop, a seam of light under a wall, a z-fighting decal and a prop with no contact shadow all show here and nowhere else.
3. `pop-sheet.png` frame by frame, and `pop-still.png` in pairs. A flagged frame is something that appeared, vanished or changed level of detail. A still pair that differs is streaming, a LOD swap or a shadow cascade jumping.
4. Phone captures: the HUD fits, touch controls don't cover the focal point, and text is at least 12 px.

## Before you hand it over

- Desktop and phone `blacksite check` runs with every line `pass`.
- Every PNG read at 1×, and every 4× sheet zoomed.
- Ten minutes of your own play in a headless capture sequence is not play. Hand the user a URL (`bb connect expose <port>` when available) and say what you measured and what only they can confirm on a real device: 120 fps on a 120 Hz display, GPU-bound frames, touch feel on a phone, audio in headphones.
