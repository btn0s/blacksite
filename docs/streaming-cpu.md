# Courtyard bounded selection and CPU

Slice 2 is not accepted or merged into the preview. The production courtyard renders in Walk and Wide, but rendering/submission and main-thread p95 remain over their allowances. The installed three r186 bundle replay path fails on the courtyard's override-material passes. No renderer patch or alternate material path is included.

## Runtime change

Each view/shadow stream owns 1,048,576 selected slots, two 1,048,576-entry frontier buffers and 524,288 reached group-instance pairs. Reached records identify groups; cut evaluation expands their clusters. Candidate count no longer determines scratch allocation or scene creation limits. Both streams' traversal scratch and argument buffers occupy **75,500,176 bytes (72.002 MiB)**, excluding the existing 192,000,000-byte compacted index pools. There is no rejected-cluster buffer.

Every failed scratch, triangle or work attempt restarts from roots. Three bounded retries end at a certified coarse cut. Packing certifies complete-placement coarse slots, frontier, group pairs, triangles and traversal work, including terminal groups at earlier depths. Each root selection admits at most 4,194,304 instance/node/cluster operations, with the coarse attempt reserved first. View and two shadow selections plus four selected-slot visibility passes admit at most 16,777,216 operations per frame. Triangle pressure and traversal pressure retain separate GPU hysteresis.

One material submission owner queries an immutable spatial tree with conservative material bitsets. Queries visit at most 4,096 spatial nodes before adding complete remaining subtree bitsets. A fixed 64-entry stack suffices for the balanced tree. The current view/two-cascade material union activates newly covered buckets immediately. This courtyard's union still contains all 59 material batches, so the draw count remains 128.

The asset format and published owned manifests are unchanged. ALS and its assets are unchanged. Dependencies are linked from the preview checkout; no installation, tests, gates or `blacksite check` were run.

## Necessary cut/depth correction

The original recovery refit could change LOD after the prepass. Its retained depth could then describe fine geometry absent from the coarsened lit cut. Restarting roots alone does not repair that ownership problem.

The runtime now fits one complete frustum cut before drawing depth. Previous-depth and current-depth visibility both use that accepted cut. Recovery changes visibility and compacted ranges, never LOD. This also removes the second hierarchy traversal and the deferred-cluster buffer. The tradeoff is that invisible members of the frustum cut participate in triangle admission. In the production Walk snapshot the effective error is 6.535 px, with 7,087,785 requested triangles and 5,093,358 drawn triangles; Wide is 4.328 px, with 6,438,413 requested and 2,882,659 drawn. The view pool remains capped at 8,000,000 triangles. Three lifetime overflow retries were observed before the settled snapshots; both views subsequently report zero current overflows.

## Bundle limitation

The installed r186 WebGPU backend exposes `BundleGroup` and records `drawIndexedIndirect`. The courtyard attempt exposed two distinct lifecycle failures:

1. `Renderer.compileAsync()` projects bundle groups into `renderList.bundles`, but processes only its ordinary opaque and transparent lists. Compacted index buffers then initialize as storage/vertex buffers, and bundled draws fail validation because their GPU usage omits `INDEX`.
2. Compiling each owned bucket with the documented per-object API initializes the index buffers correctly, but replay still fails in `WebGPUTextureUtils.updateSampler()` with `Cannot read properties of null (reading 'isDepthTexture')`. The stack runs through `Renderer._renderBundle()`'s replay branch and `Bindings.updateForRender()`.

Replay updates cached render objects directly, bypassing `Renderer.renderObject()` and its per-source override-material lifecycle. The normal depth/shadow path uses that lifecycle to set and restore material properties. Ordinary material groups render the same courtyard successfully. The shipped slice therefore retains ordinary submission and does not claim bundle support. Fixing replay requires a compatible renderer lifecycle change, outside this design's no-renderer-patch contract.

The failed production build and source map remain in `D:/dev/probe/ruins-cpu-slice2b-build/`; the captured stack is `D:/dev/probe/ruins-cpu-slice2b-production.json`.

## Production measurements

