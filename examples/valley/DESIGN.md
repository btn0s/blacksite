# Valley

A Slice: walk from a meadow ridge into a layered forest valley using ALS and its shoulder camera. The visual reference is Florian Hoenig's local meadow film, viewed only outside the repository. The composition goal is foreground blades and flowers, irregular connected tree crowns, a warm grazing sun, long soft shadows, atmospheric valleys and mountains under real cloud shapes. Dedicated flower patches, fallen logs and fern dressing remain composition goals; the implemented content is listed below. Walking through the representation changes should reveal no rings, cracks, hitches or audible repetition.

## Current scene settings

`src/model.ts` owns the tier settings and world dimensions. `src/Landscape.tsx` defines foliage families and placement masks, `src/rocks.ts` defines rock groups, and `src/atmosphere.ts` defines lighting. Distances are metres. Population caps and rendering ranges are configuration, not measured performance results.

| Quantity | High | Medium | Low |
|---|---|---|---|
| Walkable heightfield extent | 1,024 × 1,024 m | same | same |
| Near heightfield samples | 1,025 × 1,025 | same | 513 × 513 |
| Far heightfield extent | 16,384 × 16,384 m | same | same |
| Far heightfield samples | 2,049 × 2,049 | same | 1,025 × 1,025 |
| Camera far plane | 16,000 m | same | same |
| Tree mesh-to-impostor transition | 48–70 m | 40–58 m | 28–42 m |
| Tree impostor fade range | 3,200–4,200 m | 2,800–3,800 m | 2,300–3,200 m |
| Forest placement extent | 6,000 × 6,000 m | same | same |
| Forest population cap | 256,000 | 192,000 | 128,000 |
| Tree atlas frame size | 192 px | 160 px | 160 px |
| Ground-cover radius / density multiplier | 120 m / 1 | 100 m / 0.8 | 80 m / 0.8 |
| Ground-cover final fade | 96–120 m | 80–100 m | 64–80 m |
| Terrain material detail distance | 260 m | 260 m | 140 m |
| Sun shadow reach / cascades / map size | 260 m / 2 / 2,048 px | 200 m / 2 / 2,048 px | 140 m / 2 / 1,024 px |
| Ground-cover shadow reach | 50 m | 50 m | 50 m |
| Render pixel-ratio cap | Shared policy: 1 mouse, 1.25 coarse pointer | same | 2 |
| GTAO / bloom | enabled | enabled | disabled |
| Audio voice cap | 32 | 32 | 16 |

Forest placement uses a deterministic 5.2 m jittered grid inside `[-3,000, 3,000]` on both horizontal axes, filtered by the terrain forest mask and a stable rank. The same distance-weighted priority favours candidates near the walkable area; expanding the bounds adds actual owned-tree instances across the distant hills. The population cap is an upper bound; the HUD reports the actual retained trees. Birch and Scots pine share the distribution seed across tiers. Pine has an authored intermediate mesh LOD; both species bake matching multi-angle impostors from their original models. Low uses one atlas direction per fragment; the other tiers interpolate directions. All tiers use single-sample WebGPU rendering and TRAA, with alpha coverage preserved by the native foliage materials.

Terrain uses fixed CDLOD nodes with 32 m leaves and a 32 × 32 grid, plus quadrant draws at transitions. Vertices morph toward the parent grid using shared height samples; there are no skirts or fixed 256-chunk layout. Near and far heightfields blend across 200 m. Terrain renders the actual ground at every distance, including the forest-floor material mask; the forest owns all tree silhouettes.

Ground cover uses a bounded cache of 32 m world-aligned tiles inside the walkable square. Each family transitions from its original mesh to its own baked impostor over 18–28 m. Population depends on the local masks, tier density and active tiles; there is no fixed grass/flower/stone/litter percentage or global instance quota.

| Authored cover family | Base candidates per square metre | Placement |
|---|---|---|
| Meadow grass | 4 | Meadow, excluding the path |
| Bunch grass | 0.65 | Meadow, excluding the path |
| Dry brome | 0.4 | Meadow, excluding the path |
| Gooseberry | 0.02 | Forest understory, excluding the path |
| Nettle | 0.07 | Forest understory, excluding the path |
| Dock | 0.04 | Noise-selected patches, excluding the path |
| Thistle | 0.025 | Meadow, excluding the path |
| Ivy | 0.055 | Forest understory, excluding the path |

`src/model.ts` records targets of 8.3 ms frame time on desktop, 16.7 ms on phone, a 33 ms hitch limit and 9,000 ms to first playable. These remain targets until measured on the relevant device. The previous detailed CPU/GPU allocations were proposals, not implemented budgets or results.

## Implemented parts and composition goals

