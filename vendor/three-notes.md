# three.js renderer changes

The `vendor/three` submodule tracks `btn0s/three.js`, branch `blacksite`.
Its base is `9b4a2ac29c63ccb43fd51c5661f2f873ac2c39b8`, the npm
`three@0.186.1` publication commit (`r186 (bis)`), rather than the earlier
`r186` tag. The workspace override resolves direct and transitive `three`
dependencies to this checkout. Rebuild its published modules with
`pnpm --filter three build` after editing source.

## Async compilation and pass state

`PassNode.compileAsync` previously retained its render target and MRT until
compilation completed. Node graph construction could yield while another pass
changed those renderer properties. Shader outputs could then disagree with
the pipeline's attachment layout.

Compilation now captures pass configuration, collects source objects, and
prepares each object's graph and pipeline inside a synchronous state scope.
Renderer, scene and render-context state are restored before every GPU wait
or yield. `PassNode` restores its caller's target, MRT, cube face and mip level
immediately after dispatch. Concurrent callers share the pending pipeline
creation promise.

Compilation owns its node-frame update maps. It reads the live clock without
advancing it and does not commit after-draw history for work that did not draw.

The deliberate tradeoff is atomic graph construction for one material.
Compilation still yields between objects and awaits GPU pipeline creation.
Scene objects and cameras retain their normal identities; this does not
freeze the world while compiling.

## Bundle compilation, overrides and storage indices

Compilation visits nested bundle render lists. Replay traverses the cached
source list through `renderObject`, using an update-only handler before
executing the recorded GPU bundle. This preserves source callbacks and the
temporary override-material lifecycle. Override state is restored in
`finally`, including alpha coverage, transparency and displacement fields.

Storage-created attribute buffers include `INDEX` usage, so a buffer first
used by compute can subsequently become a geometry index without an
application-side backend allocation call. This is independent of visiting
bundle geometry during compilation.

Bundle structure and binding-resource replacements still follow the public
`BundleGroup.needsUpdate` contract.

## Unchanged node-material bindings

Node callbacks run before the refresh decision. The observer checks compiled
bindings instead of unconditionally requesting a full update for every node
material. It reuses uniform-buffer value comparisons and pending upload
ranges, and observes shared-group versions, texture references/versions and
storage-attribute versions.

Shared frame uniforms and per-object callbacks continue running. Mutable
uniforms still require comparisons; unversioned raw uniform buffers,
dynamic storage, video and external textures remain conservative. This skips
unnecessary geometry and binding work rather than promising zero material
work.

## Fresh bindings after texture replacement

New render objects can reuse cached shader state in another camera or nested
render context. Its cloned texture bindings can still contain a retired
texture, even though the texture node already references the replacement.
Binding initialization previously uploaded that stale texture before its
first update.

Initialization now refreshes sampled textures and samplers before allocating
resources. It records the current texture generation, disposal membership and
sampler identity at the same time. Separate render contexts retain their
normal identities.

## Fork commits

- `f7846fd`: isolate asynchronous compilation state.
- `363e20e`: preserve bundle source materials and compile indexed draws.
- `126128b`: refresh only changed node bindings.
- `5a6f0fe`: refresh texture references before binding initialization.

The generated browser modules are recorded separately in `e26e5b7`.

## Application integration

The warmup queue prioritizes materials in the initial camera and both shadow
frusta. Readiness follows their compilation, one visible geometry frame and
a GPU fence; remaining materials compile between rendered frames.

Removed: the render-pause warmup barrier, renderer state held across awaits,
bare-mesh compilation that bypassed bundles, and explicit backend index
allocation. Pinned-page initialization now waits for decoder completion or
GPU fences and overlaps independent compute preparation.

Custom depth/shadow materials remain: their pulled geometry, UV context,
coverage and opaque batching are required rendering behavior. The explicit
depth/shadow/AO dependency ordering also remains because nested render-pass
recording is a separate concern.
