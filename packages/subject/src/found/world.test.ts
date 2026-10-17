import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { FIELD_WEAPONS } from './field'

type Node = { name: string; translation?: number[]; children?: number[] }

function nodes(file: string): Node[] {
  const bytes = readFileSync(new URL(file, import.meta.url))
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()).nodes
}

function child(list: Node[], parent: string, pattern: RegExp) {
  const node = list.find(entry => entry.name === parent)!
  const found = (node.children ?? []).map(index => list[index]!).find(entry => pattern.test(entry.name))!
  return new Vector3().fromArray(found.translation ?? [0, 0, 0])
}

describe('world weapon grip', () => {
  it.each([
    ['rifle', '../../assets/found/rifle.glb', '../../../../vendor/als-web/public/assets/skm-als-rifle.glb'],
    ['pistol', '../../assets/found/pistol.glb', '../../../../vendor/als-web/public/assets/skm-als-pistol.glb'],
  ] as const)('puts the %s trigger where the ALS prop holds its trigger', (weapon, found, prop) => {
    const spec = FIELD_WEAPONS[weapon]
    const grip = spec.world
    const trigger = child(nodes(found), spec.sight.bone, /trigger$/)
      .multiplyScalar(grip.scale)
      .applyQuaternion(new Quaternion().setFromEuler(new Euler(...grip.rotation)))
      .add(new Vector3(...grip.position))
    const expected = child(nodes(prop), 'root', /^trigger$/)
    expect(trigger.distanceTo(expected)).toBeLessThan(0.002)
  })
})
