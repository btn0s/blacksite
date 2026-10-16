import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Group, Vector3 } from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { createAlsCharacter, refreshLocomotion } from '../../../vendor/als-web/src/als/AlsCharacter'
import { createAlsAnimationInstance, getRelativeAccelerationAmount } from 'als-ue5-r3f/als/AlsAnimationInstance'
import { AlsRemoteCharacter } from '../../../vendor/als-web/src/als/AlsRemoteCharacter'
import { AlsSnapshotBuffer } from 'als-ue5-r3f/als/AlsSnapshotBuffer'
import { ALS_STANDING_CAPSULE_HALF_HEIGHT, createAlsCharacterAnimationControls, resolveAlsMeshRootRelativeY } from 'als-ue5-r3f/als/AlsCharacter.hooks'
import { ALS_MESH_COMPONENT_YAW_RADIANS, unrealYawDegreesToThreeRadians } from '../../../vendor/als-web/src/engine/unrealCoordinateSpace'
import { createMatch } from '@blacksite/relay'
import { isClientMessage } from '@blacksite/protocol'
import { AlsCharacterRecorder } from 'als-ue5-r3f/als/AlsCharacterRecorder'
import { createPawnMoveMessage, toAlsRemoteSnapshot } from './remote-snapshot'

let gltf: GLTF

beforeAll(async () => {
  const bytes = readFileSync(new URL('../../../vendor/als-web/public/assets/skm-als.glb', import.meta.url))
  gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
})

afterEach(() => vi.unstubAllGlobals())

function simulate(speed: number, gait: 'Walking' | 'Running' | 'Sprinting', renderHz: number, crouching = false, velocityScale = 1) {
  vi.stubGlobal('window', {})
  const scene = clone(gltf.scene)
  const root = new Group()
  const mesh = new Group()
  mesh.rotation.y = ALS_MESH_COMPONENT_YAW_RADIANS
  mesh.add(scene)
  root.add(mesh)
  const remote = new AlsRemoteCharacter()
  const buffer = new AlsSnapshotBuffer({ interpolationDelayMs: 100 })
  const animation = createAlsAnimationInstance({
    scene, animations: gltf.animations, groundPredictionSweep: () => null,
    controlRigFootTrace: query => {
      const point = scene.localToWorld(query.start.clone())
      point.y = 0
      return { impactPoint: scene.worldToLocal(point), impactNormal: new Vector3(0, 1, 0) }
    },
  })
  const controls = createAlsCharacterAnimationControls()
  controls.overlayMode = 'Rifle'
  const recorder = new AlsCharacterRecorder(20)
  const character = createAlsCharacter()
  character.gait = character.desiredGait = gait
  character.stance = character.desiredStance = crouching ? 'Crouching' : 'Standing'
  character.locomotionMode = 'Grounded'
  character.locomotionState.hasInput = true
  refreshLocomotion(character, { x: speed * velocityScale, y: 0, z: 0 })
  let now = 1000
  const match = createMatch({ now: () => now })
  match.join('owner', () => {})
  match.join('observer', message => {
    if (message.type === 'state' && message.state.id === 'owner') buffer.push(toAlsRemoteSnapshot(message.state))
  })
  const samples: { t: number; phase: number; planted: number; left: Vector3; right: Vector3; speedCm: number; gait: string }[] = []
  let nextPacket = 0
  for (let frame = 0; frame <= renderHz * 4; frame++) {
    const elapsed = frame / renderHz
    while (nextPacket / 20 <= elapsed + 1e-9) {
      now = 1000 + nextPacket * 50
      const snapshot = recorder.capture(now, { character, controls, position: { x: speed * nextPacket / 20, y: ALS_STANDING_CAPSULE_HALF_HEIGHT, z: 0 } })!
      match.receive('owner', createPawnMoveMessage(snapshot, { forward: 1, right: 0, jump: false, yaw: 0, pitch: 0 }, nextPacket + 1))
      nextPacket++
    }
    const snapshot = buffer.sample(1000 + elapsed * 1000)?.state
    if (!snapshot) continue
    const result = remote.apply(snapshot)
    if (result.jumped) animation.jump()
    root.position.set(snapshot.pos[0], snapshot.pos[1] + resolveAlsMeshRootRelativeY(remote.character.stance, remote.character.locomotionMode), snapshot.pos[2])
    root.rotation.y = unrealYawDegreesToThreeRadians(snapshot.actorYaw)
    root.updateWorldMatrix(true, true)
    animation.refresh(1 / renderHz, remote.controls)
    root.updateWorldMatrix(true, true)
    if (elapsed >= 1) samples.push({ t: elapsed,
      phase: window.__weightTable?.[crouching ? 'clipPhase.crouchFwd' : gait === 'Sprinting' ? 'clipPhase.sprint' : 'MovementPlayer.Forward.phase'] ?? 0,
      planted: animation.getCurveValue('FootPlanted'),
      left: scene.getObjectByName(gait === 'Sprinting' ? 'ball_l' : 'foot_l')!.getWorldPosition(new Vector3()),
      right: scene.getObjectByName(gait === 'Sprinting' ? 'ball_r' : 'foot_r')!.getWorldPosition(new Vector3()),
      speedCm: animation.state.standingMovement.speed,
      gait: remote.character.gait,
    })
  }
  match.leave('owner')
  match.leave('observer')
  return { samples, remote, animation }
}

