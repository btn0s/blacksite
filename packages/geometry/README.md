# Cluster geometry

Static cluster geometry for three.js `WebGPURenderer`. The offline tool uses meshoptimizer's cluster hierarchy builder. The runtime selects and culls clusters on the GPU, then renders material batches through three's standard node material and lighting path.

```ts
import { loadGeometryPageSource, MeshletScene } from '@blacksite/geometry'
import { createWebGPULook } from '@blacksite/look/webgpu'
import type { PerspectiveCamera } from 'three/webgpu'

const asset = await loadGeometryPageSource('/assets/scene.directory')
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
  geometry.update(renderer)
  look.beginFrame()
  look.render()
  geometry.endFrame(renderer)
})
```

Entries combine a version 5 geometry directory, immutable instance transforms and source material slots. `loadGeometryPageSource(url)` loads the immutable hierarchy, page ranges and dependency graph. A scene shares each source once across placements. `loadMeshletAsset` and `parseMeshletAsset` remain available for offline CPU geometry work; the renderer accepts page directories only. Older demo manifests need a version 5 bake before using this runtime.

`MeshletScene.create` allocates one shared 1,280 MiB geometry arena, or the device's smaller supported storage-buffer size, and awaits the complete pinned coarse closure. `geometryBytes` can specify a smaller whole-page arena. Request at least twelve storage buffers per shader stage and the desired maximum buffer/storage-binding size when creating the renderer. Vite builds need `worker.format: 'es'` for the page decoder's module worker. Four bounded workers fetch exact ranges, verify their hashes, decode and transfer 128 KiB page images. Geometry never assembles a whole asset. Three reusable 2 MiB staging buffers copy page images through public compute APIs; ordered payload, texture-density and page-table publication passes expose one epoch to all selections. Immutable directory and scratch arrays are uploaded and detached.

Call `update` once before the first render pass and `endFrame` after all passes. `update(renderer, deadline?, uploadAllowance?)` shares a default 0.5 ms scheduling deadline and 8 MiB upload allowance with its caller. When textures also stream, submit their ready work first and pass the remaining allowance and same deadline. Feedback consumption and admission each receive a bounded share. GPU requests carry projected-error importance; missing detail draws its resident coarse representation. Admission preserves all coarser page dependencies. LRU eviction removes only unpinned leaves, unpublishes their mapping, and retires their slots until a tagged feedback readback proves completion of all preceding draws. `setGeometryLimit(bytes)` lowers the working-set limit without reallocating the physical arena. `pagingStats()` reports occupied slots, caps, epochs, completion serials and retirement audits. Await `completeFrame(renderer)` after readiness warmup to prove a fresh rendered frame has completed.

Every entry contributes to a single depth pyramid and visibility pipeline. Source `Material.visible` is respected when building immutable batches; invisible surfaces contribute no draw records. `loadMeshletModel(manifestUrl)` loads unique geometry directories, scene transforms and the manifest's material library. The library contains materials and embedded textures without the original model geometry. `residentGeometryBytes` reports the physical arena allocation; `pagingStats().occupiedSlotBytes` reports populated and retiring slot bytes. Neither includes textures, directories or traversal scratch.

Standard and physical materials, two UV sets, vertex colours, normal maps, alpha-tested foliage and custom surface nodes are supported. Batches share material graphs by source material; public per-object node updates select each draw's resident storage buffers and vertex layout. Opaque shadow graphs omit surface colour and alpha calculations. Finite invertible affine transforms support rotation, reflection, nonuniform scale and shear. Sphere and error scaling use a conservative bound from the linear transform's Gram matrix; normals use its inverse transpose. The camera must be perspective with standard depth. Occlusion consumes a single-sample depth texture; logarithmic and reversed depth are unsupported. Call `prepare(renderer, camera, viewportSize)` before the shared depth prepass and `recover(renderer, depthTexture)` immediately afterward, before drawing the lit view. Dispose both listeners and the geometry when removing it.

Custom surface nodes retain their world-position and geometric-normal inputs. `geometryVertexColor()`, `geometrySecondaryUV()` and `geometryScaleX()` expose authored colour, secondary coordinates and placement scale to surface graphs. For explicit UV mappings, `normalMapWithUV(texture, uvNode, scale?)` derives the normal-map tangent frame from those UVs. `tangentNormalWithUV(signedNormalNode, uvNode)` uses the same frame for authored tangent-normal adjustments. This avoids relying on the draw's placeholder UV attribute. Ordinary material `normalMap`, `bumpMap` and physical `clearcoatNormalMap` properties use the map's selected UV set automatically; custom normal nodes retain that UV context too.

