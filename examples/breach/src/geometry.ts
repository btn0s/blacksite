import { LEVEL, type Block, type Hit } from './layout'
import { HIT_ZONES, type HitZone } from './model'

export type V3 = { x: number; y: number; z: number }
export type RayHit = { distance: number; point: V3; normal: V3; block: Block }
export type Target = { id: string; x: number; y: number; z: number; crouch: boolean }
export type TargetHit = { distance: number; point: V3; normal: V3; zone: HitZone; id: string }

const rayBlocks = LEVEL.blocks.filter(block => block.ray)
const bounds = new Float32Array(rayBlocks.length * 6)
rayBlocks.forEach((block, index) => bounds.set([...block.min, ...block.max], index * 6))

export const SOLIDS = LEVEL.blocks.filter(block => block.solid)

export function castLevel(origin: V3, direction: V3, maxDistance: number, skip?: (block: Block) => boolean): RayHit | null {
  const ix = 1 / (direction.x || 1e-12), iy = 1 / (direction.y || 1e-12), iz = 1 / (direction.z || 1e-12)
  let best = maxDistance
  let hit = -1
  let axis = 0
  for (let index = 0; index < rayBlocks.length; index++) {
    const o = index * 6
    let t0x = (bounds[o]! - origin.x) * ix, t1x = (bounds[o + 3]! - origin.x) * ix
    if (t0x > t1x) { const swap = t0x; t0x = t1x; t1x = swap }
    let t0y = (bounds[o + 1]! - origin.y) * iy, t1y = (bounds[o + 4]! - origin.y) * iy
    if (t0y > t1y) { const swap = t0y; t0y = t1y; t1y = swap }
    let t0z = (bounds[o + 2]! - origin.z) * iz, t1z = (bounds[o + 5]! - origin.z) * iz
    if (t0z > t1z) { const swap = t0z; t0z = t1z; t1z = swap }
    const enter = Math.max(t0x, t0y, t0z)
    const exit = Math.min(t1x, t1y, t1z)
    if (exit < Math.max(0, enter) || enter >= best) continue
    if (enter < 0) continue
    if (skip?.(rayBlocks[index]!)) continue
    best = enter
    hit = index
    axis = enter === t0x ? 0 : enter === t0y ? 1 : 2
  }
  if (origin.y + direction.y * best < 0 && direction.y < 0) {
    const ground = -origin.y / direction.y
    if (ground < best) return { distance: ground, point: { x: origin.x + direction.x * ground, y: 0, z: origin.z + direction.z * ground }, normal: { x: 0, y: 1, z: 0 }, block: GROUND }
  }
  if (hit < 0) return null
  const normal = { x: 0, y: 0, z: 0 }
  if (axis === 0) normal.x = direction.x > 0 ? -1 : 1
  else if (axis === 1) normal.y = direction.y > 0 ? -1 : 1
  else normal.z = direction.z > 0 ? -1 : 1
  return { distance: best, point: { x: origin.x + direction.x * best, y: origin.y + direction.y * best, z: origin.z + direction.z * best }, normal, block: rayBlocks[hit]! }
}

export const GROUND: Block = { id: 'ground', min: [-500, -1, -500], max: [500, 0, 500], look: 'dirt', hit: 'dirt', solid: false, ray: true, render: false, cast: false, contact: false }

export function groundHit(x: number, z: number, indoor: boolean): Hit { return indoor ? 'concrete' : Math.abs(x) < 4 && z > 18 ? 'concrete' : 'dirt' }

export function clearLine(from: V3, to: V3) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z
  const length = Math.hypot(dx, dy, dz)
  if (length < 1e-6) return true
  return !castLevel(from, { x: dx / length, y: dy / length, z: dz / length }, length - 0.02)
}

const HEAD = 0.13
const STAND = { head: 1.6, chest: [0.95, 1.46] as const, legs: [0.05, 0.95] as const, radius: 0.22, legRadius: 0.2 }
const CROUCH = { head: 1.08, chest: [0.6, 0.98] as const, legs: [0.05, 0.6] as const, radius: 0.24, legRadius: 0.24 }

