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
| Whole-level geometry at a 5 mm world cap | **7,930,327,040 B decoded pages; 6,110,016,500 B unique payload; 3,844,055,478 B wire** |

Triangle totals use authoritative component geometry, including spline variants. The 549-image figure includes parameters that static switches may not sample; 479 is the supported material closure. Deduplicate by built identity (source, colour space, normal processing). GPU bytes come from dimensions, not file lengths: `sum(16 * ceil(width/4) * ceil(height/4))` across resident BC7 mips.

The courtyard supplies exact 5 mm data for only 83/371 geometries: 1,573,639,456 B of GPU payload plus 2,750,688 B of nodes. Its baseline textures use 835,370,064 B. Geometry arithmetic follows `runtime-data.ts`: `residentVertices * vertexStride + meshletVertices * 4 + packedIndexBytes + clusterCount * 160`.

The completed slice-1 bake below uses **5 mm world error divided by maximum conservative placement scale**, including shear. Earlier resident builds cannot supply that answer: 62 geometries previously lacked any hierarchy, and the incomplete `level/` build covered 305/371 at 30 mm world error in an older format. Its 4,810,113,168 file bytes are historical wire bytes. The published courtyard's `0.005` cap remains mesh-local.

Streaming is necessary: decoded page images occupy 7.386 GiB before textures or traversal. The certified pinned closure reserves 56.250 MiB of physical pages; complete directory and capacity figures follow.

## Slice 1 bake census

Completed 20 October 2026 with compiler commit `56a2886`. Immutable owned build: `D:/dev/owned-assets/dark-ruins/build-pages-v5-20261020-01`. Run from a Visual Studio developer command prompt with Node 22+:

```powershell
node --max-old-space-size=12288 examples/ruins/scripts/build.mjs D:/Archive/dark-ruins-export D:/dev/owned-assets/dark-ruins/build-pages-NEW 0.005
```

The background scheduled bake and independent source/artifact readback completed with exit 0. The latter reread and decoded all 67,461 pages with the production decoder, checked complete pack/range hashes, both group dependencies, page-DAG acyclicity, placement scale normalization, source hashes/triangle counts, placement/material maps, outward spatial bounds and material unions. All source, finest-cut, cluster/group/forest and coarse-cut counts match the previous bake. Evidence: `D:/dev/probe/ruins-pages-v5-verified.json`, `ruins-pages-v5-decode.json` and `ruins-pages-v5-verify.log`. The build contains `census.json`, `surfaces.json`, `level.json`, `level.directory` and each geometry's directory/page pack. No published manifest was repointed. The [version-5 binary contract](../packages/geometry/scripts/README.md#page-format-version-5) replaces offline version 4; the courtyard continues to load version 3.

| Quantity | Exact measured value |
| --- | ---: |
| Component-local geometries / source mesh assets / source glTF files | 371 / 305 / 315 |
| Placements / visible placements | 20,430 / 20,399 |
| Source triangles / finest resident-cut triangles | 228,267,444 / 165,804,598 |
| Clusters / groups / traversal nodes | 3,666,653 / 225,116 / 258,658 |
| Unique geometry payload before page duplication | 6,110,016,500 B |
| Duplicated page vertices / duplicated vertex bytes | 109,297,086 / 1,815,202,928 B (29.71% of unique payload) |
| Page geometry payload including duplication | 7,925,219,428 B |
| Decoded resident page images | 7,930,327,040 B |
| Resident page headers / section alignment | 4,317,504 B / 790,108 B |
| Encoded page headers | 6,476,256 B |
| Encoded vertex / reference streams | 2,912,513,843 B / 396,029,411 B |
| Encoded triangle / cluster streams | 385,991,882 B / 143,044,086 B |
| Packed page wire bytes | 3,844,055,478 B |
| Virtual pages / full-inventory physical-slot bytes | 67,461 / 8,842,248,192 B = 8.235 GiB |
| Full-inventory unused slot bytes | 911,921,152 B |
| Pinned terminal groups / clusters / unique coarse triangles | 522 / 2,580 / 275,096 |
| Pinned page payload / decoded resident bytes | 7,072,176 B / 7,107,472 B |
| Pinned page wire bytes | 3,581,252 B |
| Pinned pages / arena reservation | 450 / 58,982,400 B = 56.250 MiB |
| Geometry directory sections / directory wire | 26,702,136 B / 36,005,712 B |
| Placement records / material maps | 3,595,680 B / 82,348 B |
| World spatial nodes / material bitsets | 1,307,488 B / 1,634,360 B |
| Level directory sections / wire | 6,619,876 B / 6,619,972 B |
| All directory sections / wire | 33,322,012 B / 42,625,684 B |
| Level manifest / geometry bootstrap wire | 9,510,986 B / 55,717,922 B |

