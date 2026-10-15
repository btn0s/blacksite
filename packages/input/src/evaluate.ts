import type {
  ActionEvent,
  Binding,
  Control,
  InputContext,
  InputDevice,
  Modifier,
  Vec2,
} from "./actions"

export interface Impulse {
  readonly device: InputDevice
  readonly targetId?: string
}

export interface DeviceSnapshot {
  readonly device: (control: Control) => InputDevice
  readonly impulse: (control: Control) => Impulse | null
  readonly value: (control: Control) => Vec2
}

export interface Evaluation {
  readonly events: ReadonlyArray<ActionEvent>
  readonly values: ReadonlyMap<string, Vec2>
}

const PULSE_FIRST = 0.35
const PULSE_REPEAT = 0.16

function modify(value: Vec2, modifier: Modifier, dt: number): Vec2 {
  switch (modifier.type) {
    case "deadZone": {
      const length = Math.hypot(value.x, value.y)
      if (length <= modifier.lower) {
        return { x: 0, y: 0 }
      }
      const scale =
        Math.min(1, (length - modifier.lower) / (1 - modifier.lower)) / length
      return { x: value.x * scale, y: value.y * scale }
    }
    case "negate":
      return {
        x: modifier.x ? -value.x : value.x,
        y: modifier.y ? -value.y : value.y,
      }
    case "scale":
      return {
        x: value.x * modifier.x,
        y: value.y * (modifier.y ?? modifier.x),
      }
    case "scaleByDeltaTime":
      return { x: value.x * dt, y: value.y * dt }
    case "swizzle":
      return { x: value.y, y: value.x }
  }
}

export function winningBindings(contexts: ReadonlyArray<InputContext>) {
  const sorted = [...contexts].sort((a, b) => b.priority - a.priority)
  const exclusive = sorted.findIndex((context) => context.exclusive)
  const active = exclusive < 0 ? sorted : sorted.slice(0, exclusive + 1)
  const owner = new Map<string, InputContext>()
  for (const context of active) {
    for (const { action } of context.bindings) {
      if (!owner.has(action)) {
        owner.set(action, context)
      }
    }
  }
  return active.flatMap((context) =>
    context.bindings.filter(({ action }) => owner.get(action) === context)
  )
}

export function createEvaluator() {
  const wasDown = new WeakMap<Binding, boolean>()
  const pulses = new Map<string, number>()

  return (
    bindings: ReadonlyArray<Binding>,
    devices: DeviceSnapshot,
    now: number,
    dt: number
  ): Evaluation => {
    const values = new Map<string, Vec2>()
    const events: Array<ActionEvent> = []
    const fired = new Set<string>()
    const pulsing = new Set<string>()
    for (const binding of bindings) {
      const { action, control, modifiers = [], trigger = "down" } = binding
      const raw = devices.value(control)
      const value = modifiers.reduce(
        (current, modifier) => modify(current, modifier, dt),
        raw
      )
      const total = values.get(action) ?? { x: 0, y: 0 }
      values.set(action, { x: total.x + value.x, y: total.y + value.y })
      const down = raw.x !== 0 || raw.y !== 0
      const impulse = devices.impulse(control)
      const previous = wasDown.get(binding)
      const rising = impulse !== null || (down && previous === false)
      wasDown.set(binding, down)
      if (trigger === "down") {
        continue
      }
      const emit = () => {
        if (!fired.has(action)) {
          fired.add(action)
          events.push({
            action,
            device: impulse?.device ?? devices.device(control),
            targetId: impulse?.targetId,
          })
        }
      }
      if (rising) {
        emit()
        if (trigger === "pulse") {
          pulses.set(action, now + PULSE_FIRST)
        }
      } else if (trigger === "pulse" && down) {
        const next = pulses.get(action)
        if (next !== undefined && now >= next) {
          emit()
          pulses.set(action, now + PULSE_REPEAT)
        }
      }
      if (trigger === "pulse" && down) {
        pulsing.add(action)
      }
    }
    for (const action of pulses.keys()) {
      if (!pulsing.has(action)) {
        pulses.delete(action)
      }
    }
    return { events, values }
  }
}
