import { afterEach, describe, expect, it, vi } from "vitest"
import { MENU, createGameplayContext, type ActionEvent } from "./actions"
import { makeInputDevices } from "./devices"

afterEach(() => vi.unstubAllGlobals())

function session() {
  const host = new EventTarget()
  const axes = [0, 0, 0, 0]
  const buttons = Array.from({ length: 18 }, () => ({ pressed: false, touched: false, value: 0 }))
  const pad: Gamepad = {
    axes, buttons, connected: true, id: "Xbox test", index: 0, mapping: "standard", timestamp: 0,
    hapticActuators: [],
    vibrationActuator: { pulse: async () => true, playEffect: async () => "complete", reset: async () => "complete" },
  }
  let callback: FrameRequestCallback = () => {}
  let now = 0
  vi.stubGlobal("window", host)
  vi.stubGlobal("document", new EventTarget())
  vi.stubGlobal("navigator", { getGamepads: () => [pad] })
  vi.stubGlobal("requestAnimationFrame", (next: FrameRequestCallback) => { callback = next; return 1 })
  vi.stubGlobal("cancelAnimationFrame", () => {})
  const runtime = makeInputDevices()
  const stop = runtime.mount()
  runtime.actions.addContext(createGameplayContext([
    { action: "move", control: { device: "gamepad", stick: "left" } },
    { action: "fire", control: { device: "gamepad", button: 7 } },
  ]))
  runtime.setGameplay(true)
  const frame = () => callback(now += 16)
  const button = (index: number, down: boolean) => { buttons[index]!.pressed = down; buttons[index]!.value = Number(down) }
  const hold = (down: boolean) => { axes[1] = down ? -1 : 0; button(7, down) }
  const inactive = () => {
    expect(runtime.actions.value("move")).toEqual({ x: 0, y: 0 })
    expect(runtime.actions.isHeld("fire")).toBe(false)
  }
  const active = () => {
    expect(runtime.actions.value("move")).toEqual({ x: 0, y: -1 })
    expect(runtime.actions.isHeld("fire")).toBe(true)
  }
  return { runtime, host, axes, button, frame, hold, inactive, active, stop }
}

describe("gamepad neutral gate", () => {
  it("blocks held movement and fire on activation and resume while keeping the menu usable", () => {
    const test = session()
    try {
      test.hold(true)
      test.frame()
      expect(test.runtime.snapshot().gameplayReady).toBe(false)
      test.inactive()
      test.hold(false)
      test.frame()
      test.hold(true)
      test.frame()
      test.active()
      test.runtime.setGameplay(false)
      const close = test.runtime.actions.addContext(MENU)
      const events: ActionEvent[] = []
      test.runtime.actions.subscribe(event => events.push(event))
      test.frame()
      test.button(0, true)
      test.frame()
      expect(events.map(event => event.action)).toContain("confirm")
      test.inactive()
      test.button(0, false)
      close()
      test.runtime.setGameplay(true)
      test.frame()
      test.inactive()
      test.axes[1] = 0
      test.frame()
      test.inactive()
      expect(test.runtime.snapshot().gameplayReady).toBe(false)
      test.button(7, false)
      test.frame()
      expect(test.runtime.snapshot().gameplayReady).toBe(true)
      test.hold(true)
      test.frame()
      test.active()
    } finally { test.stop() }
  })

  it.each(["focus", "possession"])("requires release after %s changes", transition => {
    const test = session()
    try {
      test.hold(true)
      test.frame()
      test.hold(false)
      test.frame()
      test.hold(true)
      test.frame()
      test.active()
      if (transition === "focus") {
        const blur = new Event("blur")
        Object.defineProperty(blur, "isTrusted", { value: true })
        test.host.dispatchEvent(blur)
        test.frame()
        test.inactive()
        test.host.dispatchEvent(new Event("focus"))
      } else test.runtime.prime()
      test.frame()
      expect(test.runtime.snapshot().gameplayReady).toBe(false)
      test.inactive()
      test.hold(false)
      test.frame()
      expect(test.runtime.snapshot().gameplayReady).toBe(true)
      test.hold(true)
      test.frame()
      test.active()
    } finally { test.stop() }
  })
})
