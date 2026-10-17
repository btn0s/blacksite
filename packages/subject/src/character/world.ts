import { Box3, Quaternion, Vector3 } from 'three'
import type { RapierCollider, useRapier } from '@react-three/rapier'
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

export function createCharacterWorld({ world, rapier }: Rapier): CharacterWorld {
  const ray = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
  const scene = {
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
