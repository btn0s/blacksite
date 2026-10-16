# Input

`@blacksite/input` is an input runtime: contexts with priorities, bindings with triggers (`down`, `pressed`, `pulse`), gamepad classification and glyphs, console-style menu navigation, settings and aim assist. `@blacksite/ui/hud` has the touch stick (`TouchPad`) and `useTouch` the showcases use.

## Guides

- `packages/input/README.md`: the runtime, contexts, triggers, the action hub, aim assist, settings, touch controls, console navigation and glyphs.
- `packages/input/AGENTS.md`: clear held input on blur, disconnect and possession change.
- `packages/ui/README.md`, "Game HUD": `TouchPad` and `useTouch`.

## Standard use

- One `makeInputDevices()` per client, provided with `<InputProvider runtime={…}>`, or `inputDevicesLayer` from `@blacksite/input/effect` in an Effect 3 app.
- Move and look through `actions.value(action)`: sticks, mouse delta (only under pointer lock), touch joystick (`setTouchStick`) and touch drag (`addTouchLook`) are summed with their modifiers. Scale mouse and touch look per pixel; scale the right stick with `scaleByDeltaTime`.
- Gameplay bindings with `createGameplayContext([...GAMEPLAY.bindings, …])`, switched with `useInputContext(play, inGame)` and `useInputContext(MENU, !inGame)`.
- `useActionEvents` for edges and `useActionHeld` for held state; `useInputSource()` for glyphs.
- Touch: `TouchPad` from `@blacksite/ui/hud` for a stick and look zone, `TouchControls` for buttons.

## Numbers

| Number | Value |
|---|---|
| Gamepad activity threshold | 0.25 |
| Menu stick as a button | 0.55; repeat after 0.35 s, then every 0.16 s |
| Sensitivity | 1 by default, 0.25–2 |
| Aim assist | Slowdown 0.55 in a 1.75° cone, magnetism 0.3 in 2.5°, snap 2.5° over 0.16 s in 4°; half on hip fire |
| Touch buttons | 52 px, at least 44 px |
| Touch stick | 124 px, 52 px knob; look zone is the right 60% |

## What isn't there yet

- The showcases still drive characters with synthetic key events from `TouchPad`, `keySubject` or `StandaloneTouch`. Every scaffolded game uses the runtime (`src/game/input.ts`).
- No rebinding UI or saved bindings; settings aren't consumed.
- Aim assist needs a target-candidate builder that doesn't exist.
- `TouchPad` has no dead zone; put 0.1–0.15 on the binding with a `deadZone` modifier.

## Rules

- **Pointer lock is optional** (`feel.md`): skip it on touch, catch refusals, and keep a virtual input path.
- **Clear on blur.** A key held while the tab loses focus must release, or the player walks forever.
- **Show the right glyphs.** Swap prompts to the last device used.
- **Everything playable by touch at 390 px wide**, with the HUD clear of the focal point.
