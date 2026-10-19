# Milestone 2 boundary

The complete level has not loaded or walked. There are no headed overview, walk or LOD captures, no frame-rate claim, and no measurements at player positions. The selection implementation remains unverified on the full-level GPU workload.

Preview: https://desktop-5dkfbp1--5248.getbb.app. The scheduled dev server remains on port 5248. The incomplete build is reported as a load failure. The other preview ports and tasks were left alone.

At a single 0.03 m world-space resident error, the first 260 of 371 referenced component-local geometries produced these numbers. All 20,430 placements remain in the source build plan; none were filtered out.

| Quantity | Measured build snapshot |
| --- | ---: |
| Source triangles in these 260 geometries | 177,678,599 |
| Finest resident cut triangles | 55,349,589 |
| Source triangles removed from that cut | 122,329,010 (68.85%) |
| Geometry files | 4,288,675,968 bytes |
| Packed vertex buffer required | 2,164,526,400 bytes |
| Packed index buffer required | 1,325,826,540 bytes |
| Cluster selection records | 103,915,200 bytes |
| Traversal nodes | 4,456,896 bytes |
| Geometry buffer lower bound | 3,598,725,036 bytes |
| Chrome maximum storage-buffer binding | 2,147,483,644 bytes |

These are calculated resource requirements from the built assets, not allocated GPU residency. They exclude instance records, queue capacities, material textures, render targets, the browser and driver allocations. This is a partial-level lower bound, not a whole-level total.

Desktop Chrome, launched headlessly at 1920 by 1080 through the installed Chrome channel, selected the NVIDIA Ampere adapter. A public `GPUAdapter.requestDevice` call with the vertex-buffer requirement above failed with `OperationError`: required limit 2,164,526,400 exceeds supported limit 2,147,483,644, while validating `maxStorageBufferBindingSize`. The offline build was stopped at this boundary. The server remains available; completed owned artifacts remain under `D:/dev/owned-assets/dark-ruins/level`.

Material preparation completed for 302 used source materials. Seventy-nine are outside the shared translator's custom-general family, and 42 custom-general materials enable features the existing translator rejects. One source material explicitly enables a vertex-colour metallic mask; the geometry format currently omits vertex colours. Unimplemented families are retained as untranslated source descriptors and explicitly rejected. No substitute shader or replacement geometry was introduced. The export supplies sampled textures and parameters rather than a complete portable shader graph.

The new selector first tests instance spheres against the frustum and previous HiZ depth. Surviving instances seed meshoptimizer's eight-wide `clodBuildHierarchy` forest. Ping-pong GPU queues use indirect dispatch at each bounded BVH depth; group leaves evaluate the DAG's existing self/parent error cut. Rejected instances and clusters recover against current depth. Material counts, a prefix and a scatter produce compact cluster-instance draw records. The flat candidate table and scans are removed, including shadow selection. The forest has one root per DAG level and visits each group once, avoiding an instance-by-group visitation allocation. Sources: [meshoptimizer's pinned hierarchy reference](https://github.com/zeux/meshoptimizer/blob/f0a684f11ead064e176775c9b796f82a55910e92/demo/clusterlod.h), [GPU task queues and repeated indirect execution](https://gpuopen.com/learn/gpu-work-graphs/gpu-work-graphs-part2/), and [three's public renderer API](https://threejs.org/docs/pages/Renderer).

The detail budget removes fine groups from the existing hierarchy and compacts only unreferenced vertices and indices. One world-space error is divided by each mesh's largest placement scale. The current renderer's resident boundary becomes its finest selectable cut. The capped artifact must be rebuilt from source to recover omitted groups; future streaming owns that resident boundary. No alternative low-detail renderer was added.

The full-level example reads authoritative placement matrices once, resolves material slots through primitive mappings, derives environment controls from the export, retains ALS, activates local collision through a spatial index, and reuses the existing inspector. The HUD code exposes tested and culled instances, nodes and clusters visited, selection pass timings and buffer requirements. Those counters have not been measured on a loaded full level.

## Compression merge

- Keep milestone 1's vertex/index encoding and decode path. This branch changes the visible-record lookup in `runtime-vertex.ts` to a compact cluster-instance pair and a GPU material-segment offset; its vertex reader is unchanged.
- Combine hierarchy pruning and compaction in `build-native.cpp` before compressed resident serialization. Preserve `minimumError`, source/resident triangle counts, `nodeData` and `nodeBounds`.
- Merge node and instance selection packing in `runtime-data.ts` around milestone 1's resident storage packing. No per-cluster-instance candidate data remains.
- Reconcile the binary revision once for the combined format. This branch uses version 2 and appends traversal sections 11 and 12; independently changed resident layouts need one shared version and an owned-asset rebuild.

## Follow-ups

1. Merge compressed storage and rebuild all referenced geometry, then verify the complete buffer footprint against adapter limits.
2. Supply authored translations for the remaining material families and features, including their required vertex attributes.
3. Load all placements in headed desktop Chrome, walk ALS, capture the requested three views and record actual selection, GPU and frame times at several positions.
4. Profile draw padding, material submissions, texture residency and local collision after the complete level runs. Streaming can then restore full source detail through the same residency boundary.

No tests, gates, baselines or performance comparisons were run. No owned content was committed. Nothing was pushed.
