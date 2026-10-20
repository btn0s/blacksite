# Whole-level paging work and bootstrap boundary

20 October 2026. Slice 4 is merged into the preview as `8df5b08`, and the published paged courtyard loaded in fresh Wide and Walk runs on 5247. Slice 5 remains **unmerged and unpublished**. The whole level renders and walks in the production probe, but staged bootstrap and the CPU/GPU comparison are unmet. The owned root has no `full.json` publication.

## Working implementation

All 20,430 version 5 placement records enter one shared page arena. The 371 geometry directories retain their coarse dependency closure; 450 pinned pages reserve 58,982,400 bytes of physical slots. Full-level material loading uses `build-materials-whole-20261020-01/surfaces.json`: 285 rendered surfaces, 16 explicit FX exclusions and no untranslated surfaces. Its 26 translated descriptors exactly match `build-materials-translated-20261020-01`. Every referenced mip-tail file was checked for existence and declared wire size. The playable assembler reuses that output without encoding or copying images.

The unpublished playable manifest is `D:/dev/owned-assets/dark-ruins/build-full-playable-20261020-03/full.json`. It references the existing immutable version 5 geometry build and complete material output. Its new collision bake contains 52,250 chunks, 20,705,044 triangles and 495,576,148 serialized bytes. Collision covers 19,382 visible placements with rendered surfaces; excluded fog, water, decal and other FX surfaces contribute no solid geometry. All rendering placement records remain present.

Collision uses 32 m index regions and 8 m chunks, with a 4,096-triangle cap. A conservative 0.375 m world-space hierarchy cut and 0.375 m additional simplification share the 0.75 m allowance. Triangles have unique chunk ownership and actual bounds index crossed region seams. Four workers fetch, verify and transfer bounded payloads. A movement tile is protected, nearby chunks prefetch, and distant chunks retain until pressure. Admission cannot replace a nearer wanted chunk with a farther one. Standalone static colliders replace a single large fixed body whose changing collider set caused expensive physics work. ALS is unchanged.

Depth/lit and the active shadow cascade use independent conservative material bitsets. True transformed geometry boxes replace sphere-derived coverage boxes. Each pass exposes only its owned draw group, avoiding empty BundleGroups in other passes. Fixed indirect draws remain recorded and replayed through three's public BundleGroup API. The material prefix uses a GPU loop instead of expanding hundreds of material ranges into the shader. Independent compute compilation runs in parallel.

The previous ruins preload-all/per-placement collision loader, resident whole-level asset loader, WebP material preparation command and separate ruins bookmark definitions are removed. The intended `?level=full` entry reuses the courtyard bookmarks and camera limits for comparison.

## Final isolated production measurement

Evidence: `D:/dev/probe/ruins-cpu-full11-production.json`, its `-analysis.json`, per-view traces/CPU profiles, material screenshots and `-residency.json`. Vite production build `ruins-full-full-build-11`, preview 5253, Chrome 155, 1920 by 1080, DPR 1, high quality. No Chrome before or after; exactly one Chrome root throughout both marked intervals. No asset bake ran during this run. GPU free memory before launch was 7,521 MiB. Each view has 560 complete frame intervals. Main-thread values are the union of main-thread task time between frame marks, rather than the display interval.

| View | Main-thread p50 / p95 | GPU total median | Actual draws/frame | Occupied geometry slots | Resident textures |
| --- | ---: | ---: | ---: | ---: | ---: |
| Walk | 13.047 / 16.619 ms | 9.384 ms | 167.62 | 274,202,624 B | 624,126,000 B |
| Wide | 13.106 / 14.888 ms | 10.145 ms | 212.02 | 478,543,872 B | 805,005,360 B |

GPU medians sum six post-trace timestamp snapshots. Walk near/far-cascade medians were 8.963/9.384 ms; Wide 9.381/10.145 ms. The fixed physical geometry arena is 1,342,177,280 bytes regardless of populated slots. The shared GPU ledger peaked at 2,522,598,808 bytes, below 2,684,354,560 bytes; this includes owned geometry auxiliaries, textures, overlap and upload staging. Render targets, driver allocations and unchanged ALS/native resources remain outside that ledger.

