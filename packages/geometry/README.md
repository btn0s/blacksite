# Cluster geometry

Static cluster geometry for three.js `WebGPURenderer`. The offline tool uses meshoptimizer's cluster hierarchy builder. The runtime selects and culls clusters on the GPU, then renders material batches through three's standard node material and lighting path.

```ts
import { loadMeshletSource, MeshletScene } from '@blacksite/geometry'

const asset = await loadMeshletSource('/assets/scene.meshlets')
await renderer.init()
const geometry = await MeshletScene.create(renderer, [
  { asset, instances: matrices, materials: [material] },
], { pixelError: 2, occlusion: true })
scene.add(geometry.object)
renderer.setAnimationLoop(() => {
  geometry.prepare(renderer, camera, { occluders: [terrain.object, forest.object] })
  renderer.render(scene, camera)
})
```

Entries combine a repeatable asset source, immutable instance transforms and source material slots. A source has `metadata` and an asynchronous `load()` returning a fresh `MeshletAsset`. `loadMeshletSource(url)` reads and cancels the metadata prefix request, then supplies that source. A manifest containing full meshlet metadata can supply the source directly. `loadMeshletAsset` and `parseMeshletAsset` remain available for CPU geometry work.

`MeshletScene.create` loads one source at a time, uploads its vertex, reference and index arrays, and detaches the source buffer. Shared sources occupy GPU storage once, and material batches share storage within each source. The runtime never concatenates all scene vertices or retains fetched geometry. Cluster metadata, traversal nodes and instance records use shared staging buffers that are uploaded and detached after assembly. Compute scratch buffers release their CPU arrays during creation too. Upload uses three's public compute APIs; detaching the backing `ArrayBuffer` also releases arrays retained by compiled storage bindings. The sources remain usable for another scene because every `load()` returns fresh data.

Every entry contributes to a single depth pyramid and visibility pipeline. Source `Material.visible` is respected when building immutable batches; invisible surfaces retain their resident geometry but contribute no draw records. `loadMeshletModel(manifestUrl)` loads unique geometry source descriptors, scene transforms and the manifest's material library. The library contains materials and embedded textures without the original model geometry. `residentGeometryBytes` reports uploaded vertices, references, indices and cluster metadata without retaining CPU data.

Standard and physical materials, primary-UV textures, normal maps, alpha-tested foliage and custom surface nodes are supported. Batches share material graphs by source material; public per-object node updates select each draw's resident storage buffers and visible-list offset. Opaque depth and shadow graphs omit surface colour and alpha calculations. Finite invertible affine transforms support rotation, reflection, nonuniform scale and shear. Sphere and error scaling use a conservative bound from the linear transform's Gram matrix; normals use its inverse transpose. The camera must be perspective with standard depth. Occlusion requires single-sample rendering for both the depth target and final camera view; logarithmic and reversed depth are unsupported. Call `prepare` before drawing the camera view and `dispose` when removing the geometry.

Custom surface nodes retain their world-position and geometric-normal inputs. For explicit UV mappings, `normalMapWithUV(texture, uvNode, scale?)` derives the normal-map tangent frame from those UVs. `tangentNormalWithUV(signedNormalNode, uvNode)` uses the same frame for authored tangent-normal adjustments. This avoids relying on the draw tile's placeholder UV attribute. Ordinary material `normalMap`, `bumpMap` and physical `clearcoatNormalMap` properties use the pulled primary UVs automatically; custom normal nodes retain that UV context too.

`pixelError` controls projected geometric error. `setDebugView('normal' | 'meshlets' | 'lod')` changes the visualization. `setLodEnabled(false)` selects the finest resident clusters inside `fallbackDistance` (default 120 m), through the same indirect renderer. With a zero build budget this retains source detail. The cap uses each cluster's bounding sphere. `occlusionEnabled` controls two-pass occlusion. `readStats(renderer)` asynchronously reads GPU counters for occasional HUD updates; selection and drawing never require CPU readback. `sceneTriangles` counts the LOD-cut triangles reached by hierarchy traversal before leaf frustum and occlusion rejection, `drawnTriangles` counts useful visible triangles, and `submittedTriangles` includes degenerate tile padding. `resetHistory()` invalidates temporal depth after a discontinuous camera or scene change.

## Sun shadows

Shadow clusters are selected independently from each orthographic cascade camera at `shadowPixelError` (default one shadow texel). They have separate per-material visible ranges and indirect arguments; the main camera's selection and visibility never limit casters. Selection runs again immediately before each cascade renders, so the shared shadow buffers can serve successive cascades without duplicating resident geometry.

Set `shadowLayer` (default 31) to a layer excluded by the view camera and enabled on the sun's cascade cameras. With the shared look:

```ts
const geometry = await MeshletScene.create(renderer, entries, { shadowLayer: 2, shadowPixelError: 1 })
const removeShadowListener = look.onBeforeShadow((renderer, cascadeCamera, mapSize) => {
  geometry.prepareShadow(renderer, cascadeCamera, mapSize)
})
```

