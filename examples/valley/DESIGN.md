# Valley

Walk from a ruined watchtower on a gold meadow ridge, through a forested valley of ancient stonework, to a monumental temple above the gorge. The temple is the destination and the distant landmark. Dark conifers, pale birch, bleached limestone, warm grazing sunlight and blue-grey atmospheric layers establish the value structure. The character and shoulder camera remain ALS; there is no free camera or flyover.

The layout is about four kilometres square. Coordinates are metres, X east and Z south. The external map schematic defines the geography; its eight external shoulder-camera paintings guide composition. Reference images and generated assets remain outside the repository.

## Geography and route

`src/layout.ts` is the map definition. It contains the river, aqueduct and walking-path curves, POI footprints, bridge endpoints and eight camera sites. `src/world.ts` shapes the terrain around them and samples a single shared heightfield for rendering, placement and collision.

| Place | Position X/Z | Ground elevation | Purpose |
|---|---|---|---|
| Watchtower stump | -1500 / 150 | 260 m | Spawn ridge and first temple reveal |
| Standing stones | -1100 / 300 | 205 m | A meadow destination below the ridge |
| Swallowed arch | -500 / -150 | 125 m | A stone opening under the canopy |
| Broken aqueduct | -350 / -2000 to 600 / -60 | Follows the valley | A river-side line leading toward the bridge |
| Spring shrine | 50 / 1260 | 70 m | A carved face, falling spring and pool beneath the south wall |
| Bridge | 600 / -60 to 930 / -80 | 155–210 m | A 14 m wide rising crossing of the gorge |
| Temple | 1270 / -95 | Forecourt 210 m, platform 234 m | The monumental endpoint on the eastern mesa |

The main trail descends from the ridge past the stones and arch, crosses a shallow river ford and rises to the bridge. A southern branch leads to the spring; a northern branch follows the aqueduct. Terrain grading and structural collision provide the walking surface. The river and spring use native physical node materials with terrain-depth shore clipping, environment reflection and transmission.

## Stonework

`src/stonework.ts` assembles one building and one set of ruins from a fifteen-piece kit. The temple has a central arched entrance, six colossal columns, robed statues in two framed niches, a rose medallion, a broken northern tower, an arcade wing and a wide stair above a paved forecourt. Every viewpoint uses this same geometry.

The kit consists of a masonry block, wall run, column shaft, base, capital, arch voussoir, ornament panel, stair flight, paving slab, rubble cluster, robed statue, shrine face, watchtower wall, stratified rock and standing stone. Source images, generated meshes, Blender outputs and meshlet hierarchies live in `~/dev/owned-assets/valley-ruins/`. The asset pipeline uses fal's Trellis 2 image-to-3D endpoint, followed by a headless Blender preparation and the existing geometry builder. `src/owned.ts` loads the resulting meshlet manifests directly through `/owned/`.

Rocks follow the ridge crest, gorge walls, mesa edge and south wall, with boulder fields below them. The fitted coastal cliff scan has been removed from the scene. Repeated kit pieces share resident geometry, with static instance transforms and source materials. `@blacksite/geometry` selects meshlets for the player camera and independently for each sun cascade. Terrain and trees contribute occluder depth to HiZ. The existing bounded technique comparisons apply to all stonework.

## Forest at every distance

One 16,384 m forest density field drives placed trees, their baked impostors and the distant terrain canopy. It includes meadow edges, wooded foothills, slopes, paths, water and POI exclusions. There is no independent canopy occupancy mask. The western meadow is spatially bounded; distant western hills remain forested.

Scots pine and birch use authored near meshes. Pine also uses its supplied middle mesh; each species bakes its own multi-angle impostor from the same source model. A stable per-instance tint multiplies the source albedo and its matching atlas. Pine forms the dark masses and birch provides pale trunks and warmer crowns.

The forest publishes one coverage descriptor containing its placement bounds, boundary fade, camera-distance fade, spacing and retained population ratio. Tree materials and terrain canopy consume complementary weights from that descriptor. This covers both the normal distance transition and the boundary of the placed-tree domain. Population limits use uniform stable ranking, so the same retention factor also scales expected canopy coverage. The canopy raises the terrain toward crown height and applies native-lit crown relief, then fades into atmospheric distance.

Ground cover uses the authored meadow grass, bunch grass, dry brome, gooseberry, nettle, dock, thistle and ivy. A bounded cache populates entering 32 m tiles; GPU compute selects visibility and mesh/impostor representations. All families use the world's shared path, water and POI exclusions. Meadow tints vary in warm gold patches; understory remains darker.