Payload is packed vertices, u32 meshlet references, word-padded byte indices and 160-byte GPU cluster records. Exact identities: `6,110,016,500 + 1,815,202,928 = 7,925,219,428` payload bytes; adding 5,107,612 B of resident headers/alignment gives 7,930,327,040 B decoded page images. The 67,461 encoded 96-byte headers and four codec streams sum to 3,844,055,478 B wire. Full-inventory slot bytes are a virtual capacity measurement; the runtime design allocates its fixed 1,280 MiB arena. Pinned reservation charges entire slots. Directory wire includes metadata, headers and alignment. Geometry bootstrap is directory wire plus the level manifest and pinned encoded ranges; texture tails, collision, ALS and warmup remain separate.

| Previous offline v4 to v5 | Previous | New | Reduction |
| --- | ---: | ---: | ---: |
| Unique payload | 6,842,130,340 B | 6,110,016,500 B | 10.70% |
| Duplicated vertex bytes | 3,144,170,912 B (45.95%) | 1,815,202,928 B (29.71%) | 42.27% |
| Decoded page bytes | 9,993,667,600 B | 7,930,327,040 B | 20.65% |
| Wire page bytes | 9,993,667,600 B | 3,844,055,478 B | 61.54% |
| Full-inventory arena slots | 12,348,030,976 B | 8,842,248,192 B | 28.39% |

The old maximum 28-byte stride comprised position 6 B, tangent handedness 2 B, normal 4 B, UV0 4 B, tangent 4 B, colour 4 B and UV1 4 B. It reserved tangent storage even when absent. Version 5 uses a 16-byte base: position 3×u16 (6 B), octahedral normal 2×snorm16 (4 B), UV0 2×unorm16 (4 B), and tangent presence/sign flags plus word alignment (2 B). Authored tangent octahedral xy, RGBA8 colour and UV1 2×unorm16 each add 4 B only where present. Normals retain 16-bit precision. Position and UV bounds are asset-wide; decode remains fixed word loads, masks/shifts, octahedral reconstruction and multiply/add. The meshoptimizer octahedral encoder fits this lattice; its expanded post-decode filter would increase stride. No additional lossy colour/float filter is applied. Identical complete quantized tuples are welded after hierarchy construction, adding no loss beyond the existing lattice.

| Resident stride | Authored tangent | Colour | UV1 | Geometries | Unique vertex bytes | Page vertex bytes |
| --- | --- | --- | --- | ---: | ---: | ---: |
| 16 B | no | no | no | 222 | 2,521,094,720 B | 4,024,418,592 B |
| 20 B | no | no | yes | 24 | 19,808,840 B | 36,228,080 B |
| 20 B | no | yes | no | 28 | 465,428,620 B | 727,022,020 B |
| 20 B | yes | no | no | 60 | 4,126,180 B | 7,439,540 B |
| 24 B | no | yes | yes | 27 | 25,648,104 B | 45,338,928 B |
| 24 B | yes | no | yes | 10 | 18,466,776 B | 29,329,008 B |

Neighbouring/sibling groups share a local vertex table, with at most two adjacent original DAG depths and one pin class per page. Contractions preserve page-DAG acyclicity, checked independently from the written directory. The maximum observed whole group is 21 clusters / 81,184 B standalone including header/alignment; every cluster is at most 128 vertices/128 triangles. Original cluster depths remain intact. Only populated depth rows are densely numbered in the temporary input to the unchanged eight-wide BVH builder. Every retained group occurs once in the forest.

