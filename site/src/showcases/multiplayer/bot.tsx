import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import type { CharacterDriver, CharacterHandle, Replica } from '@blacksite/subject'
import { ROUTE } from './arena'

const wrap = (radians: number) => Math.atan2(Math.sin(radians), Math.cos(radians))
const yawOf = (heading: number) => -heading - Math.PI / 2
const DEG = Math.PI / 180

type Mood = 'run' | 'sprint' | 'walk' | 'crouch'

export function Bot({ fighter, replica, active }: { fighter: CharacterHandle; replica: Replica | null; active: boolean }) {
  const { world, rapier } = useRapier()
  const brain = useMemo(() => ({
    waypoint: -1, mood: 'run' as Mood, moodUntil: 0, seen: 0, lostAt: 0, stuck: 0, jumpAt: 0,
    strafe: 1, strafeUntil: 0, burstUntil: 0, restUntil: 0, crouchUntil: 0, error: { yaw: 0, pitch: 0 }, errorAt: 0, nextHop: 6,
  }), [])
  const command = useMemo<CharacterDriver>(() => ({ forward: 0, right: 0, sprint: false, jump: false, fire: false, aim: false, crouch: false, walk: false }), [])

  useEffect(() => {
    if (!active) return
    fighter.drive(command)
    return () => {
      Object.assign(command, { forward: 0, right: 0, sprint: false, jump: false, fire: false, aim: false, crouch: false, walk: false })
      fighter.drive(null)
    }
  }, [fighter, command, active])

  useFrame((_, rawDelta) => {
    if (!active || !fighter.als.pose.current.ready || !replica) return
    const dt = Math.min(rawDelta, 0.1)
    const now = performance.now() / 1000
    const control = fighter.control
    const position = fighter.position
    const own = fighter.als.pose.current.ownerRigidBody

    if (brain.waypoint < 0) {
      let best = 0
      for (let index = 1; index < ROUTE.length; index++) if (Math.hypot(ROUTE[index]![0] - position.x, ROUTE[index]![1] - position.z) < Math.hypot(ROUTE[best]![0] - position.x, ROUTE[best]![1] - position.z)) best = index
      brain.waypoint = best
    }
    let [wx, wz] = ROUTE[brain.waypoint]!
    if (Math.hypot(wx - position.x, wz - position.z) < 1.4) {
      brain.waypoint = (brain.waypoint + 1) % ROUTE.length
      ;[wx, wz] = ROUTE[brain.waypoint]!
    }
    if (now > brain.moodUntil) {
      const roll = Math.random()
      brain.mood = roll < 0.4 ? 'run' : roll < 0.65 ? 'sprint' : roll < 0.85 ? 'walk' : 'crouch'
      brain.moodUntil = now + 2.5 + Math.random() * 3
    }

    let target: { x: number; y: number; z: number } | null = null
    const eye = fighter.eye
    for (const state of replica.states.values()) {
      if (state.id === replica.id || state.health <= 0) continue
      const dx = state.position.x - eye.x
      const dy = state.position.y + (state.locomotion?.stance === 'crouching' ? 0.8 : 1.25) - eye.y
      const dz = state.position.z - eye.z
      const range = Math.hypot(dx, dy, dz)
      if (range > 40 || range < 0.5) continue
      const ray = new rapier.Ray(eye, { x: dx / range, y: dy / range, z: dz / range })
      const hit = world.castRay(ray, range, true, undefined, undefined, undefined, undefined, collider => collider.parent()?.handle !== own?.handle && collider.parent()?.isFixed() === true)
      if (hit && hit.timeOfImpact < range - 0.6) continue
      target = { x: dx, y: dy, z: dz }
    }

    const moveX = wx - position.x
    const moveZ = wz - position.z
    let yaw = yawOf(Math.atan2(moveZ, moveX))
    let pitch = 0
    let engaged = false
    if (target) {
      if (!brain.seen) brain.seen = now
      brain.lostAt = now
      if (now > brain.errorAt) {
        brain.error = { yaw: (Math.random() - 0.5) * 5 * DEG, pitch: (Math.random() - 0.5) * 3 * DEG }
        brain.errorAt = now + 0.45
      }
      yaw = yawOf(Math.atan2(target.z, target.x)) + brain.error.yaw
      pitch = Math.atan2(target.y, Math.hypot(target.x, target.z)) + brain.error.pitch
      engaged = now - brain.seen > 0.35
    } else if (now - brain.lostAt > 1.2) brain.seen = 0

    const turn = (engaged ? 260 : 200) * DEG * dt
    control.yaw = wrap(control.yaw + Math.max(-turn, Math.min(turn, wrap(yaw - control.yaw))))
    control.pitch += (pitch - control.pitch) * (1 - Math.exp(-8 * dt))

    const length = Math.hypot(moveX, moveZ) || 1
    const sin = Math.sin(control.yaw), cos = Math.cos(control.yaw)
    let forward = (-sin * moveX - cos * moveZ) / length
    let right = (cos * moveX - sin * moveZ) / length
    let crouch = false
    if (engaged) {
      if (now > brain.strafeUntil) { brain.strafe = Math.random() < 0.5 ? -1 : 1; brain.strafeUntil = now + 0.8 + Math.random() * 1.4 }
      right = right * 0.4 + brain.strafe * 0.8
      forward *= 0.5
      if (now > brain.crouchUntil + 2 && Math.random() < dt * 0.4) brain.crouchUntil = now + 1 + Math.random()
      crouch = now < brain.crouchUntil
      command.aim = true
      const aimError = Math.abs(wrap(yaw - control.yaw))
      if (now > brain.restUntil && aimError < 4 * DEG) {
        brain.burstUntil = now + 0.35 + Math.random() * 0.4
        brain.restUntil = brain.burstUntil + 0.5 + Math.random() * 0.8
      }
      command.fire = now < brain.burstUntil && aimError < 6 * DEG
      command.sprint = command.walk = false
    } else {
      command.aim = command.fire = false
      crouch = brain.mood === 'crouch'
      command.walk = brain.mood === 'walk'
      command.sprint = brain.mood === 'sprint' && forward > 0.8
    }
    const step = (value: number) => value > 0.35 ? 1 : value < -0.35 ? -1 : 0
    command.forward = step(forward)
    command.right = step(right)

    const moving = command.forward !== 0 || command.right !== 0
    brain.stuck = moving && fighter.speed < 0.6 && fighter.grounded ? brain.stuck + dt : 0
    const hop = brain.stuck > 0.35 || !engaged && brain.mood !== 'crouch' && now > brain.jumpAt + brain.nextHop
    if (hop && fighter.grounded && now > brain.jumpAt + 0.8) {
      command.jump = true
      brain.jumpAt = now
      brain.stuck = 0
      brain.nextHop = 5 + Math.random() * 6
      crouch = false
    }
    command.crouch = crouch
  }, ALS_FRAME_PRIORITY.ControlRotation - 0.3)

  return null
}