Pass `shadowLayers: [2]` when creating the look. `setShadowEnabled(false)` disables casting; receiving shadows remains enabled. Source alpha cutouts and primary-UV transforms are preserved in the caster materials. `prepareShadow` expects the actual fitted cascade camera and its map size, before the shadow render pass begins. The look's public scene render hook supplies these after three updates the cascade matrices. Dispose the listener when removing the geometry.

## Offline build

```sh
node packages/geometry/scripts/build.mjs input.glb output.meshlets
```

The `@blacksite/geometry/build` export also provides `buildMeshletGeometry` for generated geometry and `buildGltfMeshes` for unique local-space GLTF meshes with separate instance transforms and a material-only GLB. `writeMaterialLibrary` refreshes a material library without rebuilding geometry. See [the build contract](scripts/README.md) for the pinned upstream revision, provenance and binary layout.

## Frame pipeline

1. Test placement spheres against the frustum and previous depth pyramid. Only surviving placements seed traversal roots. Defer hidden placements without visiting their clusters.
2. Traverse meshoptimizer's eight-wide group BVH forest with ping-pong queues and indirect dispatch. Nodes whose conservative projected error meets the threshold are pruned. Accumulate reached group leaves, then evaluate their cluster lists once using the DAG's self/parent error rule and precise cluster frustum bounds. Test survivors against previous depth and defer hidden clusters. Append each visible cluster-instance pair directly to its source/material batch's range, incrementing that batch's indirect draw count. No cluster-instance candidate table is stored or scanned.
3. Draw the first visible lists into a full-resolution depth target, preserving material alpha cutouts. Render the optional `occluders` roots into that same depth attachment with native depth materials, retaining their displaced positions, wind, masks and alpha tests. Maximum-reduce all covered samples into the pyramid base, then reduce the mip hierarchy.
4. Indirectly recover deferred placements against current depth, traversing newly visible instances through the same hierarchy. Recover deferred clusters against current depth and append survivors to the same batch ranges. Dispatches are bounded by the build's BVH depth. Queue capacity is derived from the maximum combined forest frontier across all placements; leaf capacity covers every resident cluster across those placements. No dispatch spins waiting on other workgroups.
5. Draw each batch's populated range through `InstancedBufferGeometry.setIndirect`, pulling vertices from shared storage. Each cluster occupies a fixed triangle tile; short clusters use degenerate padding. Counters distinguish useful triangles from submitted triangles.

Depth history contains first-pass geometry and the supplied occluder roots. Omitting recovered geometry from history reduces culling efficiency without making rejection more aggressive. External occluders render their existing geometry directly through the public render-object callback; they are never reparented or copied. Blended transparent materials and materials that do not write depth are excluded from occlusion. Supply terrain and trees as separate roots, without including the cluster scene itself.

## Current boundary

Geometry and hierarchy are fully resident. Shared vertices use 16-bit position and UV quantization, octahedral normals and tangents, and meshlet-local byte triangle indices, decoded during vertex pulling. Positions share a quantization lattice across the asset to preserve cluster seams. Binary version 3 adds the traversal forest to this compressed layout; existing assets must be rebuilt. Instance broad phase and hierarchical traversal supply both view and shadow selection. Streaming and software rasterization remain future work. Triangle padding incurs vertex work.

`buildGltfMeshes(input, output, {minimumError})` and the fourth argument of `buildMeshletGeometry` set the minimum resident object-space error. A zero budget retains source detail. For a positive budget, the builder discards groups whose simplified representation meets it, retains the coarser DAG, and removes unreferenced vertices. The resident boundary becomes the finest available cut in the existing renderer. A scene builder converts a world-space budget with `minimumError = worldError / maximumPlacementScale`, using the largest conservative scale among that mesh's placements. Metadata records source and resident triangle counts and the budget. This is a residency budget for the hierarchy; finer payloads can be restored by a future streaming owner without another selection path. Capped artifacts must be rebuilt from the source to restore omitted groups.

Stats include placement broad-phase counts, hierarchy nodes and clusters visited, and the buffer allocation budget in bytes. Pass the existing look's `timings()` snapshot as `readStats(renderer, timings)` to report view traversal GPU milliseconds, including recovery and batch appends. This excludes depth rendering, HiZ reduction and shadow traversal; those remain separate named GPU passes. Buffer bytes exclude textures, render targets, driver allocations and the browser.

Surfaces use three's lighting/output path, receive shadows and cast through independent orthographic light-view selection. Perspective light-view selection is not implemented. Skinning, morphs, displacement, blended transparency, secondary UVs, vertex colours, transmission and anisotropy are unsupported for cluster assets. The constructor rejects incompatible material features it can identify. External occluders may use displaced native node materials. Instances are static after construction.

The implementation uses public three storage, compute, texture and indirect-draw APIs, without renderer patches or private GPU resource access.

Sources: [meshoptimizer](https://github.com/zeux/meshoptimizer), [three storage attributes](https://threejs.org/docs/#StorageBufferAttribute), [three indirect attributes](https://threejs.org/docs/#IndirectStorageBufferAttribute), [public compute rasterization experiment](https://github.com/mrdoob/three.js/pull/33605). [Independent prior art](https://github.com/elad12390/three-virtual-geometry) was reviewed and is not a dependency.