`pixelError` controls projected geometric error. `setDebugView('normal' | 'meshlets' | 'lod')` changes the visualization. `setLodEnabled(false)` requests the finest resident clusters inside `fallbackDistance` (default 120 m), subject to the draw budget. With a zero build budget this retains source detail when it fits. The distance cap uses each cluster's bounding sphere. `occlusionEnabled` controls temporal occlusion and current-depth recovery. `readStats(renderer)` asynchronously reads GPU counters for occasional HUD updates; selection and drawing never require CPU readback. `sceneTriangles` counts the LOD-cut triangles reached by hierarchy traversal before leaf frustum and occlusion rejection. `drawnTriangles` and `submittedTriangles` count the actual indexed triangles; there is no tile padding. `resetHistory()` invalidates temporal depth after a discontinuous camera or scene change.

`triangleBudget` defaults to 16,000,000 triangles and must be an even positive integer. Half belongs to the view stream and half to the shadow stream, which both cascades reuse. Together their compacted u32 index buffers occupy 192 MB at the default budget. Budget capacity is independent of resident hierarchy size. Each index encodes a visible-list slot and an eight-bit cluster-local vertex; vertex pulling decodes each reused vertex through the indexed draw. Mirrored placements reverse triangle corners during index compaction.

Each stream has 1,048,576 selected slots, two 1,048,576-entry frontier buffers and 524,288 reached group-instance pairs. Groups expand during cut evaluation, without cluster-count times placement-count scratch. The complete frustum cut fits before depth or occlusion; recovery changes visibility within that accepted cut. Scratch, triangle or work overflow invalidates the whole attempt and restarts from roots at a coarser error. Three retries end at the certified coarsest resident cut. Creation verifies its full-placement triangles, selected slots, reached groups, frontier width and node/cluster work. Each selection admits at most 4,194,304 instance/node/cluster operations, reserving the final cut before admitting ordinary attempts. View and two shadow selections plus four visibility passes therefore admit at most 16,777,216 operations together. Invalid cuts never produce draw arguments. Triangle and work pressure have separate GPU hysteresis. Stats include `traversalScratchBytes`, `reachedGroups` and `admittedWork`, alongside triangle budget and effective pixel errors.

One submission owner keeps the view/shadow material union using an immutable spatial tree of conservative material bitsets. Its frame query has a fixed node quota; remaining subtrees contribute their complete material sets. Newly visible materials activate immediately. Per-frame bookkeeping visits spatial nodes, without placement scans. Lit, depth and shadow buckets use `BundleGroup` replay with owned materials and override disabled. Depth buckets write their actual normal/motion MRT outputs; shadow buckets own their cull state and coverage. Index storage is explicitly initialized as an index attribute. At readiness, use `look.compile((renderer, camera, scene, pass) => geometry.compile(renderer, camera, scene, pass))` to await every bucket under the actual lit, depth/MRT and both shadow states, including invisible buckets. Coverage, texture binding publication and viewport changes invalidate the bundles. The look orders depth, shadows and AO before lighting, so nested pass draws cannot enter a cluster bundle.

## Sun shadows

Shadow clusters are selected independently from each orthographic cascade camera at `shadowPixelError` (default one shadow texel). They have separate per-material visible ranges and indirect arguments; the main camera's selection and visibility never limit casters. Selection runs again immediately before each cascade renders, so the shared shadow buffers can serve successive cascades without duplicating resident geometry.

Set `shadowLayer` (default 31) to a layer excluded by the view camera and enabled on the sun's cascade cameras. With the shared look:

```ts
const geometry = await MeshletScene.create(renderer, entries, { shadowLayer: 2, shadowPixelError: 1 })
const removeShadowListener = look.onBeforeShadow((renderer, cascadeCamera, mapSize, cascade) => {
  geometry.prepareShadow(renderer, cascadeCamera, mapSize, cascade)
})
```

Pass `shadowLayers: [2]` when creating the look. `setShadowEnabled(false)` disables casting; receiving shadows remains enabled. Source alpha cutouts and primary-UV transforms are preserved in the caster materials. `prepareShadow` expects the actual fitted cascade camera, map size and stable cascade index before the shadow render pass begins. The look initializes both maps, then updates near and far on alternating frames. The skipped cascade retains its map and projection; only the active cascade needs selection and compaction. Dispose the listener when removing the geometry.

## Offline build

```sh
node packages/geometry/scripts/build.mjs input.glb output.meshlets
```

The `@blacksite/geometry/build` export also provides `buildMeshletGeometry` for generated geometry and `buildGltfMeshes` for unique local-space GLTF meshes with separate instance transforms and a material-only GLB. `writeMaterialLibrary` refreshes a material library without rebuilding geometry. See [the build contract](scripts/README.md) for the pinned upstream revision, provenance and binary layout.

## Frame pipeline

