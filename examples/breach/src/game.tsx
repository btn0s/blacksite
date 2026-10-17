import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type RefObject } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CuboidCollider, Physics, RigidBody, useAfterPhysicsStep, useRapier } from '@react-three/rapier'
import { preloadAlsCharacterGltf } from 'als-ue5-r3f/app/AlsCharacterGltf'
import type { AlsRagdollHandle } from 'als-ue5-r3f/app/AlsRemoteActor'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { ALS_RAPIER_GRAVITY } from 'als-ue5-r3f/als/AlsCharacter.hooks'
import type { CameraPose } from '@blacksite/check'
import { Look } from '@blacksite/look/r3f'
import { autoQuality, depthDefaults, type Atmosphere, type QualityTier } from '@blacksite/look'
import { ZONE } from '@blacksite/look/presets'
import type { QueryHit, WeaponEvent } from '@blacksite/armory'
import { InputProvider } from '@blacksite/input'
import { BODY_LAYER, CharacterController, CharacterOverlay, CharacterPause, createCharacterController, useCharacterStatus, useLocalSession, useTouchActive, type AimTarget, type AlsFootstepSoundRequest, type CharacterHandle as Player } from '@blacksite/subject'
import type { ArmsPresentation } from '@blacksite/subject/arms'
import type { Intent } from '@blacksite/warden'
import { attachPerfProbe } from '@blacksite/ui/perf-overlay'
import { internalPixelRatio, setAnisotropy, texturesReady } from '@blacksite/look/world'
import { Loading, Screen, TitleCard } from '@blacksite/ui/hud'
import { createBreachAudio, type BreachAudio } from './audio'
import { PLAYER_ID, type PlayerState } from './authority'
import { CheckProbe, type Controls } from './check'
import { createChips, type Chips } from './chips'
import { createEffects, type Effects } from './effects'
import { SOLIDS, castLevel, castTargets, clearLine, groundHit, zoneMultiplier, type Target, type V3 } from './geometry'
import { Hud } from './hud'
import { ENCOUNTERS, EXFIL, START, footingAt, roomAt } from './layout'
import { breachTexturesReady, buildLevel, type BreachLevel } from './level'
import { AI, CORPSE_RAGDOLL, DEG, FEEDBACK, MOVE, PAD, PLAYER, PRESENTATION, VIEW, WEAPONS, animationBudget, animationInterval, armoryDefinitions, scheduleAnimation, footInterval, type HitZone, type RoomId } from './model'
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

