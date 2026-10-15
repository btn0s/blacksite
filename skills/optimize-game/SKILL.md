---
name: optimize-game
description: Bring a playable Blacksite game within its performance budget. Use after integration or when a game misses its budget.
---

# Optimize game

1. Run `blacksite budget` and compare output with `budget.config.json`. Profile desktop for 120 fps and mobile for sustained 60 fps, 120 where possible, on suitable devices. Record the largest costs. Done when bottlenecks are measured on both targets.
2. Compress assets, stage loading with warmup, and split code at game and prototype boundaries. On mobile, reduce resolution, effect resolution, distance and density, then update rates before simplifying materials and lighting. Keep the synchronous tick free of allocation and I/O. Done when each measured bottleneck has a concrete change.
3. Run `pnpm check` and `blacksite budget` again. Done when configured limits pass and the game remains playable.
