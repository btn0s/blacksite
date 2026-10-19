# @blacksite/landscape

Open-world rendering for three.js: heightfield terrain with continuous LOD to the horizon, GPU ground cover, procedural trees with baked octahedral impostors and a far canopy, one shared wind field, and cascaded sun shadows. Terrain, cover, trees and impostors use native TSL node materials with three’s `WebGPURenderer`. Lighting, fog and post belong to `@blacksite/look/webgpu`. three is a peer dependency; there are no other dependencies and no assets. `examples/valley/` is the complete reference.

## Terrain

A world has two heightfields: a near field at fine spacing over the walkable area and a far field at coarse spacing to the horizon. They blend over `band` metres.

```ts
import { createHeightfield, createTerrain, loadHeightmap, loadLayerImages, surfaceTexture, terrainHeightAt } from '@blacksite/landscape'

const near = await loadHeightmap(nearUrl, { spacing: 1, minHeight, maxHeight, origin: [-512, -512] })
const far = createHeightfield({ size: 2049, extent: 16384, origin: [-8192, -8192], sample: (x, z) => ridges(x, z) })
const sources = { near, far, nearSurface: surfaceTexture(near, masks), farSurface: surfaceTexture(far, masks), band: 200 }
const layers = await loadLayerImages([grass, soil, gravel, rock], 1024)
const terrain = createTerrain({ sources, layers, layerSpecs, canopy })
scene.add(terrain.object)
const heightAt = (x: number, z: number) => terrainHeightAt(sources, x, z)
```

- `createHeightfield({ size, extent, origin?, sample? | heights? })` builds a square grid; `loadHeightmap(url, { spacing, minHeight, maxHeight, verticalScale?, origin? })` decodes a 16-bit greyscale PNG. `heightAt`, `normalAt`, `slopeAt` and `contains` sample a field on the CPU; `terrainHeightAt(sources, x, z)` samples the near/far blend exactly as the shaders do.
- `surfaceTexture(field, masks?)` packs the terrain normal into `.rg` and two masks from `masks(x, z)` into `.b` and `.a`. Valley uses `.b` for forest and `.a` for path. Terrain splatting, the far canopy and cover masks all read this texture.
- `createTerrain` draws a CDLOD quadtree of fixed world-space nodes (32 m leaves, a 32 × 32 grid, ranges at 2.4× node size) with one shared instanced grid mesh and a quadrant mesh. Vertices read heights in the vertex shader and morph toward the next coarser grid near each range edge, so there are no cracks, pops or swimming. The fragment shader splats four layers by slope, the two masks and noise, with per-tile offsets against repetition; detail fades to each layer's average colour past `detailDistance` (default 260 m).
- `layerSpecs` gives each of the four layers `{ tile, tint, roughness, normalScale }`. `canopy` (`{ height, start, end, crown, color, shade, dither? }`) lifts the terrain under the forest mask by the crown height between `start` and `end` and shades it as procedural crowns with dark gaps: the far canopy that replaces impostors. Each crown is a sphere seen from the camera: its footprint stretches along the view direction by the grazing angle against the slope, so crowns stay round on screen instead of flattening into scales; nearer crowns overlap farther ones; and the side facing away from the sun and the gaps between crowns go dark. On steep slopes facing the camera the stretch is clamped against the geometric normal, so rising canopy keeps round crowns instead of vertical smears. Low-frequency noise breaks up the canopy into darker, cooler stands, lighter, warmer patches and areas of larger or smaller crowns, and the canopy darkens slightly toward `start` to match the impostors it replaces. Crowns group into clumps of two, four and eight crowns as the pixel footprint grows, so the canopy keeps its texture to the horizon without shimmer. Neighbouring levels blend, or with `dither: true` one level is picked per pixel, which halves the cost on phones.
- `cover` takes the `Cover` from `createCover`. Wherever a cover family's mask grows blades, the terrain draws the ground the way those blades look: their root colour under the near blades, brightening to their average colour seen from afar on the same distance curve the blades thin on, and kept at every distance past the blades. When the last blade goes, nothing changes colour. Create the cover first on shared uniforms: `const uniforms = terrainUniforms(sources)`, `createCover({ terrain: uniforms, … })`, then `createTerrain({ uniforms, cover, … })`.
- `terrain.update(camera)` selects nodes each frame; `terrain.uniforms` is the `TerrainUniforms` other systems (cover) share. `createTerrainNodes(terrain.uniforms)` exposes `height(root)`, `surface(root, mip)` and `normal(surface)` for node materials. Call `terrain.setSunDirection(direction)` with the same world-space sun direction as the look.