Wire compression uses meshoptimizer vertex codec v0 at level 2 for final packed vertices and 160-byte cluster records, index-sequence codec v1 for page-local references and triangle-index codec v1 for concatenated meshlet-local triangles. Native roundtrips preserve packed attributes, every triangle and winding. A bounded dedicated worker fetches the exact range, checks SHA256, decodes/pads/validates it and transfers the resident image before upload staging. The page API is exported by `@blacksite/geometry`; its runtime integration and outstanding production CPU acceptance are recorded in [the slice 4 report](streaming-paging.md).

Chrome 155.0.8059.85 on an AMD Ryzen 7 5800X measured **699.7 MB/s decoded resident output** (340.6 MB/s encoded input) in the actual production worker: 2,408 deterministic pages spanning all 371 geometries, 269,378,480 B output / 131,127,630 B input over 385.0 ms of decode/validation/padding. Sixty-four warmup pages are excluded. Page decode p50/p95 was 0.20/0.30 ms. Timing excludes fetch and SHA256; full sequential range-fetch/hash/decode/transfer took 3.586 s (75.1 MB/s output). The bake was idle during measurement. These decimal MB/s measurements establish the worker boundary, not GPU upload or first-playable performance.

The certified coarse cut includes all 20,430 placements, including hidden and unsupported surfaces. Its visible subset remains 2,304,519 triangles, 26,009 clusters and 20,822 group-instance pairs. The stronger all-placement capacity proof is:

| Resource | Complete coarse requirement | Declared capacity |
| --- | ---: | ---: |
| Coarse triangles | 2,306,171 | 16,000,000 |
| Selected cluster slots | 26,040 | 1,048,576 |
| Conservative frontier slots | 41,283 | 1,048,576 |
| Reached group-instance pairs | 20,853 | 524,288 |
| Pinned physical pages | 450 | 10,240 |

The explicit terminal-group lists support a final coarse pass without visiting the finer forest: 40,859 world nodes + 20,853 group-instance visits + 26,040 cluster visits = **87,752 work items/pass**; view, recovery and two cascades require **351,008** such items. Reserve this final-pass work before admitting retries. This certifies capacity and a complete cut, not GPU milliseconds.

Directories plus the prescribed 88 MiB scratch total **125,596,700 B**. Reserving 16 bytes/virtual page for a mutable page table and three 4,096-entry, 16-byte feedback queues adds **1,275,984 B**, leaving **141,562,772 B** inside the 256 MiB control ceiling. These are offline capacity calculations; no new GPU allocation or first-playable timing is claimed by this slice.

## Unsupported surface inventory

All 371 component-local geometries are baked, including unsupported surfaces and hidden placements. Material translation remains separate: 301 active primitive paths comprise 259 supported, 33 untranslated and 9 excluded FX paths. The immutable build's `surfaces.json` preserves every full material/parent path and every affected placement, geometry, primitive and source slot. Counts below overlap when a placement has several unsupported primitives.

