# Set up

Create the game project from the approved design and prove it runs.

1. Run `blacksite doctor`. It checks Node, pnpm, git, bb and the assets tool.
2. Run `blacksite scaffold --profile <fpp|tpp|mp|blank> --name "<name>" --dir <absolute-dir> --json --gate`. The NDJSON stream ends in `ok` when the shell is installed and `pnpm check` passed. Use `--systems armory,warden,cascade` to add systems, and `blacksite new … --assets id,...` to install owned assets in the same step.
3. Copy the approved `docs/game-design.md` into the project. Write `src/game/model.ts` (SKILL.md, step 1) before any gameplay code.
4. Read `src/architecture.ts`. It is the one Koota world, the life and phase machines, the Effect event service, the input writer and the 60 Hz tick. Extend it; don't add another state store.

The shell has loading and warm-up, Main menu, Play, Pause, Settings, the game frame, a developer list of prototypes and an empty scene. Click through every route.

## What the shell doesn't have yet

- **No look.** `src/main.tsx` renders a bare `<Canvas>`. Add the post stack and an atmosphere before the first screenshot: `<Look atmosphere="zone" quality={autoQuality()} />` from `@blacksite/look/r3f`, with the canvas pixel ratio from `internalPixelRatio()` and the tier's `maxPixelRatio`. See `craft.md`.
- **No check contract.** Add `exposeCheck()` from `@blacksite/check` once the first scene exists (`verify.md`).
- **No sound.** The Settings audio toggle isn't wired. See `sound.md`.
- **Bundled textures fail the budget.** `blacksite budget` rejects PNG, JPEG and WebP in `dist`; it wants KTX2. The world kit's WebP textures need converting, or listing in `legacyAssetPaths` until they are.

## Done when

`pnpm check` passes, every route opens, and `pnpm dev --host 0.0.0.0` serves the shell. With bb, `bb connect expose 5173` gives the user a link.
