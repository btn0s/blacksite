# Landscape

`@blacksite/landscape` renders open worlds on native three.js TSL node materials: CDLOD heightfield terrain with a near/far blend, mask-placed GPU ground cover, authored foliage with baked octahedral impostors, one shared wind field, and shadow-casting displaced geometry. The look owns sun cascades. It owns placement, LOD selection and node graphs. The game owns the heightfields, the masks, the species list, the per-tier numbers and the frame order. `@blacksite/look` owns sky, fog, exposure and post. See `README.md` for the API and `examples/valley/` for the reference wiring.

## Vocabulary

| Term | Meaning |
|---|---|
| Near and far field | Two `Heightfield`s: fine spacing over the walkable area, coarse spacing to the horizon, blended over `band` metres. `terrainHeightAt` is the CPU truth for physics and placement. |
| Surface texture | Per-field RGBA from `surfaceTexture`: normal in `.rg`, two game masks in `.b` and `.a`. Valley: `.b` forest, `.a` path. |
| Node | One CDLOD quadtree cell at a fixed world position. Vertices morph to the parent grid before the node hands over. |
| Family | One authored cover model with density, scale, terrain placement mask and distance ranges; procedural cover also accepts blade shape and a shared TSL mask. |
| Cover ground | The terrain's colour wherever cover grows: the blades' root colour near, their far average past the fade, from the same masks and the same reach curve, so the edge of the blades never changes colour. |
| Tile | A world-anchored cell in the authored-cover cache. Crossing a cell edge recycles only entering tiles; visibility remains on the GPU. |
| Patch | A world-grid cell of procedural cover. Each draws a prefix of one shared blade buffer, flipped by a seed from its cell. |
| Ring | A distance band of patches that draws a shorter prefix. Rings save cost; blades thin individually. |
| Impostor | One quad per foliage instance, sampled from a hemi-octahedral atlas baked from its original model. The main view faces the walking camera; the shadow view faces the active orthographic light. |
| Canopy | Optional raised terrain beyond tree impostors. It reads the same forest density from surface `.b` and uses the exact impostor fade band; crown detail cannot invent a separate forest distribution. |
| Shadow lane | A separate GPU-compacted representation set on `proxyLayer`, selected against the active cascade frustum. It uses authored meshes nearby and same-model atlas silhouettes farther away. |
| Wind | One `Wind` from `createWind`; CPU `sample`/`gust` equal `createWindNodes(wind).sample`/`.gust`. |

## Frame order

```ts
wind.update(dt)
camera.updateMatrixWorld()
terrain.update(camera)
cover.update(camera)
forest.update(camera)
look.render(dt)
```

Run this before the look renders. Register `look.onBeforeShadow((renderer, camera) => { forest.prepareShadow(renderer, camera); cover.prepareShadow(renderer, camera) })` for authored foliage. SunLight updates each cascade camera before this hook; the GPU prepares its independent draw set before that shadow pass. Native displaced positions and alpha coverage carry into shadows.

## Writing a cover mask

Authored cover uses `mask(x, z)` during deterministic world-tile placement and samples `heightAt` once per candidate. Scale-zero slots remain inactive; CPU placement never performs per-frame visibility selection. The host may supply `ground` separately to control the terrain surface under these models.

Procedural cover uses a shared TSL mask. A mask is a function from `CoverSample` to a TSL float node. The context supplies `surface` (forest mask in `.b`, path or rock mask in `.a`), `slope` (1 − normal.y), `root` (world xz), `ground` (height) and `distance`. Import `landscapeNoise(root, seed)` for the same integer noise as CPU placement. Optional `height` uses the same signature. Return 0–1 for masks; the result multiplies density. Terrain and cover evaluate the same function, so their density and ground colour remain in step.

## Tiers

Keep one object per tier in the game's model, as Valley's `tiers` does: tree count, near and far fade ranges, impostor frame size, cover distance, near radius and density, cascades, shadow distance and map size, `alphaToCoverage` and `singleFrame`. Low turns `alphaToCoverage` off (no MSAA) and `singleFrame` on. Same seeds on every tier; only counts and distances change.

## Gotchas by symptom

| Symptom | Check |
|---|---|
| A visible line where grass stops | Match the authored cover's mesh-to-atlas transition and final fade to its visible size and terrain ground colour. For procedural cover, pass its shared `ground` function into terrain and retain area while thinning. |
| Grass sparkles or crawls in a still frame | `alphaToCoverage` is on without MSAA, or off with very thin blades. Match it to the look tier's MSAA. Freeze the wind to separate motion from aliasing. |
| Cover floats or sinks on slopes | `heightAt` must sample the same `TerrainSources` as terrain. Authored cover applies each model's original vertical bounds when placing its roots. |
| Trees pop between mesh and impostor | `near` range too narrow, or a custom material lost the dither mask. Both sides must use `landscapeDither` over the same range. |
| A ring of bright ground at the near tree edge | Shadow cameras need `proxyLayer` enabled and each cascade must invoke `prepareShadow`. Shadow fades use `shadowDistance`, independent of the main-view mesh transition. |
| Opaque rectangles around foliage | Preserve the original physical material through `renderer.library.fromMaterial(source.clone())`. Node-material `copy` skips private-backed properties such as the inherited alpha-test accessor. Never infer alpha from RGB. |
| Atlas crowns lose leaves before view blending | Bake each view at 4× tile resolution with the authored cutoff, write accepted fragments at full coverage, then use native mip area reduction. Clear albedo and normal alpha to 0. Direct low-resolution cutout baking discards small leaves before their coverage can be preserved. |
| Impostor crowns erode while turning | Blended atlas alpha represents fractional coverage, not another cutout texture. Feed it to native alpha hashing or raw alpha-to-coverage; a fixed cutoff after view blending removes leaves that differ between views. Shadow masks must preserve the same expected area. |
| Impostors look flat or wrong-lit | The normal atlas lost `NoColorSpace`, or the custom material replaced its normal node. |
| GPU counters show distant foliage but no geometry appears | TSL expressions reused across conditional branches can first emit their cached values inside one branch. Materialize shared placement matrices with `.toVar()` in the parent flow before frustum and LOD branches; otherwise far-only instances can reuse uninitialized near-branch values. |
| Terrain cracks at distance | A custom vertex patch moved vertices without the morph. Preserve the position node’s grid morph. |
| `Terrain needs N levels` throws | The far field is too large for 32 m leaves and 14 levels. Raise `leafSize`. |
| Wind on CPU and GPU disagree | Two `Wind` objects, or `update` called twice per frame. Share one and update it once. |
| Captures shimmer between frames | Set `wind.frozen = true` for the capture; never in play. |

## GPU foliage inspection

Original meshes are green, authored mesh LOD is amber, and impostors are blue in the common LOD view. Disabling culling or LOD applies an explicit `fallbackDistance` around the walking camera; never truncate an atomic append stream to select the first instances. Main-view scene triangles count the chosen representation before frustum rejection, drawn triangles count its submission, and shadow-only geometry is reported separately. Readbacks are asynchronous and cannot gate draws.

## Rules

One continuous forest density drives placed trees, same-model impostors and optional distant raised terrain canopy. Share that density through terrain surface `.b`; never invent an independent canopy mask that disagrees with tree clearings. Use the same impostor fade band for canopy height and colour. Physics continues to sample the actual ground heightfield. Keep the package free of game themes, assets and React. Use native TSL material nodes so lighting, fog, shadows and the look still apply. Do not restore string shader patches or a second renderer path. Placement is deterministic from seeds and world positions; nothing may depend on the camera path. Don't add code comments.
