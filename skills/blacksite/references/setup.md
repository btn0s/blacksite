# Set up

Create the game project from the approved design and prove it runs.

1. Run `blacksite doctor`. It checks Node, pnpm, git, bb and the assets tool.
2. Run `blacksite scaffold --profile <fpp|tpp|mp|blank> --name "<name>" --dir <absolute-dir> --json --gate`. The NDJSON stream ends in `ok` when the shell is installed and `pnpm check` passed. Use `--systems armory,warden,cascade` to add systems, and `blacksite new … --assets id,...` to install owned assets in the same step.
3. Copy the approved `docs/game-design.md` into the project.
4. Run `pnpm build` and `blacksite check dist`. A fresh scaffold passes every check on desktop; this is the bar the game has to stay at.
5. Put the design's numbers into `src/game/model.ts` (SKILL.md, step 1) before writing gameplay code.

## What every profile starts with

The game boots straight into play and fills the viewport, including portrait phones, with a "Click to play" prompt that takes pointer lock. Escape or the pad's Start opens Pause; Main menu, Settings and the developer list of prototypes hang off Pause and support controller navigation. `src/game/mode.tsx` is the profile's game: a walker in the starter yard (`blank`), arms and a rifle (`fpp`), the ALS body and camera (`tpp`), or Relay with the offline loopback (`mp`). The same kit is also listed as `src/prototypes/controller-<profile>`.

| File | What it is | Change it when |
|---|---|---|
| `src/game/model.ts` | `FEEL`, `BUDGET`, `FIXED_STEP` and the motor rule (acceleration, coyote time, jump buffer, jump velocity from apex). Walker movement, ALS gait overrides and the check read it. ALS acceleration is measured by the check; the walker's time to top speed is also asserted. | You tune anything. Never hard-code a number in a component. |
| `src/game/input.ts` | The `play` context for `@blacksite/input`: keyboard, mouse, gamepad and touch bound to `move`, `look`, `jump`, `sprint`, `crouch`, `walk`, `fire`, `aim`, `reload`, `view`, `rifle`, `pistol` and `pause`. `value()`, `held()` and `take()` read it. | You add a verb. Bind every device to it in the same place. |
| `src/game/stage.tsx` | The canvas, `<Look atmosphere="zone">` with `autoQuality()`, sun and fill, fixed-step physics and the yard. It mounts the input runtime and the `play` context. | You change the level, the atmosphere or the lights. |
| `src/game/yard.ts` | A starter yard from `@blacksite/look/world`, `surfaceAt()` for footsteps, and the check bookmarks. | You build the real level. Keep a bookmark on every area that matters. |
| `src/game/walker.tsx` | A kinematic capsule driven by the motor, with footsteps and landings. | The design needs a different body. |
| `src/game/check.tsx` | `CheckProbe`: `window.__blacksite` with bookmarks, camera override, `player()`, `audio()`, input, model and `ready()` once the world has loaded. | The ready condition or player changes. |
| `src/game/sound.ts` | The `@blacksite/soundscape` mixer for the device tier, in the `outdoor` zone. The shell prepares it during loading and starts it on the first gesture. | Rooms need their own zone, or the game needs its own cues. |
| `src/game/footsteps.ts` | Routes ALS foot plants and the camera listener into the mixer. | Surfaces change. |
| `src/game/hud.tsx` | Hints, the prompt and the touch pad (stick, look zone and buttons, all feeding the same actions). | Touch needs another button. |
| `src/architecture.ts` | The one Koota world, the life and phase machines and the Effect event service. | You add game state. Extend it; don't add another store. |

The shell's Settings audio toggle drives the master bus. Bundled world and Subject arm WebP textures are listed by filename in `legacyAssetPaths` in `budget.config.json` until they are converted to KTX2; any texture you add must be KTX2.

## Done when

`pnpm check` and `blacksite check dist` pass, every route opens, and `pnpm dev --host 0.0.0.0` serves the shell. With bb, `bb connect expose 5173` gives the user a link.
