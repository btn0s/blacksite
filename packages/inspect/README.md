# Inspect

Renderer-independent frame sampling, a plain-text debug readout and a Leva control panel. The host owns renderer counters, GPU queries, technique implementations and telemetry storage. Inspect has no renderer dependency and never patches a render method.

```tsx
import { createInspector, type FrameSample } from '@blacksite/inspect'
import { DebugBlock, InspectHud } from '@blacksite/inspect/react'

const inspector = createInspector({
  renderer: 'WebGPU',
  tier: 'high',
  onViewChange: view => landscape.setLodView(view === 'lod'),
})

const unregister = inspector.registerTechnique({
  id: 'terrain-lod',
  label: 'Terrain LOD',
  description: 'Off: full detail within the same bounded terrain',
  enabled: true,
  setEnabled: enabled => terrain.setLodEnabled(enabled),
})

inspector.sample(frame)

<InspectHud inspector={inspector} dump={{ onDump, status: 'idle' }} actions={{ View: [{ label: 'Overview', onPress: overview }] }}>
  <DebugBlock>Host readout lines</DebugBlock>
</InspectHud>
```

The React export imports its stylesheet. `InspectHud` draws the timings as unboxed monospace text in the top-left corner and puts every control (host `actions` button groups, LOD colours, Dump stats and a collapsed Techniques folder) in a Leva panel at the top right; `leva` is an optional peer dependency. Children render below the timings as further `DebugBlock` groups, separated by a blank line. There are exactly two view values: `lit` and `lod`. LOD colours are near green (`#62d995`), mid amber (`#f2c45a`), and far blue (`#80a6ff`); the host applies those colours to its own representations. A later cluster technique can use the same LOD view. Technique registration returns cleanup, and toggles call the registered implementation before publishing their state.

Call `sample` once per presented animation frame after render submission. `frameMs` is elapsed animation-frame time, including stalls; `cpuMs` is main-thread time from the first frame callback through render submission. Do not clamp either to simulation delta. Keep loading and hidden-tab frames out of sampling. The HUD retains up to 1,200 samples spanning approximately ten seconds, publishing at most once per 250 ms by default. `windowFrames`, `windowMs` and `publishIntervalMs` configure those bounds. `flush()` publishes immediately. React subscribes to immutable snapshots, so it does not render at the scene's frame rate.

`FrameSample` contains `sceneTriangles`, `drawnTriangles`, `drawCalls`, `culledPercent`, and optional `gpuMs: { [pass]: milliseconds }`. The caller must use consistent counting scopes: scene and drawn triangles compare the same scene geometry, while draw calls may count all submitted passes. Shadow and post draws must not inflate the scene's drawn triangle count. Culled percentage compares selected-representation triangles before and after visibility selection; triangle reduction from choosing LOD is a different measure. Keep full-detail population triangles separately if useful. GPU values are completed timestamp measurements, never CPU submission duration; omit them when queries are unavailable.

`inspector.history()` returns chronological `frameTimesMs`, `cpuTimesMs`, `gpuTimesMs`, their total `durationMs`, and `frames`, `cpu` and `gpu` distributions with sample count, mean, nearest-rank p50/p95, and maximum. GPU distributions are null when timestamp queries are unavailable. The host combines it with `getSnapshot()`, device and adapter metadata, viewport, player position and view, and POSTs that telemetry to its own endpoint. Call `flush()` before capturing a dump for current counters.

The HUD's optional `DumpControl` supplies `onDump`, optional `status` (`idle`, `sending`, `saved`, `error`) and `message`, shown as text lines. The host binds T to the same callback as the Dump stats button. It owns persistence and may retain an unsuccessful payload for retry. The package adds no global input listener and never captures the host's movement input.
