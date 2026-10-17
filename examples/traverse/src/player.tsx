import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useActionEvents, useInputContext, useInputRuntime } from '@blacksite/input'
import { isTouchDevice } from '@blacksite/look/world'
import { Character, type AlsCharacterTeleport, type AlsRagdollHandle } from 'als-ue5-r3f/app/Character'
import { AlsCamera } from 'als-ue5-r3f/app/AlsCamera'
import type { CharacterPoseSample } from 'als-ue5-r3f/app/CharacterPoseSample'
import type { WorldTimeState } from 'als-ue5-r3f/engine/timeDilation'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import type { TraverseAudio } from './audio'
import { TRAVERSE_INPUT, codeInput, look, stickCurve, type Command } from './controls'
import { camera as cameraModel, input as tuning } from './model'

export type Spawn = { revision: number; position: [number, number, number]; yaw: number }

export type PlayerProps = {
  command: Command
  pose: MutableRefObject<CharacterPoseSample>
  time: Readonly<WorldTimeState>
  audio: TraverseAudio
  spawn: Spawn
  scripted: MutableRefObject<boolean>
  touchLook: MutableRefObject<{ x: number; y: number }>
  touchMove: MutableRefObject<{ forward: number; right: number }>
  onAction: (action: string) => void
}

export function Player({ command, pose, time, audio, spawn, scripted, touchLook, touchMove, onAction }: PlayerProps) {
  const runtime = useInputRuntime()
  const hub = runtime.actions
  const { gl } = useThree()
  const ragdoll = useRef<AlsRagdollHandle | null>(null)
  const teleport = useRef<AlsCharacterTeleport | null>(null)
  const spawned = useRef(spawn.revision)
  const origin = useRef(spawn.position)
  const shift = useRef<{ down: boolean; at: number }>({ down: false, at: 0 })
  const jumpBuffer = useRef(0)
  const airborneSince = useRef(0)
  useInputContext(TRAVERSE_INPUT)

  useEffect(() => {
    if (spawned.current === spawn.revision) return
    spawned.current = spawn.revision
    jumpBuffer.current = 0
    teleport.current?.TeleportTo(spawn.position, spawn.yaw * 180 / Math.PI)
  }, [spawn])

  useEffect(() => {
    runtime.setGameplay(true)
    return () => runtime.setGameplay(false)
  }, [runtime])

  useActionEvents(event => {
    if (scripted.current) return
    if (event.action === 'jump') {
      command.jumpSequence++
      if (pose.current.character?.locomotionMode === 'InAir' && performance.now() / 1000 - airborneSince.current > tuning.coyoteSeconds) jumpBuffer.current = performance.now() / 1000 + tuning.jumpBufferSeconds
    }
    else if (event.action === 'roll') command.rollSequence++
    else if (event.action === 'crouch') command.crouch = !command.crouch
    else if (event.action === 'walk') command.walk = !command.walk
    else if (event.action === 'ragdoll') command.ragdollSequence++
    else if (event.action === 'shoulder') command.rightShoulder = !command.rightShoulder
    else onAction(event.action)
    if (event.device === 'gamepad' && (event.action === 'ragdoll' || event.action === 'roll')) runtime.rumble(140, 0.5, 0.3)
  })

  useEffect(() => {
    const canvas = gl.domElement
    const lock = () => { if (!isTouchDevice() && document.pointerLockElement !== canvas && typeof canvas.requestPointerLock === 'function') void canvas.requestPointerLock()?.catch?.(() => {}) }
    const move = (event: PointerEvent) => {
      if (scripted.current || document.pointerLockElement !== canvas) return
      look(command, event.movementX * tuning.mouseDegreesPerPixel, event.movementY * tuning.mouseDegreesPerPixel)
    }
    const blur = () => { command.forward = command.right = 0; command.sprint = false }
    canvas.addEventListener('click', lock)
    document.addEventListener('pointermove', move)
    window.addEventListener('blur', blur)
    return () => {
      canvas.removeEventListener('click', lock)
      document.removeEventListener('pointermove', move)
      window.removeEventListener('blur', blur)
    }
  }, [command, gl, runtime, scripted])

  useFrame((_, delta) => {
    if (scripted.current) return
    const pad = runtime.snapshot().gameplayReady ? runtime.activePad() : null
    if (pad) {
      const dt = Math.min(delta, 0.05)
      look(command, stickCurve(pad.axes[2] ?? 0) * tuning.padYawRate * dt, stickCurve(pad.axes[3] ?? 0) * tuning.padPitchRate * dt)
    }
    const keyForward = (hub.isHeld('forward') ? 1 : 0) - (hub.isHeld('back') ? 1 : 0)
    const keyRight = (hub.isHeld('right') ? 1 : 0) - (hub.isHeld('left') ? 1 : 0)
    const padRight = pad ? stickCurve(pad.axes[0] ?? 0) : 0
    const padForward = pad ? -stickCurve(pad.axes[1] ?? 0) : 0
    const touch = touchLook.current
    if (touch.x || touch.y) {
      look(command, touch.x * tuning.touchDegreesPerPixel, touch.y * tuning.touchDegreesPerPixel)
      touch.x = touch.y = 0
    }
    command.forward = Math.max(-1, Math.min(1, keyForward + padForward + touchMove.current.forward))
    command.right = Math.max(-1, Math.min(1, keyRight + padRight + touchMove.current.right))
    const held = hub.isHeld('sprint')
    const now = performance.now() / 1000
    const character = pose.current.character
    if (character?.locomotionMode !== 'InAir') airborneSince.current = now
    if (jumpBuffer.current > now && character?.locomotionMode === 'Grounded' && !character.locomotionAction) {
      jumpBuffer.current = 0
      command.jumpSequence++
    }
    if (held && !shift.current.down) shift.current = { down: true, at: now }
    if (!held && shift.current.down) {
      shift.current.down = false
      if (now - shift.current.at < tuning.rollTapSeconds) command.rollSequence++
    }
    command.sprint = (held && now - shift.current.at >= tuning.rollTapSeconds * 0.5) || Math.hypot(touchMove.current.forward, touchMove.current.right) > tuning.touchSprint
  }, ALS_FRAME_PRIORITY.ControlRotation - 0.2)

  const inputSource = useMemo(() => () => codeInput(command), [command])
  const rotation = useMemo(() => () => ({ yaw: command.yaw, pitch: command.pitch }), [command])
  const shoulder = useMemo(() => () => command.rightShoulder, [command])

  return <>
    <Character initialPosition={origin.current} teleportRef={teleport} inputEnabled={false} inputSource={inputSource}
      terrainFootLock
      poseSample={pose} worldTime={time} footstepSoundSink={audio} ragdollRef={ragdoll}
      onSizeChange={noop} onOverlayModeBridgeChange={noop} toggleRotationModeKey={null}
      showDebugControls={false} exposeDebugGlobals={false} gamepadEnabled={false} />
    <AlsCamera poseSample={pose} worldTime={time} footstepAudioRuntime={audio} toggleViewModeKey={null}
      controlRotationSource={rotation} rightShoulder={shoulder} shoulderOffset={cameraModel.shoulderOffset} aspectRatioAxisConstraint="MajorAxisFOV" gamepadEnabled={false} />
  </>
}

const noop = () => {}
