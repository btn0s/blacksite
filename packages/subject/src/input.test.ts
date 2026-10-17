import { afterEach, describe, expect, it, vi } from 'vitest'
import { MENU, makeInputDevices, type ActionEvent } from '@blacksite/input'
import { CHARACTER_GLYPHS, PAD_LOOK, characterActions, characterInput, padLookDegrees } from './input'

const SHOOTER = { armed: true, views: ['arms', 'shoulder'] } as const
const RUNNER = { armed: false, views: ['shoulder', 'head'] } as const

afterEach(() => vi.unstubAllGlobals())

function pad(capabilities: { armed: boolean; views: ReadonlyArray<'arms' | 'head' | 'shoulder'> } = SHOOTER) {
  const axes = [0, 0, 0, 0]
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }))
  const gamepad: Gamepad = {
    axes, buttons, connected: true, id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', index: 0, mapping: 'standard', timestamp: 0,
    hapticActuators: [],
    vibrationActuator: { pulse: async () => true, playEffect: async () => 'complete', reset: async () => 'complete' },
  }
  let callback: FrameRequestCallback = () => {}
  let now = 0
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', new EventTarget())
  vi.stubGlobal('navigator', { getGamepads: () => [gamepad] })
  vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => { callback = next; return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  const runtime = makeInputDevices()
  const stop = runtime.mount()
  runtime.actions.addContext(characterInput(capabilities))
  runtime.setGameplay(true)
  const events: ActionEvent[] = []
  runtime.actions.subscribe(event => events.push(event))
  const frame = () => callback(now += 16)
  const button = (index: number, down: boolean) => { buttons[index]!.pressed = down; buttons[index]!.value = Number(down); frame() }
  const tap = (index: number) => { events.length = 0; button(index, true); button(index, false); return events.map(event => event.action) }
  frame()
  return { runtime, axes, frame, button, tap, stop }
}

describe('character gamepad bindings', () => {
  it('maps the sticks to move and look', () => {
    const test = pad()
    try {
      test.axes[1] = -1
      test.axes[2] = 0.5
      test.frame()
      expect(test.runtime.actions.value('move')).toEqual({ x: 0, y: 1 })
      expect(test.runtime.actions.value('look')).toEqual({ x: 0.5, y: 0 })
      expect(test.runtime.snapshot().source).toBe('gamepad')
    } finally { test.stop() }
  })

  it.each([['fire', 7], ['aim', 6], ['jump', 0]] as const)('holds %s on button %i', (action, index) => {
    const test = pad()
    try {
      test.button(index, true)
      expect(test.runtime.actions.isHeld(action)).toBe(true)
      test.button(index, false)
      expect(test.runtime.actions.isHeld(action)).toBe(false)
    } finally { test.stop() }
  })

  it.each([['sprintToggle', 10], ['crouchToggle', 1], ['reload', 2], ['swap', 3], ['pause', 9], ['view', 15], ['inspect', 12], ['roll', 5], ['ragdoll', 14], ['shoulder', 11]] as const)('presses %s on button %i', (action, index) => {
    const test = pad()
    try {
      expect(test.tap(index)).toContain(action)
    } finally { test.stop() }
  })

  it('navigates the menu with the pad once paused', () => {
    const test = pad()
    try {
      expect(test.tap(9)).toContain('pause')
      test.runtime.setGameplay(false)
      const close = test.runtime.actions.addContext(MENU)
      test.frame()
      expect(test.tap(13)).toContain('down')
      expect(test.tap(0)).toContain('confirm')
      expect(test.tap(1)).toContain('back')
      expect(test.tap(1)).not.toContain('crouchToggle')
      close()
    } finally { test.stop() }
  })

  it('has a pad glyph for every hinted action', () => {
    for (const spec of Object.values(CHARACTER_GLYPHS)) expect(spec.gamepad?.xbox).toBeTruthy()
    for (const action of characterActions(SHOOTER)) expect(CHARACTER_GLYPHS[action] ?? ['primary', 'secondary', 'sprintToggle', 'crouchToggle', 'walkToggle'].includes(action), action).toBeTruthy()
  })

  it('binds only what the character can do', () => {
    const runner = characterActions(RUNNER)
    for (const action of ['move', 'look', 'jump', 'sprint', 'crouch', 'walkToggle', 'roll', 'ragdoll', 'aim', 'shoulder', 'view', 'pause']) expect(runner, action).toContain(action)
    for (const action of ['fire', 'reload', 'swap', 'inspect']) expect(runner, action).not.toContain(action)
    const arms = characterActions({ armed: true, views: ['arms'] })
    expect(arms).toContain('fire')
    expect(arms).not.toContain('shoulder')
    expect(arms).not.toContain('view')
  })

  it('frees the runner pad buttons a shooter uses for weapons', () => {
    const test = pad(RUNNER)
    try {
      expect(test.tap(2)).not.toContain('reload')
      expect(test.tap(3)).not.toContain('swap')
      expect(test.tap(5)).toContain('roll')
    } finally { test.stop() }
  })
})

describe('pad look curve', () => {
  it('ignores the radial dead zone and reaches 240 by 90 degrees a second at full tilt', () => {
    expect(padLookDegrees(0.19, 0, PAD_LOOK, 1)).toEqual({ yaw: 0, pitch: -0, magnitude: 0 })
    expect(padLookDegrees(0.15, 0.15, PAD_LOOK, 1).magnitude).toBeGreaterThan(0)
    const full = padLookDegrees(1, 0, PAD_LOOK, 1)
    expect(full.yaw).toBeCloseTo(240)
    expect(padLookDegrees(0, -1, PAD_LOOK, 1).pitch).toBeCloseTo(90)
    expect(full.magnitude).toBeCloseTo(1)
  })

  it('curves the response so half tilt turns slower than half speed', () => {
    const half = padLookDegrees(0.6, 0, PAD_LOOK, 1).yaw
    expect(half).toBeCloseTo(240 * 0.5 ** 2)
    expect(padLookDegrees(0.6, 0, PAD_LOOK, 0.5).yaw).toBeCloseTo(half / 2)
  })
})