## Ground cover

```ts
import { createCover, grassTexture } from '@blacksite/landscape'
import { float, smoothstep } from 'three/tsl'

const cover = createCover({
  terrain: terrain.uniforms, wind, heightAt, sun, distance: 75, density: 1, alphaToCoverage: true,
  families: [{ name: 'grass', shape: 'clump', perPatch: 420, mask: ({ surface, slope }) => float(1).sub(surface.b).mul(float(1).sub(smoothstep(0.3, 0.46, slope))), size: [0.3, 0.6], texture: grassTexture(), colors: [a, b, c], bend: 0.42, translucency: 0.4 }],
})
scene.add(cover.object)
```

Cover is drawn in world-stable patches (`patch`, default 8 m) out to `distance` (default 75 m), in rings growing ×1.4 from `near` (default 15 m) that draw progressively shorter prefixes of one shared, low-discrepancy blade buffer. Each family has a `shape` (`clump`, `flower`, `card`, `pebble`), a blade count `perPatch`, a TSL `mask` function, a `size` range and optional `height` (a TSL function that scales blade height, such as a low-frequency noise for short and tall patches), `texture`, `colors`, `bend`, `translucency`, `ao`, `fade` and `roughness`. Both functions receive a `CoverSample` with node values `surface`, `slope`, `root`, `ground` and `distance`; `landscapeNoise(root, seed)` supplies deterministic noise. The terrain calls the same function for the ground under the cover. Past `near`, a family keeps `near / d` of its blades and widens the survivors by `d / near`, so blade area per square metre and on-screen blade width stay constant; each family ends over the last quarter of its own reach, `fade` × `distance`. Blades a few pixels tall take their family's average colour, the same one the ground draws. Premultiplied textures (`premultiplyAlpha`, as the canvas textures here are) are divided by alpha after sampling so their mips stay true. `cover.ground(sample)` returns the TSL colour and coverage node the terrain uses: each family's texture averaged by alpha with its `ao` gradient up the blade, mixed by the same patch-tone noise as the blades and weighted by mask × blade area per square metre. Blades are lit with the soft upward normal on both faces, so back faces are not dark; `ao` is the brightness at the blade base. `alphaToCoverage` needs MSAA; without it blades use a 0.5 alpha test. `density` scales every family's count per tier. Call `cover.update(camera)` each frame.

## Forest and impostors

```ts
import { BIRCH, OAK, PINE, createForest, generateTree, leafClusterTexture, needleClusterTexture } from '@blacksite/landscape'

const forest = createForest({
  renderer, wind, heightAt, sun,
  species: [{ model: generateTree(PINE), textures: { bark, barkNormal, leaf: needleClusterTexture() }, scale: [0.75, 1.3] }],
  density: (x, z) => forestMask(x, z), choose: (x, z, random) => 0,
  bounds: { min: [-980, -980], max: [980, 980] }, spacing: 5.2, count: 64000,
  near: [48, 70], far: [640, 940], shadowDistance: 180, frameSize: 192, alphaToCoverage: true,
})
scene.add(forest.object)
```

