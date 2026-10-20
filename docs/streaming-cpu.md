# Courtyard bounded selection and CPU

Slice 2 is integrated with the texture residency and geometry bake slices. Walk and Wide render correctly. Cluster depth, lit and shadow draws replay render bundles; the look survives camera changes. After the bounded follow-up below, production Walk main-thread p50/p95 is 7.750/10.460 ms and rendering/submission profile weight is 4.961 ms/frame. The 8.33 ms p95 target remains unmet.

## Bounded selection

Each view/shadow stream owns 1,048,576 selected slots, two 1,048,576-entry frontier buffers and 524,288 reached group-instance pairs. Reached records identify groups; cut evaluation expands their clusters. Candidate count no longer determines scratch allocation or scene creation limits. Both streams' traversal scratch and argument buffers occupy **75,500,176 bytes (72.002 MiB)**, excluding the existing 192,000,000-byte compacted index pools. There is no rejected-cluster buffer.

Every failed scratch, triangle or work attempt restarts from roots. Three bounded retries end at a certified coarse cut. Packing certifies complete-placement coarse slots, frontier, group pairs, triangles and traversal work, including terminal groups at earlier depths. Each root selection admits at most 4,194,304 instance/node/cluster operations, with the coarse attempt reserved first. Triangle pressure and traversal pressure retain separate GPU hysteresis. Invalid cuts produce no draw arguments.

The complete frustum cut fits before depth. Previous-depth and current-depth visibility share that accepted cut; recovery cannot change LOD after depth has been drawn. Invisible cut members participate in admission. In the final Walk snapshot, effective error is 6.541 px, requested triangles 7,107,663 and drawn triangles 5,106,319. Wide is 4.332 px, requested 6,431,522 and drawn 2,878,577. Both snapshots have zero current view and shadow overflows. View lifetime restarts are three; shadow lifetime restarts are 35/36, across the alternating cascade selections.

## Submission and pass ownership

One material submission owner queries an immutable spatial tree with conservative material bitsets. Queries visit at most 4,096 spatial nodes before adding complete remaining subtree bitsets. A fixed 64-entry stack suffices for the balanced tree. The view/two-cascade union activates newly covered buckets immediately. Unsigned bitset comparison avoids treating bit 31 as a material-set change every frame.

Each lit, depth and shadow draw bucket owns a BundleGroup under its pass group. Opaque depth/shadow objects own their cull-state material; alpha-tested objects own their coverage material. Cluster materials disable override. Depth materials write the actual normals/motion MRT outputs. Shadow materials own their side and alpha coverage. Texture publication increments versions only for materials using that image, invalidating their bundles. Viewport changes invalidate every bucket. Material coverage toggles bucket visibility without changing recorded contents. Shader uniforms and indirect counts continue updating on replay.

The remaining r186 failure was nested rendering during bundle recording. A debugger capture found GTAO's fullscreen AO object inside the cluster lit bundle, with a null cached PassMultipleTextureNode sampler. The recorder also covers nested node updates. The look now declares depth, sun shadows and AO as dependencies before lighting, so those passes complete before a lit bundle starts. No renderer source is patched.

The sun initializes both atlas tiles and then updates near and far on alternating frames. Only the active cascade traverses, compacts and rasterizes; the other tile retains its projection and map. A viewport depth-clear draw clears the active tile because WebGPU attachment clears cover the entire atlas. The two cascades share traversal/index scratch.

## Camera and readiness

The look owns one stable render camera. Selecting a source camera copies its current camera state into that object; the graph, native passes, materials and bundle identities persist. A camera cut refreshes both cascade tiles and temporal history without rebuilding shaders.

The empty-scene geometry compile is deleted. Index pools are explicitly initialized with the public backend index-attribute operation before storage uploads. The real graph renders behind the loading screen, including sky, environment, post and character. The look captures its actual depth/MRT, lighting/context and both shadow states. Awaited per-object compilation visits every cluster bucket in each relevant state, including invisible buckets. Readiness follows the completed real render and asynchronous GPU readback. This does not claim the separate five-second startup target.

Nine repeated Close/Walk/Wide switches produced **861 frame intervals, p95 16.8 ms, maximum 16.8 ms, zero over 33 ms**. Instrumented GPU calls recorded **zero pipeline creations and zero shader-module creations after readiness**, covering both measured views and all nine switches.

