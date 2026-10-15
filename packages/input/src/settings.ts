export interface ControlSettings {
  readonly aimToggle: boolean
  readonly crouchHold: boolean
  readonly padSensitivity: number
  readonly padInvertY: boolean
  readonly mouseSensitivity: number
  readonly mouseInvertY: boolean
  readonly rumble: boolean
}

export const defaultControlSettings: ControlSettings = {
  aimToggle: false,
  crouchHold: false,
  padSensitivity: 1,
  padInvertY: false,
  mouseSensitivity: 1,
  mouseInvertY: false,
  rumble: true,
}

export function normalizeControlSettings(input: Partial<ControlSettings>): ControlSettings {
  const sensitivity = (value: number | undefined) => Number.isFinite(value) ? Math.min(2, Math.max(0.25, value!)) : 1
  return {
    aimToggle: input.aimToggle === true,
    crouchHold: input.crouchHold === true,
    padSensitivity: sensitivity(input.padSensitivity),
    padInvertY: input.padInvertY === true,
    mouseSensitivity: sensitivity(input.mouseSensitivity),
    mouseInvertY: input.mouseInvertY === true,
    rumble: input.rumble !== false,
  }
}

export function readControlSettings(storage: Pick<Storage, "getItem">, storageKey: string): ControlSettings {
  try {
    return normalizeControlSettings(JSON.parse(storage.getItem(storageKey) ?? "{}") as Partial<ControlSettings>)
  } catch {
    return defaultControlSettings
  }
}
