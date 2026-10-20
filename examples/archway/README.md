# Dark Ruins preview

This development entry opens the [whole Dark Ruins level](../ruins/README.md). The game, asset loader and camera views live in `examples/ruins/src/`.

```sh
pnpm --dir examples/archway dev --port 5247
```

The default URL opens the playable Spawn view. Overview frames the entire rendered level; Archway, Pits and Cliffs frame landmarks from the placed mesh bounds. R returns to spawn. T saves telemetry to `artifacts/archway/telemetry/snapshots.jsonl`.

Owned geometry, materials and regional collision are served from `/owned/dark-ruins/full.json`. Their immutable build directories remain outside Git. See the whole-level example for its build procedure.
