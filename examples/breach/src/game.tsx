import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type RefObject } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CuboidCollider, Physics, RigidBody, useAfterPhysicsStep, useRapier } from '@react-three/rapier'
import { preloadAlsCharacterGltf } from 'als-ue5-r3f/app/AlsCharacterGltf'
import type { AlsRagdollHandle } from 'als-ue5-r3f/app/AlsRemoteActor'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import type { CameraPose } from '@blacksite/check'
import { Look } from '@blacksite/look/r3f'
import { autoQuality, depthDefaults, type Atmosphere, type QualityTier } from '@blacksite/look'
import { ZONE } from '@blacksite/look/presets'
import { createWeaponRuntime, type QueryHit, type WeaponEvent } from '@blacksite/armory'
import { StandaloneSubject, createStandaloneRecoil, createStandaloneTouch, type StandaloneIntent, type StandaloneView } from '@blacksite/subject-fpp'
import { ArmsViewmodel, createArmsState, portraitFov, type ArmsPresentation } from '@blacksite/subject-fpp/arms'
import type { Intent } from '@blacksite/warden'
import { attachPerfProbe } from '@blacksite/ui/perf-overlay'
import { internalPixelRatio, setAnisotropy, texturesReady } from '@blacksite/look/world'
import { Hints, Loading, Prompt, Screen, TitleCard, TouchPad, useTouch } from '@blacksite/ui/hud'
import { createBreachAudio, type BreachAudio } from './audio'
import { PLAYER_ID, type PlayerState } from './authority'
import { CheckProbe, type Controls, type Driver } from './check'
import { createChips, type Chips } from './chips'
import { createEffects, type Effects } from './effects'
import { SOLIDS, castLevel, castTargets, clearLine, groundHit, zoneMultiplier, type Target, type V3 } from './geometry'
import { Hud } from './hud'
import { ENCOUNTERS, EXFIL, START, footingAt, roomAt } from './layout'
import { breachTexturesReady, buildLevel, type BreachLevel } from './level'
import { AI, CORPSE_RAGDOLL, DEG, FEEDBACK, MOVE, PLAYER, PRESENTATION, VIEW, WEAPONS, animationBudget, animationInterval, armoryDefinitions, scheduleAnimation, footInterval, type HitZone, type RoomId } from './model'
import { createBody, eyePosition, placeBody, stepBody } from './player'
import { createCorpseRagdoll, warmCorpseRagdoll, type CorpseRagdoll } from './ragdoll'
import { Soldiers, corpseOf, lod, releaseWeaponAim } from './soldiers'
import { SquadClient, type TimedEvent } from './squad'
import { hud, useHud } from './store'
import './breach.css'

type WeaponId = 'rifle' | 'pistol'

const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
const definitions = armoryDefinitions()
const HOLD = 1 << 20
const worlds = new Map<string, { level: BreachLevel; chips: Chips }>()
const effectsByScene = new WeakMap<THREE.Scene, Effects>()

function worldFor(quality: QualityTier, phone: boolean) {
  const key = `${quality}:${phone}`
  let world = worlds.get(key)
  if (!world) {
    const level = buildLevel({ quality, phone })
    world = { level, chips: createChips(level.group, level.heroes) }
    worlds.set(key, world)
  }
  return world
}

function effectsFor(scene: THREE.Scene) {
  let effects = effectsByScene.get(scene)
  if (!effects) { effects = createEffects(scene); effectsByScene.set(scene, effects) }
  return effects
}
const ADMISSION = -2.25
type Commands = { reload: boolean; swap: boolean; aim: boolean; crouch: boolean; jump: boolean; sprint: boolean }
type TouchInput = ReturnType<typeof createStandaloneTouch>
type RapierHandle = ReturnType<typeof useRapier>
const atmosphere: Atmosphere = {
  ...ZONE,
  exposure: 1.18,
  fog: { color: [0.33, 0.355, 0.34], near: 9, far: 95 },
  fill: { ...ZONE.fill, strength: 0.62 },
  sun: { ...ZONE.sun, strength: 1.35 },
}
const soldierIds = ENCOUNTERS.flatMap(encounter => encounter.soldiers.map(soldier => soldier.id))
const encounterOf = new Map(ENCOUNTERS.flatMap((encounter, index) => encounter.soldiers.map(soldier => [soldier.id, index] as const)))
const NAMES: Record<string, string> = {
  'lobby-1': 'Volkov', 'lobby-2': 'Petrov', 'hall-1': 'Sergeant Orlov', 'hall-2': 'Kuznetsov', 'hall-3': 'Belov', 'hall-4': 'Gromov',
  'office-1': 'Lieutenant Sokol', 'office-2': 'Zaitsev', 'office-3': 'Lebedev',
}
const BARKS: Record<Intent, string[]> = {
  advance: ['Moving up!', 'Pushing forward, cover me!', 'Advancing!'],
  flank: ['Going around, keep him busy!', 'Flanking left!', 'I will take the side!'],
  cover: ['Taking cover!', 'Getting behind something!', 'Cover, cover!'],
  engage: ['Contact! Open fire!', 'There he is!', 'I see him!'],
  suppress: ['Suppressing! Keep his head down!', 'Pin him there!', 'Laying fire!'],
  reload: ['Reloading!', 'Changing magazine, cover me!', 'Out! Reloading!'],
  fallback: ['Falling back!', 'Pull back, pull back!', 'Too hot, moving back!'],
  search: ['Where did he go?', 'Lost him. Check the corners.', 'Eyes open, he is close.'],
  hold: ['Holding here.', 'In position.', 'Watching the door.'],
}
const OBJECTIVES = ['Clear the lobby', 'Clear the machine hall', 'Clear the records office', 'Exfil by the carrier']

const playerState: PlayerState = { x: START.position[0], y: MOVE.eye, z: START.position[2], yaw: 0, pitch: 0, crouch: false, moving: false, sprinting: false, alive: true }

function readKeys(intent: StandaloneIntent, keys: ReadonlySet<string>) {
  const forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'))
  const right = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'))
  if (intent.forward || intent.right) return { forward: intent.forward, right: intent.right }
  const length = Math.max(1, Math.hypot(forward, right))
  return { forward: forward / length, right: right / length }
}

type LookHandle = Parameters<NonNullable<ComponentProps<typeof Look>['onReady']>>[0]

function opaqueAo(look: LookHandle) {
  for (const pass of look?.composer.passes ?? []) if ('configuration' in pass) (pass as { configuration: { transparencyAware: boolean } }).configuration.transparencyAware = false
}

