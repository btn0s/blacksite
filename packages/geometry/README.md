# Cluster geometry

Static cluster geometry for three.js `WebGPURenderer`. The offline tool uses meshoptimizer's cluster hierarchy builder. The runtime selects and culls clusters on the GPU, then renders material batches through three's standard node material and lighting path.

```ts
import { loadMeshletSource, MeshletScene } from '@blacksite/geometry'
import { createWebGPULook } from '@blacksite/look/webgpu'
import type { PerspectiveCamera } from 'three/webgpu'

const asset = await loadMeshletSource('/assets/scene.meshlets')
await renderer.init()
const geometry = await MeshletScene.create(renderer, [
  { asset, instances: matrices, materials: [material] },
], { pixelError: 2, occlusion: true })
scene.add(geometry.object)
const look = await createWebGPULook(renderer, scene, camera)
const removeBeforeDepth = look.onBeforeDepth((renderer, camera, size) => {
  geometry.prepare(renderer, camera as PerspectiveCamera, size)
})
const removeAfterDepth = look.onAfterDepth((renderer, camera, depth) => {
  geometry.recover(renderer, depth)
})
renderer.setAnimationLoop(() => {
  look.beginFrame()
  look.render()
})
```

Entries combine a repeatable asset source, immutable instance transforms and source material slots. A source has `metadata` and an asynchronous `load()` returning a fresh `MeshletAsset`. `loadMeshletSource(url)` reads and cancels the metadata prefix request, then supplies that source. A manifest containing full meshlet metadata can supply the source directly. `loadMeshletAsset` and `parseMeshletAsset` remain available for CPU geometry work.

`MeshletScene.create` loads one source at a time, uploads its vertex, reference and index arrays, and detaches the source buffer. Shared sources occupy GPU storage once, and material batches share storage within each source. The runtime never concatenates all scene vertices or retains fetched geometry. Cluster metadata, traversal nodes and instance records use shared staging buffers that are uploaded and detached after assembly. Compute scratch buffers release their CPU arrays during creation too. Public render precompilation initializes the compacted buffers as storage-capable index attributes before compute compilation. Upload uses three's public compute APIs; detaching the backing `ArrayBuffer` also releases arrays retained by compiled storage bindings. The sources remain usable for another scene because every `load()` returns fresh data.

Every entry contributes to a single depth pyramid and visibility pipeline. Source `Material.visible` is respected when building immutable batches; invisible surfaces retain their resident geometry but contribute no draw records. `loadMeshletModel(manifestUrl)` loads unique geometry source descriptors, scene transforms and the manifest's material library. The library contains materials and embedded textures without the original model geometry. `residentGeometryBytes` reports uploaded vertices, references, indices and cluster metadata without retaining CPU data.

Standard and physical materials, primary-UV textures, normal maps, alpha-tested foliage and custom surface nodes are supported. Batches share material graphs by source material; public per-object node updates select each draw's resident storage buffers and visible-list offset. Opaque shadow graphs omit surface colour and alpha calculations. Finite invertible affine transforms support rotation, reflection, nonuniform scale and shear. Sphere and error scaling use a conservative bound from the linear transform's Gram matrix; normals use its inverse transpose. The camera must be perspective with standard depth. Occlusion consumes a single-sample depth texture; logarithmic and reversed depth are unsupported. Call `prepare(renderer, camera, viewportSize)` before the shared depth prepass and `recover(renderer, depthTexture)` immediately afterward, before drawing the lit view. Dispose both listeners and the geometry when removing it.

Custom surface nodes retain their world-position and geometric-normal inputs. For explicit UV mappings, `normalMapWithUV(texture, uvNode, scale?)` derives the normal-map tangent frame from those UVs. `tangentNormalWithUV(signedNormalNode, uvNode)` uses the same frame for authored tangent-normal adjustments. This avoids relying on the draw tile's placeholder UV attribute. Ordinary material `normalMap`, `bumpMap` and physical `clearcoatNormalMap` properties use the pulled primary UVs automatically; custom normal nodes retain that UV context too.

`pixelError` controls projected geometric error. `setDebugView('normal' | 'meshlets' | 'lod')` changes the visualization. `setLodEnabled(false)` requests the finest resident clusters inside `fallbackDistance` (default 120 m), subject to the draw budget. With a zero build budget this retains source detail when it fits. The distance cap uses each cluster's bounding sphere. `occlusionEnabled` controls temporal occlusion and current-depth recovery. `readStats(renderer)` asynchronously reads GPU counters for occasional HUD updates; selection and drawing never require CPU readback. `sceneTriangles` counts the LOD-cut triangles reached by hierarchy traversal before leaf frustum and occlusion rejection. `drawnTriangles` and `submittedTriangles` count the actual indexed triangles; there is no tile padding. `resetHistory()` invalidates temporal depth after a discontinuous camera or scene change.

`triangleBudget` defaults to 16,000,000 triangles and must be an even positive integer. Half belongs to the view stream and half to the shadow stream, which both cascades reuse. Together their compacted u32 index buffers occupy 192 MB at the default budget. Budget capacity is independent of resident hierarchy size. Each index encodes a visible-list slot and an eight-bit cluster-local vertex; vertex pulling decodes each reused vertex through the indexed draw. Mirrored placements reverse triangle corners during index compaction.

