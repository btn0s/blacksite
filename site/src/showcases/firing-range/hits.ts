import * as THREE from 'three'

export type Surface = 'concrete' | 'metal' | 'wood' | 'dirt' | 'canvas' | 'paper' | 'steel'

export type Solid = {
  id: string
  surface: Surface
  shape: 'box' | 'cylinder'
  half: THREE.Vector3
  matrix: THREE.Matrix4
  inverse: THREE.Matrix4
  object?: THREE.Object3D
  disc?: number
  targetId?: string
}

export type RayHit = { distance: number; point: THREE.Vector3; normal: THREE.Vector3; local: THREE.Vector3; solid: Solid }

const origin = new THREE.Vector3()
const direction = new THREE.Vector3()
const inverse = new THREE.Matrix4()
const localNormal = new THREE.Vector3()

export function staticSolid(id: string, surface: Surface, shape: 'box' | 'cylinder', half: [number, number, number], position: [number, number, number], rotation: [number, number, number]): Solid {
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1))
  return { id, surface, shape, half: new THREE.Vector3(...half), matrix, inverse: matrix.clone().invert() }
}

function castLocal(solid: Solid, maxDistance: number): number {
  const half = solid.half
  if (solid.shape === 'cylinder') {
    const a = direction.x * direction.x + direction.z * direction.z
    let best = Infinity
    if (a > 1e-9) {
      const b = 2 * (origin.x * direction.x + origin.z * direction.z)
      const c = origin.x * origin.x + origin.z * origin.z - half.x * half.x
      const disc = b * b - 4 * a * c
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / (2 * a)
        const y = origin.y + direction.y * t
        if (t >= 0 && Math.abs(y) <= half.y) { best = t; localNormal.set(origin.x + direction.x * t, 0, origin.z + direction.z * t).normalize() }
      }
    }
    if (Math.abs(direction.y) > 1e-9) {
      for (const side of [-1, 1]) {
        const t = (side * half.y - origin.y) / direction.y
        if (t < 0 || t >= best) continue
        const x = origin.x + direction.x * t
        const z = origin.z + direction.z * t
        if (x * x + z * z <= half.x * half.x) { best = t; localNormal.set(0, side, 0) }
      }
    }
    return best <= maxDistance ? best : Infinity
  }
  let near = -Infinity
  let far = Infinity
  let axis = 0
  let sign = 1
  for (let index = 0; index < 3; index++) {
    const o = origin.getComponent(index)
    const d = direction.getComponent(index)
    const h = half.getComponent(index)
    if (Math.abs(d) < 1e-9) { if (o < -h || o > h) return Infinity; continue }
    let t1 = (-h - o) / d
    let t2 = (h - o) / d
    let entering = -1
    if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; entering = 1 }
    if (t1 > near) { near = t1; axis = index; sign = entering }
    far = Math.min(far, t2)
    if (near > far) return Infinity
  }
  if (far < 0 || near > maxDistance) return Infinity
  if (near < 0) { localNormal.copy(direction).negate(); return 0 }
  localNormal.set(0, 0, 0).setComponent(axis, sign)
  if (solid.disc !== undefined) {
    const x = origin.x + direction.x * near
    const y = origin.y + direction.y * near
    if (x * x + y * y > solid.disc * solid.disc) return Infinity
  }
  return near
}

export function castRay(solids: readonly Solid[], from: THREE.Vector3, along: THREE.Vector3, maxDistance: number): RayHit | null {
  let best: RayHit | null = null
  let bestDistance = maxDistance
  const bestNormal = new THREE.Vector3()
  for (const solid of solids) {
    if (solid.object) {
      if (!solid.object.visible) continue
      inverse.copy(solid.object.matrixWorld).invert()
    } else inverse.copy(solid.inverse)
    origin.copy(from).applyMatrix4(inverse)
    direction.copy(along).transformDirection(inverse)
    const distance = castLocal(solid, bestDistance)
    if (distance < bestDistance) {
      bestDistance = distance
      bestNormal.copy(localNormal)
      const local = origin.clone().addScaledVector(direction, distance)
      best = { distance, point: from.clone().addScaledVector(along, distance), normal: new THREE.Vector3(), local, solid }
    }
  }
  if (best) best.normal.copy(bestNormal).transformDirection(best.solid.object ? best.solid.object.matrixWorld : best.solid.matrix)
  return best
}
