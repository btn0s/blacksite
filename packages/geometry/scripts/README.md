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

## Page format version 5

`buildMeshletPages(input, directoryFile, source, {minimumError})` and `buildGltfPages(inputGltf, meshIndex, directoryFile, {minimumError})` compile the same source hierarchy into immutable `.directory` and `.pages` files. The scene command in `examples/ruins/scripts/build.mjs` requires a new owned directory. Published version-3 geometry and its runtime remain unchanged. Offline version 4 is superseded; version 5 is the page-consumer contract.

### Resident vertices and page packing

Positions use the asset-wide 16-bit lattice; normals retain two octahedral snorm16 components, and UVs use the asset-wide two-component unorm16 range. The compiler welds identical complete packed tuples after quantization, preserving every attribute the GPU sees. The hierarchy is built from the original source values; welding adds no quantization loss. Normal precision remains 16 bits. The meshoptimizer octahedral encoder is used for normals and authored tangents. Its expanded post-decode filter would increase resident stride, so transport decoding preserves the compact octahedral pair instead. Colour stays lossless RGBA8; no alpha-bit reduction or float filter is applied.

| Resident bytes | Contents |
| --- | --- |
| 0–3 | Position x/y as u16 |
| 4–7 | Position z as u16; octahedral normal x as snorm16 |
| 8–11 | Octahedral normal y as snorm16; UV0 u as unorm16 |
| 12–15 | UV0 v as unorm16; tangent-negative and tangent-present bits, with fourteen reserved zero bits |
| Optional 4 | Authored tangent octahedral x/y as snorm16; absent for meshes without authored tangents |
| Optional 4 | Nonconstant source colour as RGBA8 |
| Optional 4 | UV1 u/v as unorm16; only where the source has UV1 |

The base stride is 16 bytes. Tangents, colour and UV1 add four bytes each, so the maximum is 28 bytes. Every mesh has one word-aligned layout. The vertex shader needs fixed word loads, shifts/masks, the existing octahedral decode and a multiply/add against the asset lattice. Mixed primitives preserve per-vertex tangent absence in the flags. Metadata records the optional word offsets and the census counts every layout.

Whole meshoptimizer groups share one local vertex table per page. The packer considers vertex-sharing neighbours, DAG parents/children/siblings, and adjacent spatial Morton ranks. It prefers shared vertex bytes per incremental payload byte, breaking ties by spatial distance and stable group id. A page contains one mesh, one pin class and at most two adjacent original DAG depths. Each proposed contraction must preserve an acyclic page dependency graph; the written directory is independently topologically checked. This avoids turning page residency into a cyclic or multi-page admission unit. Every terminal group is pinned, including early terminals.

The compiler validates at most 21 clusters/group, 128 vertices/triangles per cluster and 131,072 decoded bytes/page. A standalone worst-case group has at most 97,440 payload bytes plus its 64-byte header and up to 36 bytes of alignment. Boundary/level duplication is measured as the sum of page-local vertex tables minus the asset's unique packed pool.

### Encoded wire pages

Each pack concatenates independently compressed pages. All integers are little endian. A 96-byte encoded-page header has twenty-four u32 words:

| Word | Value |
| --- | --- |
| 0–3 | Magic `0x574d5342`, version 5, geometry-local page id, encoded bytes including header |
| 4–9 | Decoded resident bytes, vertex count, vertex byte stride, reference count, packed resident index bytes, cluster count |
| 10–13 | Minimum depth in low u16 and maximum depth in high u16; pinned flag; whole group count; triangle index count excluding meshlet padding |
| 14–17 | Encoded byte lengths of vertex, reference, triangle and cluster streams |
| 18–23 | Reserved zero |

Four streams immediately follow: final packed vertex tuples through meshoptimizer vertex codec version 0; u32 local vertex references through its index-sequence codec version 1; concatenated meshlet-local triangle indices through its triangle-index codec version 1; and 160-byte cluster records through vertex codec version 0. Each stream is independently round-tripped by the native compiler. Triangle codec cyclic rotations preserve each triangle and winding; no triangle is reordered or lost. The worker restores byte indices and each meshlet's four-byte padding. Codec compression level is 2. Stream sizes and total wire bytes are reported separately from resident bytes.

