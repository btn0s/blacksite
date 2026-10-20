# Whole Dark Ruins streaming

Design at `c10bf9a`, measured 20 October 2026. Keep the existing three WebGPU/TSL renderer, meshoptimizer hierarchy, material graphs, indexed compaction, Rapier and ALS. A single residency owner admits geometry pages and texture mip tails against a hard byte ledger. Missing detail preserves a complete coarse representation. Target main-thread and GPU time remains 8.33 ms/frame; the Walk trace below shows that the CPU target is not currently met.

## Measured inventory

Read-only inputs: `D:/Archive/dark-ruins-export` metadata/component geometry and `D:/dev/owned-assets/dark-ruins` manifests/meshlet headers. Counts describe the export; not every surface currently renders.

| Quantity | Measured value |
| --- | ---: |
| Placement records / visible records | 20,430 / 20,399 |
| Referenced source mesh assets / component-local geometries | 305 / 371 |
| Source-asset triangles / unique component-local triangles | 228,259,444 / 228,267,444 |
| Triangles with placement multiplicity | 16,363,763,624 |
| Active primitive material paths | 301: 259 supported, 33 untranslated, 9 excluded FX |
| Export 2D texture sources | 549 |
| All 549 at maximum 2K, BC7 including mip chains | 2,352,451,552 B = 2.191 GiB |
| Same inventory at maximum 256 | 38,801,376 B = 37.004 MiB |
| Supported material closure, including shared noise | 479 texture identities; 2,119,883,456 B at 2K |
| Whole-level geometry at a 5 mm cap | **Not available from the existing builds** |

Triangle totals use authoritative component geometry, including spline variants. The 549-image figure includes parameters that static switches may not sample; 479 is the supported material closure. Deduplicate by built identity (source, colour space, normal processing). GPU bytes come from dimensions, not file lengths: `sum(16 * ceil(width/4) * ceil(height/4))` across resident BC7 mips.

The courtyard supplies exact 5 mm data for only 83/371 geometries: 1,573,639,456 B of GPU payload plus 2,750,688 B of nodes. Its baseline textures use 835,370,064 B. Geometry arithmetic follows `runtime-data.ts`: `residentVertices * vertexStride + meshletVertices * 4 + packedIndexBytes + clusterCount * 160`.

**The whole-level 5 mm total cannot be recovered from these inputs.** Across all builds, 62 geometries have no hierarchy; `level/` contains only 305/371 at 30 mm world error in an older format. Its 4,810,113,168 file bytes are not current GPU bytes. The courtyard's `0.005` cap is also mesh-local. Normalize the new bake to **5 mm world error divided by maximum conservative placement scale**, including shear. Slice 1 must measure the complete payload, pinned closure and page duplication; extrapolation would invent the answer.

Streaming is already necessary: all-source 2K textures consume 88% of 2.5 GiB; courtyard geometry alone exceeds the remainder. Courtyard coarse roots occupy only 175,192 B, but whole-level roots remain unmeasured.

## GPU budget and data layout

Initial RTX 3070 allocation, in MiB; the **2,560 MiB ceiling includes geometry auxiliaries**, not just fetched payload:

| Allocation | Ceiling | Contents |
| --- | ---: | --- |
| Shared geometry arena | 1,280 | 10,240 physical pages of 128 KiB, including pinned roots and retiring slots |
| Texture pool | 768 | All live minimum tails, promotions and old/new swap overlap |
| Compacted indices, arguments, HiZ | 192 | Existing 16M total triangle capacity uses 183.106 MiB; remainder covers small buffers |
| Directory and traversal | 256 | Unique hierarchy, placements, page table, feedback and fixed scratch |
| GPU upload staging | 64 | Reusable bounded buffers; never a whole-level upload copy |
| **Total** | **2,560** | Free arena slots still count as allocated memory |

