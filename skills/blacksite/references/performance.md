# Performance

Frame, loading and bundle budgets for desktop and phone, what gives way first when a frame is over, how to bring a game back inside its budget, and the failures behind each rule. The budget is part of the look: a beautiful scene that hitches every 40 seconds reads as broken, and a player forgives a plainer frame long before a stutter.

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
| One non-JavaScript asset | 20 MB | | budget |
| Textures | KTX2 | | budget |
| Meshes | glTF with meshopt compression | | budget |
| Simulation | Fixed 60 Hz step | | budget |

Put the frame budgets in `src/game/model.ts` and pass them to the check contract as `model.budget`. Never raise a budget, a threshold or an assertion to make a gate pass; split code, cut cost or fix the bug.

## What gives way first

When a target misses its budget, cut in this order. Each step costs the look less than the next.

1. **Resolution.** Render pixel ratio first: 1 on desktop, at most 1.25 on phones.
2. **Effect resolution.** The look's quality tiers:

   | Tier | MSAA | AO | Bloom | Max pixel ratio |
   |---|---|---|---|---|
   | high | 4× | half-res, 8 samples | 8 levels | 2 |
   | medium | 2× | half-res, 4 samples | 5 levels | 1.5 |
   | low | off | off | off | 1.25 |

   Pick low for a coarse pointer or a screen under 600 px, medium for 4 or fewer cores, and high otherwise. Phones get no AO or bloom. Shadow maps: 2048 on desktop, 1024 on touch.
3. **Distance and density.** Draw distance, prop and foliage counts, particle counts. Fog hides the shorter distance.
4. **Update rates.** Far characters animate less often, shadows refresh every other frame, AI thinks at 30 Hz or less.
5. **Materials and lighting**, last. A flat-shaded world is what the player notices.

The scaffold writes mobile scales into `budget.config.json` (render 0.75, effects 0.5, distance 0.6, density 0.5, update rate 0.5), but nothing reads them yet. Apply them in the game's own quality setup.

## Warm everything before ready

A stall the first time something appears is the most visible hitch a game has: the first shot, the first chip, the first chime. Compile and allocate it behind the loading screen, and report ready only after it's done.

- **Compile the scene as it will be played.** Breach reveals every hidden object, keeps lights under revealed objects hidden so the light count matches play, runs `renderer.compileAsync(scene, camera)` (falling back to `compile`) for the scene and the arms overlay, renders one real frame through the post stack, restores, and reports ready a few frames later. Valley also calls `renderer.initTexture` on every material's textures and waits for the look's first ten frames, so the composer and sky lookup tables are built before ready.
- **Draw what play will draw.** The Firing Range's first shot compiled the dust sprite, the steel splash and the decal's instanced material mid-play. It now shows one dust sprite and one splash for two frames before ready, gives decal pools their instance colours when created, and draws the hidden pistol once with colour and depth writes masked; after that, zero hitches. Breach compiles its chip-scar material through a hidden primer mesh.
- **Never toggle a light.** Changing the number of lights recompiles every lit shader. Keep a constant count per tier: Breach assigns a fixed pool of local lights (3 high, 2 medium, 0 low) to the nearest sources with distance hysteresis, fading each through zero before it moves.
- **Build audio at load.** Building procedural audio during play caused a 250 ms startup hitch in Checkpoint; a checkpoint chime that built a convolver mid-run hitched Traverse on phones; the Firing Range's first weapon cue built one too. Call the mixer's `prepare()` while loading, which generates every zone's impulse responses; Breach warms all seven reverb paths there.
- **Admit expensive actors over several frames.** Every Breach soldier forced its first animation evaluation in the same frame after a restart, a 1.5 s hitch on phones. Soldiers now join only once their snapshot buffer can sample a frame, and a per-frame budget admits them.
- **Build the level once.** Breach's scene suspended on Rapier and the arms assets, so React threw away its memos and the level builder ran 4–5 times per load. Caching the level, chips and effects per quality tier outside React took phone first playable from 4,098 ms to about 3,700 ms.
- **Register the work.** `registerWarmup` (`templates/loading/warmup.ts`) lists named warmup tasks by stage, and `blacksite budget` checks that the game has it.

