# Landscape

`@blacksite/landscape` renders open worlds on native three.js TSL node materials: CDLOD heightfield terrain with a near/far blend and a far canopy, mask-placed GPU ground cover, procedural trees with baked octahedral impostors, one shared wind field, and shadow-casting displaced geometry. The look owns sun cascades. It owns placement, LOD selection and node graphs. The game owns the heightfields, the masks, the species list, the per-tier numbers and the frame order. `@blacksite/look` owns sky, fog, exposure and post. See `README.md` for the API and `examples/valley/` for the reference wiring.

## Vocabulary

| Term | Meaning |
|---|---|
| Near and far field | Two `Heightfield`s: fine spacing over the walkable area, coarse spacing to the horizon, blended over `band` metres. `terrainHeightAt` is the CPU truth for physics and placement. |
| Surface texture | Per-field RGBA from `surfaceTexture`: normal in `.rg`, two game masks in `.b` and `.a`. Valley: `.b` forest, `.a` path. |
| Node | One CDLOD quadtree cell at a fixed world position. Vertices morph to the parent grid before the node hands over. |
| Canopy | The terrain lifted and shaded as crowns under the forest mask, from `canopy.start` to `canopy.end`. It replaces impostors at distance. |
| Family | One kind of ground cover: shape, per-patch count, TSL mask function, size, colours, bend, translucency. |
| Cover ground | The terrain's colour wherever cover grows: the blades' root colour near, their far average past the fade, from the same masks and the same reach curve, so the edge of the blades never changes colour. |
| Patch | An 8 m world-grid cell of cover. Each draws a prefix of one shared blade buffer, flipped by a seed from its cell. |
| Ring | A distance band of patches that draws a shorter prefix. Rings save cost; blades thin individually. |
| Impostor | One camera-facing quad per tree, sampled from a hemi-octahedral atlas baked from the same tree. |
| Proxy | An invisible cone or ellipsoid on `proxyLayer` that casts a tree's shadow beyond the near meshes. |
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

Run this before the look renders. SunLight cascades consume each material’s native position node; there is no material tracking pass.

## Writing a cover mask

A mask is a function from `CoverSample` to a TSL float node. The context supplies `surface` (forest mask in `.b`, path or rock mask in `.a`), `slope` (1 − normal.y), `root` (world xz), `ground` (height) and `distance`. Import `landscapeNoise(root, seed)` for the same integer noise as CPU placement. Optional `height` uses the same signature. Return 0–1 for masks; the result multiplies density. Terrain and cover evaluate the same function, so their density and ground colour remain in step.

## Tiers

Keep one object per tier in the game's model, as Valley's `tiers` does: tree count, near and far fade ranges, impostor frame size, cover distance, near radius and density, cascades, shadow distance and map size, `alphaToCoverage` and `singleFrame`. Low turns `alphaToCoverage` off (no MSAA) and `singleFrame` on. Same seeds on every tier; only counts and distances change.

## Gotchas by symptom

| Symptom | Check |
|---|---|
| A visible line where grass stops | The reach is too short: at grazing angles any fade band shorter than where blades are a pixel or two tall is a line. Raise `distance` and let `near` thin it (Valley high: 250 m, `near` 15). Otherwise the terrain was built without `cover`, so the ground past the last blades is the splat layer; pass the `Cover` to `createTerrain`. A cutout texture mipmapped without premultiplied alpha darkens far blades below the ground. Keep `fade` at or below 1. |
| Grass sparkles or crawls in a still frame | `alphaToCoverage` is on without MSAA, or off with very thin blades. Match it to the look tier's MSAA. Freeze the wind to separate motion from aliasing. |
| Cover floats or sinks on slopes | `heightAt` passed to cover is not `terrainHeightAt` on the same sources, or the terrain uniforms come from a different `TerrainSources`. Pass `terrain.uniforms`. |
| Trees pop between mesh and impostor | `near` range too narrow, or a custom material lost the dither mask. Both sides must use `landscapeDither` over the same range. |
| A ring of bright ground at the near tree edge | Shadow proxies missing: the shadow cameras need `proxyLayer` enabled (enable the layer on SunLight cascade cameras). |
| Impostors look flat or wrong-lit | The normal atlas lost `NoColorSpace`, or the custom material replaced its normal node. |
| Terrain cracks at distance | A custom vertex patch moved vertices without the morph. Preserve the position node’s grid morph. |
| `Terrain needs N levels` throws | The far field is too large for 32 m leaves and 14 levels. Raise `leafSize`. |
| Wind on CPU and GPU disagree | Two `Wind` objects, or `update` called twice per frame. Share one and update it once. |
| Captures shimmer between frames | Set `wind.frozen = true` for the capture; never in play. |

## Rules

Keep the package free of game themes, assets and React. Use native TSL material nodes so lighting, fog, shadows and the look still apply. Do not restore string shader patches or a second renderer path. Placement is deterministic from seeds and world positions; nothing may depend on the camera path. Don't add code comments.
