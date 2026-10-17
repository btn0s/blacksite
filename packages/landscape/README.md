# @blacksite/landscape

Open-world rendering for three.js: heightfield terrain with continuous LOD to the horizon, GPU ground cover, procedural trees with baked octahedral impostors and a far canopy, one shared wind field, and cascaded sun shadows. Everything runs on stock `MeshStandardMaterial`s patched through `onBeforeCompile`, so the scene stays lit, fogged and graded by `@blacksite/look` like any other mesh. three is a peer dependency; there are no other dependencies and no assets. `examples/valley/` is the complete reference.

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
- `layerSpecs` gives each of the four layers `{ tile, tint, roughness, normalScale }`. `canopy` (`{ height, start, end, crown, color, shade, dither? }`) lifts the terrain under the forest mask by the crown height between `start` and `end` and shades it as procedural crowns with dark gaps: the far canopy that replaces impostors. Crowns group into clumps of two, four and eight crowns as the pixel footprint grows, so the canopy keeps its texture to the horizon without shimmer. Neighbouring levels blend, or with `dither: true` one level is picked per pixel, which halves the cost on phones.
- `coverShade` (`{ distance, strength }`) darkens the grass layer within `distance` of the viewer, as blades would shade the ground beneath them, so gaps in ground cover don't read as bright patches. Pass the cover distance.
- `terrain.update(camera)` selects nodes each frame; `terrain.uniforms` is the `TerrainUniforms` other systems (cover) share. `TERRAIN_GLSL` exposes `terrainHeight(xz)`, `terrainSurface(xz)`, `terrainSurfaceLod(xz, lod)` and `terrainNormalOf(surface)` to custom shaders.

## Ground cover

```ts
import { createCover, grassTexture } from '@blacksite/landscape'

const cover = createCover({
  terrain: terrain.uniforms, wind, heightAt, sun, distance: 75, density: 1, alphaToCoverage: true,
  families: [{ name: 'grass', shape: 'clump', perPatch: 420, mask: '(1.0 - bsSurface.b) * (1.0 - smoothstep(0.3, 0.46, bsSlope))', size: [0.3, 0.6], texture: grassTexture(), colors: [a, b, c], bend: 0.42, translucency: 0.4 }],
})
scene.add(cover.object)
```

Cover is drawn in world-stable patches (`patch`, default 8 m) out to `distance` (default 75 m), in three rings that draw progressively shorter prefixes of one shared, low-discrepancy blade buffer. Each family has a `shape` (`clump`, `flower`, `card`, `pebble`), a blade count `perPatch`, a GLSL `mask` expression, a `size` range and optional `texture`, `colors`, `bend`, `translucency`, `ao`, `fade` and `roughness`. Masks can read `bsSurface`, `bsSlope`, `bsRoot` and `bsNoise(p, seed)`. Density falls blade by blade with mask and distance, so there is no visible ring. `alphaToCoverage` needs MSAA; without it blades use a 0.5 alpha test. `density` scales every family's count per tier. Call `cover.update(camera)` each frame.

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
- `createForest` places trees by `density` and `choose` on a jittered `spacing` grid, keeps the top `count` by a stable rank, and draws near trees as instanced meshes within `near[1]`, impostors from `near[0]` out to `far[1]`, and invisible shadow proxies on `proxyLayer` (default 2) out to `shadowDistance`. Near meshes and impostors crossfade with complementary screen-space dither over `near`; impostors dither out over `far`, where the terrain canopy takes over. Call `forest.update(camera)` each frame.
- `bakeImpostor(renderer, model, textures, { frames, frameSize, samples })` renders a hemi-octahedral atlas (default 8 × 8 frames of 192 px) of albedo and normal. `createImpostorMaterial({ atlas, wind, range, alphaToCoverage?, singleFrame?, tint? })` draws one quad per tree, blending four frames (or one with `singleFrame`), lit through the baked normals and softened with distance. `createForest` calls both; use them directly for other instanced objects.
- `grassTexture`, `flowerTexture`, `litterTexture`, `leafClusterTexture` and `needleClusterTexture` draw canvas textures procedurally from a seed.

## Wind

```ts
import { BREEZE, createWind } from '@blacksite/landscape'

const wind = createWind(BREEZE)
wind.update(dt)
const strength = wind.sample(x, z)
const gust = wind.gust(x, z)
```

One field for every consumer. `BREEZE` is a 0.45 base with 0.75 gusts, 38 m across, travelling at 7 m/s. `sample` and `gust` on the CPU match `windAt` and `windGustAt` in `WIND_GLSL` exactly; merge `wind.uniforms` into a shader's uniforms and prepend `NOISE_GLSL` and `WIND_GLSL` to use it. `set(partial)` retunes the field; `frozen` holds it still for captures. Cover, trees and impostors take the `wind` option and read it themselves.

## Shadows

```ts
import { configureShadowRenderer, createSunShadows } from '@blacksite/landscape'

configureShadowRenderer(renderer)
const shadows = createSunShadows({ camera, parent: scene, cascades: 3, distance: 180, mapSize: 2048 })
shadows.follow(sun)
shadows.track(scene)
shadows.update()
```

Cascaded shadow maps from three's CSM addon, fitted to `distance` with faded cascade edges. `follow(light)` copies the direction, colour and intensity of the look's sun each update; `track(root)` patches every lit material under the root (call it again when new materials appear); `setup(material)` patches one. The cascade cameras also render `proxyLayer`, so forest shadow proxies cast without being drawn.

## Shader patches

`patchMaterial(material, key, patch)` chains an `onBeforeCompile` patch onto any material and extends its program cache key, so several systems can patch the same material. `replaceChunk(source, chunk, replacement)` swaps one `#include <chunk>` and throws if it's missing. Every system in the package uses these two; use them for your own patches so they compose.

## Helpers

`hash2`, `createRandom`, `valueNoise`, `fbm`, `ridged` and `smoothstep` are the deterministic CPU noise the placement and far fields use. `decodeGrey16Png` reads 16-bit greyscale PNG heightmaps without a canvas.

`ANTI_TILING_GLSL` provides `bsTilesAt(uv, salt)` and `bsTileSample(sampler2DArray, uv, layer, tiles, mean)`: three randomly offset reads on a hexagonal grid, blended with the variance kept, so a repeating texture never shows its tile. The terrain splats use it; prepend it to any shader that tiles a texture across a large surface.