## Step on a fixed clock

- **Simulation runs at a fixed 1/60 s step** (`FIXED_STEP`, required by the budget check), clamped so a stalled tab doesn't fire a burst of catch-up steps. Breach steps its physics at 60 Hz on desktop and 30 Hz on phones.
- **Workers cap their catch-up.** Cascade's worker runs at most two physics steps a tick within an 8 ms wall budget, drops and counts the rest, caps elapsed time at 0.25 s, and the main thread interpolates its 30 Hz snapshots by `interpolationAlpha`. The squad worker ticks at 30 Hz and catches up at most three ticks before it resyncs.
- **Send patches, not worlds.** Sending only changed state from the destruction worker removed 10–15 ms of deserialisation a snapshot and took view time on snapshot frames from 4.66 to 2.89 ms.

## Draw calls

- **Merge by material.** The level builder merges geometry per material, so dressing costs one draw per material, not per prop. Breach goes further: pieces that differ only in tint merge into one draw with the colour in a vertex attribute.
- **Hide what's empty.** An effect pool with nothing alive (sparks, tracers) is hidden, so it skips its draw.
- **Budget the count.** Breach budgets 260 draws on desktop and 160 on phones; Traverse measures 140 and 106 at p95.
- **Let animated actors publish their own matrices.** Breach turns off automatic matrix updates on each soldier's body and turns them on only while a ragdoll drives the bones, so the renderer skips the subtree.
- **Schedule animation by credit.** Each actor earns credit at 1 ÷ its interval every frame and the highest credit evaluates first, two a frame on desktop and one on phones, at intervals of 2, 2 and 3 frames on desktop and 3, 4 and 6 on phones, banded at 10 and 20 m, and 60 frames when hidden.

## Per-tier quality

- **Pixels are GPU work.** Valley's phone tier renders at pixel ratio 2 rather than 1.25 (2.56× the pixels at a 3× screen) with CPU p95 flat, because resolution costs the GPU, not the main thread. At 1.25 without MSAA, leaf edges look blocky. Real GPU cost needs a device.
- **The low tier changes counts, not the scene:** fewer trees (28,000 of 64,000), single-frame impostors, no MSAA, shorter shadows, thinner cover, the same seeds.

## The renderer

Blacksite renders with WebGL2 through three's `WebGLRenderer`, with GLSL shaders (`ShaderMaterial` and `onBeforeCompile` patches) and a post stack built on `postprocessing` and N8AO. There is no WebGPU path, no TSL node materials and no fallback logic; `blacksite check` launches Chrome with WebGPU enabled, but no check exercises it. A WebGPU renderer with a WebGL2 fallback, TSL materials that survive three upgrades, and compute culling for ground cover are proposed, not built. Don't promise WebGPU features to the user.

## Bringing a game inside its budget

Without changing how it looks or feels:

1. **Measure both targets.** Run `blacksite budget`, then `blacksite check <url> --only perf,hitch` on desktop and phone. Record the p95, the longest frame, first playable, draw calls and triangles. Use `scripts.perf` in the check contract to run the busiest moment: the biggest fight, the largest explosion, the longest sightline.
2. **Find the bound thread.** Main-thread time over budget with an idle GPU means JavaScript: the tick, rebuilds, uploads, animation. A worker step over budget only matters if it delays the main thread or slows the simulation.
3. **List the largest costs** in order, each with its measured share.
4. **Fix one at a time**, A/B against the baseline at the same load, in the order above. Keep a change only if it moves the measured frame.
5. **Loading.** Compress assets (KTX2 textures, meshopt meshes), warm shaders and assets behind `registerWarmup`, and split code at game and prototype boundaries. First playable under 5 s.
6. **Rerun everything.** `pnpm check`, `blacksite budget` and the full `blacksite check`. The critic pictures must look the same as before.

