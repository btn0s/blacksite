---
name: build-prototype
description: Build one playable game mechanic in isolation under a Blacksite game's developer menu. Use for each design risk before integration.
---

# Build prototype

1. Read the approved design question and player mode, then Call the Skill tool with "game-architecture". Use `--with fpp` for solo arms-only Subject and Armory, `--with tpp` for ALS third person, `--with mp` for a Colyseus room with offline loopback and switchable FPP/TPP camera, or `--with subject|armory|warden|cascade` to add a focused system dependency. Run `blacksite prototype new <name> --with <kit> --project <dir>`. Done when `src/prototypes/<name>/mode.tsx` and `docs/prototypes/<name>.md` exist.
2. Implement the behavior needed to answer the question, using Blacksite kit pieces where appropriate. Keep its contract current: inputs, outputs, Koota traits, machine events, service interface, state, and what play revealed. Done when the mechanic is playable from the developer menu.
3. Run `pnpm check` and play the mode. Record the learned answer in the contract. Done when the gate passes and the design question has a concrete answer.
