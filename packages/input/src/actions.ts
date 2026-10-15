export type InputDevice = "gamepad" | "keyboard" | "mouse" | "touch"

export interface Vec2 {
  x: number
  y: number
}

export interface DebugInput {
  readonly hold?: ReadonlyArray<string>
  readonly look?: Vec2
  readonly move?: Vec2
  readonly press?: ReadonlyArray<string>
}

export type PointerGesture =
  "item" | "swipeDown" | "swipeLeft" | "swipeRight" | "swipeUp" | "twoFingerTap"

export type Control =
  | { readonly device: "any" }
  | { readonly button: number; readonly device: "gamepad" }
  | {
      readonly axis: number
      readonly device: "gamepad"
      readonly direction: 1 | -1
      readonly threshold: number
    }
  | { readonly device: "gamepad"; readonly stick: "left" | "right" }
  | { readonly device: "keyboard"; readonly key: string }
  | { readonly delta: true; readonly device: "mouse" }
  | { readonly button: number; readonly device: "mouse" }
  | { readonly device: "pointer"; readonly gesture: PointerGesture }
  | { readonly device: "touch"; readonly joystick: string }
  | { readonly button: string; readonly device: "touch" }
  | { readonly device: "touch"; readonly drag: true }

export type Modifier =
  | { readonly lower: number; readonly type: "deadZone" }
  | { readonly type: "negate"; readonly x?: boolean; readonly y?: boolean }
  | { readonly type: "scale"; readonly x: number; readonly y?: number }
  | { readonly type: "scaleByDeltaTime" }
  | { readonly type: "swizzle" }

export type Trigger = "down" | "pressed" | "pulse"

export interface Binding {
  readonly action: string
  readonly control: Control
  readonly modifiers?: ReadonlyArray<Modifier>
  readonly trigger?: Trigger
}

export interface InputContext {
  readonly bindings: ReadonlyArray<Binding>
  readonly exclusive?: boolean
  readonly id: string
  readonly priority: number
}

export interface ActionEvent {
  readonly action: string
  readonly device: InputDevice
  readonly targetId?: string
}

const key = (code: string): Control => ({ device: "keyboard", key: code })
const pad = (button: number): Control => ({ button, device: "gamepad" })
const axis = (index: number, direction: 1 | -1): Control => ({
  axis: index,
  device: "gamepad",
  direction,
  threshold: 0.55,
})
const gesture = (name: PointerGesture): Control => ({
  device: "pointer",
  gesture: name,
})

export const MENU: InputContext = {
  bindings: [
    { action: "any", control: { device: "any" }, trigger: "pressed" },
    { action: "previousSection", control: key("KeyQ"), trigger: "pressed" },
    { action: "previousSection", control: pad(4), trigger: "pressed" },
    { action: "nextSection", control: key("KeyE"), trigger: "pressed" },
    { action: "nextSection", control: pad(5), trigger: "pressed" },
    ...(
      [
        ["up", "ArrowUp", 12, axis(1, -1), "swipeUp"],
        ["down", "ArrowDown", 13, axis(1, 1), "swipeDown"],
        ["left", "ArrowLeft", 14, axis(0, -1), "swipeLeft"],
        ["right", "ArrowRight", 15, axis(0, 1), "swipeRight"],
      ] as const
    ).flatMap(([action, code, button, stick, swipe]): Array<Binding> => [
      { action, control: key(code), trigger: "pulse" },
      { action, control: pad(button), trigger: "pulse" },
      { action, control: stick, trigger: "pulse" },
      { action, control: gesture(swipe), trigger: "pressed" },
    ]),
    { action: "confirm", control: key("Enter"), trigger: "pressed" },
    { action: "confirm", control: key("Space"), trigger: "pressed" },
    { action: "confirm", control: pad(0), trigger: "pressed" },
    { action: "confirm", control: gesture("item"), trigger: "pressed" },
    { action: "back", control: key("Escape"), trigger: "pressed" },
    { action: "back", control: key("Backspace"), trigger: "pressed" },
    { action: "back", control: pad(1), trigger: "pressed" },
    { action: "pause", control: pad(9), trigger: "pressed" },
    { action: "pause", control: gesture("twoFingerTap"), trigger: "pressed" },
  ],
  id: "menu",
  exclusive: true,
  priority: 10,
}

export const keysOf = (contexts: ReadonlyArray<InputContext>) =>
  [
    ...new Set(
      contexts.flatMap((context) =>
        context.bindings.flatMap(({ control }) =>
          control.device === "keyboard" ? [control.key] : []
        )
      )
    ),
  ].sort()

export const MODAL: InputContext = { ...MENU, id: "modal", priority: 100 }
export function createGameplayContext(bindings: ReadonlyArray<Binding>, id = "gameplay"): InputContext {
  return { id, priority: 0, bindings }
}

export const GAMEPLAY = createGameplayContext([
  { action: "pause", control: key("Escape"), trigger: "pressed" },
  { action: "pause", control: pad(9), trigger: "pressed" },
])
