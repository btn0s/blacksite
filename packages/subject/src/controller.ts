import { Quaternion, Vector3 } from 'three'
import { createAlsPlayer } from 'als-ue5-r3f/app/AlsPlayer'
import type { AlsPlayer } from 'als-ue5-r3f/app/AlsPlayer'
import type { AlsCharacterInputSource } from 'als-ue5-r3f/als/AlsCharacter.hooks'
import { createGameplayContext } from '@blacksite/input/actions'

export type FpsView = 'first-person' | 'third-person'
export type CameraMode = 'switchable' | 'fpp' | 'tpp'
export const MP_CAMERA_INPUT = createGameplayContext([{ action: 'toggleView', control: { device: 'keyboard', key: 'KeyV' }, trigger: 'pressed' }], 'mp-camera')
const toggleViewCode = MP_CAMERA_INPUT.bindings[0]!.control
export type FpsWeapon = 'rifle' | 'pistol' | 'bow'
export interface SubjectOptions {
  initialView?: FpsView
  cameraMode?: CameraMode
  initialWeapon?: FpsWeapon
  /** World feet position, in metres. */
  spawn?: readonly [number, number, number]
  /** ALS yaw degrees: zero faces world +X, 90 faces +Z. */
  yaw?: number
  pitch?: number
  /** Radians per pointer pixel. */
  sensitivity?: number
  /** First-person vertical FOV, in degrees. TPP uses the authored ALS camera settings. */
  fov?: number
  aimFov?: number
}
export interface FpsInput {
  fire: boolean
  aim: boolean
  reloadSequence: number
  weaponSequence: number
}
export interface FpsFrame {
  ready: boolean
  locked: boolean
  view: FpsView
  aiming: boolean
  grounded: boolean
  crouching: boolean
  sprinting: boolean
  action: string | null
  /** Feet, velocity and aim vectors all use Three.js world axes/metres. */
  readonly position: Vector3
  readonly velocity: Vector3
  readonly eye: Vector3
  readonly aimOrigin: Vector3
  readonly aimDirection: Vector3
  readonly muzzlePosition: Vector3
  readonly cameraQuaternion: Quaternion
  /** All player colliders must be excluded from weapon casts. */
  readonly ownerColliderHandles: Set<number>
}
export interface SubjectSnapshot {
  enabled: boolean
  ready: boolean
  locked: boolean
  view: FpsView
  weapon: FpsWeapon
  aiming: boolean
  grounded: boolean
  crouching: boolean
  sprinting: boolean
  action: string | null
}
export interface SubjectState {
  readonly player: AlsPlayer
  readonly input: FpsInput
  readonly frame: FpsFrame
  readonly options: Required<Omit<SubjectOptions, 'spawn'>>
  readonly keys: Set<string>
  view: FpsView
  weapon: FpsWeapon
  enabled: boolean
  setEnabled(enabled: boolean): void
  respawn(position?: readonly [number, number, number], yawDegrees?: number): void
  setView(view: FpsView): void
  setWeapon(weapon: FpsWeapon): void
  /** Positive pitch kicks upward; positive yaw kicks right. Both arguments are degrees. */
  addRecoil(pitchDegrees: number, yawDegrees?: number): void
  requestPointerLock(): Promise<void>
  /** React useSyncExternalStore-compatible; frame vectors are sampled separately without rerenders. */
  subscribe(listener: () => void): () => void
  getSnapshot(): SubjectSnapshot
  /** Adapter lifecycle hooks, not gameplay commands. */
  attachPointerLock(request: (() => Promise<void>) | null): void
  publish(): void
}
const finite = (value: number | undefined, fallback: number) => Number.isFinite(value) ? value! : fallback
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const overlays = { rifle: 'Rifle', pistol: 'PistolTwoHanded', bow: 'Bow' } as const
export const FPS_WEAPONS = ['rifle', 'pistol', 'bow'] as const