## Current rendering settings

`src/model.ts` owns device-tier settings. These are configuration, not measured performance results.

| Quantity | High | Medium | Low |
|---|---|---|---|
| Walkable extent | 4,096 × 4,096 m | same | same |
| Near heightfield samples | 2,049 × 2,049 | same | 1,025 × 1,025 |
| Far terrain and density extent | 16,384 × 16,384 m | same | same |
| Far heightfield samples | 2,049 × 2,049 | same | 1,025 × 1,025 |
| Forest density samples | 2,049 × 2,049 | same | same |
| Placed-tree extent | 6,000 × 6,000 m | same | same |
| Tree population cap | 256,000 | 192,000 | 128,000 |
| Tree mesh-to-impostor band | 48–70 m | 40–58 m | 28–42 m |
| Distance handover to canopy | 3,200–4,200 m | 2,800–3,800 m | 2,300–3,200 m |
| Placed-tree boundary handover | 500 m inside placement edge | same | same |
| Tree atlas frame size | 192 px | 160 px | 160 px |
| Ground-cover radius | 120 m | 100 m | 80 m |
| Ground-cover density multiplier | 1 | 0.8 | 0.8 |
| Sun shadow distance | 260 m | 200 m | 140 m |
| Sun cascades / map size | 2 / 2,048 px | 2 / 2,048 px | 2 / 1,024 px |
| Camera far plane | 16,000 m | same | same |

Terrain uses fixed CDLOD nodes and shared parent morphs. Near and far heightfields blend across 256 m. Foliage and stonework submit through WebGPU indirect draws. Atlas baking preserves leaf coverage through supersampling and native mip reduction.

The look uses native SunLight cascades, 63,000 lux sunlight, 16,000 lux sky fill and EV100 13; Neutral tone mapping, TRAA and the shared camera grade complete the frame. The sun is low in the northwest. Blue-grey height fog and aerial perspective separate the valley and distant hills. The current native god-rays node does not support this cascaded SunLight, so true shadowed light shafts remain unfinished.

## Eight composition sites

`src/layout.ts` stores the site positions and look targets. `world.bookmarks` resolves each player height against the final terrain. The development URL `?shot=1` through `?shot=8` chooses the initial ALS spawn pose for capture. It does not add a camera controller or movement mode. Normal entry starts at site 1; Home returns to the watchtower.

| Site | Player X/Z | Frame |
|---|---|---|
| 1 · Reveal | -1450 / 140 | Watchtower ridge toward the temple, river and aqueduct |
| 2 · Stones | -1250 / 430 | Meadow stones with the valley beyond |
| 3 · Arch | -640 / -30 | The swallowed arch under the canopy |
| 4 · Aqueduct | -170 / -960 | Broken arches and river leading south |
| 5 · Shrine | 0 / 1080 | Spring and carved face beneath the south wall |
| 6 · Bridge | 560 / -55 | Gorge crossing toward the temple |
| 7 · Temple | 960 / -90 | Paved forecourt, stair and western facade |
| 8 · Lookback | 1100 / -380 | Forest layers west toward the ridge |

## Inspection and controls

The renderer requires WebGPU. Desktop Chrome and iPhone Safari are the targets. Walking, running, jumping, crouching and rolling use the current ALS character. Touch uses the same input through a virtual stick and drag look.

The compact HUD shows drawn versus scene triangles, draw calls, culled percentage, recent frame p50/p95, tier and native GPU pass timings where timestamp queries exist. Counts describe submissions rather than pixel visibility. The single LOD view colours terrain and foliage tiers, with cluster colours on stonework.

The techniques panel controls terrain LOD, tree LOD/impostors, GPU tree culling, ground-cover culling and impostors, stone meshlet LOD, HiZ and cascade shadows. Disabled comparisons use their displayed bounded fallbacks through the same renderer.

Press **T**, or tap **Dump stats**, to POST a snapshot containing device, UA, adapter, viewport, tier, player position/view, recent frame history, GPU timings and current counters. The dev server appends JSON lines to `examples/valley/telemetry/snapshots.jsonl` and the HUD confirms the save. The dev server mounts the shared `~/dev/owned-assets/` folder at `/owned/`.

There is no benchmark route or measurement gate. Cached distant shadows, baked probes, reduced-resolution post, upscaling and remote asset streaming remain later work. The geometry renderer is currently fully resident and scans cluster-instance pairs; streaming and hierarchical instance traversal are not implemented.
