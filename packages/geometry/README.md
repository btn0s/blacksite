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

Standard and physical materials, primary-UV textures, normal maps, alpha-tested foliage and custom surface nodes are supported. Rotation, reflection and nonuniform scale are supported; shear is rejected. The camera must be perspective with standard depth. Occlusion requires single-sample rendering for both the depth target and final camera view; logarithmic and reversed depth are unsupported. Call `prepare` before drawing the camera view and `dispose` when removing the geometry.

Custom surface nodes retain their world-position and geometric-normal inputs. For explicit UV mappings, `normalMapWithUV(texture, uvNode, scale?)` derives the normal-map tangent frame from those UVs. This avoids relying on the draw tile's placeholder UV attribute. Ordinary material `normalMap`, `bumpMap` and physical `clearcoatNormalMap` properties use the pulled primary UVs automatically.

`pixelError` controls projected geometric error. `setDebugView('normal' | 'meshlets' | 'lod')` changes the visualization. `setLodEnabled(false)` selects source-level clusters inside `fallbackDistance` (default 120 m), through the same indirect renderer. The cap uses each cluster's bounding sphere. `occlusionEnabled` controls two-pass occlusion. `readStats(renderer)` asynchronously reads GPU counters for occasional HUD updates; selection and drawing never require CPU readback. `sceneTriangles` counts the selected representation before frustum and occlusion rejection, `drawnTriangles` counts useful visible triangles, and `submittedTriangles` includes degenerate tile padding. `resetHistory()` invalidates temporal depth after a discontinuous camera or scene change.

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

1. Evaluate cluster-instance pairs. Keep a cluster when its own projected error is acceptable and its parent's error exceeds the threshold. Cull its bounding sphere against the camera frustum.
2. Test surviving clusters against the previous frame's depth pyramid and camera. Atomically compact visible IDs into material segments and defer rejected IDs.
3. Draw the first visible lists into a full-resolution depth target, preserving material alpha cutouts. Render the optional `occluders` roots into that same depth attachment with native depth materials, retaining their displaced positions, wind, masks and alpha tests. Maximum-reduce all covered samples into the pyramid base, then reduce the mip hierarchy.
4. Indirectly dispatch recovery over the deferred list using the current camera and depth. Dispatch dimensions are split into two dimensions within WebGPU's guaranteed per-dimension limit; three supplies the flattened invocation index. Append newly visible clusters to their material segments.
5. Draw the final compact lists through `InstancedBufferGeometry.setIndirect`, pulling vertices from shared storage. Each cluster occupies a fixed triangle tile; short clusters use degenerate padding. Counters distinguish useful triangles from submitted triangles.

Depth history contains first-pass geometry and the supplied occluder roots. Omitting recovered geometry from history reduces culling efficiency without making rejection more aggressive. External occluders render their existing geometry directly through the public render-object callback; they are never reparented or copied. Blended transparent materials and materials that do not write depth are excluded from occlusion. Supply terrain and trees as separate roots, without including the cluster scene itself.

## Current boundary

Geometry and hierarchy are fully resident and uncompressed. Selection scans cluster-instance pairs; hierarchical traversal, instance broad-phase culling, streaming, residency budgets, quantization and software rasterization remain future work. Triangle padding incurs vertex work.

Surfaces use three's lighting/output path, receive shadows and cast through independent orthographic light-view selection. Perspective light-view selection is not implemented. Skinning, morphs, displacement, blended transparency, secondary UVs, vertex colours, transmission and anisotropy are unsupported for cluster assets. The constructor rejects incompatible material features it can identify. External occluders may use displaced native node materials. Instances are static after construction.

The implementation uses public three storage, compute, texture and indirect-draw APIs, without renderer patches or private GPU resource access.

Sources: [meshoptimizer](https://github.com/zeux/meshoptimizer), [three storage attributes](https://threejs.org/docs/#StorageBufferAttribute), [three indirect attributes](https://threejs.org/docs/#IndirectStorageBufferAttribute), [public compute rasterization experiment](https://github.com/mrdoob/three.js/pull/33605). [Independent prior art](https://github.com/elad12390/three-virtual-geometry) was reviewed and is not a dependency.
