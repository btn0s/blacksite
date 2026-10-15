# @blacksite/input

One browser input runtime for keyboard, mouse, touch, and standard mapped gamepads. `react` and `effect` are peer dependencies. The package has source exports and no asset dependency.

## Contract

Create one `makeInputDevices()` runtime per client. `InputProvider` mounts its browser listeners and single `requestAnimationFrame` gamepad poll. In an Effect application, provide `inputDevicesLayer` and run `InputDevices.listen` in a scope instead. Do not mount both ownership paths for the same runtime. `snapshot()`, `subscribe()`, `onFrame()`, `activePad()`, and `rumble()` expose the selected pad and device state. `onFrame` receives a pad only after `setGameplay(true)` and neutral input; `prime()` re-arms that gate after a transition. Menu actions continue to receive the selected pad while gameplay is gated. The runtime classifies Xbox, PlayStation, and generic layouts, remembers the active pad, and clears rumble on blur or gameplay exit.

`MENU` is the default exclusive context; `MODAL` has higher priority. `GAMEPLAY` contains only pause. Add game actions with `createGameplayContext(bindings)`, then mount them with `useInputContext`. An action is a string chosen by the game. Bindings describe controls, modifiers, and `down`, `pressed`, or `pulse` triggers. A higher priority context owns each action name, and an exclusive context stops evaluation of lower contexts. The pure `winningBindings` and `createEvaluator` exports work outside React. The first sample primes already held controls; `pressed` emits once per release and press, while `pulse` emits immediately on a new press, then after 350 ms and every 160 ms. `makeActionHub()` owns context registration and action subscriptions. `setTouchButton` lets a custom touch surface feed a configured touch button binding.

```tsx
import { GAMEPLAY, InputProvider, MENU, createGameplayContext, makeInputDevices, useInputContext } from "@blacksite/input"

const runtime = makeInputDevices()
const play = createGameplayContext([
  ...GAMEPLAY.bindings,
  { action: "jump", control: { device: "gamepad", button: 0 }, trigger: "pressed" },
  { action: "jump", control: { device: "keyboard", key: "Space" }, trigger: "pressed" },
])

function Screen({ inGame }: { inGame: boolean }) {
  useInputContext(MENU, !inGame)
  useInputContext(play, inGame)
  return null
}

function App() {
  return <InputProvider runtime={runtime}><Screen inGame={false} /></InputProvider>
}
```

The host owns action meanings, gameplay sampling, target eligibility, line of sight, and game state transitions. `createAimAssist` accepts already filtered candidates and modifies gamepad look deltas; call `reset()` after target or device changes. It never assists mouse input unless the host explicitly passes it. `normalizeControlSettings` and `readControlSettings(storage, storageKey)` retain echelon's sensitivity and inversion options with a caller owned storage key. `TouchControls` is an optional text button surface. Pass `runtime.actions.setTouchButton` as `onButton` and bind `{ device: "touch", button: "jump" }` in a context. The host can provide its own joystick and touch look implementation.

## Console UI

`useConsoleNavigation` holds visual selection without moving DOM focus. Selection is marked with `data-console-selected` and `aria-current`; style it like hover. Mark a preferred control with `data-controller-default`, groups with `data-controller-section`, and editable controls with `data-controller-field`. Confirm enters editing; directions adjust values; confirm commits; back restores the original value. Native focus is only for text or numeric editing. Use `tabIndex={-1}` on menu controls and swallow Tab while a menu or modal context is active. There is no controller tab order. Avoid browser focus rings and outlines on console selection; preserve an accessible selected state and labels. Make targets at least 44 by 44 CSS pixels. MENU and MODAL take precedence over GAMEPLAY, and transitions, blur, or pad changes require neutral input before gameplay resumes. Pointer activation remains native and emits a targeted action event for selection synchronization.

## Glyphs and exports

`GlyphMap` supplies action labels and optional keyboard, mouse, touch, and per layout gamepad glyph identifiers. `Glyph` and `InputHint` render text in `<kbd>` by default. Pass `render(glyph, label)` to use your own image or CSS glyph set. This package ships no art.

The export map provides `.` for the full API and `./actions`, `./evaluate`, `./devices`, `./react`, `./navigation`, `./glyphs`, `./touch`, `./observations`, `./settings`, and `./aim-assist` for smaller imports. `./observations` contains telemetry shapes; collecting or transmitting observations is the host's choice.
