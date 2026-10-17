import { Vector3 } from 'three'
import { createWeaponRuntime, type WeaponDefinition, type WeaponRuntime } from '@blacksite/armory'
import { aimAssistDefaults, makeInputDevices, type AimAssistSettings, type Binding, type InputRuntime } from '@blacksite/input'
import { createAlsPlayer, type AlsPlayerCommand } from 'als-ue5-r3f/app/AlsPlayer'
import type { CharacterProps } from 'als-ue5-r3f/app/Character'
import { createArmsState, type ArmsWeapon } from '../arms/state'
import { createCameraFeel } from '../feel/camera'
import { createAimRecoil } from '../feel/recoil'
import { PAD_LOOK, type PadLook } from '../input'

type AlsOverlayMode = AlsPlayerCommand['overlay']
type AlsGaitSpeedOverrides = NonNullable<CharacterProps['gaitSpeedOverrides']>

export type CharacterView = 'arms' | 'head' | 'shoulder'
export type CharacterRumble = { readonly ms: number; readonly strong: number; readonly weak: number; readonly trigger: number }
export type CharacterWeapon = { readonly definition: WeaponDefinition; readonly adsFov: number; readonly adsSeconds: number; readonly overlay: AlsOverlayMode; readonly rumble?: CharacterRumble }
export type CharacterDriver = { forward: number; right: number; sprint: boolean; jump: boolean; fire: boolean; aim: boolean }
export type CharacterTouch = { forward: number; right: number; lookX: number; lookY: number; fire: boolean }
export type CharacterStatus = { readonly locked: boolean; readonly paused: boolean; readonly view: CharacterView; readonly touchAim: boolean; readonly touchCrouch: boolean }
export type CharacterLook = { readonly mouse: number; readonly touch: number; readonly touchScale: number; readonly pitchLimit: number }
export type CharacterEye = { readonly stand: number; readonly crouch: number; readonly smoothing: number }

