# Scene sources

This directory contains documentation only. Runtime assets, source downloads and generated geometry packs live in an external directory linked as `examples/meshlets/public/owned`; they are excluded from Git.

```sh
node examples/meshlets/scripts/fetch-asset.mjs /absolute/path/to/external-runtime-directory
```

The fetch script downloads every CC0 source used by the scene. Fixed resource URLs, publisher MD5 checksums and available byte sizes are recorded in [`cc0-assets.json`](../../scripts/cc0-assets.json). Original resources are verified before packaging. The generated `public-assets.json` records each runtime file's source, licence, byte size and SHA-256 hash. The script preserves authored model geometry; it does not subdivide, displace or simplify it.

All sources below are published by Poly Haven under [CC0](https://polyhaven.com/license).

| Source | Runtime output | Scene use |
| --- | --- | --- |
| [Coast Rocks 05](https://polyhaven.com/a/coast_rocks_05) | `coast-rocks.glb` | Rounded coastal outcrop scan, 771,724 source triangles, partly buried in the terrain |
| [Island Tree 02](https://polyhaven.com/a/island_tree_02) | `island-tree-02.glb` | Coastal tree scan, 1,072,213 source triangles across trunk, leaves and branches |
| [Modular Fort 01](https://polyhaven.com/a/modular_fort_01) | `modular-fort.glb` | Authored stone architecture kit with 22 separate source meshes |
| [Rock 3](https://polyhaven.com/a/rock_3) | `coastal-rock-albedo.jpg`, `coastal-rock-normal.jpg`, `coastal-rock-orm.jpg` | Seamless grey rock surface at a 1.5 m tile scale |
| [Qwantani Sunset (Pure Sky)](https://polyhaven.com/a/qwantani_sunset_puresky) | `sunset-sky.hdr` | Original 1K environment image |

Model and ground textures use the original 2K sources. The tree's supplied separate leaf opacity is packed into its base-colour alpha and rendered as a mask with cutoff 0.5. Its authored branch texture transforms and normal strength are preserved. Other downloaded images are unchanged.

Coast Rocks 05 is by Rob Tuytel; Island Tree 02 is by Rob Tuytel and Rico Cilliers; Modular Fort 01 is by Rico Cilliers; Rock 3 is by Rob Tuytel. Qwantani Sunset was photographed by Greg Zaal and processed by Jarod Guest. The source pages and public API metadata provide the full attribution records.

The outcrop measures 4.04 × 3.75 m across and 1.33 m high in the source glTF. Its open boundaries are confined to the low base skirt, which is buried into the terrain; it is not described as a watertight solid.

The architecture kit is authored geometry, not a scan. The scene assembles original towers, gates, stairs and walls on the terrain's foundation. The original open coastal-cliff facade is not used by the final scene or fetch pipeline.

Licensed sedge, grass, yucca, small stones and moss ground textures are separate required local inputs. They remain external and are never redistributed with the repository. Their provenance and material conversion are recorded in the private acquisition report.
