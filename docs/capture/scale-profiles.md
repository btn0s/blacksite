# Capture: scale profiles

Stage: capture. Status: planned.

A scale profile is one setting per game, `blacksite.profile.ts`, chosen during design (`skills/blacksite/references/design.md`). The camera and scale of the game (first person, third person, top-down, vehicle, air) set the defaults for every expensive system, so an FPS gets bullet holes and short shadow range while an air-strike game gets building collapse and long, low-resolution shadows. Each system can override its value.

Starting presets. These numbers are inputs to the capture work, not decisions:

| Concern | First person | Third person | Top-down / RTS | Vehicle / tank | Air / pilot |
|---|---|---|---|---|---|
| Destruction tier | micro + meso (impacts, decals, chips, wall breach) | meso (props, walls), micro reduced | meso/macro | meso/macro | macro only (buildings, craters) |
| Near-field detail radius | ~30 m | ~60 m | camera footprint | ~150 m | ~1–2 km |
| Streaming radius | ~300 m | ~500 m | map region | ~1.5 km | whole theatre at low LOD |
| Animation update rate | full near, reduced beyond 20 m | full near, reduced beyond 40 m | vertex-animation crowds | crew only | none near |
| Foliage | full + impostors past ~80 m | impostors past ~120 m | impostors/cards only | cards past ~200 m | ground texture + clusters |
| Shadows | 3–4 cascades, short range | 3 cascades | 1–2 cascades | 3 cascades, long | 2 cascades, long, low res |
| AI tick | every frame near, 10 Hz far | same | 5–10 Hz batched | 10 Hz | 2–5 Hz |

The 2.5D and 2D profiles add their own presets; see [diorama-2.5d.md](diorama-2.5d.md).
