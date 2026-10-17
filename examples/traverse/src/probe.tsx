import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { applyCameraPose, exposeCheck, type Bookmark, type CameraPose } from '@blacksite/check'
import { isTouchDevice } from '@blacksite/look/world'
import type { Shared } from './Game'
import * as model from './model'
import { advanceFootContact, contacts, nearPlaneRadius, percentile, type FootSample } from './model'
import { GhostPlayer, GhostRecorder, ghostBytes, modelOf } from './ghost'
import { yawOf } from './runner'

type Vec3 = [number, number, number]

export type CheckResult = { name: string; pass: boolean; metrics: Record<string, number>; limits: Record<string, number>; notes: string[] }

export type ProbeApi = {
  respawn(position: Vec3, yaw: number): void
  restart(): void
}

type Waiter = { at: number; resolve: () => void }
type Recording = { left: FootSample[]; right: FootSample[]; contact: [boolean, boolean]; clipFrames: number; frames: number; cameraLocal: THREE.Vector3[]; times: number[] }

const checkNames = ['start', 'feet-flat', 'stairs', 'slope', 'ramp-foot', 'mantle-ladder', 'actions', 'camera-wall', 'shoulder', 'ghost', 'route'] as const
export type CheckName = (typeof checkNames)[number]

const DEG = Math.PI / 180

const feelLane = { start: [-10, 0, -22] as Vec3, yaw: Math.PI / 2 }

