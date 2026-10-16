import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { RootState } from '@react-three/fiber'
import { preloadAlsCharacterGltf } from 'als-ue5-r3f/app/AlsCharacterGltf'
import { autoQuality } from '@blacksite/look/quality'
import { createLoopbackRoom, createMatch, type Connection } from '@blacksite/relay'
import { createSubject, keySubject, lookSubject, REMOTE_INTERPOLATION_MS, SNAPSHOT_RATE_HZ, type MultiplayerReplica, type SubjectState } from '@blacksite/subject'
import { attachPerfProbe } from '@blacksite/ui/perf-overlay'
import { setAnisotropy, texturesReady } from '@blacksite/look/world'
import { Hints, Loading, Prompt, Screen, TitleCard, TouchPad } from '@blacksite/ui/hud'
import { buildArena, SPAWNS } from './arena'
import { ARMS_CHARACTER_URL, gunmetal, outfit, WEAPON_URLS } from './outfit'
import { PlayerView } from './view'
import { unlockAudio } from './audio'
import './arena.css'

const arena = buildArena()
const phone = matchMedia('(pointer: coarse)').matches || innerWidth < 700
const tier = autoQuality()
const spawnOf = (index: number) => [SPAWNS[index]!.position.x, 0, SPAWNS[index]!.position.z] as const

function Readout({ replicas }: { replicas: Array<MultiplayerReplica | null> }) {
  const [line, setLine] = useState({ players: 0, age: 0 })
  useEffect(() => {
    const timer = setInterval(() => {
      const replica = replicas.find(Boolean)
      if (!replica) return
      const now = Date.now()
      let age = 0
      for (const entry of replicas) {
        if (!entry) continue
        for (const state of entry.states.values()) if (state.id !== entry.id && state.health > 0) age = Math.max(age, now - state.t)
      }
      setLine({ players: replica.states.size, age: Math.min(age, 999) })
    }, 250)
    return () => clearInterval(timer)
  }, [replicas])
  return <div className="mp-readout" aria-label="Network">
    <span>Loopback room</span><span>{line.players} players</span><span>Server 60 Hz</span><span>Snapshots {SNAPSHOT_RATE_HZ} Hz</span><span>Age {String(line.age).padStart(2, '0')} ms</span><span>Interp {REMOTE_INTERPOLATION_MS} ms</span><span>Hits server-checked</span>
  </div>
}

const touchCodes: Record<string, string> = { jump: 'Space', crouch: 'ControlLeft', sprint: 'ShiftLeft', view: 'KeyV' }

function Touch({ subject }: { subject: SubjectState }) {
  useEffect(() => {
    subject.setVirtual(true)
    return () => subject.setVirtual(false)
  }, [subject])
  const move = (x: number, y: number) => {
    for (const [code, on] of [['KeyW', y < -0.3], ['KeyS', y > 0.3], ['KeyA', x < -0.3], ['KeyD', x > 0.3]] as const) if (on !== subject.keys.has(code)) keySubject(subject, code, on)
  }
  const look = (dx: number, dy: number) => lookSubject(subject, dx * 1.7, dy * 1.7)
  const button = (id: string, pressed: boolean) => {
    unlockAudio()
    if (id === 'fire') subject.input.fire = pressed
    else if (id === 'aim') { if (pressed) subject.input.aim = !subject.input.aim }
    else keySubject(subject, touchCodes[id]!, pressed)
  }
  return <TouchPad onMove={move} onLook={look} onButton={button} buttons={[
    { id: 'fire', label: 'Fire' }, { id: 'aim', label: 'Aim' }, { id: 'jump', label: 'Jump' }, { id: 'crouch', label: 'Crouch' }, { id: 'sprint', label: 'Sprint' }, { id: 'view', label: 'View' },
  ]} />
}

