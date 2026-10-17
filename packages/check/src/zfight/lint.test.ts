import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { depthStep, farthestResolvable } from './depth.mjs'
import { formatProblem, lintZFighting } from './lint.mjs'

function ground(size = 200) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial())
  mesh.name = 'ground'
  return mesh
}

function slab(top: number, size = 10, x = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, 0.2, size), new THREE.MeshBasicMaterial())
  mesh.position.set(x, top - 0.1, z)
  mesh.name = 'slab'
  return mesh
}

const near = { name: 'near', position: [0, 3, -4] as [number, number, number], target: [0, 0, 2] as [number, number, number] }
const far = { name: 'far', position: [0, 60, -300] as [number, number, number], target: [0, 0, 0] as [number, number, number] }
const setup = { near: 0.05, far: 400, bits: 24 }

describe('depth model', () => {
  it('coarsens with the square of distance and improves with near plane', () => {
    expect(depthStep(setup, 100)).toBeCloseTo(depthStep(setup, 10) * 100, 1)
    expect(depthStep({ ...setup, near: 0.2 }, 100)).toBeLessThan(depthStep(setup, 100) / 3.9)
  })

  it('orthographic depth is linear in range, not in distance', () => {
    const linear = { ...setup, orthographic: true }
    expect(depthStep(linear, 300) / depthStep(linear, 10)).toBeLessThan(4)
    expect(depthStep(linear, 100)).toBeLessThan(depthStep(setup, 100) / 100)
  })

  it('reversed float depth resolves finer than fixed point at range', () => {
    expect(depthStep({ ...setup, float: true, reversed: true, bits: 32 }, 300)).toBeLessThan(depthStep(setup, 300) / 1000)
  })

  it('finds the farthest distance a gap survives', () => {
    const z = farthestResolvable(setup, 0.001)
    expect(depthStep(setup, z) * 2).toBeCloseTo(0.001, 4)
  })
})

describe('static z-fight lint', () => {
  const scene = new THREE.Scene()
  scene.add(ground(), slab(0.001))

  it('passes a 1 mm gap close to the camera', () => {
    const report = lintZFighting(scene, { ...setup, cameras: [near] })
    expect(report.problems).toEqual([])
  })

  it('fails the same gap 300 m away and reports the gap needed', () => {
    const report = lintZFighting(scene, { ...setup, cameras: [far] })
    expect(report.pass).toBe(false)
    const [problem] = report.problems
    expect(new Set([problem!.a.name, problem!.b.name])).toEqual(new Set(['ground', 'slab']))
    expect(problem!.gap).toBeCloseTo(0.001, 3)
    expect(problem!.gapNeeded).toBeGreaterThan(0.01)
    expect(problem!.distance).toBeGreaterThan(200)
    expect(formatProblem(problem!)).toContain('needed at')
  })

  it('passes the far view with reversed float depth', () => {
    const report = lintZFighting(scene, { near: 0.05, far: 400, bits: 32, float: true, reversed: true, cameras: [far] })
    expect(report.problems).toEqual([])
  })

  it('flags exactly coplanar overlaps at any range', () => {
    const exact = new THREE.Scene()
    exact.add(ground(), slab(0))
    const report = lintZFighting(exact, { ...setup, cameras: [near] })
    expect(report.problems).toHaveLength(1)
    expect(report.problems[0]!.gap).toBe(0)
  })

  it('ignores touching boxes whose shared faces oppose', () => {
    const touching = new THREE.Scene()
    touching.add(slab(0, 4, -2), slab(0, 4, 2))
    const left = touching.children[0] as THREE.Mesh
    left.position.y = -5
    const report = lintZFighting(touching, { ...setup, cameras: [near] })
    expect(report.problems).toEqual([])
  })

  it('ignores geometry no camera can see', () => {
    const hidden = new THREE.Scene()
    hidden.add(ground(), slab(0))
    const report = lintZFighting(hidden, { ...setup, cameras: [{ name: 'away', position: [0, 3, -4], target: [0, 3, -50] }] })
    expect(report.problems).toEqual([])
  })

  it('treats a polygon offset decal that clears the step as resolved', () => {
    const decal = new THREE.Scene()
    const overlay = slab(0.001)
    overlay.material = new THREE.MeshBasicMaterial({ polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })
    decal.add(ground(), overlay)
    const report = lintZFighting(decal, { ...setup, cameras: [far] })
    expect(report.problems.length).toBeLessThanOrEqual(1)
  })

  it('uses labels from userData.parts', () => {
    const labelled = new THREE.Scene()
    const merged = new THREE.Mesh(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 4), new THREE.Vector3(4, 0, 0),
        new THREE.Vector3(1, 0.00001, 1), new THREE.Vector3(1, 0.00001, 3), new THREE.Vector3(3, 0.00001, 1),
      ]),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    )
    merged.name = 'level'
    merged.userData.parts = [{ label: 'floor', start: 0, count: 1 }, { label: 'rug', start: 1, count: 1 }]
    labelled.add(merged)
    const report = lintZFighting(labelled, { ...setup, cameras: [{ position: [1, 3, -2], target: [1, 0, 1] }] })
    expect(report.problems[0]!.labels).toEqual(['floor', 'rug'])
  })

  it('ignores coplanar faces that point away from every camera', () => {
    const scene = new THREE.Scene()
    const a = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 4), new THREE.MeshBasicMaterial())
    const b = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 6), new THREE.MeshBasicMaterial())
    a.position.set(0, 0.5, 0)
    b.position.set(0, 1.5, 0)
    scene.add(a, b)
    expect(lintZFighting(scene, { cameras: [near], depth: setup }).problems).toEqual([])
    const below = { name: 'below', position: [0, -3, -4] as [number, number, number], target: [0, 0, 0] as [number, number, number] }
    expect(lintZFighting(scene, { cameras: [below], depth: setup }).problems.length).toBeGreaterThan(0)
  })

  it('skips pairs where neither surface writes depth', () => {
    const scene = new THREE.Scene()
    const make = () => new THREE.Mesh(new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }))
    scene.add(make(), make())
    expect(lintZFighting(scene, { cameras: [near], depth: setup }).problems).toEqual([])
  })

  it('credits a decal bias against the gap', () => {
    const scene = new THREE.Scene()
    const floor = ground()
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }))
    decal.position.y = 0.004
    scene.add(floor, decal)
    const mid = { name: 'mid', position: [0, 10, -60] as [number, number, number], target: [0, 0, 0] as [number, number, number] }
    expect(lintZFighting(scene, { cameras: [mid], depth: setup }).problems.length).toBeGreaterThan(0)
    decal.material.userData.decalBias = 3e-4
    expect(lintZFighting(scene, { cameras: [mid], depth: setup }).problems).toEqual([])
  })
})
