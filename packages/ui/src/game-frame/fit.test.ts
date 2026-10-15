import { describe, expect, it } from "vitest"
import { fitGameFrame } from "./fit"

describe("GameFrame fit", () => {
  it("contains wide and tall parent rectangles", () => {
    expect(fitGameFrame(1920, 1080)).toEqual({ width: 1920, height: 1080, scale: 1 })
    expect(fitGameFrame(800, 600).width).toBeCloseTo(800)
    expect(fitGameFrame(800, 600).height).toBeCloseTo(450)
    expect(fitGameFrame(600, 800).width).toBeCloseTo(600)
    expect(fitGameFrame(600, 800).height).toBeCloseTo(337.5)
  })

  it("covers the parent and handles extreme ratios", () => {
    expect(fitGameFrame(800, 600, "16/9", "cover").width).toBeCloseTo(1066.666667)
    expect(fitGameFrame(800, 600, "16/9", "cover").height).toBeCloseTo(600)
    expect(fitGameFrame(100, 100, "100/1").height).toBeCloseTo(1)
    expect(fitGameFrame(100, 100, "1/100", "cover").height).toBeCloseTo(10000)
  })
})
