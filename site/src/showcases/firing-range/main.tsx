import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { RenderPass } from 'postprocessing'
import { Look } from '@blacksite/look/r3f'
import { autoQuality, type Look as LookHandle, type QualityTier } from '@blacksite/look'
import { ALS_WEAPONS, createWeaponRuntime, type QueryHit, type WeaponEvent } from '@blacksite/armory'
import { StandaloneSubject, createStandaloneRecoil, createStandaloneTouch, type StandaloneIntent } from '@blacksite/subject-fpp'
import { ArmsViewmodel, createArmsState, portraitFov, type ArmsPresentation } from '@blacksite/subject-fpp/arms'
import { preloadAlsCharacterGltf } from 'als-ue5-r3f/app/AlsCharacterGltf'
import { attachPerfProbe } from '@blacksite/ui/perf-overlay'
import { internalPixelRatio, texturesReady } from '../../look/look'
import { Hints, Loading, Prompt, Screen, Status, TitleCard, TouchPad, useTouch } from '../../look/hud'
import { createRangeAudio } from './audio'
import { formatTime, drill, useDrill } from './drill'
import { createEffects } from './effects'
import { castRay } from './hits'
import { rangeTexturesReady } from './materials'
import { BOUNDS, buildRange } from './range'
import { buildSteel } from './targets'
import './firing-range.css'

type WeaponId = 'rifle' | 'pistol'

const range = buildRange()
const steelSet = buildSteel()
const solids = [...range.solids, ...steelSet.solids]
const solidById = new Map(solids.map(solid => [solid.id, solid]))
const steelById = new Map(steelSet.steel.map(target => [target.id, target]))
const paperById = new Map(range.papers.map(paper => [paper.id, paper]))
const definitions = ALS_WEAPONS.filter(definition => definition.id !== 'bow').map(definition => ({ ...definition, initialReserve: 99990 }))
const reloadSeconds = Object.fromEntries(definitions.map(definition => [definition.id, definition.reloadSeconds])) as Record<WeaponId, number>
const audio = createRangeAudio()
const touchInput = createStandaloneTouch()
const commands = { reload: false, swap: false, aim: false }
const eye = 1.63

drill.set({ cleared: steelSet.steel.map(() => false) })

function ArmsPass({ look, presentation }: { look: LookHandle | null; presentation: ArmsPresentation | null }) {
  useEffect(() => {
    if (!look || !presentation) return
    const pass = new RenderPass(presentation.scene, presentation.camera)
    pass.clearPass.color = false
    pass.clearPass.depth = true
    pass.ignoreBackground = true
    look.composer.addPass(pass, 2)
    return () => { look.composer.removePass(pass); pass.dispose() }
  }, [look, presentation])
  return null
}

