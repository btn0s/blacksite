import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type RefObject } from 'react'
import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CuboidCollider, CylinderCollider, Physics, RigidBody } from '@react-three/rapier'
import { preloadAlsCharacterGltf } from 'als-ue5-r3f/app/AlsCharacterGltf'
import type { AlsRagdollHandle } from 'als-ue5-r3f/app/AlsRemoteActor'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { Look } from '@blacksite/look/r3f'
import { QUALITY, autoQuality } from '@blacksite/look/quality'
import { ZONE } from '@blacksite/look/presets'
import type { Atmosphere } from '@blacksite/look'
import { createWardenSession, type WardenConfig } from '@blacksite/warden-react'
import type { AgentView, RenderSnapshot, TeamId, Vec3 } from '@blacksite/warden'
import { attachPerfProbe } from '@blacksite/ui/perf-overlay'
import { internalPixelRatio, setAnisotropy, texturesReady } from '@blacksite/look/world'
import { Actions, Hints, Loading, Screen, Status, TitleCard, useTouch } from '@blacksite/ui/hud'
import { buildCompound } from './level'
import { compoundWorld } from './compound'
import { SquadFeed } from './feed'
import { CameraRig } from './camera'
import { Gunfire, ShotFx } from './fx'
import { IntelLayer, TEAM_COLOR, TEAM_NAME } from './intel'
import { Soldiers, corpseOf, lod } from './soldiers'
import './squad.css'

type Intel = TeamId | 'off'
type Roster = Array<{ id: string; team: TeamId }>

const quality = autoQuality()
const atmosphere: Atmosphere = { ...ZONE, exposure: 1.22, fog: { color: ZONE.fog.color, near: 34, far: 230 } }
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
const perTeam = coarse ? 4 : 5
const level = buildCompound()
const feed = new SquadFeed()
const handles = new Map<string, RefObject<AlsRagdollHandle | null>>()
const gunfire = new Gunfire()
const configFor = (seed: number): WardenConfig => ({ seed, agentsPerTeam: perTeam, maxTicks: 1800, scenarioId: 'crossfire' })
const MANEUVER: Record<string, string> = { move: 'Advance', bound: 'Bounding', crossfire: 'Crossfire', clear: 'Clearing', fallback: 'Falling back', suppress: 'Suppressing', flank: 'Flanking', breach: 'Breaching', revive: 'Casualty', search: 'Searching', hold: 'Holding' }

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

type LookHandle = Parameters<NonNullable<ComponentProps<typeof Look>['onReady']>>[0]

function opaqueAo(look: LookHandle) {
  for (const pass of look?.composer.passes ?? []) if ('configuration' in pass) (pass as { configuration: { transparencyAware: boolean } }).configuration.transparencyAware = false
}

function Lights() {
  const gl = useThree(state => state.gl)
  const sun = useMemo(() => {
    const light = new THREE.DirectionalLight()
    light.castShadow = true
    light.shadow.mapSize.setScalar(quality === 'low' ? 1024 : 2048)
    light.shadow.bias = -0.0004
    light.shadow.normalBias = 0.06
    Object.assign(light.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 120 })
    return light
  }, [])
  const fill = useMemo(() => new THREE.HemisphereLight(), [])
  useEffect(() => {
    setAnisotropy(gl)
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
  }, [gl])
  const frame = useRef(0)
  useFrame(() => { if (++frame.current % 2 === 0) gl.shadowMap.needsUpdate = true }, 0.9)
  return <>
    <primitive object={sun} />
    <primitive object={sun.target} />
    <primitive object={fill} />
    <Look atmosphere={atmosphere} quality={quality} environment sun={sun} fill={fill} onReady={opaqueAo} />
  </>
}

type Pick = { id: string; team: TeamId } | null

function alive(snapshot: RenderSnapshot | undefined, team?: TeamId) {
  return snapshot ? snapshot.agents.filter(agent => agent.alive && (!team || agent.team === team)) : []
}

