# Dark Ruins

The default URL opens the complete level at Spawn with the ALS shoulder-camera walker. All 20,430 exported placement records enter one paged geometry runtime; invisible placements and explicitly excluded FX surfaces retain non-rendering material slots.

The player is a Last Light survivor, served from `/owned/last-light-characters/` and never committed. `src/survivor.ts` poses its mesh onto the ALS skeleton once at load: both rigs share the 61 deform bones, so it fits each bone to the ALS joint position, aim and segment scale, then binds the result to the ALS skeleton and its animations. The ALS files are untouched. To change survivor, edit `SURVIVOR_URL`.

The sky, fog, sun and post settings come from `environment.json` through `examples/shared/scan-environment.ts`. The sky takes the export's Rayleigh, Mie scattering and absorption, ozone and ground albedo; the sun is the directional light's lux, source angle and ground-level atmospheric transmittance. Height fog is a medium with the export's extinction, scale height, albedo and phase; its in-scattering colour is empty, so it carries only the sun and sky light it scatters. The unbound post process volume supplies histogram auto exposure (EV100 1.5 to 14), white balance, colour correction and the filmic tone curve. Local post process volumes, local fog volumes and the 818 local lights are not translated.

The sun's colour is the atmosphere's transmittance toward it, integrated with 48 quadratically spaced steps from the viewer's altitude. Height fog extinction is the authored density times ln 2, because the engine's fog integral is a base-2 exponent. The export's fog is almost height-independent (a 14 km scale height) over a heavy Mie haze, so low-ground mist comes from the Look folder's fog height, not the translation.

The mood sits on top of the translation in `src/look.json`: a heavy low cloud deck, a cooler and less saturated palette with warm bright lights kept, sun shafts, a soft bloom, light grain, a slight vignette and a touch of chromatic aberration, plus a cool rim on the survivor. The Debug panel's Look folder (collapsed) tunes all of it live; Save look writes the values to `artifacts/archway/looks/latest.json` on the dev server and logs them to the browser console. Copy the file over `src/look.json` to make a setting the default. The Rendering folder switches shafts, bloom, chromatic aberration and clouds for cost comparison.

The five views are `overview`, `spawn`, `archway`, `pits` and `cliffs`, selected with `?view=` or the view buttons. Overview frames the full bounds of visible geometry with authored surfaces. Archway frames the largest placed arch, Pits frames both pit meshes, and Cliffs frames the largest coastal cliff carrying a beach surface. Each landmark uses the source bounds transformed by the complete placement matrix. Camera clipping distances follow the whole-level bounds. The export contains no player-start record, so Spawn uses the main arch base as its entrance; R and the Spawn button restore that position. The HUD separates unique source triangles, the finest retained triangles after the 5 mm geometry cap, and selected/drawn instance triangles.

The runtime reads `/owned/dark-ruins/full.json`. This version 5 manifest references the immutable whole-level placement directory, 371 geometry directories, complete version 2 material descriptors, environment and regional collision directory. Owned content stays outside Git. ALS remains in its existing package.

Build geometry into a new owned directory from a Visual Studio developer command prompt:

```powershell
node --max-old-space-size=16384 examples/ruins/scripts/build.mjs D:/Archive/dark-ruins-export D:/dev/owned-assets/dark-ruins/build-pages-NEW 0.005
```

The compiler preserves component-local geometry, authoritative column-major placement matrices, authored vertex attributes and primitive material mappings. The world error cap is divided by each geometry's largest conservative placement scale, including shear. It writes the [version 5 page contract](../../../packages/geometry/scripts/README.md#page-format-version-5), page hashes, census and complete material-use inventory.

Use the complete immutable material bake, including translated surfaces and explicit FX exclusions, to cook collision and assemble the playable manifest:

```powershell
node --max-old-space-size=8192 examples/ruins/scripts/build-collision.mjs D:/dev/owned-assets/dark-ruins/build-pages-NEW D:/dev/owned-assets/dark-ruins/build-playable-NEW D:/dev/owned-assets/dark-ruins/build-materials-COMPLETE/surfaces.json
node examples/ruins/scripts/build-playable.mjs D:/dev/owned-assets/dark-ruins D:/dev/owned-assets/dark-ruins/build-pages-NEW D:/dev/owned-assets/dark-ruins/build-playable-NEW D:/dev/owned-assets/dark-ruins/build-materials-COMPLETE
```

Collision uses 32 m index regions and 8 m spatial chunks with at most 4,096 triangles. A 0.375 m world-space hierarchy cut and at most 0.375 m additional simplification share the 0.75 m error allowance. Transformed triangles have unique ownership, mirrored placements reverse winding, and actual chunk bounds index every crossed region. Excluded surfaces contribute no collision. Four workers fetch and verify bounded chunks; the runtime inserts standalone static colliders between physics steps. Critical movement tiles, a prefetch ring and trailing retention share a separate 128 MiB conservative native/staging reservation. Resident boundary planes hold movement until neighboring collision is ready. Destination collision becomes ready before a teleport activates.

