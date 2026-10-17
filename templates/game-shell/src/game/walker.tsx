import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useRapier, type RapierCollider } from '@react-three/rapier'
import * as THREE from 'three'
import { FEEL, createMotor, stepMotor, type Motor } from './model'
import { held, take, value } from './input'
import { sound } from './sound'
import { surfaceAt, yard } from './yard'

export type Walker = {
  position: THREE.Vector3
  motor: Motor
  yaw: number
  pitch: number
  stride: number
  lookScale: number
  collider: RapierCollider | null
  reset(): void
}

export function createWalker(): Walker {
  const walker: Walker = {
    position: new THREE.Vector3(...yard.spawn),
    motor: createMotor(),
    yaw: 0,
    pitch: 0,
    stride: 0,
    lookScale: 1,
    collider: null,
    reset() {
      walker.position.set(...yard.spawn)
      walker.motor = createMotor()
      walker.yaw = 0
      walker.pitch = 0
      walker.stride = 0
    },
  }
  return walker
}

const half = FEEL.capsuleHeight / 2 - FEEL.capsuleRadius
const forward = new THREE.Vector3()

export function WalkerBody({ walker, view = 'eye' }: { walker: Walker; view?: 'eye' | 'follow' }) {
  const { world, rapier } = useRapier()
  const camera = useThree(state => state.camera)
  const parts = useMemo(() => {
    const collider = world.createCollider(rapier.ColliderDesc.capsule(half, FEEL.capsuleRadius).setTranslation(walker.position.x, walker.position.y + FEEL.capsuleHeight / 2, walker.position.z))
    const controller = world.createCharacterController(0.02)
    controller.enableAutostep(FEEL.stepHeight, 0.2, false)
    controller.enableSnapToGround(0.3)
    controller.setMaxSlopeClimbAngle(FEEL.maxSlope * Math.PI / 180)
    controller.setApplyImpulsesToDynamicBodies(true)
    walker.collider = collider
    return { collider, controller }
  }, [world, rapier, walker])
  useEffect(() => () => { walker.collider = null; world.removeCharacterController(parts.controller); world.removeCollider(parts.collider, false) }, [world, parts, walker])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const { collider, controller } = parts
    let center = collider.translation()
    if (Math.abs(center.x - walker.position.x) + Math.abs(center.z - walker.position.z) + Math.abs(center.y - FEEL.capsuleHeight / 2 - walker.position.y) > 0.01) {
      collider.setTranslation({ x: walker.position.x, y: walker.position.y + FEEL.capsuleHeight / 2, z: walker.position.z })
      center = collider.translation()
    }
    const look = value('look')
    walker.yaw += look.x * walker.lookScale
    walker.pitch = THREE.MathUtils.clamp(walker.pitch - look.y * walker.lookScale, -FEEL.pitchLimit, FEEL.pitchLimit)
    const move = value('move')
    const wasGrounded = walker.motor.grounded
    const falling = walker.motor.velocity.y
    const jumped = stepMotor(walker.motor, { forward: move.y, right: move.x, yaw: walker.yaw, sprint: held('sprint'), walk: held('walk'), jump: take('jump') }, wasGrounded, dt)
    const velocity = walker.motor.velocity
    controller.computeColliderMovement(collider, { x: velocity.x * dt, y: velocity.y * dt, z: velocity.z * dt })
    const moved = controller.computedMovement()
    const next = { x: center.x + moved.x, y: center.y + moved.y, z: center.z + moved.z }
    collider.setTranslation(next)
    const grounded = controller.computedGrounded() && velocity.y <= 0
    if (grounded && velocity.y < 0) velocity.y = 0
    if (velocity.y > 0 && moved.y < velocity.y * dt - 0.001) velocity.y = 0
    walker.motor.grounded = grounded
    walker.position.set(next.x, next.y - FEEL.capsuleHeight / 2, next.z)
    const feet: [number, number, number] = [walker.position.x, walker.position.y, walker.position.z]
    const surface = surfaceAt(feet[0], feet[1], feet[2])
    if (jumped) sound.play(`footstep.${surface}`, { position: feet })
    if (grounded && !wasGrounded && falling < -3) sound.play(`landing.${surface}`, { position: feet, volume: Math.min(1.5, 0.6 - falling * 0.12) })
    if (grounded) {
      walker.stride += Math.hypot(moved.x, moved.z)
      if (walker.stride > FEEL.stride * (velocity.x * velocity.x + velocity.z * velocity.z > 20 ? 1.35 : 1)) {
        walker.stride = 0
        sound.play(`footstep.${surface}`, { position: feet })
      }
    }

    camera.rotation.set(walker.pitch, -walker.yaw - Math.PI / 2, 0, 'YXZ')
    if (view === 'eye') camera.position.set(walker.position.x, walker.position.y + FEEL.eyeHeight, walker.position.z)
    else {
      camera.getWorldDirection(forward)
      camera.position.set(walker.position.x, walker.position.y + 1.7, walker.position.z).addScaledVector(forward, -4.2)
    }
    camera.updateMatrixWorld()
    camera.getWorldDirection(forward)
    sound.setListener({ position: [camera.position.x, camera.position.y, camera.position.z], forward: [forward.x, forward.y, forward.z] })
    sound.update(dt)
  })
  return null
}