The decoded page has the original 64-byte resident header: magic `0x504d5342`, version 5, page id, decoded byte length, packed depth range, pinned flag, vertex count, reference count, packed index bytes, cluster count, vertex/reference/index/cluster byte offsets, vertex byte stride and group count. Sections start at sixteen-byte boundaries. Indices remain meshlet-local bytes; references index the shared page-local table. The complete image fits one 128 KiB physical arena slot, regardless of encoded size.

Cluster records retain the existing 160-byte GPU layout. Words 0–3 are the culling sphere; 4–13 self/parent LOD spheres and errors; 14 material; 15 refined group; 16 page-relative index byte offset; 17 index count; 18 original DAG depth; 19 page-relative reference word offset; 20–31 quantization. Word 23, previously padding, holds optional tangent word offset 4 or zero. Words 32–35 are page-relative vertex word base, vertex word stride, optional colour offset and optional UV1 offset. Words 36–39 hold UV1 bounds. Spheres include half-quantization-diagonal inflation. Add the physical page base to page-relative addresses; no expanded float vertex array is needed.

### Directory and worker boundary

A geometry directory uses magic `0x44475342`, version 5 and the resident format's 32-byte header plus 16-byte section-directory entries. UTF-8 metadata includes ranges/SHA256, source provenance, layout and exact census counts. Its sixteen-byte-aligned sections are:

| Section id | Contents |
| --- | --- |
| 0 | 32 bytes/group: sphere xyzw and error as f32; page id, page-local first cluster and cluster count as u32 |
| 1–2 | Finer dependency CSR: `groupCount + 1` u32 offsets, then u32 group ids |
| 3–4 | All coarser reverse dependencies in the same layout |
| 5–6 | Existing node data, 16 bytes/node, and conservative bounds/error, 32 bytes/node |
| 7 | 16 bytes/page: encoded pack offset low/high u32, encoded wire bytes, pinned flag |
| 8 | u32 ids of every terminal/coarsest group |

After error pruning, only populated depth rows are densely numbered in the temporary input to the unchanged eight-wide BVH builder. Pages/clusters retain original depths and DAG ids. Every retained group occurs once in the forest.

`@blacksite/geometry/pages` exports `GeometryPageDecoder`. Await `ready`, then call `fetch(packUrl, pageIndex, range, signal)`. One decoder owns one dedicated worker and accepts one page at a time; it has no unbounded queue. The worker fetches the exact HTTP byte range into a bounded encoded buffer, checks SHA256, decodes and validates the image, and transfers that image to the caller. Only then can the residency owner stage it for GPU upload. The response includes decoded bytes, wire bytes and decode milliseconds. Cancellation aborts fetch; `dispose()` terminates the worker. Decoding, hashing and index padding run off the main thread. The owned-assets server supports exact single byte ranges. This entry point is not connected to the current resident renderer.

`verifyGeometryPages(path)` reads written artifacts with the same decoder and checks range hashes, group coverage, pin closure, both dependency directions, page-DAG acyclicity, eight-wide forest coverage, all meshlet addresses and exact resident/wire totals. It runs during every bake.

The whole-level `level.directory` retains the 176-byte placement and spatial layouts, with version 5 and magic `0x4c475342`. Its 96-byte header contains eight u32 words: magic, version, section count 4, placement count, geometry count, material count, spatial node count and material-bitset word count. Four 16-byte records follow: id, byte offset, byte length, reserved zero. Geometry/material ids index `level.json`; placements retain source order.

| Section id | Contents |
| --- | --- |
| 0 | 176 bytes/placement: matrix and inverse transpose, sixteen f32 each; scale and determinant sign, two f32; material-map word offset/count, two u32; geometry id, forest root count, visibility and reserved zero, four u32; world sphere, four f32 |
| 1 | u32 global material ids indexed by each mesh's local slots; `0xffffffff` for unused slots |
| 2 | 32 bytes/spatial node: minimum xyz f32, left child u32, maximum xyz f32, right child u32. Right `0xffffffff` denotes a leaf whose left is the source placement id. Node zero is the root; bounds round outward. |
| 3 | `ceil(materialCount / 32)` u32 material words/node; parents contain both children's union. Hidden placements retain records and have empty bitsets. |

`surfaces.json` inventories every active primitive/material use and unsupported reason. `census.json` distinguishes unique payload, duplicated vertices, resident page images, physical slot slack, codec streams/wire, pinned closure and directories. Texture tails and regional collision stay with their slices. Published manifests are never repointed by this compiler.
