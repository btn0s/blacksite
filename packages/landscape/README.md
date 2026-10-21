# @blacksite/landscape

Open-world rendering for three.js: heightfield terrain with continuous LOD to the horizon, GPU ground cover, authored trees with baked octahedral impostors, one shared wind field, and cascaded sun shadows. Terrain, cover, trees and impostors use native TSL node materials with three’s `WebGPURenderer`. Lighting, fog and post belong to `@blacksite/look/webgpu`. three is a peer dependency; there are no other dependencies and no assets. `examples/valley/` is the complete reference.

## Terrain

A world has two heightfields: a near field at fine spacing over the walkable area and a far field at coarse spacing to the horizon. They blend over `band` metres.

```ts
import { createHeightfield, createTerrain, loadHeightmap, loadLayerImages, surfaceTexture, terrainHeightAt } from '@blacksite/landscape'

const near = await loadHeightmap(nearUrl, { spacing: 1, minHeight, maxHeight, origin: [-512, -512] })
const far = createHeightfield({ size: 2049, extent: 16384, origin: [-8192, -8192], sample: (x, z) => ridges(x, z) })
const sources = { near, far, nearSurface: surfaceTexture(near, masks), farSurface: surfaceTexture(far, masks), band: 200 }
const layers = await loadLayerImages([grass, soil, gravel, rock], 1024)
const terrain = createTerrain({ sources, layers, layerSpecs })
scene.add(terrain.object)
const heightAt = (x: number, z: number) => terrainHeightAt(sources, x, z)
```

- `createHeightfield({ size, extent, origin?, sample? | heights? })` builds a square grid; `loadHeightmap(url, { spacing, minHeight, maxHeight, verticalScale?, origin? })` decodes a 16-bit greyscale PNG. `heightAt`, `normalAt`, `slopeAt` and `contains` sample a field on the CPU; `terrainHeightAt(sources, x, z)` samples the near/far blend exactly as the shaders do.
- `surfaceTexture(field, masks?)` packs the terrain normal into `.rg` and two masks from `masks(x, z)` into `.b` and `.a`. Valley uses `.b` for forest and `.a` for path. Terrain splatting and cover masks read this texture. `surfaceTextureFromData(data, size)` wraps the same layout when a build step baked the bytes offline.
- `createTerrain` draws a CDLOD quadtree of fixed world-space nodes (32 m leaves, a 32 × 32 grid, ranges at 2.4× node size) with one shared instanced grid mesh and a quadrant mesh. Vertices read heights in the vertex shader and morph toward the next coarser grid near each range edge, so there are no cracks, pops or swimming. The fragment shader splats four layers by slope, the two masks and noise, with per-tile offsets against repetition; detail fades to each layer's average colour past `detailDistance` (default 260 m).
- `layerSpecs` gives each of the four layers `{ tile, tint, roughness, normalScale }`. The forest mask selects its ground material. Optional `canopy` takes `{ forest: forest.coverage, height, crown, colors, broadleaf?, dither? }`: it raises and shades the distant terrain as forest crowns. The forest owns `coverage`, which combines the final impostor fade with a band inside its placement bounds; the canopy uses the complementary weight, so hills outside placement bounds remain wooded even when closer than the normal impostor fade. Occupancy comes only from surface `.b`, populated from the same density sampler that places the forest, scaled by the actual retained population after its count limit. `crown` is crown radius and `colors` contains conifer and broadleaf linear albedos. Crown detail changes relief and colour inside the forest; it never generates a second set of clearings. Terrain physics continues to sample the actual ground.
- `cover` takes the `Cover` from `createCover`. Wherever a cover family's mask grows blades, the terrain draws the ground the way those blades look: their root colour under the near blades, brightening to their average colour seen from afar on the same distance curve the blades thin on, and kept at every distance past the blades. When the last blade goes, nothing changes colour. Create the cover first on shared uniforms: `const uniforms = terrainUniforms(sources)`, `createCover({ terrain: uniforms, … })`, then `createTerrain({ uniforms, cover, … })`.
- `terrain.update(camera)` selects nodes each frame; `terrain.uniforms` is the `TerrainUniforms` other systems (cover) share. `createTerrainNodes(terrain.uniforms)` exposes `height(root)`, `surface(root, mip)` and `normal(surface)` for node materials.

## Water

Rivers, tarns and a sea share one plan, one carve and one draw.

```ts
import { createWaterField, createWater, planWater, smoothCurve } from '@blacksite/landscape'

const layout = planWater(specs, (x, z) => groundHeight(x, z), seaLevel, sea)
const channel = createWaterField(layout)
const water = createWater({ layout, uniforms: terrain.uniforms })
scene.add(water.object)
```

