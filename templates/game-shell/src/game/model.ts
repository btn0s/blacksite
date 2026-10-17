export const FEEL = {
  walkSpeed: 1.75,
  moveSpeed: 3.75,
  sprintSpeed: 6.5,
  timeToTopSpeed: 0.25,
  airControl: 0.3,
  jumpApex: 0.9,
  gravity: 9.8,
  coyoteTime: 0.1,
  jumpBuffer: 0.1,
  capsuleRadius: 0.35,
  capsuleHeight: 1.8,
  stepHeight: 0.35,
  maxSlope: 45,
  eyeHeight: 1.63,
  fov: 75,
  viewmodelFov: 56,
  mouseLook: 0.0022,
  touchLook: 0.0042,
  stickLook: 3.2,
  pitchLimit: 1.48,
  stride: 0.75,
  tolerance: 0.1,
} as const

export const CHARACTER_FEEL = {
  moveSpeed: FEEL.moveSpeed,
  sprintSpeed: FEEL.sprintSpeed,
  jumpApex: FEEL.jumpApex,
  tolerance: FEEL.tolerance,
} as const

export const GAIT_SPEEDS = {
  Standing: {
    walkForwardSpeed: FEEL.walkSpeed,
    walkBackwardSpeed: FEEL.walkSpeed,
    runForwardSpeed: FEEL.moveSpeed,
    runBackwardSpeed: FEEL.moveSpeed,
    sprintSpeed: FEEL.sprintSpeed,
  },
} as const

export const BUDGET = {
  frameMs: 8.3,
  phoneFrameMs: 16.7,
  hitchMs: 33,
  firstPlayableMs: 5000,
  voices: 32,
  phoneVoices: 16,
} as const

export const FIXED_STEP = 1 / 60

export type MotorIntent = { forward: number; right: number; yaw: number; sprint: boolean; walk: boolean; jump: boolean }

export type Motor = { velocity: { x: number; y: number; z: number }; coyote: number; buffer: number; grounded: boolean }

export const createMotor = (): Motor => ({ velocity: { x: 0, y: 0, z: 0 }, coyote: 0, buffer: 0, grounded: true })

export function topSpeed(intent: MotorIntent) {
  return intent.sprint && intent.forward > 0 ? FEEL.sprintSpeed : intent.walk ? FEEL.walkSpeed : FEEL.moveSpeed
}

export function stepMotor(motor: Motor, intent: MotorIntent, grounded: boolean, dt: number) {
  const length = Math.hypot(intent.forward, intent.right)
  const scale = length > 1 ? 1 / length : 1
  const forward = intent.forward * scale
  const right = intent.right * scale
  const cos = Math.cos(intent.yaw)
  const sin = Math.sin(intent.yaw)
  const speed = topSpeed(intent)
  const targetX = (forward * cos - right * sin) * speed
  const targetZ = (forward * sin + right * cos) * speed
  const rate = Math.log(10) / FEEL.timeToTopSpeed * (grounded ? 1 : FEEL.airControl)
  const blend = 1 - Math.exp(-rate * dt)
  const velocity = motor.velocity
  velocity.x += (targetX - velocity.x) * blend
  velocity.z += (targetZ - velocity.z) * blend
  motor.coyote = grounded ? FEEL.coyoteTime : Math.max(0, motor.coyote - dt)
  motor.buffer = intent.jump ? FEEL.jumpBuffer : Math.max(0, motor.buffer - dt)
  const jumped = motor.buffer > 0 && motor.coyote > 0
  if (jumped) {
    velocity.y = Math.sqrt(2 * FEEL.gravity * FEEL.jumpApex)
    motor.buffer = motor.coyote = 0
  } else if (grounded && velocity.y <= 0) velocity.y = -1
  else velocity.y -= FEEL.gravity * dt
  motor.grounded = grounded && !jumped
  return jumped
}