function LevelColliders() {
  const boxes = useMemo(() => SOLIDS.filter(block => block.max[1] - block.min[1] > 0.05).map(block => ({
    half: [(block.max[0] - block.min[0]) / 2, (block.max[1] - block.min[1]) / 2, (block.max[2] - block.min[2]) / 2] as [number, number, number],
    at: [(block.max[0] + block.min[0]) / 2, (block.max[1] + block.min[1]) / 2, (block.max[2] + block.min[2]) / 2] as [number, number, number],
  })), [])
  return <RigidBody type="fixed" colliders={false}>
    <CuboidCollider args={[60, 0.5, 60]} position={[0, -0.5, 0]} />
    {boxes.map((box, index) => <CuboidCollider key={index} args={box.half} position={box.at} />)}
  </RigidBody>
}

function Scene({ tier, audio, touchInput, commands, onArms, onFirstFrame }: { tier: QualityTier; audio: BreachAudio; touchInput: TouchInput; commands: Commands; onArms: () => void; onFirstFrame: () => void }) {
  const camera = useThree(state => state.camera) as THREE.PerspectiveCamera
  const gl = useThree(state => state.gl)
  const scene = useThree(state => state.scene)
  const phone = coarse || tier === 'low'
  const squad = useMemo(() => new SquadClient(), [])
  const keys = useMemo(() => new Set<string>(), [])
  const handles = useMemo(() => new Map<string, RefObject<AlsRagdollHandle | null>>(), [])
  const { level, chips } = useMemo(() => worldFor(tier, phone), [tier, phone])
  const effects = useMemo(() => effectsFor(scene), [scene])
  const arms = useMemo(() => { const state = createArmsState(); state.aimSeconds = WEAPONS.rifle.adsSeconds; return state }, [])
  const recoil = useMemo(createStandaloneRecoil, [])
  const recovery = useMemo(() => ({ fraction: WEAPONS.rifle.recoveryFraction as number, seconds: WEAPONS.rifle.recoverySeconds as number }), [])
  const view = useMemo<StandaloneView>(() => ({ yaw: START.yaw, pitch: 0, reset: true }), [])
  const body = useMemo(() => createBody(START.position), [])
  const weapon = useRef(createWeaponRuntime({ ownerId: PLAYER_ID, seed: 7, definitions, initialWeaponId: 'rifle' }))
  const [presentation, setPresentation] = useState<ArmsPresentation | null>(null)
  const [roster, setRoster] = useState<string[]>([])
  const [frozen, setFrozen] = useState<ReadonlySet<string>>(() => new Set())
  const override = useRef(false)
  const pose = useRef<CameraPose | null>(null)
  const [posed, setPosed] = useState(false)
  const [live, setLive] = useState(false)
  const lights = useMemo(() => {
    const sun = new THREE.DirectionalLight()
    sun.castShadow = tier !== 'low'
    sun.shadow.mapSize.setScalar(phone ? 1024 : 2048)
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.04
    Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 140 })
    sun.shadow.camera.updateProjectionMatrix()
    const fill = new THREE.HemisphereLight()
    const flash = new THREE.PointLight('#ffb36a', 0, 10, 2)
    const enemy = new THREE.PointLight('#ffb070', 0, 8, 2)
    return { sun, fill, flash, enemy }
  }, [tier, phone])
  const game = useRef({
    firing: false, reload: false, weapon: 'rifle' as WeaponId, aimHeld: false, accumulated: 0, clock: 0, flash: 0, enemyFlash: 0,
    aim: { origin: new THREE.Vector3(), direction: new THREE.Vector3(0, 0, -1) }, health: PLAYER.health as number, lastHurt: -10, shake: 0,
    phase: 'play' as 'play' | 'dead' | 'exfil', restartAt: 0, cleared: [false, false, false], exfil: false, startedAt: 0,
    shots: 0, hits: 0, kills: 0, barkAt: new Map<string, number>(), squadBarkAt: -10, subtitleId: 0, damageId: 0,
    rounds: new Map<string, number>(), down: new Set<string>(), downAt: new Map<string, number>(), laid: new Set<string>(), settled: new Map<string, number>(), dead: new Set<string>(), pushes: new Map<string, THREE.Vector3>(),
    seed: 1, firstFrame: false, sprinting: false, fireReadyAt: 0, sentAt: 0, room: 'yard' as RoomId, deathTilt: 0, drive: null as Driver | null,
    footsteps: new Map<string, number>(),
    drops: new Map<string, { pivot: THREE.Group; axis: THREE.Vector3; base: number; start: number }>(),
    corpses: new Map<string, CorpseRagdoll>(),
  })
  const scratch = useMemo(() => ({
    eye: { x: 0, y: 0, z: 0 } as V3, right: new THREE.Vector3(), forward: new THREE.Vector3(), muzzle: new THREE.Vector3(), point: new THREE.Vector3(), normal: new THREE.Vector3(),
    from: new THREE.Vector3(), to: new THREE.Vector3(), sample: { x: 0, z: 0, crouch: false, alive: true, yaw: 0 }, targets: [] as Target[], zones: new Map<string, HitZone>(),
    frustum: new THREE.Frustum(), matrix: new THREE.Matrix4(), sphere: new THREE.Sphere(new THREE.Vector3(), 1.2), visible: new Set<RoomId>(), corpses: new THREE.Group(), lightEye: new THREE.Vector3(),
    animation: new Map<string, number>(), credit: new Map<string, number>(), due: new Set<string>(), budget: 0, parity: false, waiting: [] as string[], arriving: 0, falling: 0, stepped: false,
    physics: null as RapierHandle | null,
  }), [])

  useEffect(() => { scene.add(scratch.corpses); return () => { scene.remove(scratch.corpses) } }, [scene, scratch])
  useEffect(() => () => { effects.dispose(); effectsByScene.delete(scene) }, [effects, scene])
  useEffect(() => () => {
    chips.dispose()
    level.dispose()
    for (const [key, world] of worlds) if (world.level === level) worlds.delete(key)
  }, [chips, level])
  useEffect(() => { if (presentation) onArms() }, [presentation, onArms])
  useEffect(() => {
    setAnisotropy(gl)
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    chips.warm()
  }, [gl, chips])

  const freeze = useCallback((id: string, on: boolean) => setFrozen(previous => {
    if (previous.has(id) === on) return previous
    const next = new Set(previous)
    if (on) next.add(id)
    else next.delete(id)
    return next
  }), [])

  const restart = useCallback(() => {
    const state = game.current
    state.seed = (state.seed * 7919 + 13) % 100003
    placeBody(body, START.position)
    view.yaw = START.yaw
    view.pitch = 0
    view.reset = true
    weapon.current = createWeaponRuntime({ ownerId: PLAYER_ID, seed: state.seed, definitions, initialWeaponId: 'rifle' })
    Object.assign(state, { firing: false, reload: false, weapon: 'rifle', health: PLAYER.health, lastHurt: -10, phase: 'play', cleared: [false, false, false], exfil: false, startedAt: state.clock, shots: 0, hits: 0, kills: 0, squadBarkAt: -10, deathTilt: 0, accumulated: 0, fireReadyAt: 0, sprinting: false })
    state.barkAt.clear(); state.rounds.clear(); state.down.clear(); state.downAt.clear(); state.laid.clear(); state.settled.clear(); state.dead.clear(); state.pushes.clear()
    state.footsteps.clear()
    state.drops.clear()
    for (const ragdoll of state.corpses.values()) ragdoll.dispose()
    state.corpses.clear()
    arms.weapon = 'rifle'
    arms.aimSeconds = WEAPONS.rifle.adsSeconds
    recovery.fraction = WEAPONS.rifle.recoveryFraction
    recovery.seconds = WEAPONS.rifle.recoverySeconds
    arms.equipSequence++
    scratch.corpses.clear()
    chips.reset()
    setFrozen(new Set())
    lod.clear()
    scratch.animation.clear()
    scratch.credit.clear()
    scratch.waiting.length = 0
    scratch.arriving = 0
    syncPlayer()
    squad.reset(state.seed, { ...playerState })
    hud.reset({ objective: OBJECTIVES[0]! })
  }, [arms, body, chips, recovery, scratch, squad, view])

  useEffect(() => {
    squad.start()
    const unsubscribe = squad.subscribe(() => setRoster(squad.roster.length ? squad.roster.map(soldier => soldier.id) : soldierIds))
    setRoster(soldierIds)
    restart()
    return () => { unsubscribe(); squad.dispose() }
  }, [restart, squad])

  useEffect(() => {
    const canvas = gl.domElement
    const doc = canvas.ownerDocument
    const active = () => doc.pointerLockElement === canvas
    const select = (next: WeaponId) => { game.current.weapon = next }
    const down = (event: KeyboardEvent) => {
      audio.start()
      keys.add(event.code)
      if (event.code === 'Space' && !event.repeat) commands.jump = true
      if (event.code === 'KeyR' && !event.repeat) game.current.reload = true
      if (event.code === 'Digit1') select('rifle')
      if (event.code === 'Digit2') select('pistol')
      if (event.code === 'KeyQ' && !event.repeat) select(game.current.weapon === 'rifle' ? 'pistol' : 'rifle')
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault()
    }
    const up = (event: KeyboardEvent) => keys.delete(event.code)
    const blur = () => { keys.clear(); game.current.aimHeld = false; touchInput.fire = false }
    const mouseDown = (event: MouseEvent) => { audio.start(); if (event.button === 2 && active()) game.current.aimHeld = true }
    const mouseUp = (event: MouseEvent) => { if (event.button === 2) game.current.aimHeld = false }
    const wheel = (event: WheelEvent) => { if (active() && Math.abs(event.deltaY) > 4) select(game.current.weapon === 'rifle' ? 'pistol' : 'rifle') }
    const lockChange = () => { const locked = active(); hud.set({ locked }); if (!locked) game.current.aimHeld = false }
    const context = (event: MouseEvent) => event.preventDefault()
    const touchStart = () => audio.start()
    doc.addEventListener('keydown', down)
    doc.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    doc.addEventListener('mousedown', mouseDown)
    doc.addEventListener('mouseup', mouseUp)
    doc.addEventListener('wheel', wheel, { passive: true })
    doc.addEventListener('pointerlockchange', lockChange)
    doc.addEventListener('touchstart', touchStart, { passive: true })
    canvas.addEventListener('contextmenu', context)
    return () => {
      doc.removeEventListener('keydown', down); doc.removeEventListener('keyup', up); window.removeEventListener('blur', blur); doc.removeEventListener('mousedown', mouseDown); doc.removeEventListener('mouseup', mouseUp)
      doc.removeEventListener('wheel', wheel); doc.removeEventListener('pointerlockchange', lockChange); doc.removeEventListener('touchstart', touchStart); canvas.removeEventListener('contextmenu', context)
    }
  }, [gl, audio, keys, touchInput])

  const syncPlayer = () => {
    const eye = eyePosition(body, scratch.eye)
    playerState.x = eye.x
    playerState.y = eye.y
    playerState.z = eye.z
    playerState.yaw = view.yaw
    playerState.pitch = view.pitch
    playerState.crouch = body.crouch > 0.5
    playerState.moving = Math.hypot(body.velocity.x, body.velocity.z) > 0.6
    playerState.sprinting = game.current.sprinting
    playerState.alive = game.current.phase !== 'dead'
  }

  const queries = useMemo(() => ({
    castRay(query: { origin: V3; direction: V3; maxDistance: number }): QueryHit | null {
      const length = Math.hypot(query.direction.x, query.direction.y, query.direction.z) || 1
      const direction = { x: query.direction.x / length, y: query.direction.y / length, z: query.direction.z / length }
      const wall = castLevel(query.origin, direction, query.maxDistance)
      const target = castTargets(query.origin, direction, wall ? wall.distance : query.maxDistance, scratch.targets)
      if (target) {
        scratch.zones.set(target.id, target.zone)
        return { colliderId: `soldier:${target.id}:${target.zone}`, targetId: target.id, point: target.point, normal: target.normal, distance: target.distance }
      }
      if (!wall) return null
      return { colliderId: wall.block.id, point: wall.point, normal: wall.normal, distance: wall.distance }
    },
    sweepSphere: () => null,
  }), [scratch])

  const blockById = useMemo(() => new Map([...SOLIDS, { id: 'ground', hit: 'dirt' as const }].map(block => [block.id, block])), [])

  const hurt = (amount: number, from: V3) => {
    const state = game.current
    if (state.phase !== 'play') return
    state.health = Math.max(0, state.health - amount)
    state.lastHurt = state.clock
    state.shake = Math.min(1, state.shake + amount / 30)
    audio.hurt(amount)
    const angle = Math.atan2(from.x - body.position.x, from.z - body.position.z)
    const facing = Math.atan2(-Math.sin(view.yaw), -Math.cos(view.yaw))
    const relative = facing - angle
    const now = hud.get()
    hud.set({ health: state.health, damage: [...now.damage.filter(item => item.until > state.clock), { id: ++state.damageId, angle: relative, until: state.clock + 0.9 }].slice(-4) })
    if (state.health <= 0) {
      state.phase = 'dead'
      state.restartAt = state.clock + PLAYER.deathRestartSeconds
      audio.sting('death')
      hud.set({ phase: 'dead', time: state.clock - state.startedAt, shots: state.shots, hits: state.hits, kills: state.kills })
      syncPlayer()
      squad.player({ ...playerState })
    }
  }

  const lay = (id: string) => {
    const state = game.current
    const corpse = corpseOf(id)
    if (!corpse) return false
    scratch.corpses.add(corpse)
    state.settled.delete(id)
    state.laid.add(id)
    freeze(id, true)
    return true
  }

  const settle = (id: string) => {
    const state = game.current
    state.corpses.get(id)?.dispose()
    state.corpses.delete(id)
    state.settled.delete(id)
  }

  const corpseSlot = () => {
    const state = game.current
    if (state.corpses.size < PRESENTATION.ragdolls.phone) return true
    const time = performance.now() / 1000
    let oldest: string | null = null
    for (const id of state.corpses.keys()) if (!oldest || (state.downAt.get(id) ?? time) < (state.downAt.get(oldest) ?? time)) oldest = id
    const ragdoll = oldest ? state.corpses.get(oldest) : null
    if (!oldest || !ragdoll || time - (state.downAt.get(oldest) ?? time) < FEEDBACK.corpse.minimumSeconds || ragdoll.pelvis.position.y > FEEDBACK.corpse.groundedHeight) return false
    settle(oldest)
    return true
  }

  const fall = (id: string, velocity: { x: number; z: number }) => {
    const state = game.current
    const physics = scratch.physics
    if (!physics || !corpseSlot()) { drop(id); return }
    releaseWeaponAim(id)
    const corpse = corpseOf(id)
    if (!corpse) return
    const push = state.pushes.get(id) ?? new THREE.Vector3(0, 0, -1)
    const ragdoll = createCorpseRagdoll(physics.rapier, physics.world, corpse, push, velocity)
    if (!ragdoll) { drop(id); return }
    scratch.corpses.add(corpse)
    state.corpses.set(id, ragdoll)
    state.down.add(id)
    state.downAt.set(id, performance.now() / 1000)
    state.laid.add(id)
    freeze(id, true)
  }

  const rest = () => {
    const state = game.current
    const time = performance.now() / 1000
    for (const [id, ragdoll] of state.corpses) {
      const age = time - (state.downAt.get(id) ?? time)
      if (ragdoll.pelvis.velocity.lengthSq() < FEEDBACK.corpse.settledSpeed ** 2) state.settled.set(id, state.settled.get(id) ?? time)
      else state.settled.delete(id)
      const still = time - (state.settled.get(id) ?? time) > FEEDBACK.corpse.settledSeconds
      if (age > CORPSE_RAGDOLL.maximumSeconds || age > FEEDBACK.corpse.minimumSeconds && (still || age > PRESENTATION.corpseSeconds.phone && ragdoll.pelvis.position.y < FEEDBACK.corpse.groundedHeight)) settle(id)
    }
  }

  const drop = (id: string) => {
    const state = game.current
    releaseWeaponAim(id)
    const corpse = corpseOf(id)
    if (!corpse) return
    const feet = corpse.getObjectByName('root')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3()
    corpse.position.copy(feet).negate()
    corpse.updateMatrix()
    const pivot = new THREE.Group()
    pivot.position.copy(feet)
    pivot.add(corpse)
    scratch.corpses.add(pivot)
    const push = state.pushes.get(id) ?? new THREE.Vector3(0, 0, -1)
    const axis = new THREE.Vector3(push.z, 0, -push.x)
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0)
    state.drops.set(id, { pivot, axis: axis.normalize(), base: feet.y, start: state.clock })
    state.down.add(id)
    state.downAt.set(id, performance.now() / 1000)
    state.laid.add(id)
    freeze(id, true)
  }

  const topple = () => {
    const state = game.current
    for (const [id, item] of state.drops) {
      const { seconds, bounce, lift } = PRESENTATION.topple
      const t = (state.clock - item.start) / seconds
      const settle = Math.min(1, Math.max(0, (t - 1) / bounce.seconds * seconds))
      const angle = t < 1 ? Math.PI / 2 * t * t : Math.PI / 2 - bounce.angle * Math.sin(Math.PI * settle) * (1 - settle)
      item.pivot.quaternion.setFromAxisAngle(item.axis, angle)
      item.pivot.position.y = item.base + lift * Math.sin(angle)
      if (settle >= 1) state.drops.delete(id)
    }
  }

  const ragdollSlot = (id: string) => {
    const state = game.current
    const falling = [...state.down].filter(other => !state.laid.has(other))
    if (falling.length < PRESENTATION.ragdolls[phone ? 'phone' : 'desktop']) return true
    const time = performance.now() / 1000
    let oldest: string | null = null
    for (const other of falling) if (!oldest || (state.downAt.get(other) ?? time) < (state.downAt.get(oldest) ?? time)) oldest = other
    const handle = oldest ? handles.get(oldest)?.current : null
    if (!oldest || !handle || time - (state.downAt.get(oldest) ?? time) < FEEDBACK.corpse.minimumSeconds || handle.pelvis.position.y > FEEDBACK.corpse.groundedHeight) return false
    return lay(oldest) && id !== oldest
  }

  const bark = (id: string, text: string, at: V3, force = false, announce = false) => {
    const state = game.current
    const last = state.barkAt.get(id) ?? -10
    const audible = force || (state.clock - last >= AI.barkCooldownSeconds && state.clock - state.squadBarkAt >= AI.squadBarkSeconds)
    if (!audible && !announce) return
    if (Math.hypot(at.x - body.position.x, at.z - body.position.z) > AI.hearingRange) return
    if (audible) { state.barkAt.set(id, state.clock); state.squadBarkAt = state.clock }
    const index = soldierIds.indexOf(id)
    const duration = audible ? audio.bark(text, at, index) : 1.3
    const now = hud.get()
    hud.set({ subtitles: [...now.subtitles.filter(line => line.until > state.clock), { id: ++state.subtitleId, speaker: NAMES[id] ?? 'Soldier', text, until: state.clock + Math.max(1.6, duration + 0.8) }].slice(-3) })
  }

  const handleSquad = (event: TimedEvent) => {
    const state = game.current
    if (event.kind === 'fire') {
      const fired = (state.rounds.get(event.id) ?? 0) + 1
      state.rounds.set(event.id, fired)
      scratch.from.set(event.from.x, event.from.y, event.from.z)
      scratch.to.set(event.to.x, event.to.y, event.to.z)
      scratch.forward.subVectors(scratch.to, scratch.from).normalize()
      effects.flash(scratch.from, scratch.forward)
      lights.enemy.position.copy(scratch.from)
      state.enemyFlash = FEEDBACK.muzzleFlashSeconds
      if (fired % FEEDBACK.tracerEvery === 1) effects.tracer(scratch.from, scratch.to)
      const occluded = !clearLine(event.from, scratch.eye)
      audio.enemyShot(event.from, occluded)
      if (event.hit === 'player') { hurt(event.damage, event.from); return }
      if (event.hit !== 'none') {
        scratch.point.copy(scratch.to)
        scratch.normal.set(event.normal.x, event.normal.y, event.normal.z)
        effects.impact(event.hit, scratch.point, scratch.normal, 0.7)
        audio.impact(event.hit, event.to)
      }
      if (event.near < 2.5 && state.phase === 'play') audio.crack(event.to, event.near)
    } else if (event.kind === 'died') {
      const latest = squad.latest(event.id)
      const push = new THREE.Vector3((latest?.x ?? 0) - event.by.x, 0, (latest?.z ?? 0) - event.by.z)
      if (push.lengthSq() < 1e-4) push.set(0, 0, 1)
      state.pushes.set(event.id, push.normalize())
    } else if (event.kind === 'intent') {
      const lines = BARKS[event.intent]
      const latest = squad.latest(event.id)
      if (lines && latest && latest.alive) bark(event.id, lines[Math.floor(Math.random() * lines.length)]!, { x: latest.x, y: 1.6, z: latest.z }, false, true)
    } else if (event.kind === 'alert') {
      const encounter = ENCOUNTERS.find(item => item.id === event.encounter)
      const speaker = encounter?.soldiers.find(soldier => squad.latest(soldier.id)?.alive)
      const latest = speaker && squad.latest(speaker.id)
      if (speaker && latest) bark(speaker.id, event.text, { x: latest.x, y: 1.6, z: latest.z }, true)
    }
  }

  const handle = (event: WeaponEvent) => {
    const state = game.current
    if (event.type === 'switch-started') {
      arms.weapon = event.weaponId as WeaponId
      const definition = WEAPONS[arms.weapon]
      arms.aimSeconds = definition.adsSeconds
      recovery.fraction = definition.recoveryFraction
      recovery.seconds = definition.recoverySeconds
      arms.equipSequence++
      audio.equip()
      return
    }
    if (event.type === 'reload-started') { arms.reloadSequence++; audio.reload(event.weaponId as WeaponId, arms.empty); return }
    if (event.type === 'trigger-blocked' && event.reason === 'empty') { audio.dry(); state.reload = true; return }
    if (event.type === 'shot') {
      const pistol = event.weaponId === 'pistol'
      arms.fireSequence++
      const kick = arms.aiming ? 0.75 : 1
      recoil.pitch += event.recoil.pitch * kick
      recoil.yaw += event.recoil.yaw * kick
      state.shake = Math.min(1, state.shake + 0.08)
      audio.shot(pistol ? 'pistol' : 'rifle')
      effects.eject(camera, pistol)
      state.flash = FEEDBACK.muzzleFlashSeconds
      state.shots++
      scratch.right.set(1, 0, 0).applyQuaternion(camera.quaternion)
      scratch.forward.set(0, 0, -1).applyQuaternion(camera.quaternion)
      scratch.muzzle.copy(camera.position).addScaledVector(scratch.forward, 0.7).addScaledVector(scratch.right, arms.aiming ? 0 : 0.11)
      scratch.muzzle.y += arms.aiming ? -0.05 : -0.09
      lights.flash.position.copy(scratch.muzzle)
      if (state.shots % FEEDBACK.tracerEvery === 0) effects.tracer(scratch.muzzle, scratch.to.set(event.end.x, event.end.y, event.end.z))
      squad.shot(scratch.eye)
      return
    }
    if (event.type === 'damage') {
      const zone = scratch.zones.get(event.targetId) ?? 'chest'
      state.hits++
      squad.damage(event.targetId, event.amount * zoneMultiplier(zone), scratch.eye)
      audio.hitMarker(false, zone === 'head')
      const screen = hud.get()
      hud.set({ marker: screen.marker + 1, markerKind: zone === 'head' ? 'head' : 'hit' })
      return
    }
    if (event.type !== 'impact') return
    const hit = event.hit
    scratch.point.set(hit.point.x, hit.point.y, hit.point.z)
    scratch.normal.set(hit.normal.x, hit.normal.y, hit.normal.z)
    if (hit.colliderId.startsWith('soldier:')) {
      effects.impact('flesh', scratch.point, scratch.normal, 1)
      audio.impact('flesh', hit.point)
      const behind = castLevel(hit.point, scratch.forward, 3)
      if (behind && behind.block.id !== 'ground') { scratch.to.set(behind.point.x, behind.point.y, behind.point.z); scratch.from.set(behind.normal.x, behind.normal.y, behind.normal.z); effects.blood(scratch.to, scratch.from) }
      return
    }
    const block = blockById.get(hit.colliderId)
    const surface = hit.colliderId === 'ground' ? groundHit(hit.point.x, hit.point.z) : block?.hit ?? 'concrete'
    const power = event.weaponId === 'pistol' ? 0.8 : 1
    effects.impact(surface, scratch.point, scratch.normal, power)
    audio.impact(surface, hit.point)
    chips.hit(hit.colliderId, hit.point, { x: scratch.forward.x, y: scratch.forward.y, z: scratch.forward.z }, hit.normal, power)
  }

  const writeIntent = (intent: StandaloneIntent, dt: number) => {
    const state = game.current
    const step = Math.min(dt, 0.1)
    state.clock += step
    if (commands.reload) { commands.reload = false; state.reload = true }
    if (commands.swap) { commands.swap = false; state.weapon = state.weapon === 'rifle' ? 'pistol' : 'rifle' }
    const drive = state.drive
    const move = drive ? { forward: drive.forward, right: drive.right } : readKeys(intent, keys)
    const playing = state.phase === 'play'
    const crouch = keys.has('KeyC') || keys.has('ControlLeft') || commands.crouch
    const sprintKey = keys.has('ShiftLeft') || keys.has('ShiftRight') || commands.sprint || touchInput.forward > 0.92 || !!drive?.sprint
    const jump = commands.jump || intent.jump || !!drive?.jump
    commands.jump = false
    if (drive) drive.jump = false
    const firing = playing && (state.firing || !!drive?.fire)
    if (state.sprinting) state.fireReadyAt = state.clock + MOVE.sprintOutSeconds
    const events = stepBody(body, {
      forward: playing ? move.forward : 0, right: playing ? move.right : 0, yaw: view.yaw, sprint: sprintKey, crouch: playing && crouch, jump: playing && jump,
      aiming: arms.aiming, firing, walk: keys.has('AltLeft'),
    }, step)
    state.sprinting = events.sprinting
    const footing = footingAt(body.position.x, body.position.z)
    if (events.step) audio.footstep(footing, events.sprinting ? 1 : body.crouch > 0.5 ? 0.35 : 0.7)
    if (events.landed > 1.5) { audio.footstep(footing, Math.min(1, events.landed / 5), true); state.shake = Math.min(1, state.shake + events.landed / 20) }
    if (events.jumped) audio.footstep(footing, 0.5)
    arms.speed = events.speed
    arms.sprinting = events.sprinting
    arms.aiming = playing && (state.aimHeld || commands.aim || !!drive?.aim) && !events.sprinting
    const eye = eyePosition(body, scratch.eye)
    if (state.phase === 'dead') { state.deathTilt = Math.min(1, state.deathTilt + step * 1.6); eye.y -= state.deathTilt * (body.eye - 0.35) }
    state.accumulated = Math.min(state.accumulated + step, 0.1)
    const runtime = weapon.current
    while (state.accumulated >= runtime.fixedDeltaSeconds) {
      state.accumulated -= runtime.fixedDeltaSeconds
      state.aim.origin.set(eye.x, eye.y, eye.z)
      const stance = { aiming: arms.aiming, moving: Math.min(1, events.speed / MOVE.run), crouched: body.crouch > 0.5 }
      camera.getWorldDirection(state.aim.direction)
      const out = runtime.step({ tick: runtime.snapshot().nextTick, trigger: firing && !events.sprinting && state.clock >= state.fireReadyAt, reload: playing && state.reload, selectWeaponId: state.weapon, aim: state.aim, muzzle: state.aim.origin, stance }, queries)
      state.reload = false
      for (const event of out) handle(event)
    }
    const snapshot = runtime.snapshot()
    const current = snapshot.weapons.find(entry => entry.id === snapshot.equippedWeaponId)!
    arms.empty = current.magazine <= 0
    hud.set({
      weapon: snapshot.equippedWeaponId as WeaponId, magazine: current.magazine, reserve: current.reserve, capacity: WEAPONS[snapshot.equippedWeaponId as WeaponId].magazine,
      reloading: snapshot.status.kind === 'reloading', aiming: arms.aiming, spread: Math.min(4, snapshot.spread / DEG + (body.grounded ? 0 : 1.5)),
    })
    return eye
  }

  useFrame(() => {
    const device = phone ? 'phone' : 'desktop'
    scratch.budget = Math.min(PRESENTATION.animationBudget[device], scratch.budget + animationBudget(device, scratch.falling))
    const interleave = PRESENTATION.armsPoseInterleave[device]
    if (interleave) scratch.parity = !scratch.stepped
    scratch.stepped = false
    arms.poseHold = interleave && scratch.parity
    const slots = interleave && !scratch.parity ? 0 : Math.max(0, Math.floor(scratch.budget) - scratch.arriving)
    const due = scheduleAnimation(scratch.credit, scratch.animation, slots, scratch.due)
    scratch.budget -= due.size + scratch.arriving
    scratch.arriving = 0
    for (const id of due) {
      const entry = lod.get(id)
      if (entry) { entry.minInterval = 1; entry.maxInterval = 1 }
    }
    const admit = interleave ? scratch.parity ? 0 : Math.floor(scratch.budget) : Math.floor(scratch.budget)
    for (let index = 0; scratch.arriving < admit && index < scratch.waiting.length;) {
      const id = scratch.waiting[index]!
      if (!squad.admissible(id)) { index++; continue }
      scratch.waiting.splice(index, 1)
      squad.admit(id)
      scratch.credit.set(id, 0)
      scratch.arriving++
    }
  }, ADMISSION)

  useFrame((_, dt) => {
    const state = game.current
    const step = Math.min(dt, 0.1)
    syncPlayer()
    if (state.clock - state.sentAt > 1 / 30) { state.sentAt = state.clock; squad.player({ ...playerState }) }
    const room = roomAt(body.position.x, body.position.z)
    state.room = room.id
    audio.setListener({ x: scratch.eye.x, y: scratch.eye.y, z: scratch.eye.z, yaw: view.yaw }, room.id)
    audio.update(step)
    const seen = pose.current ? roomAt(pose.current.position[0], pose.current.position[2]) : room
    scratch.visible.clear()
    scratch.visible.add(seen.id)
    for (const id of seen.sees) scratch.visible.add(id)
    level.update(state.clock, step, scratch.visible, pose.current ? scratch.lightEye.fromArray(pose.current.position) : camera.position)
    effects.update(step, position => audio.casing(position, footingAt(position.x, position.z)))
    topple()
    rest()
    chips.update(step)
    state.flash = Math.max(0, state.flash - step)
    state.enemyFlash = Math.max(0, state.enemyFlash - step)
    lights.flash.intensity = state.flash > 0 ? 16 * state.flash / FEEDBACK.muzzleFlashSeconds : 0
    lights.enemy.intensity = state.enemyFlash > 0 ? 9 * state.enemyFlash / FEEDBACK.muzzleFlashSeconds : 0
    const now = squad.renderTime()
    squad.drain(now, handleSquad)
    const targets = scratch.targets
    targets.length = 0
    camera.updateMatrixWorld()
    scratch.frustum.setFromProjectionMatrix(scratch.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    const alive = [0, 0, 0]
    for (const soldier of squad.roster) {
      if (soldier.alive) alive[encounterOf.get(soldier.id) ?? 0]!++
      if (!squad.sample(soldier.id, now, scratch.sample)) continue
      const sample = scratch.sample
      const speed = Math.hypot(soldier.vx, soldier.vz)
      if (sample.alive && speed > 0.6 && Math.hypot(sample.x - body.position.x, sample.z - body.position.z) < AI.hearingRange) {
        const stride = (state.footsteps.get(soldier.id) ?? 0) + step
        const interval = footInterval({ sprinting: speed > MOVE.run, crouched: sample.crouch, walking: speed < 2.2 })
        if (stride >= interval) audio.enemyStep(footingAt(sample.x, sample.z), { x: sample.x, y: 0, z: sample.z })
        state.footsteps.set(soldier.id, stride % interval)
      } else state.footsteps.set(soldier.id, 0)
      const handleRef = handles.get(soldier.id)?.current
      const isDown = state.down.has(soldier.id)
      const waiting = squad.waiting(soldier.id)
      if (waiting && !sample.alive) {
        const index = scratch.waiting.indexOf(soldier.id)
        if (index >= 0) scratch.waiting.splice(index, 1)
        if (!soldier.alive && !state.dead.has(soldier.id)) { state.dead.add(soldier.id); state.kills++ }
        continue
      }
      if (sample.alive && !isDown && !waiting) targets.push({ id: soldier.id, x: sample.x, y: 0, z: sample.z, crouch: sample.crouch })
      if (!soldier.alive && !state.dead.has(soldier.id)) { state.dead.add(soldier.id); state.kills++; audio.hitMarker(true, false); const screen = hud.get(); hud.set({ marker: screen.marker + 1, markerKind: 'kill' }) }
      if (!sample.alive && !isDown && !state.pushes.has(soldier.id)) {
        const push = new THREE.Vector3(sample.x - body.position.x, 0, sample.z - body.position.z)
        state.pushes.set(soldier.id, push.lengthSq() < 1e-4 ? push.set(0, 0, -1) : push.normalize())
      }
      if (!sample.alive && !isDown && PRESENTATION.ragdoll[phone ? 'phone' : 'desktop'] === 'corpse') {
        fall(soldier.id, { x: soldier.vx, z: soldier.vz })
      } else if (!sample.alive && handleRef && !isDown && ragdollSlot(soldier.id)) {
        const push = state.pushes.get(soldier.id) ?? new THREE.Vector3(0, 0, -1)
        releaseWeaponAim(soldier.id)
        if (handleRef.StartRagdolling({ initialImpulse: { boneName: 'spine_03', impulse: { x: push.x * 38, y: 6, z: push.z * 38 } } })) { state.down.add(soldier.id); state.downAt.set(soldier.id, performance.now() / 1000) }
      } else if (isDown && handleRef?.active && !state.laid.has(soldier.id)) {
        const time = performance.now() / 1000
        const age = time - (state.downAt.get(soldier.id) ?? time)
        if (handleRef.pelvis.velocity.lengthSq() < FEEDBACK.corpse.settledSpeed ** 2) state.settled.set(soldier.id, state.settled.get(soldier.id) ?? time)
        else state.settled.delete(soldier.id)
        const settled = time - (state.settled.get(soldier.id) ?? time) > FEEDBACK.corpse.settledSeconds
        if (age > FEEDBACK.corpse.minimumSeconds && (settled || age > PRESENTATION.corpseSeconds[phone ? 'phone' : 'desktop'] && handleRef.pelvis.position.y < FEEDBACK.corpse.groundedHeight)) {
          lay(soldier.id)
        }
      }
      scratch.sphere.center.set(sample.x, 0.9, sample.z)
      const distance = camera.position.distanceTo(scratch.sphere.center)
      const inRoom = scratch.visible.has(roomAt(sample.x, sample.z).id)
      const visible = inRoom && scratch.frustum.intersectsSphere(scratch.sphere)
      if (waiting) { if (!scratch.waiting.includes(soldier.id)) scratch.waiting.push(soldier.id) }
      else if (sample.alive && !isDown) scratch.animation.set(soldier.id, animationInterval(phone ? 'phone' : 'desktop', distance, visible))
      else scratch.animation.delete(soldier.id)
      lod.set(soldier.id, { distance, visible, focused: false, minInterval: HOLD, maxInterval: HOLD })
    }
    scratch.falling = 0
    for (const id of state.down) if (!state.laid.has(id)) scratch.falling++
    if (state.phase === 'play') {
      ENCOUNTERS.forEach((encounter, index) => {
        if (state.cleared[index] || !squad.roster.length || alive[index]! > 0) return
        state.cleared = state.cleared.map((value, slot) => value || slot === index)
        audio.sting('clear')
      })
      const done = state.cleared.every(Boolean)
      if (done && !state.exfil) state.exfil = true
      const next = state.cleared.findIndex(value => !value)
      hud.set({ cleared: state.cleared, exfil: state.exfil, objective: OBJECTIVES[next < 0 ? 3 : next]! })
      if (state.exfil && Math.hypot(body.position.x - EXFIL.at[0], body.position.z - EXFIL.at[1]) < EXFIL.radius) {
        state.phase = 'exfil'
        state.restartAt = state.clock + PLAYER.exfilRestartSeconds
        audio.sting('exfil')
        hud.set({ phase: 'exfil', time: state.clock - state.startedAt, shots: state.shots, hits: state.hits, kills: state.kills })
      }
      if (state.clock - state.lastHurt > PLAYER.regenDelaySeconds && state.health < PLAYER.health) {
        state.health = Math.min(PLAYER.health, state.health + PLAYER.regenPerSecond * step)
        hud.set({ health: state.health })
      }
    } else {
      hud.set({ restartIn: state.restartAt - state.clock })
      if (state.clock >= state.restartAt) restart()
    }
    const marker = level.group.getObjectByName('exfil-marker')
    if (marker) marker.visible = state.exfil
    const screen = hud.get()
    if (screen.subtitles.some(line => line.until <= state.clock)) hud.set({ subtitles: screen.subtitles.filter(line => line.until > state.clock) })
    if (screen.damage.some(item => item.until <= state.clock)) hud.set({ damage: screen.damage.filter(item => item.until > state.clock) })
    if (state.shake > 0.001 && !override.current) {
      const amount = state.shake * state.shake
      camera.rotateX((Math.random() - 0.5) * VIEW.shake.hit * amount)
      camera.rotateZ((Math.random() - 0.5) * VIEW.shake.hit * amount * 0.6)
    }
    if (state.phase === 'dead') camera.rotateZ(state.deathTilt * 0.5)
    state.shake *= Math.exp(-VIEW.shake.decay * step)
    const definition = WEAPONS[arms.weapon]
    const fov = portraitFov(arms.aiming ? definition.adsFov : VIEW.fov, camera.aspect)
    if (!override.current && Math.abs(camera.fov - fov) > 0.01) { camera.fov += (fov - camera.fov) * (1 - Math.exp(-VIEW.fovBlend * step)); camera.updateProjectionMatrix() }
    const texel = 52 / lights.sun.shadow.mapSize.x
    const cx = Math.round(body.position.x / texel) * texel, cz = Math.round(body.position.z / texel) * texel
    lights.sun.target.position.set(cx, 0, cz)
    lights.sun.position.set(cx + atmosphere.sun.direction[0] * 60, atmosphere.sun.direction[1] * 60, cz + atmosphere.sun.direction[2] * 60)
    lights.sun.target.updateMatrixWorld()
    if (PRESENTATION.armsPoseInterleave[phone ? 'phone' : 'desktop'] ? !scratch.parity : Math.round(state.clock * 60) % 2 === 0) gl.shadowMap.needsUpdate = true
    if (!state.firstFrame && presentation) { state.firstFrame = true; setLive(true) }
  }, 0.5)

  const driver = useMemo<Controls>(() => ({
    drive(next: Driver | null) { game.current.drive = next },
    place(position: readonly [number, number, number], yaw: number) { placeBody(body, position); view.yaw = yaw; view.pitch = 0; view.reset = true; syncPlayer() },
    body,
    override(next: CameraPose | null) { const on = next !== null; pose.current = next; override.current = on; setPosed(on); if (!on) { camera.clearViewOffset(); camera.updateProjectionMatrix() } },
    restart,
    face(target: V3) { const dx = target.x - body.position.x, dz = target.z - body.position.z; view.yaw = Math.atan2(-dx, -dz); view.pitch = Math.atan2(target.y - scratch.eye.y, Math.hypot(dx, dz)); view.reset = true },
    targets: () => scratch.targets,
    heal() { game.current.health = PLAYER.health; hud.set({ health: PLAYER.health }) },
  }), [body, camera, restart, scratch, view])

  return <>
    <Look atmosphere={atmosphere} quality={tier} environment sun={lights.sun} fill={lights.fill} overlay={posed ? null : presentation} onReady={opaqueAo} />
    <primitive object={lights.sun} />
    <primitive object={lights.sun.target} />
    <primitive object={lights.fill} />
    <primitive object={lights.flash} />
    <primitive object={lights.enemy} />
    <primitive object={level.group} />
    <Physics gravity={[0, -9.81, 0]} timeStep={1 / (phone ? PRESENTATION.physicsHz.phone : PRESENTATION.physicsHz.desktop)} updatePriority={ALS_FRAME_PRIORITY.Physics}>
      <LevelColliders />
      <StepProbe onStep={useCallback(() => { scratch.stepped = true; for (const ragdoll of game.current.corpses.values()) ragdoll.update() }, [scratch])} onPhysics={useCallback((physics: RapierHandle) => {
        scratch.physics = physics
        if (PRESENTATION.ragdoll[phone ? 'phone' : 'desktop'] === 'corpse') warmCorpseRagdoll(physics.rapier, physics.world)
      }, [scratch, phone])} />
      <Soldiers roster={roster} frozen={frozen} client={squad} handles={handles} phone={phone} />
    </Physics>
    <ArmsViewmodel state={arms} render="external" onPresentation={setPresentation} />
    <StandaloneSubject view={view} onIntent={writeIntent} onFire={useCallback((firing: boolean, aim: { origin: THREE.Vector3; direction: THREE.Vector3 }) => { game.current.firing = firing; game.current.aim.direction.copy(aim.direction) }, [])} onReload={useCallback(() => { game.current.reload = true }, [])} touch={touchInput} recoil={recoil} sensitivity={Math.min(1, camera.fov / VIEW.fov)} recoilKept={0.55} recovery={recovery} />
    <CheckProbe driver={driver} audio={audio} ready={live} overlay={presentation} onWarmed={onFirstFrame} />
  </>
}

