import { GAMEPLAY, createGameplayContext, shapeStick, type AimCandidate, type Binding, type Control, type GlyphMap, type InputContext, type Modifier, type StickShape } from '@blacksite/input'

export type PadLook = StickShape & { readonly yawDegreesPerSecond: number; readonly pitchDegreesPerSecond: number }
export type AimTarget = { readonly id: string; readonly x: number; readonly y: number; readonly z: number; readonly radius: number; readonly moving?: boolean; readonly strength?: number }

export const PAD_LOOK: PadLook = { yawDegreesPerSecond: 240, pitchDegreesPerSecond: 90, deadZone: 0.2, exponent: 2 }
export const PAD_MOVE_DEAD_ZONE = 0.15

const key = (code: string): Control => ({ device: 'keyboard', key: code })
const pad = (button: number): Control => ({ device: 'gamepad', button })
const swizzle: Modifier = { type: 'swizzle' }
const flipX: Modifier = { type: 'negate', x: true }
const flipY: Modifier = { type: 'negate', y: true }
const hold = (action: string, ...controls: Control[]): Binding[] => controls.map(control => ({ action, control }))
const press = (action: string, ...controls: Control[]): Binding[] => controls.map(control => ({ action, control, trigger: 'pressed' }))

export type CharacterCapabilities = { readonly armed: boolean; readonly views: ReadonlyArray<'arms' | 'head' | 'shoulder'> }

const MOVEMENT: ReadonlyArray<Binding> = [
  ...GAMEPLAY.bindings,
  ...[key('KeyW'), key('ArrowUp')].map(control => ({ action: 'move', control, modifiers: [swizzle] })),
  ...[key('KeyS'), key('ArrowDown')].map(control => ({ action: 'move', control, modifiers: [swizzle, flipY] })),
  ...[key('KeyD'), key('ArrowRight')].map(control => ({ action: 'move', control })),
  ...[key('KeyA'), key('ArrowLeft')].map(control => ({ action: 'move', control, modifiers: [flipX] })),
  { action: 'move', control: { device: 'gamepad', stick: 'left' }, modifiers: [{ type: 'deadZone', lower: PAD_MOVE_DEAD_ZONE }, flipY] },
  { action: 'look', control: { device: 'gamepad', stick: 'right' } },
  ...hold('aim', { device: 'mouse', button: 2 }, pad(6)),
  ...hold('sprint', key('ShiftLeft'), key('ShiftRight')),
  ...press('sprintToggle', pad(10)),
  ...hold('crouch', key('KeyC'), key('ControlLeft')),
  ...press('crouchToggle', pad(1)),
  ...hold('walk', key('AltLeft')),
  ...hold('jump', key('Space'), pad(0)),
  ...press('roll', pad(5)),
  ...press('ragdoll', key('KeyX'), pad(14)),
]

const WEAPONS: ReadonlyArray<Binding> = [
  ...hold('fire', { device: 'mouse', button: 0 }, pad(7)),
  ...press('reload', key('KeyR'), pad(2)),
  ...press('swap', key('KeyQ'), pad(3)),
  ...press('inspect', key('KeyF'), pad(12)),
  ...press('primary', key('Digit1')),
  ...press('secondary', key('Digit2')),
]

const SHOULDER: ReadonlyArray<Binding> = press('shoulder', key('KeyE'), { device: 'mouse', button: 1 }, pad(11))
const VIEW: ReadonlyArray<Binding> = press('view', key('KeyV'), pad(15))

export function characterBindings({ armed, views }: CharacterCapabilities): Binding[] {
  return [...MOVEMENT, ...(armed ? WEAPONS : []), ...(views.includes('shoulder') ? SHOULDER : []), ...(views.length > 1 ? VIEW : [])]
}

export function characterInput(capabilities: CharacterCapabilities, extra: ReadonlyArray<Binding> = [], id = 'character'): InputContext {
  return createGameplayContext([...extra, ...characterBindings(capabilities)], id)
}

export function characterActions(capabilities: CharacterCapabilities) {
  return [...new Set(characterBindings(capabilities).map(binding => binding.action))]
}

