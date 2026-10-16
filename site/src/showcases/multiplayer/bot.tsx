import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { keySubject, type MultiplayerReplica, type SubjectState } from '@blacksite/subject'
import { ROUTE } from './arena'

const wrap = (degrees: number) => ((degrees + 180) % 360 + 360) % 360 - 180
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ControlLeft', 'AltLeft'] as const

type Mood = 'run' | 'sprint' | 'walk' | 'crouch'

export function Bot({ subject, replica, active }: { subject: SubjectState; replica: MultiplayerReplica | null; active: boolean }) {
  const { world, rapier } = useRapier()
  const brain = useMemo(() => ({
    waypoint: -1, mood: 'run' as Mood, moodUntil: 0, seen: 0, lostAt: 0, stuck: 0, jumpAt: 0, jumpHeld: false,
    strafe: 1, strafeUntil: 0, burstUntil: 0, restUntil: 0, crouchUntil: 0, error: { yaw: 0, pitch: 0 }, errorAt: 0, nextHop: 6,
  }), [])

  useEffect(() => {
    if (!active) return
    subject.setVirtual(true)
    return () => {
      subject.input.fire = subject.input.aim = false
      subject.setVirtual(false)
    }
  }, [subject, active])

  useFrame((_, rawDelta) => {
    if (!active || !subject.frame.ready || !replica) return
    const dt = Math.min(rawDelta, 0.1)
    const now = performance.now() / 1000
    const command = subject.player.command
    const frame = subject.frame
    const keys = new Set<string>()
    const position = frame.position

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
    for (const state of replica.states.values()) {
      if (state.id === replica.id || state.health <= 0) continue
      const eye = frame.eye
      const dx = state.position.x - eye.x
      const dy = state.position.y + (state.locomotion?.stance === 'crouching' ? 0.8 : 1.25) - eye.y
      const dz = state.position.z - eye.z
      const range = Math.hypot(dx, dy, dz)
      if (range > 40 || range < 0.5) continue
      const ray = new rapier.Ray(eye, { x: dx / range, y: dy / range, z: dz / range })
      const hit = world.castRay(ray, range, true, undefined, undefined, undefined, undefined, collider => !frame.ownerColliderHandles.has(collider.handle) && collider.parent()?.isFixed() === true)
      if (hit && hit.timeOfImpact < range - 0.6) continue
      target = { x: dx, y: dy, z: dz }
    }

    const moveX = wx - position.x
    const moveZ = wz - position.z
    let yaw = Math.atan2(moveZ, moveX) * 180 / Math.PI
    let pitch = 0
    let engaged = false
    if (target) {
      if (!brain.seen) brain.seen = now
      brain.lostAt = now
      if (now > brain.errorAt) {
        brain.error = { yaw: (Math.random() - 0.5) * 5, pitch: (Math.random() - 0.5) * 3 }
        brain.errorAt = now + 0.45
      }
      yaw = Math.atan2(target.z, target.x) * 180 / Math.PI + brain.error.yaw
      pitch = Math.atan2(target.y, Math.hypot(target.x, target.z)) * 180 / Math.PI + brain.error.pitch
      engaged = now - brain.seen > 0.35
    } else if (now - brain.lostAt > 1.2) brain.seen = 0

    const turn = (engaged ? 260 : 200) * dt
    command.yaw = wrap(command.yaw + Math.max(-turn, Math.min(turn, wrap(yaw - command.yaw))))
    command.pitch += (pitch - command.pitch) * (1 - Math.exp(-8 * dt))

    const facing = command.yaw * Math.PI / 180
    const length = Math.hypot(moveX, moveZ) || 1
    let forward = (moveX * Math.cos(facing) + moveZ * Math.sin(facing)) / length
    let right = (-moveX * Math.sin(facing) + moveZ * Math.cos(facing)) / length
    if (engaged) {
      if (now > brain.strafeUntil) { brain.strafe = Math.random() < 0.5 ? -1 : 1; brain.strafeUntil = now + 0.8 + Math.random() * 1.4 }
      right = right * 0.4 + brain.strafe * 0.8
      forward *= 0.5
      if (now > brain.crouchUntil + 2 && Math.random() < dt * 0.4) brain.crouchUntil = now + 1 + Math.random()
      if (now < brain.crouchUntil) keys.add('ControlLeft')
      subject.input.aim = true
      const aimError = Math.abs(wrap(yaw - command.yaw))
      if (now > brain.restUntil && aimError < 4) {
        brain.burstUntil = now + 0.35 + Math.random() * 0.4
        brain.restUntil = brain.burstUntil + 0.5 + Math.random() * 0.8
      }
      subject.input.fire = now < brain.burstUntil && aimError < 6
    } else {
      subject.input.aim = false
      subject.input.fire = false
      if (brain.mood === 'crouch') keys.add('ControlLeft')
      if (brain.mood === 'walk') keys.add('AltLeft')
      if (brain.mood === 'sprint' && forward > 0.8) keys.add('ShiftLeft')
    }
    if (forward > 0.35) keys.add('KeyW')
    if (forward < -0.35) keys.add('KeyS')
    if (right > 0.35) keys.add('KeyD')
    if (right < -0.35) keys.add('KeyA')

    const speed = Math.hypot(frame.velocity.x, frame.velocity.z)
    brain.stuck = keys.size && speed < 0.6 && frame.grounded ? brain.stuck + dt : 0
    const hop = brain.stuck > 0.35 || !engaged && brain.mood !== 'crouch' && now > brain.jumpAt + brain.nextHop
    if (brain.jumpHeld) { keySubject(subject, 'Space', false); brain.jumpHeld = false }
    else if (hop && frame.grounded && now > brain.jumpAt + 0.8) {
      keySubject(subject, 'Space', true)
      brain.jumpHeld = true
      brain.jumpAt = now
      brain.stuck = 0
      brain.nextHop = 5 + Math.random() * 6
      keys.delete('ControlLeft')
    }

    for (const code of MOVE_KEYS) {
      const want = keys.has(code)
      if (want !== subject.keys.has(code)) keySubject(subject, code, want)
    }
  }, ALS_FRAME_PRIORITY.ControlRotation - 0.2)

  return null
}