An overflowing selection raises its effective pixel error and refits the reached hierarchy leaves before writing indices. A bounded sequence of refits ends at the coarsest resident cut, whose full-placement triangle count must fit each stream at creation. The renderer never draws a truncated cut. Budget pressure persists on the GPU across frames and relaxes gradually below 65% occupancy. The same policy applies when requesting finest detail. Stats expose `triangleBudget`, `indexPoolBytes`, requested triangle counts, current and cumulative overflow counts, and effective view/shadow pixel errors. Indexed slots support up to 16,777,216 cluster-instance candidates.

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
3. The look draws the scene's shared depth, normal and motion prepass, including the first visible lists and native terrain, foliage and characters through their existing materials. Geometry owns no depth render target or duplicate depth meshes. `recover` maximum-reduces the supplied depth texture into the pyramid base, then reduces the mip hierarchy.
4. Indirectly recover deferred placements against current depth, traversing newly visible instances through the same hierarchy. Recover deferred clusters against current depth and append survivors to the same batch ranges. Dispatches are bounded by the build's BVH depth. Queue capacity is derived from the maximum combined forest frontier across all placements; leaf capacity covers every resident cluster across those placements. No dispatch spins waiting on other workgroups.
5. Fit the selected cut to its draw budget, prefix the material index ranges and compact the clusters' real triangle indices into the stream. Draw each material range through `BufferGeometry.setIndex` and `setIndirect`, pulling cluster-local vertices from shared storage. Recovery retains the reached leaves for a complete refit if newly visible surfaces exceed the budget. Unchanged index ranges retain their previous contents.

Depth history contains the shared prepass, including first-pass cluster geometry and native opaque scene objects. Omitting recovered geometry from history reduces culling efficiency without making rejection more aggressive. Newly recovered geometry also lacks prepass normal and motion samples for that frame. The lit pass loads the same depth attachment and retains normal material depth writes with less-equal testing so recovered surfaces resolve their overlap. Making lit depth read-only would leave those surfaces without depth ordering.

`prepare` receives the prepass's physical pixel dimensions and captures the actual view and projection matrices, including temporal jitter. `recover` uses those captured matrices for current-depth rejection and saves them with the new pyramid for the next frame. Both callbacks run every frame, including a stationary view. History is renewed only when the shared prepass is consumed. The look owns the depth texture and its lifetime; geometry only retains a sampling binding and its reduced pyramid.

## Current boundary

Geometry and hierarchy are fully resident. Shared vertices use 16-bit position and UV quantization and octahedral normals and tangents, decoded during vertex pulling. Meshlet-local byte triangle indices are unpacked during GPU index compaction. Positions share a quantization lattice across the asset to preserve cluster seams. Binary version 3 adds the traversal forest to this compressed layout; existing assets must be rebuilt. Instance broad phase and hierarchical traversal supply both view and shadow selection. Streaming and software rasterization remain future work.

`buildGltfMeshes(input, output, {minimumError})` and the fourth argument of `buildMeshletGeometry` set the minimum resident object-space error. A zero budget retains source detail. For a positive budget, the builder discards groups whose simplified representation meets it, retains the coarser DAG, and removes unreferenced vertices. The resident boundary becomes the finest available cut in the existing renderer. A scene builder converts a world-space budget with `minimumError = worldError / maximumPlacementScale`, using the largest conservative scale among that mesh's placements. Metadata records source and resident triangle counts and the budget. This is a residency budget for the hierarchy; finer payloads can be restored by a future streaming owner without another selection path. Capped artifacts must be rebuilt from the source to restore omitted groups.

Stats include placement broad-phase counts, hierarchy nodes and clusters visited, and the buffer allocation budget in bytes. Pass the existing look's `timings()` snapshot as `readStats(renderer, timings)` to report view selection GPU milliseconds, including recovery, budget refits and index compaction. This excludes depth rendering, HiZ reduction and shadow traversal; those remain separate named GPU passes. Buffer bytes exclude textures, render targets, driver allocations and the browser.

Surfaces use three's lighting/output path, receive shadows and cast through independent orthographic light-view selection. Perspective light-view selection is not implemented. Skinning, morphs, displacement, blended transparency, secondary UVs, vertex colours, transmission and anisotropy are unsupported for cluster assets. The constructor rejects incompatible material features it can identify. Native scene objects retain their own material and geometry features in the shared prepass. Cluster instances are static after construction.

The implementation uses public three storage, compute, texture and indirect-draw APIs, without renderer patches or private GPU resource access.

Sources: [meshoptimizer](https://github.com/zeux/meshoptimizer), [three storage attributes](https://threejs.org/docs/#StorageBufferAttribute), [three indirect attributes](https://threejs.org/docs/#IndirectStorageBufferAttribute), [public compute rasterization experiment](https://github.com/mrdoob/three.js/pull/33605). [Independent prior art](https://github.com/elad12390/three-virtual-geometry) was reviewed and is not a dependency.
