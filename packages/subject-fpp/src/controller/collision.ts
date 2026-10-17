export type V3 = { x: number; y: number; z: number }

export interface Collision {
  support(x: number, z: number, radius: number, feet: number, step: number): number
  ceiling(x: number, z: number, radius: number, feet: number): number
  slide(position: V3, radius: number, feet: number, head: number, step: number): void
}

export type Solid =
  | { readonly kind: 'box'; readonly x: number; readonly z: number; readonly halfX: number; readonly halfZ: number; readonly yaw: number; readonly bottom: number; readonly top: number }
  | { readonly kind: 'cylinder'; readonly x: number; readonly z: number; readonly radius: number; readonly bottom: number; readonly top: number }

export type LevelCollider =
  | { readonly kind: 'box'; readonly half: readonly [number, number, number]; readonly position: readonly [number, number, number]; readonly rotation: readonly [number, number, number] }
  | { readonly kind: 'cylinder'; readonly halfHeight: number; readonly radius: number; readonly position: readonly [number, number, number]; readonly rotation: readonly [number, number, number] }

export function solidsFromColliders(colliders: ReadonlyArray<LevelCollider>): Solid[] {
  return colliders.map(collider => {
    const [x, y, z] = collider.position
    if (collider.kind === 'cylinder') return { kind: 'cylinder', x, z, radius: collider.radius, bottom: y - collider.halfHeight, top: y + collider.halfHeight }
    const [hx, hy, hz] = collider.half
    return { kind: 'box', x, z, halfX: hx, halfZ: hz, yaw: collider.rotation[1], bottom: y - hy, top: y + hy }
  })
}

export function solidsFromBounds(bounds: ReadonlyArray<{ readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] }>): Solid[] {
  return bounds.map(({ min, max }) => ({ kind: 'box', x: (min[0] + max[0]) / 2, z: (min[2] + max[2]) / 2, halfX: (max[0] - min[0]) / 2, halfZ: (max[2] - min[2]) / 2, yaw: 0, bottom: min[1], top: max[1] }))
}

const nearest = { x: 0, z: 0, inside: false, exitX: 0, exitZ: 0 }

function closest(solid: Solid, x: number, z: number) {
  if (solid.kind === 'cylinder') {
    const dx = x - solid.x, dz = z - solid.z
    const length = Math.hypot(dx, dz)
    nearest.inside = length < solid.radius
    const scale = length > 1e-9 ? Math.min(1, solid.radius / length) : 0
    nearest.x = solid.x + dx * scale
    nearest.z = solid.z + dz * scale
    nearest.exitX = length > 1e-9 ? solid.x + dx / length * solid.radius : solid.x + solid.radius
    nearest.exitZ = length > 1e-9 ? solid.z + dz / length * solid.radius : solid.z
    return nearest
  }
  const cos = Math.cos(solid.yaw), sin = Math.sin(solid.yaw)
  const dx = x - solid.x, dz = z - solid.z
  const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos
  const cx = Math.max(-solid.halfX, Math.min(lx, solid.halfX))
  const cz = Math.max(-solid.halfZ, Math.min(lz, solid.halfZ))
  nearest.inside = cx === lx && cz === lz
  let ex = cx, ez = cz
  if (nearest.inside) {
    const left = lx + solid.halfX, right = solid.halfX - lx, back = lz + solid.halfZ, front = solid.halfZ - lz
    const least = Math.min(left, right, back, front)
    if (least === left) ex = -solid.halfX
    else if (least === right) ex = solid.halfX
    else if (least === back) ez = -solid.halfZ
    else ez = solid.halfZ
  }
  nearest.x = solid.x + cx * cos + cz * sin
  nearest.z = solid.z - cx * sin + cz * cos
  nearest.exitX = solid.x + ex * cos + ez * sin
  nearest.exitZ = solid.z - ex * sin + ez * cos
  return nearest
}

export function solidCollision(solids: ReadonlyArray<Solid>, floor = 0): Collision {
  return {
    support(x, z, radius, feet, step) {
      let height = floor
      const inner = radius * 0.7
      for (const solid of solids) {
        if (solid.top > feet + step || solid.top <= height) continue
        const point = closest(solid, x, z)
        if ((x - point.x) ** 2 + (z - point.z) ** 2 > inner * inner) continue
        height = solid.top
      }
      return height
    },
    ceiling(x, z, radius, feet) {
      let height = Infinity
      for (const solid of solids) {
        if (solid.bottom <= feet + 0.01 || solid.bottom >= height) continue
        const point = closest(solid, x, z)
        if ((x - point.x) ** 2 + (z - point.z) ** 2 >= radius * radius) continue
        height = solid.bottom
      }
      return height
    },
    slide(position, radius, feet, head, step) {
      for (let pass = 0; pass < 3; pass++) {
        let moved = false
        for (const solid of solids) {
          if (solid.top <= feet + step || solid.bottom >= head) continue
          const point = closest(solid, position.x, position.z)
          if (point.inside) {
            const dx = point.exitX - solid.x, dz = point.exitZ - solid.z
            const length = Math.hypot(dx, dz) || 1
            const outX = point.exitX - position.x, outZ = point.exitZ - position.z
            const along = Math.hypot(outX, outZ) || 1
            position.x = point.exitX + (solid.kind === 'cylinder' ? dx / length : outX / along) * radius
            position.z = point.exitZ + (solid.kind === 'cylinder' ? dz / length : outZ / along) * radius
            moved = true
            continue
          }
          const dx = position.x - point.x, dz = position.z - point.z
          const distance = dx * dx + dz * dz
          if (distance >= radius * radius) continue
          const length = Math.sqrt(distance)
          position.x = point.x + dx / length * radius
          position.z = point.z + dz / length * radius
          moved = true
        }
        if (!moved) break
      }
    },
  }
}