1. Test placement spheres against the frustum. Surviving placements seed traversal roots.
2. Traverse meshoptimizer's eight-wide group BVH forest with fixed ping-pong queues and indirect dispatch. Nodes whose conservative projected error meets the threshold are pruned. Accumulate reached group-instance pairs, then evaluate their cluster lists using the DAG's self/parent error rule and precise cluster frustum bounds. Fit the complete frustum cut, restarting from roots for every failed attempt. Only an accepted cut proceeds to visibility and compaction. Test it against previous depth and prefix visible material ranges before compacting indices. No cluster-instance candidate table is stored or scanned.
3. The look draws the scene's shared depth, normal and motion prepass, including geometry's depth buckets and native terrain, foliage and characters. Geometry owns no depth render target. `recover` maximum-reduces the supplied depth texture into the pyramid base, then reduces the mip hierarchy.
4. Re-evaluate current-depth visibility within the accepted cut. Its complete triangle and slot counts already fit, so recovery neither changes LOD nor risks an overflow after the prepass. This keeps the cut consistent with the depth already drawn. No dispatch spins waiting on other workgroups.
5. Prefix current visible material ranges and compact real triangle indices into the same stream. Each selected cluster receives one workgroup; hidden slots do no corner writes. One lane fetches shared metadata and 64 lanes cooperatively write corners. Only counters are reset; the index pool is never cleared. Draw material ranges through `BufferGeometry.setIndex` and `setIndirect`, pulling cluster-local vertices from shared storage.

Depth history contains the shared prepass, including first-pass cluster geometry and native opaque scene objects. Omitting recovered geometry from history reduces culling efficiency without making rejection more aggressive. Newly recovered geometry also lacks prepass normal and motion samples for that frame. The lit pass loads the same depth attachment and retains normal material depth writes with less-equal testing so recovered surfaces resolve their overlap. Making lit depth read-only would leave those surfaces without depth ordering.

`prepare` receives the prepass's physical pixel dimensions and captures the actual view and projection matrices, including temporal jitter. `recover` uses those captured matrices for current-depth rejection and saves them with the new pyramid for the next frame. Both callbacks run every frame, including a stationary view. History is renewed only when the shared prepass is consumed. The look owns the depth texture and its lifetime; geometry only retains a sampling binding and its reduced pyramid.

## Current boundary

Hierarchy directories are resident; geometry payloads stream through the shared page arena. Shared vertices use 16-bit position and UV quantization and octahedral normals and tangents, decoded during vertex pulling. The base vertex occupies 16 bytes. Authored tangents, RGBA8 colour and quantized secondary UVs each add four bytes only when present. Metadata describes attribute offsets, stride and secondary UV bounds. Meshlet-local byte triangle indices are unpacked during GPU index compaction. Positions share a quantization lattice across the asset to preserve cluster seams. Version 5 directories and encoded page packs are required. Instance broad phase and hierarchical traversal supply both view and shadow selection. World-cell directory streaming and software rasterization remain future work.

`buildGltfMeshes(input, output, {minimumError})` and the fourth argument of `buildMeshletGeometry` set the minimum retained object-space error. A zero budget retains source detail. For a positive budget, the builder discards groups whose simplified representation meets it, retains the coarser DAG, and removes unreferenced vertices. A scene builder converts a world-space budget with `minimumError = worldError / maximumPlacementScale`, using the largest conservative scale among that mesh's placements. Metadata records source and retained triangle counts and the budget. Capped artifacts must be rebuilt from the source to restore omitted groups. Runtime residency chooses among the cuts present in the page pack.

Stats include placement broad-phase counts, hierarchy nodes and clusters visited, and the buffer allocation budget in bytes. Pass the existing look's `timings()` snapshot as `readStats(renderer, timings)` to report view selection GPU milliseconds, including recovery, budget refits and index compaction. This excludes depth rendering, HiZ reduction and shadow traversal; those remain separate named GPU passes. Buffer bytes exclude textures, render targets, driver allocations and the browser.

Surfaces use three's lighting/output path, receive shadows and cast through independent orthographic light-view selection. Perspective light-view selection is not implemented. Skinning, morphs, displacement, blended transparency, UV sets beyond the second, transmission and anisotropy are unsupported for cluster assets. The constructor rejects incompatible material features it can identify. Native scene objects retain their own material and geometry features in the shared prepass. Cluster instances are static after construction.

The implementation uses public three storage, compute, texture and indirect-draw APIs, without renderer patches or private GPU resource access.

Sources: [meshoptimizer](https://github.com/zeux/meshoptimizer), [three storage attributes](https://threejs.org/docs/#StorageBufferAttribute), [three indirect attributes](https://threejs.org/docs/#IndirectStorageBufferAttribute), [public compute rasterization experiment](https://github.com/mrdoob/three.js/pull/33605). [Independent prior art](https://github.com/elad12390/three-virtual-geometry) was reviewed and is not a dependency.
