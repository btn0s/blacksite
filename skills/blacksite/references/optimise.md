# Optimise

Bring a playable game inside its budget without changing how it looks or feels.

1. **Measure both targets.** Run `blacksite budget`, then `blacksite check <url> --only perf,hitch` on desktop and phone. Record the p95, the longest frame, first playable, draw calls and triangles. Use `scripts.perf` in the check contract to run the busiest moment: the biggest fight, the largest explosion, the longest sightline.
2. **Find the bound thread.** Main-thread time over budget with an idle GPU means JavaScript: the tick, rebuilds, uploads, animation. A worker step over budget only matters if it delays the main thread or slows the simulation.
3. **List the largest costs** in order, each with its measured share.
4. **Fix one at a time**, A/B against the baseline at the same load. Keep a change only if it moves the measured frame. Use the order in `performance.md`: resolution, effect resolution, distance and density, update rates, and only then materials and lighting.
5. **Loading.** Compress assets (KTX2 textures, meshopt meshes), warm shaders and assets behind `registerWarmup`, and split code at game and prototype boundaries. First playable under 5 s.
6. **Rerun everything.** `pnpm check`, `blacksite budget` and the full `blacksite check`. The critic pictures must look the same as before.

## Done when

Every budget passes, the game looks and plays as it did, and your report says what changed, what each change bought, and what only a real device can confirm.