Done when every budget passes, the game looks and plays as it did, and the report says what changed, what each change bought, and what only a real device can confirm.

## Rules, and the failures that taught them

- **Measure the thread that is actually bound.** Cascade's rest policy cut late active bodies from about 950 to under 700 and the worker step from 16.6 to 13.0 ms. Main-thread p95 stayed at 26–28 ms, because physics runs in a worker and the main thread was bound by rendering. Before calling anything a frame-rate win, check which thread sets the frame time.
- **The periodic heavy frame sets p95.** In Air Strike, 30 Hz snapshot frames were 11–18% of all frames and set p95. On each, the main thread rebuilt 3,600 bonds and 770 actors and uploaded transforms one call at a time. Sending deltas, coalescing uploads and skipping unchanged rebuilds took settle p95 from 15.6–20.4 ms to 8.3–9.7 ms, pixel for pixel identical. Optimise the spike, not the average.
- **Every sub-draw is a real draw call.** Fracture bevels were 400,000 of 460,000 triangles across 4,300 sub-draws. Merging them into one draw per chunk removed thousands of draws, and the 2.5 cm bevels stopped casting shadows that nobody could see. Coarser bevels cut triangles and didn't raise fps.
- **A/B each suspect at the same load.** Turning off shadow refresh and AO on Air Strike's heavy frames gained nothing measurable. Toggle each suspected cost against a baseline under the same load, and keep only changes that move the measured frame.
- **Animate far characters less often.** ALS pose evaluation cost about 1.4 ms per soldier and dominated a 5v5 Squad round. Poses now run at full rate within 12 m, then every 2nd, 3rd or 4th frame with distance, and every 8th off screen; the followed soldier is always full rate. Ragdolls settled for 1.2 s become static meshes. Frame time fell from about 21 ms to 6–10 ms.
- **The post stack costs real time.** Adding the look stack to Checkpoint took it from 199 fps (p95 6.6 ms) to 137 fps (p95 10.1 ms). Phones get the low tier. Secondary views render at reduced resolution; Arena's hidden bot canvas renders at a pixel ratio of 0.25 with no post.
- **Send definitions once.** Structured-cloning a full 3,000-piece world each snapshot cost the main thread 45–110 ms. Send each definition once, then ids and changes.
- **Make worker snapshots render-sized.** Warden's worker sent 557 KB a tick including decision traces and the map. Sending only what presentation draws cut that to a few KB.
- **Read loads from force events.** Walking every contact pair cost 33.7 ms at a collapse's peak; reading force events above 500 N cost 3.0 ms.
- **No allocation or I/O in the tick.** The fixed step is plain synchronous code that writes Koota traits. Promises, Effects and `new` in the hot loop show up as garbage-collection hitches.
- **Split code before raising a budget.** Load gameplay scenes, first-person arms and optional views on demand. When the ALS viewmodel brought the whole animation graph into the `fpp` and `mp` scaffolds, loading gameplay scenes on demand passed the existing gate unchanged.
- **Physics never runs slower than the wall clock.** When a step costs more than the time it simulates, the game plays in slow motion. Budget each step and drop fidelity (sleep, bake, defer, cap debris) before rate. Cascade drops fidelity in four rungs when cost passes 0.85 of the step, with 30 Hz as the floor.

## Measuring

`blacksite check` measures main-thread time headless, which is a lower bound shared with every other process on the host ([verify.md](verify.md)). The in-game probe is `attachPerfProbe(renderer)` from `@blacksite/ui/perf-overlay`: it reports fps, p50, p95, draw calls, triangles and active bodies once a second. The 120 fps claim belongs to a playtest on a 120 Hz display.
