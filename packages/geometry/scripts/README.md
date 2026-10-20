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

## Binary version 3

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
| nodeData | four uint32 per traversal node: group or `0xffffffff`, child offset, child count, reserved |
| nodeBounds | eight float32 per traversal node: conservative sphere xyzr, maximum group error, three reserved |

Original clusters have refined group `0xffffffff` and self error zero. A cluster's self error sphere is its refined group's simplified sphere. Its parent error sphere belongs to its containing group. Terminal groups have parent error `FLT_MAX`.

The LOD cut selects a cluster when its projected self error is at or below the pixel threshold and its projected parent error is above that threshold. Projection uses `worldError * projection[1][1] * viewportHeight / (2 * max(distance(camera, worldSphereCenter) - worldSphereRadius, 1e-6))`, where `worldError` includes the conservative instance and scene scales. The containing and refined group references preserve the DAG for traversal and future streaming.

Positions and UVs use `meshopt_quantizeUnorm(..., 16)`; normals and tangents use `meshopt_encodeFilterOct(..., 16)`. The redundant octahedral scale component is implicit. `clodLocalIndices` supplies the byte indices. Positions share an asset-wide quantization lattice relative to the mesh bounds, the common quantization group for all of its clusters. Meshlets reference this shared quantized vertex pool, so boundary vertices decode identically across levels and clusters and immutable vertex data is stored once. UVs retain the asset's range, including coordinates outside zero to one. Vertex pulling decodes these directly from resident uint storage; no expanded float geometry or global 32-bit triangle stream is uploaded. `meshletPosition` and `meshletIndex` expose the same decode for offline collision and heightfield consumers.

Version 3 combines compressed resident geometry and traversal nodes. Rebuild existing assets; the loader rejects old files. Geometry and hierarchy remain resident, without paging or on-demand streaming.

The native builder calls upstream `clodBuildHierarchy` with node width 8. It builds a forest with one root per original DAG depth, at nodes `0..rootCount-1`. Each group appears once, avoiding DAG revisits and a group-instance visitation table. `nodeCount` and `rootCount` are recorded in metadata. A traversal node is pruned when its projected maximum group error meets the threshold; group leaves use the existing cluster self/parent cut rule. This is the upstream acceleration structure for selecting the cluster DAG.

The build API accepts `{minimumError}` as a residency budget (object-space metres, default zero). Convert a world-space budget with `minimumError = worldError / maximumPlacementScale`, using the largest conservative scale among the mesh's placements. For a positive budget, groups with simplified error at or below it are removed before building the traversal BVH. Remaining references are remapped, references across the resident boundary become terminal, and vertex fetch remapping drops unused vertices without changing the vertex layout. `sourceTriangles` preserves provenance; `residentTriangles` counts the finest resident cut. Primitive ranges describe source material slots. `sourceVertices` counts the input vertices and `residentVertices` counts the shared quantized pool. Zero budget retains source detail. The budget is applied before quantization and serialization.

## Page format version 4

`buildMeshletPages(input, outputDirectoryFile, source, {minimumError})` uses the same native hierarchy and quantizer. `buildGltfPages(inputGltf, meshIndex, outputDirectoryFile, {minimumError})` selects authoritative component-local geometry without applying scene-node transforms. A `.directory` and sibling `.pages` pack replace a resident `.meshlets` file for this build contract. Existing resident APIs and version-3 assets keep their format; no runtime loads version 4 yet.

All fields are little endian. Each page contains whole groups from one geometry, one original DAG depth and one pin class. Groups are packed deterministically by depth, pin class and group id. Every terminal group is pinned, including early terminals. A mesh-wide quantization lattice and the original packed vertex tuples are preserved across pages. Boundary duplication is measured as page-local vertices minus unique resident vertices. The compiler rejects groups above 21 clusters, clusters above 128 vertices or triangles, and any page above 131,072 bytes. The maximum 28-byte vertex contract bounds a standalone group at 97,440 payload bytes plus a 64-byte header and at most 36 bytes of section alignment.

Page packs concatenate compact, 16-byte-aligned page ranges; unused physical-slot bytes are absent on the wire. The directory records every range and SHA256. A page occupies one 128 KiB physical arena slot regardless of its wire size. A 64-byte page header contains sixteen u32 words:

