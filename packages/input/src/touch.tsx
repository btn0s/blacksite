import type { CSSProperties } from "react"

export interface TouchButtonSpec {
  readonly action: string
  readonly label: string
  readonly bottom: number
  readonly right: number
  readonly size?: number
}

export function TouchControls({ buttons, onButton }: { buttons: ReadonlyArray<TouchButtonSpec>; onButton: (action: string, pressed: boolean) => void }) {
  return <div aria-label="Touch controls">{buttons.map(({ action, label, bottom, right, size = 52 }) => {
    const style: CSSProperties = {
      position: "fixed", bottom: `calc(${bottom + 16}px + env(safe-area-inset-bottom))`,
      right: `calc(${right + 16}px + env(safe-area-inset-right))`,
      minWidth: Math.max(44, size), minHeight: Math.max(44, size), touchAction: "none",
    }
    return <button key={action} type="button" style={style} aria-label={label}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); onButton(action, true) }}
      onPointerUp={() => onButton(action, false)} onPointerCancel={() => onButton(action, false)}>{label}</button>
  })}</div>
}
