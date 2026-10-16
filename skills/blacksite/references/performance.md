# Performance

Frame, loading and bundle budgets for desktop and phone, what gives way first when a frame is over, and the failures behind each rule. The budget is part of the look: a beautiful scene that hitches every 40 seconds reads as broken, and a player forgives a plainer frame long before a stutter.

## Budgets

| Budget | Desktop | Phone | Checked by |
|---|---|---|---|
| Frame rate | 120 fps | 60 fps sustained, 120 where the device allows | `blacksite check` perf |
| Main-thread time per frame, p95 | 8.3 ms | 16.7 ms | perf |
| Longest frame after first playable | 33 ms | 33 ms | hitch |
| First playable | 5 s | 5 s | hitch |
| Active sound voices | 32 | 32 | audio |
| One JavaScript chunk | 4 MB | | `blacksite budget` |
| All JavaScript | 8 MB | | budget |
| All other assets | 20 MB | | budget |
| Textures | KTX2 | | budget |
| Meshes | glTF with meshopt compression | | budget |
| Simulation | Fixed 60 Hz step | | budget |

Put the frame budgets in `src/game/model.ts` and pass them to the check contract as `model.budget`.

## What gives way first

When a target misses its budget, cut in this order. Each step costs the look less than the next.

1. **Resolution.** Render pixel ratio first: 1 on desktop, at most 1.25 on phones. `internalPixelRatio()` from `@blacksite/look/world` applies that cap.
2. **Effect resolution.** The `QUALITY` tiers in `@blacksite/look`:

   | Tier | MSAA | AO | Bloom | Max pixel ratio |
   |---|---|---|---|---|
   | high | 4× | half-res, 8 samples | 8 levels | 2 |
   | medium | 2× | half-res, 4 samples | 5 levels | 1.5 |
   | low | off | off | off | 1.25 |

   `autoQuality()` picks low for a coarse pointer or a screen under 600 px, medium for 4 or fewer cores, and high otherwise. Shadow maps: 2048 on desktop, 1024 on touch.
3. **Distance and density.** Draw distance, prop and foliage counts, particle counts. Fog hides the shorter distance.
4. **Update rates.** Far characters animate less often, shadows refresh every other frame, AI thinks at 30 Hz or less.
5. **Materials and lighting**, last. A flat-shaded world is what the player notices.

The scaffold writes mobile scales into `budget.config.json` (render 0.75, effects 0.5, distance 0.6, density 0.5, update rate 0.5), but nothing reads them yet. Apply them in the game's own quality setup.

## Rules, and the failures that taught them

- **Measure the thread that is actually bound.** Cascade's rest policy cut late active bodies from about 950 to under 700 and the worker step from 16.6 to 13.0 ms. Main-thread p95 stayed at 26–28 ms, because physics runs in a worker and the main thread was bound by rendering. Before calling anything a frame-rate win, check which thread sets the frame time.
- **The periodic heavy frame sets p95.** In Air Strike, 30 Hz snapshot frames were 11–18% of all frames and set p95. On each, the main thread rebuilt 3,600 bonds and 770 actors and uploaded transforms one call at a time. Sending deltas, coalescing uploads and skipping unchanged rebuilds took settle p95 from 15.6–20.4 ms to 8.3–9.7 ms, pixel for pixel identical. Optimize the spike, not the average.
- **Every sub-draw is a real draw call.** Fracture bevels were 400,000 of 460,000 triangles across 4,300 sub-draws. Merging them into one draw per chunk removed thousands of draws, and the 2.5 cm bevels stopped casting shadows that nobody could see. Coarser bevels cut triangles and didn't raise fps.
- **A/B each suspect at the same load.** Turning off shadow refresh and AO on Air Strike's heavy frames gained nothing measurable. Toggle each suspected cost against a baseline under the same load, and keep only changes that move the measured frame.
- **Animate far characters less often.** ALS pose evaluation cost about 1.4 ms per soldier and dominated a 5v5 Squad round. Poses now run at full rate within 12 m, then every 2nd, 3rd or 4th frame with distance, and every 8th off screen; the followed soldier is always full rate. Ragdolls settled for 1.2 s become static meshes. Frame time fell from about 21 ms to 6–10 ms.
- **The post stack costs real time.** Adding the Look stack to Checkpoint took it from 199 fps (p95 6.6 ms) to 137 fps (p95 10.1 ms). Phones get the low tier. Secondary views render at reduced resolution; Arena's hidden bot canvas renders at a pixel ratio of 0.25 with no post.
- **Send definitions once.** Structured-cloning a full 3,000-piece world each snapshot cost the main thread 45–110 ms. Send each definition once, then ids and changes.
- **Make worker snapshots render-sized.** Warden's worker sent 557 KB a tick including decision traces and the map. Sending only what presentation draws cut that to a few KB.
- **No allocation or I/O in the tick.** The fixed step is plain synchronous code that writes Koota traits. Promises, Effects and `new` in the hot loop show up as garbage-collection hitches.
- **Split code before raising a budget.** Never raise a budget to fit. Load gameplay scenes, first-person arms and optional views on demand.
- **Physics never runs slower than the wall clock.** When a step costs more than the time it simulates, the game plays in slow motion. Budget each step and drop fidelity (sleep, bake, defer, cap debris) before rate.

## Measuring

`blacksite check` measures main-thread time headless, which is a lower bound shared with every other process on the host (`verify.md`). The in-game probe is `attachPerfProbe(renderer)` from `@blacksite/ui/perf-overlay`: it reports fps, p50, p95, draw calls, triangles and active bodies once a second. The 120 fps claim belongs to a playtest on a 120 Hz display.
