import { Box3, Quaternion, Vector3 } from 'three'
import type { RapierCollider, RapierRigidBody, useRapier } from '@react-three/rapier'
import type { QueryHit, RayQuery, SphereSweepQuery } from '@blacksite/armory'
import type { CharacterWorld } from './state'

type Rapier = ReturnType<typeof useRapier>
type Shape = {
  halfExtents?: { x: number; y: number; z: number }
  borderRadius?: number
  radius?: number
  halfHeight?: number
  vertices?: Float32Array
  heights?: Float32Array
  scale?: { x: number; y: number; z: number }
}

const fixed = (collider: RapierCollider) => collider.parent()?.isFixed() ?? true

export function shapeBox(shape: Shape, box = new Box3()) {
  const round = shape.borderRadius ?? 0
  if (shape.halfExtents) {
    const { x, y, z } = shape.halfExtents
    return box.set(new Vector3(-x - round, -y - round, -z - round), new Vector3(x + round, y + round, z + round))
  }
  if (shape.heights && shape.scale) {
    let low = Infinity, high = -Infinity
    for (const height of shape.heights) { low = Math.min(low, height); high = Math.max(high, height) }
    const { x, y, z } = shape.scale
    return box.set(new Vector3(-x / 2, low * y, -z / 2), new Vector3(x / 2, high * y, z / 2))
  }
  if (shape.vertices) {
    box.makeEmpty()
    const point = new Vector3()
    for (let index = 0; index + 2 < shape.vertices.length; index += 3) box.expandByPoint(point.fromArray(shape.vertices, index))
    return box.expandByScalar(round)
  }
  const radius = (shape.radius ?? 0) + round
  const half = (shape.halfHeight ?? 0) + radius
  return box.set(new Vector3(-radius, -half, -radius), new Vector3(radius, half, radius))
}

export function colliderBounds(colliders: Iterable<{ shape: unknown; translation(): { x: number; y: number; z: number }; rotation(): { x: number; y: number; z: number; w: number } }>) {
  const total = new Box3()
  const local = new Box3()
  const corner = new Vector3()
  const turn = new Quaternion()
  for (const collider of colliders) {
    shapeBox(collider.shape as Shape, local)
    if (local.isEmpty()) continue
    const at = collider.translation(), rotation = collider.rotation()
    turn.set(rotation.x, rotation.y, rotation.z, rotation.w)
    for (let index = 0; index < 8; index++) {
      corner.set(index & 1 ? local.max.x : local.min.x, index & 2 ? local.max.y : local.min.y, index & 4 ? local.max.z : local.min.z)
      total.expandByPoint(corner.applyQuaternion(turn).add(at))
    }
  }
  return total.isEmpty() ? null : { min: total.min.toArray() as [number, number, number], max: total.max.toArray() as [number, number, number] }
}

export function createCharacterWorld({ world, rapier }: Rapier, owner: () => RapierRigidBody | null = () => null): CharacterWorld {
  const ray = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
  const shot = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 })
  const turn = { x: 0, y: 0, z: 0, w: 1 }
  const other = (collider: RapierCollider) => collider.parent()?.handle !== owner()?.handle
  const hit = (collider: RapierCollider, point: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number }, distance: number): QueryHit => ({
    colliderId: String(collider.handle), point: { x: point.x, y: point.y, z: point.z }, normal: { x: normal.x, y: normal.y, z: normal.z }, distance,
  })
  const scene = {
    castRay(query: RayQuery) {
      const { origin, direction } = query
      const length = Math.hypot(direction.x, direction.y, direction.z) || 1
      shot.origin = origin
      shot.dir = { x: direction.x / length, y: direction.y / length, z: direction.z / length }
      const found = world.castRayAndGetNormal(shot, query.maxDistance, query.solid, undefined, undefined, undefined, undefined, other)
      return found ? hit(found.collider, shot.pointAt(found.timeOfImpact), found.normal, found.timeOfImpact) : null
    },
    sweepSphere(query: SphereSweepQuery) {
      const { from, to } = query
      const travel = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
      const distance = Math.hypot(travel.x, travel.y, travel.z)
      if (!distance) return null
      const found = world.castShape(from, turn, travel, new rapier.Ball(query.radius), 0, 1, true, undefined, undefined, undefined, undefined, other)
      if (!found) return null
      const t = found.time_of_impact
      const center = { x: from.x + travel.x * t, y: from.y + travel.y * t, z: from.z + travel.z * t }
      const normal = { x: -found.normal1.x, y: -found.normal1.y, z: -found.normal1.z }
      return hit(found.collider, { x: center.x - normal.x * query.radius, y: center.y - normal.y * query.radius, z: center.z - normal.z * query.radius }, normal, t * distance)
    },
    bounds() {
      const colliders: RapierCollider[] = []
      world.forEachCollider(collider => { if (fixed(collider)) colliders.push(collider) })
      return colliderBounds(colliders)
    },
    groundAt(x: number, z: number) {
      const top = (scene.bounds()?.max[1] ?? 100) + 1
      ray.origin = { x, y: top, z }
      const hit = world.castRay(ray, top + 1000, true, undefined, undefined, undefined, undefined, fixed)
      return hit ? top - hit.timeOfImpact : null
    },
  }
  return scene
}
