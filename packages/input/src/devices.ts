import { makeActionHub } from "./actionHub"
import type { InputDevice as InputSourceDevice } from "./actions"
export type InputDeviceFamily = "keyboardMouse" | "xbox" | "playstation" | "generic"
export interface InputSnapshot {
  device: InputDeviceFamily
  source: InputSourceDevice
  layout: "xbox" | "playstation" | "generic"
  index: number | undefined
  connected: number
  activated: boolean
  gameplayReady: boolean
}
export function classifyGamepad(id: string): InputDeviceFamily {
  return /054c|sony|playstation|dualsense|dualshock|wireless controller/i.test(id)
    ? "playstation"
    : /xbox|xinput|045e/i.test(id)
      ? "xbox"
      : "generic"
}
export function makeInputDevices() {
  const actions = makeActionHub()
  let snapshot: InputSnapshot = {
    device: "keyboardMouse",
    source: "keyboard",
    layout: "generic",
    index: undefined,
    connected: 0,
    activated: false,
    gameplayReady: false,
  }
  const listeners = new Set<() => void>()
  const frames = new Set<(pad: Gamepad | null, now: number) => void>()
  const previous = new Map<number, string>()
  const announced = new Set<number>()
  const activated = new Set<number>()
  let gameplay = false
  let focused = true
  let rumbleEnabled = true
  let users = 0
  let frame = 0
  let stop = () => {}
  const update = (values: Partial<InputSnapshot>) => {
    const next = { ...snapshot, ...values }
    if (
      Object.keys(next).every(
        (field) =>
          next[field as keyof InputSnapshot] ===
          snapshot[field as keyof InputSnapshot]
      )
    )
      return
    snapshot = next
    for (const listener of listeners) listener()
  }
  const pads = () =>
    Array.from(navigator.getGamepads?.() ?? []).filter((pad): pad is Gamepad =>
      Boolean(pad?.connected)
    )
  const activePad = () =>
    pads().find((pad) => pad.index === snapshot.index) ?? null
  const resetRumble = () => {
    void activePad()
      ?.vibrationActuator?.reset()
      .catch(() => {})
  }
  const start = () => {
    if (++users > 1) return
    const offActions = actions.attach((source) =>
      update({
        source,
        ...(source !== "gamepad" ? { device: "keyboardMouse" as const } : {}),
      })
    )
    const keyboardMouse = (event: Event) => {
      if (!event.isTrusted) return
      if (
        event instanceof PointerEvent &&
        event.type === "pointermove" &&
        event.movementX === 0 &&
        event.movementY === 0
      )
        return
      update({
        device: "keyboardMouse",
        source:
          event instanceof KeyboardEvent
            ? "keyboard"
            : event instanceof PointerEvent && event.pointerType === "touch"
              ? "touch"
              : "mouse",
      })
    }
    const connect = (event: GamepadEvent) => {
      announced.add(event.gamepad.index)
      update({
        connected: Math.max(snapshot.connected, announced.size),
        activated: false,
      })
    }
    const disconnect = (event: GamepadEvent) => {
      announced.delete(event.gamepad.index)
      activated.delete(event.gamepad.index)
      previous.delete(event.gamepad.index)
      if (snapshot.index === event.gamepad.index)
        update({
          index: undefined,
          device: "keyboardMouse",
          source: "keyboard",
          gameplayReady: false,
          activated: false,
        })
      update({ connected: announced.size })
    }
    const blur = (event: Event) => {
      if (event.isTrusted) focused = false
      resetRumble()
      update({ gameplayReady: false })
    }
    const focus = () => {
      focused = true
    }
    const tick = (now: number) => {
      const connected = pads()
      for (const pad of connected) {
        announced.add(pad.index)
        const signature =
          pad.buttons.map((button) => (button.pressed ? "1" : "0")).join("") +
          pad.axes
            .map((axis) => (Math.abs(axis) > 0.25 ? Math.round(axis * 20) : 0))
            .join(",")
        const moved = pad.axes.some((axis) => Math.abs(axis) > 0.25)
        const pressed = pad.buttons.some((button) => button.pressed)
        if (
          focused &&
          pad.mapping === "standard" &&
          (pressed || moved) &&
          signature !== previous.get(pad.index)
        ) {
          activated.add(pad.index)
          const changed = snapshot.index !== pad.index
          update({
            device: classifyGamepad(pad.id),
            source: "gamepad",
            layout: classifyGamepad(pad.id) as
              "xbox" | "playstation" | "generic",
            index: pad.index,
            activated: true,
            ...(changed ? { gameplayReady: false } : {}),
          })
        }
        previous.set(pad.index, signature)
      }
      for (const index of announced) {
        if (!connected.some((pad) => pad.index === index)) {
          announced.delete(index)
          activated.delete(index)
          previous.delete(index)
        }
      }
      if (
        snapshot.index !== undefined &&
        !connected.some((pad) => pad.index === snapshot.index)
      )
        update({
          index: undefined,
          device: "keyboardMouse",
          source: "keyboard",
          gameplayReady: false,
          activated: false,
        })
      update({ connected: announced.size })
      const pad = activePad()
      if (
        focused &&
        gameplay &&
        pad &&
        pad.mapping === "standard" &&
        activated.has(pad.index) &&
        !snapshot.gameplayReady &&
        pad.buttons.every((button) => !button.pressed) &&
        pad.axes.every((axis) => Math.abs(axis) <= 0.25)
      )
        update({ gameplayReady: true })
      const selectedPad = focused && pad?.mapping === "standard" ? pad : null
      actions.tick(selectedPad, now, gameplay && snapshot.gameplayReady)
      for (const listener of frames) listener(gameplay && snapshot.gameplayReady ? selectedPad : null, now)
      frame = requestAnimationFrame(tick)
    }
    window.addEventListener("keydown", keyboardMouse, true)
    window.addEventListener("pointerdown", keyboardMouse, true)
    window.addEventListener("pointermove", keyboardMouse, true)
    window.addEventListener("wheel", keyboardMouse, {
      capture: true,
      passive: true,
    })
    window.addEventListener("gamepadconnected", connect)
    window.addEventListener("gamepaddisconnected", disconnect)
    window.addEventListener("blur", blur)
    window.addEventListener("focus", focus)
    frame = requestAnimationFrame(tick)
    stop = () => {
      offActions()
      cancelAnimationFrame(frame)
      resetRumble()
      window.removeEventListener("keydown", keyboardMouse, true)
      window.removeEventListener("pointerdown", keyboardMouse, true)
      window.removeEventListener("pointermove", keyboardMouse, true)
      window.removeEventListener("wheel", keyboardMouse, true)
      window.removeEventListener("gamepadconnected", connect)
      window.removeEventListener("gamepaddisconnected", disconnect)
      window.removeEventListener("blur", blur)
      window.removeEventListener("focus", focus)
    }
  }
  return {
    actions,
    snapshot: () => snapshot,
    activePad,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    onFrame: (listener: (pad: Gamepad | null, now: number) => void) => {
      frames.add(listener)
      return () => {
        frames.delete(listener)
      }
    },
    setGameplay: (enabled: boolean) => {
      if (gameplay === enabled) return
      gameplay = enabled
      resetRumble()
      actions.reset()
      update({ gameplayReady: false })
    },
    setRumble: (enabled: boolean) => {
      rumbleEnabled = enabled
      if (!enabled) resetRumble()
    },
    prime: () => {
      actions.reset()
      update({ gameplayReady: false })
    },
    rumble: (duration: number, strongMagnitude: number, weakMagnitude: number, triggers?: { left: number; right: number }) => {
      if (!rumbleEnabled || !focused || !gameplay || snapshot.device === "keyboardMouse") return
      const actuator = activePad()?.vibrationActuator as (GamepadHapticActuator & { effects?: ReadonlyArray<string> }) | undefined
      if (!actuator?.playEffect) return
      const params = { duration, startDelay: 0, strongMagnitude, weakMagnitude }
      const effect = triggers && actuator.effects?.includes("trigger-rumble")
        ? actuator.playEffect("trigger-rumble", { ...params, leftTrigger: triggers.left, rightTrigger: triggers.right })
        : actuator.playEffect("dual-rumble", params)
      void effect.catch(() => {})
    },
    mount: () => {
      start()
      return () => {
        if (--users === 0) stop()
      }
    },
  }
}