- `planWater(specs, ground, seaLevel, sea?)` turns river curves (`smoothCurve` fits cubic segments through waypoints; `sampleCurves` spaces them) and tarns into a serialisable `WaterLayout`. A river's level follows the ground smoothed over `smoothing` metres, dug `dig` metres under it and never rising downstream; it stops where it reaches the sea. A river with `spill` starts at a tarn's level and is kept out of the tarn bowl, and one with `join` ends on another river's level.
- `createWaterField(layout).sample(x, z, base, rough, out)` returns the carved height for the offline bake: a channel and banks blended into the ground, with the hills faded out around it, and `shore` for the bank sand mask. `surface(x, z)` is the water level over a channel or tarn. The bake and the draw read the same layout, so the carved bed and the surface agree.
- `createWater({ layout, uniforms })` builds one mesh: the sea quad, a ribbon per river and a disc per tarn. The material is opaque so the look's aerial perspective and fog treat water as ground. Its colour fades from shallow to deep by the depth to the terrain heightfield (`createTerrainNodes`), foam follows the shoreline and the river's fall, ripples scroll along each river's flow with a two-phase blend, and they flatten with distance so the far sea is a mirror of the sky. It binds only the two height textures beside the lights, never a sampler of its own.
- `ribbonStrip(points, positions, indices)` is the shared strip builder behind the rivers.

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

### Authored ground cover

`createOwnedCover({ renderer, wind, heightAt, bounds, distance, families })` accepts loaded `FoliageModel` objects. Each family defines `{ name, model, density, scale, mask? }`: density is instances per square metre, scale is a `[min, max]` range, and `mask(x, z)` is the deterministic placement probability. Optional `lod`, `lodRange`, `range`, `meshRange`, `windStrength`, `shadowDistance` and `yOffset` control each family. Models retain their source UVs, normals, material maps and alpha coverage. Each family bakes its own source model into an impostor atlas (default 4 × 4 views at 64 pixels), with the mesh-to-impostor transition at `meshRange` (default 18–28 m).

Candidates occupy a bounded ring of world-anchored tiles (`tileSize`, default 32 m). Placement and terrain sampling run at initialization and when the walking camera crosses a tile edge; retained tiles keep their exact candidates. Every frame, the shared GPU foliage core culls candidates and builds indirect draws. Shadows use the authored mesh, with their reach bounded by the family's visible range. The returned `ground` contributes no tint unless the host supplies one, so the terrain keeps its authored surface layers.

Call `cover.update(camera)` each frame. `setCullingEnabled`, `setLodEnabled` and `setLodView` drive the shared inspection controls; disabling culling or LOD uses a spatial `fallbackDistance` (default 24 m). `stats` reports the active ring population and GPU-selected representations, and `readStats()` awaits its pending GPU counters. Disposal releases instance resources without disposing the borrowed source models.

## Forest and impostors

```ts
import { createForest, loadFoliageModel } from '@blacksite/landscape'

const pine = await loadFoliageModel('/owned/scots-pine.glb')
const pineLod = await loadFoliageModel('/owned/scots-pine-lod.glb', { materialsFrom: pine })
const forest = createForest({
  renderer, wind, heightAt,
  species: [{ model: pine, lod: pineLod, scale: [0.75, 1.3] }],
  density: (x, z) => forestMask(x, z), choose: () => 0,
  bounds: { min: [-980, -980], max: [980, 980] }, spacing: 5.2, count: 64000,
  near: [48, 70], far: [640, 940], shadowDistance: 260, frameSize: 192,
})
scene.add(forest.object)
look.onBeforeShadow((renderer, camera) => forest.prepareShadow(renderer, camera))
```

`loadFoliageModel` retains source geometry, UV channels and physical material maps, and flattens authored node transforms once. Geometry-only LOD exports can borrow materials from their original model through exact material-name matches. The host owns and disposes loaded models; forests and cover borrow them. URLs can point to externally served content without copying assets into the application.

`createForest` places trees once by `density` and `choose` on a jittered `spacing` grid. A stable rank keeps at most `count` candidates; optional `priority(x, z)` multiplies that rank, with lower values retained first. `stats.candidates` reports the population before this placement limit. Every frame, the GPU selects original mesh, authored LOD and impostor representations, rejects bound spheres outside the camera frustum, compacts transforms and writes indexed indirect draw arguments. Native node materials preserve the source alpha cutoff and physical channels through the renderer's material library. Previous positions derive from the same instance identity and previous wind time, so GPU compaction does not invent object motion.

`forest.coverage` is the shared representation contract: placement bounds, `edgeFade` (default at most 500 m), final distance range, spacing and retained density fraction. Meshes and impostors use its domain fade, and terrain canopy uses the complement of its combined domain/distance weight. With canopy, retain candidates by uniform rank; a spatial priority would need its own matching retention field rather than the global density fraction.

