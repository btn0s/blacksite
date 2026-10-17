import type { Collision, V3 } from './collision'

export type FirstPersonMove = {
  eye: number
  crouchEye: number
  eyeSmoothing: number
  radius: number
  height: number
  crouchHeight: number
  step: number
  walk: number
  run: number
  sprint: number
  crouch: number
  aim: number
  accelerate: readonly [number, number]
  brake: readonly [number, number, number]
  airControl: number
  jumpSpeed: number
  gravity: number
  coyoteSeconds: number
  bufferSeconds: number
  crouchSeconds: number
  sprintOutSeconds: number
  feet: { walk: number; run: number; sprint: number; crouch: number }
}

export const FPP_MOVE: FirstPersonMove = {
  eye: 1.63,
  crouchEye: 1.0,
  eyeSmoothing: 20,
  radius: 0.3,
  height: 1.8,
  crouchHeight: 1.12,
  step: 0.45,
  walk: 1.75,
  run: 3.75,
  sprint: 6.5,
  crouch: 2.0,
  aim: 1.65,
  accelerate: [20, 7.5],
  brake: [15, 12.5, 5],
  airControl: 0.25,
  jumpSpeed: 4.2,
  gravity: 9.8,
  coyoteSeconds: 0.1,
  bufferSeconds: 0.1,
  crouchSeconds: 0.2,
  sprintOutSeconds: 0.22,
  feet: { walk: 0.4, run: 0.3, sprint: 0.26, crouch: 0.5 },
}

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

export const jumpApex = (move: FirstPersonMove) => move.jumpSpeed * move.jumpSpeed / (2 * move.gravity)

export function acceleration(move: FirstPersonMove, speed: number) {
  const k = Math.min(1, Math.max(0, speed / move.sprint))
  return move.accelerate[0] + (move.accelerate[1] - move.accelerate[0]) * k
}

export function braking(move: FirstPersonMove, speed: number) {
  if (speed <= move.run) return move.brake[0] + (move.brake[1] - move.brake[0]) * speed / move.run
  return move.brake[1] + (move.brake[2] - move.brake[1]) * Math.min(1, (speed - move.run) / (move.sprint - move.run))
}

export function timeToTopSpeed(move: FirstPersonMove, speed = move.run, fraction = 0.9) {
  let velocity = 0
  let time = 0
  const dt = 1 / 240
  while (velocity < speed * fraction && time < 2) {
    velocity = Math.min(speed, velocity + acceleration(move, velocity) * dt)
    time += dt
  }
  return time
}

export function moveSpeed(move: FirstPersonMove, state: { sprinting: boolean; crouched: boolean; aiming: boolean; walking: boolean }) {
  const base = state.sprinting ? move.sprint : state.crouched ? move.crouch : state.walking ? move.walk : move.run
  return state.aiming && !state.sprinting ? Math.min(base, move.aim) : base
}

export function footInterval(move: FirstPersonMove, state: { sprinting: boolean; crouched: boolean; walking: boolean }) {
  return state.sprinting ? move.feet.sprint : state.crouched ? move.feet.crouch : state.walking ? move.feet.walk : move.feet.run
}

export function createBody(position: readonly [number, number, number], move: FirstPersonMove = FPP_MOVE): Body {
  return { position: { x: position[0], y: position[1], z: position[2] }, velocity: { x: 0, y: 0, z: 0 }, grounded: true, crouch: 0, eye: move.eye, coyote: 0, buffer: 0, stride: 0, airborne: 0, jumpHeld: false }
}

export function placeBody(body: Body, position: readonly [number, number, number], move: FirstPersonMove = FPP_MOVE) {
  body.position.x = position[0]
  body.position.y = position[1]
  body.position.z = position[2]
  body.velocity.x = body.velocity.y = body.velocity.z = 0
  body.grounded = true
  body.crouch = 0
  body.eye = move.eye
  body.stride = 0
  body.coyote = 0
  body.buffer = 0
  body.airborne = 0
  body.jumpHeld = false
}

const events: BodyEvents = { step: false, landed: 0, jumped: false, sprinting: false, speed: 0 }

