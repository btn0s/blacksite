# Game

The Play entry loads `mode.tsx`. Every profile starts from the same parts:

- `model.ts`: feel and budget numbers plus the motor rule. The game and `blacksite check` both read it; change a number here, never in a component.
- `input.ts`: the `play` context for `@blacksite/input`. Keyboard, mouse, gamepad and touch all bind to the same actions (`move`, `look`, `jump`, `sprint`, `crouch`, `walk`, `fire`, `aim`, `reload`, `view`, `rifle`, `pistol`, `pause`).
- `stage.tsx`: the canvas, `@blacksite/look` with `autoQuality()`, sun and fill, fixed-step physics and the starter yard.
- `yard.ts`: the starter yard built from `@blacksite/look/world`, plus the check bookmarks. Replace it with your level.
- `walker.tsx`: a kinematic character driven by the model's motor.
- `check.tsx`: the `window.__blacksite` contract: bookmarks, camera override, player, audio, input and model, with `ready()` when the world is loaded.
- `hud.tsx`: hints, the click-to-play prompt and the touch pad.
- `sound.ts`: the sound hook. Cues are already named (`footstep.concrete`, `landing.concrete`, `weapon.rifle`, `impact.concrete`).

## Sound

`sound.ts` exports a silent stand-in until `@blacksite/soundscape` is installed. To turn it on, replace its last line with:

```ts
export const sound: Sound = createSoundscape({ tier: soundTier, voiceCap })
```

and import `createSoundscape` from `@blacksite/soundscape`. Nothing else changes: the shell already starts it on the first gesture, sets the `outdoor` zone and drives the master bus from Settings, and the check already reads `sound.sample()`.