export function Probe({ shared, api }: { shared: Shared; api: ProbeApi }) {
  const { world, rapier } = useRapier()
  const { camera, gl, scene } = useThree()
  const clock = useRef(0)
  const waiters = useRef<Waiter[]>([])
  const recording = useRef<Recording | null>(null)
  const last = useRef<Recording | null>(null)
  const ankle = useRef<number | null>(null)
  const ankleSamples = useRef<number[]>([])
  const override = useRef<CameraPose | null>(null)
  const exposed = useRef<ReturnType<typeof exposeCheck> | null>(null)
  const busy = useRef(false)
  const drawCalls = useRef<number[] | null>(null)
  const scratch = useMemo(() => ({ center: new THREE.Vector3(), forward: new THREE.Vector3(), inverse: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0) }), [])

  const fixedOnly = (collider: { parent(): { isFixed(): boolean } | null }) => collider.parent()?.isFixed() ?? true

  const groundBelow = (x: number, y: number, z: number) => {
    const hit = world.castRay(new rapier.Ray({ x, y: y + 0.6, z }, { x: 0, y: -1, z: 0 }), 3, true, undefined, undefined, undefined, undefined, fixedOnly as never)
    return hit ? y + 0.6 - hit.timeOfImpact : -Infinity
  }

  const faceDistance = (x: number, y: number, z: number, yaw: number) => {
    const hit = world.castRay(new rapier.Ray({ x, y, z }, { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) }), 4, true, undefined, undefined, undefined, undefined, fixedOnly as never)
    return hit ? hit.timeOfImpact : Infinity
  }

  const cameraClips = () => {
    const perspective = camera as THREE.PerspectiveCamera
    const near = perspective.near
    const halfHeight = Math.tan(perspective.fov * Math.PI / 360) * near
    const halfWidth = halfHeight * perspective.aspect
    camera.getWorldDirection(scratch.forward)
    scratch.center.copy(camera.position).addScaledVector(scratch.forward, near / 2)
    const shape = new rapier.Cuboid(halfWidth, halfHeight, near / 2)
    const q = camera.quaternion
    const hit = world.intersectionWithShape(scratch.center, { x: q.x, y: q.y, z: q.z, w: q.w }, shape, undefined, undefined, undefined, undefined, fixedOnly as never)
    return hit !== null
  }

  useFrame((_, delta) => {
    clock.current += delta
    const now = clock.current
    const sample = shared.runner.als.pose.current
    const character = sample.character
    const grounded = character?.locomotionMode === 'Grounded' && character.locomotionAction === null
    if (sample.ready && grounded && ankle.current === null && character && character.locomotionState.speed < 0.05) {
      const lowest = Math.min(sample.leftFoot.y, sample.rightFoot.y) - sample.ground.y
      ankleSamples.current.push(lowest)
      if (ankleSamples.current.length >= 30) ankle.current = percentile(ankleSamples.current, 0.5)
    }
    const record = recording.current
    if (record && sample.ready) {
      const offset = ankle.current ?? 0.1
      record.frames++
      for (const [foot, list, lock, sign, index] of [[sample.leftFoot, record.left, sample.leftFootLock, -1, 0], [sample.rightFoot, record.right, sample.rightFootLock, 1, 1]] as const) {
        const ground = groundBelow(foot.x, foot.y, foot.z) + offset
        const contact = advanceFootContact(record.contact[index], { grounded, lock, gap: foot.y - ground, phase: sample.footPlant * sign })
        record.contact[index] = contact.groundedContact
        const planted = contact.planted
        list.push({ t: now, x: foot.x, y: foot.y, z: foot.z, ground, grounded, planted, plant: sample.footPlant, lock })
      }
      if (cameraClips()) record.clipFrames++
      scratch.inverse.setFromAxisAngle(scratch.up, -sample.characterYaw)
      record.cameraLocal.push(camera.position.clone().sub(sample.pelvis).applyQuaternion(scratch.inverse))
      record.times.push(now)
    }
    const ready = waiters.current.filter(waiter => waiter.at <= now)
    if (ready.length) {
      waiters.current = waiters.current.filter(waiter => waiter.at > now)
      for (const waiter of ready) waiter.resolve()
    }
  }, ALS_FRAME_PRIORITY.Camera + 0.2)

  useFrame(state => {
    const check = exposed.current
    if (check && !check.probe.ready && shared.runner.als.pose.current.ready) check.ready()
    const pose = override.current
    if (pose) applyCameraPose(camera as Parameters<typeof applyCameraPose>[0], pose, state.size)
  }, ALS_FRAME_PRIORITY.Camera + 0.05)

  useEffect(() => {
    const originalRender = gl.render
    let calls = 0
    let pending = false
    gl.render = function (...args) {
      const previous = gl.info.autoReset ? 0 : gl.info.render.calls
      originalRender.apply(gl, args)
      if (!drawCalls.current) return
      calls += gl.info.render.calls - previous
      if (pending) return
      pending = true
      queueMicrotask(() => { drawCalls.current?.push(calls); calls = 0; pending = false })
    }
    return () => { gl.render = originalRender }
  }, [gl])

  useEffect(() => {
    const wait = (seconds: number) => new Promise<void>(resolve => waiters.current.push({ at: clock.current + seconds, resolve }))
    const frame = () => wait(0)
    const until = async (test: () => boolean, timeout: number) => {
      const end = clock.current + timeout
      while (clock.current < end) { if (test()) return true; await frame() }
      return test()
    }
    const runner = shared.runner
    const command = { forward: 0, right: 0, sprint: false, walk: false, crouch: false, jump: false, fire: false, aim: false }
    const steer = (heading: number) => { runner.control.yaw = yawOf(heading) }
    const tilt = (degrees: number) => { runner.control.pitch = degrees * DEG }
    const script = (on: boolean) => runner.drive(on ? command : null)
    const character = () => shared.runner.als.pose.current.character
    const position = () => shared.runner.als.pose.current.ground
    const idle = () => { command.forward = 0; command.right = 0; command.sprint = false; command.walk = false; command.crouch = false }
    const face = (x: number, z: number) => {
      const p = position()
      steer(Math.atan2(z - p.z, x - p.x))
    }

    const place = async (at: Vec3, yaw: number) => {
      idle()
      api.respawn(at, yaw)
      await wait(0.3)
      const settled = await until(() => {
        const c = character()
        return !!c && shared.runner.als.pose.current.ready && c.locomotionMode === 'Grounded' && c.locomotionAction === null && position().distanceTo(new THREE.Vector3(...at)) < 1.5
      }, 4)
      if (!settled) throw new Error(`could not place runner at ${at.join(', ')}`)
      await wait(0.5)
    }

    const follow = async (points: Vec3[], options: { sprint?: boolean; walk?: boolean; timeout?: number; reach?: number } = {}) => {
      command.sprint = !!options.sprint
      command.walk = !!options.walk
      const reach = options.reach ?? 0.6
      for (const point of points) {
        const ok = await until(() => {
          face(point[0], point[2])
          command.forward = 1
          const p = position()
          return Math.hypot(point[0] - p.x, point[2] - p.z) < reach
        }, options.timeout ?? 8)
        if (!ok) { idle(); return false }
      }
      idle()
      return true
    }

    const start = () => { recording.current = { left: [], right: [], contact: [false, false], clipFrames: 0, frames: 0, cameraLocal: [], times: [] } }
    const stop = () => { const result = recording.current!; recording.current = null; last.current = result; return result }

    const slide = (record: Recording) => {
      const planted = [...contacts(record.left), ...contacts(record.right)]
      const gaps: number[] = []
      for (const list of [record.left, record.right]) {
        for (let index = 1; index < list.length; index++) {
          const a = list[index - 1]!
          const b = list[index]!
          const dt = b.t - a.t
          if (dt <= 0 || !b.grounded || !b.planted || !Number.isFinite(b.ground)) continue
          const height = b.y - b.ground
          gaps.push(Math.abs(height))
        }
      }
      return {
        contacts: planted.length,
        driftP95: percentile(planted.map(contact => contact.drift), 0.95),
        excursionP95: percentile(planted.map(contact => contact.excursion), 0.95),
        jitterMm: percentile(planted.map(contact => contact.jitter), 0.5) * 1000,
        gapP95: percentile(gaps, 0.95),
        terminalGap: Math.max(...[record.left, record.right].map(list => { const foot = list[list.length - 1]; return foot && Number.isFinite(foot.ground) ? Math.abs(foot.y - foot.ground) : Infinity })),
        clipFrames: record.clipFrames,
      }
    }

    const result = (name: string, metrics: Record<string, number>, limits: Record<string, number>, pass: boolean, notes: string[] = []): CheckResult => ({ name, pass, metrics, limits, notes })

    const route = shared.route
    const runs: Record<CheckName, (measure?: boolean) => Promise<CheckResult>> = {
      async 'feet-flat'() {
        await place(feelLane.start, feelLane.yaw)
        start()
        const run = await follow([[-10, 0, -11]])
        const walk = await follow([[-10, 0, -7]], { walk: true })
        const sprint = await follow([[-10, 0, 7.5]], { sprint: true })
        await wait(0.8)
        const m = slide(stop())
        const limits = { driftP95: model.feet.flatDriftP95, excursionP95: model.feet.excursionP95, gapP95: model.feet.plantedGap, clipFrames: model.camera.clipFrames }
        return result('feet-flat', { ...m, reached: run && walk && sprint ? 1 : 0 }, limits, run && walk && sprint && m.contacts > 12 && m.driftP95 <= limits.driftP95 && m.excursionP95 <= limits.excursionP95 && m.gapP95 <= limits.gapP95 && m.terminalGap <= limits.gapP95 && m.clipFrames <= limits.clipFrames, [`ankle ${(ankle.current ?? 0).toFixed(3)} m; authored stance phases include start, gait changes and stop`])
      },
      async start() {
        await place(feelLane.start, feelLane.yaw)
        await wait(1.2)
        const samples: number[][] = []
        const began = clock.current
        steer(feelLane.yaw)
        script(false)
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }))
        await until(() => {
          const body = shared.runner.als.pose.current.ownerRigidBody!.translation()
          const seen = position()
          samples.push([clock.current - began, body.x, body.z, seen.x, seen.z])
          return clock.current - began > 1.2
        }, 2)
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w' }))
        script(true)
        idle()
        const reach = (offset: number) => {
          for (let index = 1; index < samples.length; index++) {
            let back = index - 1
            while (back > 0 && samples[index]![0]! - samples[back]![0]! < 0.05) back--
            const dt = samples[index]![0]! - samples[back]![0]!
            const speed = Math.hypot(samples[index]![offset]! - samples[back]![offset]!, samples[index]![offset + 1]! - samples[back]![offset + 1]!) / dt
            if (speed >= 0.9 * model.locomotion.run) return samples[index]![0]!
          }
          return -1
        }
        await wait(0.8)
        const ground = position().y
        let apex = 0
        runner.jump()
        await until(() => { apex = Math.max(apex, position().y - ground); return apex > 0.3 && character()?.locomotionMode === 'Grounded' }, 2)
        const seen = reach(3)
        const latency = Math.abs(seen - model.feel.timeToTopSpeed) / model.feel.timeToTopSpeed
        const jumpError = Math.abs(apex - model.feel.jumpApex) / model.feel.jumpApex
        return result('start', { body: reach(1), seen, jumpApex: apex }, { timeToTopSpeed: model.feel.timeToTopSpeed, jumpApex: model.feel.jumpApex }, latency <= 0.25 && jumpError <= model.feel.tolerance)
      },
      async stairs() {
        const flights = route.stairs
        const first = flights[0]!
        const back = new THREE.Vector3(first.from[0] - first.to[0], 0, first.from[2] - first.to[2]).normalize().multiplyScalar(2.5)
        await place([first.from[0] + back.x, first.from[1], first.from[2] + back.z], Math.atan2(-back.z, -back.x))
        start()
        const path: Vec3[] = []
        for (const flight of flights) path.push(flight.from, flight.to)
        const reached = await follow(path, { reach: 0.45, timeout: 10 })
        await wait(0.6)
        const m = slide(stop())
        const limits = { driftP95: model.feet.unevenDriftP95, excursionP95: model.feet.excursionP95, gapP95: model.feet.plantedGap, clipFrames: model.camera.clipFrames }
        return result('stairs', { ...m, reached: reached ? 1 : 0 }, limits, reached && m.contacts > 8 && m.driftP95 <= limits.driftP95 && m.excursionP95 <= limits.excursionP95 && m.gapP95 <= limits.gapP95 && m.terminalGap <= limits.gapP95 && m.clipFrames <= limits.clipFrames)
      },
      async slope() {
        const metrics: Record<string, number> = {}
        let pass = true
        const notes: string[] = []
        for (const ramp of route.ramps) {
          const along = new THREE.Vector3(ramp.to[0] - ramp.from[0], 0, ramp.to[2] - ramp.from[2]).normalize()
          const up = ramp.to[1] > ramp.from[1]
          const approach = up ? 2.5 : 0.8
          await place([ramp.from[0] - along.x * approach, ramp.from[1], ramp.from[2] - along.z * approach], Math.atan2(along.z, along.x))
          start()
          const reached = await follow([ramp.from, ramp.to, [ramp.to[0] + along.x * 2, ramp.to[1], ramp.to[2] + along.z * 2]], { timeout: 10, reach: 0.8 })
          await wait(1.2)
          const m = slide(stop())
          const key = ramp.label.replace(/\W+/g, '-')
          metrics[`${key}.driftP95`] = m.driftP95
          metrics[`${key}.excursionP95`] = m.excursionP95
          metrics[`${key}.gapP95`] = m.gapP95
          metrics[`${key}.degrees`] = ramp.degrees
          metrics[`${key}.reached`] = +reached
          metrics[`${key}.contacts`] = m.contacts
          metrics[`${key}.clipFrames`] = m.clipFrames
          metrics[`${key}.terminalGap`] = m.terminalGap
          const ok = reached && m.contacts > 4 && m.driftP95 <= model.feet.unevenDriftP95 && m.excursionP95 <= model.feet.excursionP95 && m.gapP95 <= model.feet.plantedGap && m.terminalGap <= model.feet.plantedGap && m.clipFrames === 0
          if (!ok) notes.push(`${ramp.label} ${up ? 'up' : 'down'} ${ramp.degrees}° reached ${reached} contacts ${m.contacts} drift ${m.driftP95.toFixed(3)} excursion ${m.excursionP95.toFixed(3)} gap ${m.gapP95.toFixed(3)}`)
          pass &&= ok
        }
        return result('slope', metrics, { driftP95: model.feet.unevenDriftP95, excursionP95: model.feet.excursionP95, gapP95: model.feet.plantedGap }, pass, notes)
      },
      async 'ramp-foot'() {
        const notes: string[] = []
        let runs = 0
        let stalls = 0
        for (const ramp of route.ramps.filter(ramp => ramp.to[1] > ramp.from[1])) {
          const along = new THREE.Vector3(ramp.to[0] - ramp.from[0], 0, ramp.to[2] - ramp.from[2]).normalize()
          const yaw = Math.atan2(along.z, along.x)
          for (const gait of ['run', 'sprint'] as const) for (let phase = 0; phase < 12; phase++) {
            const back = 4 + phase * 0.009
            await place([ramp.from[0] - along.x * back, ramp.from[1], ramp.from[2] - along.z * back], yaw)
            command.sprint = gait === 'sprint'
            const goal = 2
            const ok = await until(() => {
              steer(yaw)
              command.forward = 1
              const p = position()
              return (p.x - ramp.from[0]) * along.x + (p.z - ramp.from[2]) * along.z > goal
            }, 3)
            idle()
            runs++
            if (!ok) {
              stalls++
              const c = character()
              const p = position()
              notes.push(`${gait} ${ramp.label} phase ${phase} stalled at [${p.toArray().map(v => v.toFixed(3)).join(', ')}] speed ${c?.locomotionState.speed.toFixed(2)} mode ${c?.locomotionMode}`)
            }
          }
        }
        return result('ramp-foot', { runs, stalls }, { stalls: 0 }, runs > 0 && stalls === 0, notes)
      },
      async 'mantle-ladder'() {
        const metrics: Record<string, number> = {}
        const notes: string[] = []
        let passed = 0
        for (const gait of ['walk', 'run', 'sprint'] as const) for (const ledge of route.ledges) {
          await place(ledge.approach, ledge.yaw)
          command.walk = gait === 'walk'
          command.sprint = gait === 'sprint'
          const top = ledge.base + ledge.height
          let highest = position().y
          const origin = position().clone()
          const expectedFace = faceDistance(origin.x, origin.y + 0.3, origin.z, ledge.yaw)
          let missed = false
          const began = clock.current
          let mantled = -1
          let jumps = 0
          let pressedAt = -1
          const completed = await until(() => {
            const c = character()
            steer(ledge.yaw)
            command.forward = 1
            const p = position()
            const along = (p.x - origin.x) * Math.cos(ledge.yaw) + (p.z - origin.z) * Math.sin(ledge.yaw)
            if (c?.locomotionAction === 'Mantling' && mantled < 0) {
              if (along < expectedFace - 1 || along > expectedFace + 0.5) missed = true
              else mantled = clock.current
            }
            if (mantled < 0 && along > expectedFace + 0.8) missed = true
            if (missed) return true
            highest = Math.max(highest, p.y)
            const face = faceDistance(p.x, p.y + 0.3, p.z, ledge.yaw)
            if (c?.locomotionMode === 'Grounded' && c.locomotionAction === null && face < 0.7 && clock.current - pressedAt > 0.3 && jumps < 6) { jumps++; pressedAt = clock.current; runner.jump() }
            return highest >= top - 0.12 && mantled >= 0 && c?.locomotionAction === null && c.locomotionMode === 'Grounded'
          }, 7)
          const reached = completed && !missed
          idle()
          const key = `${gait} ${ledge.label} ${ledge.height.toFixed(2)}`
          const climb = mantled >= 0 ? clock.current - mantled : -1
          metrics[`${key}.seconds`] = reached ? clock.current - began : -1
          metrics[`${key}.mantleSeconds`] = climb
          const ok = reached && mantled >= 0 && climb <= model.mantle.reachTopWithin
          if (ok) passed++
          else notes.push(`${key}: ${missed ? 'passed the intended face without mantling it' : !reached ? 'did not reach the top' : mantled < 0 ? 'reached without a mantle' : `mantle took ${climb.toFixed(2)} s`} after ${jumps} jump presses`)
        }
        const rate = passed / (route.ledges.length * 3)
        metrics.successRate = rate
        return result('mantle-ladder', metrics, { successRate: model.mantle.successRate, reachTopWithin: model.mantle.reachTopWithin }, rate >= model.mantle.successRate, notes)
      },
      async 'camera-wall'() {
        let clips = 0
        let frames = 0
        const spots: { at: Vec3; yaw: number; back: boolean }[] = [
          { at: [37.6, 0, -1.6], yaw: -Math.PI / 2, back: true },
          { at: [route.bookmarks.find(b => b.name === 'stairwell')!.stand[0], route.bookmarks.find(b => b.name === 'stairwell')!.stand[1], route.bookmarks.find(b => b.name === 'stairwell')!.stand[2]], yaw: 0, back: false },
          { at: [11.4, 0, -8.6], yaw: Math.PI / 2, back: true },
          { at: [4, 0, 1.4], yaw: 0, back: false },
        ]
        for (const spot of spots) {
          await place(spot.at, spot.yaw)
          start()
          const began = clock.current
          const baseYaw = runner.control.yaw
          await until(() => {
            const t = (clock.current - began) / 4
            runner.control.yaw = baseYaw - 2 * Math.PI * t
            tilt(-55 + 95 * (0.5 + 0.5 * Math.sin(t * Math.PI * 4)))
            command.forward = spot.back ? -0.6 : 0
            return t >= 1
          }, 5)
          idle()
          const record = stop()
          clips += record.clipFrames
          frames += record.frames
        }
        tilt(model.input.pitch)
        return result('camera-wall', { clipFrames: clips, frames, nearRadius: nearPlaneRadius((camera as THREE.PerspectiveCamera).near, (camera as THREE.PerspectiveCamera).fov, (camera as THREE.PerspectiveCamera).aspect) }, { clipFrames: model.camera.clipFrames }, frames > 100 && clips <= model.camera.clipFrames)
      },
      async actions() {
        await place(feelLane.start, feelLane.yaw)
        start()
        command.forward = 1
        await wait(0.6)
        runner.roll()
        const rolled = await until(() => character()?.locomotionAction === 'Rolling', 1)
        const rollRecovered = await until(() => character()?.locomotionAction === null && character()?.locomotionMode === 'Grounded', 4)
        idle()
        runner.ragdoll()
        const ragdolled = await until(() => character()?.locomotionAction === 'Ragdolling', 1)
        await wait(0.8)
        runner.ragdoll()
        const gotUp = await until(() => character()?.locomotionAction === null && character()?.locomotionMode === 'Grounded', 6)
        const first = stop()
        await place([23, 0, 0.6], 0)
        start()
        command.forward = 1
        command.sprint = true
        let lowMantleSeen = false
        let pressed = false
        const lowObstacleCrossed = await until(() => {
          const c = character()
          const p = position()
          if (!pressed && faceDistance(p.x, p.y + 0.3, p.z, 0) < 0.65) { pressed = true; runner.jump() }
          if (c?.locomotionAction === 'Mantling') lowMantleSeen = true
          return p.x > 27 && p.y < 0.2 && c?.locomotionMode === 'Grounded' && c.locomotionAction === null
        }, 5)
        idle()
        const vault = stop()
        await place([39, 2.89, -5.6], Math.PI)
        start()
        command.forward = 1
        const fell = await until(() => character()?.locomotionMode === 'InAir', 4)
        const landed = await until(() => position().y < 0.15 && character()?.locomotionMode === 'Grounded', 4)
        idle()
        await wait(0.5)
        const second = stop()
        const clipFrames = first.clipFrames + vault.clipFrames + second.clipFrames
        return result('actions', { rolled: +rolled, rollRecovered: +rollRecovered, ragdolled: +ragdolled, gotUp: +gotUp, lowMantleSeen: +lowMantleSeen, lowObstacleCrossed: +lowObstacleCrossed, fell: +fell, landed: +landed, clipFrames }, { clipFrames: 0 }, rolled && rollRecovered && ragdolled && gotUp && lowMantleSeen && lowObstacleCrossed && fell && landed && clipFrames === 0, ['low obstacle crossing holds forward continuously and uses the authored low mantle followed by its exit; no dedicated vault clip'])
      },
      async shoulder() {
        const steps: number[] = []
        const settle: number[] = []
        const travel: number[] = []
        let clips = 0
        for (const gait of ['idle', 'walk', 'run', 'sprint'] as const) {
          await place(feelLane.start, feelLane.yaw)
          command.forward = gait === 'idle' ? 0 : 1
          command.walk = gait === 'walk'
          command.sprint = gait === 'sprint'
          await wait(0.8)
          for (let swap = 0; swap < 2; swap++) {
            start()
            await wait(0.1)
            runner.swapShoulder()
            const swapped = clock.current
            await wait(1.2)
            const record = stop()
            clips += record.clipFrames
            const points = record.cameraLocal
            const from = points[0]!
            const to = points[points.length - 1]!
            const distance = from.distanceTo(to)
            travel.push(distance)
            let settled = -1
            for (let index = 1; index < points.length; index++) {
              steps.push(points[index]!.distanceTo(points[index - 1]!) * model.locomotion.physicsStep / Math.max(model.locomotion.physicsStep, record.times[index]! - record.times[index - 1]!))
              if (record.times[index]! >= swapped && settled < 0 && points[index]!.distanceTo(to) < distance * 0.1) settled = record.times[index]! - swapped
            }
            settle.push(settled)
          }
          idle()
        }
        const maxStep = Math.max(...steps)
        const seconds = Math.max(...settle)
        const minTravel = Math.min(...travel)
        return result('shoulder', { maxStep, seconds, minTravel, clipFrames: clips, swaps: travel.length }, { maxStep: model.camera.shoulderMaxStep, seconds: model.camera.shoulderSwapSeconds, minTravel: model.camera.shoulderOffset * 1.6, clipFrames: 0 }, maxStep <= model.camera.shoulderMaxStep && settle.every(seconds => seconds > 0 && seconds <= model.camera.shoulderSwapSeconds) && minTravel >= model.camera.shoulderOffset * 1.6 && clips === 0)
      },
      async ghost() {
        await place(feelLane.start, feelLane.yaw)
        const root = shared.runner.als.pose.current.rootBone
        const source = root && modelOf(root)
        if (!source) return result('ghost', {}, {}, false, ['character model unavailable'])
        const recorder = new GhostRecorder(source)
        const began = clock.current
        command.forward = 1
        await until(() => { recorder.sample(clock.current - began); return clock.current - began >= 2 }, 3)
        idle()
        const take = recorder.take(clock.current - began)
        const ghost = new GhostPlayer(source)
        ghost.load(take)
        const costs: number[] = []
        for (let batch = 0; batch < 20; batch++) {
          const begin = performance.now()
          for (let frame = 0; frame < 100; frame++) ghost.pose(((frame + batch) % 100) / 100 * ghost.duration)
          costs.push((performance.now() - begin) / 100)
          await frame()
        }
        const sourceWorldScale = source.getWorldScale(new THREE.Vector3()).length() / Math.sqrt(3)
        const sourceLocalScale = source.scale.length() / Math.sqrt(3)
        const ghostScale = ghost.object.getWorldScale(new THREE.Vector3()).length() / Math.sqrt(3)
        ghost.dispose()
        const bytesPerMinute = ghostBytes(take) / take.frames * take.hz * 60
        const poseMs = percentile(costs, 0.95)
        const scaleError = Math.abs(ghostScale - sourceWorldScale) / sourceWorldScale
        return result('ghost', { bones: take.bones, moving: take.moving, frames: take.frames, bytesPerMinute, poseMs, sourceWorldScale, sourceLocalScale, ghostScale, scaleError }, { bytesPerMinute: model.route.ghostBytesPerMinute, poseMs: model.route.ghostMsPerFrame, scaleError: 0.001 }, take.frames >= 30 && bytesPerMinute <= model.route.ghostBytesPerMinute && poseMs <= model.route.ghostMsPerFrame && scaleError <= 0.001)
      },
      async route(measure = true) {
        const fresh = shared.race.current.state === 'ready' && character()?.locomotionMode === 'Grounded' && position().distanceTo(new THREE.Vector3(...route.spawn)) < 0.25
        if (!fresh) {
          await place(route.spawn, route.spawnYaw)
          api.restart()
        }
        await wait(0.4)
        if (measure) start()
        drawCalls.current = []
        const began = clock.current
        const notes: string[] = []
        let pressedAt = -1
        const previous = new THREE.Vector3()
        let retreat = false
        command.sprint = true
        for (let index = 0; index < route.line.length; index++) {
          const point = route.line[index]!
          let highest = position().y
          const ok = await until(() => {
            const c = character()
            const p = position()
            highest = Math.max(highest, p.y)
            const yaw = Math.atan2(point.at[2] - p.z, point.at[0] - p.x)
            steer(yaw)
            command.forward = 1
            const near = Math.hypot(point.at[0] - p.x, point.at[2] - p.z) < 3 && point.action === 'mantle'
            const flat = Math.hypot(point.at[0] - p.x, point.at[2] - p.z)
            const next = route.line[index + 1]
            const nextYaw = next ? Math.atan2(next.at[2] - point.at[2], next.at[0] - point.at[0]) : yaw
            const turning = Math.abs(Math.atan2(Math.sin(nextYaw - yaw), Math.cos(nextYaw - yaw))) > Math.PI / 4
            command.walk = flat < 1.5 && turning && !point.action
            command.sprint = !near && !command.walk && !route.zones.some(zone => zone.kind === 'stairwell' && p.x > zone.min[0] && p.x < zone.max[0] && p.z > zone.min[2] && p.z < zone.max[2])
            const free = c?.locomotionMode === 'Grounded' && c.locomotionAction === null && clock.current - pressedAt > 0.35
            if (free && point.action === 'mantle' && faceDistance(p.x, p.y + 0.3, p.z, yaw) < 0.7) { pressedAt = clock.current; runner.jump() }
            if (point.action === 'jump') {
              const from = route.line[index - 1]!.at
              const length = Math.hypot(point.at[0] - from[0], point.at[2] - from[2])
              const dx = (point.at[0] - from[0]) / length
              const dz = (point.at[2] - from[2]) / length
              steer(Math.atan2(point.at[2] + dz * 2 - p.z, point.at[0] + dx * 2 - p.x))
              const along = (p.x - point.at[0]) * dx + (p.z - point.at[2]) * dz
              const lateral = Math.abs((p.x - point.at[0]) * dz - (p.z - point.at[2]) * dx)
              const moved = Math.hypot(p.x - previous.x, p.z - previous.z)
              const aligned = moved > 0 && ((p.x - previous.x) * dx + (p.z - previous.z) * dz) / moved > 0.8
              previous.copy(p)
              if (free && along > -0.6 && lateral < 1.2 && aligned) { pressedAt = clock.current; runner.jump(); return true }
              if (along > 0.2) retreat = true
              if (retreat && Math.hypot(from[0] - p.x, from[2] - p.z) < 0.6) retreat = false
              if (retreat) steer(Math.atan2(from[2] - p.z, from[0] - p.x))
              return false
            }
            if (point.action === 'mantle' && highest >= point.at[1] - 0.12 && c?.locomotionAction === null && c.locomotionMode === 'Grounded') {
              const from = route.line[Math.max(0, index - 1)]!.at
              const length = Math.hypot(point.at[0] - from[0], point.at[2] - from[2])
              const dx = (point.at[0] - from[0]) / length
              const dz = (point.at[2] - from[2]) / length
              const along = (p.x - point.at[0]) * dx + (p.z - point.at[2]) * dz
              const lateral = Math.abs((p.x - point.at[0]) * dz - (p.z - point.at[2]) * dx)
              return along >= -0.5 && lateral < 0.8
            }
            return flat < 0.6 && Math.abs(p.y - point.at[1]) < 0.6 && (!point.action || c?.locomotionAction === null && c.locomotionMode === 'Grounded')
          }, 9)
          if (!ok) { notes.push(`stuck before waypoint ${index} [${point.at.map(v => v.toFixed(1)).join(', ')}] at [${position().toArray().map(v => v.toFixed(1)).join(', ')}]`); break }
        }
        await until(() => shared.race.current.state === 'finished', 3)
        idle()
        const m = measure ? slide(stop()) : { clipFrames: 0, driftP95: 0 }
        const calls = drawCalls.current
        drawCalls.current = null
        const drawCallsP95 = percentile(calls, 0.95)
        const drawCallsMax = Math.max(0, ...calls)
        const drawLimit = isTouchDevice() ? model.frame.phoneDrawCalls : model.frame.desktopDrawCalls
        const race = shared.race.current
        const finished = race.state === 'finished'
        const time = finished ? race.splits[race.splits.length - 1] ?? -1 : -1
        return result('route', { finished: finished ? 1 : 0, time, wall: clock.current - began, gates: race.next, clipFrames: m.clipFrames, driftP95: m.driftP95, drawCallsP95, drawCallsMax }, { par: model.route.parSeconds, gold: model.route.goldSeconds, clipFrames: model.camera.clipFrames, drawCalls: drawLimit }, finished && time <= model.route.parSeconds && m.clipFrames <= model.camera.clipFrames && drawCallsP95 <= drawLimit, notes)
      },
    }

    const run = async (name: CheckName) => {
      if (busy.current) throw new Error('a check is already running')
      busy.current = true
      last.current = null
      script(true)
      try {
        return await runs[name]()
      } finally {
        idle()
        script(false)
        busy.current = false
        api.restart()
      }
    }

    let posedBookmark: string | null = null
    const setCamera = (pose: CameraPose | null) => {
      if (!pose && override.current) (camera as THREE.PerspectiveCamera).clearViewOffset()
      const bookmark = pose && route.bookmarks.find(entry => entry.position.every((value, index) => value === pose.position[index]) && entry.target.every((value, index) => value === pose.target[index]) && entry.fov === pose.fov)
      if (bookmark && posedBookmark !== bookmark.name) {
        idle()
        if (shared.race.current.state !== 'ready') api.restart()
        api.respawn(bookmark.stand, bookmark.yaw)
        posedBookmark = bookmark.name
      } else if (!pose) posedBookmark = null
      override.current = pose
    }

    const scripted = async (body: () => Promise<void>) => {
      script(true)
      try { await body() } finally { idle(); script(false) }
    }

    const bookmarks: Bookmark[] = [
      ...route.bookmarks.map(bookmark => ({ name: bookmark.name, position: bookmark.position, target: bookmark.target, fov: bookmark.fov })),
      { name: 'overview', position: [92, 34, 30], target: [84, 0, -4], fov: 55 },
    ]

    const check = exposeCheck({
      bookmarks,
      camera: setCamera,
      player() {
        const body = shared.runner.als.pose.current.ownerRigidBody
        if (!body) return null
        const v = body.linvel()
        const seen = shared.runner.als.pose.current.ground
        return { position: [seen.x, seen.y, seen.z], velocity: [v.x, v.y, v.z], grounded: shared.runner.als.pose.current.character?.locomotionMode === 'Grounded' }
      },
      audio: () => shared.sound.sample(),
      scripts: {
        feelStart: () => place(feelLane.start, feelLane.yaw),
        perf: () => scripted(async () => {
          const result = await runs.route(false)
          if (!result.pass) throw new Error(`performance route failed: ${result.notes.join('; ')}`)
        }),
      },
      input: { move: 'KeyW', sprint: 'ShiftLeft', jump: 'Space' },
      model: { feel: model.feel, budget: { ...model.budget, voices: shared.sound.cap } },
    })
    exposed.current = check

    const traverse = {
      version: 1,
      model,
      checks: checkNames,
      bookmarks: route.bookmarks.map(bookmark => bookmark.name),
      get ready() { return shared.runner.als.pose.current.ready },
      state() {
        const sample = shared.runner.als.pose.current
        const c = sample.character
        const race = shared.race.current
        return { ready: sample.ready, position: sample.ground.toArray(), mode: c?.locomotionMode ?? null, action: c?.locomotionAction ?? null, speed: c?.locomotionState.speed ?? 0, race: race.state, next: race.next, camera: camera.position.toArray(), ankle: ankle.current }
      },
      async view(name: string | null) {
        if (name === null) { setCamera(null); return true }
        const bookmark = route.bookmarks.find(entry => entry.name === name)
        if (!bookmark) throw new Error(`unknown bookmark ${name}`)
        script(true)
        await place(bookmark.stand, bookmark.yaw)
        script(false)
        setCamera({ position: bookmark.position, target: bookmark.target, fov: bookmark.fov })
        await wait(0.6)
        return true
      },
      run,
      async runAll() {
        const results: CheckResult[] = []
        for (const name of checkNames) results.push(await run(name))
        return results
      },
      respawn: (position: Vec3, yaw = 0) => api.respawn(position, yaw),
      restart: () => api.restart(),
      gl: () => {
        const meshes: Record<string, number> = {}
        let shadows = 0
        scene.traverseVisible(object => {
          if (!(object as THREE.Mesh).isMesh && !(object as THREE.Points).isPoints) return
          let root = object
          while (root.parent && root.parent !== scene) root = root.parent
          const key = root.name || root.type
          meshes[key] = (meshes[key] ?? 0) + 1
          if (object.castShadow) shadows++
        })
        let suns = 0
        scene.traverse(object => { if ((object as THREE.DirectionalLight).isDirectionalLight) suns++ })
        return { calls: gl.info.render.calls, triangles: gl.info.render.triangles, programs: gl.info.programs?.map(program => program.name) ?? [], meshes, shadows, suns }
      },
      recording: () => last.current && { left: last.current.left, right: last.current.right, cameraLocal: last.current.cameraLocal.map(point => point.toArray()), times: last.current.times },
      fog(density: number) { if (scene.fog instanceof THREE.FogExp2) scene.fog.density = density },
    }
    Object.assign(window, { __traverse: traverse })
    return () => {
      check.dispose()
      exposed.current = null
      if ((window as { __traverse?: unknown }).__traverse === traverse) delete (window as { __traverse?: unknown }).__traverse
    }
  }, [api, camera, gl, rapier, scene, shared, world])

  return null
}
