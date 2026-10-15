---
name: design-game
description: Interview a player one question at a time to define a game fantasy, pillars, core loop, camera, scope, prototypes, and performance budget. Use before building or revising a game.
---

# Design game

1. Ask single-player or multiplayer early, then ask one product question at a time about fantasy, player verbs, three pillars, core loop, camera, target device, scope, and kill list. Record each answer before the next question. Map solo FPP to arms-only Subject and Armory, solo TPP to ALS, and multiplayer FPP/TPP to `mp`. Keep undecided questions open; the user owns design choices. Done when each field and player template has an answer or explicit open marker.
2. Define small independent prototypes. For each, ask what playing it will answer, then record inputs, outputs, Koota traits, XState events, and Effect service interfaces. Call the Skill tool with "game-architecture" for ownership. Use Subject for player control, Armory for weapons, Warden for squad AI, and Cascade for destruction only where the design calls for them. Done when every risky core loop part has a testable prototype contract.
3. If `blacksite assets list --json` shows a synced index, Call the Skill tool with "game-assets" to propose candidates one decision at a time. Otherwise plan image generation or procedural visuals. Done when asset gaps are named without requiring library login.
4. Write `docs/game-design.md` with fantasy, pillars, loop, camera, scope, kill list, target, assets, prototypes, and unresolved questions. Write `budget.config.json` with chunk, total JavaScript, asset, and fixed step budgets based on the user's target. Show the document to the user. Done when the user approves it.
