# Courtyard geometry paging

20 October 2026. Implemented on `btn0s/ruins-cpu`, rebased onto preview `3f8b243`. **Not merged or published: the production Walk CPU comparison does not meet the no-regression acceptance condition.** The shared published courtyard manifest and the preview checkout remain unchanged.

## Runtime

One 1,342,177,280-byte storage arena contains 10,240 physical 128 KiB slots. Immutable version 5 directories describe virtual groups, page ranges and both directions of the coarse dependency DAG. The courtyard runtime has 80 pinned pages after excluding three inactive geometries. Creation awaits this complete coarse closure. Selection requests missing finer pages with projected-error importance and draws the resident coarse cut. Whole-asset payload loading/assembly and geometry-sized vertex, reference, index and cluster pools are deleted. Fixed traversal/index-compaction scratch remains.

Four workers perform exact range fetch, SHA256 verification, decode and transfer. Page jobs reserve their complete wire/decode allowance against the same 64 MiB CPU staging ledger as textures. Three reusable 2 MiB GPU/CPU upload stages are completion-tagged. A frame shares an 8 MiB upload allowance and 0.5 ms cooperative scheduling deadline between textures and geometry; ready texture publication runs first, then feedback consumption and page admission split the remaining CPU quota. Ordered copy, texture-density and page-table publication compute passes publish one epoch before view/depth/lit/shadow selection. Geometry addresses change inside the arena without changing bundle bindings.

LRU eviction considers only unpinned pages without resident dependants. Admission requires every coarser dependency resident. Evicting a parent cancels in-flight dependants and releases decoded speculative dependants, so a full decoded queue cannot prevent its own parents being fetched again. Unpublished slots remain charged and owned until a feedback snapshot tagged on the GPU proves completion after all preceding draws. Generation, ownership and completion assertions reject premature reuse. Three reusable feedback readbacks sample at most every four frames; busy slots skip samples. Consumption is incremental and selection never waits for readback.

`MeshletScene.update` runs before the first pass; `endFrame` runs after all passes. `completeFrame` awaits a fresh rendered-frame snapshot for load readiness. `pagingStats` exposes bytes, serials, epochs, queue overflow, fallback and safety counters. `setGeometryLimit` lowers the occupied working-set cap while preserving the physical allocation. Renderers request twelve storage bindings per shader stage and sufficient buffer limits. Vite workers use ES modules.

The shared rendering API now takes version 5 page sources only. Other source callers use that API and frame lifecycle; their existing owned version 3 demo builds require rebaking and were not playtested here. Version 3 CPU parsing remains for collision/terrain consumers. ALS is untouched.

## Owned build, awaiting publication

The sealed build is `D:/dev/owned-assets/dark-ruins/build-courtyard-pages-9PEDo9`. Its assembler links the verified version 5 geometry pages into a new directory, verifies source hashes and triangle counts, and preserves placement, material, environment and collider ownership. It never rewrites the published manifest.

| Census | Value |
| --- | ---: |
| Placements / directory geometries | 679 / 83 |
| Virtual pages / build pinned pages | 23,345 / 83 |
| Encoded page bytes | 1,301,611,957 |
| All decoded page images | 2,744,626,160 |
| Directory wire bytes | 11,920,400 |

Production probes intercepted only the courtyard manifest URL to read that sealed build. The runtime has one canonical manifest URL and no staging switch. Publication must follow the loader merge: back up the old owned manifest, merge this branch into preview, then atomically replace `D:/dev/owned-assets/dark-ruins/courtyard.json` with the sealed manifest and verify fresh Wide/Walk on 5247. None of those publication steps has happened.

## Production evidence

Final run: `D:/dev/probe/ruins-cpu-paging09-production.json`, `.map`, `-analysis.json`, and per-view `.trace.json`/`.cpuprofile`. Vite production build `ruins-paging-build-09`, preview 5253, Chrome 155, 1920×1080 at DPR 1. Browser cache disabled, no other Chrome root throughout either trace or pressure exercise, 7,528 MiB GPU memory free before launch. Walk moved 3.314 m. Each view contains 562 complete measured frame intervals, after ten seconds of warmup. No shader or pipeline creation occurred after readiness.

Main-thread time is the union of main-thread task time between consecutive frame marks, using the same analyzer as the accepted resident baseline. It is distinct from the 16.7 ms display interval. GPU totals sum named timestamp durations; near/far figures are medians of six snapshots after each CPU trace, separated by the active cascade.

