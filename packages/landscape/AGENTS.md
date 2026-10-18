# Landscape

`@blacksite/landscape` renders open worlds on stock three.js materials: CDLOD heightfield terrain with a near/far blend and a far canopy, mask-placed GPU ground cover, procedural trees with baked octahedral impostors, one shared wind field, and cascaded sun shadows. It owns placement, LOD selection and shader patches. The game owns the heightfields, the masks, the species list, the per-tier numbers and the frame order. `@blacksite/look` owns sky, fog, exposure and post. See `README.md` for the API and `examples/valley/` for the reference wiring.

## Vocabulary

| Term | Meaning |
|---|---|
| Near and far field | Two `Heightfield`s: fine spacing over the walkable area, coarse spacing to the horizon, blended over `band` metres. `terrainHeightAt` is the CPU truth for physics and placement. |
| Surface texture | Per-field RGBA from `surfaceTexture`: normal in `.rg`, two game masks in `.b` and `.a`. Valley: `.b` forest, `.a` path. |
| Node | One CDLOD quadtree cell at a fixed world position. Vertices morph to the parent grid before the node hands over. |
| Canopy | The terrain lifted and shaded as crowns under the forest mask, from `canopy.start` to `canopy.end`. It replaces impostors at distance. |
| Family | One kind of ground cover: shape, per-patch count, GLSL mask, size, colours, bend, translucency. |
| Cover ground | The terrain's colour wherever cover grows: the blades' root colour near, their far average past the fade, from the same masks and the same reach curve, so the edge of the blades never changes colour. |
| Patch | An 8 m world-grid cell of cover. Each draws a prefix of one shared blade buffer, flipped by a seed from its cell. |
| Ring | A distance band of patches that draws a shorter prefix. Rings save cost; blades thin individually. |
| Impostor | One camera-facing quad per tree, sampled from a hemi-octahedral atlas baked from the same tree. |
| Proxy | An invisible cone or ellipsoid on `proxyLayer` that casts a tree's shadow beyond the near meshes. |
| Wind | One `Wind` from `createWind`; CPU `sample`/`gust` equal GLSL `windAt`/`windGustAt`. |

## Frame order

```ts
wind.update(dt)
camera.updateMatrixWorld()
terrain.update(camera)
cover.update(camera)
forest.update(camera)
shadows.update()
```

Run this before the look renders (Valley uses `useFrame` priority 0.5; `<Look>` renders at 1). Rerun `shadows.track(scene)` occasionally, or after adding meshes, so new materials get the cascade patch.

## Writing a cover mask

A mask is a GLSL float expression evaluated per blade in the vertex shader, and per pixel in the terrain for the cover ground. In scope: `bsSurface` (blended surface texture at the root), `bsSlope` (1 − normal.y), `bsRoot` (world xz), `bsGround` (height), `bsNoise(vec2, uint seed)`, `smoothstep` and the rest of GLSL; nothing else, since the terrain has only these. Return 0–1; the result multiplies density. Distinct masks compile distinct programs, so reuse one string per family rather than building it per frame. Give each new noise its own seed so masks don't line up with the terrain's macro variation.

## Tiers

Keep one object per tier in the game's model, as Valley's `tiers` does: tree count, near and far fade ranges, impostor frame size, cover distance, near radius and density, cascades, shadow distance and map size, `alphaToCoverage` and `singleFrame`. Low turns `alphaToCoverage` off (no MSAA) and `singleFrame` on. Same seeds on every tier; only counts and distances change.

## Gotchas by symptom

| Symptom | Check |
|---|---|
| A visible line where grass stops | The reach is too short: at grazing angles any fade band shorter than where blades are a pixel or two tall is a line. Raise `distance` and let `near` thin it (Valley high: 250 m, `near` 15). Otherwise the terrain was built without `cover`, so the ground past the last blades is the splat layer; pass the `Cover` to `createTerrain`. A cutout texture mipmapped without premultiplied alpha darkens far blades below the ground. Keep `fade` at or below 1. |
| Grass sparkles or crawls in a still frame | `alphaToCoverage` is on without MSAA, or off with very thin blades. Match it to the look tier's MSAA. Freeze the wind to separate motion from aliasing. |
| Cover floats or sinks on slopes | `heightAt` passed to cover is not `terrainHeightAt` on the same sources, or the terrain uniforms come from a different `TerrainSources`. Pass `terrain.uniforms`. |
| Trees pop between mesh and impostor | `near` range too narrow, or a custom material lost the dither discard. Both sides must use `bsDither` over the same range. |
| A ring of bright ground at the near tree edge | Shadow proxies missing: the shadow cameras need `proxyLayer` enabled (`createSunShadows` does this when its `proxyLayer` matches the forest's). |
| Impostors look flat or wrong-lit | The normal atlas lost `NoColorSpace`, or a patch replaced `normal_fragment_begin` after the impostor. Patch with `patchMaterial` so the order is stable. |
| Terrain cracks at distance | A custom vertex patch moved vertices without the morph. Keep `VERTEX_BODY` or reproduce the morph exactly. |
| `Terrain needs N levels` throws | The far field is too large for 32 m leaves and 14 levels. Raise `leafSize`. |
| A patch throws `Shader chunk … not found` | Another patch already replaced that `#include`. Patch an earlier or later chunk, or merge the two patches. |
| Wind on CPU and GPU disagree | Two `Wind` objects, or `update` called twice per frame. Share one and update it once. |
| Captures shimmer between frames | Set `wind.frozen = true` for the capture; never in play. |

## Rules

Keep the package free of game themes, assets and React. Every shader change goes through `patchMaterial` and `replaceChunk` on a stock material so lighting, fog, shadows and the look still apply. Placement is deterministic from seeds and world positions; nothing may depend on the camera path. Don't add code comments.
