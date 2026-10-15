---
name: setup-project
description: Create and verify a Blacksite game shell from a design document. Use after design approval or when a new project needs the standard Vite, R3F, Rapier, Koota, XState, Effect, and UI setup.
---

# Set up project

1. Read `docs/game-design.md` and choose `blank`, `tpp`, or `fpp` from approved player count and camera. `fpp` is single-player arms only; `tpp` is ALS third person; `fpp-mp` is listed as unavailable pending real networking. Run `blacksite doctor`, then `blacksite scaffold --profile <profile> --name <name> --dir <absolute-dir> --json --gate`. Done when the NDJSON final result is `ok`.
2. Put the approved design and budget files in the project. Call the Skill tool with "game-architecture" and inspect `src/architecture.ts`. The generated shell has loading/warmup, Main menu, Play, Pause, Settings, GameFrame, developer prototype list, and blank R3F scene. Done when each route is navigable.
3. Run `pnpm check` in the game. Done when lint, typecheck, build, and budget check pass.