function Director({ intel, layer, focus, setFocus, freeze }: { intel: Intel; layer: HTMLDivElement; focus: Pick; setFocus: (pick: Pick) => void; freeze: (id: string, frozen: boolean) => void }) {
  const gl = useThree(state => state.gl)
  const camera = useThree(state => state.camera) as THREE.PerspectiveCamera
  const size = useThree(state => state.size)
  const scene = useThree(state => state.scene)
  const fx = useMemo(() => new ShotFx(), [])
  const overlay = useMemo(() => new IntelLayer(layer), [layer])
  const rig = useMemo(() => new CameraRig(gl.domElement), [gl])
  const positions = useMemo(() => new Map<string, Vec3>(), [])
  const down = useRef(new Set<string>())
  const hits = useRef(new Map<string, THREE.Vector3>())
  const round = useRef(feed.round)
  const lost = useRef<number | null>(null)
  const rounds = useRef(new Map<string, number>())
  const action = useMemo(() => new THREE.Vector3(), [])
  const subject = useMemo(() => ({ position: new THREE.Vector3(), yaw: 0 }), [])
  const listener = useMemo(() => new THREE.Vector3(), [])
  const projected = useMemo(() => new THREE.Vector3(), [])
  const frustum = useMemo(() => new THREE.Frustum(), [])
  const viewProjection = useMemo(() => new THREE.Matrix4(), [])
  const sphere = useMemo(() => new THREE.Sphere(new THREE.Vector3(), 1.3), [])
  const corpses = useMemo(() => new THREE.Group(), [])
  const bodies = useRef(new Map<string, THREE.Object3D>())
  const settled = useRef(new Map<string, number>())
  const latest = useRef({ focus, intel, setFocus, freeze })
  latest.current = { focus, intel, setFocus, freeze }

  useEffect(() => {
    scene.add(fx.group, overlay.group, corpses)
    return () => { scene.remove(fx.group, overlay.group, corpses); fx.dispose(); overlay.dispose() }
  }, [scene, fx, overlay, corpses])
  useEffect(() => () => rig.dispose(), [rig])
  useEffect(() => { overlay.visible = intel !== 'off' }, [overlay, intel])
  useEffect(() => { if (focus) rig.follow(); else rig.tactical() }, [rig, focus])

  useEffect(() => {
    rig.onTap = (x, y) => {
      const frame = feed.at(feed.renderTime())
      if (!frame) return
      const bounds = gl.domElement.getBoundingClientRect()
      let best: Pick = null
      let bestDistance = coarse ? 56 : 40
      for (const agent of frame.b.snapshot.agents) {
        if (!agent.alive) continue
        const at = positions.get(agent.id) ?? agent.position
        projected.set(at.x, at.y + 1.1, at.z).project(camera)
        if (projected.z > 1) continue
        const sx = bounds.left + (projected.x * 0.5 + 0.5) * bounds.width
        const sy = bounds.top + (-projected.y * 0.5 + 0.5) * bounds.height
        const distance = Math.hypot(sx - x, sy - y)
        if (distance < bestDistance) { bestDistance = distance; best = { id: agent.id, team: agent.team } }
      }
      if (best) latest.current.setFocus(best)
    }
  }, [rig, gl, camera, positions, projected])

  useFrame((_, dt) => {
    const now = feed.renderTime()
    if (feed.round !== round.current) {
      round.current = feed.round
      down.current.clear()
      hits.current.clear()
      settled.current.clear()
      bodies.current.clear()
      corpses.clear()
      fx.clear()
      overlay.clear()
    }
    feed.drain(now, event => {
      if (event.type === 'shot' && event.position && event.endPosition) {
        const fired = (rounds.current.get(event.agentId ?? '') ?? 0) + 1
        rounds.current.set(event.agentId ?? '', fired)
        fx.shot(event.position, event.endPosition, performance.now() - Math.max(0, now - event.at), fired % 3 === 1)
        gunfire.shot(event.position, false)
      } else if (event.type === 'kill' && event.position) {
        const victim = event.text.split(' ').pop()!
        const shooter = feed.snapshot?.agents.find(agent => agent.id === event.agentId)
        const push = new THREE.Vector3(event.position.x - (shooter?.position.x ?? event.position.x), 0, event.position.z - (shooter?.position.z ?? event.position.z))
        if (push.lengthSq() < 1e-4) push.set(0, 0, 1)
        hits.current.set(victim, push.normalize())
      }
    })
    fx.update(performance.now())
    const frame = feed.at(now)
    if (!frame) return
    const snapshot = frame.b.snapshot
    for (const agent of snapshot.agents) {
      let at = positions.get(agent.id)
      if (!at) { at = { x: 0, y: 0, z: 0 }; positions.set(agent.id, at) }
      feed.position(agent.id, now, at)
      const live = frame.a.index.get(agent.id)?.alive ?? agent.alive
      const body = bodies.current.get(agent.id)
      if (body) {
        if (!live) continue
        corpses.remove(body)
        bodies.current.delete(agent.id)
        down.current.delete(agent.id)
        latest.current.freeze(agent.id, false)
        continue
      }
      const handle = handles.get(agent.id)?.current
      if (!handle) continue
      const isDown = down.current.has(agent.id)
      if (isDown && !live) {
        const time = performance.now()
        if (handle.active && handle.pelvis.velocity.lengthSq() < 0.04) {
          const since = settled.current.get(agent.id) ?? time
          settled.current.set(agent.id, since)
          if (time - since > 1200) {
            const corpse = corpseOf(agent.id)
            if (corpse) {
              corpses.add(corpse)
              bodies.current.set(agent.id, corpse)
              settled.current.delete(agent.id)
              latest.current.freeze(agent.id, true)
            }
          }
        } else settled.current.delete(agent.id)
      }
      if (!live && !isDown) {
        const push = hits.current.get(agent.id) ?? new THREE.Vector3(0, 0, 1)
        if (handle.StartRagdolling({ initialImpulse: { boneName: 'spine_03', impulse: { x: push.x * 38, y: 6, z: push.z * 38 } } })) down.current.add(agent.id)
      } else if (live && isDown) {
        handle.StopRagdolling()
        down.current.delete(agent.id)
      }
    }
    const living = alive(snapshot)
    action.set(0, 0, 0)
    for (const agent of living) { const at = positions.get(agent.id)!; action.x += at.x; action.z += at.z }
    if (living.length) action.divideScalar(living.length)
    action.multiplyScalar(0.7)
    const { focus: pick, intel: side, setFocus: choose } = latest.current
    let followed: AgentView | undefined
    if (pick) followed = snapshot.agents.find(agent => agent.id === pick.id)
    if (followed && !followed.alive) {
      const time = performance.now()
      lost.current ??= time
      if (time - lost.current > 1800) {
        lost.current = null
        const mate = alive(snapshot, followed.team)[0] ?? alive(snapshot)[0]
        choose(mate ? { id: mate.id, team: mate.team } : null)
      }
    } else lost.current = null
    if (followed) {
      const at = positions.get(followed.id)!
      const ragdoll = handles.get(followed.id)?.current
      if (ragdoll?.active) subject.position.set(ragdoll.pelvis.position.x, 0, ragdoll.pelvis.position.z)
      else if (!bodies.current.has(followed.id)) subject.position.set(at.x, at.y, at.z)
      subject.yaw = followed.yaw
    }
    rig.update(camera, Math.min(dt, 0.1), action, followed ? subject : null)
    camera.updateMatrixWorld()
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    for (const agent of snapshot.agents) {
      const at = positions.get(agent.id)!
      sphere.center.set(at.x, at.y + 0.9, at.z)
      const distance = camera.position.distanceTo(sphere.center)
      lod.set(agent.id, {
        distance, visible: frustum.intersectsSphere(sphere), focused: agent.id === followed?.id,
        minInterval: coarse ? 2 : 1, maxInterval: down.current.has(agent.id) ? 2 : 8,
      })
    }
    listener.copy(rig.mode === 'follow' ? camera.position : rig.target)
    if (rig.mode !== 'follow') listener.y = 9
    gunfire.hear(listener)
    if (side !== 'off') overlay.update(snapshot, positions, followed?.team ?? side, followed?.id, camera, size.width, size.height)
  }, 0.5)
  return null
}

