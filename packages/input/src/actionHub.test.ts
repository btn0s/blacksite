import { describe, expect, it, vi } from "vitest"
import { createGameplayContext, type ActionEvent } from "./actions"
import { makeActionHub } from "./actionHub"

const pad = (axes: number[]): Gamepad => ({
  axes,
  buttons: [],
  connected: true,
  id: "test pad",
  index: 0,
  mapping: "standard",
  timestamp: 0,
  hapticActuators: [],
  vibrationActuator: {
    pulse: async () => true,
    playEffect: async () => "complete",
    reset: async () => "complete",
  },
})

describe("gameplay action values", () => {
  it("reads both stick axes and treats vertical-only movement as held", () => {
    const hub = makeActionHub()
    const changed = vi.fn()
    hub.addContext(createGameplayContext([
      { action: "move", control: { device: "gamepad", stick: "left" } },
      { action: "look", control: { device: "gamepad", stick: "right" } },
    ]))
    hub.subscribeHeld(changed)
    hub.tick(pad([0, -0.75, 0.4, -0.2]), 0)
    expect(hub.value("move")).toEqual({ x: 0, y: -0.75 })
    expect(hub.value("look")).toEqual({ x: 0.4, y: -0.2 })
    expect(hub.isHeld("move")).toBe(true)
    expect(changed).toHaveBeenCalledTimes(1)
    hub.tick(null, 16)
    expect(hub.value("move")).toEqual({ x: 0, y: 0 })
    expect(hub.isHeld("move")).toBe(false)
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it("turns a stick rate into elapsed-time look while preserving touch deltas", () => {
    const hub = makeActionHub()
    hub.addContext(createGameplayContext([
      { action: "look", control: { device: "gamepad", stick: "right" }, modifiers: [{ type: "scale", x: 2 }, { type: "scaleByDeltaTime" }] },
      { action: "look", control: { device: "touch", drag: true }, modifiers: [{ type: "scale", x: 0.01 }] },
    ]))
    hub.tick(pad([0, 0, 0.5, -0.25]), 1000)
    hub.addTouchLook(2, -1)
    hub.addTouchLook(3, -2)
    hub.tick(pad([0, 0, 0.5, -0.25]), 1020)
    expect(hub.value("look").x).toBeCloseTo(0.07)
    expect(hub.value("look").y).toBeCloseTo(-0.04)
    hub.tick(pad([0, 0, 0.5, -0.25]), 1040)
    expect(hub.value("look")).toEqual({ x: 0.02, y: -0.01 })
  })

  it("keeps touch movement held until release and emits one jump per press", () => {
    const hub = makeActionHub()
    const events: ActionEvent[] = []
    hub.addContext(createGameplayContext([
      { action: "move", control: { device: "touch", joystick: "move" } },
      { action: "jump", control: { device: "touch", button: "jump" }, trigger: "pressed" },
    ]))
    hub.subscribe((event) => events.push(event))
    hub.tick(null, 0)
    hub.setTouchStick("move", 0.3, 0.8)
    hub.setTouchButton("jump", true)
    hub.tick(null, 16)
    hub.tick(null, 32)
    expect(hub.value("move")).toEqual({ x: 0.3, y: 0.8 })
    expect(events.map((event) => event.action)).toEqual(["jump"])
    hub.setTouchButton("jump", false)
    hub.setTouchStick("move", 0, 0)
    hub.tick(null, 48)
    expect(hub.isHeld("move")).toBe(false)
    hub.setTouchButton("jump", true)
    hub.tick(null, 64)
    expect(events.map((event) => event.action)).toEqual(["jump", "jump"])
  })

  it("discards queued touch movement and look when a menu takes ownership", () => {
    const hub = makeActionHub()
    hub.addContext(createGameplayContext([
      { action: "move", control: { device: "touch", joystick: "move" } },
      { action: "look", control: { device: "touch", drag: true } },
    ]))
    hub.setTouchStick("move", 1, 0)
    hub.addTouchLook(10, 5)
    const close = hub.addContext({ id: "pause", priority: 10, exclusive: true, bindings: [] })
    hub.tick(null, 16)
    close()
    hub.tick(null, 32)
    expect(hub.value("move")).toEqual({ x: 0, y: 0 })
    expect(hub.value("look")).toEqual({ x: 0, y: 0 })
  })
})
