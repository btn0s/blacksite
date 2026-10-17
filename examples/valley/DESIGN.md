# Valley

A Slice: walk from a flowered meadow ridge into a layered forest valley. The reference is Florian Hoenig's local meadow film, viewed only outside the repository. The composition needs foreground blades and flowers, irregular connected tree crowns, a warm grazing sun, long soft shadows, atmospheric valleys and mountains under real cloud shapes. The ten-minute test is walking through the representation changes without rings, cracks, hitches or audible repetition.

## Model and budgets

The pure `src/model.ts` owns these numbers. Distances are metres, time is seconds. This is a proposed budget until measured; targets are never presented as results.

| Quantity | Desktop / high | Phone / low |
|---|---|---|
| Walkable heightfield | 1,024 × 1,024 m | same |
| Horizon / camera far | 3,200 m | 2,400 m |
| Terrain chunks | 16 × 16 at 64 m | same, coarser distance selection |
| Near tree meshes / transition | 0–65 / 45–85 m | 0–40 / 25–55 m |
| Impostors / far canopy transition | to 650 / 450–700 m | to 450 / 300–500 m |
| Forest population target | 12,000, 3 crown species | 7,000, same distribution seed |
| Ground cover maximum / radius | 80,000 / 75 m | 24,000 / 45 m |
| Grass / flowers / stones / litter mix | 86 / 8 / 3 / 3 percent | same |
| Sun shadow reach / cascades | 180 m / 3 | 90 m / 2 |
| Render pixel ratio | 1 | 2 (Valley only; the shared low tier stays at 1.25) |
| Main-thread p95 | 8.3 ms | 16.7 ms |
| CPU allocation: input + character | 2.0 ms | 4.0 ms |
| CPU allocation: world selection + wind | 0.8 ms | 1.5 ms |
| CPU allocation: render submission | 3.0 ms | 5.5 ms |
| CPU allocation: audio + UI | 0.5 ms | 0.7 ms |
| CPU reserve | 2.0 ms | 5.0 ms |
| GPU target: geometry / shadows / look / reserve | 3.2 / 1.8 / 2.0 / 1.3 ms | 6.5 / 3.0 / 3.0 / 4.2 ms |
| First playable / hitch limit | 5,000 / 33 ms | same |
| Active audio voices | 32 maximum, 8 intended | same |
| Run / sprint / time to 90% | 3.75 / 6.5 m/s / 0.25 s | same |

Medium uses 10,000 trees, 48,000 ground instances, 60 m ground radius, and two sun cascades. Ground density uses reproducible world masks: slope, height, low-frequency clusters and a path exclusion. Distance attenuation is continuous and stable in world space. Trees use the same source geometry for near meshes and build-baked multi-angle impostors. Far crowns soften in texture space; dither is spatially stable and complementary. Terrain edges use shared samples, skirts and continuous morphing toward the next grid.

## Parts list and the cheapness each fixes

| Part | Minimum count | Fix |
|---|---|---|
| Terrain cells and mountain backdrop | 256 cells, 3 mountain ridges | Terrain: a coherent heightfield, crack-free distance LOD |
| Redistributable scanned ground blends | 4: soil, gravel, grass, rock | Terrain and flat materials: normal/roughness variation, metre UVs, anti-tiling |
| Procedural crown species and baked atlases | 3 species, multi-angle atlas each | Far field: matching mesh/impostor silhouettes rather than sudden swaps |
| Clustered forest instances | 12,000 desktop, 7,000 phone | Bare slopes and harsh distant contours |
| Cover families | grass, flowers, pebbles, litter | Bare ground, with tier counts above |
| Hero dressing groups | 6 rock groups, 3 fallen trunks, 3 fern/undergrowth patches | Bare ground and near-field scale |
| Shared travelling wind | 1 field, grass/tree/particle/audio consumers | Dead stillness; gusts have position and travel speed |
| Lighting | 1 low sun, sky fill, 3/2 shadow cascades, desktop AO | Flat light, black shade, detached props |
| Atmosphere | scattering sky, 1 layered cloud system, aerial perspective, height fog | No depth or weather |
| Post AA | nature preset AA, stable cover fade | Shimmer on blades and thin branches |
| Animated player | 1 ALS character using the public TPP path | Scale, locomotion, walkable proof |
| Audio | wind bed, 3 bird variations, movement/landing | Dead stillness and repetition |
| Critic cameras | 4 bookmarks, 1 flyover route | Measurable composition and transition evidence |

## Camera bookmarks

Coordinates are provisional until grounded against the pure height function; record final poses in the model. Forward into the valley is negative Z.

1. **Meadow** near `(0, height(0,100)+2, 100)`, toward `(0, 45, -250)`: foreground flowers, open path, many forest depth layers; matches reference frames 1–3.
2. **Canopy** near `(65, height(65,-30)+8, -30)`, toward `(-40, 35, -350)`: hero trunks and crown contours; matches frames 6–8.
3. **Valley** near `(-100, height(-100,-180)+24, -180)`, toward `(100, 45, -500)`: impostors, valley haze and mountain silhouette.
4. **Ridge** near `(180, height(180,160)+4, 160)`, toward `(-100, 60, -450)`: diagonal meadow, cloud shapes, sun shadows.

The scripted flyover moves continuously from Meadow through Canopy and Valley, crossing the mesh/impostor and impostor/cloud bands. Shimmer captures hold a camera still, freeze deliberate wind/cloud animation through a diagnostic hook, and measure temporal pixel fluctuations without disabling AA or LOD.

## Public systems and integration

- `@blacksite/landscape`: deterministic terrain sampling and chunked LOD; ground-cover placement/instancing; multi-angle forest impostors and far canopy; shared wind with CPU and shader access. Build-time baking remains an explicit reproducible command. WebGPU placement compute is capability-selected with the same deterministic WebGL2 placement fallback.
- `@blacksite/look`: opt-in `nature` atmosphere, sky/cloud/height-fog additions, sun cascades and post AA. Existing zone defaults remain byte-for-byte where possible, with two showcase before/after captures.
- `@blacksite/check`: shimmer measurement and scripted flyover contact sheet using public contract hooks.
- `@blacksite/example-valley`: exports `mount(element)` and standalone HTML. Thin site registration follows Traverse in Characters. No example imports package internals.

## Asset and licensing policy

Use indexed `blacksite assets` metadata first. Install only assets whose source licence expressly permits public redistribution. Never copy owned packs. Existing world-kit CC0 scans are a permissible fallback while indexed install availability is recorded. Tree geometry is original procedural code with its explicit redistribution licence recorded; no third-party canopy art. Every new public asset is credited in `site/public/CREDITS.md`. The local reference stays outside the repository.

## Evidence and deferred lighting

Run desktop and phone checks without weakening budgets, read all critic and transition captures at 1× and 4×, and compare matching compositions with local reference frames outside the repository. Capture two zone showcases before and after look changes. Report achieved counts, measured timings, host load and visual gaps honestly. Build-time path-traced lighting is design-only: the report will define static scene extraction, UV/texel budgets, irradiance and directional outputs, probe fallback for moving foliage, compression, cache invalidation and runtime memory budgets.
