import { useActionEvents } from "./provider"
import type { InputDevice } from "./actions"
export type MenuIntent =
  | "any"
  | "back"
  | "confirm"
  | "down"
  | "left"
  | "pause"
  | "right"
  | "up"
  | "previousSection"
  | "nextSection"
export interface OmniInputEvent {
  device: InputDevice
  intent: MenuIntent
  targetId?: string
}
const intents = new Set<string>([
  "any",
  "back",
  "confirm",
  "down",
  "left",
  "pause",
  "right",
  "up",
  "previousSection",
  "nextSection",
])
export function useInputEvents(handler: (event: OmniInputEvent) => void) {
  useActionEvents(({ action, device, targetId }) => {
    if (intents.has(action))
      handler({ intent: action as MenuIntent, device, targetId })
  })
}
