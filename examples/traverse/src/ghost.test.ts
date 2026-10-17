import * as THREE from 'three'
import { expect, test } from 'vitest'
import { decodeTake, encodeTake, GhostRecorder } from './ghost'

function runner(x: number) {
  const model = new THREE.Group()
  const root = new THREE.Bone()
  root.name = 'root'
  model.add(root)
  model.position.x = x
  return { model, root }
}

test('a restarted run records the replacement character and preserves an in-progress take on respawn', () => {
  const first = runner(4)
  const replacement = runner(12)
  const recorder = new GhostRecorder(first.model)
  recorder.sample(0)
  recorder.bind(replacement.model)
  first.model.position.x = 100
  replacement.root.position.y = 0.4
  recorder.sample(0.05)
  const take = decodeTake(encodeTake(recorder.take(0.05)))
  expect(take.frames).toBe(2)
  expect(take.root[0]).toBe(4)
  expect(take.root[7]).toBe(12)
  expect(take.positions[4]).toBeCloseTo(0.4)
  recorder.reset()
  replacement.model.position.x = 15
  recorder.sample(0)
  expect(recorder.take(0).root[0]).toBe(15)
})