| Active unsupported surface | Missing family / exclusion | Visible placements | Visible source triangles |
| --- | --- | ---: | ---: |
| MI_Flame_01 | Flame FX | 664 | 5,312 |
| MI_VolumetricFog_Beach | Volumetric fog FX | 1 | 48 |
| MI_VolumetricFog_Lab | Volumetric fog FX | 2 | 96 |
| MI_VolumetricFog_Outlook | Volumetric fog FX | 1 | 48 |
| MI_FogCard__Green_01 | Fog card FX | 17 | 5,026 |
| MI_FogCard__Green_02 | Fog card FX | 3 | 6 |
| MI_FogCard_01 | Fog card FX | 52 | 65,000 |
| MI_FogCard_02 | Fog card FX | 15 | 17,502 |
| MI_FogCard_03 | Fog card FX | 24 | 30,000 |
| BasicShapeMaterial | No parent | 3 | 144 |
| WorldGridMaterial | No parent | 6 | 4,896 |
| M_Bells_01 | M_GenericProps | 93 | 1,345,710 |
| MI_Bells_02 | M_GenericProps | 3 | 46,944 |
| MI_Bells_03 | M_GenericProps | 14 | 79,548 |
| MI_BrassPlate_00 | M_GenericProps | 3 | 416,640 |
| M_MagicEnergy | No parent | 44 | 1,408 |
| MI_Lantern_00 | M_GenericProps | 7 | 319,536 |
| MI_Lantern_01 | M_GenericProps | 5 | 228,240 |
| MI_NetRope | M_Cutout | 3 | 144,600 |
| MI_Hallway_Ceiling_02 | M_BlendMaterial | 16 | 176,608 |
| MI_Hallway_Floor_01_Rotated | M_BlendMaterial | 16 | 1,812,784 |
| MI_Hallway_Floor_01 | M_BlendMaterial | 40 | 3,147,126 |
| MI_Hallway_Wall_01 | M_BlendMaterial | 166 | 7,997,312 |
| MI_MS_Ocean | M_MS_Puddle | 1 | 1,800 |
| MI_MS_Puddle_02 | M_MS_Puddle | 1 | 32 |
| MI_MS_Puddle | M_MS_Puddle | 2 | 64 |
| M_Emissive_Inst_Cold1 | M_Emissive | 1 | 48 |
| M_Emissive_Inst_Cold2 | M_Emissive | 4 | 192 |
| MI_Dry_Grass_tbbqejqr | M_MS_CustomFoliage | 14 | 19,495 |
| MI_Massive_Nordic_Coastal_Cliff_vdssailfa | MI_Massive_Nordic_Coastal_Cliff_ullqbb1ga_Dungeon | 22 | 34,140,017 |
| MI_Old_Roman_Coin_ueinbaiva | M_GenericProps | 61 | 4,263,864 |
| MI_Scatter_Mushroom_Set_rlms31 | M_MS_CustomFoliage | 3 | 361,194 |
| MI_White_Button_Mushroom_pdww2 | M_MS_CustomFoliage | 12 | 278,810 |
| MI_D_Concrete_Crack_sezrfcg_1_N1 | M_MS_CustomDecal | 36 | 72 |
| MI_D_Dry_Grass_sfpzh__N1 | M_MS_CustomFoliage | 45 | 82,260 |
| MI_D_Dry_Grass_sfpzh_1_N1 | M_MS_CustomFoliage | 123 | 1,229,877 |
| MI_D_Dry_Grass_sfpzh_2_N1 | M_MS_CustomFoliage | 123 | 1,229,877 |
| MI_D_Rock_Patch_ui2lcaufw__HighFade_N1 | M_MS_CustomDecal | 67 | 134 |
| MI_D_Rock_Patch_ui2lcaufw__N1 | M_MS_CustomDecal | 87 | 174 |
| MI_Burnt_Grass_smlmnnn_ | M_MS_CustomFoliage | 82 | 204,918 |
| MI_Burnt_Grass_smlmnnn_2 | M_MS_CustomFoliage | 123 | 1,229,877 |
| M_Metal_Burnished_Steel1_Inst1 | M_Metal_Burnished_Steel1 | 1 | 1,812,343 |

The source also omits 894 decal actors, 59 particle-system actors and 9 cable actors from static geometry. Runtime material animation, displacement/world-position offsets and other authored shader effects are unbaked. These omissions are outside the 371 exported geometries; the census does not establish whole-level visual coverage.

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

**Offline pages.** Each page contains whole neighbouring meshoptimizer groups from one mesh, one pin class and at most two adjacent original DAG depths. Groups share one local packed vertex table. Prefer vertex-sharing neighbours and spatially adjacent/sibling groups; preserve an acyclic page dependency graph when contracting groups into pages. Preserve the asset-wide quantization lattice and weld identical complete packed tuples; report duplicated boundary vertices. The 16-byte base vertex contains u16 position, snorm16 octahedral normal, u16 UV0 and tangent flags. Optional authored tangent, RGBA8 colour and UV1 add four bytes each. The maximum 28-byte configuration bounds a group at `21 * (128*28 + 128*4 + 384 + 160) = 97,440 B`, fitting 128 KiB with its header. Validate that contract during the bake. Wire pages use meshoptimizer vertex/index codecs; a dedicated worker fetches, hashes and decodes each bounded page before upload staging. Charge decoded resident bytes and full physical slots separately from compressed wire bytes.

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

