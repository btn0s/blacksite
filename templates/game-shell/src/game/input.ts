import { GAMEPLAY, createGameplayContext, makeInputDevices, type Binding, type Control, type Modifier } from '@blacksite/input'
import { FEEL } from './model'

export const input = makeInputDevices()

const key = (code: string): Control => ({ device: 'keyboard', key: code })
const pad = (button: number): Control => ({ device: 'gamepad', button })
const touch = (button: string): Control => ({ device: 'touch', button })
const swizzle: Modifier = { type: 'swizzle' }
const flipX: Modifier = { type: 'negate', x: true }
const flipY: Modifier = { type: 'negate', y: true }

const hold = (action: string, ...controls: Control[]): Binding[] => controls.map(control => ({ action, control }))
const press = (action: string, ...controls: Control[]): Binding[] => controls.map(control => ({ action, control, trigger: 'pressed' }))

export const PLAY = createGameplayContext([
  ...GAMEPLAY.bindings,
  { action: 'move', control: key('KeyW'), modifiers: [swizzle] },
  { action: 'move', control: key('KeyS'), modifiers: [swizzle, flipY] },
  { action: 'move', control: key('KeyD') },
  { action: 'move', control: key('KeyA'), modifiers: [flipX] },
  { action: 'move', control: { device: 'gamepad', stick: 'left' }, modifiers: [{ type: 'deadZone', lower: 0.15 }, flipY] },
  { action: 'move', control: { device: 'touch', joystick: 'move' }, modifiers: [{ type: 'deadZone', lower: 0.12 }, flipY] },
  { action: 'look', control: { device: 'mouse', delta: true }, modifiers: [{ type: 'scale', x: FEEL.mouseLook }] },
  { action: 'look', control: { device: 'touch', drag: true }, modifiers: [{ type: 'scale', x: FEEL.touchLook }] },
  { action: 'look', control: { device: 'gamepad', stick: 'right' }, modifiers: [{ type: 'deadZone', lower: 0.12 }, { type: 'scale', x: FEEL.stickLook, y: FEEL.stickLook * 0.7 }, { type: 'scaleByDeltaTime' }] },
  ...hold('sprint', key('ShiftLeft'), key('ShiftRight'), pad(10), touch('sprint')),
  ...hold('walk', key('AltLeft')),
  ...hold('crouch', key('ControlLeft'), key('KeyC'), pad(1), touch('crouch')),
  ...hold('fire', { device: 'mouse', button: 0 }, pad(7), touch('fire')),
  ...hold('aim', { device: 'mouse', button: 2 }, pad(6), touch('aim')),
  ...press('jump', key('Space'), pad(0), touch('jump')),
  ...press('reload', key('KeyR'), pad(2), touch('reload')),
  ...press('view', key('KeyV'), pad(3), touch('view')),
  ...press('rifle', key('Digit1'), pad(12)),
  ...press('pistol', key('Digit2'), pad(13)),
], 'play')

const presses = new Set<string>()
input.actions.subscribe(event => { presses.add(event.action) })

export const value = (action: string) => input.actions.value(action)
export const held = (action: string) => input.actions.isHeld(action)
export const take = (action: string) => presses.delete(action)
export const clearPresses = () => presses.clear()

export function requestLock(canvas: HTMLCanvasElement) {
  if (matchMedia('(pointer: coarse)').matches || document.pointerLockElement === canvas) return
  Promise.resolve(canvas.requestPointerLock()).catch(() => undefined)
}
