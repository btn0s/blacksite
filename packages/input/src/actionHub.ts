import type {
  ActionEvent,
  Control,
  InputContext,
  InputDevice,
  PointerGesture,
  Vec2,
} from "./actions"
import { createEvaluator, winningBindings, type Impulse } from "./evaluate"

const ZERO: Vec2 = Object.freeze({ x: 0, y: 0 })
const isDown = (value: Vec2 | undefined) => Boolean(value && (value.x || value.y))

export function makeActionHub() {
  const contexts = new Map<symbol, InputContext>()
  const listeners = new Set<(event: ActionEvent) => void>()
  const heldListeners = new Set<() => void>()
  const held = new Set<string>()
  const touchButtons = new Set<string>()
  const impulses = new Set<string>()
  const gestures = new Map<PointerGesture, Impulse>()
  const mouseButtons = new Set<number>()
  const touchSticks = new Map<string, Vec2>()
  const mouseDelta = { x: 0, y: 0 }
  const touchLook = { x: 0, y: 0 }
  const frameMouse = { x: 0, y: 0 }
  const frameTouch = { x: 0, y: 0 }
  let lastTick: number | null = null
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
    mouseButtons.clear()
    touchSticks.clear()
    mouseDelta.x = mouseDelta.y = touchLook.x = touchLook.y = 0
    frameMouse.x = frameMouse.y = frameTouch.x = frameTouch.y = 0
    lastTick = null
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
    isHeld: (action: string) => isDown(values.get(action)),
    value: (action: string): Vec2 => values.get(action) ?? ZERO,
    reset,
    setTouchButton(button: string, pressed: boolean) {
      if (pressed) touchButtons.add(button)
      else touchButtons.delete(button)
    },
    setTouchStick(stick: string, x: number, y: number) {
      if (x || y) touchSticks.set(stick, { x, y })
      else touchSticks.delete(stick)
    },
    addTouchLook(dx: number, dy: number) {
      touchLook.x += dx
      touchLook.y += dy
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
      const mouseDown = (event: MouseEvent) => {
        if (pointerSource === "touch" || !document.pointerLockElement) return
        mouseButtons.add(event.button)
      }
      const mouseUp = (event: MouseEvent) => {
        mouseButtons.delete(event.button)
      }
      const mouseMove = (event: MouseEvent) => {
        if (!document.pointerLockElement) return
        mouseDelta.x += event.movementX
        mouseDelta.y += event.movementY
      }
      const lockChange = () => {
        if (document.pointerLockElement) return
        mouseButtons.clear()
        mouseDelta.x = mouseDelta.y = 0
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
      window.addEventListener("mousedown", mouseDown, true)
      window.addEventListener("mouseup", mouseUp, true)
      window.addEventListener("mousemove", mouseMove, true)
      document.addEventListener("pointerlockchange", lockChange)
      window.addEventListener("blur", blur)
      return () => {
        window.removeEventListener("keydown", keyDown, true)
        window.removeEventListener("keyup", keyUp, true)
        window.removeEventListener("focusin", focusIn, true)
        window.removeEventListener("pointerdown", pointerDown, true)
        window.removeEventListener("pointerup", pointerUp, true)
        window.removeEventListener("click", click, true)
        window.removeEventListener("pointercancel", pointerCancel)
        window.removeEventListener("mousedown", mouseDown, true)
        window.removeEventListener("mouseup", mouseUp, true)
        window.removeEventListener("mousemove", mouseMove, true)
        document.removeEventListener("pointerlockchange", lockChange)
        window.removeEventListener("blur", blur)
        reset()
      }
    },
    tick(pad: Gamepad | null, now: number, gameplayReady = true) {
      if (pad?.index !== previousPad) {
        previousPad = pad?.index
        evaluate = createEvaluator()
      }
      frameMouse.x = mouseDelta.x
      frameMouse.y = mouseDelta.y
      frameTouch.x = touchLook.x
      frameTouch.y = touchLook.y
      mouseDelta.x = mouseDelta.y = touchLook.x = touchLook.y = 0
      const dt = lastTick === null ? 0 : Math.min(0.1, Math.max(0, (now - lastTick) / 1000))
      lastTick = now
      const padEnabled = gameplayReady || [...contexts.values()].some(context => context.exclusive)
      const read = (control: Control): Vec2 => {
        if (control.device === "mouse")
          return "delta" in control ? { ...frameMouse } : { x: Number(mouseButtons.has(control.button)), y: 0 }
        if (control.device === "touch") {
          if ("joystick" in control) return touchSticks.get(control.joystick) ?? ZERO
          if ("drag" in control) return { ...frameTouch }
          return { x: Number(touchButtons.has(control.button)), y: 0 }
        }
        if (control.device === "keyboard") return { x: Number(held.has(control.key)), y: 0 }
        if (control.device === "gamepad") {
          if (!padEnabled) return ZERO
          if ("stick" in control) {
            const axis = control.stick === "left" ? 0 : 2
            return { x: pad?.axes[axis] ?? 0, y: pad?.axes[axis + 1] ?? 0 }
          }
          if ("button" in control) {
            const button = pad?.buttons[control.button]
            return { x: button?.pressed ? button.value || 1 : 0, y: 0 }
          }
          return { x: Number((pad?.axes[control.axis] ?? 0) * control.direction > control.threshold), y: 0 }
        }
        return ZERO
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
        dt
      )
      const changed = [
        ...new Set([...values.keys(), ...result.values.keys()]),
      ].some(
        (action) =>
          isDown(values.get(action)) !== isDown(result.values.get(action))
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