export const CHARACTER_GLYPHS: GlyphMap = {
  move: { label: 'Move', keyboard: 'WASD', gamepad: { xbox: 'LS', playstation: 'L', generic: 'LS' } },
  look: { label: 'Look', keyboard: 'Mouse', gamepad: { xbox: 'RS', playstation: 'R', generic: 'RS' } },
  fire: { label: 'Fire', keyboard: 'LMB', gamepad: { xbox: 'RT', playstation: 'R2', generic: 'RT' } },
  aim: { label: 'Aim', keyboard: 'RMB', gamepad: { xbox: 'LT', playstation: 'L2', generic: 'LT' } },
  sprint: { label: 'Sprint', keyboard: 'Shift', gamepad: { xbox: 'L3', playstation: 'L3', generic: 'L3' } },
  crouch: { label: 'Crouch', keyboard: 'C', gamepad: { xbox: 'B', playstation: '○', generic: 'B' } },
  walk: { label: 'Walk', keyboard: 'Alt', gamepad: { xbox: 'LS ½', playstation: 'L ½', generic: 'LS ½' } },
  jump: { label: 'Jump', keyboard: 'Space', gamepad: { xbox: 'A', playstation: '✕', generic: 'A' } },
  roll: { label: 'Roll', keyboard: 'Shift tap', gamepad: { xbox: 'RB', playstation: 'R1', generic: 'RB' } },
  ragdoll: { label: 'Fall / up', keyboard: 'X', gamepad: { xbox: 'D-pad ←', playstation: 'D-pad ←', generic: 'D-pad ←' } },
  shoulder: { label: 'Shoulder', keyboard: 'E', gamepad: { xbox: 'R3', playstation: 'R3', generic: 'R3' } },
  reload: { label: 'Reload', keyboard: 'R', gamepad: { xbox: 'X', playstation: '□', generic: 'X' } },
  swap: { label: 'Swap', keyboard: 'Q', gamepad: { xbox: 'Y', playstation: '△', generic: 'Y' } },
  inspect: { label: 'Inspect', keyboard: 'F', gamepad: { xbox: 'D-pad ↑', playstation: 'D-pad ↑', generic: 'D-pad ↑' } },
  view: { label: 'View', keyboard: 'V', gamepad: { xbox: 'D-pad →', playstation: 'D-pad →', generic: 'D-pad →' } },
  pause: { label: 'Pause', keyboard: 'Esc', gamepad: { xbox: '☰', playstation: 'OPTIONS', generic: 'START' } },
}

export function padLookDegrees(x: number, y: number, look: PadLook, dt: number) {
  const shaped = shapeStick(x, y, look)
  return { yaw: shaped.x * look.yawDegreesPerSecond * dt, pitch: -shaped.y * look.pitchDegreesPerSecond * dt, magnitude: Math.hypot(shaped.x, shaped.y) }
}

const DEGREES = 180 / Math.PI

export function aimCandidates(targets: ReadonlyArray<AimTarget>, eye: { x: number; y: number; z: number }, yaw: number, pitch: number, cone: number, out: AimCandidate[] = []) {
  out.length = 0
  const cosPitch = Math.cos(pitch)
  const fx = -Math.sin(yaw) * cosPitch, fy = Math.sin(pitch), fz = -Math.cos(yaw) * cosPitch
  for (const target of targets) {
    const dx = target.x - eye.x, dy = target.y - eye.y, dz = target.z - eye.z
    const distance = Math.hypot(dx, dy, dz)
    if (distance < 1e-3) continue
    const angle = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dy * fy + dz * fz) / distance))) * DEGREES
    if (angle > cone) continue
    const turn = Math.atan2(-dx, -dz) - yaw
    out.push({
      id: target.id,
      angle,
      surfaceAngle: Math.max(0, angle - Math.atan(target.radius / distance) * DEGREES),
      yawError: -Math.atan2(Math.sin(turn), Math.cos(turn)) * DEGREES,
      pitchError: (Math.atan2(dy, Math.hypot(dx, dz)) - pitch) * DEGREES,
      strength: target.strength ?? 1,
      moving: target.moving ?? false,
    })
  }
  return out
}
