import { useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useFrame } from '@react-three/fiber'
import { CuboidCollider, Physics, RigidBody } from '@react-three/rapier'
import { Character } from 'als-ue5-r3f/app/Character'
import { AlsCamera } from 'als-ue5-r3f/app/AlsCamera'
import { createCharacterPoseSample } from 'als-ue5-r3f/app/CharacterPoseSample'
import { createWorldTimeState } from 'als-ue5-r3f/engine/timeDilation'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { AlsFootstepAudioRuntime } from 'als-ue5-r3f/engine/alsAudioBridge'
import { ArmsViewmodel, createArmsState } from '@blacksite/subject-fpp/arms'
import { attachPerfProbe } from '@blacksite/ui/perf-overlay'
import type { AlsGamepadLookInput } from 'als-ue5-r3f/app/AlsCamera'
import './showcase.css'

const touchLook = { x: 0, y: 0 }
let framed = false
function readTouchLook(input: AlsGamepadLookInput) {
  const next = { yawDelta: input.yawDelta + touchLook.x * 0.16, pitchDelta: input.pitchDelta - touchLook.y * 0.16 - (framed ? 0 : 13) }
  framed = true
  touchLook.x = touchLook.y = 0
  return next
}
function Solid({ size, position, color, rotation = 0 }: { size: [number, number, number]; position: [number, number, number]; color: string; rotation?: number }) {
  return <RigidBody type="fixed" colliders={false} position={position} rotation={[0, rotation, 0]}>
    <CuboidCollider args={[size[0] / 2, size[1] / 2, size[2] / 2]} />
    <mesh castShadow receiveShadow><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={0.91} /></mesh>
  </RigidBody>
}
function Scene() {
  const pose = useMemo(() => ({ current: createCharacterPoseSample() }), [])
  const time = useMemo(createWorldTimeState, [])
  const audio = useMemo(() => new AlsFootstepAudioRuntime({ AutoInstallUserGestureUnlock: true }), [])
  const arms = useMemo(createArmsState, [])
  const [firstPerson, setFirstPerson] = useState(false)
  const previousView = useRef('ThirdPerson')
  const wasReady = useRef(false)
  useFrame(() => {
    const character = pose.current.character
    if (!character) return
    if (pose.current.ready && !wasReady.current) { wasReady.current = true; framed = false }
    if (character.viewMode !== previousView.current) {
      previousView.current = character.viewMode
      setFirstPerson(character.viewMode === 'FirstPerson')
    }
    arms.speed = Math.hypot(character.movement.velocity.x, character.movement.velocity.y)
    arms.sprinting = character.gait === 'Sprinting'
  }, ALS_FRAME_PRIORITY.Camera + 0.04)
  return <>
    <color attach="background" args={['#789999']} />
    <fog attach="fog" args={['#789999', 55, 105]} />
    <hemisphereLight args={['#dcebed', '#645642', 1.85]} />
    <directionalLight position={[-11, 22, -9]} intensity={3.1} color="#ffdd9f" castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-32} shadow-camera-right={32} shadow-camera-top={32} shadow-camera-bottom={-32} shadow-bias={-0.0002} />
    <Physics gravity={[0, -9.8, 0]} timeStep={1 / 60} updatePriority={ALS_FRAME_PRIORITY.Physics}>
      <Character onSizeChange={() => {}} poseSample={pose} worldTime={time} onOverlayModeBridgeChange={() => {}} footstepSoundSink={audio} toggleRotationModeKey={null} showDebugControls={false} />
      <AlsCamera poseSample={pose} worldTime={time} footstepAudioRuntime={audio} toggleViewModeKey="KeyV" modifyGamepadLook={readTouchLook} />
      <Solid size={[72, 0.25, 72]} position={[0, -0.15, 0]} color="#797e75" />
      <Solid size={[7, 0.6, 4]} position={[-10, 0.3, -4]} color="#d5cec0" />
      <Solid size={[7, 1.2, 4]} position={[-10, 0.9, -8]} color="#c6c1b5" />
      <Solid size={[6, 0.3, 4]} position={[0, 0.15, -10]} color="#ccbdac" />
      <Solid size={[6, 0.7, 4]} position={[0, 0.35, -14]} color="#bdb9ab" />
      <Solid size={[6, 1.1, 4]} position={[0, 0.55, -18]} color="#b3b3a6" />
      <RigidBody type="fixed" colliders={false} position={[10, 0.76, -8.6]} rotation={[-0.23, 0, 0]}><CuboidCollider args={[2.7, 0.13, 3.2]} /><mesh castShadow receiveShadow><boxGeometry args={[5.4, 0.26, 6.4]} /><meshStandardMaterial color="#b9a98f" roughness={0.88} /></mesh></RigidBody>
      <Solid size={[2.6, 1.6, 5]} position={[10, 0.8, -12]} color="#d0c6b5" />
      <Solid size={[5, 1.2, 0.5]} position={[9, 0.6, -3]} color="#c4bba9" />
      <Solid size={[5, 1.2, 0.5]} position={[16, 0.6, -3]} color="#c4bba9" />
      <Solid size={[0.5, 2.4, 31]} position={[-22, 1.2, -3]} color="#c7bb9f" />
      <Solid size={[0.5, 2.4, 31]} position={[22, 1.2, -3]} color="#c7bb9f" />
      <Solid size={[44, 7, 0.5]} position={[0, 3.5, -23]} color="#415f59" />
      <Solid size={[44, 2.4, 0.5]} position={[0, 1.2, 13]} color="#c7bb9f" />
      <Solid size={[1, 4, 1]} position={[-22, 2, -23]} color="#8f9a91" />
      <Solid size={[1, 4, 1]} position={[22, 2, -23]} color="#8f9a91" />
      <Solid size={[1, 4, 1]} position={[-22, 2, 13]} color="#8f9a91" />
      <Solid size={[1, 4, 1]} position={[22, 2, 13]} color="#8f9a91" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.025, 0]} receiveShadow><planeGeometry args={[72, 72]} /><meshStandardMaterial color="#9a9b8f" roughness={1} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 4]}><planeGeometry args={[2, 23]} /><meshStandardMaterial color="#c5aa77" roughness={1} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-10, 0.005, -2]}><planeGeometry args={[6, 0.12]} /><meshBasicMaterial color="#f2e7d1" /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[10, 0.005, -2]}><planeGeometry args={[6, 0.12]} /><meshBasicMaterial color="#f2e7d1" /></mesh>
      {[-14, -7, 0, 7, 14].map(x => <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.006, 8]}><planeGeometry args={[3, 0.09]} /><meshBasicMaterial color="#e4ded0" /></mesh>)}
      {[-19, 19].map(x => [-15, -5, 5].map(z => <group key={`${x}-${z}`} position={[x, 0, z]}><mesh castShadow position={[0, 0.32, 0]}><cylinderGeometry args={[0.75, 0.68, 0.64, 8]} /><meshStandardMaterial color="#646d62" roughness={1} /></mesh><mesh castShadow position={[0, 0.82, 0]}><icosahedronGeometry args={[0.83, 1]} /><meshStandardMaterial color="#657d65" roughness={1} /></mesh></group>))}
      {[-16, -8, 0, 8, 16].map(x => <group key={`wall-${x}`} position={[x, 0, -22.6]}><mesh castShadow position={[0, 5.7, 0.1]}><boxGeometry args={[0.38, 11.4, 0.55]} /><meshStandardMaterial color="#d0ba91" roughness={0.8} /></mesh><mesh position={[0, 4.6, 0.42]}><boxGeometry args={[5.4, 0.11, 0.09]} /><meshBasicMaterial color="#e4c77e" /></mesh></group>)}
      {[[-17, -15], [17, -15], [-17, -4], [17, -4]].map(([x, z], index) => <group key={`gate-${index}`} position={[x, 0, z]}><mesh castShadow position={[0, 2.1, 0]}><boxGeometry args={[0.18, 4.2, 0.18]} /><meshStandardMaterial color="#324b47" metalness={0.5} roughness={0.6} /></mesh><mesh castShadow position={[0, 4.15, 0]}><boxGeometry args={[2, 0.16, 0.45]} /><meshStandardMaterial color="#e6cd98" /></mesh></group>)}
      <group position={[-16, 0, -9]}><mesh castShadow position={[0, 1.6, 0]}><boxGeometry args={[0.2, 3.2, 0.2]} /><meshStandardMaterial color="#4d665f" metalness={0.4} roughness={0.6} /></mesh><mesh position={[0, 2.65, 0.04]}><boxGeometry args={[3.8, 1.15, 0.18]} /><meshStandardMaterial color="#263f3a" roughness={0.75} /></mesh><mesh position={[0, 2.65, 0.145]}><planeGeometry args={[3.5, 0.85]} /><meshBasicMaterial color="#e0c38f" /></mesh></group>
      {[[-6, -6], [6, -6], [-6, -20], [6, -20]].map(([x, z], index) => <group key={index} position={[x, 0, z]}><mesh castShadow position={[0, 1.25, 0]}><boxGeometry args={[0.12, 2.5, 0.12]} /><meshStandardMaterial color="#63776d" metalness={0.5} roughness={0.45} /></mesh><mesh castShadow position={[0, 2.48, 0]}><boxGeometry args={[1.2, 0.13, 0.5]} /><meshStandardMaterial color="#e5d0a3" roughness={0.5} /></mesh></group>)}
    </Physics>
    {firstPerson && <ArmsViewmodel state={arms} />}
  </>
}
function key(code: string, pressed: boolean) { window.dispatchEvent(new KeyboardEvent(pressed ? 'keydown' : 'keyup', { code, key: code, bubbles: true })) }
function Touch() {
  const stick = useRef<HTMLDivElement>(null)
  const look = useRef<HTMLDivElement>(null)
  const active = useRef(new Set<string>())
  const lastLook = useRef<[number, number] | null>(null)
  const update = (x: number, y: number) => {
    for (const [code, on] of [['KeyW', y < -0.24], ['KeyS', y > 0.24], ['KeyA', x < -0.24], ['KeyD', x > 0.24]] as const) {
      if (on !== active.current.has(code)) { key(code, on); if (on) active.current.add(code); else active.current.delete(code) }
    }
  }
  return <div className="movement-touch">
    <div ref={look} className="movement-look" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); lastLook.current = [e.clientX, e.clientY] }} onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId) || !lastLook.current) return; touchLook.x += e.clientX - lastLook.current[0]; touchLook.y += e.clientY - lastLook.current[1]; lastLook.current = [e.clientX, e.clientY] }} onPointerUp={() => { lastLook.current = null }} onPointerCancel={() => { lastLook.current = null }} />
    <div ref={stick} className="movement-stick" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); const r = e.currentTarget.getBoundingClientRect(); update((e.clientX - r.left - r.width / 2) / (r.width / 2), (e.clientY - r.top - r.height / 2) / (r.height / 2)) }} onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; const r = e.currentTarget.getBoundingClientRect(); update((e.clientX - r.left - r.width / 2) / (r.width / 2), (e.clientY - r.top - r.height / 2) / (r.height / 2)) }} onPointerUp={() => update(0, 0)} onPointerCancel={() => update(0, 0)}><i /></div>
    <div className="movement-buttons">{[['Space', 'Jump'], ['ControlLeft', 'Crouch'], ['ShiftLeft', 'Sprint / Roll'], ['KeyX', 'Ragdoll'], ['KeyV', 'View'], ['AltLeft', 'Walk / Run']].map(([code, label]) => <button key={code} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); key(code!, true) }} onPointerUp={() => key(code!, false)} onPointerCancel={() => key(code!, false)}>{label}</button>)}</div>
  </div>
}
function App() {
  const [dev, setDev] = useState(false)
  return <><Canvas shadows dpr={[1, 1.5]} camera={{ position: [8, 5, 11], fov: 60 }} onCreated={state => { state.gl.toneMappingExposure = 1.08; attachPerfProbe(state.gl) }}><Scene /></Canvas><div className="scene-ui"><div className="scene-heading"><span>BLACKSITE / MOVEMENT</span><h1>The Yard</h1><p>One character, every way through the space.</p></div><div className="scene-top"><button onClick={() => setDev(!dev)}>Dev</button></div><div className="scene-controls"><span>Click to look · WASD move · Alt walk/run · Shift sprint or tap roll · Ctrl crouch · Space jump/mantle · X ragdoll · V view</span></div>{dev && <div className="scene-dev"><strong>ALS CHARACTER</strong><span>Native movement and animation</span><span>Rapier collision · FPP / TPP</span></div>}</div><Touch /></>
}
createRoot(document.getElementById('root')!).render(<App />)
