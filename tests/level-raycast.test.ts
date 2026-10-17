import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { LevelBuilder } from '../packages/look/src/world/builder'

beforeAll(() => {
  const image = { addEventListener() {}, removeEventListener() {}, set src(_: string) {} }
  Object.assign(globalThis, { document: { createElementNS: () => image } })
})

describe('LevelBuilder raycast', () => {
  it('returns the same hits as a full raycast while testing only crossed parts', () => {
    const level = new LevelBuilder({ coplanar: 'ignore' })
    for (let x = -20; x <= 20; x += 2) level.box([1.5, 1 + (x & 3), 1.5], { name: 'cast' }, { at: [x, 0.5, 0], shadow: false })
    level.box([3, 0.2, 6], { name: 'cast' }, { at: [4, 2.4, 0], rotate: [0, 0, 0.4], shadow: false })
    level.plane(12, 8, { name: 'asphalt' }, { at: [0, 0.01, 4] })
    const group = level.build()
    group.updateMatrixWorld(true)
    const raycaster = new THREE.Raycaster()
    const rays: Array<[THREE.Vector3, THREE.Vector3]> = [
      [new THREE.Vector3(4, 6, 0), new THREE.Vector3(0, -1, 0)],
      [new THREE.Vector3(1, 3, 4), new THREE.Vector3(0, -1, 0)],
      [new THREE.Vector3(-30, 0.4, 0.1), new THREE.Vector3(1, 0, 0)],
      [new THREE.Vector3(0, 8, 9), new THREE.Vector3(0.3, -1, -0.8).normalize()],
    ]
    for (const [origin, direction] of rays) {
      raycaster.set(origin, direction)
      const fast = raycaster.intersectObject(group, true).map(hit => [hit.object.name, hit.faceIndex, +hit.distance.toFixed(6)])
      const full: THREE.Intersection[] = []
      group.traverse(object => { if ((object as THREE.Mesh).isMesh) THREE.Mesh.prototype.raycast.call(object, raycaster, full) })
      full.sort((a, b) => a.distance - b.distance)
      expect(fast).toEqual(full.map(hit => [hit.object.name, hit.faceIndex, +hit.distance.toFixed(6)]))
      expect(fast.length).toBeGreaterThan(0)
    }
  })
})
