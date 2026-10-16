import { Suspense, useMemo, type ComponentProps, type ReactNode } from 'react'
import { useFrame, type RootState } from '@react-three/fiber'
import { Character } from 'als-ue5-r3f/app/Character'
import { AlsCamera } from 'als-ue5-r3f/app/AlsCamera'
import { createCharacterPoseSample, type CharacterPoseSample } from 'als-ue5-r3f/app/CharacterPoseSample'
import { createWorldTimeState } from 'als-ue5-r3f/engine/timeDilation'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import type { AlsCharacterCodeInput } from 'als-ue5-r3f/als/AlsCharacter.hooks'
import { CheckProbe } from '../../game-shell/src/game/check'
import { PlayHud } from '../../game-shell/src/game/hud'
import { held, take, value } from '../../game-shell/src/game/input'
import { FEEL } from '../../game-shell/src/game/model'
import { sound } from '../../game-shell/src/game/sound'
import { Stage, surfacesReady, useSurfaces } from '../../game-shell/src/game/stage'
import { yard } from '../../game-shell/src/game/yard'

const DEGREES = 180 / Math.PI
const feel = { moveSpeed: FEEL.moveSpeed, sprintSpeed: FEEL.sprintSpeed, jumpApex: FEEL.jumpApex, tolerance: 0.12 }

type Footsteps = ComponentProps<typeof Character>['footstepSoundSink']
type Listener = ComponentProps<typeof AlsCamera>['footstepAudioRuntime']

const footsteps: Footsteps = {
  PlayFootstepSound: request => { sound.play(request.SoundType === 'Land' ? 'landing.concrete' : 'footstep.concrete', { position: [request.Location.x, request.Location.y, request.Location.z] }) },
}
const listener: Listener = {
  SetListenerTransform: transform => sound.setListener({ position: [transform.Location.x, transform.Location.y, transform.Location.z], forward: [transform.Forward.x, transform.Forward.y, transform.Forward.z] }),
}

function createControl() {
  const control = { yaw: 0, pitch: 0, jumpSequence: 0 }
  const source = (): AlsCharacterCodeInput => {
    const move = value('move')
    const yaw = control.yaw / DEGREES
    const aiming = held('aim')
    const crouch = held('crouch')
    return {
      active: true,
      jumpSequence: control.jumpSequence,
      movementDirection: { x: move.y * Math.cos(yaw) - move.x * Math.sin(yaw), z: move.y * Math.sin(yaw) + move.x * Math.cos(yaw) },
      desiredGait: held('sprint') && !aiming && !crouch ? 'Sprinting' : held('walk') ? 'Walking' : 'Running',
      desiredStance: crouch ? 'Crouching' : 'Standing',
      desiredRotationMode: aiming ? 'Aiming' : 'ViewDirection',
      viewYawAngle: control.yaw,
      viewPitchAngle: control.pitch,
      aiming,
    }
  }
  return { control, source, rotation: () => ({ yaw: control.yaw, pitch: control.pitch }) }
}

function Look({ control }: { control: { yaw: number; pitch: number; jumpSequence: number } }) {
  useFrame(() => {
    const look = value('look')
    control.yaw = ((control.yaw + look.x * DEGREES + 180) % 360 + 360) % 360 - 180
    control.pitch = Math.max(-80, Math.min(80, control.pitch - look.y * DEGREES))
    if (take('jump')) control.jumpSequence++
    sound.update(1 / 60)
  }, ALS_FRAME_PRIORITY.ControlRotation - 0.5)
  return null
}

function Player({ pose }: { pose: { current: CharacterPoseSample } }) {
  const time = useMemo(createWorldTimeState, [])
  const drive = useMemo(createControl, [])
  return <>
    <Look control={drive.control} />
    <Suspense fallback={null}>
      <Character onSizeChange={() => {}} onOverlayModeBridgeChange={() => {}} poseSample={pose} worldTime={time} footstepSoundSink={footsteps} inputEnabled={false} inputSource={drive.source} toggleRotationModeKey={null} showDebugControls={false} initialPosition={yard.spawn} />
    </Suspense>
    <AlsCamera poseSample={pose} worldTime={time} footstepAudioRuntime={listener} toggleViewModeKey={null} gamepadEnabled={false} controlRotationSource={drive.rotation} />
  </>
}

export default function Mode({ onCreated, physicsProbe }: { onCreated?: (state: RootState) => void; physicsProbe?: ReactNode } = {}) {
  const pose = useMemo(() => ({ current: createCharacterPoseSample() }), [])
  const ready = useSurfaces()
  return <>
    <Stage physicsPriority={ALS_FRAME_PRIORITY.Physics} onCreated={onCreated}>
      <Player pose={pose} />
      <CheckProbe
        priority={ALS_FRAME_PRIORITY.Camera + 0.05}
        feel={feel}
        ready={() => surfacesReady() && pose.current.ready}
        player={() => {
          const body = pose.current.ownerRigidBody
          if (!body) return null
          const position = body.translation()
          const velocity = body.linvel()
          return { position: [position.x, position.y, position.z], velocity: [velocity.x, velocity.y, velocity.z] }
        }} />
      {physicsProbe}
    </Stage>
    <PlayHud ready={ready} hints={[['WASD', 'Move'], ['Mouse', 'Look'], ['Shift', 'Sprint'], ['Ctrl', 'Crouch'], ['Space', 'Jump'], ['RMB', 'Aim']]} buttons={[{ id: 'jump', label: 'Jump' }, { id: 'sprint', label: 'Sprint' }, { id: 'crouch', label: 'Crouch' }, { id: 'aim', label: 'Aim' }]} />
  </>
}