function sphere(origin: V3, direction: V3, cx: number, cy: number, cz: number, radius: number) {
  const ox = origin.x - cx, oy = origin.y - cy, oz = origin.z - cz
  const b = ox * direction.x + oy * direction.y + oz * direction.z
  const c = ox * ox + oy * oy + oz * oz - radius * radius
  const disc = b * b - c
  if (disc < 0) return Infinity
  const t = -b - Math.sqrt(disc)
  return t >= 0 ? t : Infinity
}

function cylinder(origin: V3, direction: V3, cx: number, cz: number, y0: number, y1: number, radius: number) {
  const a = direction.x * direction.x + direction.z * direction.z
  if (a < 1e-9) return Infinity
  const ox = origin.x - cx, oz = origin.z - cz
  const b = ox * direction.x + oz * direction.z
  const c = ox * ox + oz * oz - radius * radius
  const disc = b * b - a * c
  if (disc < 0) return Infinity
  const t = (-b - Math.sqrt(disc)) / a
  if (t < 0) return Infinity
  const y = origin.y + direction.y * t
  return y >= y0 && y <= y1 ? t : Infinity
}

export function castTargets(origin: V3, direction: V3, maxDistance: number, targets: Iterable<Target>): TargetHit | null {
  let best: TargetHit | null = null
  for (const target of targets) {
    const shape = target.crouch ? CROUCH : STAND
    const dx = target.x - origin.x, dz = target.z - origin.z
    const along = dx * direction.x + dz * direction.z
    if (along < -1 || along > maxDistance + 1) continue
    const zones: Array<[HitZone, number]> = [
      ['head', sphere(origin, direction, target.x, target.y + shape.head, target.z, HEAD)],
      ['chest', cylinder(origin, direction, target.x, target.z, target.y + shape.chest[0], target.y + shape.chest[1], shape.radius)],
      ['limb', cylinder(origin, direction, target.x, target.z, target.y + shape.legs[0], target.y + shape.legs[1], shape.legRadius)],
    ]
    for (const [zone, t] of zones) {
      if (t > maxDistance || (best && t >= best.distance)) continue
      const point = { x: origin.x + direction.x * t, y: origin.y + direction.y * t, z: origin.z + direction.z * t }
      best = { distance: t, point, normal: { x: -direction.x, y: -direction.y, z: -direction.z }, zone, id: target.id }
    }
  }
  return best
}

export const zoneMultiplier = (zone: HitZone) => HIT_ZONES[zone]

export function supportHeight(x: number, z: number, radius: number, feet: number, step: number) {
  let height = 0
  const inner = radius * 0.7
  for (const block of SOLIDS) {
    if (block.max[1] > feet + step || block.max[1] <= height) continue
    if (x + inner < block.min[0] || x - inner > block.max[0] || z + inner < block.min[2] || z - inner > block.max[2]) continue
    height = block.max[1]
  }
  return height
}

export function slide(position: V3, radius: number, feet: number, head: number, step: number) {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false
    for (const block of SOLIDS) {
      if (block.max[1] <= feet + step || block.min[1] >= head) continue
      const nx = Math.max(block.min[0], Math.min(position.x, block.max[0]))
      const nz = Math.max(block.min[2], Math.min(position.z, block.max[2]))
      const dx = position.x - nx, dz = position.z - nz
      const distance = dx * dx + dz * dz
      if (distance >= radius * radius) continue
      if (distance > 1e-10) {
        const length = Math.sqrt(distance)
        position.x = nx + dx / length * radius
        position.z = nz + dz / length * radius
      } else {
        const left = position.x - block.min[0], right = block.max[0] - position.x, back = position.z - block.min[2], front = block.max[2] - position.z
        const least = Math.min(left, right, back, front)
        if (least === left) position.x = block.min[0] - radius
        else if (least === right) position.x = block.max[0] + radius
        else if (least === back) position.z = block.min[2] - radius
        else position.z = block.max[2] + radius
      }
      moved = true
    }
    if (!moved) break
  }
}