| Word | Value |
| --- | --- |
| 0–3 | Magic `0x504d5342`, version 4, geometry-local page id, wire bytes |
| 4–9 | Original DAG depth, pinned flag, local vertex count, reference count, packed index bytes, cluster count |
| 10–15 | Vertex/reference/index/cluster byte offsets, vertex stride in bytes, whole group count |

Vertices retain the resident packed layout. References are page-local vertex indices; triangle indices remain meshlet-local bytes, padded to four bytes per cluster. Cluster records use the existing 160-byte GPU layout: words 0–3 culling sphere; 4–13 self/parent LOD spheres and errors; 14 material; 15 refined group or `0xffffffff`; 16 page-relative index byte offset; 17 index count; 18 original DAG depth; 19 page-relative reference word offset; 20–31 quantization; 32 page-relative vertex word base; 33 vertex word stride; 34–35 colour/UV1 attribute slots; 36–39 UV1 bounds. Spheres include the same half-quantization-diagonal inflation as the resident upload. Add the physical page base to page-relative addresses.

A geometry directory starts with the resident format's 32-byte header and 16-byte section-directory entries, using magic `0x44475342` and version 4. UTF-8 JSON metadata includes builder provenance, ranges/hashes and exact census counts. Sections are aligned to sixteen bytes:

| Section id | Contents |
| --- | --- |
| 0 | 32 bytes/group: sphere xyzw and error as f32, then page id, page-local first cluster and cluster count as u32 |
| 1–2 | Finer dependency CSR: `groupCount + 1` u32 offsets, then u32 group ids |
| 3–4 | All coarser reverse dependencies in the same CSR layout |
| 5–6 | Existing node data (16 bytes/node) and conservative bounds/error (32 bytes/node) |
| 7 | 16 bytes/page: pack byte offset low/high u32, wire bytes, pinned flag |
| 8 | u32 ids of every terminal/coarsest group |

After error pruning, only populated depth rows are passed to `clodBuildHierarchy`, with dense row numbers in that temporary input. The first `rootCount` nodes root the retained rows. Pages, clusters and DAG edges retain their original depths and ids. This satisfies the upstream builder's nonempty-row contract when pruning removes entire fine rows. Every group appears exactly once in the forest.

`verifyGeometryPages(path)` reads the written directory and pack, checks hashes/ranges, whole-group coverage, pin closure, both dependency directions, eight-wide BVH coverage, every packed triangle/reference address, and exact byte totals. It is part of the bake, and can read the artifacts independently afterward.

The whole-level command in `examples/ruins/scripts/build.mjs` also writes `level.directory`. Its 96-byte header starts with eight u32 words: magic `0x4c475342`, version 4, section count 4, placement count, geometry count, material count, spatial node count and material-bitset word count. Four 16-byte section records follow: id, byte offset, byte length and reserved zero. Section data is word aligned. Geometry and material ids index `level.json`'s `geometries` and `materialPaths` arrays; placements retain source order.

| Section id | Contents |
| --- | --- |
| 0 | 176 bytes/placement: matrix and inverse transpose (sixteen f32 each); scale and determinant sign (two f32); material-map word offset and count (two u32); geometry id, forest root count, visible flag and reserved zero (four u32); world sphere (four f32) |
| 1 | u32 global material ids, indexed by each geometry's local material slots; `0xffffffff` for unused slots |
| 2 | 32 bytes/spatial node: minimum xyz (f32), left child (u32), maximum xyz (f32), right child (u32). Right `0xffffffff` denotes a leaf whose left field is the source placement index. Node zero is the world root. Bounds round outward. |
| 3 | `ceil(materialCount / 32)` u32 material-bitset words per spatial node; interior nodes contain the union of both children. Hidden placements retain records and have empty material bitsets. |

`surfaces.json` inventories every active primitive/material use, with complete source paths and unsupported/excluded reasons. `census.json` separates unique payload, page duplication, packed wire bytes, physical-page slack, pinned closure, directory sections/wire bytes and the full placement-weighted coarse cut. This offline geometry bootstrap leaves texture tails and regional collision to their implementation slices and never repoints a published manifest.
