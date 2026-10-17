import type { ReactNode } from "react"
import type { InputDevice } from "./actions"
import { useInputSource } from "./provider"

export type GamepadLayout = "xbox" | "playstation" | "generic"
const xboxLabels = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "VIEW", "MENU", "LS", "RS", "D-PAD UP", "D-PAD DOWN", "D-PAD LEFT", "D-PAD RIGHT"]
const playstationLabels = ["CROSS", "CIRCLE", "SQUARE", "TRIANGLE", "L1", "R1", "L2", "R2", "SHARE", "OPTIONS", "L3", "R3", "D-PAD UP", "D-PAD DOWN", "D-PAD LEFT", "D-PAD RIGHT"]

export function gamepadButtonLabel(index: number, layout: GamepadLayout): string {
  const labels = layout === "xbox" ? xboxLabels : layout === "playstation" ? playstationLabels : []
  return labels[index] ?? `BUTTON ${index}`
}
export interface GlyphSpec {
  readonly label: string
  readonly keyboard?: string
  readonly mouse?: string
  readonly touch?: string
  readonly gamepad?: Partial<Record<GamepadLayout, string>>
}
export type GlyphMap = Readonly<Record<string, GlyphSpec>>
export type GlyphRenderer = (glyph: string, label: string) => ReactNode

export function glyphText(spec: GlyphSpec, device: InputDevice, layout: GamepadLayout): string {
  return device === "gamepad"
    ? spec.gamepad?.[layout] ?? spec.gamepad?.generic ?? spec.label
    : device === "mouse" ? spec.mouse ?? spec.keyboard ?? spec.label
    : device === "touch" ? spec.touch ?? spec.label
    : spec.keyboard ?? spec.label
}

export function Glyph({ action, glyphs, render }: { action: string; glyphs: GlyphMap; render?: GlyphRenderer }) {
  const { device, gamepadLayout } = useInputSource()
  const spec = glyphs[action]
  if (!spec) return <kbd aria-label={action}>{action}</kbd>
  const glyph = glyphText(spec, device, gamepadLayout)
  return <span role="img" aria-label={spec.label} title={spec.label}>{render?.(glyph, spec.label) ?? <kbd>{glyph}</kbd>}</span>
}

export function InputHint({ action, glyphs, render, label }: { action: string; glyphs: GlyphMap; render?: GlyphRenderer; label?: string }) {
  return <span><Glyph action={action} glyphs={glyphs} render={render} /> {label ?? glyphs[action]?.label ?? action}</span>
}