Species and authored cover families accept `tint: { low, high, patchSize?, individual?, seed? }`. These are RGB multipliers on authored albedo, varied by broad world-space patches and a smaller stable instance contribution. Source meshes and their atlas use the same root-based tint, so colour survives LOD transitions and GPU compaction. Original alpha, normal, roughness and other material channels remain intact.

Meshes transition to impostors over `near` and impostors disappear over `far`. An optional `lodRange` controls the original-to-authored-LOD transition before the impostor transition. `bakeImpostor(renderer, model, { frames?, frameSize?, samples? })` renders albedo and normal atlases from that same loaded model. Each view is baked at four times the tile resolution in a reusable temporary target, then copied from its area-filtered mip level into the atlas. Source alpha cutoffs are applied once before downsampling; accepted fragments write full coverage and both attachments clear to zero coverage. `createImpostorMaterial` interpolates premultiplied atlas directions and preserves their fractional coverage through native alpha hashing with temporal antialiasing, or raw alpha-to-coverage when the host uses MSAA. Shadow masks convert the same blended coverage into ordered light-pixel coverage. Optional distance blur, contact shading and far tint affect appearance without imposing a fixed cutoff on blended leaf coverage.

Call `forest.update(camera)` before the main render and `forest.prepareShadow(renderer, camera)` from each light-view callback. Shadow draws use independent GPU frustum selection against the current cascade, original meshes and authored LODs nearby, and same-model atlas silhouettes farther away. Shadow billboards face the active orthographic light view. Their distance fade uses the walking camera and `shadowDistance`; it is independent of the main-view mesh fade. Enable `proxyLayer` (default 2) on shadow cameras. `stats.proxies` retains the last light view's submitted shadow representations.

### Shared GPU foliage

`createGpuFoliage({ renderer, model, lod?, impostor?, placements, wind, range, meshRange?, lodRange?, shadowDistance? })` is the shared engine for forests and authored ground cover. `placements` is a retained `Float32Array` with eight floats per instance: position xyz, yaw, scale and three reserved floats. Scale zero marks an unused slot. To recycle a fixed-capacity world tile, update its entries and call `updatePlacements(startInstance, instanceCount)`. Visibility and LOD selection remain on the GPU.

The returned object exposes `update`, `prepareShadow`, `setLodEnabled`, `setCullingEnabled`, `setLodView`, `stats` and `dispose`. GPU counters are read asynchronously at a bounded cadence; `readStats()` awaits or starts that small readback and never gates rendering. Compute dispatch arrays remain stable and their reset, selection and draw-count passes carry human-readable names for native timestamp inspection.

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

Use `createWebGPULook` from `@blacksite/look/webgpu`, which owns a native `SunLight`, with its shadow options. The node materials share their displaced positions and alpha coverage with three’s shadow passes; enable the forest's `proxyLayer` on cascade shadow cameras and call `prepareShadow` before each light view so independently selected tree meshes and atlas silhouettes cast without appearing in the main view. The Valley wiring is the reference.

## Inspection

`terrain.setLodView(enabled)` and `forest.setLodView(enabled)` expose the common LOD colour view. `terrain.setLodEnabled(false)` expands the full-detail terrain region to 256.8 m with the default grid, retaining continuous transitions outside it and the existing 1,024-node buffer cap. `cover.setCullingEnabled(false)` submits all patches inside the existing per-tier cover distance. These fallbacks preserve bounded work.

Terrain and cover report `sceneTriangles` before frustum rejection and `drawnTriangles` submitted after it, using the current LOD and density settings. Terrain reports `candidateNodes` and `culledNodes`; cover reports candidate patches and submitted `patches`. Terrain keeps nearby nodes outside the camera frustum when they can cast a visible shadow. These are submission counts; they do not measure hidden fragments or multiply triangles by shadow/post passes.

`forest.setLodEnabled(false)` draws original meshes inside `forest.fallbackDistance`, equal to `near[1]`. Disabling GPU culling draws every selected representation inside the same spatial bound. These fallbacks are deterministic around the walking camera and never depend on GPU atomic ordering. The spatial bound applies to shadows as well. Forest `sceneTriangles` counts the current main-view representations before frustum rejection, and `drawnTriangles` counts their submitted geometry, excluding separate shadow draws. `fullDetailTriangles` is the theoretical original-mesh cost of the complete population. The bounding spheres include wind displacement; `cappedInstances` reports candidates omitted by the explicit fallback distance.

## Helpers

`hash2`, `createRandom`, `valueNoise`, `fbm`, `ridged` and `smoothstep` are the deterministic CPU noise the placement and far fields use. `decodeGrey16Png` reads 16-bit greyscale PNG heightmaps without a canvas.


Terrain layers retain the three-sample hexagonal anti-tiling filter in native TSL, with explicit texture gradients and variance-preserving blending.
