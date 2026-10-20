# Dark Ruins

Status: blocked before full-level playback. The uncompressed 3 cm build exceeded Chrome's storage-buffer binding limit before all referenced geometry had been built. The source also requires material families and vertex attributes absent from the current shared translator. See [the milestone report](REPORT.md). The queued selection implementation has not been validated on the full level's GPU workload.

The complete exported level: all 20,430 placements, using authoritative component-local geometry and column-major matrices. This example has no replacement ground plane or placement visibility filter. ALS assets stay in their existing package.

Build on Windows from a Visual Studio developer command prompt with Node 22:

```powershell
node --max-old-space-size=16384 examples/ruins/scripts/build.mjs D:/Archive/dark-ruins-export D:/dev/owned-assets/dark-ruins/level 0.03
node --max-old-space-size=8192 examples/ruins/scripts/materials.mjs
```

The last geometry argument is one minimum world-space resident error, in metres. Every mesh uses this divided by its largest placement scale, including shear. The builder uses meshoptimizer's original DAG and eight-wide traversal BVH; it retains no separate low-detail renderer. Completed geometries are reused when the budget matches. Original source files are read-only and all generated content stays outside Git.

Materials use `examples/shared/scan-material.ts`. The material preparation command accepts optional export, output, and authored custom-general source descriptor paths. Its defaults use the paths above and `D:/dev/owned-assets/dark-ruins-source/materials.json`, which supplies the authored shader's fixed RGB-noise texture. Images share one 1024-pixel maximum dimension. Preparation preserves source parameters for unimplemented surface families, and the example explicitly refuses to render those families. It never substitutes a material for an unsupported shader. Additional authored translations and required vertex attributes are a separate prerequisite for the complete level.

The level build writes component-local collision at a global 10 cm world-space error. Collision bodies are activated through a spatial index around the player. Rendering retains every placement. The sun direction and intensity, sky intensity, and height-fog data come from the environment export; the atmosphere translates those values into the existing look's physical controls. This does not reproduce the source's full volumetric lighting model.

Run `pnpm --dir examples/ruins dev --port 5248`. On this machine the persistent server is scheduled task `blacksite-ruins-dev`, with `D:/dev/meshlets-m2-dev.cmd`. Ports 5246 and 5247 belong to the other previews. Expose this server with `bb connect expose 5248`.

The existing inspector provides overview, courtyard and ALS walk cameras, LOD and meshlet views, and telemetry capture with T. The selection panel shows tested and culled instances, hierarchy nodes, clusters visited, view selection GPU time, useful drawn triangles, and the geometry buffer allocation budget. It excludes textures and targets. Overflow in the bounded queues is a reported failure.