function App() {
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0.05)
  const [peers, setPeers] = useState<Connection[]>([])
  const [human, setHuman] = useState<number | null>(null)
  const [replicas, setReplicas] = useState<Array<MultiplayerReplica | null>>([null, null])
  const canvases = useRef<HTMLCanvasElement[]>([])
  const subjects = useMemo(() => [
    createSubject({ cameraMode: 'switchable', initialView: 'third-person', fov: phone ? 75 : 88, aimFov: phone ? 58 : 68, spawn: spawnOf(0), yaw: SPAWNS[0]!.yaw }),
    createSubject({ cameraMode: 'switchable', initialView: 'third-person', fov: 88, aimFov: 68, spawn: spawnOf(1), yaw: SPAWNS[1]!.yaw }),
  ], [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      preloadAlsCharacterGltf(undefined, { onProgress: value => { if (!cancelled && value !== undefined) setProgress(0.05 + value * 0.85) } }).then(outfit),
      preloadAlsCharacterGltf(ARMS_CHARACTER_URL()).then(outfit),
      ...WEAPON_URLS.map(url => preloadAlsCharacterGltf(new URL(url, location.href).href).then(gltf => gunmetal(gltf.scene))),
      texturesReady(),
    ]).then(() => { if (!cancelled) { setProgress(1); setReady(true) } })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!ready) return
    const room = createLoopbackRoom(createMatch({ spawns: SPAWNS, obstacles: arena.obstacles, respawnMs: 3000 }))
    let active = true
    let joined: Connection[] = []
    void Promise.all([room.connect(), room.connect()]).then(connections => {
      joined = connections
      if (active) setPeers(connections)
      else connections.forEach(connection => connection.close())
    })
    return () => { active = false; joined.forEach(connection => connection.close()) }
  }, [ready])

  useEffect(() => {
    const onLock = () => {
      const index = canvases.current.findIndex(canvas => canvas === document.pointerLockElement)
      setHuman(index >= 0 ? index : null)
      if (index >= 0) unlockAudio()
    }
    document.addEventListener('pointerlockchange', onLock)
    return () => document.removeEventListener('pointerlockchange', onLock)
  }, [])

  const created = useCallback((index: number) => (state: RootState) => {
    canvases.current[index] = state.gl.domElement
    setAnisotropy(state.gl)
    if (index === 0) attachPerfProbe(state.gl)
  }, [])
  const createdHandlers = useMemo(() => [created(0), created(1)], [created])
  const onReplica = useCallback((index: number, replica: MultiplayerReplica | null) => {
    setReplicas(previous => previous[index] === replica ? previous : previous.map((value, slot) => slot === index ? replica : value))
  }, [])

  const mode = (index: number) => phone ? (index === 0 ? 'touch' : 'hidden') : human === index ? 'human' : 'bot'
  return <Screen>
    <div className={`mp-split${phone ? ' mp-split--single' : ''}`}>
      {peers.map((peer, index) => <PlayerView key={peer.id} index={index} connection={peer} subject={subjects[index]!} level={arena} tier={tier} mode={mode(index)} listening={phone ? index === 0 : human === index} onCreated={createdHandlers[index]} onReplica={onReplica} />)}
    </div>
    <TitleCard title="Relay · Arena" />
    {ready && !phone && <Hints visible={human !== null} items={[['WASD', 'Move'], ['LMB', 'Fire'], ['RMB', 'Aim'], ['Space', 'Mantle'], ['V', 'View']]} />}
    <Prompt text="Click a side to play it · a bot plays the other" visible={ready && !phone && human === null} />
    {phone && ready && <div className="mp-note">You against a bot in one loopback room</div>}
    {phone && ready && peers.length > 0 && <Touch subject={subjects[0]!} />}
    {ready && <Readout replicas={replicas} />}
    <Loading title="Arena" detail={progress < 0.9 ? 'Loading the characters' : 'Opening the room'} progress={progress} done={ready && peers.length > 0} />
  </Screen>
}

createRoot(document.getElementById('root')!).render(<App />)
