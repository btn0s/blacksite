# Cluster geometry build

Run from the repository root:

```sh
node packages/geometry/scripts/build.mjs input.glb output.meshlets
```

Requires Node 22+, a C++17 compiler on `PATH` (`CXX` can select one), and `tar`. Windows defaults to the installed compiler in a Visual Studio developer command prompt; other hosts default to `c++`. The first invocation downloads and compiles a pinned MIT dependency into the operating system temporary directory. `BLACKSITE_GEOMETRY_CACHE` can select a persistent cache directory. Subsequent invocations reuse the executable when the wrapper source has not changed.

The builder calls the unmodified [meshoptimizer cluster LOD reference](https://github.com/zeux/meshoptimizer/blob/f0a684f11ead064e176775c9b796f82a55910e92/demo/clusterlod.h), revision `f0a684f11ead064e176775c9b796f82a55910e92`. The archive SHA256 is `52cec854745cd6b39531e07161a2224778700bdc7c8f0e2d8bc8825efde8af1a`. meshoptimizer is [MIT licensed](https://github.com/zeux/meshoptimizer/blob/f0a684f11ead064e176775c9b796f82a55910e92/LICENSE.md); its source and license are extracted together into the build cache. No upstream source is modified or copied into this package.

The single-asset command applies scene transforms and produces one geometry asset. The scene build API instead stores each unique glTF mesh in local coordinates and records node transforms separately, preserving instancing. Both preserve material boundaries and quantize positions, normals, UVs and authored tangents, and reject skinning and morph targets. Missing normals are generated from the source triangles. The native builder losslessly indexes identical position/normal/UV/tangent tuples with meshoptimizer before constructing the hierarchy. Distinct normals and UV seams remain distinct; every source triangle and its winding are retained with remapped vertex indices. Material factors, alpha mode, cutoff and normal scale are stored in metadata. The scene build also writes a material-only GLB containing original materials, embedded images and texture transforms, so runtime loading does not fetch the original model geometry.

For a scene or a kit, call the Node API:

```js
import { buildGltfMeshes, buildMeshletGeometry } from './packages/geometry/scripts/build.mjs'

await buildGltfMeshes('kit.glb', 'public/geometry/kit')
await buildMeshletGeometry({
  name: 'Terrain',
  positions,
  normals,
  uvs,
  indices,
}, 'public/geometry/terrain.meshlets')
```

`buildGltfMeshes` writes one packed file per unique mesh, `materials.glb` and a `manifest.json`. The manifest's required `materialUrl` identifies the material library relative to the manifest. Geometry records preserve the glTF mesh index, name, relative file URL, primitive ranges, bounds and source triangle count. Instance records contain the source node name, mesh index and world matrix. Material slots retain their original glTF material indices, allowing every instance to share the material objects. Repeated nodes do not duplicate geometry.

`writeMaterialLibrary(inputGlb, outputGlb)` exports or refreshes materials without rebuilding geometry. It clones the source document using glTF Transform, removes scene and geometry resources, and writes the remaining material and image resources to a GLB. Material order, alpha cutoffs and texture transforms are preserved. Existing geometry manifests must reference that file through `materialUrl`.

`buildMeshletGeometry` accepts array-like positions, normals, UVs and triangle indices. Optional `tangents` preserve authored tangent frames; absent tangents retain the derivative frame at runtime. Optional `primitives` partition the indices using `{indexOffset, indexCount, materialIndex}`; optional `materials` provide the matching material descriptors. With no explicit material list, the geometry has one default surface. The function returns `{metadata, output, bytes, seconds}`. An optional third argument records the original source `{sha256, bytes}`; otherwise provenance identifies the supplied geometry. Both APIs call the same native hierarchy builder.

The reference partitions geometry into clusters capped at 128 triangles, groups adjacent clusters, locks shared group boundaries, simplifies each group, and reclusters the result. UV discontinuities are protected and simplification considers normal error. Vertices shared between primitives are locked. The simplification error uses the reference's conservative additive accumulation configuration; sloppy simplification is enabled as the upstream fallback when ordinary simplification stalls. The reference generates the DAG and conservative error spheres. The wrapper serializes those results without implementing an alternative hierarchy algorithm.

## Binary version 2

All numbers are little endian. The 32-byte header contains eight unsigned 32-bit words: magic `0x4c4d5342`, version, section count, metadata byte count, total file byte count, then three reserved zeros. It is followed by one 16-byte directory record per section: section id, byte offset, element count, and element type (`0` = float32, `1` = uint32). UTF-8 JSON metadata follows the directory. Section data starts at 16-byte aligned offsets. The loader exposes zero-copy typed array views into the downloaded buffer.

| Section | Layout |
| --- | --- |
| vertices | five uint32 words per shared vertex: position xy as uint16; position z and signed tangent handedness as 16-bit values; octahedral normal xy as snorm16; UV xy as unorm16; octahedral tangent xy as snorm16 |
| vertexReferences | uint32 shared-vertex references for each meshlet, following meshoptimizer meshlet vertex-table conventions |
| indices | four uint8 meshlet-local vertex indices per uint32, with each meshlet starting on a word boundary |
| clusterData | eight uint32 per cluster: byte index offset, index count, containing group, refined group, level, material, unique vertex count, vertex-reference offset |
| clusterBounds | four float32 per cluster: precise culling sphere xyz and radius |
| clusterLod | twelve float32 per cluster: self error sphere xyzr, parent error sphere xyzr, self error, parent error, two reserved |
| clusterQuantization | twelve float32 per cluster: position origin xyz and padding; position step xyz and padding; UV minimum xy and extent xy |
| groupData | four uint32 per group: first cluster, cluster count, first child edge, child edge count |
| groupBounds | eight float32 per group: simplified sphere xyzr, error, level, two reserved |
| groupChildren | uint32 references to finer groups, deduplicated within each parent group |

Original clusters have refined group `0xffffffff` and self error zero. A cluster's self error sphere is its refined group's simplified sphere. Its parent error sphere belongs to its containing group. Terminal groups have parent error `FLT_MAX`.

The LOD cut selects a cluster when its projected self error is at or below the pixel threshold and its projected parent error is above that threshold. Projection uses `error * projection[1][1] * viewportHeight / (2 * max(distance(camera, sphereCenter) - sphereRadius, nearPlane))`. The containing and refined group references remain available for future hierarchical traversal or streaming.

Positions and UVs use `meshopt_quantizeUnorm(..., 16)`; normals and tangents use `meshopt_encodeFilterOct(..., 16)`. The redundant octahedral scale component is implicit. `clodLocalIndices` supplies the byte indices. Positions share an asset-wide quantization lattice relative to the mesh bounds, the common quantization group for all of its clusters. Meshlets reference this shared quantized vertex pool, so boundary vertices decode identically across levels and clusters and immutable vertex data is stored once. UVs retain the asset's range, including coordinates outside zero to one. Vertex pulling decodes these directly from resident uint storage; no expanded float geometry or global 32-bit triangle stream is uploaded. `meshletPosition` and `meshletIndex` expose the same decode for offline collision and heightfield consumers.

Version 2 replaces version 1. Rebuild existing assets; the loader rejects old files. The complete hierarchy remains resident, without paging or on-demand streaming.
