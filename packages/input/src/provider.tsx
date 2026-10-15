import { createContext, useContext, useEffect, useEffectEvent, useSyncExternalStore, type ReactNode } from "react"
import type { ActionEvent, InputContext } from "./actions"
import { makeInputDevices } from "./devices"

export type InputRuntime = ReturnType<typeof makeInputDevices>
const Runtime = createContext<InputRuntime | null>(null)

export function InputProvider({ children, runtime }: { children: ReactNode; runtime: InputRuntime }) {
  useEffect(() => runtime.mount(), [runtime])
  return <Runtime.Provider value={runtime}>{children}</Runtime.Provider>
}

export function useInputRuntime() {
  const runtime = useContext(Runtime)
  if (!runtime) throw new Error("InputProvider is required")
  return runtime
}

export function useInputContext(context: InputContext, enabled = true) {
  const hub = useInputRuntime().actions
  useEffect(() => enabled ? hub.addContext(context) : undefined, [hub, context, enabled])
}

export function useActionEvents(handler: (event: ActionEvent) => void) {
  const hub = useInputRuntime().actions
  const current = useEffectEvent(handler)
  useEffect(() => hub.subscribe((event) => current(event)), [hub])
}

export function useActionHeld(action: string) {
  const hub = useInputRuntime().actions
  return useSyncExternalStore(hub.subscribeHeld, () => hub.isHeld(action))
}

export function useInputSnapshot() {
  const runtime = useInputRuntime()
  return useSyncExternalStore(runtime.subscribe, runtime.snapshot)
}

export function useInputSource() {
  const { source, layout } = useInputSnapshot()
  return { device: source, gamepadLayout: layout }
}
