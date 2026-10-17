import { ceilingHeight, slide, supportHeight, type V3 } from './geometry'
import { MOVE, acceleration, braking, footInterval, moveSpeed } from './model'

export type Body = {
  position: V3
  velocity: V3
  grounded: boolean
  crouch: number
  eye: number
  coyote: number
  buffer: number
  stride: number
  airborne: number
  jumpHeld: boolean
}

export type Drive = { forward: number; right: number; yaw: number; sprint: boolean; crouch: boolean; jump: boolean; aiming: boolean; firing: boolean; walk: boolean }
export type BodyEvents = { step: boolean; landed: number; jumped: boolean; sprinting: boolean; speed: number }

export function createBody(position: readonly [number, number, number]): Body {
  return { position: { x: position[0], y: position[1], z: position[2] }, velocity: { x: 0, y: 0, z: 0 }, grounded: true, crouch: 0, eye: MOVE.eye, coyote: 0, buffer: 0, stride: 0, airborne: 0, jumpHeld: false }
}

export function placeBody(body: Body, position: readonly [number, number, number]) {
  body.position.x = position[0]
  body.position.y = position[1]
  body.position.z = position[2]
  body.velocity.x = body.velocity.y = body.velocity.z = 0
  body.grounded = true
  body.crouch = 0
  body.eye = MOVE.eye
  body.stride = 0
  body.coyote = 0
  body.buffer = 0
  body.airborne = 0
  body.jumpHeld = false
}

const events: BodyEvents = { step: false, landed: 0, jumped: false, sprinting: false, speed: 0 }

export function stepBody(body: Body, drive: Drive, dt: number): BodyEvents {
  events.step = false
  events.landed = 0
  events.jumped = false
  const ceiling = ceilingHeight(body.position.x, body.position.z, MOVE.radius, body.position.y)
  const crouching = drive.crouch || (body.crouch > 0.1 && ceiling - body.position.y < MOVE.height - 0.01)
  body.crouch += ((crouching ? 1 : 0) - body.crouch) * Math.min(1, dt / MOVE.crouchSeconds * 3)
  const sprinting = drive.sprint && drive.forward > 0.3 && !drive.aiming && !drive.firing && !crouching
  const speed = moveSpeed({ sprinting, crouched: crouching, aiming: drive.aiming, walking: drive.walk })
  const fx = -Math.sin(drive.yaw), fz = -Math.cos(drive.yaw)
  const rx = Math.cos(drive.yaw), rz = -Math.sin(drive.yaw)
  let wx = fx * drive.forward + rx * drive.right
  let wz = fz * drive.forward + rz * drive.right
  const length = Math.hypot(wx, wz)
  if (length > 1) { wx /= length; wz /= length }
  const tx = wx * speed, tz = wz * speed
  const current = Math.hypot(body.velocity.x, body.velocity.z)
  const goal = Math.hypot(tx, tz)
  let rate = goal >= current - 1e-4 && goal > 0 ? acceleration(current) : braking(current)
  if (!body.grounded) rate *= MOVE.airControl
  const dx = tx - body.velocity.x, dz = tz - body.velocity.z
  const gap = Math.hypot(dx, dz)
  const change = Math.min(gap, rate * dt)
  if (gap > 1e-6) {
    body.velocity.x += dx / gap * change
    body.velocity.z += dz / gap * change
  }
  body.coyote = body.grounded ? MOVE.coyoteSeconds : Math.max(0, body.coyote - dt)
  body.buffer = drive.jump && !body.jumpHeld ? MOVE.bufferSeconds : Math.max(0, body.buffer - dt)
  body.jumpHeld = drive.jump
  if (body.buffer > 0 && body.coyote > 0 && body.velocity.y <= 0.01) {
    body.velocity.y = MOVE.jumpSpeed
    body.grounded = false
    body.coyote = 0
    body.buffer = 0
    events.jumped = true
  }
  const feetBefore = body.position.y
  body.position.x += body.velocity.x * dt
  body.position.z += body.velocity.z * dt
  const head = body.position.y + (MOVE.height - (MOVE.height - MOVE.crouchHeight) * body.crouch)
  slide(body.position, MOVE.radius, body.position.y, head, body.grounded ? MOVE.step : 0.05)
  if (!body.grounded) {
    body.position.y += body.velocity.y * dt - 0.5 * MOVE.gravity * dt * dt
    body.velocity.y -= MOVE.gravity * dt
    const height = MOVE.height - (MOVE.height - MOVE.crouchHeight) * body.crouch
    const overhead = ceilingHeight(body.position.x, body.position.z, MOVE.radius, feetBefore)
    if (body.velocity.y > 0 && body.position.y + height > overhead) {
      body.position.y = Math.max(feetBefore, overhead - height)
      body.velocity.y = 0
    }
  }
  const ground = supportHeight(body.position.x, body.position.z, MOVE.radius, Math.max(body.position.y, feetBefore), body.grounded ? MOVE.step : 0.05)
  if (body.position.y <= ground + 1e-3 && body.velocity.y <= 0) {
    if (!body.grounded) {
      events.landed = -body.velocity.y
    }
    body.position.y = ground
    body.velocity.y = 0
    body.grounded = true
    body.airborne = 0
  } else if (body.position.y > ground + 1e-3) {
    if (body.grounded && body.position.y - ground > MOVE.step + 0.02) body.grounded = false
    else if (body.grounded) body.position.y = ground
    if (!body.grounded) body.airborne += dt
  }
  const eye = MOVE.eye + (MOVE.crouchEye - MOVE.eye) * body.crouch
  body.eye += (eye - body.eye) * (1 - Math.exp(-MOVE.eyeSmoothing * dt))
  const moving = Math.hypot(body.velocity.x, body.velocity.z)
  if (body.grounded && moving > 0.6) {
    body.stride += dt
    const interval = footInterval({ sprinting, crouched: crouching, walking: drive.walk || moving < 2.2 })
    if (body.stride >= interval) { body.stride -= interval; events.step = true }
  } else body.stride = Math.min(body.stride, 0.2)
  events.sprinting = sprinting && moving > MOVE.run * 0.8
  events.speed = moving
  return events
}

export function eyePosition(body: Body, out: V3) {
  out.x = body.position.x
  out.y = body.position.y + body.eye
  out.z = body.position.z
  return out
}
