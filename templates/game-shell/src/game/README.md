# Game

The Play entry loads `mode.tsx`. Every profile starts from the same parts:

- `model.ts`: feel and budget numbers plus the motor rule. The game and `blacksite check` both read it; change a number here, never in a component.
- `input.ts`: the `play` context for `@blacksite/input`. Keyboard, mouse, gamepad and touch all bind to the same actions (`move`, `look`, `jump`, `sprint`, `crouch`, `walk`, `fire`, `aim`, `reload`, `view`, `rifle`, `pistol`, `pause`).
- `stage.tsx`: the canvas, `@blacksite/look` with `autoQuality()`, sun and fill, fixed-step physics and the starter yard.
- `yard.ts`: the starter yard built from `@blacksite/look/world`, plus the check bookmarks. Replace it with your level.
- `walker.tsx`: a kinematic character driven by the model's motor.
- `check.tsx`: the `window.__blacksite` contract: bookmarks, camera override, player, audio, input and model, with `ready()` when the world is loaded.
- `hud.tsx`: hints, the click-to-play prompt and the touch pad.
- `sound.ts`: the `@blacksite/soundscape` mixer for this device tier, in the `outdoor` zone. The shell prepares it during loading, starts it on the first gesture (which starts the wind bed) and drives the master bus from Settings; the check reads `sound.sample()`.
- `footsteps.ts`: routes ALS foot plants and the camera listener into the mixer. `surfaceAt` in `yard.ts` picks `concrete`, `metal`, `dirt` or `water`; the walker uses the same function.

Play a sound by cue name with a world position: `sound.play('impact.metal', { position, delay: true })`. Register your own cues with `sound.registerCue`.
