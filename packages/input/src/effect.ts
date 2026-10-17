import { Context, Effect, Layer } from "effect"
import { makeInputDevices } from "./devices"

export class InputDevices extends Context.Tag("@blacksite/input/InputDevices")<
  InputDevices,
  ReturnType<typeof makeInputDevices>
>() {}

export const inputDevicesLayer = Layer.sync(InputDevices, makeInputDevices)

export const listenInputDevices = (runtime: ReturnType<typeof makeInputDevices>) =>
  Effect.acquireRelease(Effect.sync(runtime.mount), (unmount) => Effect.sync(unmount)).pipe(
    Effect.flatMap(() => Effect.never)
  )
