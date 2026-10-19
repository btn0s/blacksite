# Cluster geometry

Static cluster geometry for three.js `WebGPURenderer`. The offline tool uses meshoptimizer's cluster hierarchy builder. The runtime selects and culls clusters on the GPU, then renders material batches through three's standard node material and lighting path.

```ts
import { loadMeshletAsset, MeshletScene } from '@blacksite/geometry'

const asset = await loadMeshletAsset('/assets/scene.meshlets')
const geometry = new MeshletScene([
  { asset, instances: matrices, materials: [material] },
], { pixelError: 2, occlusion: true })
scene.add(geometry.object)
await renderer.init()
renderer.setAnimationLoop(() => {
  geometry.prepare(renderer, camera, { occluders: [terrain.object, forest.object] })
  renderer.render(scene, camera)
})
```

Entries combine an asset, immutable instance transforms and source material slots. Shared assets occupy storage once, while shared material objects form one indirect batch. Every entry contributes to a single depth pyramid and visibility pipeline. `loadMeshletModel(manifestUrl)` loads unique geometry assets, scene transforms and the manifest's material library. The library contains materials and embedded textures without the original model geometry.

Standard and physical materials, primary-UV textures, normal maps, alpha-tested foliage and custom surface nodes are supported. Finite, invertible affine transforms are supported, including shear. Bounds and error use a conservative upper bound on the largest singular value; normals retain the inverse transpose. The camera must be perspective with standard depth. Occlusion requires single-sample rendering for both the depth target and final camera view; logarithmic and reversed depth are unsupported. Call `prepare` before drawing the camera view and `dispose` when removing the geometry.

Custom surface nodes retain their world-position and geometric-normal inputs. For explicit UV mappings, `normalMapWithUV(texture, uvNode, scale?)` derives the normal-map tangent frame from those UVs. `tangentNormalWithUV(signedNormalNode, uvNode)` uses the same frame for authored tangent-normal adjustments. This avoids relying on the draw tile's placeholder UV attribute. Ordinary material `normalMap`, `bumpMap` and physical `clearcoatNormalMap` properties use the pulled primary UVs automatically; custom normal nodes retain that UV context too.

`pixelError` controls projected geometric error. `setDebugView('normal' | 'meshlets' | 'lod')` changes the visualization. `setLodEnabled(false)` selects source-level clusters inside `fallbackDistance` (default 120 m), through the same indirect renderer. The cap uses each cluster's bounding sphere. `occlusionEnabled` controls two-pass occlusion. `readStats(renderer)` asynchronously reads GPU counters for occasional HUD updates; selection and drawing never require CPU readback. `sceneTriangles` counts the LOD-cut triangles reached by hierarchy traversal before leaf frustum and occlusion rejection, `drawnTriangles` counts useful visible triangles, and `submittedTriangles` includes degenerate tile padding. `resetHistory()` invalidates temporal depth after a discontinuous camera or scene change.

## Sun shadows

Shadow clusters are selected independently from each orthographic cascade camera at `shadowPixelError` (default one shadow texel). They have a separate compacted list and indirect arguments; the main camera's selection and visibility never limit casters. Selection runs again immediately before each cascade renders, so the shared shadow buffers can serve successive cascades without duplicating resident geometry.

Set `shadowLayer` (default 31) to a layer excluded by the view camera and enabled on the sun's cascade cameras. With the shared look:

```ts
const geometry = new MeshletScene(entries, { shadowLayer: 2, shadowPixelError: 1 })
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
2. Traverse meshoptimizer's eight-wide group BVH forest with ping-pong queues and indirect dispatch. Nodes whose conservative projected error is below threshold are pruned. At group leaves, evaluate the bounded cluster list using the DAG's self/parent error rule and precise cluster frustum bounds. Test survivors against previous depth and defer hidden clusters. Count visible records by material, prefix their segments and scatter cluster-instance pairs into one compact draw list. No cluster-instance candidate table is stored or scanned.
3. Draw the first visible lists into a full-resolution depth target, preserving material alpha cutouts. Render the optional `occluders` roots into that same depth attachment with native depth materials, retaining their displaced positions, wind, masks and alpha tests. Maximum-reduce all covered samples into the pyramid base, then reduce the mip hierarchy.
4. Indirectly recover deferred placements against current depth, traversing newly visible instances through the same hierarchy. Recover deferred clusters against current depth, then compact material segments again. Dispatches are bounded by the build's BVH depth and the configured queue capacity; no dispatch spins waiting on other workgroups.
5. Draw the final compact lists through `InstancedBufferGeometry.setIndirect`, pulling vertices from shared storage. Each cluster occupies a fixed triangle tile; short clusters use degenerate padding. Counters distinguish useful triangles from submitted triangles.

Depth history contains first-pass geometry and the supplied occluder roots. Omitting recovered geometry from history reduces culling efficiency without making rejection more aggressive. External occluders render their existing geometry directly through the public render-object callback; they are never reparented or copied. Blended transparent materials and materials that do not write depth are excluded from occlusion. Supply terrain and trees as separate roots, without including the cluster scene itself.

## Current boundary

Geometry and hierarchy are resident and uncompressed. Instance broad phase and hierarchical traversal replace the flat scan for both view and shadow selection. `selectionCapacity` bounds each GPU queue and visible list (default 2,097,152 records); overflow is reported as an error by `readStats`, never treated as a successful selection. Streaming, quantization and software rasterization remain future work. Triangle padding incurs vertex work.

`buildGltfMeshes(input, output, {minimumError})` and the fourth argument of `buildMeshletGeometry` set the minimum resident object-space error. The builder discards groups whose simplified representation meets that budget, retains the coarser DAG, and removes unreferenced vertices. The resident boundary becomes the finest available cut in the existing renderer. A scene builder converts one global world-space budget through the largest scale of each mesh's placements. Metadata records source and resident triangle counts and the budget. This is a residency budget for the hierarchy; finer payloads can be restored by a future streaming owner without another selection path. Capped artifacts must be rebuilt from the source to restore omitted groups.

Stats include placement broad-phase counts, hierarchy nodes and clusters visited, and the buffer allocation budget in bytes. Pass the existing look's `timings()` snapshot as `readStats(renderer, timings)` to report view traversal GPU milliseconds, including recovery and material compaction. This excludes depth rendering, HiZ reduction and shadow traversal; those remain separate named GPU passes. Buffer bytes exclude textures, render targets, driver allocations and the browser.

Surfaces use three's lighting/output path, receive shadows and cast through independent orthographic light-view selection. Perspective light-view selection is not implemented. Skinning, morphs, displacement, blended transparency, secondary UVs, vertex colours, transmission and anisotropy are unsupported for cluster assets. The constructor rejects incompatible material features it can identify. External occluders may use displaced native node materials. Instances are static after construction.

The implementation uses public three storage, compute, texture and indirect-draw APIs, without renderer patches or private GPU resource access.

Sources: [meshoptimizer](https://github.com/zeux/meshoptimizer), [three storage attributes](https://threejs.org/docs/#StorageBufferAttribute), [three indirect attributes](https://threejs.org/docs/#IndirectStorageBufferAttribute), [public compute rasterization experiment](https://github.com/mrdoob/three.js/pull/33605). [Independent prior art](https://github.com/elad12390/three-virtual-geometry) was reviewed and is not a dependency.