Report render targets, shaders and unchanged ALS/native assets separately, initially reserving 512 MiB. With the supplied 1.2 GiB system/browser estimate, the 8 GiB card retains headroom. CPU staging and Rapier have separate limits. Scale capacities down, respecting adapter storage-binding/buffer-size limits. The minimum supported budget is the measured pinned closure plus scratch/staging; reject an impossible tier before allocation.

**Offline pages.** Extend the existing format/build. Each page contains whole meshoptimizer groups from one mesh and DAG depth: local vertices/references, packed indices and existing 160-byte cluster records. Preserve the asset-wide quantization lattice; report duplicated boundary vertices. The pinned configuration bounds a group at 21 clusters of 128 vertices/triangles: `21 * (128*28 + 128*4 + 384 + 160) = 97,440 B`, fitting 128 KiB with its header. Validate that contract during the bake.

One shared u32 arena replaces whole-level vertex/reference/index/cluster allocations; shaders add physical page bases to local offsets. Pages add no draw objects. Each new immutable owned build directory contains the bootstrap, page packs with ranges/hashes, texture-tail descriptors and collision chunks. Never overwrite or repoint published manifests.

**Always resident.** Keep compact group bounds/error/dependency records, the existing eight-wide BVH, placement transforms/material mappings and a world spatial BVH. Approximate directory bytes are `32*groups + 48*nodes + 16*pages + 176*placements`, plus reverse dependency lists, material maps and spatial records. The full placement records alone are 3.429 MiB. Keep the 160-byte cluster records inside pages. Pin every terminal/coarsest DAG group, including terminals at earlier depths.

Replace scratch sizing by clusters multiplied by placements and the 16,777,216-candidate creation limit. Per view/shadow stream, cap selected slots at 1,048,576, frontier slots at 1,048,576 and reached **group-instance** pairs at 524,288: `24*S + 16*Q + 8*L = 44 MiB`. Both streams cost 88 MiB; cascades reuse one shadow stream. Directory/dependencies/feedback must fit the remaining control budget.

## Per-frame flow and residency rules

1. At a frame boundary, consume completed feedback without awaiting it. Admit only bounded ready work: initially at most 0.5 ms CPU scheduling, 8 MiB of GPU uploads and one texture replacement per frame. Geometry uploads use reusable storage staging plus TSL copies into the arena. Decode/fetch occurs off the render tick, with a 64 MiB CPU staging cap and cancellation of stale requests.
2. Publish one page-table epoch after its uploads, in GPU queue order. View selection, depth recovery, lighting and both cascades use that same epoch. Reuse evicted slots only after a small readback completion ordered after their last referencing frame; completion serials also retire texture allocations. Delayed completion reduces available capacity instead of overwriting live data.
3. Traverse the world BVH, then the existing mesh hierarchy for surviving placements. Select by projected error and HiZ as today. On a missing desired group, atomically append a deduplicated page request with projected importance; selected pages update GPU last-use stamps. Request queues are bounded (initially 4,096 entries), with overflow counters and next-frame retry. Feedback also carries per-texture mip demand. Use three's public asynchronous readback with three reusable feedback slots, at most one outstanding sample every four frames; skip a sample if all slots remain busy.
4. Preserve a complete DAG cut. Residency is closed over **all coarser reverse dependencies**. Admit ancestors first; evict unused descendants before ancestors. Every coarse representative queries the same finer group's readiness. For a ready group's clusters, retain the existing `parentError > threshold` test and select when the refined group is absent, its page is missing, or `selfError <= threshold`. A missing page emits requests, not holes. LRU operates only on unpinned pages with no resident dependants, using GPU usage across main and shadow views; protect recently admitted pages against churn.
5. Fit selected clusters to the existing triangle budget, compact real indices, and draw global material ranges. Slot/frontier/reached-group or work-budget overflow invalidates that attempt and restarts **from roots** at coarser error; reusing a truncated leaf list is unsafe. Bound attempts, then use the certified coarsest cut. Certification covers full-level coarse triangles, slots, group leaves, frontier, and cumulative node/cluster work across view, recovery, cascades and retries. Reserve enough work for that final cut; reject a tier below this minimum. No partial cut is submitted. Keep demand/eviction pressure separate from triangle-pressure hysteresis.
6. Continue current-depth recovery and independent shadow selection. Track selection/compaction, shading and upload GPU timestamps separately. CPU bookkeeping has fixed quotas; GPU node/cluster work also needs a fixed admission limit, not merely fixed memory. When time pressure persists, increase geometric error and reduce texture promotion demand; capacity does not by itself prove 8.33 ms GPU time.

