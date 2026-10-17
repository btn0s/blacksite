import * as THREE from 'three'
import { expect, test, vi } from 'vitest'
import type { LevelBuilder } from '@blacksite/look/world'
import type { DressingContext } from './dressing'

type Vec3 = readonly [number, number, number]
type Bounds = { min: Vec3; max: Vec3 }

const span = vi.hoisted(() => {
  const stub = (): unknown => new Proxy(function () {}, { get: (_, key) => key === Symbol.toPrimitive ? () => 0 : key === 'then' ? undefined : stub(), apply: () => stub(), construct: () => stub() as object, set: () => true })
  if (typeof document === 'undefined') Object.assign(globalThis, { document: stub() })
  return { from: 0, to: 0 }
})

vi.mock('./dressing', async importOriginal => {
  const actual = await importOriginal<typeof import('./dressing')>()
  return { ...actual, dress: (level: LevelBuilder, context: DressingContext) => { span.from = level.colliders.length; actual.dress(level, context); span.to = level.colliders.length } }
})

const { buildRoute } = await import('./route')

const boundsOf = (collider: ReturnType<typeof buildRoute>['colliders'][number]): Bounds => {
  const half = collider.kind === 'box' ? collider.half : [collider.radius, collider.halfHeight, collider.radius] as const
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...collider.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...collider.rotation)), new THREE.Vector3(1, 1, 1))
  const box = new THREE.Box3()
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) box.expandByPoint(new THREE.Vector3(x * half[0], y * half[1], z * half[2]).applyMatrix4(matrix))
  return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] }
}

const flatDistance = (bounds: Bounds, a: Vec3, b: Vec3) => {
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.05))
  let best = Infinity
  for (let k = 0; k <= steps; k++) {
    const x = a[0] + (b[0] - a[0]) * k / steps
    const z = a[2] + (b[2] - a[2]) * k / steps
    best = Math.min(best, Math.hypot(Math.max(bounds.min[0] - x, 0, x - bounds.max[0]), Math.max(bounds.min[2] - z, 0, z - bounds.max[2])))
  }
  return best
}

const overlaps = (bounds: Bounds, low: number, high: number) => bounds.max[1] > low && bounds.min[1] < high

test('dressing colliders keep the race line, ledges, stairs, ramps and gates clear', () => {
  const route = buildRoute()
  expect(span.to).toBeGreaterThan(span.from)
  const dressing = route.colliders.slice(span.from, span.to).map((collider, index) => ({ index: span.from + index, bounds: boundsOf(collider) }))
  const lanes = [
    ...route.line.slice(1).map((point, index) => ({ label: `line ${index}`, a: route.line[index]!.at, b: point.at, clearance: 1, low: Math.min(route.line[index]!.at[1], point.at[1]) - 0.2, high: Math.max(route.line[index]!.at[1], point.at[1]) + 2 })),
    ...route.ledges.map(ledge => ({ label: `ledge ${ledge.label}`, a: ledge.approach, b: [ledge.approach[0] + Math.cos(ledge.yaw) * 4.5, ledge.base, ledge.approach[2] + Math.sin(ledge.yaw) * 4.5] as Vec3, clearance: 1, low: ledge.base - 0.2, high: ledge.base + ledge.height + 2 })),
    ...route.stairs.map((flight, index) => ({ label: `stairs ${index}`, a: flight.from, b: flight.to, clearance: 1.25, low: flight.from[1] - 0.2, high: flight.to[1] + 2.2 })),
    ...route.ramps.map(ramp => ({ label: `ramp ${ramp.label}`, a: ramp.from, b: ramp.to, clearance: 2.5, low: Math.min(ramp.from[1], ramp.to[1]) - 0.2, high: Math.max(ramp.from[1], ramp.to[1]) + 2 })),
  ]
  const violations: string[] = []
  for (const { index, bounds } of dressing) {
    for (const lane of lanes) if (overlaps(bounds, lane.low, lane.high) && flatDistance(bounds, lane.a, lane.b) < lane.clearance) violations.push(`collider ${index} at ${bounds.min.map(v => v.toFixed(1))}..${bounds.max.map(v => v.toFixed(1))} blocks ${lane.label}`)
    for (const gate of route.gates) {
      const g = boundsOf({ kind: 'box', half: [...gate.half], position: [...gate.at], rotation: [0, gate.yaw, 0] })
      if ([0, 1, 2].every(axis => bounds.max[axis]! > g.min[axis]! && bounds.min[axis]! < g.max[axis]!)) violations.push(`collider ${index} at ${bounds.min.map(v => v.toFixed(1))}..${bounds.max.map(v => v.toFixed(1))} intersects gate ${gate.name}`)
    }
  }
  expect(violations).toEqual([])
})