export function createSubject(options: SubjectOptions = {}): SubjectState {
  const cameraMode = options.cameraMode ?? 'switchable'
  const initialView = cameraMode === 'tpp' ? 'third-person' : cameraMode === 'fpp' ? 'first-person' : options.initialView ?? 'first-person'
  const player = createAlsPlayer({ spawn: options.spawn })
  const listeners = new Set<() => void>()
  let requestLock: (() => Promise<void>) | null = null
  let snapshot: SubjectSnapshot
  const state: SubjectState = {
    player,
    options: {
      initialView, cameraMode, initialWeapon: options.initialWeapon ?? 'rifle',
      yaw: finite(options.yaw, 0), pitch: clamp(finite(options.pitch, 0), -85, 85),
      sensitivity: clamp(finite(options.sensitivity, 0.0022), 0.0001, 0.02),
      fov: clamp(finite(options.fov, 75), 35, 110), aimFov: clamp(finite(options.aimFov, 58), 25, 100),
    },
    input: { fire: false, aim: false, reloadSequence: 0, weaponSequence: 0 },
    keys: new Set(), view: initialView, weapon: options.initialWeapon ?? 'rifle', enabled: true,
    frame: {
      ready: false, locked: false, view: initialView, aiming: false,
      grounded: false, crouching: false, sprinting: false, action: null,
      position: new Vector3(), velocity: new Vector3(), eye: new Vector3(),
      aimOrigin: new Vector3(), aimDirection: new Vector3(1, 0, 0),
      muzzlePosition: new Vector3(), cameraQuaternion: new Quaternion(), ownerColliderHandles: new Set(),
    },
    setView(view) {
      if (cameraMode === 'fpp' && view !== 'first-person' || cameraMode === 'tpp' && view !== 'third-person') return
      state.view = view
      player.command.view = view === 'first-person' ? 'FirstPerson' : 'ThirdPerson'
      player.command.bodyVisible = view !== 'first-person'
      state.frame.view = view
      state.publish()
    },
    setEnabled(enabled) {
      state.enabled = enabled
      if (!enabled) resetFpsInput(state)
      player.command.active = enabled && state.frame.locked
      state.publish()
    },
    respawn(position, yawDegrees = state.options.yaw) {
      resetFpsInput(state)
      state.player.command.yaw = wrapYaw(finite(yawDegrees, state.options.yaw))
      state.player.command.pitch = state.options.pitch
      state.frame.ready = false
      state.frame.ownerColliderHandles.clear()
      state.player.respawn(position)
      state.setEnabled(true)
    },
    setWeapon(weapon) {
      if (!FPS_WEAPONS.includes(weapon)) throw new Error(`Unsupported FPS weapon: ${weapon}`)
      if (state.weapon !== weapon) state.input.weaponSequence++
      state.weapon = weapon
      player.command.overlay = overlays[weapon]
      state.publish()
    },
    addRecoil(pitchDegrees, yawDegrees = 0) {
      if (!state.enabled || !Number.isFinite(pitchDegrees) || !Number.isFinite(yawDegrees)) return
      player.command.pitch = clamp(player.command.pitch + clamp(pitchDegrees, -20, 20), -85, 85)
      player.command.yaw = wrapYaw(player.command.yaw + clamp(yawDegrees, -20, 20))
    },
    async requestPointerLock() { await requestLock?.() },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot() { return snapshot },
    attachPointerLock(request) { requestLock = request },
    publish() {
      const frame = state.frame
      const next: SubjectSnapshot = {
        enabled: state.enabled,
        ready: frame.ready, locked: frame.locked, view: state.view, weapon: state.weapon,
        aiming: frame.aiming, grounded: frame.grounded, crouching: frame.crouching,
        sprinting: frame.sprinting, action: frame.action,
      }
      if (snapshot && (Object.keys(next) as Array<keyof SubjectSnapshot>).every(key => next[key] === snapshot[key])) return
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
  player.command.yaw = state.options.yaw
  player.command.pitch = state.options.pitch
  player.command.active = false
  state.setView(state.view)
  state.setWeapon(state.weapon)
  return state
}

export function wrapYaw(degrees: number): number { return ((degrees + 180) % 360 + 360) % 360 - 180 }

export function createSubjectInputSource(controller: SubjectState): AlsCharacterInputSource {
  return () => {
    const command = controller.player.command
    const yaw = command.yaw * Math.PI / 180
    const forward = command.active ? command.forward : 0
    const right = command.active ? command.right : 0
    return {
      active: command.active,
      jumpSequence: command.jumpSequence,
      movementDirection: {
        x: forward * Math.cos(yaw) - right * Math.sin(yaw),
        z: forward * Math.sin(yaw) + right * Math.cos(yaw),
      },
      desiredGait: command.sprint ? 'Sprinting' : 'Running',
      desiredStance: command.crouch ? 'Crouching' : 'Standing',
      desiredRotationMode: 'ViewDirection',
      viewYawAngle: command.yaw,
      viewPitchAngle: command.pitch,
      aiming: command.aim,
      overlayMode: command.overlay,
    }
  }
}

export function lookSubject(controller: SubjectState, movementX: number, movementY: number): void {
  if (!controller.enabled) return
  if (!Number.isFinite(movementX) || !Number.isFinite(movementY)) return
  const sensitivityDegrees = controller.options.sensitivity * 180 / Math.PI
  controller.player.command.yaw = wrapYaw(controller.player.command.yaw + movementX * sensitivityDegrees)
  controller.player.command.pitch = clamp(controller.player.command.pitch - movementY * sensitivityDegrees, -85, 85)
}

/** Press/release reducer shared by the DOM adapter and tests. Auto-repeat never creates action edges. */
export function keySubject(controller: SubjectState, code: string, pressed: boolean, repeat = false): boolean {
  if (!controller.enabled) return false
  const relevant = /^(Key[WASDRV]|Space|ShiftLeft|ShiftRight|ControlLeft|ControlRight|Digit[123])$/.test(code)
  if (!relevant) return false
  if (!pressed) { controller.keys.delete(code); return true }
  if (repeat || controller.keys.has(code)) return true
  controller.keys.add(code)
  if (code === 'Space') controller.player.command.jumpSequence++
  else if (toggleViewCode.device === 'keyboard' && code === toggleViewCode.key && controller.options.cameraMode === 'switchable') controller.setView(controller.view === 'first-person' ? 'third-person' : 'first-person')
  else if (code === 'KeyR') controller.input.reloadSequence++
  else if (code.startsWith('Digit')) controller.setWeapon(FPS_WEAPONS[Number(code.slice(-1)) - 1]!)
  return true
}

export function updateFpsMovementInput(controller: SubjectState): void {
  const { keys, player, input, frame } = controller
  if (!controller.enabled) { resetFpsInput(controller); return }
  player.command.active = frame.locked
  let right = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
  let forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)
  const length = Math.hypot(right, forward)
  if (length > 1) { right /= length; forward /= length }
  player.command.right = frame.locked ? right : 0
  player.command.forward = frame.locked ? forward : 0
  player.command.crouch = frame.locked && (keys.has('ControlLeft') || keys.has('ControlRight'))
  player.command.aim = frame.locked && input.aim
  // Classic hold sprint: no tap action or roll binding, and aiming retains accurate locomotion.
  player.command.sprint = frame.locked && !input.aim && !player.command.crouch
    && forward > 0 && (keys.has('ShiftLeft') || keys.has('ShiftRight'))
}

/** Focus/lock loss cannot leave firing, aiming or movement latched. */
export function resetFpsInput(controller: SubjectState): void {
  controller.keys.clear()
  controller.input.fire = controller.input.aim = false
  controller.player.command.right = controller.player.command.forward = 0
  controller.player.command.sprint = controller.player.command.crouch = controller.player.command.aim = false
  controller.player.command.active = false
}
