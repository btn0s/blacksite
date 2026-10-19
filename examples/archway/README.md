# Archway

One full-detail scan, the shared look, and the ALS shoulder-camera walker. Geometry is built offline and rendered exclusively by `MeshletScene`.

Build the local owned content from the repository root in a compiler environment:

```sh
node examples/archway/scripts/build.mjs D:/Archive/dark-ruins-export D:/dev/owned-assets/dark-ruins D:/dev/owned-assets/dark-ruins-source/materials.json
```

The build resolves the visible source placement's material overrides and primitive slots, converts its original images to lossless WebP, builds the complete meshlet hierarchy, and derives a collision surface at 2.5 cm geometric error. The material source descriptor contains effective parameters, explicit channel mappings and every sampled image with its colour-space metadata, including the parent material's fixed RGB variation texture. Its image paths are relative to the descriptor. The original geometry export remains read-only.

The shared scan-material loader translates the source family's saturation, brightness and power contrast, roughness selection and remapping, specular response, normal adjustments, HSV offsets, world-space RGB variation and shoreline wetness into standard physical surface nodes. It supports the family's nonmetallic surfaces; pure-metal, random-offset and packed-normal reconstruction branches are explicitly rejected. It does not reinterpret height as AO. Normals use the shared geometry tangent-frame helper and the source green-channel convention. Source positions are translated to centre the study on the ground without changing scale.

Refresh only materials without rebuilding geometry:

```sh
node examples/shared/build-scan-materials.mjs D:/dev/owned-assets/dark-ruins-source/materials.json D:/dev/owned-assets/dark-ruins
```

Processed geometry, textures, material parameters and collision data live outside the repository in `D:/dev/owned-assets/dark-ruins`, served through the shared owned-assets middleware.

```sh
pnpm --dir examples/archway dev --port 5247
```

Use Wide and Close for the fixed reference cameras, or open `?view=wide` and `?view=close`. Walk restores the ALS shoulder camera with WASD, Shift and mouse look; R returns the walker to its starting position. The shared performance inspector supplies LOD colours, meshlet colours, geometry technique controls, and T / Dump stats. Snapshots are written to `artifacts/archway/telemetry/snapshots.jsonl` by the dev server. Reference and desktop captures stay in ignored local artifacts.