The group readiness rule extends the existing [pinned meshoptimizer DAG contract](https://github.com/zeux/meshoptimizer/blob/f0a684f11ead064e176775c9b796f82a55910e92/demo/clusterlod.h); its spatial forest is not a parent tree. Upload/readback stays on [three's public renderer/storage APIs](https://raw.githubusercontent.com/mrdoob/three.js/r186/src/renderers/common/Renderer.js), with no renderer patches or synchronous GPU waits.

## Texture residency

Replace the pinned-2K-plus-24-detail-textures policy in `examples/shared/scan-material.ts` with **one resident mip tail per texture identity**. Extend `build-scan-materials.mjs`'s existing encoded KTX2 tail slicing to 256/512/1K/2K; no source re-encoding is required for slicing. Pin a maximum-256 tail for every needed image; choose smaller floors for lower budgets. This costs about 37 MiB for all 549 source images before any additional translated identities.

Promotion physically allocates the requested tail, swaps the existing shared texture nodes after upload, and retires the old allocation. Demotion does the same with a smaller tail. Charge both allocations until retirement, including decoded staging where applicable. Clamping a sampler on a full texture does not release its memory. Count actual negotiated block formats, every mip, and alignment; formats on later devices may differ.

Use selected cluster/placement density to atomically reduce desired mip per image, including UV0/UV1 scale, authored layer tiling and world-space mappings. Precompute UV-to-world density bounds; a material's bounding-box size is insufficient. Reuse the same feedback cycle as geometry, with hysteresis and a three-second cold delay. Budget pressure cancels promotions before evicting useful tails. Start this card's policy at **2K maximum**, deliberately dropping 4K promotion because close-up quality is secondary and a 4K BC7 tail is 21.333 MiB. This leaves every upload within the bounded 8 MiB admission unit. Delete the old baseline/detail caches, count limit and periodic full-placement CPU scan.

## CPU, collision and first frame

Keep placements immutable on the GPU, without per-placement React/Three objects or CPU loops. Preserve material-only batching and opaque depth buckets. Courtyard: 59 material batches, 128 draws; 301 whole-level materials cannot inherit that draw count. Zero-count draws still cost CPU. Spatial nodes carry conservative material bitsets; submit the current view/shadow union, updated on coverage changes with immediate activation of newly visible materials. Wide-view submission cost still needs measurement.

Partition the current collision cooker/loader into approximately 32 m regions, initially capped at 16K triangles/chunk. The courtyard collider already contains 1,291,550 triangles and 32,162,796 serialized bytes. Cook transformed triangles at 0.75 m **world** error, correcting the local-error comparison for placement scale. Give triangles unique ownership and index actual chunk bounds across seams. Keep the movement/sweep neighborhood loaded, prefetch the next ring and retain a trailing ring. No runtime per-placement transformation/remounting.

Fetch/decode asynchronously; insert/remove bounded chunks between physics steps, releasing source arrays/shape caches. Measure Rapier insertion time and acceleration-structure bytes against an initial 128 MiB CPU cap. Late collision holds movement at the loaded boundary; teleport activation waits for destination collision. Delete `examples/ruins/src/collision.tsx`'s preload-all/per-placement path. ALS and its assets remain untouched.

First playable needs the directory, coarse geometry, minimum tails, spawn collision, ALS and warmed spawn render passes. Replace the all-assets loader barrier. Nearby geometry, higher mips, next-region collision and approaching material pipelines load in the background. Require `bootstrap wire bytes / measured throughput + critical-path decode/upload/warmup <= 5 s`; this is a target. Illustratively, 96 MiB at 50 MiB/s leaves 3.08 s for other work; actual bootstrap bytes remain to be baked. Translate unsupported surfaces on this stack before claiming whole-level visual coverage.

## Walk trace and build slices

One capture on the untouched 5247 preview: Chrome 155, headless, RTX 3070, 1920×1080, DPR 1, high tier, Walk, W held for five seconds. No Chrome before launch or after close; one browser during capture. Player displacement was 3.314 m. Telemetry POSTs were intercepted locally so the preview checkout received no telemetry files.

The marked interval was 5,013.154 ms with **265 actual R3F frame callbacks**. Main-thread `RunTask` union was 4,229.909 ms: **15.962 ms busy/frame**. Thread-clock difference was 4,088.331 ms: **15.428 ms CPU/frame**. Busy-time p95 across complete callback-to-callback intervals was **29.84 ms**; callback rate was 52.86/s. These are traced development-build observations, including tracing overhead, not an untraced 120 Hz performance claim.

| Largest exclusive CPU-profile sample groups | Approximate ms/frame |
| --- | ---: |
| Renderer, look and geometry submission | 8.51 |
| ALS/Subject excluding physics | 1.88 |
| Physics, including shape queries | 0.63 |
| React development UI | 0.49 |
| Garbage collection | 0.12 |
| Browser/native samples without a JS owner | 4.29 |

Sample weights are estimates, not an additive CPU clock; the native bucket cannot be assigned wholesale to GPU waits or profiler overhead. Rendering includes approximately 1.37 ms/frame inside compute submission. Physics alone will not recover the target. A proposed main-thread allowance is 5.0 ms rendering/submission, 2.5 ms character/physics, 0.5 ms streaming and 0.3 ms other work; each needs playtrace confirmation. Evidence remains outside Git in `D:/dev/probe/ruins-stream-walk.{trace.json,cpuprofile,json}`, `ruins-stream-independent-analysis.json` and `ruins-stream-inventory-summary.json`.

Each implementation slice must be independently usable and remove the path it replaces:

| Order | Shippable result | Acceptance boundary |
| --- | --- | --- |
| 1. Build contract and census | Versioned page compiler/directory and complete 5 mm world-space census in a new owned build directory | All 371 geometries accounted; exact payload/packing/root/directory bytes; coarse capacity proof; every unsupported surface explicitly inventoried. Existing previews continue unchanged. |
| 2. Bounded selection and CPU | Courtyard on fixed traversal scratch and material submission ownership | Rendering reaches its 5 ms allowance; main-thread p95 leaves 0.5 ms streaming headroom inside 8.33 ms. Delete candidate-multiplied scratch and truncated-list overflow handling. |
| 3. Texture budget | Courtyard on real mip tails and shared byte ledger | Turn/walk repeatedly through promotions and demotions; allocations, overlap and upload work remain bounded, materials keep their authored appearance. Delete old 2K/4K manager. |
| 4. Geometry paging | Courtyard rendered through the page arena with coarse fallback | Cold start, fast turns, forced cache pressure and delayed IO keep complete geometry; counters prove cap and retirement safety. Delete whole-asset payload assembly and fixed whole-level pools. |
| 5. Whole-level playable | All exported placements/surfaces supported, regional collision and staged bootstrap | Walk region seams and long views; unchanged ALS; no missing ground or material substitutions; first-playable, CPU/GPU p95 and memory measured on the real level. Delete stale ruins material/collision loading paths. |
| 6. Smaller budget | Same renderer and scheduler with smaller capacities/mip floor | Repeat the route at a declared reduced budget; quality gives way while byte, work and collision boundaries hold. No second renderer or phone performance claim. |