Walk moved 14.064 m, crossing the 32 m region boundary at world Z=0, with the player grounded afterward. This route travels farther than the earlier courtyard trace, which stopped after 3.314 m; the final cameras are the same bookmarks. Mean exclusive sampled costs in Walk were rendering/submission 8.563, ALS/Subject 1.585, physics 1.176 and browser/native without a JS owner 1.942 ms/frame. Wide rendering/submission was 9.612 ms/frame. GC was about 0.086/0.067 ms/frame. Neither marked interval created a shader or pipeline.

The collision reservation peaked at 134,217,552 bytes under its 134,217,728-byte cap. This is a conservative native/staging charge, not an exact acceleration-structure allocation measurement. Instrumented Rapier WASM memory capacity grew from 1,179,648 to 69,664,768 bytes, including allocator high-water space, physics state and temporary native work. Peak individual insertion/update work was 3.9 ms; peak metadata scheduling was 11.7 ms. Those maxima remain above the intended small per-frame streaming allowance.

First playable was **51.576 seconds**, including directories 1.168 s, minimum tails/material creation 2.228 s, geometry setup 4.334 s and render warmup 39.093 s. Character readiness took another 0.225 s after local collision became ready. First playable is the loading overlay's removal after compilation and a fresh GPU completion fence, not the first hidden canvas draw. This misses the five-second target and the accepted courtyard CPU/GPU comparison.

## Material review and residency observations

Ten unambiguously identified placed surfaces were captured: all seven GenericProps materials, burnished steel and both emissive surfaces. Gold and steel retain texture/reflection variation; the solid-black sphere result was not reproduced on those meshes. The emissive surfaces did reproduce solid white in the normal look. Their authored intensities are 1,000 and 3,500; emission bypassed the camera pre-exposure already applied to sunlight and sky. The look now provides the same radiance scale through the lit-pass TSL context, and the translated emission applies it. Both actual placed emissive captures retain their exposure-scaled value instead of clipping to white. Owned material parameters and textures are unchanged.

A destination-collision probe intercepted 132 region fetches and gated IO for two seconds. The player stayed at the original position while IO was held, then activated at `[55.3, 26.3, -13.5]` only after collision readiness; the player settled grounded at Y=26.28. This verifies destination gating. It does not establish every possible walking-boundary contact.

A 128 MiB logical working-set pressure exercise cycled Wide/Walk/Close. It evicted 4,133 pages and retained complete-looking coarse geometry in the captured view. Missing pinned pages, invalid mappings, epoch mismatches and unsafe slot reuse counters stayed zero. The sample ended while shrinking: occupied slots had fallen from 887,226,368 to 347,471,872 bytes and had not yet reached the 134,217,728-byte logical limit. No physical slot was reused in this short exercise. This is **not a completed shrink-to-cap/retirement proof**; the earlier courtyard pressure evidence remains in `streaming-paging.md`.

## Blocking design boundary

The attempted staged path compiled one material at a time against captured actual depth, lit and cascade states while normal rendering continued. It failed in the final production probe with:

`Async render pipeline creation failed ... cluster depth ... Color target has no corresponding fragment stage output ... targets[1]`.

Evidence is `D:/dev/probe/ruins-cpu-full10-production.json`. r186's `PassNode.compileAsync` explicitly keeps the renderer's target and MRT active across the awaited compilation. Renderer/node compilation can continue reading mutable pass state after yielding; the public API provides no immutable compilation-state snapshot. Starting other pass builds or normal rendering during that interval can mismatch shader outputs and framebuffer targets. A second renderer or a renderer patch was not introduced.

The unsafe background path is deleted. The remaining working build compiles every cluster material under all actual states before readiness. It therefore does not implement staged first-playable loading. Bundles themselves support these indirect draws, but r186's NodeMaterialObserver requests full updates for node materials, so replay still incurs material/object uniform and binding work; it does not eliminate submission cost at this scale.

The next design step must reduce the work itself: shared material-family graphs and data-driven immutable material parameters, with shared frame uniforms and parallel independent bootstrap resource loading. Serializing a long background compile while freezing rendering would merely move the startup stall into play and would not satisfy the requested design. No full-level loader or manifest publication should be called complete on this evidence.


