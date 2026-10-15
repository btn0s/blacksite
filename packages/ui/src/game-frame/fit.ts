export type GameFrameFit = "contain" | "cover"
export type GameFrameRatio = number | `${number}/${number}`

export interface GameFrameRect {
  width: number
  height: number
  scale: number
}

export function parseGameFrameRatio(ratio: GameFrameRatio): number {
  let value: number
  if (typeof ratio === "number") {
    value = ratio
  } else {
    const match = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(ratio.trim())
    value = match ? Number(match[1]) / Number(match[2]) : Number.NaN
  }
  if (!Number.isFinite(value) || value <= 0) throw new RangeError("GameFrame ratio must be positive and finite")
  return value
}

export function fitGameFrame(
  parentWidth: number,
  parentHeight: number,
  ratio: GameFrameRatio = "16/9",
  fit: GameFrameFit = "contain"
): GameFrameRect {
  const aspect = parseGameFrameRatio(ratio)
  if (parentWidth <= 0 || parentHeight <= 0) return { width: 0, height: 0, scale: 0 }
  const designHeight = 1080
  const designWidth = aspect * designHeight
  const horizontal = parentWidth / designWidth
  const vertical = parentHeight / designHeight
  const scale = fit === "contain" ? Math.min(horizontal, vertical) : Math.max(horizontal, vertical)
  return { width: designWidth * scale, height: designHeight * scale, scale }
}
