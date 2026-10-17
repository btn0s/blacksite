import { describe, expect, it } from 'vitest'
import { createEvaluator, type Binding, type Control, type DeviceSnapshot, type Vec2 } from '@blacksite/input'
import { FPP_BINDINGS, PAD_LOOK, aimCandidates, fppInput, padLookDegrees } from './input'
import { readStandaloneIntent } from './intent'

function evaluate(bindings: ReadonlyArray<Binding>, read: (control: Control) => Vec2) {
  const devices: DeviceSnapshot = { value: read, impulse: () => null, device: control => control.device === 'gamepad' ? 'gamepad' : 'keyboard' }
  return createEvaluator()(bindings, devices, 0, 1 / 60)
}

const keys = (...codes: string[]) => (control: Control): Vec2 => ({ x: Number(control.device === 'keyboard' && codes.includes(control.key)), y: 0 })
const pad = (axes: number[], buttons: number[] = []) => (control: Control): Vec2 => {
  if (control.device !== 'gamepad') return { x: 0, y: 0 }
  if ('stick' in control) { const base = control.stick === 'left' ? 0 : 2; return { x: axes[base] ?? 0, y: axes[base + 1] ?? 0 } }
  if ('button' in control) return { x: Number(buttons.includes(control.button)), y: 0 }
  return { x: 0, y: 0 }
}

describe('standalone subject intent', () => {
  it('normalizes diagonal keyboard movement and keeps jump held', () => {
    const { values } = evaluate(FPP_BINDINGS, keys('KeyW', 'KeyD', 'Space'))
    const intent = readStandaloneIntent(values.get('move')!, action => Boolean(values.get(action)?.x || values.get(action)?.y))
    expect(intent.forward).toBeCloseTo(Math.SQRT1_2)
    expect(intent.right).toBeCloseTo(Math.SQRT1_2)
    expect(intent.jump).toBe(true)
  })

  it('cancels opposing movement keys', () => {
    const { values } = evaluate(FPP_BINDINGS, keys('KeyW', 'KeyS', 'KeyA', 'KeyD'))
    expect(values.get('move')).toEqual({ x: 0, y: 0 })
  })

  it('maps the twin-stick layout', () => {
    const { values } = evaluate(FPP_BINDINGS, pad([0, -1, 0.5, 0], [7, 6, 0, 10, 1, 2, 3, 9]))
    expect(values.get('move')!.y).toBeCloseTo(1)
    expect(values.get('look')).toEqual({ x: 0.5, y: 0 })
    for (const action of ['fire', 'aim', 'jump', 'sprintToggle', 'crouchToggle', 'reload', 'swap', 'pause']) expect(values.get(action)?.x, action).toBe(1)
  })

  it('lets a game add bindings ahead of the defaults', () => {
    const context = fppInput([{ action: 'inspect', control: { device: 'gamepad', button: 12 }, trigger: 'pressed' }])
    expect(context.bindings[0]!.action).toBe('inspect')
    expect(context.bindings.some(binding => binding.action === 'fire')).toBe(true)
  })

  it('holds a clicked sprint until the stick drops or the player aims', () => {
    const latch = { sprint: true, crouch: false }
    const idle = () => false
    expect(readStandaloneIntent({ x: 0, y: 1 }, idle, latch).sprint).toBe(true)
    expect(readStandaloneIntent({ x: 0, y: 1 }, action => action === 'aim', latch).sprint).toBe(false)
    latch.sprint = true
    expect(readStandaloneIntent({ x: 0, y: 0.1 }, idle, latch).sprint).toBe(false)
  })

  it('toggles crouch from the pad and holds it from the keyboard', () => {
    expect(readStandaloneIntent({ x: 0, y: 0 }, () => false, { sprint: false, crouch: true }).crouch).toBe(true)
    expect(readStandaloneIntent({ x: 0, y: 0 }, action => action === 'crouch', { sprint: false, crouch: false }).crouch).toBe(true)
  })
})

describe('pad look curve', () => {
  it('ignores the radial dead zone and reaches full rate at full tilt', () => {
    expect(padLookDegrees(0.14, 0.14, PAD_LOOK, 1)).toEqual({ yaw: 0, pitch: -0, magnitude: 0 })
    expect(padLookDegrees(1, 0, PAD_LOOK, 1).yaw).toBeCloseTo(240)
    expect(padLookDegrees(0, -1, PAD_LOOK, 1).pitch).toBeCloseTo(90)
  })

  it('is quadratic past the dead zone', () => {
    const half = padLookDegrees(0.6, 0, PAD_LOOK, 1).yaw
    expect(half).toBeCloseTo(240 * 0.25)
    expect(padLookDegrees(0.4, 0, PAD_LOOK, 1).yaw).toBeLessThan(half / 3)
  })

  it('is radial, so a diagonal keeps its direction', () => {
    const look = padLookDegrees(0.5, 0.5, { ...PAD_LOOK, pitchDegreesPerSecond: 240 }, 1)
    expect(look.yaw).toBeCloseTo(-look.pitch)
  })
})

describe('aim candidates', () => {
  it('reports the turn needed to reach a target to the right and above', () => {
    const [candidate] = aimCandidates([{ id: 'a', x: 1, y: 1, z: -10, radius: 0.3 }], { x: 0, y: 0, z: 0 }, 0, 0, 20)
    expect(candidate!.yawError).toBeGreaterThan(5)
    expect(candidate!.pitchError).toBeGreaterThan(5)
    expect(candidate!.surfaceAngle).toBeLessThan(candidate!.angle)
  })

  it('drops targets outside the cone or behind', () => {
    expect(aimCandidates([{ id: 'b', x: 0, y: 0, z: 10, radius: 0.3 }], { x: 0, y: 0, z: 0 }, 0, 0, 20)).toEqual([])
  })
})
