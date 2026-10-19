# Archway

One full-detail scan, the shared look, and the ALS shoulder-camera walker. Geometry is built offline and rendered exclusively by `MeshletScene`.

Build the local owned content from the repository root in a compiler environment:

```sh
node examples/archway/scripts/build.mjs D:/Archive/dark-ruins-export D:/dev/owned-assets/dark-ruins
```

The build resolves the visible source placement's material overrides and primitive slots, converts its original images to lossless WebP, builds the complete meshlet hierarchy, and derives a collision surface at 2.5 cm geometric error. Normals come from the source geometry; the runtime derives the tangent frame from the primary UVs. The original normal texture's green convention is corrected at binding. Source positions are translated to centre the study on the ground without changing scale.

Processed geometry, textures, material parameters and collision data live outside the repository in `D:/dev/owned-assets/dark-ruins`, served through the shared owned-assets middleware.

```sh
pnpm --dir examples/archway dev --port 5247
```

Use WASD, Shift and mouse look; R returns to the wide view. The shared performance inspector supplies LOD colours, meshlet colours, geometry technique controls, and T / Dump stats. Snapshots are written to `artifacts/archway/telemetry/snapshots.jsonl` by the dev server.