function Scene({ tier, onReady }: { tier: QualityTier; onReady: () => void }) {
  const camera = useThree(state => state.camera) as THREE.PerspectiveCamera
  const gl = useThree(state => state.gl)
  const scene = useThree(state => state.scene)
  const arms = useMemo(createArmsState, [])
  const recoil = useMemo(createStandaloneRecoil, [])
  const effects = useMemo(() => createEffects(scene), [scene])
  const weapon = useMemo(() => createWeaponRuntime({ ownerId: 'player', seed: 7, definitions, initialWeaponId: 'rifle' }), [])
  const [look, setLook] = useState<LookHandle | null>(null)
  const [presentation, setPresentation] = useState<ArmsPresentation | null>(null)
  const shadows = tier !== 'low'
  const lights = useMemo(() => {
    const sun = new THREE.DirectionalLight()
    sun.target.position.set(-2, 0, -16)
    sun.castShadow = shadows
    sun.shadow.mapSize.setScalar(tier === 'high' ? 2048 : 1024)
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.03
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 110 })
    sun.shadow.camera.updateProjectionMatrix()
    const fill = new THREE.HemisphereLight()
    const flash = new THREE.PointLight('#ffb36a', 0, 9, 2)
    return { sun, fill, flash }
  }, [shadows, tier])
  const control = useRef({
    firing: false, reload: false, weapon: 'rifle' as WeaponId, sprint: false, aimHeld: false, accumulated: 0,
    position: new THREE.Vector3(0, eye, 0.4), aim: { origin: new THREE.Vector3(), direction: new THREE.Vector3(0, 0, -1) },
    flash: 0, shotCount: 0, phaseTimer: 0, startedAt: 0, clock: 0, lastTimeSent: 0, speed: 0, moving: false,
  })
  const scratch = useMemo(() => ({ right: new THREE.Vector3(), forward: new THREE.Vector3(), muzzle: new THREE.Vector3(), local: new THREE.Vector3(), from: new THREE.Vector3(), along: new THREE.Vector3() }), [])

  useEffect(() => { if (presentation) onReady() }, [presentation, onReady])

  useEffect(() => {
    const canvas = gl.domElement
    const doc = canvas.ownerDocument
    const active = () => doc.pointerLockElement === canvas
    const select = (next: WeaponId) => { control.current.weapon = next }
    const down = (event: KeyboardEvent) => {
      audio.start()
      if (!active()) return
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') control.current.sprint = true
      if (event.code === 'Digit1') select('rifle')
      if (event.code === 'Digit2') select('pistol')
      if (event.code === 'KeyQ' && !event.repeat) select(control.current.weapon === 'rifle' ? 'pistol' : 'rifle')
    }
    const up = (event: KeyboardEvent) => { if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') control.current.sprint = false }
    const mouseDown = (event: MouseEvent) => { audio.start(); if (event.button === 2 && active()) control.current.aimHeld = true }
    const mouseUp = (event: MouseEvent) => { if (event.button === 2) control.current.aimHeld = false }
    const wheel = (event: WheelEvent) => { if (active() && Math.abs(event.deltaY) > 4) select(control.current.weapon === 'rifle' ? 'pistol' : 'rifle') }
    const lockChange = () => {
      const locked = active()
      drill.set({ locked })
      if (!locked) { control.current.aimHeld = false; control.current.sprint = false }
    }
    const context = (event: MouseEvent) => event.preventDefault()
    const touchStart = () => audio.start()
    doc.addEventListener('keydown', down)
    doc.addEventListener('keyup', up)
    doc.addEventListener('mousedown', mouseDown)
    doc.addEventListener('mouseup', mouseUp)
    doc.addEventListener('wheel', wheel, { passive: true })
    doc.addEventListener('pointerlockchange', lockChange)
    doc.addEventListener('touchstart', touchStart, { passive: true })
    canvas.addEventListener('contextmenu', context)
    return () => {
      doc.removeEventListener('keydown', down); doc.removeEventListener('keyup', up); doc.removeEventListener('mousedown', mouseDown); doc.removeEventListener('mouseup', mouseUp)
      doc.removeEventListener('wheel', wheel); doc.removeEventListener('pointerlockchange', lockChange); doc.removeEventListener('touchstart', touchStart); canvas.removeEventListener('contextmenu', context)
    }
  }, [gl])

  const queries = useMemo(() => ({
    castRay(query: { origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number }; maxDistance: number }): QueryHit | null {
      scratch.from.set(query.origin.x, query.origin.y, query.origin.z)
      scratch.along.set(query.direction.x, query.direction.y, query.direction.z).normalize()
      const hit = castRay(solids, scratch.from, scratch.along, query.maxDistance)
      if (!hit) return null
      return { colliderId: hit.solid.id, ...(hit.solid.targetId ? { targetId: hit.solid.targetId } : {}), point: { x: hit.point.x, y: hit.point.y, z: hit.point.z }, normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z }, distance: hit.distance }
    },
    sweepSphere: () => null,
  }), [scratch])

  const finish = (state: typeof control.current) => {
    const view = drill.get()
    const time = state.clock - state.startedAt
    drill.set({ phase: 'done', time, best: view.best === null ? time : Math.min(view.best, time) })
    state.phaseTimer = 3.4
  }

  const handle = (event: WeaponEvent) => {
    const state = control.current
    if (event.type === 'switch-started') { arms.weapon = event.weaponId as WeaponId; arms.equipSequence++; audio.equip(); return }
    if (event.type === 'reload-started') { arms.reloadSequence++; audio.reload(event.weaponId as WeaponId, reloadSeconds[event.weaponId as WeaponId]); return }
    if (event.type === 'trigger-blocked' && event.reason === 'empty') { audio.dry(); state.reload = true; return }
    if (event.type === 'shot') {
      const pistol = event.weaponId === 'pistol'
      arms.fireSequence++
      const kick = (pistol ? 1.7 : 2.1) * (arms.aiming ? 0.7 : 1)
      recoil.pitch += event.recoil.pitch * kick
      recoil.yaw += event.recoil.yaw * kick * 1.6
      audio.shot(pistol ? 'pistol' : 'rifle')
      effects.eject(camera, pistol)
      state.flash = 0.05
      state.shotCount++
      scratch.right.set(1, 0, 0).applyQuaternion(camera.quaternion)
      scratch.forward.set(0, 0, -1).applyQuaternion(camera.quaternion)
      scratch.muzzle.copy(camera.position).addScaledVector(scratch.forward, 0.7).addScaledVector(scratch.right, arms.aiming ? 0 : 0.11).add(new THREE.Vector3(0, arms.aiming ? -0.05 : -0.09, 0))
      lights.flash.position.copy(scratch.muzzle)
      if (!pistol && state.shotCount % 3 === 0) effects.tracer(scratch.muzzle, new THREE.Vector3(event.end.x, event.end.y, event.end.z))
      const view = drill.get()
      if (view.phase === 'ready') {
        for (const target of steelSet.steel) target.cleared = false
        state.startedAt = state.clock
        drill.set({ phase: 'running', time: 0, score: 0, shots: 1, hits: 0, cleared: steelSet.steel.map(() => false) })
      } else if (view.phase === 'running') drill.set({ shots: view.shots + 1 })
      return
    }
    if (event.type !== 'impact') return
    const hit = event.hit
    const solid = solidById.get(hit.colliderId)
    if (!solid) return
    const point = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z)
    const normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z)
    const strength = event.weaponId === 'pistol' ? 1 : 0.8
    effects.impact(solid.surface, point, normal, strength)
    const distance = point.distanceTo(camera.position)
    scratch.right.set(1, 0, 0).applyQuaternion(camera.quaternion)
    const pan = THREE.MathUtils.clamp(scratch.local.subVectors(point, camera.position).normalize().dot(scratch.right), -0.8, 0.8)
    const view = drill.get()
    const counting = view.phase === 'running'
    const steel = hit.targetId ? steelById.get(hit.targetId) : undefined
    if (steel) {
      steel.hit(steel.plate.worldToLocal(point.clone()), strength)
      audio.steel(steel.pitch, strength, distance, pan)
      drill.set({ marker: view.marker + 1 })
      if (counting) {
        const fresh = !steel.cleared
        steel.cleared = true
        drill.set({ hits: view.hits + 1, score: view.score + (fresh ? steel.points : 2), cleared: steelSet.steel.map(target => target.cleared) })
        if (steelSet.steel.every(target => target.cleared)) finish(state)
      }
      return
    }
    audio.impact(solid.surface, distance, pan)
    const paper = hit.targetId ? paperById.get(hit.targetId) : undefined
    if (paper) {
      const ring = point.distanceTo(paper.center) / (paper.radius / 5)
      const points = ring < 5 ? 10 - Math.floor(ring) : 2
      drill.set({ marker: view.marker + 1 })
      if (counting) drill.set({ hits: view.hits + 1, score: view.score + points })
    }
  }

  const writeIntent = (intent: StandaloneIntent, dt: number) => {
    const state = control.current
    state.clock += dt
    if (commands.reload) { commands.reload = false; state.reload = true }
    if (commands.swap) { commands.swap = false; state.weapon = state.weapon === 'rifle' ? 'pistol' : 'rifle' }
    scratch.forward.set(0, 0, -1).applyQuaternion(camera.quaternion)
    scratch.forward.y = 0
    scratch.forward.normalize()
    scratch.right.set(-scratch.forward.z, 0, scratch.forward.x)
    const sprinting = state.sprint && intent.forward > 0.3 && !state.firing && !arms.aiming
    const speed = sprinting ? 5.2 : arms.aiming ? 1.8 : 3.1
    const moveX = scratch.forward.x * intent.forward + scratch.right.x * intent.right
    const moveZ = scratch.forward.z * intent.forward + scratch.right.z * intent.right
    const position = state.position
    position.x = THREE.MathUtils.clamp(position.x + moveX * speed * dt, BOUNDS.minX, BOUNDS.maxX)
    position.z = THREE.MathUtils.clamp(position.z + moveZ * speed * dt, BOUNDS.minZ, BOUNDS.maxZ)
    const moving = Math.hypot(intent.forward, intent.right) > 0.05
    arms.speed = moving ? speed : 0
    arms.sprinting = sprinting
    arms.aiming = (state.aimHeld || commands.aim) && !sprinting
    state.accumulated = Math.min(state.accumulated + dt, 0.1)
    while (state.accumulated >= weapon.fixedDeltaSeconds) {
      state.accumulated -= weapon.fixedDeltaSeconds
      state.aim.origin.copy(camera.position)
      const events = weapon.step({ tick: weapon.snapshot().nextTick, trigger: state.firing && !sprinting, reload: state.reload, selectWeaponId: state.weapon, aim: state.aim, muzzle: state.aim.origin }, queries)
      state.reload = false
      for (const event of events) handle(event)
    }
    const snapshot = weapon.snapshot()
    const current = snapshot.weapons.find(entry => entry.id === snapshot.equippedWeaponId)!
    const definition = definitions.find(entry => entry.id === snapshot.equippedWeaponId)!
    drill.set({ weapon: snapshot.equippedWeaponId as WeaponId, magazine: current.magazine, capacity: definition.magazineSize, reloading: snapshot.status.kind === 'reloading', aiming: arms.aiming })
    const view = drill.get()
    if (view.phase === 'running' && state.clock - state.lastTimeSent > 0.05) { state.lastTimeSent = state.clock; drill.set({ time: state.clock - state.startedAt }) }
    if (view.phase === 'done') {
      state.phaseTimer -= dt
      if (state.phaseTimer <= 0) { for (const target of steelSet.steel) target.reset(); drill.set({ phase: 'ready', cleared: steelSet.steel.map(() => false) }) }
    }
    return position
  }

  useFrame(({ size }, dt) => {
    const state = control.current
    for (const target of steelSet.steel) target.update(dt)
    effects.update(dt, position => audio.casing(position.distanceTo(camera.position)))
    state.flash = Math.max(0, state.flash - dt)
    lights.flash.intensity = state.flash > 0 ? 14 * state.flash / 0.05 : 0
    const weaponId = drill.get().weapon
    const fov = portraitFov(arms.aiming ? (weaponId === 'rifle' ? 50 : 60) : 72, size.width / size.height)
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov += (fov - camera.fov) * (1 - Math.exp(-14 * dt)); camera.updateProjectionMatrix() }
  })

  return <>
    <Look atmosphere="zone" quality={tier} environment sun={lights.sun} fill={lights.fill} onReady={setLook} />
    <primitive object={lights.sun} />
    <primitive object={lights.sun.target} />
    <primitive object={lights.fill} />
    <primitive object={lights.flash} />
    <primitive object={range.group} />
    <primitive object={steelSet.group} />
    <ArmsViewmodel state={arms} render="external" onPresentation={setPresentation} />
    <ArmsPass look={look} presentation={presentation} />
    <StandaloneSubject onIntent={writeIntent} onFire={useCallback((firing: boolean, aim: { origin: THREE.Vector3; direction: THREE.Vector3 }) => { control.current.firing = firing; control.current.aim.direction.copy(aim.direction) }, [])} onReload={useCallback(() => { control.current.reload = true }, [])} touch={touchInput} recoil={recoil} sensitivity={Math.min(1, camera.fov / 72)} />
  </>
}