function Touch({ touchInput, commands }: { touchInput: TouchInput; commands: Commands }) {
  const [aim, setAim] = useState(false)
  const [crouch, setCrouch] = useState(false)
  return <TouchPad
    onMove={(x, y) => { touchInput.forward = -y; touchInput.right = x }}
    onLook={(dx, dy) => { touchInput.lookX += dx * 1.4; touchInput.lookY += dy * 1.4 }}
    onButton={(id, pressed) => {
      if (id === 'fire') touchInput.fire = pressed
      if (!pressed) return
      if (id === 'aim') { commands.aim = !commands.aim; setAim(commands.aim) }
      if (id === 'crouch') { commands.crouch = !commands.crouch; setCrouch(commands.crouch) }
      if (id === 'jump') commands.jump = true
      if (id === 'reload') commands.reload = true
      if (id === 'swap') commands.swap = true
    }}
    buttons={[{ id: 'fire', label: 'Fire' }, { id: 'aim', label: aim ? 'Hip' : 'Aim' }, { id: 'reload', label: 'Reload' }, { id: 'crouch', label: crouch ? 'Stand' : 'Crouch' }, { id: 'jump', label: 'Jump' }, { id: 'swap', label: 'Swap' }]} />
}

export function Game() {
  const audio = useMemo(createBreachAudio, [])
  const touchInput = useMemo(createStandaloneTouch, [])
  const commands = useMemo<Commands>(() => ({ reload: false, swap: false, aim: false, crouch: false, jump: false, sprint: false }), [])
  const touch = useTouch()
  const tier = useMemo(autoQuality, [])
  const [armsReady, setArmsReady] = useState(false)
  const [world, setWorld] = useState(false)
  const [progress, setProgress] = useState(0.05)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { locked } = useHud('locked')
  const ready = armsReady && world
  useEffect(() => () => audio.dispose(), [audio])
  useEffect(() => {
    let cancelled = false
    const url = new URL(`${import.meta.env.BASE_URL}assets/skm-als.glb`, location.href).href
    void preloadAlsCharacterGltf(url, { onProgress: value => { if (!cancelled && value !== undefined) setProgress(0.05 + value * 0.8) } })
    void Promise.all([texturesReady(), breachTexturesReady(), audio.prepare()]).then(() => { if (!cancelled) setWorld(true) }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [audio])
  const onArms = useCallback(() => { setProgress(1); setArmsReady(true) }, [])
  const onFirstFrame = useCallback(() => setPlaying(true), [])
  return <Screen>
    <Canvas shadows={tier !== 'low'} dpr={internalPixelRatio()} camera={{ fov: VIEW.fov, ...depthDefaults(tier, { far: 260 }).camera, position: [START.position[0], MOVE.eye, START.position[2]] }} gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }} onCreated={state => attachPerfProbe(state.gl)}>
      {world && <Scene tier={tier} audio={audio} touchInput={touchInput} commands={commands} onArms={onArms} onFirstFrame={onFirstFrame} />}
    </Canvas>
    <TitleCard title="Breach" />
    {ready && playing && <Hud touch={touch} />}
    <div className="breach-hints"><Hints visible={!touch} items={[['WASD', 'Move'], ['LMB', 'Fire'], ['RMB', 'Aim'], ['Shift', 'Sprint'], ['C', 'Crouch']]} /></div>
    <Prompt text="Click to fight" visible={ready && playing && !touch && !locked} />
    {touch && ready && <Touch touchInput={touchInput} commands={commands} />}
    <Loading title="Breach" detail={error ?? (progress < 0.85 ? 'Loading the squad' : 'Clearing the rubble')} progress={progress} done={ready && playing} />
  </Screen>
}

function StepProbe({ onStep, onPhysics }: { onStep: () => void; onPhysics: (physics: RapierHandle) => void }) {
  const physics = useRapier()
  useEffect(() => onPhysics(physics), [physics, onPhysics])
  useAfterPhysicsStep(onStep)
  return null
}
