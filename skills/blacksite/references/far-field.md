# Far field

How a world keeps going past the last thing you can walk to: terrain to the horizon, forests that thin into impostors and then into a canopy, and silhouettes that soften into the haze. The player never sees a representation change. They see one forest at every distance. `@blacksite/landscape` holds the building blocks; `examples/valley/` is the complete reference.

## Guides

- `packages/landscape/AGENTS.md`: the mental model, the public API and symptom fixes. Read it before wiring a terrain or a forest.
- `examples/valley/src/Landscape.tsx`: terrain, cover, forest and shadows wired together, with the per-tier numbers in `src/model.ts`.
- `atmosphere.md` for the haze that hides the horizon, `foliage.md` for the near field, `wind.md` for motion at every distance.

## The chain of representations

Every tree passes through three forms as it recedes. Each handover is a band, not a line, and each band is wide enough that nothing pops.

| Distance (Valley, high tier) | Form | Building block |
|---|---|---|
| 0–70 m | Instanced mesh: trunk, branches, leaf cards, real shadows | `createForest` near meshes from `generateTree` |
| 48–940 m | Octahedral impostor: one camera-facing quad per tree | `bakeImpostor`, `createImpostorMaterial` |
| 550 m to the horizon | Far canopy: the terrain lifted by the crown height and shaded as lumpy crowns | `createTerrain` with a `canopy` spec |

Medium pulls the bands in to 40–58 m and 560–820 m; low to 28–42 m and 440–660 m. Keep the numbers in `src/game/model.ts` with the tier, never inline.

## Impostors

- **Bake from the same tree.** `bakeImpostor(renderer, model, textures, { frames, frameSize })` renders the procedural model from a hemi-octahedral grid of view directions into an albedo and a normal atlas: 8 × 8 frames of 192 px on high, 160 on medium, 128 on low. An impostor painted separately from its mesh never matches its silhouette, and the swap reads as a different tree. All three Valley species bake in about 230 ms while the scene loads.
- **Blend four frames, not one.** The impostor picks the frames nearest the view direction and blends them bilinearly, so the tree turns smoothly as you walk round it. `singleFrame` snaps to the nearest frame; use it on the low tier only.
- **Light the impostor.** The normal atlas is rotated by each tree's yaw and lit by the scene, so a far crown has a sunlit side and a shaded side that match the near mesh. A flat-shaded billboard reads as a cut-out.
- **Smudge the distance.** Past the near band the impostor biases its mip and widens its coverage edge with distance, so far crowns soften the way they do through air instead of aliasing into sparkle. A crisp silhouette at 800 m reads as a model; a soft one reads as a forest.

## Crossfades

- **Dither, never alpha-blend.** The near mesh discards pixels where a screen-space dither falls below its fade; the impostor discards where the same dither falls above its fade-in. The two masks are complementary, so in the band every pixel belongs to exactly one form: no double-bright overlap, no hole, and no sorting. Use the shared `bsDither` and the same range for both sides.
- **Fade by root distance.** Both sides measure from the tree's root, not the pixel, so a tall tree crossfades as one object.
- **Hand the far end to the canopy early.** The canopy starts rising about 90 m before the impostors begin to fade (`canopy.lead` in the Valley model), so by the time a tree has dithered out the ground under it is already shaded as crown.
- **Keep shadows through the swap.** Near meshes cast their own shadows. Beyond them, an invisible proxy (a cone for conifers, an ellipsoid for broadleaf) on a layer only the shadow cameras render casts the tree's shadow out to the shadow distance. Without it, shadows vanish at the mesh band and the ground brightens in a ring.

## Terrain to the horizon

- **One continuous LOD, no cracks.** `createTerrain` draws a quadtree of fixed world-space nodes with one shared grid mesh (CDLOD). Each vertex morphs toward the next coarser grid as its distance approaches the node's range edge, so at the boundary a fine node's vertices already sit where its parent's do. That removes the T-junction cracks of a plain chunked LOD without skirts or stitching strips.
- **No swimming.** Nodes sit at fixed world positions and the morph depends only on distance, so heights never slide under a moving camera. A grid that follows the camera in steps shimmers on every ridge line.
- **Heights in the vertex shader.** Every vertex reads the heightfield texture at its own world position with a shared bilinear fetch, so adjacent nodes, cover, trees and the CPU `heightAt` agree on the ground to the centimetre.
- **Near and far fields.** A near heightfield at 1 m spacing covers the walkable square; a far field at 8 m spacing runs to the horizon. They blend over a 200 m band (`TerrainSources.band`), so the edge of the playable area has no step. Build both with `createHeightfield` or `loadHeightmap`; `terrainHeightAt` samples the blend on the CPU for physics and placement.
- **Detail fades, macro stays.** Splat layers fade to their average colour past `detailDistance` (260 m high, 140 m low), while low-frequency macro variation keeps the far slopes from going flat.
- **No visible tiling.** The splat layers sample through `ANTI_TILING_GLSL`: each layer is read at three randomly offset tiles on a hexagonal grid and blended with the variance kept, so a 3 m texture never shows its repeat across a 1 km slope. Any repeating texture on a large surface wants the same treatment.
- **Normals in full precision for lighting.** An 8-bit normal on a gentle slope bands into contour stripes under a low sun. The terrain lights from the heightfield's own normal and passes the true slope normal to shadow sampling, so a slope neither stripes nor acnes.

## Standard use

```ts
const terrain = createTerrain({ sources, layers, layerSpecs, canopy: { height: 13, start, end, crown: 8.5, color, shade }, detailDistance: 260 })
const forest = createForest({ renderer, wind, species, density, choose, heightAt, bounds, spacing: 5.2, count: 64000, near: [48, 70], far: [640, 940], shadowDistance: 180, frameSize: 192, alphaToCoverage: true })
scene.add(terrain.object, forest.object)
```

Each frame, after the camera moves: `terrain.update(camera)` then `forest.update(camera)`. Both cull by frustum and distance on the CPU and write instance data once; the shaders do the rest.

## What isn't there yet

- Impostors bake at load time, not at build time. A build-time bake with a cached atlas is planned.
- Terrain is one near and one far heightfield; there is no streaming of tiles beyond them.
- No impostor path for rocks or props; only trees.

## Rules

- **Every handover is a band, and both sides of it draw.** A fade on one side with a cut on the other leaves a ring you can see from the next hill.
- **Bake from the shipped geometry.** If the tree changes, rebake; never hand-edit an atlas.
- **The horizon is fog, not a far plane.** Set the camera far beyond the last terrain node and let the atmosphere swallow it (`atmosphere.md`).
- **Judge it in motion.** Walk and fly through every band, put the route in the check contract's `flyover` poses, run `blacksite check --only flyover,shimmer,pop,critic` and read the flyover sheet frame by frame (`verify.md`); a still capture hides pops and shimmer.
