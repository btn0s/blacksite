# Meshlet ruins (shelved experiment)

A record of a cluster ("meshlet") renderer, built in `packages/geometry`, that drew an exported scanned level inside a baked open-world landscape. It was shelved before it met its frame-time and load-time targets. The code is kept on two archive branches, not on `main`. The numbers below come from the documents and commit messages on those branches; where a figure is not in them, this note says so.

The open world itself (landscape, valley, sea, river) was upstreamed to `main` separately: `packages/landscape`, `packages/look` and `examples/valley`.

## Where it lives

| Branch | Content |
| --- | --- |
| `archive/meshlet-ruins` | 146 commits on top of `main` at `63afec4` (2026-10-18 to 2026-10-20). |
| `archive/ruins-water` | One more commit, `17395c9`: a river, a tarn with a cascading creek and a sea surface for the ruins landscape. |

```sh
git fetch origin archive/meshlet-ruins archive/ruins-water
git worktree add ../blacksite-archive origin/archive/ruins-water
```

Both branches fork from `63afec4`, not from the current `main`. The source level, its export and every baked build stayed outside the repository; none of that owned content is on the branches, so the example cannot run from a plain checkout.

Main paths on the branches:

| Path | Role |
| --- | --- |
| `packages/geometry/` | Offline cluster-hierarchy builder, version 5 page format, GPU selection, index compaction, page arena, texture feedback. |
| `examples/ruins/`, `examples/archway/` | The whole level and its first (courtyard) slice: loader, regional collision, landscape bake scripts. |
| `examples/meshlets/` | An earlier coastal showcase drawn entirely with clusters. |
| `examples/shared/` | Scan-material families and texture-tail streaming. |
| `packages/look/`, `packages/landscape/` | Look and terrain work, since upstreamed in reworked form. |
| `vendor/three-notes.md` | Renderer patches the experiment depended on (async compile, render bundles, binding refresh). |
| `docs/streaming*.md`, `docs/texture-residency.md`, `examples/ruins/REPORT.md` | Design, census and measurements. |

## What worked

- **Page streaming.** Version 5 pages (128 KiB, 16-byte base vertex, wire codecs) cut the whole-level bake from 9.99 GB to 7.93 GB decoded (-20.65%) and to 3.84 GB on the wire (-61.54%). One 1,280 MiB arena, a dependency-closed coarse cut that is always drawable, LRU eviction and GPU-tagged slot retirement held under a forced 64 MiB cap: 2,777 evictions, 47 reused slots, zero unsafe reuses, epoch mismatches, invalid mappings or missing pinned pages (`docs/streaming-paging.md`).
- **Texture streaming.** One resident mip tail per texture identity (256 to 2K, KTX2 slices, no re-encode), promotion and demotion driven by GPU density feedback, a shared byte ledger and retirement serials. Demotion later ran only under pool pressure (`a49305c`).
- **Whole level playable.** All 20,430 placements load through one arena and render with GPU selection, occlusion and four shadow cascades. A walk crossed a 32 m collision-region boundary and stayed grounded (`docs/streaming-full.md`).
- **Ground under the level.** The terrain is baked around the level footprint: `c3ff556` stamps the level in with a rim-anchored falloff, `83dc6a9` buries the level foot instead of carving around it, `f58cb2a` rebuilds the ground from the level's ground sheets rather than its buried rock bottoms (the bake reached build 08). `36f494b` loads and compiles the terrain with the level, and `17395c9` adds river, tarn, creek and sea.

## What did not work, and why

1. **The global index budget distorted LOD.** In `packages/geometry/src/runtime-indices.ts` one scene-wide threshold is `max(requested pixel error, floor, work floor)`. Every over-budget attempt multiplies it by at least 1.25 (`1.1 * sqrt(triangles / budget)`), and it relaxes by 1% per frame only while the previous cut used under 80% of the budget. The ruins asked for 2 px (`examples/ruins/src/asset.ts`); the last recorded snapshots show 6.541 px in Walk and 4.332 px in Wide. A figure of 24 px effective error was reported by the owner and is not in any document or commit message, so it is unverified here. Derived arithmetic, not a measurement: at 1% per frame, relaxing a 12x inflation takes about 250 frames. One heavy view therefore raises detail for the whole scene, then drifts back slowly. The visible "swimming" of LOD is inferred from that code and was not recorded in the sources.
2. **Triangles were counted before occlusion.** The budget fits the frustum cut before the depth pass, so hidden clusters spend budget (`sceneTriangles` is documented as counted "before leaf frustum and occlusion rejection"). Final snapshots: Walk requested 7,107,663 and drew 5,106,319; Wide requested 6,431,522 and drew 2,878,577. (The pairing 7.1 M requested / 2.9 M drawn mixes the two views.) An earlier courtyard readout (`860617d`) showed 18.4 M selected against 12.7 M drawn.
3. **Pools ran at their limits.** The shared GPU ledger peaked at 2,522,598,808 of 2,684,354,560 B (94.0%). Resident textures reached 805,005,360 B against a 768 MiB (805,306,368 B) texture ceiling, about 99.96% (derived). CPU staging peaked at 67,070,689 of 67,108,864 B, and the collision reservation at 134,217,552 of 134,217,728 B. This was on an 8 GB card with about 7.5 GiB free at launch, and the ledger excludes render targets and driver memory. The geometry arena was not the full one: 274 to 606 MB of 1.34 GB occupied in the final runs. Collision accounting also overcharged chunks (256 B per triangle against 81 to 90 measured), which left 641 chunks queued (`0ebbe5e`).
4. **Collision used guard walls, not a resident proxy.** Cuboid colliders close the edge of the loaded collision neighbourhood and hold movement until neighbours arrive (`examples/ruins/src/collision.tsx`; the contact tracer labels them "residency guard"). Removing colliders as chunks left range made the physics world panic and froze the game after a teleport (`77a414f`), so handles are pooled and never destroyed. Peak insertion was 3.9 ms and peak scheduling 11.7 ms, above the intended small streaming allowance.
5. **Start-up and CPU targets were never met.** First playable was 51.576 s, of which 39.093 s was render warm-up, against a 5 s target. Background pipeline compilation was removed after it failed on shared pass state; the fix needs patched renderer code (`vendor/three-notes.md`). Main-thread p95 on the whole level was 12.8 to 16.6 ms against 8.33 ms. A ground-to-level material blend pushed materials over 16 samplers and most of the level stopped drawing, so it was unhooked (`8abedfa`).
6. **The "stuck level" render bug is unresolved.** No document on the branches describes the symptom or a cause. The glitch hunt is visible in the history: telemetry and temporal toggles (`3d00d53`), per-frame noise and stage toggles (`c07a7f5`), a repro recording script (`a81cbd1`), rendering while paused (`33d028f`). It did find and fix real faults (motion vectors written from the origin, `2ec0044`; an odd drawing buffer breaking half-resolution AO, `37a4753`), but none is recorded as closing the stuck-level report.

