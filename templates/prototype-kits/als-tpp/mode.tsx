import { Canvas } from '@react-three/fiber'
import { Physics, CuboidCollider, RigidBody } from '@react-three/rapier'
import { useMemo } from 'react'
import { Character } from 'als-ue5-r3f/app/Character'
import { AlsCamera } from 'als-ue5-r3f/app/AlsCamera'
import { createCharacterPoseSample } from 'als-ue5-r3f/app/CharacterPoseSample'
import { createWorldTimeState } from 'als-ue5-r3f/engine/timeDilation'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { AlsFootstepAudioRuntime } from '../../../vendor/blacksite/vendor/als-web/src/engine/alsAudioBridge'

function Scene() {
  const pose = useMemo(() => ({ current: createCharacterPoseSample() }), [])
  const time = useMemo(createWorldTimeState, [])
  const audio = useMemo(() => new AlsFootstepAudioRuntime({ AutoInstallUserGestureUnlock: true }), [])
  return <>
    <ambientLight intensity={1.5} />
    <directionalLight position={[5, 12, 4]} intensity={2.5} castShadow />
    <Physics gravity={[0, -9.8, 0]} timeStep={1 / 60} updatePriority={ALS_FRAME_PRIORITY.Physics}>
      <Character onSizeChange={() => {}} poseSample={pose} worldTime={time} onOverlayModeBridgeChange={() => {}} footstepSoundSink={audio} />
      <AlsCamera poseSample={pose} worldTime={time} footstepAudioRuntime={audio} />
      <RigidBody type="fixed" colliders={false}><CuboidCollider args={[30, 0.1, 30]} position={[0, -0.1, 0]} /></RigidBody>
    </Physics>
    <mesh rotation-x={-Math.PI / 2} position-y={-0.01} receiveShadow><planeGeometry args={[60, 60]} /><meshStandardMaterial color="#293743" /></mesh>
    <gridHelper args={[60, 30, '#506d77', '#394c58']} />
  </>
}

export default function Mode() { return <><Canvas shadows camera={{ position: [4, 3, 5], fov: 65 }}><Scene /></Canvas><div className="hud"><strong>Third person</strong><span>Click scene · WASD move · Mouse look · Shift sprint · Space jump</span></div></> }