Chrome 155.0.8059.85, headless, RTX 3070, 1920×1080, DPR 1, high tier. `vite build` and `vite preview` on 5253. No Chrome at launch or after close; an audit every approximately 500 ms confirms exactly one Chrome root process throughout both marked intervals. GPU free memory before launch was 7,487 MiB. Telemetry POSTs were fulfilled by the probe, so no telemetry files were written into the repository.

Main-thread busy time is the `RunTask` interval union between actual user-timing frame marks on the renderer thread. GPU draw-command counts confirm one rendered frame per mark. Thread CPU uses the same marks' thread-clock deltas. Both runs include tracing and CPU sampling overhead. GPU totals below sum the latest asynchronous render/compute timestamp snapshot; they are not GPU p95 estimates.

| Production measurement | Walk | Wide |
| --- | ---: | ---: |
| Marked duration / rendered frames | 10,974.681 ms / 643 | 10,237.672 ms / 615 |
| Main-thread busy p50 / p95, ms/frame | **9.765 / 18.084** | **8.180 / 10.659** |
| Thread CPU p50 / p95, ms/frame | 9.591 / 17.730 | 7.975 / 11.563 |
| Mean thread CPU, ms/frame | 10.829 | 8.356 |
| Rendering/submission profile weight, ms/frame | **6.702** | **5.548** |
| ALS/Subject profile weight, ms/frame | 1.398 | 0.951 |
| Physics profile weight, ms/frame | 0.365 | 0.288 |
| Browser/native unassigned profile weight, ms/frame | 2.467 | 1.670 |
| Draws/frame | 128 | 128 |
| GPU timestamp total, ms | **8.418** | **7.786** |
| View selection/visibility/compaction GPU, ms | 1.688 | 1.480 |
| Shadow selection/visibility/compaction GPU, ms | 2.390 | 2.375 |
| Scene lighting GPU, ms | 1.694 | 1.520 |
| Depth/normals/motion GPU, ms | 0.850 | 0.657 |
| Both shadow raster passes GPU, ms | 1.263 | 1.230 |

Profile weights classify exclusive leaf samples by ancestry and are approximate elapsed sample weights, not additive thread CPU clocks. Browser/native samples remain unassigned. Walk held W and moved 3.314 m to the same collision boundary as the original route. Wide remained stationary. The captures show complete ground, arches, stairs and the unchanged character, with no browser or GPU validation errors.

The 5 ms rendering allowance and 7.83 ms main-thread p95 allowance after reserving 0.5 ms for streaming are unmet. The preview branch is deliberately not updated.

Production evidence: `D:/dev/probe/ruins-cpu-slice2c-production{.json,-analysis.json,-walk.trace.json,-walk.cpuprofile,-wide.trace.json,-wide.cpuprofile}` and the corresponding before/after PNGs. Probe scripts and all generated build output remain outside Git under `D:/dev/probe/`.

## Dev comparison and pressure playthrough

The same code, route, viewport and capture procedure were repeated on the dev server with no other Chrome during the marked interval. Dev versus production Walk main-thread busy mean is **10.978 versus 10.970 ms/frame**; busy p95 is **18.149 versus 18.084 ms/frame**. Rendering/submission profile weight is 6.789 versus 6.702 ms/frame. This pair shows no material recovery of the CPU budget from production mode. Mean thread CPU is 10.403 versus 10.829 ms/frame; these single traced captures do not establish a reliable difference at that scale.

After the dev interval, the inspector requested finest resident detail with LOD disabled, then restored normal LOD. The GPU pressure floor retained a budgeted cut: 7,078,690 requested triangles during the request and 7,125,174 after restoration, both below 8,000,000. Ground, arches and the character remained present, with no browser/GPU errors. Lifetime overflow count stayed at three; this action did not force additional scratch saturation. The recorded cold-start retries and code-level coarse certification are the overflow evidence available here. Dev evidence is `D:/dev/probe/ruins-cpu-slice2c-dev{.json,-analysis.json,-walk.trace.json,-walk.cpuprofile,-pressure.png,-restored.png}`.
