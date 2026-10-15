import type {
  ActionEvent,
  Control,
  InputContext,
  InputDevice,
  PointerGesture,
  Vec2,
} from "./actions"
import { createEvaluator, winningBindings, type Impulse } from "./evaluate"

export function makeActionHub() {
  const contexts = new Map<symbol, InputContext>()
  const listeners = new Set<(event: ActionEvent) => void>()
  const heldListeners = new Set<() => void>()
  const held = new Set<string>()
  const touchButtons = new Set<string>()
  const impulses = new Set<string>()
  const gestures = new Map<PointerGesture, Impulse>()
  let values: ReadonlyMap<string, Vec2> = new Map()
  let evaluate = createEvaluator()
  let any: Impulse | null = null
  let previousPad: number | undefined
  let nextTarget = 0
  let pointerSource: "mouse" | "touch" = "mouse"
  const reset = () => {
    held.clear()
    touchButtons.clear()
    impulses.clear()
    gestures.clear()
    evaluate = createEvaluator()
    values = new Map()
    for (const listener of heldListeners) listener()
  }
  return {
    addContext(context: InputContext) {
      const id = Symbol(context.id)
      contexts.set(id, context)
      reset()
      return () => {
        contexts.delete(id)
        reset()
      }
    },
    subscribe(listener: (event: ActionEvent) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    subscribeHeld(listener: () => void) {
      heldListeners.add(listener)
      return () => {
        heldListeners.delete(listener)
      }
    },
    isHeld: (action: string) => Boolean(values.get(action)?.x),
    reset,
    setTouchButton(button: string, pressed: boolean) {
      if (pressed) touchButtons.add(button)
      else touchButtons.delete(button)
    },
    attach(changeSource: (source: InputDevice) => void) {
      const touches = new Map<number, { x: number; y: number; at: number }>()
      let twoFingers = false
      const keyDown = (event: KeyboardEvent) => {
        const typing =
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement ||
          (event.target instanceof HTMLElement &&
            event.target.isContentEditable)
        const menu = [...contexts.values()].some((context) => context.exclusive)
        if (typing && event.code !== "Escape" && event.code !== "Enter") return
        if (menu && event.code === "Tab") {
          event.preventDefault()
          event.stopImmediatePropagation()
          return
        }
        if (
          !winningBindings([...contexts.values()]).some(
            ({ control }) =>
              control.device === "keyboard" && control.key === event.code
          )
        )
          return
        event.preventDefault()
        if (menu) event.stopImmediatePropagation()
        if (!event.repeat) impulses.add(event.code)
        held.add(event.code)
        any = { device: "keyboard" }
        changeSource("keyboard")
      }
      const focusIn = (event: FocusEvent) => {
        if (![...contexts.values()].some((context) => context.exclusive)) return
        const target = event.target
        if (!(target instanceof HTMLElement)) return
        if (
          (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
          target.hasAttribute("data-controller-editing") &&
          (!(target instanceof HTMLInputElement) || !["range", "checkbox", "radio"].includes(target.type))
        )
          return
        target.blur()
      }
      const keyUp = (event: KeyboardEvent) => {
        held.delete(event.code)
      }
      const pointerDown = (event: PointerEvent) => {
        const device =
          event.pointerType === "touch" || event.pointerType === "pen"
            ? "touch"
            : "mouse"
        changeSource(device)
        pointerSource = device
        any = { device }
        const menu = [...contexts.values()].some((context) => context.exclusive)
        if (
          menu &&
          event.target instanceof Element &&
          event.target.closest("button")
        )
          event.preventDefault()
        if (device === "touch") {
          touches.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
            at: event.timeStamp,
          })
          twoFingers ||= touches.size > 1
        }
      }
      const pointerUp = (event: PointerEvent) => {
        const touch = touches.get(event.pointerId)
        if (!touch) return
        touches.delete(event.pointerId)
        if (twoFingers) {
          if (!touches.size) {
            if (event.timeStamp - touch.at < 350)
              gestures.set("twoFingerTap", { device: "touch" })
            twoFingers = false
          }
          return
        }
        const dx = event.clientX - touch.x
        const dy = event.clientY - touch.y
        if (Math.max(Math.abs(dx), Math.abs(dy)) > 60)
          gestures.set(
            Math.abs(dx) > Math.abs(dy)
              ? dx > 0
                ? "swipeRight"
                : "swipeLeft"
              : dy > 0
                ? "swipeDown"
                : "swipeUp",
            { device: "touch" }
          )
      }
      const click = (event: MouseEvent) => {
        if (![...contexts.values()].some((context) => context.exclusive)) return
        const target =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>(
                "button, input, [role=slider], [role=option]"
              )
            : null
        if (!target || target.matches(":disabled") || target.closest("[inert]"))
          return
        target.dataset.omniId ??= `omni-${++nextTarget}`
        gestures.set("item", {
          device: pointerSource,
          targetId: target.dataset.omniId,
        })
      }
      const pointerCancel = () => {
        touches.clear()
        twoFingers = false
      }
      const blur = () => {
        reset()
        pointerCancel()
      }
      window.addEventListener("keydown", keyDown, true)
      window.addEventListener("keyup", keyUp, true)
      window.addEventListener("focusin", focusIn, true)
      window.addEventListener("pointerdown", pointerDown, true)
      window.addEventListener("pointerup", pointerUp, true)
      window.addEventListener("click", click, true)
      window.addEventListener("pointercancel", pointerCancel)
      window.addEventListener("blur", blur)
      return () => {
        window.removeEventListener("keydown", keyDown, true)
        window.removeEventListener("keyup", keyUp, true)
        window.removeEventListener("focusin", focusIn, true)
        window.removeEventListener("pointerdown", pointerDown, true)
        window.removeEventListener("pointerup", pointerUp, true)
        window.removeEventListener("click", click, true)
        window.removeEventListener("pointercancel", pointerCancel)
        window.removeEventListener("blur", blur)
        reset()
      }
    },
    tick(pad: Gamepad | null, now: number) {
      if (pad?.index !== previousPad) {
        previousPad = pad?.index
        evaluate = createEvaluator()
      }
      const read = (control: Control): Vec2 => {
        let down = false
        if (control.device === "keyboard") down = held.has(control.key)
        if (control.device === "touch" && "button" in control) down = touchButtons.has(control.button)
        if (control.device === "gamepad") {
          if ("button" in control)
            down = Boolean(pad?.buttons[control.button]?.pressed)
          if ("axis" in control)
            down =
              (pad?.axes[control.axis] ?? 0) * control.direction >
              control.threshold
        }
        return { x: Number(down), y: 0 }
      }
      const impulse = (control: Control): Impulse | null => {
        if (control.device === "any") return any
        if (control.device === "keyboard" && impulses.has(control.key))
          return { device: "keyboard" }
        if (control.device === "pointer")
          return gestures.get(control.gesture) ?? null
        return null
      }
      const result = evaluate(
        winningBindings([...contexts.values()]),
        {
          value: read,
          impulse,
          device: (control) =>
            control.device === "gamepad"
              ? "gamepad"
              : control.device === "touch" || control.device === "pointer"
                ? "touch"
                : control.device === "mouse"
                  ? "mouse"
                  : "keyboard",
        },
        now / 1000,
        0
      )
      const changed = [
        ...new Set([...values.keys(), ...result.values.keys()]),
      ].some(
        (action) =>
          Boolean(values.get(action)?.x) !==
          Boolean(result.values.get(action)?.x)
      )
      values = result.values
      impulses.clear()
      gestures.clear()
      any = null
      if (changed) for (const listener of heldListeners) listener()
      for (const event of result.events)
        for (const listener of [...listeners]) listener(event)
    },
  }
}