function Touch() {
  const [aim, setAim] = useState(false)
  return <TouchPad
    onMove={(x, y) => { touchInput.forward = -y; touchInput.right = x }}
    onLook={(dx, dy) => { touchInput.lookX += dx; touchInput.lookY += dy }}
    onButton={(id, pressed) => {
      if (id === 'fire') touchInput.fire = pressed
      if (!pressed) return
      if (id === 'aim') { commands.aim = !commands.aim; setAim(commands.aim) }
      if (id === 'reload') commands.reload = true
      if (id === 'swap') commands.swap = true
    }}
    buttons={[{ id: 'fire', label: 'Fire' }, { id: 'aim', label: aim ? 'Hip' : 'Aim' }, { id: 'reload', label: 'Reload' }, { id: 'swap', label: 'Swap' }]} />
}

function Hud({ touch }: { touch: boolean }) {
  const view = useDrill()
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!view.marker) return
    setFlash(true)
    const timer = setTimeout(() => setFlash(false), 90)
    return () => clearTimeout(timer)
  }, [view.marker])
  const total = view.cleared.length
  const done = view.cleared.filter(Boolean).length
  const accuracy = view.shots ? Math.round(view.hits / view.shots * 100) : 0
  const label = view.phase === 'ready' ? 'Steel drill · first shot starts the clock' : view.phase === 'running' ? `Steel ${done}/${total} · Score ${view.score}` : `Clear · Score ${view.score} · ${accuracy}% hits`
  return <div className="range-hud">
    <Status label={label} value={formatTime(view.time)} tone={undefined} />
    <div className="range-pips" aria-hidden="true">
      {view.cleared.map((cleared, index) => <i key={index} className={cleared ? 'range-pip range-pip--on' : 'range-pip'} />)}
      {view.best !== null && <span>Best {formatTime(view.best)}</span>}
    </div>
    <div className={`range-reticle${view.aiming ? ' range-reticle--aim' : ''}${flash ? ' range-reticle--hit' : ''}`} aria-hidden="true"><i /><i /><i /><i /><b /></div>
    <div className={`range-ammo${touch ? ' range-ammo--touch' : ''}`}>
      <span>{view.weapon === 'rifle' ? 'Rifle' : 'Pistol'}{view.reloading ? ' · reloading' : ''}</span>
      <strong className={view.magazine === 0 ? 'range-ammo--empty' : undefined}>{view.magazine}<small>/{view.capacity}</small></strong>
    </div>
  </div>
}

