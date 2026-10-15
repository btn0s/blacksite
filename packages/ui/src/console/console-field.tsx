import { useEffect, useEffectEvent, useRef, useState } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/select"
import { Slider } from "../components/slider"
import { Label } from "../components/label"
import { stepConsoleOption, stepConsoleNumber } from "../lib/console-values"

export interface ConsoleFieldEventMap {
  "controller-edit": CustomEvent<void>
  "controller-adjust": CustomEvent<number>
  "controller-cancel": CustomEvent<void>
}

function useControllerField(
  value: string | number,
  change: (step: number) => void,
  cancel: (original: string | number) => void
) {
  const root = useRef<HTMLDivElement>(null)
  const original = useRef(value)
  const adjust = useEffectEvent(change)
  const restore = useEffectEvent(cancel)
  const capture = useEffectEvent(() => {
    original.current = value
  })
  useEffect(() => {
    const element = root.current
    if (!element) return
    const edit = () => capture()
    const step = (event: Event) => adjust((event as ConsoleFieldEventMap["controller-adjust"]).detail)
    const reset = () => restore(original.current)
    element.addEventListener("controller-edit", edit)
    element.addEventListener("controller-adjust", step)
    element.addEventListener("controller-cancel", reset)
    return () => {
      element.removeEventListener("controller-edit", edit)
      element.removeEventListener("controller-adjust", step)
      element.removeEventListener("controller-cancel", reset)
    }
  }, [])
  return root
}
export interface ConsoleOption {
  value: string
  label: string
}
export function ConsoleSelect({
  label,
  value,
  options,
  onValueChange,
  disabled = false,
}: {
  label: string
  value: string
  options: readonly ConsoleOption[]
  onValueChange: (value: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const root = useControllerField(
    value,
    (step) => {
      if (!disabled) onValueChange(stepConsoleOption(options, value, step))
    },
    (original) => onValueChange(String(original))
  )
  return (
    <div ref={root} className="console-field">
      <Label>{label}</Label>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next !== null) onValueChange(String(next))
        }}
        disabled={disabled}
        open={open}
        onOpenChange={setOpen}
      >
        <SelectTrigger
          aria-label={label}
          data-controller-field
          onClick={(event) => {
            if (event.detail > 0) setOpen(true)
          }}
        >
          <SelectValue>
            {options.find((option) => option.value === value)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
export function ConsoleSlider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.05,
  onValueChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onValueChange: (value: number) => void
}) {
  const root = useControllerField(
    value,
    (direction) => onValueChange(stepConsoleNumber(value, direction, min, max, step)),
    (original) => onValueChange(Number(original))
  )
  return (
    <div ref={root} className="console-field">
      <Label>
        {label}
        <span>{value.toFixed(step < 1 ? 2 : 0)}</span>
      </Label>
      <Slider
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) =>
          onValueChange(Array.isArray(next) ? next[0]! : next)
        }
      />
    </div>
  )
}
