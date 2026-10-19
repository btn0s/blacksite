# Inspect

Renderer-independent frame sampling and a compact React HUD. The host owns renderer counters, GPU queries, technique implementations and telemetry storage. Inspect has no renderer dependency and never patches a render method.

```tsx
import { createInspector, type FrameSample } from '@blacksite/inspect'
import { InspectHud } from '@blacksite/inspect/react'

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

<InspectHud inspector={inspector} dump={{ onDump, status: 'idle' }} />
```

The React export imports its stylesheet. There are exactly two view values: `lit` and `lod`. LOD colours are near green (`#62d995`), mid amber (`#f2c45a`), and far blue (`#80a6ff`); the host applies those colours to its own representations. A later cluster technique can use the same LOD view. Technique registration returns cleanup, and toggles call the registered implementation before publishing their state.

Call `sample` once per presented animation frame after collecting the final frame counters. `frameMs` is elapsed animation-frame time, including stalls. Do not clamp it to simulation delta. Keep loading and hidden-tab frames out of sampling. The HUD retains up to 1,200 samples spanning approximately ten seconds, publishing at most once per 250 ms by default. `windowFrames`, `windowMs` and `publishIntervalMs` configure those bounds. `flush()` publishes immediately. React subscribes to immutable snapshots, so it does not render at the scene's frame rate.

`FrameSample` contains `sceneTriangles`, `drawnTriangles`, `drawCalls`, `culledPercent`, and optional `gpuMs: { [pass]: milliseconds }`. The caller must use consistent counting scopes: scene and drawn triangles compare the same scene geometry, while draw calls may count all submitted passes. Shadow and post draws must not inflate the scene's drawn triangle count. Culled percentage compares selected-representation triangles before and after visibility selection; triangle reduction from choosing LOD is a different measure. Keep full-detail population triangles separately if useful. GPU values are completed timestamp measurements, never CPU submission duration; omit them when queries are unavailable.

`inspector.history()` returns chronological `frameTimesMs`, their total `durationMs`, and a `frames` distribution with sample count, mean, nearest-rank p50/p95, and maximum. The host combines it with `getSnapshot()`, device and adapter metadata, viewport, player position and view, and POSTs that telemetry to its own endpoint. Call `flush()` before capturing a dump for current counters.

The HUD's optional `DumpControl` supplies `onDump`, optional `status` (`idle`, `sending`, `saved`, `error`) and `message`. The host binds T to the same callback as the HUD button. It owns persistence and may retain an unsuccessful payload for retry. The package adds no global input listener and never captures the host's movement input.