function createPlayer() {
  return createCharacterController({
    views: ['arms'],
    start: START,
    weapons: definitions.map(definition => {
      const id = definition.id as WeaponId
      return { definition, adsFov: WEAPONS[id].adsFov, adsSeconds: WEAPONS[id].adsSeconds, overlay: id === 'pistol' ? 'PistolTwoHanded' : 'Rifle', rumble: PAD.rumble[id] }
    }),
    eye: { stand: MOVE.eye, crouch: MOVE.crouchEye, smoothing: MOVE.eyeSmoothing },
    sprintOutSeconds: MOVE.sprintOutSeconds,
    fov: VIEW.fov,
    look: { mouse: VIEW.sensitivity, touch: VIEW.touchSensitivity },
    padLook: PAD.look,
    ownerId: PLAYER_ID,
    seed: 1,
  })
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

function Scene({ player, now, paused, tier, audio, restartRef, onArms, onFirstFrame }: { player: Player; now: () => number; paused: boolean; tier: QualityTier; audio: BreachAudio; restartRef: { current: () => void }; onArms: () => void; onFirstFrame: () => void }) {
  const camera = useThree(state => state.camera) as THREE.PerspectiveCamera
  const gl = useThree(state => state.gl)
  const scene = useThree(state => state.scene)
  const phone = coarse || tier === 'low'
  const squad = useMemo(() => new SquadClient(now), [now])
  const handles = useMemo(() => new Map<string, RefObject<AlsRagdollHandle | null>>(), [])
  const { level, chips } = useMemo(() => worldFor(tier, phone), [tier, phone])
  const effects = useMemo(() => effectsFor(scene), [scene])
  const arms = player.arms
  const [presentation, setPresentation] = useState<ArmsPresentation | null>(null)
  const [roster, setRoster] = useState<string[]>([])
  const [frozen, setFrozen] = useState<ReadonlySet<string>>(() => new Set())
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
    sun.shadow.camera.layers.enable(BODY_LAYER)
    const fill = new THREE.HemisphereLight()
    const flash = new THREE.PointLight('#ffb36a', 0, 10, 2)
    const enemy = new THREE.PointLight('#ffb070', 0, 8, 2)
    return { sun, fill, flash, enemy }
  }, [tier, phone])
  const game = useRef({
    clock: 0, flash: 0, enemyFlash: 0, health: PLAYER.health as number, lastHurt: -10,
    phase: 'play' as 'play' | 'dead' | 'exfil', restartAt: 0, cleared: [false, false, false], exfil: false, startedAt: 0,
    shots: 0, hits: 0, kills: 0, barkAt: new Map<string, number>(), squadBarkAt: -10, subtitleId: 0, damageId: 0,
    rounds: new Map<string, number>(), down: new Set<string>(), downAt: new Map<string, number>(), laid: new Set<string>(), settled: new Map<string, number>(), dead: new Set<string>(), pushes: new Map<string, THREE.Vector3>(),
    seed: 1, firstFrame: false, sentAt: 0, room: 'yard' as RoomId, deathTilt: 0,
    footsteps: new Map<string, number>(),
    drops: new Map<string, { pivot: THREE.Group; axis: THREE.Vector3; base: number; start: number }>(),
    corpses: new Map<string, CorpseRagdoll>(),
  })
  const scratch = useMemo(() => ({
    right: new THREE.Vector3(), forward: new THREE.Vector3(), muzzle: new THREE.Vector3(), point: new THREE.Vector3(), normal: new THREE.Vector3(),
    from: new THREE.Vector3(), to: new THREE.Vector3(), sample: { x: 0, z: 0, crouch: false, alive: true, yaw: 0 }, targets: [] as Target[], assist: [] as AimTarget[], zones: new Map<string, HitZone>(),
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

  const resetWorld = useCallback(() => {
    const state = game.current
    player.active = true
    player.eyeDrop = 0
    Object.assign(state, { health: PLAYER.health, lastHurt: -10, phase: 'play', cleared: [false, false, false], exfil: false, startedAt: state.clock, shots: 0, hits: 0, kills: 0, squadBarkAt: -10, deathTilt: 0 })
    state.barkAt.clear(); state.rounds.clear(); state.down.clear(); state.downAt.clear(); state.laid.clear(); state.settled.clear(); state.dead.clear(); state.pushes.clear()
    state.footsteps.clear()
    state.drops.clear()
    for (const ragdoll of state.corpses.values()) ragdoll.dispose()
    state.corpses.clear()
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
  }, [chips, player, scratch, squad])

  const restart = useCallback(() => {
    const state = game.current
    state.seed = (state.seed * 7919 + 13) % 100003
    player.respawn(state.seed)
    resetWorld()
  }, [player, resetWorld])
  restartRef.current = restart

  useEffect(() => {
    squad.start()
    const unsubscribe = squad.subscribe(() => setRoster(squad.roster.length ? squad.roster.map(soldier => soldier.id) : soldierIds))
    setRoster(soldierIds)
    resetWorld()
    return () => { unsubscribe(); squad.dispose() }
  }, [resetWorld, squad])

  useEffect(() => { squad.pause(paused) }, [squad, paused])

  useEffect(() => {
    const doc = gl.domElement.ownerDocument
    const start = () => audio.start()
    doc.addEventListener('keydown', start)
    doc.addEventListener('mousedown', start)
    doc.addEventListener('touchstart', start, { passive: true })
    return () => { doc.removeEventListener('keydown', start); doc.removeEventListener('mousedown', start); doc.removeEventListener('touchstart', start) }
  }, [gl, audio])

  const syncPlayer = () => {
    playerState.x = player.eye.x
    playerState.y = player.eye.y
    playerState.z = player.eye.z
    playerState.yaw = player.control.yaw
    playerState.pitch = player.control.pitch
    playerState.crouch = player.crouching
    playerState.moving = player.speed > 0.6
    playerState.sprinting = player.sprinting
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
    audio.hurt(amount)
    const angle = Math.atan2(from.x - player.position.x, from.z - player.position.z)
    const facing = Math.atan2(-Math.sin(player.control.yaw), -Math.cos(player.control.yaw))
    const relative = facing - angle
    player.hurt(amount, Math.sin(relative))
    const now = hud.get()
    hud.set({ health: state.health, damage: [...now.damage.filter(item => item.until > state.clock), { id: ++state.damageId, angle: relative, until: state.clock + 0.9 }].slice(-4) })
    if (state.health <= 0) {
      state.phase = 'dead'
      player.active = false
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
    const time = now() / 1000
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
    state.downAt.set(id, now() / 1000)
    state.laid.add(id)
    freeze(id, true)
  }

  const rest = () => {
    const state = game.current
    const time = now() / 1000
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
    state.downAt.set(id, now() / 1000)
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
    const time = now() / 1000
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
    if (Math.hypot(at.x - player.position.x, at.z - player.position.z) > AI.hearingRange) return
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
      const occluded = !clearLine(event.from, player.eye)
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
    if (event.type === 'switch-started') { audio.equip(); return }
    if (event.type === 'reload-started') { audio.reload(event.weaponId as WeaponId, arms.empty); return }
    if (event.type === 'trigger-blocked' && event.reason === 'empty') { audio.dry(); return }
    if (event.type === 'shot') {
      const pistol = event.weaponId === 'pistol'
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
      squad.shot(player.eye)
      return
    }
    if (event.type === 'damage') {
      const zone = scratch.zones.get(event.targetId) ?? 'chest'
      state.hits++
      squad.damage(event.targetId, event.amount * zoneMultiplier(zone), player.eye)
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

  const footstep = (request: Readonly<AlsFootstepSoundRequest>) => {
    if (request.SoundType === 'Land') return
    const loud = player.sprinting ? 1 : player.crouching ? 0.35 : 0.7
    audio.footstep(footingAt(request.Location.x, request.Location.z), loud * request.VolumeMultiplier)
  }

  const events = {
    onWeapon: handle,
    onFootstep: footstep,
    onLand: (speed: number) => { if (speed > 1.5) audio.footstep(footingAt(player.position.x, player.position.z), Math.min(1, speed / 5), true) },
    onJump: () => audio.footstep(footingAt(player.position.x, player.position.z), 0.5),
  }

  const showWeapon = () => {
    const runtime = player.weapon
    if (!runtime) return
    const snapshot = runtime.snapshot()
    const current = snapshot.weapons.find(entry => entry.id === snapshot.equippedWeaponId)!
    hud.set({
      weapon: snapshot.equippedWeaponId as WeaponId, magazine: current.magazine, reserve: current.reserve, capacity: WEAPONS[snapshot.equippedWeaponId as WeaponId].magazine,
      reloading: snapshot.status.kind === 'reloading', aiming: arms.aiming, spread: Math.min(4, snapshot.spread / DEG + (player.grounded ? 0 : 1.5)),
    })
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
    state.clock += step
    if (state.phase === 'dead') { state.deathTilt = Math.min(1, state.deathTilt + step * 1.6); player.eyeDrop = state.deathTilt * (MOVE.eye - 0.35) }
    showWeapon()
    syncPlayer()
    if (state.clock - state.sentAt > 1 / 30) { state.sentAt = state.clock; squad.player({ ...playerState }) }
    const room = roomAt(player.position.x, player.position.z)
    state.room = room.id
    audio.setListener({ x: player.eye.x, y: player.eye.y, z: player.eye.z, yaw: player.control.yaw }, room.id)
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
    const renderAt = squad.renderTime()
    squad.drain(renderAt, handleSquad)
    const targets = scratch.targets
    targets.length = 0
    scratch.assist.length = 0
    camera.updateMatrixWorld()
    scratch.frustum.setFromProjectionMatrix(scratch.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    const alive = [0, 0, 0]
    for (const soldier of squad.roster) {
      if (soldier.alive) alive[encounterOf.get(soldier.id) ?? 0]!++
      if (!squad.sample(soldier.id, renderAt, scratch.sample)) continue
      const sample = scratch.sample
      const speed = Math.hypot(soldier.vx, soldier.vz)
      if (sample.alive && speed > 0.6 && Math.hypot(sample.x - player.position.x, sample.z - player.position.z) < AI.hearingRange) {
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
      if (sample.alive && !isDown && !waiting) {
        targets.push({ id: soldier.id, x: sample.x, y: 0, z: sample.z, crouch: sample.crouch })
        scratch.assist.push({ id: soldier.id, x: sample.x, y: sample.crouch ? PAD.target.crouchChest : PAD.target.chest, z: sample.z, radius: PAD.target.radius, moving: speed > PAD.target.moving })
      }
      if (!soldier.alive && !state.dead.has(soldier.id)) { state.dead.add(soldier.id); state.kills++; audio.hitMarker(true, false); const screen = hud.get(); hud.set({ marker: screen.marker + 1, markerKind: 'kill' }) }
      if (!sample.alive && !isDown && !state.pushes.has(soldier.id)) {
        const push = new THREE.Vector3(sample.x - player.position.x, 0, sample.z - player.position.z)
        state.pushes.set(soldier.id, push.lengthSq() < 1e-4 ? push.set(0, 0, -1) : push.normalize())
      }
      if (!sample.alive && !isDown && PRESENTATION.ragdoll[phone ? 'phone' : 'desktop'] === 'corpse') {
        fall(soldier.id, { x: soldier.vx, z: soldier.vz })
      } else if (!sample.alive && handleRef && !isDown && ragdollSlot(soldier.id)) {
        const push = state.pushes.get(soldier.id) ?? new THREE.Vector3(0, 0, -1)
        releaseWeaponAim(soldier.id)
        if (handleRef.StartRagdolling({ initialImpulse: { boneName: 'spine_03', impulse: { x: push.x * 38, y: 6, z: push.z * 38 } } })) { state.down.add(soldier.id); state.downAt.set(soldier.id, now() / 1000) }
      } else if (isDown && handleRef?.active && !state.laid.has(soldier.id)) {
        const time = now() / 1000
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
      if (state.exfil && Math.hypot(player.position.x - EXFIL.at[0], player.position.z - EXFIL.at[1]) < EXFIL.radius) {
        state.phase = 'exfil'
        player.active = false
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
    if (state.phase === 'dead') camera.rotateZ(state.deathTilt * 0.5)
    const texel = 52 / lights.sun.shadow.mapSize.x
    const cx = Math.round(player.position.x / texel) * texel, cz = Math.round(player.position.z / texel) * texel
    lights.sun.target.position.set(cx, 0, cz)
    lights.sun.position.set(cx + atmosphere.sun.direction[0] * 60, atmosphere.sun.direction[1] * 60, cz + atmosphere.sun.direction[2] * 60)
    lights.sun.target.updateMatrixWorld()
    if (PRESENTATION.armsPoseInterleave[phone ? 'phone' : 'desktop'] ? !scratch.parity : Math.round(state.clock * 60) % 2 === 0) gl.shadowMap.needsUpdate = true
    if (!state.firstFrame && presentation) { state.firstFrame = true; setLive(true) }
  }, 0.5)

  const driver = useMemo<Controls>(() => ({
    drive(next) { player.drive(next) },
    place(position, yaw) { player.teleport(position, yaw); syncPlayer() },
    player,
    override(next: CameraPose | null) { const on = next !== null; pose.current = next; player.override = on; setPosed(on); if (!on) { camera.clearViewOffset(); camera.updateProjectionMatrix() } },
    restart,
    face(target: V3) { player.face(target) },
    targets: () => scratch.targets,
    heal() { game.current.health = PLAYER.health; hud.set({ health: PLAYER.health }) },
  }), [camera, player, restart, scratch])

  return <>
    <Look atmosphere={atmosphere} quality={tier} environment sun={lights.sun} fill={lights.fill} overlay={posed ? null : presentation} onReady={opaqueAo} />
    <primitive object={lights.sun} />
    <primitive object={lights.sun.target} />
    <primitive object={lights.fill} />
    <primitive object={lights.flash} />
    <primitive object={lights.enemy} />
    <primitive object={level.group} />
    <Physics gravity={[0, -ALS_RAPIER_GRAVITY, 0]} timeStep={1 / 60} updatePriority={ALS_FRAME_PRIORITY.Physics}>
      <LevelColliders />
      <CharacterController controller={player} queries={queries} events={events} aimTargets={() => scratch.assist} onPresentation={setPresentation} />
      <StepProbe onStep={useCallback(() => { scratch.stepped = true; for (const ragdoll of game.current.corpses.values()) ragdoll.update() }, [scratch])} onPhysics={useCallback((physics: RapierHandle) => {
        scratch.physics = physics
        if (PRESENTATION.ragdoll[phone ? 'phone' : 'desktop'] === 'corpse') warmCorpseRagdoll(physics.rapier, physics.world)
      }, [scratch, phone])} />
      <Soldiers roster={roster} frozen={frozen} client={squad} handles={handles} phone={phone} />
    </Physics>
    <CheckProbe driver={driver} audio={audio} ready={live} overlay={presentation} onWarmed={onFirstFrame} viewmodel={() => [...arms.debug.holder, ...arms.debug.clip, ...arms.debug.feel]} />
  </>
}

export function Game() {
  const player = useMemo(createPlayer, [])
  return <InputProvider runtime={player.input}><Shell player={player} /></InputProvider>
}

function Shell({ player }: { player: Player }) {
  const audio = useMemo(createBreachAudio, [])
  const touch = useTouchActive()
  const status = useCharacterStatus(player)
  const session = useLocalSession(player)
  const tier = useMemo(autoQuality, [])
  const restartRef = useRef(() => {})
  const [armsReady, setArmsReady] = useState(false)
  const [world, setWorld] = useState(false)
  const [progress, setProgress] = useState(0.05)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  const live = ready && playing
  return <Screen>
    <Canvas frameloop={session.frameloop} shadows={tier !== 'low'} dpr={internalPixelRatio()} camera={{ fov: VIEW.fov, ...depthDefaults(tier, { far: 260 }).camera, position: [START.position[0], MOVE.eye, START.position[2]] }} gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }} onCreated={state => attachPerfProbe(state.gl)}>
      {world && <Scene player={player} now={session.now} paused={session.paused} tier={tier} audio={audio} restartRef={restartRef} onArms={onArms} onFirstFrame={onFirstFrame} />}
    </Canvas>
    <TitleCard title="Breach" />
    {live && <Hud touch={touch} onRestart={() => restartRef.current()} />}
    <CharacterOverlay controller={player} visible={live} prompt="Click to fight" hintsClassName="breach-hints" />
    {live && status.paused && <CharacterPause controller={player} items={[{ id: 'restart', label: 'Restart', onPress: () => restartRef.current() }]} />}
    <Loading title="Breach" detail={error ?? (progress < 0.85 ? 'Loading the squad' : 'Clearing the rubble')} progress={progress} done={live} />
  </Screen>
}

function StepProbe({ onStep, onPhysics }: { onStep: () => void; onPhysics: (physics: RapierHandle) => void }) {
  const physics = useRapier()
  useEffect(() => onPhysics(physics), [physics, onPhysics])
  useAfterPhysicsStep(onStep)
  return null
}
