import { Vector3 } from 'three'
import { createWeaponRuntime, type WeaponDefinition, type WeaponRuntime } from '@blacksite/armory'
import { aimAssistDefaults, makeInputDevices, type AimAssistSettings, type Binding, type InputRuntime } from '@blacksite/input'
import { createArmsState, type ArmsState, type ArmsWeapon } from '../arms/state'
import { createCameraFeel, type CameraFeel, type CameraPose } from '../feel/camera'
import { createAimRecoil } from '../feel/recoil'
import { PAD_LOOK, type PadLook } from '../input'
import { FPP_MOVE, createBody, placeBody, type Body, type FirstPersonMove } from './body'
import type { V3 } from './collision'

export type FirstPersonRumble = { readonly ms: number; readonly strong: number; readonly weak: number; readonly trigger: number }
export type FirstPersonWeapon = { readonly definition: WeaponDefinition; readonly adsFov: number; readonly adsSeconds: number; readonly rumble?: FirstPersonRumble }
export type FirstPersonDriver = { forward: number; right: number; sprint: boolean; jump: boolean; fire: boolean; aim: boolean }
export type FirstPersonTouch = { forward: number; right: number; lookX: number; lookY: number; fire: boolean }
export type FirstPersonStatus = { readonly locked: boolean; readonly paused: boolean; readonly touchAim: boolean; readonly touchCrouch: boolean }
export type FirstPersonLook = { readonly mouse: number; readonly touch: number; readonly touchScale: number; readonly pitchLimit: number }

export type FirstPersonConfig = {
  readonly weapons: ReadonlyArray<FirstPersonWeapon>
  readonly start: { readonly position: readonly [number, number, number]; readonly yaw: number }
  readonly move?: FirstPersonMove
  readonly fov?: number
  readonly sensitivity?: number
  readonly look?: Partial<FirstPersonLook>
  readonly padLook?: PadLook
  readonly aimAssist?: AimAssistSettings | false
  readonly aimKick?: number
  readonly bindings?: ReadonlyArray<Binding>
  readonly input?: InputRuntime
  readonly ownerId?: string
  readonly seed?: number
}

export const FPP_LOOK: FirstPersonLook = { mouse: 0.0022, touch: 0.0042, touchScale: 1.4, pitchLimit: 1.48 }
export const FPP_AIM_ASSIST: AimAssistSettings = { ...aimAssistDefaults, slowdown: 0.4, magnetism: 0.2, snapAngle: 0 }
export const FPP_RUMBLE: FirstPersonRumble = { ms: 60, strong: 0.12, weak: 0.3, trigger: 0.45 }

export type FirstPerson = ReturnType<typeof createFirstPerson>

export function createFirstPerson(config: FirstPersonConfig) {
  const move = config.move ?? FPP_MOVE
  const input = config.input ?? makeInputDevices()
  const definitions = config.weapons.map(weapon => weapon.definition)
  const first = definitions[0]!.id as ArmsWeapon
  const ownerId = config.ownerId ?? 'local'
  const listeners = new Set<() => void>()
  let status: FirstPersonStatus = { locked: false, paused: false, touchAim: false, touchCrouch: false }
  const setStatus = (next: Partial<FirstPersonStatus>) => {
    if (Object.entries(next).every(([field, value]) => status[field as keyof FirstPersonStatus] === value)) return
    status = { ...status, ...next }
    for (const listener of listeners) listener()
  }
  const arms = createArmsState()
  arms.weapon = first
  arms.aimSeconds = config.weapons[0]!.adsSeconds
  const player = {
    config,
    move,
    input,
    look: { ...FPP_LOOK, ...config.look },
    padLook: config.padLook ?? PAD_LOOK,
    aimAssist: config.aimAssist ?? FPP_AIM_ASSIST,
    aimKick: config.aimKick ?? 0.75,
    fov: config.fov ?? 75,
    sensitivity: config.sensitivity ?? 1,
    body: createBody(config.start.position, move) as Body,
    arms: arms as ArmsState,
    feel: createCameraFeel() as CameraFeel,
    recoil: createAimRecoil(),
    weapon: createWeaponRuntime({ ownerId, seed: config.seed ?? 7, definitions, initialWeaponId: first }) as WeaponRuntime,
    view: { yaw: config.start.yaw, pitch: 0, reset: true },
    sway: { pitch: 0, yaw: 0 },
    eye: { x: config.start.position[0], y: config.start.position[1] + move.eye, z: config.start.position[2] } as V3,
    aim: { origin: new Vector3(), direction: new Vector3(0, 0, -1) },
    kick: { pitch: 0, yaw: 0 },
    touch: { forward: 0, right: 0, lookX: 0, lookY: 0, fire: false } as FirstPersonTouch,
    driver: null as FirstPersonDriver | null,
    override: null as CameraPose | null,
    active: true,
    eyeDrop: 0,
    clock: 0,
    firing: false,
    sprinting: false,
    speed: 0,
    selected: first as string,
    queued: { reload: false, jump: false },
    weaponOf: (id: string) => config.weapons.find(weapon => weapon.definition.id === id) ?? config.weapons[0]!,
    status: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setStatus,
    select(id: string) { if (definitions.some(definition => definition.id === id)) player.selected = id },
    cycle(step = 1) {
      const index = definitions.findIndex(definition => definition.id === player.selected)
      player.selected = definitions[(index + step + definitions.length) % definitions.length]!.id
    },
    reload() { player.queued.reload = true },
    jump() { player.queued.jump = true },
    inspect() { player.arms.inspectSequence++ },
    hurt(amount: number, side: number) { player.feel.hurt(amount, side) },
    drive(next: FirstPersonDriver | null) { player.driver = next },
    place(position: readonly [number, number, number], yaw: number) {
      placeBody(player.body, position, move)
      player.view.yaw = yaw
      player.view.pitch = 0
      player.view.reset = true
      player.eye.x = position[0]
      player.eye.y = position[1] + player.body.eye
      player.eye.z = position[2]
    },
    face(target: V3) {
      const dx = target.x - player.body.position.x, dz = target.z - player.body.position.z
      player.view.yaw = Math.atan2(-dx, -dz)
      player.view.pitch = Math.atan2(target.y - player.eye.y, Math.hypot(dx, dz))
      player.view.reset = true
    },
    pause(paused: boolean) {
      if (status.paused === paused) return
      if (paused && typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock()
      setStatus({ paused })
    },
    reset(seed = config.seed ?? 7) {
      player.place(config.start.position, config.start.yaw)
      player.weapon.dispose()
      player.weapon = createWeaponRuntime({ ownerId, seed, definitions, initialWeaponId: first })
      player.selected = first
      player.firing = player.sprinting = false
      player.queued.reload = player.queued.jump = false
      player.clock = player.eyeDrop = 0
      player.kick.pitch = player.kick.yaw = 0
      arms.weapon = first
      arms.aimSeconds = config.weapons[0]!.adsSeconds
      arms.equipSequence++
      player.feel.reset()
      player.recoil.reset()
    },
  }
  return player
}
