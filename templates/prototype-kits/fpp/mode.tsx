import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useFrame, useThree, type RootState } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import * as THREE from 'three'
import { ALS_WEAPONS, createWeaponRuntime, type QueryHit, type WeaponQueries } from '@blacksite/armory'
import { ArmsViewmodel, createArmsState, FIELD_SET, foundTimings, portraitFov, VIEWMODEL_WEAPONS, type ArmsPresentation, type ArmsState, type ArmsWeapon } from '@blacksite/subject-fpp/arms'
import { RECOIL_TUNING, createAimRecoil, createCameraFeel, type AimRecoil, type CameraFeel } from '@blacksite/subject-fpp/feel'
import { CheckProbe } from '../../game-shell/src/game/check'
import { PlayHud } from '../../game-shell/src/game/hud'
import { held, take, value } from '../../game-shell/src/game/input'
import { FEEL, FIXED_STEP } from '../../game-shell/src/game/model'
import { sound } from '../../game-shell/src/game/sound'
import { Stage, surfacesReady, useSurfaces } from '../../game-shell/src/game/stage'
import { WalkerBody, createWalker, type Walker } from '../../game-shell/src/game/walker'

const definitions = ALS_WEAPONS.map(weapon => weapon.id === 'rifle' || weapon.id === 'pistol'
  ? { ...weapon, ...foundTimings(FIELD_SET, weapon.id) }
  : weapon)

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

type Feel = { camera: CameraFeel; recoil: AimRecoil; aim: THREE.Vector3; look: { pitch: number; yaw: number } }

const base = new THREE.Euler(0, 0, 0, 'YXZ')
const turn = new THREE.Euler(0, 0, 0, 'YXZ')
const shift = new THREE.Vector3()

function FeelCamera({ walker, arms, feel }: { walker: Walker; arms: ArmsState; feel: Feel }) {
  const camera = useThree(state => state.camera) as THREE.PerspectiveCamera
  const size = useThree(state => state.size)
  const last = useRef({ yaw: walker.yaw, pitch: walker.pitch, grounded: true, fall: 0 })
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const previous = last.current
    const velocity = walker.motor.velocity
    const grounded = walker.motor.grounded
    if (grounded && !previous.grounded) { feel.camera.land(-previous.fall); arms.landSpeed = -previous.fall; arms.landSequence++ }
    if (!grounded && previous.grounded && velocity.y > 0) feel.camera.jump()
    feel.look.yaw -= walker.yaw - previous.yaw
    feel.look.pitch += walker.pitch - previous.pitch
    Object.assign(previous, { yaw: walker.yaw, pitch: walker.pitch, grounded, fall: velocity.y })
    const recoil = feel.recoil.step(dt)
    base.set(THREE.MathUtils.clamp(walker.pitch + recoil.pitch, -1.5, 1.5), -walker.yaw - Math.PI / 2 - recoil.yaw, 0)
    feel.aim.set(0, 0, -1).applyEuler(base)
    const right = { x: Math.cos(base.y), z: -Math.sin(base.y) }
    const lateral = velocity.x * right.x + velocity.z * right.z
    const forward = velocity.x * right.z - velocity.z * right.x
    const pose = feel.camera.step({ speed: Math.hypot(velocity.x, velocity.z), lateral, grounded, sprinting: arms.sprinting, aim: arms.debug.aimAmount }, FEEL.fov, VIEWMODEL_WEAPONS[arms.weapon].aimFov, dt, arms.kick)
    arms.motion = { forward, lateral, grounded, crouching: false, look: feel.look, walk: feel.camera.phase, bob: feel.camera.bob }
    camera.rotation.copy(turn.set(base.x + pose.pitch, base.y, pose.roll))
    camera.position.add(shift.set(pose.x, pose.y, pose.z).applyEuler(turn.set(0, base.y, 0)))
    camera.updateMatrixWorld()
    walker.lookScale = feel.camera.lookScale
    const fov = portraitFov(feel.camera.fov, size.width / size.height)
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix() }
  }, 0.05)
  return null
}

function Rifle({ walker, arms, feel }: { walker: Walker; arms: ArmsState; feel: Feel }) {
  const queries = useQueries(walker)
  const weapon = useMemo(() => createWeaponRuntime({ ownerId: 'local', seed: 1, definitions }), [])
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
    aim.origin.set(walker.position.x, walker.position.y + FEEL.eyeHeight, walker.position.z)
    aim.direction.copy(feel.aim)
    current.accumulated = Math.min(current.accumulated + delta, 0.1)
    while (current.accumulated >= FIXED_STEP) {
      current.accumulated -= FIXED_STEP
      const events = weapon.step({ tick: weapon.snapshot().nextTick, trigger: held('fire') && !arms.sprinting, reload: current.reload, selectWeaponId: current.selected, aim, muzzle: aim.origin }, queries)
      current.reload = false
      arms.empty = weapon.snapshot().weapons.find(entry => entry.id === arms.debug.weapon)?.magazine === 0
      for (const event of events) {
        if (event.type === 'shot') { arms.fireSequence++; feel.recoil.shot(event.recoil.pitch * (arms.aiming ? 0.72 : 1), event.recoil.yaw * (arms.aiming ? 0.72 : 1), RECOIL_TUNING[current.selected]); feel.camera.shot(arms.debug.aimAmount); sound.play(`weapon.${current.selected}`, { position: [aim.origin.x, aim.origin.y, aim.origin.z] }) }
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
  const feel = useMemo<Feel>(() => ({ camera: createCameraFeel(), recoil: createAimRecoil(), aim: new THREE.Vector3(0, 0, -1), look: { pitch: 0, yaw: 0 } }), [])
  const [presentation, setPresentation] = useState<ArmsPresentation | null>(null)
  const [cameraOverride, setCameraOverride] = useState(false)
  const ready = useSurfaces()
  return <>
    <Stage overlay={cameraOverride ? null : presentation} onCreated={onCreated}>
      <WalkerBody walker={walker} view="eye" />
      <FeelCamera walker={walker} arms={arms} feel={feel} />
      <Rifle walker={walker} arms={arms} feel={feel} />
      <ArmsViewmodel state={arms} render="external" onPresentation={setPresentation} />
      <CheckProbe
        onCameraOverride={setCameraOverride}
        ready={() => surfacesReady() && presentation !== null}
        reset={walker.reset}
        viewmodel={() => [...arms.debug.holder, ...arms.debug.clip, ...arms.debug.feel]}
        player={() => ({ position: [walker.position.x, walker.position.y, walker.position.z], velocity: [walker.motor.velocity.x, walker.motor.velocity.y, walker.motor.velocity.z], grounded: walker.motor.grounded })} />
      {physicsProbe}
    </Stage>
    <div className="reticle" aria-hidden="true" />
    <PlayHud ready={ready} hints={[['WASD', 'Move'], ['Mouse', 'Look'], ['LMB', 'Fire'], ['RMB', 'Aim'], ['R', 'Reload'], ['1 / 2', 'Weapon'], ['Shift', 'Sprint'], ['Space', 'Jump']]} buttons={[{ id: 'fire', label: 'Fire' }, { id: 'aim', label: 'Aim' }, { id: 'jump', label: 'Jump' }, { id: 'reload', label: 'Reload' }, { id: 'sprint', label: 'Sprint' }]} />
  </>
}