## Spike cause

The original Walk trace's bad frames contained large texture fetch-body callbacks, rather than a matching ALS or selection increase. Individual legacy texture responses were 19-20 MB; one frame also contained a 55.8 ms major GC. The merged mip-tail loader reduced requests to at most about 5.5 MB, but the cached-replay capture still contained a **45.25 ms fetch data-pipe callback** on the renderer thread.

One texture reader worker now performs the response body read and size validation, then transfers the buffer to the existing decoder. The main thread no longer assembles those response bodies. Staging admission, cancellation and upload/retirement stay with the residency owner. The old main-thread body-read path is deleted. No ALS code or assets changed.

## Production measurements

Chrome 155.0.8059.85, headless, RTX 3070, 1920x1080, DPR 1, high tier. Vite build plus Vite preview on 5253. GPU free memory before launch was 7,496 MiB. No Chrome existed before launch or after close. Every approximately 500 ms audit during the marked intervals and every camera-switch audit found exactly one Chrome root process. Browser/GPU errors: zero. Screenshots retain the ground, arches, stairs, materials and character.

Main-thread busy time is the RunTask interval union between user-timing frame marks on the renderer thread. Thread CPU uses those marks' thread-clock deltas. Sampling/tracing overhead is included. Profile weights classify exclusive leaf samples by ancestry and are approximate elapsed sample weights, rather than additive thread CPU clocks.

| Measurement | Walk | Wide |
| --- | ---: | ---: |
| Rendered frames / duration | 607 / 10,109.155 ms | 590 / 9,814.689 ms |
| Main-thread busy p50 / p95 | **8.110 / 10.595 ms** | **7.078 / 8.244 ms** |
| Main-thread busy maximum | 13.114 ms | 10.594 ms |
| Thread CPU p50 / p95 | 7.848 / 10.900 ms | 6.918 / 8.780 ms |
| Rendering/submission profile weight | **5.119 ms/frame** | **4.508 ms/frame** |
| Browser/native unassigned | 1.758 ms/frame | 1.636 ms/frame |
| ALS/Subject | 1.271 ms/frame | 0.881 ms/frame |
| Physics | 0.340 ms/frame | 0.247 ms/frame |
| GC | 0.023 ms/frame | 0.024 ms/frame |
| Actual GPU draw commands/frame | **113** | **113** |
| GPU timestamp sum | **7.110 ms** | **5.842 ms** |
| View selection/recovery/compaction GPU | 1.668 ms | 1.486 ms |
| Active shadow selection/compaction GPU | 1.380 ms | 1.101 ms |
| Scene lighting GPU | 1.658 ms | 1.518 ms |
| Depth/normals/motion GPU | 0.850 ms | 0.649 ms |

GPU totals sum the latest asynchronous timestamp snapshot, rather than a GPU p95 or frame wall-clock measurement. Walk's snapshot updates the near cascade; Wide's updates the far cascade. Other costs include the active shadow raster, 0.100 ms tile clear, AO, TRAA, HiZ and output. Actual draw counts include bundle contents, measured at GPU command encoding/replay. r186 renderer.info omits replayed bundled draws, so its HUD count is lower. Walk held W and moved 3.314 m to the same collision boundary as the earlier captures.

Walk p95 misses 8.33 ms by 2.265 ms, and rendering/submission misses 5 ms by 0.119 ms in this capture. The earlier 18 ms tail and 8.4 ms GPU total improved; the CPU target is not claimed as achieved.

Evidence is under D:/dev/probe/ruins-cpu-slice2i-production: JSON, analysis JSON, source map, Walk/Wide traces and CPU profiles, and before/after PNGs. The JSON includes camera-switch intervals, isolation audits and post-readiness pipeline/shader counts. The earlier debugger evidence is D:/dev/probe/ruins-cpu-bundle-debug.json; fetch spike evidence is D:/dev/probe/ruins-cpu-slice2g-spike-events.json.

## Dev comparison

The earlier paired capture of the same pre-bundle code measured dev versus production Walk busy mean **10.978 versus 10.970 ms/frame**, and busy p95 **18.149 versus 18.084 ms/frame**. It showed no material CPU recovery from production mode alone. The final numbers above use production; the original 15.4 ms dev figure is not used as the final baseline.

