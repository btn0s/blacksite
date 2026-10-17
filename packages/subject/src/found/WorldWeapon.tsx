import { use, useLayoutEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Bone, Group, type Object3D } from 'three'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import type { ArmsWeapon } from '../arms/state'
import { preloadFoundAssets } from './assets'
import type { FoundAssets } from './runtime'
import type { FoundSet } from './model'
import { FIELD_SET } from './sets'

export const WORLD_WEAPON_BONE = 'VB hand_r_to_ik_hand_gun'

export function worldWeapon(assets: FoundAssets, set: FoundSet, weapon: ArmsWeapon) {
  const spec = set.weapons[weapon]
  const source = assets[weapon].scene.getObjectByName(spec.sight.bone)
  if (!source) throw new Error(`Found world weapon bone ${spec.sight.bone} is missing`)
  const model = source.clone(true)
  model.position.set(0, 0, 0)
  model.quaternion.identity()
  model.scale.set(1, 1, 1)
  const grip = new Group()
  grip.name = `WorldWeapon_${weapon}`
  grip.position.fromArray(spec.world.position)
  grip.rotation.fromArray(spec.world.rotation)
  grip.scale.setScalar(spec.world.scale)
  grip.add(model)
  return grip
}

export function WorldWeapon({ characterScene, weapon, found = FIELD_SET }: { characterScene: Object3D; weapon: () => ArmsWeapon; found?: FoundSet }) {
  const assets = use(preloadFoundAssets(found))
  const grips = useMemo(() => ({ rifle: worldWeapon(assets, found, 'rifle'), pistol: worldWeapon(assets, found, 'pistol') }), [assets, found])
  useLayoutEffect(() => {
    const bone = characterScene.getObjectByName(WORLD_WEAPON_BONE)
    if (!(bone instanceof Bone)) throw new Error(`World weapon bone ${WORLD_WEAPON_BONE} is missing`)
    bone.add(grips.rifle, grips.pistol)
    return () => { grips.rifle.removeFromParent(); grips.pistol.removeFromParent() }
  }, [characterScene, grips])
  useFrame(() => {
    const current = weapon()
    grips.rifle.visible = current === 'rifle'
    grips.pistol.visible = current === 'pistol'
  }, ALS_FRAME_PRIORITY.PosePublication)
  return null
}
