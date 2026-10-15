import { describe, expect, it } from "vitest"
import { createEvaluator, winningBindings, type DeviceSnapshot } from "./evaluate"
import type { Binding, InputContext } from "./actions"

const button: Binding = { action: "confirm", control: { device: "gamepad", button: 0 }, trigger: "pressed" }
const direction: Binding = { action: "down", control: { device: "gamepad", button: 13 }, trigger: "pulse" }

function device(pressed: () => boolean): DeviceSnapshot {
  return {
    value: () => ({ x: Number(pressed()), y: 0 }),
    impulse: () => null,
    device: () => "gamepad",
  }
}

describe("input evaluator invariants", () => {
  it("takes the highest priority owner and cuts off below an exclusive context", () => {
    const low: InputContext = { id: "low", priority: 0, bindings: [button, direction] }
    const high: InputContext = { id: "modal", priority: 10, exclusive: true, bindings: [{ ...button }] }
    expect(winningBindings([low, high])).toEqual(high.bindings)
    expect(winningBindings([low, { ...high, exclusive: false }])).toEqual([...high.bindings, direction])
  })

  it("emits once per press and primes a button held when evaluation starts", () => {
    let down = true
    const evaluate = createEvaluator()
    const sample = (now: number) => evaluate([button], device(() => down), now, 0).events
    expect(sample(0)).toEqual([])
    down = false
    expect(sample(0.01)).toEqual([])
    down = true
    expect(sample(0.02).map((event) => event.action)).toEqual(["confirm"])
    expect(sample(0.03)).toEqual([])
    expect(createEvaluator()([button], device(() => down), 1, 0).events).toEqual([])
  })

  it("repeats after 350 ms then every 160 ms", () => {
    let down = false
    const evaluate = createEvaluator()
    const sample = (now: number) => evaluate([direction], device(() => down), now, 0).events.length
    expect(sample(0)).toBe(0)
    down = true
    expect(sample(0.01)).toBe(1)
    expect(sample(0.359)).toBe(0)
    expect(sample(0.36)).toBe(1)
    expect(sample(0.519)).toBe(0)
    expect(sample(0.52)).toBe(1)
  })
})
