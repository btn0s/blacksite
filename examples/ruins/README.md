# Dark Ruins

The whole-level preview uses the same paged geometry renderer, look and ALS character as the courtyard. Open `?level=full&view=walk`; the courtyard remains the default. Wide, Close and Walk use the courtyard's bookmarks so performance comparisons retain the same cameras. All 20,430 exported placement records enter the shared runtime; invisible placements and explicitly excluded FX surfaces retain non-rendering material slots.

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

The inspector exposes paging epochs, requests, fallbacks, retirement safety, texture residency, collision insertions and byte reservations. T saves telemetry. See [the streaming design](../../../docs/streaming.md) and [the original resident-limit investigation](REPORT.md) for historical context.
