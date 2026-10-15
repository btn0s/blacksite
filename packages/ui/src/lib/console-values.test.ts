import { describe, expect, it } from "vitest"
import { stepConsoleNumber, stepConsoleOption } from "./console-values"

describe("console values", () => {
  it("wraps option steps and leaves empty lists unchanged", () => {
    const options = [{ value: "a" }, { value: "b" }, { value: "c" }]
    expect(stepConsoleOption(options, "a", -1)).toBe("c")
    expect(stepConsoleOption(options, "c", 1)).toBe("a")
    expect(stepConsoleOption([], "a", 1)).toBe("a")
  })

  it("clamps numeric adjustments to the range", () => {
    expect(stepConsoleNumber(0.9, 1, 0, 1, 0.2)).toBe(1)
    expect(stepConsoleNumber(0, -1, 0, 1, 0.2)).toBe(0)
  })
})