export function stepBody(body: Body, drive: Drive, dt: number, collision: Collision, move: FirstPersonMove = FPP_MOVE): BodyEvents {
  events.step = false
  events.landed = 0
  events.jumped = false
  const ceiling = collision.ceiling(body.position.x, body.position.z, move.radius, body.position.y)
  const crouching = drive.crouch || (body.crouch > 0.1 && ceiling - body.position.y < move.height - 0.01)
  body.crouch += ((crouching ? 1 : 0) - body.crouch) * Math.min(1, dt / move.crouchSeconds * 3)
  const sprinting = drive.sprint && drive.forward > 0.3 && !drive.aiming && !drive.firing && !crouching
  const speed = moveSpeed(move, { sprinting, crouched: crouching, aiming: drive.aiming, walking: drive.walk })
  const fx = -Math.sin(drive.yaw), fz = -Math.cos(drive.yaw)
  const rx = Math.cos(drive.yaw), rz = -Math.sin(drive.yaw)
  let wx = fx * drive.forward + rx * drive.right
  let wz = fz * drive.forward + rz * drive.right
  const length = Math.hypot(wx, wz)
  if (length > 1) { wx /= length; wz /= length }
  const tx = wx * speed, tz = wz * speed
  const current = Math.hypot(body.velocity.x, body.velocity.z)
  const goal = Math.hypot(tx, tz)
  let rate = goal >= current - 1e-4 && goal > 0 ? acceleration(move, current) : braking(move, current)
  if (!body.grounded) rate *= move.airControl
  const dx = tx - body.velocity.x, dz = tz - body.velocity.z
  const gap = Math.hypot(dx, dz)
  const change = Math.min(gap, rate * dt)
  if (gap > 1e-6) {
    body.velocity.x += dx / gap * change
    body.velocity.z += dz / gap * change
  }
  body.coyote = body.grounded ? move.coyoteSeconds : Math.max(0, body.coyote - dt)
  body.buffer = drive.jump && !body.jumpHeld ? move.bufferSeconds : Math.max(0, body.buffer - dt)
  body.jumpHeld = drive.jump
  if (body.buffer > 0 && body.coyote > 0 && body.velocity.y <= 0.01) {
    body.velocity.y = move.jumpSpeed
    body.grounded = false
    body.coyote = 0
    body.buffer = 0
    events.jumped = true
  }
  const feetBefore = body.position.y
  body.position.x += body.velocity.x * dt
  body.position.z += body.velocity.z * dt
  const head = body.position.y + (move.height - (move.height - move.crouchHeight) * body.crouch)
  collision.slide(body.position, move.radius, body.position.y, head, body.grounded ? move.step : 0.05)
  if (!body.grounded) {
    body.position.y += body.velocity.y * dt - 0.5 * move.gravity * dt * dt
    body.velocity.y -= move.gravity * dt
    const height = move.height - (move.height - move.crouchHeight) * body.crouch
    const overhead = collision.ceiling(body.position.x, body.position.z, move.radius, feetBefore)
    if (body.velocity.y > 0 && body.position.y + height > overhead) {
      body.position.y = Math.max(feetBefore, overhead - height)
      body.velocity.y = 0
    }
  }
  const ground = collision.support(body.position.x, body.position.z, move.radius, Math.max(body.position.y, feetBefore), body.grounded ? move.step : 0.05)
  if (body.position.y <= ground + 1e-3 && body.velocity.y <= 0) {
    if (!body.grounded) events.landed = -body.velocity.y
    body.position.y = ground
    body.velocity.y = 0
    body.grounded = true
    body.airborne = 0
  } else if (body.position.y > ground + 1e-3) {
    if (body.grounded && body.position.y - ground > move.step + 0.02) body.grounded = false
    else if (body.grounded) body.position.y = ground
    if (!body.grounded) body.airborne += dt
  }
  const eye = move.eye + (move.crouchEye - move.eye) * body.crouch
  body.eye += (eye - body.eye) * (1 - Math.exp(-move.eyeSmoothing * dt))
  const moving = Math.hypot(body.velocity.x, body.velocity.z)
  if (body.grounded && moving > 0.6) {
    body.stride += dt
    const interval = footInterval(move, { sprinting, crouched: crouching, walking: drive.walk || moving < 2.2 })
    if (body.stride >= interval) { body.stride -= interval; events.step = true }
  } else body.stride = Math.min(body.stride, 0.2)
  events.sprinting = sprinting && moving > move.run * 0.8
  events.speed = moving
  return events
}

export function eyePosition(body: Body, out: V3) {
  out.x = body.position.x
  out.y = body.position.y + body.eye
  out.z = body.position.z
  return out
}
