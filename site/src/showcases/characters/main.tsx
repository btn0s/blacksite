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
import { AlsFootstepAudioRuntime } from 'als-ue5-r3f/engine/alsAudioBridge'
import { ArmsViewmodel, createArmsState } from '@blacksite/subject-fpp/arms'
import { attachPerfProbe } from '@blacksite/ui/perf-overlay'
import { createAtmosphere, internalPixelRatio, texturesReady } from '../../look/look'
import { Hints, Loading, Prompt, Screen, TitleCard, TouchPad, useTouch } from '../../look/hud'
import { buildCheckpoint } from './checkpoint'
import { outfit } from './outfit'

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

function Scene({ onFirstPerson }: { onFirstPerson: (value: boolean) => void }) {
  const pose = useMemo(() => ({ current: createCharacterPoseSample() }), [])
  const time = useMemo(createWorldTimeState, [])
  const audio = useMemo(() => new AlsFootstepAudioRuntime({ AutoInstallUserGestureUnlock: true }), [])
  const arms = useMemo(createArmsState, [])
  const [firstPerson, setFirstPerson] = useState(false)
  const view = useRef('ThirdPerson')
  useFrame(() => {
    const character = pose.current.character
    if (!character) return
    if (character.viewMode !== view.current) {
      view.current = character.viewMode
      setFirstPerson(character.viewMode === 'FirstPerson')
      onFirstPerson(character.viewMode === 'FirstPerson')
    }
    arms.speed = Math.hypot(character.movement.velocity.x, character.movement.velocity.y)
    arms.sprinting = character.gait === 'Sprinting'
  }, ALS_FRAME_PRIORITY.Camera + 0.04)
  return <>
    <Atmosphere />
    <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60} updatePriority={ALS_FRAME_PRIORITY.Physics}>
      <Character onSizeChange={() => {}} poseSample={pose} worldTime={time} onOverlayModeBridgeChange={() => {}} footstepSoundSink={audio} toggleRotationModeKey={null} showDebugControls={false} initialPosition={level.spawn} />
      <AlsCamera poseSample={pose} worldTime={time} footstepAudioRuntime={audio} toggleViewModeKey="KeyV" />
      <Level />
    </Physics>
    {firstPerson && <ArmsViewmodel state={arms} />}
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
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0.05)
  const [locked, setLocked] = useState(false)
  const [, setFirstPerson] = useState(false)
  useEffect(() => {
    let cancelled = false
    void Promise.all([preloadAlsCharacterGltf(undefined, { onProgress: value => { if (!cancelled && value !== undefined) setProgress(0.05 + value * 0.85) } }).then(outfit), texturesReady()]).then(() => { if (!cancelled) { setProgress(1); setReady(true) } })
    const onLock = () => setLocked(document.pointerLockElement !== null)
    document.addEventListener('pointerlockchange', onLock)
    return () => { cancelled = true; document.removeEventListener('pointerlockchange', onLock) }
  }, [])
  return <Screen>
    <Canvas shadows dpr={internalPixelRatio()} camera={{ fov: 70, near: 0.05, far: 600, position: [-4, 2, 0] }} gl={{ antialias: true, powerPreference: 'high-performance' }} onCreated={state => attachPerfProbe(state.gl)}>
      {ready && <Scene onFirstPerson={setFirstPerson} />}
    </Canvas>
    <TitleCard kicker="Characters · ALS Web" title="Checkpoint" line="One body, every way through the ruins." />
    <Hints visible={!touch} items={[['WASD', 'Move'], ['Shift', 'Sprint · tap to roll'], ['Space', 'Jump · mantle'], ['Ctrl', 'Crouch'], ['Alt', 'Walk'], ['X', 'Ragdoll'], ['V', 'View'], ['RMB', 'Aim']]} />
    <Prompt text="Click to look around" visible={ready && !touch && !locked} />
    {touch && ready && <Touch />}
    <Loading title="Checkpoint" detail={progress < 0.9 ? 'Loading the character' : 'Laying the concrete'} progress={progress} done={ready} />
  </Screen>
}

createRoot(document.getElementById('root')!).render(<App />)