Bootstrap awaits directories, minimum texture tails, pinned coarse geometry, spawn collision, ALS and compilation of every cluster material under the actual depth, lit and shadow states. Materials share one TSL graph per authored family. Scalars, colours, tiling, channels and switches live in one read-only storage buffer addressed by each cluster's material id. Textures bind per material through object references. All passes finish before readiness; the renderer owns shared compilation caching and binding initialization. GPU geometry and texture residency share the 2,560 MiB ledger; geometry occupies a fixed 1,280 MiB arena. Missing detail retains the resident coarse cut. Material bitsets independently restrict depth/lit submission and the active shadow cascade. The remaining r186 compilation/residency boundary and benchmark evidence are recorded in [the whole-level report](../../../docs/streaming-full.md#material-family-handoff).

Merge the loader before publishing its owned manifest. Only then atomically copy the new build's `full.json` to the owned root and verify the real preview. Never overwrite an existing immutable build or repoint a published manifest ahead of its reader. Persistent servers and offline builds on this host run as interactive scheduled tasks. Leave other preview ports untouched.

## Landscape

The level stands on the upper rim of a big valley: a mountain horseshoe open to the north, with the sea beyond. The terrain comes from `@blacksite/landscape`: a 4 km near field at 2 m and a 16 km far field at 8 m, drawn by the CDLOD terrain with the level's sun, sky, fog and exposure. The terrain loads with the level: its fields and layer textures download alongside the level's directories, and its pipelines compile in the same warm-up, so it is drawn from the first playable frame (`ruins-first-playable`). Physics gets a heightfield collider from the same near field in `TerrainCollision`, next to the regional collision and independent of its residency.

North is world -Z and east is +X. The level's west and south sides are its front, facing the valley; its east side is its back. From the front rim the ground falls 250 m or more down a rocky mountainside that eases into a grassy, hilly valley floor about 2.3 km across (x about -3300 to -1000). A ring of mountains wraps from the east, behind the ruins, through the south to the far west, where the crests stand 5 to 6 km from the level and rise to about 450 to 800 m, 700 m or more above the floor. The valley floor slopes north to a sand coast near z -1480 at sea level y = -300, and the sea fills the whole north, shelving to about -480 m at the far field's edge. The near field covers x -3298 to 798 and z -1698 to 2398, so the walkable world runs from the level's east back, down the front slope, across the valley floor to its far-west foot, and north to the shallows. Ocean water is not translated: the sea is a sand-covered seabed with no water plane.

The shape is baked offline. `scripts/build-landscape.mjs` rasterizes the cooked collision into a 2 m map of each cell's lowest surface and its lowest upward-facing surface. The terrain buries the level's foot and never sits under it. Each cell's ground is 1 m above the lowest surface, and it stays under the lowest upward-facing surface (0.25 m under walkable floors, 1 m under steep rock) everywhere except a rim 2 to 8 m wide, where it rises 1 m over that surface too, so the level's edges sink into the ground. No cell's ground drops more than 0.8 m per metre below a neighbouring foot, so a high foot is never left hanging over a low one. Outside the footprint the ground follows the coarse landform in `scripts/landscape-shape.mjs`, but no lower than that fall from the foot and no higher than a 0.5 m per metre rise from it, and it hands back to the landform between 200 and 300 m. That landform measures distance outward from the valley floor: a concave front slope, a rolling shelf behind the ruins, and a ring crest with Gaussian profile whose height follows ridged noise. Crags and valley hills fade in with distance from the footprint. The bake also writes `edge.bin`, the signed distance to the level's edge in metres, which the shaders read.

The terrain side darkens and cools toward the level's rocky tone near the footprint (`landscapeFootprint`). The level materials don't blend into the terrain yet: `createGroundBlend` in `@blacksite/landscape` is unhooked until the terrain overlaps the level's foot.

The spawn stands on a lookout on the level's south-west edge, picked from the ground map, looking west over the valley.

Ground layers are the level's own Rocky Soil Ground, Dry Sandy Mud and Massive Nordic Coastal Cliff surfaces (transcoded to 1024 px WebP) plus the world kit's CC0 grass. Soil and sand masks are baked into the surface texture; rock follows slope.

```powershell
node examples/ruins/scripts/build-landscape.mjs D:/dev/owned-assets/dark-ruins/build-collision-provenance-20261020-01 D:/dev/owned-assets/dark-ruins/build-materials-flames-20261020-01 D:/dev/owned-assets/dark-ruins/build-landscape-NEW
```

Point `root` in `src/landscape-asset.ts` at the new directory. The manifest is version 2 (edge map and layer averages). The script needs Node 22.18 or newer to read the package's noise from TypeScript.

The inspector exposes paging epochs, requests, fallbacks, retirement safety, texture residency, collision insertions and byte reservations. T saves telemetry. See [the streaming design](../../../docs/streaming.md) and [the original resident-limit investigation](REPORT.md) for historical context.