## Measured numbers

| Quantity | Value | Source |
| --- | --- | --- |
| Source level | 20,430 placements, 371 geometries, 228,267,444 source triangles | `docs/streaming.md` |
| Finest 5 mm cut | 165,804,598 triangles, 3,666,653 clusters | `docs/streaming.md` |
| Whole-level page bake | 67,461 pages, 7,930,327,040 B decoded, 6,110,016,500 B unique, 3,844,055,478 B wire | `docs/streaming.md` |
| Directories | 42,625,684 B wire; pinned coarse closure 450 pages, 56.25 MiB | `docs/streaming.md` |
| Collision bake | 52,250 chunks, 20,705,044 triangles, 495,576,148 B | `docs/streaming-full.md` |
| First attempt, resident | 3.6 GB of buffers needed for 260 of 371 geometries; adapter binding limit 2,147,483,644 B, device request failed | `examples/ruins/REPORT.md` |
| GPU budget design | 2,560 MiB: arena 1,280, textures 768, indices and HiZ 192, directory 256, staging 64 | `docs/streaming.md` |
| Page decode worker | 699.7 MB/s decoded output, p50/p95 0.20/0.30 ms per page | `docs/streaming.md` |
| Courtyard (83 geometries), resident, Walk | main-thread p50/p95 7.750/10.460 ms; GPU sum 6.979 ms; 113 draws | `docs/streaming-cpu.md` |
| Courtyard, paged, Walk / Wide | 8.423/10.842 ms and 7.088/8.281 ms; GPU 7.169 and 6.317 ms | `docs/streaming-paging.md` |
| Courtyard geometry occupied | about 424 MB of the 1.34 GB arena | `docs/streaming-paging.md` |
| Whole level, Walk / Wide | main-thread 13.047/16.619 and 13.106/14.888 ms; GPU 9.384 and 10.145 ms | `docs/streaming-full.md` |
| Whole level, shared-graph families, bench | CPU 8.5/12.8 (Walk), 6.8/9.2 (Wide); GPU p50 9.677 and 10.081 ms | `docs/streaming-full.md` |
| Resident textures, whole level | 624 to 805 MB | `docs/streaming-full.md` |
| First playable | 51.576 s (original); 18.240 s (diagnostic, unaccepted); about 38 to 39.5 s (final bench) | `docs/streaming-full.md` |
| Effective vs requested error | 6.541 px (Walk), 4.332 px (Wide), 2 px asked | `docs/streaming-cpu.md`, `asset.ts` |
| Requested vs drawn triangles | 7,107,663 vs 5,106,319 (Walk); 6,431,522 vs 2,878,577 (Wide) | `docs/streaming-cpu.md` |
| Terrain | 4 km near field at 2 m, 16 km far field at 8 m | `examples/ruins/README.md` |

Conditions: 1920x1080, device pixel ratio 1, headless Chromium 155, an 8 GB desktop GPU, one browser instance, production build. The targets were 8.33 ms per frame and 5 s to first playable. No figure was measured on a phone or on a second machine, and no untraced multi-minute session was recorded.

## What the standard fix would be

These are recommendations from the failure analysis above. None was built.

- **Per-cluster screen-space error cut.** Select each cluster by its own projected error against the requested pixel error, so a heavy view cannot raise the threshold for the rest of the scene. Resolve an over-budget frame by trimming the lowest-importance clusters, not by moving a global threshold with a slow decay.
- **Occlusion-aware counting.** Cull against the previous frame's depth pyramid during traversal, at node level, so occluded subtrees never enter the budget; count only what survives.
- **A streaming budget below device memory.** Size the arena and texture pool to a fraction of the adapter's free memory, evict toward a watermark before the pool is full, and treat 94% of a ledger as a fault, not a steady state.
- **A resident low-resolution collision proxy.** Keep a coarse whole-level collision mesh (or heightfield plus coarse hulls) always loaded and refine near the player, so no guard walls are needed and teleports never wait.
- **Staged start-up.** Precompiled or cached pipelines and a first playable limited to the spawn region, rather than compiling every material under every pass state before readiness.
- **A reproducible frame capture for the stuck-level bug** before more renderer work: per-frame pass order, camera and history state were being collected when the work stopped.
