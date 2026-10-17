import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useFrame, useThree, type RootState } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import * as THREE from 'three'
import { ALS_WEAPONS, createWeaponRuntime, type QueryHit, type WeaponQueries } from '@blacksite/armory'
import { ArmsViewmodel, createArmsState, type ArmsPresentation, type ArmsState, type ArmsWeapon } from '@blacksite/subject-fpp/arms'
import { CheckProbe } from '../../game-shell/src/game/check'
import { PlayHud } from '../../game-shell/src/game/hud'
import { held, take, value } from '../../game-shell/src/game/input'
import { FIXED_STEP } from '../../game-shell/src/game/model'
import { sound } from '../../game-shell/src/game/sound'
import { Stage, surfacesReady, useSurfaces } from '../../game-shell/src/game/stage'
import { WalkerBody, createWalker, type Walker } from '../../game-shell/src/game/walker'

function useQueries(walker: Walker): WeaponQueries {
  const { world, rapier } = useRapier()
  return useMemo(() => {
    const cast = (origin: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }, maxDistance: number): QueryHit | null => {
      const hit = world.castRayAndGetNormal(new rapier.Ray(origin, direction), maxDistance, true, undefined, undefined, walker.collider ?? undefined)
      if (!hit) return null
      const distance = hit.timeOfImpact
      return { colliderId: String(hit.collider.handle), point: { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance, z: origin.z + direction.z * distance }, normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z }, distance }
    }
    return {
      castRay: query => cast(query.origin, query.direction, query.maxDistance),
      sweepSphere: query => {
        const delta = { x: query.to.x - query.from.x, y: query.to.y - query.from.y, z: query.to.z - query.from.z }
        const length = Math.hypot(delta.x, delta.y, delta.z)
        return length ? cast(query.from, { x: delta.x / length, y: delta.y / length, z: delta.z / length }, length) : null
      },
    }
  }, [world, rapier, walker])
}

function Rifle({ walker, arms }: { walker: Walker; arms: ArmsState }) {
  const camera = useThree(state => state.camera)
  const queries = useQueries(walker)
  const weapon = useMemo(() => createWeaponRuntime({ ownerId: 'local', seed: 1, definitions: ALS_WEAPONS }), [])
  const state = useRef({ accumulated: 0, selected: 'rifle' as ArmsWeapon, reload: false })
  const aim = useMemo(() => ({ origin: new THREE.Vector3(), direction: new THREE.Vector3() }), [])
  useFrame((_, delta) => {
    const current = state.current
    if (take('rifle')) current.selected = 'rifle'
    if (take('pistol')) current.selected = 'pistol'
    if (take('reload')) current.reload = true
    const speed = Math.hypot(walker.motor.velocity.x, walker.motor.velocity.z)
    arms.aiming = held('aim')
    arms.sprinting = held('sprint') && !arms.aiming && value('move').y > 0.5 && speed > 4.5
    arms.speed = speed
    aim.origin.copy(camera.position)
    camera.getWorldDirection(aim.direction)
    current.accumulated = Math.min(current.accumulated + delta, 0.1)
    while (current.accumulated >= FIXED_STEP) {
      current.accumulated -= FIXED_STEP
      const events = weapon.step({ tick: weapon.snapshot().nextTick, trigger: held('fire') && !arms.sprinting, reload: current.reload, selectWeaponId: current.selected, aim, muzzle: aim.origin }, queries)
      current.reload = false
      for (const event of events) {
        if (event.type === 'shot') { arms.fireSequence++; sound.play(`weapon.${current.selected}`, { position: [aim.origin.x, aim.origin.y, aim.origin.z] }) }
        if (event.type === 'impact') sound.play('impact.concrete', { position: [event.hit.point.x, event.hit.point.y, event.hit.point.z], delay: true })
        if (event.type === 'reload-started') arms.reloadSequence++
        if (event.type === 'switch-started') { arms.weapon = current.selected; arms.equipSequence++ }
      }
    }
  }, 0.1)
  return null
}

export default function Mode({ onCreated, physicsProbe }: { onCreated?: (state: RootState) => void; physicsProbe?: ReactNode } = {}) {
  const walker = useMemo(createWalker, [])
  const arms = useMemo(createArmsState, [])
  const [presentation, setPresentation] = useState<ArmsPresentation | null>(null)
  const [cameraOverride, setCameraOverride] = useState(false)
  const ready = useSurfaces()
  return <>
    <Stage overlay={cameraOverride ? null : presentation} onCreated={onCreated}>
      <WalkerBody walker={walker} view="eye" />
      <Rifle walker={walker} arms={arms} />
      <ArmsViewmodel state={arms} render="external" onPresentation={setPresentation} />
      <CheckProbe
        onCameraOverride={setCameraOverride}
        ready={() => surfacesReady() && presentation !== null}
        reset={walker.reset}
        player={() => ({ position: [walker.position.x, walker.position.y, walker.position.z], velocity: [walker.motor.velocity.x, walker.motor.velocity.y, walker.motor.velocity.z], grounded: walker.motor.grounded })} />
      {physicsProbe}
    </Stage>
    <div className="reticle" aria-hidden="true" />
    <PlayHud ready={ready} hints={[['WASD', 'Move'], ['Mouse', 'Look'], ['LMB', 'Fire'], ['RMB', 'Aim'], ['R', 'Reload'], ['1 / 2', 'Weapon'], ['Shift', 'Sprint'], ['Space', 'Jump']]} buttons={[{ id: 'fire', label: 'Fire' }, { id: 'aim', label: 'Aim' }, { id: 'jump', label: 'Jump' }, { id: 'reload', label: 'Reload' }, { id: 'sprint', label: 'Sprint' }]} />
  </>
}
