# Prototype

Build one risky mechanic on its own, playable from the developer menu, and answer its play question.

1. Read the contract in `docs/game-design.md` and the reference for each block it uses.
2. Run `blacksite prototype new <name> --with <kit> --project <dir>`:
   - `fpp`: arms-only Subject and Armory, first person.
   - `tpp` or `als-tpp`: the ALS body and camera. Read `als.md` first.
   - `mp`: a Colyseus room with an offline loopback and a switchable camera.
   - `subject`, `armory`, `warden`, `cascade`: adds that package and its closure, with an empty mode.
   It writes `src/prototypes/<name>/mode.tsx` and `docs/prototypes/<name>.md`.
3. Build the shipped version of the mechanic, not a placeholder: the row from SKILL.md's table, its feedback, its sound. A prototype that only proves the logic answers the wrong question, because feel is the question.
4. Keep the contract current: inputs, outputs, traits, events, services, state, and what playing it revealed.
5. Run `pnpm check`, play it, and run `blacksite check` on its page with `--only feel,perf`. Write the answer to the play question in the contract.

## Rules that came from prototypes

- **Load on demand.** Each prototype is its own chunk. When the ALS viewmodel brought the whole animation graph into the `fpp` and `mp` scaffolds, the fix was to load gameplay scenes on demand, not to raise the bundle budget. Both scaffolds passed the existing gate unchanged.
- **One copy of every runtime.** A generated game once loaded a second, uninitialized Rapier, and camera collision queries failed silently. Another threw `rawshape_ball` until Vite pre-bundled Rapier once. Check that three, React, React Three Fiber and Rapier each resolve once.
- **Fix vendored errors where they live.** A jump between walk and run speed threw inside the ALS runtime, and each throw skipped a frame. The fix went into the pinned fork. Don't catch or ignore a throw from a vendored runtime.

## Done when

The mode is playable from the developer menu, the gate passes, and the contract records a concrete answer.