The geometry asset format and owned manifests are unchanged by this slice. The combined run reads the texture slice's already-published mip-tail build. No owned content, generated builds or probe files are committed. Dependencies are linked; no installs, tests, gates or blacksite check were run.

## One bounded Walk follow-up

The existing slice2i Walk trace contains 256/606 frames above 8.33 ms. Comparing those frames with the middle 20% around the median (121 frames) attributes the extra sampled time as follows. These are cohort averages, not individual p95 components; nested measurements are not additive.

| Work | Above-budget frames | Median cohort | Extra |
| --- | ---: | ---: | ---: |
| Rendering/submission | 5.656 ms | 4.945 ms | +0.711 ms |
| Of that: bundle recording | 0.447 ms | 0.030 ms | +0.416 ms |
| Texture streaming update, including upload | 0.217 ms | 0.048 ms | +0.169 ms |
| ALS/Subject animation and movement | 1.453 ms | 1.314 ms | +0.139 ms |
| Physics | 0.405 ms | 0.275 ms | +0.130 ms |
| GC | 0.045 ms | 0.019 ms | +0.026 ms |
| React | 0.0055 ms | 0.0040 ms | +0.0015 ms |
| Browser/native unassigned | 1.960 ms | 1.723 ms | +0.238 ms |

WebGPU return-data tasks average 0.0274 versus 0.0255 ms; all microtask checkpoints average 0.121 versus 0.104 ms. Feedback/readback callbacks do not explain the main difference. Physics and ALS use the same sampled paths; this sampling trace cannot establish doubled fixed steps. Selection retries execute the same fixed CPU dispatch sequence, with retry admission on the GPU; there is no CPU re-selection loop. Upload frames are the clear identifiable trigger: their bundle recording averages 3.077 ms, versus effectively zero without an upload.

Previously one texture publication invalidated all three pass BundleGroups, re-recording every lit bucket and both opaque cascade recordings. The follow-up replaces that global invalidation with one bundle per draw bucket and material binding versions. Opaque depth/shadow buckets have no texture dependencies. The previous pass-wide invalidation path is deleted.

One new isolated production Walk run used the same Chrome, GPU, viewport, profiler and tracing settings, with 7,528 MiB free before launch. It rendered 577 frames in 9,616.628 ms and moved the same 3.314 m. Every Chrome-root audit found one process; no Chrome existed before or after. No browser/GPU errors or post-readiness pipeline/shader creations occurred.

| Measurement | Before | After |
| --- | ---: | ---: |
| Main-thread busy p50 | 8.110 ms | **7.750 ms** |
| Main-thread busy p95 | 10.595 ms | **10.460 ms** |
| Main-thread busy maximum | 13.114 ms | 15.539 ms |
| Frames above 8.33 ms | 256/606 (42.2%) | 171/576 (29.7%) |
| Rendering/submission profile weight | 5.119 ms/frame | **4.961 ms/frame** |
| Upload-frame bundle recording | 3.077 ms | **0.098 ms** |
| Render bundle recordings / measured frame | 0.514 | 0.260 |
| Actual GPU draws / frame | 113 | 113 |
| GPU timestamp sum, near-cascade snapshot | 7.110 ms | **6.979 ms** |

The observed p95 improvement is modest: 0.135 ms (1.3%) in one before/after pair, with a higher maximum after. The specific upload-triggered recording cost fell substantially. Remaining slow frames contain renderer uniform/texture updates and ALS/physics variation; browser/native samples cannot be attributed further from this trace. The result does not establish that all remaining tail time is browser/native, and no second optimization pass was attempted.

After-run average costs are rendering/submission 4.961, browser/native 1.703, ALS/Subject 1.177, physics 0.329 and GC 0.024 ms/frame. GPU costs are view selection/recovery 1.657, shadow selection 1.328, lighting 1.649, depth/normals/motion 0.828 and active near shadow raster 0.890 ms. Final current view/shadow overflows are zero; lifetime restart counts remain three and 35.

Evidence: D:/dev/probe/ruins-cpu-slice2i-production-tail-attribution.json and D:/dev/probe/ruins-cpu-tail-production with JSON, analysis, attribution, Walk trace/profile, source map and before/after screenshots. The bounded follow-up measures Walk only; Wide and Walk are also checked through the merged 5247 preview.