| View | Main-thread p50 / p95 | Resident baseline p50 / p95 | GPU near / far | Actual draws/frame |
| --- | ---: | ---: | ---: | ---: |
| Walk | 8.423 / 10.842 ms | 7.750 / 10.460 ms | 7.169 / 6.365 ms | 113 |
| Wide | 7.088 / 8.281 ms | 7.078 / 8.244 ms | 6.317 / 5.812 ms | 113 |

Walk mean/max main-thread time was 8.673/15.837 ms; Wide 6.977/11.017 ms. Walk loaded 1,898→3,237 pages during the measured view and texture promotions increased 66→130. Wide retained 3,242 pages with 141 promotions. This is not the earlier invalid starvation result that rendered pinned detail throughout Walk.

Walk ended with **424,280,064 bytes** of occupied geometry slots; Wide with **424,935,424 bytes** (405.25 MiB). Both fit the 1,280 MiB physical arena. Pinned roots reserve 10 MiB. These figures exclude immutable directories, scratch, texture-density control data, upload stages, textures and render targets. The shared ledger separately charges those owned buffers; the geometry/control charge is 1,685,875,380 bytes plus 6,291,456 staging bytes.

First canvas submission occurred at 4.834 s, behind the loading screen; it does not prove complete geometry. **First ready, fully warmed rendered frame with a fresh GPU completion fence was 37.871 s.** The five-second first-playable design target is not met.

Sampled Walk costs were 5.373 ms/frame rendering/submission, 2.162 browser/native unassigned, 1.193 ALS/Subject, 0.293 physics and 0.023 GC. A narrower source attribution puts 0.192 ms in page scheduling/upload submission and 0.113 ms in feedback, with the existing look at 4.978 ms. These are profiler estimates, not additive clocks. The resident baseline's browser/native bucket was 1.703 ms/frame and rendering/submission 4.961 ms/frame. The additional native samples cannot be assigned to a specific callback or browser operation from this trace. There is no evidence supporting a claim that the regression is merely noise, and the 5 ms rendering/submission target is also missed.

The implementation therefore remains on its branch. Pressure correctness and bounded paging do not substitute for the requested CPU acceptance or a verified merged preview.

## Pressure and delayed completion

The same isolated production run lowered the occupied geometry limit from 1,280 to 64 MiB, delayed page IO by 1.5 seconds and public readback completion promises by 250 ms, and performed 24 Wide/Close/Walk changes with fast Walk turns. The physical allocation remained 1,280 MiB; occupancy was forced down to 64 MiB. The probe used the public limit method through a debugger-captured owner, without adding application test controls or a second render path.

| Result | Value |
| --- | ---: |
| Final resident / pinned / retiring pages | 512 / 80 / 0 |
| Final occupied slot bytes | 67,108,864 |
| Evictions / actual reused slots | 2,777 / 47 |
| Cancelled speculative/stale requests | 30 |
| Peak simultaneously retiring slots | 45 |
| Maximum completion lag | 26 frames |
| Delayed range requests | 81 |
| Unsafe reuses / epoch mismatches / invalid mappings / missing pinned pages | 0 / 0 / 0 / 0 |
| Dependency / ownership / free-slot / slot-conservation audit failures | 0 / 0 / 0 / 0 |
| Geometry upload peak including commands | 1,433,776 B/frame |
| Texture upload peak | 5,592,432 B/frame |
| Sum of separate upload peaks, an upper bound | 7,026,208 B/frame, below 8 MiB |
| Shared CPU staging peak / cap | 67,070,689 / 67,108,864 B |
| Peak scheduling / page GPU API submission | 0.600 / 2.500 ms |
| Camera-change frame interval maximum / frames over 33 ms | 16.9 ms / 0 |

The 0.5 ms scheduling quota is cooperative: a bounded unit and timer granularity can overshoot it; it is not a hard real-time guarantee. GPU API submission is reported separately. Complete coarse geometry remained visible in the captured pressure views, including the final highly simplified cut. Normal Wide/Walk and pressure screenshots are under the same probe prefix. All explicit safety audits passed. Request queue overflow was bounded and retried, reaching 1,900 overflowed requests across the entire run; no selection uses a truncated geometry cut.