function Scene({ intel, layer, focus, setFocus, roster }: { intel: Intel; layer: HTMLDivElement; focus: Pick; setFocus: (pick: Pick) => void; roster: Roster }) {
  const [frozen, setFrozen] = useState<ReadonlySet<string>>(() => new Set())
  const freeze = useCallback((id: string, on: boolean) => setFrozen(previous => {
    if (previous.has(id) === on) return previous
    const next = new Set(previous)
    if (on) next.add(id)
    else next.delete(id)
    return next
  }), [])
  useEffect(() => setFrozen(new Set()), [roster])
  return <>
    <Lights />
    <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60} updatePriority={ALS_FRAME_PRIORITY.Physics}>
      <Level />
      <Soldiers roster={roster} frozen={frozen} feed={feed} handles={handles} />
    </Physics>
    <Director intel={intel} layer={layer} focus={focus} setFocus={setFocus} freeze={freeze} />
  </>
}

function Readout({ snapshot, side }: { snapshot: RenderSnapshot | undefined; side: Intel }) {
  if (!snapshot) return null
  const count = (team: TeamId) => alive(snapshot, team).length
  const squad = side === 'off' ? undefined : snapshot.squads.find(plan => plan.team === side)
  const style = (team: TeamId) => ({ color: `#${TEAM_COLOR[team].getHexString()}` })
  return <div className="squad-readout">
    <div className="squad-readout__score"><span style={style('alpha')}>{TEAM_NAME.alpha} {count('alpha')}</span><em>vs</em><span style={style('bravo')}>{count('bravo')} {TEAM_NAME.bravo}</span></div>
    {squad && <div className="squad-readout__plan" style={style(squad.team)}>{TEAM_NAME[squad.team]} · {MANEUVER[squad.kind] ?? squad.kind}</div>}
  </div>
}

