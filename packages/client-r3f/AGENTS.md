# Client R3F

Purpose: Warden's React Three Fiber demonstration client and inspector. This package exports `/App`, `/Scene`, and `/main`, with no root export. A game can study or embed the scene contract, but should own its own app entry and visual design. `App` imports local `ai-schema` source and starts a worker-based tactical simulation; it is not a generic player controller. Keep simulation state in the worker/runtime and render snapshots in React. See `src/App.tsx` and `src/Scene.tsx`.
