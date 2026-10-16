import * as THREE from 'three'
import { fractureFragmentAtImpact, fragmentSurfaceGeometry, type FragmentDef } from '@blacksite/cascade/chips'
import { LEVEL, type Block } from './layout'
import type { V3 } from './geometry'

type Piece = { def: FragmentDef; mesh: THREE.Mesh; fracture: THREE.Mesh | null; chips: number }
type Debris = { mesh: THREE.Group; velocity: THREE.Vector3; spin: THREE.Vector3; life: number; resting: boolean; floor: number }

const DENSITY = 2400
const MAX_CHIPS = 5
const MAX_DEBRIS = 28

export function createChips(root: THREE.Object3D, heroes: Map<string, THREE.Mesh>) {
  const group = new THREE.Group()
  group.name = 'chips'
  root.add(group)
  const scar = new THREE.MeshStandardMaterial({ color: '#b9b2a2', roughness: 0.95 })
  const pieces = new Map<string, Piece[]>()
  const debris: Debris[] = []
  const blocks = new Map(LEVEL.blocks.filter(block => block.hero).map(block => [block.id, block]))
  let serial = 1
  let budget = 0

  const define = (block: Block): FragmentDef => {
    const size: [number, number, number] = [block.max[0] - block.min[0], block.max[1] - block.min[1], block.max[2] - block.min[2]]
    return { id: serial++, mass: size[0] * size[1] * size[2] * DENSITY, material: 0, position: [(block.min[0] + block.max[0]) / 2, (block.min[1] + block.max[1]) / 2, (block.min[2] + block.max[2]) / 2], size, aggregate: 0, anchored: true, region: 0 }
  }

  const build = (def: FragmentDef, material: THREE.Material) => {
    const outside = fragmentSurfaceGeometry(def, 'exterior')
    const inside = fragmentSurfaceGeometry(def, 'fracture')
    const mesh = new THREE.Mesh(outside ?? new THREE.BufferGeometry(), material)
    const fracture = inside ? new THREE.Mesh(inside, scar) : null
    for (const part of [mesh, fracture]) {
      if (!part) continue
      part.castShadow = true
      part.receiveShadow = true
      part.position.set(...def.position)
      part.updateMatrix()
      part.matrixAutoUpdate = false
      group.add(part)
    }
    return { def, mesh, fracture, chips: 0 }
  }

  const free = (piece: Piece) => {
    for (const part of [piece.mesh, piece.fracture]) {
      if (!part) continue
      part.removeFromParent()
      part.geometry.dispose()
    }
  }

  const contains = (def: FragmentDef, point: V3, slack: number) => {
    const shape = def.shape
    if (!shape) return Math.abs(point.x - def.position[0]) <= def.size[0] / 2 + slack && Math.abs(point.y - def.position[1]) <= def.size[1] / 2 + slack && Math.abs(point.z - def.position[2]) <= def.size[2] / 2 + slack
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (const vertex of shape.vertices) for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis]!, vertex[axis]!); max[axis] = Math.max(max[axis]!, vertex[axis]!) }
    const local = [point.x - def.position[0], point.y - def.position[1], point.z - def.position[2]]
    return local.every((value, axis) => value >= min[axis]! - slack && value <= max[axis]! + slack)
  }

  const fling = (def: FragmentDef, material: THREE.Material, normal: V3) => {
    if (debris.length >= MAX_DEBRIS) {
      const old = debris.shift()!
      old.mesh.removeFromParent()
      old.mesh.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose() })
    }
    const piece = new THREE.Group()
    for (const [surface, paint] of [['exterior', material], ['fracture', scar]] as const) {
      const geometry = fragmentSurfaceGeometry({ ...def, position: [0, 0, 0] }, surface)
      if (geometry) piece.add(new THREE.Mesh(geometry, paint))
    }
    piece.position.set(...def.position)
    group.add(piece)
    const velocity = new THREE.Vector3(normal.x, normal.y, normal.z).multiplyScalar(1.2 + Math.random() * 2.2).add(new THREE.Vector3((Math.random() - 0.5) * 1.4, 0.8 + Math.random() * 1.6, (Math.random() - 0.5) * 1.4))
    debris.push({ mesh: piece, velocity, spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14), life: 14, resting: false, floor: Math.max(0, Math.min(...def.size) / 2) })
  }

  return {
    warm() {
      const probe: FragmentDef = { id: 0, mass: 100, material: 0, position: [0, 0, 0], size: [0.6, 1.2, 0.6], aggregate: 0, anchored: true, region: 0 }
      for (let index = 0; index < 3; index++) fractureFragmentAtImpact(probe, [0.3, 0.1 * index, 0], [-1, 0, 0], 0.16, 0.1, index + 1)
    },
    hit(blockId: string, point: V3, direction: V3, normal: V3, power: number) {
      const block = blocks.get(blockId)
      if (!block || budget > 0) return false
      let list = pieces.get(blockId)
      const material = heroes.get(blockId)?.material as THREE.Material | undefined
      if (!material) return false
      if (!list) {
        const hero = heroes.get(blockId)!
        hero.visible = false
        list = [build(define(block), material)]
        pieces.set(blockId, list)
      }
      const index = list.findIndex(piece => contains(piece.def, point, 0.04))
      const piece = list[index]
      if (!piece || piece.chips >= MAX_CHIPS) return false
      const local: [number, number, number] = [point.x - piece.def.position[0], point.y - piece.def.position[1], point.z - piece.def.position[2]]
      const radius = 0.12 + power * 0.06
      const split = fractureFragmentAtImpact({ ...piece.def, position: [0, 0, 0] }, local, [direction.x, direction.y, direction.z], radius, 0.08 + power * 0.05, serial++)
      if (!split || !split.retained.length) return false
      budget = 0.06
      free(piece)
      const world = (def: FragmentDef): FragmentDef => ({ ...def, id: serial++, position: [def.position[0] + piece.def.position[0], def.position[1] + piece.def.position[1], def.position[2] + piece.def.position[2]] })
      const retained = split.retained.map(def => { const next = build(world(def), material); next.chips = piece.chips + 1; return next })
      list.splice(index, 1, ...retained)
      for (const def of split.detached.slice(0, 3)) fling(world(def), material, normal)
      return true
    },
    update(dt: number) {
      budget = Math.max(0, budget - dt)
      for (let index = debris.length - 1; index >= 0; index--) {
        const item = debris[index]!
        item.life -= dt
        if (item.life <= 0) {
          item.mesh.removeFromParent()
          item.mesh.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose() })
          debris.splice(index, 1)
          continue
        }
        if (item.resting) continue
        item.velocity.y -= 9.8 * dt
        item.mesh.position.addScaledVector(item.velocity, dt)
        item.mesh.rotation.x += item.spin.x * dt
        item.mesh.rotation.y += item.spin.y * dt
        item.mesh.rotation.z += item.spin.z * dt
        if (item.mesh.position.y < item.floor && item.velocity.y < 0) {
          item.mesh.position.y = item.floor
          item.velocity.y *= -0.25
          item.velocity.x *= 0.5
          item.velocity.z *= 0.5
          item.spin.multiplyScalar(0.4)
          if (Math.abs(item.velocity.y) < 0.4) item.resting = true
        }
      }
    },
    reset() {
      for (const [id, list] of pieces) { list.forEach(free); const hero = heroes.get(id); if (hero) hero.visible = true }
      pieces.clear()
      for (const item of debris) { item.mesh.removeFromParent(); item.mesh.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose() }) }
      debris.length = 0
    },
    dispose() { this.reset(); scar.dispose(); group.removeFromParent() },
  }
}

export type Chips = ReturnType<typeof createChips>
