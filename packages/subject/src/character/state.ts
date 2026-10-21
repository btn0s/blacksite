import { Vector3 } from 'three'
import { createWeaponRuntime, type WeaponDefinition, type WeaponQueries, type WeaponRuntime } from '@blacksite/armory'
import { aimAssistDefaults, makeInputDevices, type AimAssistSettings, type Binding, type InputRuntime } from '@blacksite/input'
import { createAlsPlayer, type AlsPlayerCommand } from 'als-ue5-r3f/app/AlsPlayer'
import type { CharacterProps } from 'als-ue5-r3f/app/Character'
import { createArmsState, type ArmsWeapon } from '../arms/state'
import { createCameraFeel } from '../feel/camera'
import type { ImpulsePoint } from '../feel/impulse'
import { createAimRecoil } from '../feel/recoil'
import { PAD_LOOK, type PadLook } from '../input'
import { CHARACTER_FLY, createFlight, type CharacterFly } from './fly'

type AlsOverlayMode = AlsPlayerCommand['overlay']
type AlsGaitSpeedOverrides = NonNullable<CharacterProps['gaitSpeedOverrides']>
type Point = { readonly x: number; readonly y: number; readonly z: number }
type Vec3 = readonly [number, number, number]

export type CharacterView = 'arms' | 'head' | 'shoulder'
export type CharacterRumble = { readonly ms: number; readonly strong: number; readonly weak: number; readonly trigger: number }
export type CharacterWeapon = { readonly definition: WeaponDefinition; readonly adsFov: number; readonly adsSeconds: number; readonly overlay: AlsOverlayMode; readonly rumble?: CharacterRumble }
export type CharacterDriver = { forward: number; right: number; sprint: boolean; jump: boolean; fire: boolean; aim: boolean; crouch?: boolean; walk?: boolean }
export type CharacterTouch = { forward: number; right: number; lookX: number; lookY: number; fire: boolean; rise: boolean }
export type CharacterStatus = { readonly locked: boolean; readonly paused: boolean; readonly view: CharacterView; readonly touchAim: boolean; readonly touchCrouch: boolean; readonly flying: boolean }
export type CharacterLook = { readonly mouse: number; readonly touch: number; readonly touchScale: number; readonly pitchMin: number; readonly pitchMax: number }
export type CharacterEye = { readonly stand: number; readonly crouch: number; readonly smoothing: number }
export type CharacterJump = { readonly bufferSeconds: number; readonly coyoteSeconds: number }
export type CharacterStart = { readonly position: Vec3; readonly yaw: number; readonly pitch?: number }
export type CharacterWorld = WeaponQueries & { bounds(): { min: Vec3; max: Vec3 } | null; groundAt(x: number, z: number): number | null }
export type CharacterCheckMove = { forward?: number; right?: number; sprint?: boolean; jump?: boolean }

export type CharacterConfig = {
  readonly views: readonly [CharacterView, ...CharacterView[]]
  readonly start: CharacterStart
  readonly weapons?: ReadonlyArray<CharacterWeapon>
  readonly gaits?: AlsGaitSpeedOverrides
  readonly eye?: CharacterEye
  readonly jump?: Partial<CharacterJump>
  readonly fly?: Partial<CharacterFly>
  readonly shoulderOffset?: number
  readonly sprintOutSeconds?: number
  readonly fov?: number
  readonly sensitivity?: number
  readonly look?: Partial<CharacterLook>
  readonly padLook?: PadLook
  readonly aimAssist?: AimAssistSettings | false
  readonly aimKick?: number
  readonly bindings?: ReadonlyArray<Binding>
  readonly input?: InputRuntime
  readonly ownerId?: string
  readonly seed?: number
}

export const CHARACTER_LOOK: CharacterLook = { mouse: 0.0022, touch: 0.0042, touchScale: 1.4, pitchMin: -1.48, pitchMax: 1.48 }
export const CHARACTER_EYE: CharacterEye = { stand: 1.63, crouch: 1.0, smoothing: 20 }
export const CHARACTER_JUMP: CharacterJump = { bufferSeconds: 0.1, coyoteSeconds: 0.1 }
export const CHARACTER_AIM_ASSIST: AimAssistSettings = { ...aimAssistDefaults, slowdown: 0.4, magnetism: 0.2, snapAngle: 0 }
export const CHARACTER_RUMBLE: CharacterRumble = { ms: 60, strong: 0.12, weak: 0.3, trigger: 0.45 }
export const ROLL_TAP_SECONDS = 0.25
export const WALK_STICK = 0.5