function App() {
  const touch = useTouch()
  const tier = useMemo(autoQuality, [])
  const [armsReady, setArmsReady] = useState(false)
  const [world, setWorld] = useState(false)
  const [progress, setProgress] = useState(0.05)
  const locked = useDrill().locked
  const ready = armsReady && world
  useEffect(() => {
    let cancelled = false
    const url = new URL(`${import.meta.env.BASE_URL}assets/skm-als.glb`, location.href).href
    void preloadAlsCharacterGltf(url, { onProgress: value => { if (!cancelled && value !== undefined) setProgress(0.05 + value * 0.8) } })
    void Promise.all([texturesReady(), rangeTexturesReady()]).then(() => { if (!cancelled) setWorld(true) })
    return () => { cancelled = true }
  }, [])
  const onArms = useCallback(() => { setProgress(1); setArmsReady(true) }, [])
  return <Screen>
    <Canvas shadows={tier !== 'low'} dpr={internalPixelRatio()} camera={{ fov: 72, near: 0.05, far: 400, position: [0, eye, 0.4] }} gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }} onCreated={state => attachPerfProbe(state.gl)}>
      <Scene tier={tier} onReady={onArms} />
    </Canvas>
    <TitleCard title="Armory · Firing Range" />
    {ready && <Hud touch={touch} />}
    <Hints visible={!touch} items={[['LMB', 'Fire'], ['RMB', 'Aim'], ['R', 'Reload'], ['1 2', 'Swap'], ['WASD', 'Move']]} />
    <Prompt text="Click to shoot" visible={ready && !touch && !locked} />
    {touch && ready && <Touch />}
    <Loading title="Firing Range" detail={progress < 0.85 ? 'Loading the arms' : 'Hanging the steel'} progress={progress} done={ready} />
  </Screen>
}

createRoot(document.getElementById('root')!).render(<App />)