describe('remote locomotion through recorder, Relay and the shipped ALS graph', () => {
  it('keeps normalized acceleration rounding inside the wire bounds', () => {
    for (const actorYaw of [0, Math.PI / 2]) {
      const controls = createAlsCharacterAnimationControls()
      controls.relativeAccelerationAmount = getRelativeAccelerationAmount({
        actorYaw, acceleration: { x: 20.726913578, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 },
        maxAcceleration: 20.48, maxBrakingDeceleration: 20.48,
      })
      const snapshot = new AlsCharacterRecorder(20).capture(1000, {
        character: createAlsCharacter(), controls, position: { x: 0, y: ALS_STANDING_CAPSULE_HALF_HEIGHT, z: 0 },
      })!
      const message = createPawnMoveMessage(snapshot, { forward: 1, right: 0, jump: false, yaw: 0, pitch: 0 }, 1)
      expect(isClientMessage(message)).toBe(true)
      expect(Math.abs(message.locomotion!.relativeAcceleration.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(message.locomotion!.relativeAcceleration.y)).toBeLessThanOrEqual(1)
    }
  })

  for (const renderHz of [60, 144]) for (const [gait, speed] of [['Walking', 1.75], ['Running', 3.75], ['Sprinting', 6.5]] as const) {
    it(`${gait} at 20 Hz snapshots and ${renderHz} Hz rendering retains locomotion state and stride`, () => {
      const { samples, remote, animation } = simulate(speed, gait, renderHz)
      expect(remote.character.gait).toBe(gait)
      expect(remote.character.locomotionState.speed).toBeCloseTo(speed)
      expect(remote.controls.moving).toBe(true)
      expect(animation.state.standingMovement.speed).toBeCloseTo(speed * 100)
      const phases = samples.map(sample => sample.phase)
      expect(Math.max(...phases) - Math.min(...phases)).toBeGreaterThan(0.8)
      expect(samples.filter((sample, index) => index > 0 && sample.phase < samples[index - 1]!.phase).length).toBeGreaterThanOrEqual(2)
      const planted = samples.map(sample => sample.planted)
      if (gait !== 'Sprinting') expect(Math.max(...planted) - Math.min(...planted)).toBeGreaterThan(1)
      const spans: number[] = []
      for (const side of ['left', 'right'] as const) {
        const minimumHeight = Math.min(...samples.map(sample => sample[side].y))
        let start: Vector3 | undefined
        let extent = 0
        for (const sample of samples) {
          const isPlanted = gait === 'Sprinting' ? sample[side].y < minimumHeight + 0.015 : side === 'left' ? sample.planted < -0.9 : sample.planted > 0.9
          if (!isPlanted) {
            if (start) spans.push(extent)
            start = undefined
            extent = 0
          } else {
            start ??= sample[side]
            extent = Math.max(extent, Math.hypot(sample[side].x - start.x, sample[side].z - start.z))
          }
        }
      }
      expect(spans.length).toBeGreaterThanOrEqual(4)
      expect(Math.max(...spans)).toBeLessThan(0.03)
    }, 30000)
  }

  for (const renderHz of [60, 144]) {
    it(`crouch walking retains its authored cycle at ${renderHz} Hz`, () => {
      const { samples, remote, animation } = simulate(1.5, 'Walking', renderHz, true)
      expect(remote.character.stance).toBe('Crouching')
      expect(remote.controls.stance).toBe('Crouching')
      expect(remote.controls.speed).toBeCloseTo(1.5)
      expect(animation.state.crouchingAmount).toBeGreaterThan(0.99)
      const phases = samples.map(sample => sample.phase)
      expect(Math.max(...phases) - Math.min(...phases)).toBeGreaterThan(0.8)
      expect(samples.filter((sample, index) => index > 0 && sample.phase < samples[index - 1]!.phase).length).toBeGreaterThanOrEqual(2)
    }, 30000)
  }

  it('distinguishes gliding with an advancing clock from an advancing locomotion cycle', () => {
    const { samples, remote, animation } = simulate(3.75, 'Running', 60, false, 0)
    expect(animation.clock.elapsedSeconds).toBeGreaterThan(3.8)
    expect(remote.controls.moving).toBe(false)
    expect(animation.state.standingMovement.speed).toBe(0)
    const phases = samples.map(sample => sample.phase)
    expect(Math.max(...phases) - Math.min(...phases)).toBeLessThan(0.001)
    expect(samples.at(-1)!.left.distanceTo(samples[0]!.left)).toBeGreaterThan(10)
  }, 30000)

  for (const stance of ['Standing', 'Crouching'] as const) {
    it(`round-trips the ${stance} body anchor independently of the mesh root`, () => {
      const character = createAlsCharacter()
      character.stance = stance
      character.locomotionMode = 'Grounded'
      const source = new AlsCharacterRecorder(20).capture(1000, {
        character, controls: createAlsCharacterAnimationControls(), position: { x: 3, y: 0.922, z: -2 },
      })!
      const move = createPawnMoveMessage(source, { forward: 0, right: 0, jump: false, yaw: 0, pitch: 0 }, 1)
      expect(move.position.y).toBeCloseTo(0.022)
      const snapshot = toAlsRemoteSnapshot({ id: 'owner', owner: 'owner', authority: 'owner', t: 1000, health: 100, yaw: 0, pitch: 0, ...move })
      expect(snapshot.pos).toEqual(source.pos)
      expect(snapshot.stance).toBe(source.stance)
      const driver = new AlsRemoteCharacter()
      driver.apply(snapshot)
      expect(snapshot.pos[1] + resolveAlsMeshRootRelativeY(driver.character.stance, driver.character.locomotionMode)).toBeCloseTo(0.002)
    })
  }

  it('preserves capsule anchors, body/view turns, aim, jump/fall and server-selected overlays', () => {
    const remote = new AlsRemoteCharacter()
    const character = createAlsCharacter()
    const controls = createAlsCharacterAnimationControls()
    const recorder = new AlsCharacterRecorder(20)
    const received: ReturnType<typeof toAlsRemoteSnapshot>[] = []
    let now = 1000
    const match = createMatch({ now: () => now })
    match.join('owner', () => {})
    match.join('observer', message => {
      if (message.type === 'state' && message.state.id === 'owner') received.push(toAlsRemoteSnapshot(message.state))
    })
    const send = (seq: number, verticalSpeed: number, height: number) => {
      refreshLocomotion(character, { x: 1.5, y: 0, z: verticalSpeed })
      const snapshot = recorder.capture(now, { character, controls, position: { x: seq * 0.075, y: height + ALS_STANDING_CAPSULE_HALF_HEIGHT, z: 0 } })!
      match.receive('owner', createPawnMoveMessage(snapshot, { forward: 1, right: 0, jump: verticalSpeed > 0, yaw: 0, pitch: 0 }, seq))
      return remote.apply(received.at(-1)!)
    }
    character.gait = 'Walking'
    character.stance = 'Crouching'
    character.rotationMode = 'Aiming'
    character.locomotionMode = 'Grounded'
    character.actorYawAngle = 160
    character.viewYawAngle = 175
    character.viewPitchAngle = 30
    character.desiredAiming = true
    character.locomotionState.hasInput = true
    character.locomotionState.inputYawAngle = 150
    character.locomotionState.targetYawAngle = 165
    controls.overlayMode = 'Rifle'
    controls.relativeAccelerationAmount = { x: 0.2, y: -0.3 }
    expect(send(1, 0, 0).jumped).toBe(false)
    expect(received.at(-1)!.pos).toEqual([0.075, ALS_STANDING_CAPSULE_HALF_HEIGHT, 0])
    expect(remote.character).toMatchObject({ actorYawAngle: 160, viewYawAngle: 175, viewPitchAngle: 30, stance: 'Crouching', rotationMode: 'Aiming', desiredAiming: true })
    expect(remote.controls).toMatchObject({ viewYawAngle: 15, viewPitchAngle: 30, overlayMode: 'Rifle', relativeAccelerationAmount: { x: 0.2, y: -0.3 } })
    now += 50
    character.actorYawAngle = -175
    character.viewYawAngle = -160
    character.stance = 'Standing'
    character.locomotionMode = 'InAir'
    expect(send(2, 4, 0.2).jumped).toBe(true)
    expect(remote.character.locomotionMode).toBe('InAir')
    expect(remote.controls.velocity!.z).toBe(4)
    expect(remote.controls.locomotionYawSpeed).toBeCloseTo(500)
    expect(remote.controls.viewYawSpeed).toBeCloseTo(500)
    expect(remote.controls.viewYawAngle).toBe(15)
    match.receive('owner', { type: 'weapon', seq: 1, weapon: 'pistol', reload: false })
    now += 50
    expect(send(3, -2, 0.1).jumped).toBe(false)
    expect(remote.character.locomotionMode).toBe('InAir')
    expect(remote.controls.velocity!.z).toBe(-2)
    expect(remote.controls.overlayMode).toBe('PistolTwoHanded')
    now += 50
    character.locomotionMode = 'Grounded'
    expect(send(4, 0, 0).jumped).toBe(false)
    expect(remote.character.locomotionMode).toBe('Grounded')
    match.leave('owner')
    match.leave('observer')
  })
})
