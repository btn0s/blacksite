# Tidal Citadel

An explorable coastal scene rendered entirely with GPU-selected meshlets: a continuous noise heightfield, rounded rock scans, stone architecture, scanned trees, coastal plants, pebbles and water. The reusable offline and runtime implementation lives in [`packages/geometry`](../../packages/geometry/README.md).

Drag to orbit, scroll or pinch to explore. The collapsed **Scene tuning** panel uses Leva for camera poses, surface/cluster/LOD views, geometric error, occlusion, exposure, sunlight and haze. Performance diagnostics are optional. There is one meshlet rendering path and no plain-rendering comparison mode.

## Local setup

Use Node 22+, pnpm and a C++17 compiler. All source and generated runtime assets live outside the repository, including the CC0 downloads. From the repository root, choose an external directory and expose it through the ignored `public/owned` symlink:

```sh
pnpm install
export MESHLETS_ASSETS="/absolute/path/outside/blacksite/meshlets-assets"
mkdir -p "$MESHLETS_ASSETS"
ln -s "$MESHLETS_ASSETS" examples/meshlets/public/owned
node examples/meshlets/scripts/fetch-asset.mjs "$MESHLETS_ASSETS"
```

The fetch script downloads the CC0 coast rocks, tree, fort, sky and coastal rock textures. It verifies fixed publisher checksums, preserves authored geometry, restores the tree's supplied leaf opacity and writes `public-assets.json` with output hashes. Sources are listed in [the asset notes](public/assets/README.md).

Before building, supply the licensed local runtime assets in that same external directory:

| Files | Content |
| --- | --- |
| `sedge.glb`, `grass.glb`, `yucca.glb` | Material-complete plant families, with original metric dimensions and alpha masks |
| `sandstone-rock.glb` | Scanned small stone with its PBR material |
| `ground-moss-albedo.png`, `ground-moss-normal.png`, `ground-moss-orm.png` | Licensed moss ground material; base colour in sRGB, normal and ORM in linear space |

These files are a required local input, not part of the public download or repository. The private acquisition report records their provenance and conversion. No substitute assets are generated when they are absent.

```sh
pnpm exec tsx examples/meshlets/scripts/build-world.ts
pnpm --filter @blacksite/example-meshlets dev
```

The canonical world builder produces the terrain and ocean packs, the fort library and every vegetation/rock family. Each model library contains unique local-space meshlet geometry, instance metadata and a material-only GLB. Generated assets are written beneath the external directory's `geometry/` folder, including `geometry/fort/manifest.json`. No separate cliff build or layout file is required.

The terrain defines shorelines and gently blended architecture foundations. Runtime height, slope and water-depth queries use its packed vertices. Scanned outcrops intersect the actual ground; vegetation uses deterministic patches, slope and shoreline masks, and an architecture exclusion area. Every modeled surface uses the same meshlet scene and visibility pipeline. Public three post-processing adds ambient contact occlusion and antialiasing. Its normals prepass owns the shared scene depth: geometry selects before that pass and recovers against its completed depth, which the lit pass retains.

Use desktop Chrome with WebGPU. For remote access, run `bb connect expose 5189` and open the returned HTTPS URL. The preview serves licensed runtime content, so keep it restricted to the intended private session.

## Diagnostics and limits

Meshlet-colour and LOD views include every modeled scene surface. The HUD reports useful triangles in the final surface cut, selected/culled clusters and GPU render-plus-compute timestamps. Submitted triangles include degenerate tile padding; the triangle counter excludes repeated depth and post-process passes. Browser frame intervals include pacing and are reported separately. No comparative speedup is claimed.

`window.meshletLab` exposes `setView`, `setCamera` and `snapshot` for captures. Geometry uses resident compressed vertices and byte indices, placement broad phase and queued hierarchy traversal. Streaming and software rasterization are not implemented. The scene does not cast camera-cut shadows; ambient contact occlusion is not a shadow replacement. See the package README for material support and further limitations.