function Legend({ visible }: { visible: boolean }) {
  if (!visible) return null
  return <div className="squad-legend">
    <span><i className="squad-legend__ring" />Soldier</span>
    <span><i className="squad-legend__cover" />Chosen cover</span>
    <span><i className="squad-legend__path" />Intended path</span>
    <span><i className="squad-legend__belief" />Believed enemy</span>
  </div>
}

function App() {
  const touch = useTouch()
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0.05)
  const [roster, setRoster] = useState<Roster>([])
  const [intel, setIntel] = useState<Intel>('alpha')
  const [focus, setFocus] = useState<Pick>(null)
  const [snapshot, setSnapshot] = useState<RenderSnapshot>()
  const [result, setResult] = useState<string | null>(null)
  const [layer, setLayer] = useState<HTMLDivElement | null>(null)
  const session = useMemo(() => createWardenSession({ detail: 'render' }), [])
  const controls = useRef({ next: () => {} })

  useEffect(() => {
    let cancelled = false
    void Promise.all([preloadAlsCharacterGltf(undefined, { onProgress: value => { if (!cancelled && value !== undefined) setProgress(0.05 + value * 0.8) } }), texturesReady()]).then(() => { if (!cancelled) { setProgress(0.92); setReady(true) } })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!ready) return
    let seed = 1 + Math.floor(Math.random() * 90000)
    let round = -1
    let ending: ReturnType<typeof setTimeout> | undefined
    let shown = 0
    const world = compoundWorld(perTeam)
    const next = () => {
      clearTimeout(ending)
      ending = undefined
      seed += 1
      setResult(null)
      session.reset(configFor(seed))
    }
    controls.current.next = next
    const unsubscribe = session.subscribe(() => {
      const state = session.getSnapshot()
      if (!state.snapshot) return
      feed.push(state.snapshot, state.map)
      if (feed.round !== round) {
        round = feed.round
        setRoster(state.snapshot.agents.map(agent => ({ id: agent.id, team: agent.team })))
        setFocus(null)
      }
      if (state.status === 'paused' && state.snapshot.status === 'running') session.play(1)
      const time = performance.now()
      if (time - shown > 250) { shown = time; setSnapshot(state.snapshot) }
      if (state.status === 'complete' && !ending) {
        const winner = state.snapshot.winner
        const relay = state.snapshot.objective.progress >= 1
        setResult(winner === 'draw' || !winner ? 'Stalemate' : relay ? `${TEAM_NAME[winner]} took the relay` : `${TEAM_NAME[winner]} held the yard`)
        ending = setTimeout(next, 4500)
      }
    })
    session.connect(configFor(seed), world)
    return () => { clearTimeout(ending); unsubscribe(); session.disconnect() }
  }, [ready, session])

  useEffect(() => {
    const unlock = () => gunfire.unlock()
    const key = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey) return
      if (event.code === 'KeyI') setIntel(value => value === 'alpha' ? 'bravo' : value === 'bravo' ? 'off' : 'alpha')
      else if (event.code === 'KeyR') controls.current.next()
      else if (event.code === 'KeyT' || event.code === 'Escape') setFocus(null)
      else if (event.code === 'KeyF') setFocus(current => {
        const list = alive(feed.snapshot)
        if (!list.length) return null
        const index = current ? list.findIndex(agent => agent.id === current.id) : -1
        const agent = list[(index + 1) % list.length]!
        return { id: agent.id, team: agent.team }
      })
    }
    addEventListener('pointerdown', unlock)
    addEventListener('keydown', unlock)
    addEventListener('keydown', key)
    return () => { removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); removeEventListener('keydown', key) }
  }, [])

  const started = ready && roster.length > 0
  const follow = () => setFocus(current => {
    if (current) return null
    const agent = alive(feed.snapshot, intel === 'off' ? 'alpha' : intel)[0] ?? alive(feed.snapshot)[0]
    return agent ? { id: agent.id, team: agent.team } : null
  })
  const followed = focus && snapshot?.agents.find(agent => agent.id === focus.id)

  return <Screen>
    <Canvas shadows dpr={Math.min(internalPixelRatio(), QUALITY[quality].maxPixelRatio)} camera={{ fov: 50, near: 0.1, far: 500, position: [-24, 26, 30] }} gl={{ antialias: false, powerPreference: 'high-performance' }} style={{ touchAction: 'none' }} onCreated={state => attachPerfProbe(state.gl)}>
      {ready && layer && <Scene intel={intel} layer={layer} focus={focus} setFocus={setFocus} roster={roster} />}
    </Canvas>
    <div className="squad-layer" ref={setLayer} />
    <TitleCard title="Warden · Squad" />
    {started && <Readout snapshot={snapshot} side={followed ? followed.team : intel} />}
    {started && followed && <div className="squad-follow" style={{ color: `#${TEAM_COLOR[followed.team].getHexString()}` }}>{followed.callsign} · {followed.role}</div>}
    <Legend visible={started && intel !== 'off'} />
    <Hints visible={!touch && started} items={[['Drag', 'Orbit'], ['Scroll', 'Zoom'], ['Click', 'Follow'], ['I', 'Intel'], ['R', 'New round']]} />
    {result && <Status label="Round over" value={result} />}
    {touch && started && <Actions items={[
      { id: 'follow', label: focus ? 'Tactical' : 'Follow', onPress: follow },
      { id: 'intel', label: intel === 'off' ? 'Intel off' : `Intel ${TEAM_NAME[intel]}`, onPress: () => setIntel(value => value === 'alpha' ? 'bravo' : value === 'bravo' ? 'off' : 'alpha') },
    ]} />}
    <Loading title="Squad" detail={progress < 0.85 ? 'Loading the soldiers' : 'Briefing the squads'} progress={progress} done={started} />
  </Screen>
}

createRoot(document.getElementById('root')!).render(<App />)