| Part | Current content | Purpose |
|---|---|---|
| Terrain and backdrop | One scanned near heightfield, one blended far field with procedural mountain relief | A coherent walkable surface and distant ridges |
| Ground materials | Four layers: grass, scanned soil, dirt and gravel; colour and normal maps at metre scale | Surface variation without visible texture repetition |
| Forest | Scots pine, its supplied mesh LOD, birch, and one matching atlas per species | Connected crowns and consistent silhouettes across distance |
| Cover | The eight authored families above | Meadow density and forest understory |
| Rocks | Six fields of up to 24 field-rock candidates each, reduced by path exclusion; six cliff outcrops | Foreground scale, slope structure and meshlet demonstrations |
| Shared travelling wind | One field driving foliage and audio | Gusts with a shared position and travel direction |
| Lighting | One low sun, sky/environment fill, two native cascades on every tier, GTAO on high/medium | Shape, grounded props and depth in shade |
| Atmosphere | Scattering sky, one cloud layer, aerial perspective and height fog | Separation between valley and mountain layers |
| Antialiasing | TRAA and complementary representation fades | Stable thin foliage and transitions |
| Player | One ALS character through the public shoulder-view controller | Scale, locomotion and a walkable demonstration |
| Audio | Wind and leaves beds, five synthesized bird-song variants, nine recorded grass-step variants, landing cues | Motion and variation tied to the walker and wind |
| Inspection | Compact stats, one LOD colour view, technique switches and telemetry dump | Visible, measurable representation choices |

Future composition work may add dedicated flower drifts, fallen trunks, ferns and additional hero dressing. They are not counted as current scene content. Particle consumers of wind are also future work.

## Camera bookmarks

`src/model.ts` stores these composition poses. They are reference coordinates, not alternate player cameras. Forward into the valley is negative Z.

| Bookmark | Position | Target | Field of view |
|---|---|---|---|
| Meadow | `[-14, 3.2, 30]` | `[40, 0.6, -40]` | 55° |
| Canopy | `[-150, 30, -150]` | `[-330, -20, -420]` | 55° |
| Valley | `[60, 26, -60]` | `[-900, -60, -1500]` | 50° |
| Ridge | `[210, 70, 230]` | `[-1800, 120, -2600]` | 45° |

Meadow frames grass and the forest edge; Canopy frames tree crowns and representation transitions; Valley frames distant forest and haze; Ridge frames the mountain silhouette. Play and inspection use the ALS shoulder camera. There is no free camera, flyover, recorded route, culling freeze or LOD freeze.

## Public systems and integration

- `@blacksite/landscape`: shared heightfield sampling, CDLOD terrain, authored cover, forest impostors and wind. Tree placement is deterministic at construction. GPU compute selects representations and visibility, then indirect draws consume compact lists. Ground cover uses the same GPU submission with a bounded world-aligned tile cache; only entering tile stripes are populated on the CPU. Foliage atlases bake at load time from the source models.
- `@blacksite/geometry`: offline rock hierarchies, GPU meshlet LOD and visibility, indirect material batches, two-pass HiZ with terrain/tree depth, and independent cluster selection for each actual sun cascade camera.
- `@blacksite/look/webgpu`: native SunLight with two cascades, physical exposure, Neutral tone mapping, tiered GTAO and bloom, TRAA, grade and camera effects, plus native sky/cloud/aerial nodes. Probe lighting is reserved for later work.
- `@blacksite/inspect`: renderer-independent rolling frame history, compact stats, technique registration, lit/LOD controls and a host-provided telemetry action.
- `@blacksite/example-valley`: exports `mount(element)` and standalone HTML. No example imports package internals.

## Showcase controls

The renderer requires WebGPU. Desktop Chrome and iOS Safari are the targets. ALS is the only controller and the shoulder view is the only camera; touch uses the same controller through a virtual stick and drag look.

The HUD shows recent frame p50/p95, drawn triangles versus the current representation before visibility selection, including the ALS body, geometry culled, renderer draw calls across all passes, device tier and native GPU timestamps where supported. Triangle counts describe geometry submissions, including shader-discarded foliage vertices; they are not pixel counts. GPU timings are optional and unsupported queries are shown as unavailable.

The single LOD view uses green near geometry, amber intermediate geometry, blue far geometry and cluster colours for rocks. The techniques panel controls terrain LOD, tree LOD/impostors, GPU tree and ground-cover culling and impostors, rock meshlet LOD, rock HiZ and rock cascade shadows. Disabled comparisons use bounded fallbacks described beside each switch.

Press **T**, or tap **Dump stats**, to save the current counters, recent frame-time history, native GPU pass timings, device/UA/adapter/tier, viewport and the ALS player position and view. The dev server appends one JSON object per line to `examples/valley/telemetry/snapshots.jsonl`. The HUD confirms success or allows retry after a failure. Telemetry files are local and ignored by git.

There is no baseline comparison or benchmark gate. The user walks the scene and chooses where to capture telemetry. Baked material layers, cached distant shadow cascades, probe lighting, upscaling and remote asset streaming remain later work.

## Phase 2 rendering

The dev server mounts the shared `~/dev/owned-assets/` folder at `/owned/`. Scots pine's supplied middle geometry borrows materials through exact source material-name matches; all forest and cover atlases bake from the same original models. No asset copies are placed in the worktree.

`pnpm build:rocks` rebuilds field-rock and cliff hierarchies in the shared asset folder. Meshlet selection uses a two-pixel projected error; disabling LOD selects original-detail clusters within a 120 m bounding-sphere cap through the same renderer. HiZ includes terrain and tree depth with their foliage coverage. Every sun cascade independently selects rock clusters from its actual light camera before rendering its shadows. Forest and cover also select independent light-view representations.

Lighting uses 63,000 lux sun, 12,000 lux sky and EV100 13, with Neutral tone mapping and a camera contrast of 1.06. A low warm sun, controlled sky fill and blocker-search shadow penumbra establish shape. GTAO and bloom run on high/medium, TRAA runs on all tiers, and the olive nature LUT is omitted.