- `generateTree(species)` builds trunk, branch and leaf-card geometry with a `treeWind` attribute. `OAK`, `PINE` and `BIRCH` are the starting species (`TreeSpecies`: form, height, trunk, crown, leaf size and count, bark and leaf tints, seed).
- `createForest` places trees by `density` and `choose` on a jittered `spacing` grid, keeps the top `count` by a stable rank, which an optional `priority(x, z)` multiplies so lower values are kept first (Valley keeps the forest round the playable area whole and thins it far away), reports `stats.candidates` before the cap, and draws near trees as instanced meshes within `near[1]`, impostors from `near[0]` out to `far[1]`, and invisible shadow proxies on `proxyLayer` (default 2) out to `shadowDistance`. Near meshes and impostors crossfade with complementary screen-space dither over `near`; impostors dither out over `far`, where the terrain canopy takes over. Call `forest.update(camera)` each frame.
- `bakeImpostor(renderer, model, textures, { frames, frameSize, samples })` renders a hemi-octahedral atlas (default 8 × 8 frames of 192 px) of albedo and normal. `createImpostorMaterial({ atlas, wind, range, alphaToCoverage?, singleFrame?, tint? })` draws one quad per tree, blending four frames (or one with `singleFrame`), lit through the baked normals blended with a sphere normal round the crown, so each crown is lit on the sun side and shadowed underneath, with contact darkening toward its base (`contact`, default 1), and softened with distance by a mip bias (`blur`, default 1.25; `createForest` takes it as `impostorBlur`), and tinted toward `farTint` (default white; `createForest` takes it as `impostorFarTint`) as they fade, so their colour meets the terrain canopy across the hand-off band. `createForest` calls both; use them directly for other instanced objects.
- `grassTexture`, `flowerTexture`, `litterTexture`, `leafClusterTexture` and `needleClusterTexture` draw canvas textures procedurally from a seed.

## Wind

```ts
import { BREEZE, createWind } from '@blacksite/landscape'

const wind = createWind(BREEZE)
wind.update(dt)
const strength = wind.sample(x, z)
const gust = wind.gust(x, z)
```

One field for every consumer. `BREEZE` is a 0.45 base with 0.75 gusts, 38 m across, travelling at 7 m/s. `createWindNodes(wind)` exposes `sample(root)` and `gust(root)`, plus `direction`, `params` and `time` uniform nodes. Its integer noise and equations match the CPU field. `set(partial)` retunes the field; `frozen` holds it still for captures. Cover, trees and impostors take the `wind` option and read it themselves.

## Shadows

Use `createWebGPULook` from `@blacksite/look/webgpu`, which owns a native `SunLight`, with its shadow options. The node materials share their displaced positions and alpha coverage with three’s shadow passes; enable the forest's `proxyLayer` on the cascade shadow cameras so distant tree proxies cast without appearing in the main view. The Valley wiring is the reference.

## Inspection

`terrain.setLodView(enabled)` and `forest.setLodView(enabled)` expose the common LOD colour view. `terrain.setLodEnabled(false)` expands the full-detail terrain region to 256.8 m with the default grid, retaining continuous transitions outside it and the existing 1,024-node buffer cap. `cover.setCullingEnabled(false)` submits all patches inside the existing per-tier cover distance. These fallbacks preserve bounded work.

Terrain and cover report `sceneTriangles` before frustum rejection and `drawnTriangles` submitted after it, using the current LOD and density settings. Terrain reports `candidateNodes` and `culledNodes`; cover reports candidate patches and submitted `patches`. Terrain keeps nearby nodes outside the camera frustum when they can cast a visible shadow. These are submission counts; they do not measure hidden fragments or multiply triangles by shadow/post passes.

`forest.setLodEnabled(false)` draws the nearest `forest.fallbackCap` trees (256) as full meshes, hides impostors and stops proxies outside the cap; the terrain canopy continues at its existing distance. Forest `sceneTriangles` counts the chosen main-view representations before impostor frustum rejection, and `drawnTriangles` counts submitted near meshes and retained cards, excluding shadow-only proxies. `fullDetailTriangles` is the theoretical full-mesh cost of the complete population. Impostor culling uses model spheres expanded for wind.

## Helpers

`hash2`, `createRandom`, `valueNoise`, `fbm`, `ridged` and `smoothstep` are the deterministic CPU noise the placement and far fields use. `decodeGrey16Png` reads 16-bit greyscale PNG heightmaps without a canvas.


Terrain layers retain the three-sample hexagonal anti-tiling filter in native TSL, with explicit texture gradients and variance-preserving blending.