export type CharacterConfig = {
  readonly views: readonly [CharacterView, ...CharacterView[]]
  readonly start: { readonly position: readonly [number, number, number]; readonly yaw: number }
  readonly weapons?: ReadonlyArray<CharacterWeapon>
  readonly gaits?: AlsGaitSpeedOverrides
  readonly eye?: CharacterEye
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

export const CHARACTER_LOOK: CharacterLook = { mouse: 0.0022, touch: 0.0042, touchScale: 1.4, pitchLimit: 1.48 }
export const CHARACTER_EYE: CharacterEye = { stand: 1.63, crouch: 1.0, smoothing: 20 }
export const CHARACTER_AIM_ASSIST: AimAssistSettings = { ...aimAssistDefaults, slowdown: 0.4, magnetism: 0.2, snapAngle: 0 }
export const CHARACTER_RUMBLE: CharacterRumble = { ms: 60, strong: 0.12, weak: 0.3, trigger: 0.45 }

const DEG = 180 / Math.PI
const wall = () => performance.now()

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
  let status: CharacterStatus = { locked: false, paused: false, view: config.views[0], touchAim: false, touchCrouch: false }
  const setStatus = (next: Partial<CharacterStatus>) => {
    if (Object.entries(next).every(([field, value]) => status[field as keyof CharacterStatus] === value)) return
    status = { ...status, ...next }
    for (const listener of listeners) listener()
  }
  let pausedAt: number | null = null
  let pausedFor = 0
  const runtime = (seed: number) => definitions.length ? createWeaponRuntime({ ownerId, seed, definitions, initialWeaponId: first }) : null
  const controller = {
    config,
    input: config.input ?? makeInputDevices(),
    als,
    look: { ...CHARACTER_LOOK, ...config.look },
    padLook: config.padLook ?? PAD_LOOK,
    aimAssist: config.aimAssist ?? CHARACTER_AIM_ASSIST,
    aimKick: config.aimKick ?? 0.75,
    eyeConfig: config.eye ?? CHARACTER_EYE,
    sprintOutSeconds: config.sprintOutSeconds ?? 0.22,
    fov: config.fov ?? 75,
    sensitivity: config.sensitivity ?? 1,
    arms,
    feel: createCameraFeel(),
    recoil: createAimRecoil(),
    weapon: runtime(config.seed ?? 7) as WeaponRuntime | null,
    control: { yaw: config.start.yaw, pitch: 0, reset: true },
    kick: { pitch: 0, yaw: 0 },
    sway: { pitch: 0, yaw: 0 },
    eye: new Vector3(config.start.position[0], config.start.position[1] + (config.eye ?? CHARACTER_EYE).stand, config.start.position[2]),
    position: new Vector3(...config.start.position),
    velocity: new Vector3(),
    grounded: true,
    crouching: false,
    sprinting: false,
    speed: 0,
    aim: { origin: new Vector3(), direction: new Vector3(0, 0, -1) },
    muzzle: new Vector3(),
    touch: { forward: 0, right: 0, lookX: 0, lookY: 0, fire: false } as CharacterTouch,
    driver: null as CharacterDriver | null,
    override: false,
    pointer: { current: null as (() => void) | null },
    teleporter: { current: null as { TeleportTo(location: readonly [number, number, number], yaw?: number): void } | null },
    active: true,
    eyeDrop: 0,
    clock: 0,
    firing: false,
    selected: first,
    queued: { reload: false, jump: false },
    weaponOf: (id: string) => weapons.find(weapon => weapon.definition.id === id) ?? weapons[0],
    status: () => status,
    now: () => (pausedAt ?? wall()) - pausedFor,
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
    inspect() { arms.inspectSequence++ },
    hurt(amount: number, side: number) { controller.feel.hurt(amount, side) },
    drive(next: CharacterDriver | null) { controller.driver = next },
    teleport(position: readonly [number, number, number], yaw: number) {
      controller.control.yaw = yaw
      controller.control.pitch = 0
      controller.control.reset = true
      controller.position.set(...position)
      controller.eye.set(position[0], position[1] + controller.eyeConfig.stand, position[2])
      const alsYaw = -(yaw + Math.PI / 2) * DEG
      als.command.yaw = alsYaw
      als.command.pitch = 0
      if (controller.teleporter.current) controller.teleporter.current.TeleportTo(position, alsYaw)
      else als.respawn(position)
    },
    face(target: { x: number; y: number; z: number }) {
      const dx = target.x - controller.eye.x, dz = target.z - controller.eye.z
      controller.control.yaw = Math.atan2(-dx, -dz)
      controller.control.pitch = Math.atan2(target.y - controller.eye.y, Math.hypot(dx, dz))
      controller.control.reset = true
    },
    ragdoll() { als.ragdoll() },
    lock() { controller.pointer.current?.() },
    setPaused(paused: boolean) {
      if (status.paused === paused) return
      if (paused) {
        pausedAt = wall()
        if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock()
      } else if (pausedAt !== null) {
        pausedFor += wall() - pausedAt
        pausedAt = null
      }
      setStatus({ paused })
    },
    respawn(seed = config.seed ?? 7, position = config.start.position, yaw = config.start.yaw) {
      controller.teleport(position, yaw)
      controller.weapon?.dispose()
      controller.weapon = runtime(seed)
      controller.selected = first
      controller.firing = controller.sprinting = false
      controller.queued.reload = controller.queued.jump = false
      controller.clock = controller.eyeDrop = 0
      controller.kick.pitch = controller.kick.yaw = 0
      arms.weapon = first as ArmsWeapon
      arms.aimSeconds = weapons[0]?.adsSeconds ?? arms.aimSeconds
      arms.equipSequence++
      controller.feel.reset()
      controller.recoil.reset()
    },
  }
  als.command.yaw = -(config.start.yaw + Math.PI / 2) * DEG
  als.command.overlay = weapons[0]?.overlay ?? 'Default'
  return controller
}
