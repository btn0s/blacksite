import type { Vec2 } from "./actions"

export interface StickShape {
  readonly deadZone: number
  readonly exponent: number
}

export function shapeStick(x: number, y: number, shape: StickShape): Vec2 {
  const length = Math.hypot(x, y)
  if (length <= shape.deadZone) return { x: 0, y: 0 }
  const linear = Math.min(1, (length - shape.deadZone) / (1 - shape.deadZone))
  const scale = linear ** shape.exponent / length
  return { x: x * scale, y: y * scale }
}
