import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CuboidCollider, CylinderCollider, Physics, RigidBody } from '@react-three/rapier'
import { Character } from 'als-ue5-r3f/app/Character'
import { AlsCamera } from 'als-ue5-r3f/app/AlsCamera'
import { preloadAlsCharacterGltf } from 'als-ue5-r3f/app/AlsCharacterGltf'
import { createCharacterPoseSample } from 'als-ue5-r3f/app/CharacterPoseSample'
import { createWorldTimeState } from 'als-ue5-r3f/engine/timeDilation'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { attachPerfProbe } from '@blacksite/ui/perf-overlay'
import { Look } from '@blacksite/look/r3f'
import { autoQuality, depthDefaults } from '@blacksite/look/quality'
import { createAtmosphere, internalPixelRatio, texturesReady } from '@blacksite/look/world'
import { Hints, Loading, Prompt, Screen, TitleCard, TouchPad, useTouch } from '@blacksite/ui/hud'
import { buildCheckpoint } from './checkpoint'
import { outfit, showHead } from './outfit'
import { CheckProbe } from './check'
import { createCheckpointAudio, type CheckpointAudio } from './audio'

const level = buildCheckpoint()

function Level() {
  return <>
    <primitive object={level.group} />
    <RigidBody type="fixed" colliders={false}>
      {level.colliders.map((collider, index) => collider.kind === 'box'
        ? <CuboidCollider key={index} args={collider.half} position={collider.position} rotation={collider.rotation} />
        : <CylinderCollider key={index} args={[collider.halfHeight, collider.radius]} position={collider.position} rotation={collider.rotation} />)}
    </RigidBody>
  </>
}

function Atmosphere() {
  const { scene, gl, camera } = useThree()
  const atmosphere = useMemo(() => createAtmosphere(scene, gl, { fog: '#878a7c', density: 0.0115, shadowSize: 34, sunIntensity: 2.6, ambient: 0.85, sunDirection: [0.55, 0.36, -0.62] }), [scene, gl])
  const focus = useRef(new THREE.Vector3())
  useFrame(() => {
    camera.getWorldDirection(focus.current)
    focus.current.multiplyScalar(14).add(camera.position)
    focus.current.y = 0
    atmosphere.follow(focus.current)
  })
  return null
}

function Scene({ onFirstPerson, audio }: { onFirstPerson: (value: boolean) => void; audio: CheckpointAudio }) {
  const pose = useMemo(() => ({ current: createCharacterPoseSample() }), [])
  const time = useMemo(createWorldTimeState, [])
  const view = useRef('ThirdPerson')
  useFrame(() => {
    const velocity = pose.current.ownerRigidBody?.linvel()
    if (velocity) audio.captureVerticalSpeed(velocity.y)
  }, ALS_FRAME_PRIORITY.PosePublication + 0.1)
  useFrame((_, delta) => {
    audio.update(delta)
    const character = pose.current.character
    if (!character) return
    if (character.viewMode !== view.current) {
      view.current = character.viewMode
      showHead(character.viewMode !== 'FirstPerson')
      onFirstPerson(character.viewMode === 'FirstPerson')
    }
  }, ALS_FRAME_PRIORITY.Camera + 0.04)
  return <>
    <Atmosphere />
    <Look atmosphere="zone" sky={false} fog={false} />
    <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60} updatePriority={ALS_FRAME_PRIORITY.Physics}>
      <Character onSizeChange={() => {}} poseSample={pose} worldTime={time} onOverlayModeBridgeChange={() => {}} footstepSoundSink={audio} toggleRotationModeKey={null} showDebugControls={false} initialPosition={level.spawn} />
      <AlsCamera poseSample={pose} worldTime={time} footstepAudioRuntime={audio} toggleViewModeKey="KeyV" />
      <Level />
    </Physics>
    <CheckProbe pose={pose} audio={audio} />
  </>
}

function key(code: string, pressed: boolean) {
  window.dispatchEvent(new KeyboardEvent(pressed ? 'keydown' : 'keyup', { code, key: code, bubbles: true }))
}

const touchCodes: Record<string, string> = { jump: 'Space', crouch: 'ControlLeft', sprint: 'ShiftLeft', ragdoll: 'KeyX', view: 'KeyV', walk: 'AltLeft' }

function Touch() {
  const held = useRef(new Set<string>())
  const move = (x: number, y: number) => {
    for (const [code, on] of [['KeyW', y < -0.3], ['KeyS', y > 0.3], ['KeyA', x < -0.3], ['KeyD', x > 0.3]] as const) {
      if (on === held.current.has(code)) continue
      key(code, on)
      if (on) held.current.add(code)
      else held.current.delete(code)
    }
  }
  const look = (dx: number, dy: number) => {
    document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointermove', { movementX: dx * 0.55, movementY: dy * 0.55, buttons: 1, bubbles: true }))
  }
  return <TouchPad onMove={move} onLook={look} onButton={(id, pressed) => key(touchCodes[id]!, pressed)} buttons={[
    { id: 'jump', label: 'Jump' }, { id: 'sprint', label: 'Sprint' }, { id: 'crouch', label: 'Crouch' }, { id: 'ragdoll', label: 'Ragdoll' }, { id: 'view', label: 'View' }, { id: 'walk', label: 'Walk' },
  ]} />
}

function App() {
  const touch = useTouch()
  const audio = useMemo(() => createCheckpointAudio(touch ? 'phone' : 'desktop'), [touch])
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0.05)
  const [locked, setLocked] = useState(false)
  const [, setFirstPerson] = useState(false)
  useEffect(() => {
    let cancelled = false
    setReady(false)
    const audioReady = Promise.resolve().then(() => audio.prepare())
    void Promise.all([preloadAlsCharacterGltf(undefined, { onProgress: value => { if (!cancelled && value !== undefined) setProgress(0.05 + value * 0.85) } }).then(outfit), texturesReady(), audioReady]).then(() => { if (!cancelled) { setProgress(1); setReady(true) } })
    const onLock = () => setLocked(document.pointerLockElement !== null)
    document.addEventListener('pointerlockchange', onLock)
    return () => { cancelled = true; document.removeEventListener('pointerlockchange', onLock); audio.dispose() }
  }, [audio])
  return <Screen>
    <Canvas shadows dpr={internalPixelRatio()} camera={{ fov: 70, near: depthDefaults(autoQuality()).near, far: 600, position: [-4, 2, 0] }} gl={{ antialias: false, powerPreference: 'high-performance' }} onCreated={state => { state.gl.domElement.style.filter = 'none'; attachPerfProbe(state.gl) }}>
      {ready && <Scene onFirstPerson={setFirstPerson} audio={audio} />}
    </Canvas>
    <TitleCard title="ALS Web · Checkpoint" />
    <Hints visible={!touch} items={[['WASD', 'Move'], ['Shift', 'Sprint'], ['Space', 'Mantle'], ['V', 'View'], ['X', 'Ragdoll']]} />
    <Prompt text="Click to look around" visible={ready && !touch && !locked} />
    {touch && ready && <Touch />}
    <Loading title="Checkpoint" detail={progress < 0.9 ? 'Loading the character' : 'Laying the concrete'} progress={progress} done={ready} />
  </Screen>
}

createRoot(document.getElementById('root')!).render(<App />)
