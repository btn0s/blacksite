# Archway courtyard

Every placement whose transformed source-mesh bounds intersects the 10 metre sphere centred on the archway’s base. The centre comes from the archway’s transformed geometry bounds, because its asset pivot is far from its visible geometry. Exported matrices are applied without recentering individual assets. Geometry uses the compressed resident layout in `@blacksite/geometry`; the full source hierarchy remains available at close range. ALS supplies the shoulder-camera walker.Geometry sources upload sequentially into per-source GPU buffers, with one shared visibility and shadow pipeline. Uploaded CPU buffers are released. Texture loading releases mip payloads after upload and disposes the transcoder workers when the surface batch finishes. Collision streams one placement at a time into Rapier and clears its JavaScript shape cache after import; the walker mounts after collision is ready. Inspection keeps byte counts instead of retaining asset payloads.

Build owned content from the repository root in a compiler environment with the native [Basis Universal encoder](https://github.com/BinomialLLC/basis_universal) on PATH, or its executable path in `BASISU`:

```sh
node examples/archway/scripts/build.mjs D:/Archive/dark-ruins-export D:/dev/owned-assets/dark-ruins D:/dev/owned-assets/dark-ruins-source/materials.json
```

The builder writes an isolated asset generation and atomically replaces the root `courtyard.json` only after geometry, collision and every surface image are complete. Readers resolve all resources through that one manifest. It reads the level export without modifying it, resolves each placement's geometry and material-slot overrides, and applies its authoritative column-major matrix once. It retains hidden collision placements for collision while respecting their visibility. A 25 cm geometric-error cut selects coarse clusters from the existing meshlet hierarchy and supplies one static triangle collider per placement, reducing collision detail without constructing one world-sized acceleration structure. There is no substitute ground plane. The collision cooking stage can run independently with `node examples/archway/scripts/build-collision.mjs D:/dev/owned-assets/dark-ruins/courtyard.json`.

Source images retain their resolution and are encoded as UASTC KTX2 with mipmaps. Shared images use one texture object and GPU allocation; per-material UV transforms live in node uniforms. Telemetry adds the resident compressed mip payloads to the renderer counter, whose compressed-texture estimate is otherwise one byte per texture. The shared scan translator handles the approved custom scan family, including source normal convention, colour controls, roughness, specular, RGB variation and wetness. The approved descriptor supplies the parent's fixed RGB noise texture and its channel mapping. Unsupported material families are listed in `courtyard.json` and telemetry and remain undrawn; their geometry stays resident, with no replacement surface. Vertex-colour material masks and shader displacement remain untranslated.

The exported directional-light orientation and illuminance, sky scattering coefficients, and exponential height-fog parameters configure the shared look. The sky-light intensity scales its existing sky illuminance calibration. Local light volumes and authored post-process volume blends are outside this scene translation.

Processed meshes, textures, material parameters and collision live outside Git under `D:/dev/owned-assets/dark-ruins`, served by the owned-assets middleware. ALS assets remain unchanged.

```sh
pnpm --dir examples/archway dev --port 5247
```

Wide and Close select fixed courtyard cameras; Walk restores ALS with WASD, Shift and mouse look. R returns to the starting position. The shared inspector supplies LOD colours, meshlet colours, technique controls, GPU pass timings, renderer allocations, and T / Dump stats. Telemetry goes to `artifacts/archway/telemetry/snapshots.jsonl`. Desktop captures stay in ignored artifacts.