const DEG = 180 / Math.PI

export type CharacterHandle = ReturnType<typeof createCharacterController>

export function createCharacterController(config: CharacterConfig) {
  const weapons = config.weapons ?? []
  const definitions = weapons.map(weapon => weapon.definition)
  const first = definitions[0]?.id ?? 'rifle'
  const ownerId = config.ownerId ?? 'local'
  const als = createAlsPlayer({ spawn: config.start.position })
  const arms = createArmsState()
  arms.weapon = first as ArmsWeapon
  arms.aimSeconds = weapons[0]?.adsSeconds ?? arms.aimSeconds
  const listeners = new Set<() => void>()
  let status: CharacterStatus = { locked: false, paused: false, view: config.views[0], touchAim: false, touchCrouch: false, flying: false }
  const setStatus = (next: Partial<CharacterStatus>) => {
    if (Object.entries(next).every(([field, value]) => status[field as keyof CharacterStatus] === value)) return
    status = { ...status, ...next }
    for (const listener of listeners) listener()
  }
  const runtime = (seed: number) => definitions.length ? createWeaponRuntime({ ownerId, seed, definitions, initialWeaponId: first }) : null
  const look = { ...CHARACTER_LOOK, ...config.look }
  const checkDrive: CharacterDriver = { forward: 0, right: 0, sprint: false, jump: false, fire: false, aim: false }
  const controller = {
    config,
    armed: definitions.length > 0,
    input: config.input ?? makeInputDevices(),
    als,
    look,
    padLook: config.padLook ?? PAD_LOOK,
    aimAssist: config.aimAssist ?? CHARACTER_AIM_ASSIST,
    aimKick: config.aimKick ?? 0.75,
    eyeConfig: config.eye ?? CHARACTER_EYE,
    jumpConfig: { ...CHARACTER_JUMP, ...config.jump },
    fly: config.fly ? { ...CHARACTER_FLY, ...config.fly } : null,
    flight: createFlight(),
    flying: false,
    shoulderOffset: config.shoulderOffset ?? 0,
    sprintOutSeconds: config.sprintOutSeconds ?? 0.22,
    fov: config.fov ?? 75,
    sensitivity: config.sensitivity ?? 1,
    arms,
    feel: createCameraFeel(),
    recoil: createAimRecoil(),
    weapon: runtime(config.seed ?? 7) as WeaponRuntime | null,
    control: { yaw: config.start.yaw, pitch: config.start.pitch ?? 0, reset: true },
    kick: { pitch: 0, yaw: 0 },
    sway: { pitch: 0, yaw: 0 },
    eye: new Vector3(config.start.position[0], config.start.position[1] + (config.eye ?? CHARACTER_EYE).stand, config.start.position[2]),
    position: new Vector3(...config.start.position),
    velocity: new Vector3(),
    grounded: true,
    crouching: false,
    sprinting: false,
    speed: 0,
    rightShoulder: true,
    aim: { origin: new Vector3(), direction: new Vector3(0, 0, -1) },
    muzzle: new Vector3(),
    touch: { forward: 0, right: 0, lookX: 0, lookY: 0, fire: false, rise: false } as CharacterTouch,
    driver: null as CharacterDriver | null,
    override: false,
    pointer: { current: null as (() => void) | null },
    teleporter: { current: null as { TeleportTo(location: Vec3, yaw?: number): void } | null },
    world: { current: null as CharacterWorld | null },
    active: true,
    eyeDrop: 0,
    clock: 0,
    firing: false,
    selected: first,
    queued: { reload: false, jump: false, roll: false },
    weaponOf: (id: string) => weapons.find(weapon => weapon.definition.id === id) ?? weapons[0],
    status: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setStatus,
    setView(view: CharacterView) { if (config.views.includes(view)) setStatus({ view }) },
    cycleView() { controller.setView(config.views[(config.views.indexOf(status.view) + 1) % config.views.length]!) },
    select(id: string) { if (definitions.some(definition => definition.id === id)) controller.selected = id },
    cycle(step = 1) {
      if (!definitions.length) return
      const index = definitions.findIndex(definition => definition.id === controller.selected)
      controller.selected = definitions[(index + step + definitions.length) % definitions.length]!.id
    },
    reload() { controller.queued.reload = true },
    jump() { controller.queued.jump = true },
    roll() { controller.queued.roll = true },
    setFlying(on: boolean) {
      if (on === controller.flying) return
      if (on) {
        const body = als.pose.current.ownerRigidBody
        if (!controller.fly || !body) return
        const at = body.translation()
        controller.flight.position.set(at.x, at.y, at.z)
        controller.flight.velocity.copy(controller.velocity)
      } else controller.flight.velocity.set(0, 0, 0)
      controller.flying = on
      setStatus({ flying: on })
    },
    toggleFlying() { controller.setFlying(!controller.flying) },
    swapShoulder() { controller.rightShoulder = !controller.rightShoulder },
    inspect() { arms.inspectSequence++ },
    hurt(amount: number, side: number) { controller.feel.hurt(amount, side) },
    blast(source: ImpulsePoint, strength = 1) { controller.feel.impulse.blast(source, strength, controller.eye, controller.control.yaw) },
    drive(next: CharacterDriver | null) { controller.driver = next },
    teleport(position: Vec3, yaw: number, pitch = config.start.pitch ?? 0) {
      controller.setFlying(false)
      controller.control.yaw = yaw
      controller.control.pitch = pitch
      controller.control.reset = true
      controller.position.set(...position)
      controller.eye.set(position[0], position[1] + controller.eyeConfig.stand, position[2])
      const alsYaw = -(yaw + Math.PI / 2) * DEG
      als.command.yaw = alsYaw
      als.command.pitch = pitch * DEG
      if (controller.teleporter.current) controller.teleporter.current.TeleportTo(position, alsYaw)
      else als.respawn(position)
    },
    face(target: Point) {
      const dx = target.x - controller.eye.x, dz = target.z - controller.eye.z
      controller.control.yaw = Math.atan2(-dx, -dz)
      controller.control.pitch = Math.atan2(target.y - controller.eye.y, Math.hypot(dx, dz))
      controller.control.reset = true
    },
    ragdoll() { als.ragdoll() },
    lock() { controller.pointer.current?.() },
    setPaused(paused: boolean) {
      if (status.paused === paused) return
      if (paused && typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock()
      setStatus({ paused })
    },
    respawn(seed = config.seed ?? 7, position: Vec3 = config.start.position, yaw = config.start.yaw) {
      controller.teleport(position, yaw)
      controller.weapon?.dispose()
      controller.weapon = runtime(seed)
      controller.selected = first
      controller.firing = controller.sprinting = false
      controller.queued.reload = controller.queued.jump = controller.queued.roll = false
      controller.clock = controller.eyeDrop = 0
      controller.kick.pitch = controller.kick.yaw = 0
      arms.weapon = first as ArmsWeapon
      arms.aimSeconds = weapons[0]?.adsSeconds ?? arms.aimSeconds
      arms.equipSequence++
      controller.feel.reset()
      controller.recoil.reset()
    },
    check: {
      respawn(at?: { x: number; z: number; yaw?: number }) {
        if (!at) { controller.respawn(); return }
        const ground = controller.world.current?.groundAt(at.x, at.z)
        controller.teleport([at.x, (ground ?? config.start.position[1]) + 0.05, at.z], at.yaw ?? config.start.yaw)
      },
      move(input: CharacterCheckMove | null) {
        if (!input) { controller.drive(null); return }
        Object.assign(checkDrive, { forward: input.forward ?? 0, right: input.right ?? 0, sprint: !!input.sprint, jump: !!input.jump })
        controller.drive(checkDrive)
      },
      face(target: Point) { controller.face(target) },
      bounds: () => controller.world.current?.bounds() ?? null,
    },
  }
  als.command.yaw = -(config.start.yaw + Math.PI / 2) * DEG
  als.command.pitch = (config.start.pitch ?? 0) * DEG
  als.command.overlay = weapons[0]?.overlay ?? 'Default'
  return controller
}
