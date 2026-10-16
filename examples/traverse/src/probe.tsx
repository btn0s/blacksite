import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { applyCameraPose, exposeCheck, type Bookmark, type CameraPose } from '@blacksite/check'
import type { Shared } from './Game'
import * as model from './model'
import { contacts, nearPlaneRadius, percentile, type FootSample } from './model'

type Vec3 = [number, number, number]

export type CheckResult = { name: string; pass: boolean; metrics: Record<string, number>; limits: Record<string, number>; notes: string[] }

export type ProbeApi = {
  respawn(position: Vec3, yaw: number): void
  restart(): void
}

type Waiter = { at: number; resolve: () => void }
type Recording = { left: FootSample[]; right: FootSample[]; clipFrames: number; frames: number; cameraLocal: THREE.Vector3[]; times: number[] }

const checkNames = ['feet-flat', 'stairs', 'slope', 'mantle-ladder', 'camera-wall', 'shoulder', 'route'] as const
export type CheckName = (typeof checkNames)[number]

const toDegrees = (radians: number) => radians * 180 / Math.PI

const feelLane = { start: [-10, 0, -22] as Vec3, yaw: Math.PI / 2 }

const perfTour: { start: Vec3; yaw: number; path: Vec3[]; sprint: boolean }[] = [
  { start: [2.5, 0, 0], yaw: 0, path: [[13.6, 0, 0]], sprint: true },
  { start: [-10, 0, -22], yaw: Math.PI / 2, path: [[-10, 0, 8]], sprint: true },
]

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
    clock.current += Math.min(delta, 0.1)
    const now = clock.current
    const sample = shared.pose.current
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
      for (const [foot, list] of [[sample.leftFoot, record.left], [sample.rightFoot, record.right]] as const) {
        list.push({ t: now, x: foot.x, y: foot.y, z: foot.z, ground: groundBelow(foot.x, foot.y, foot.z) + offset, grounded })
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
    if (check && !check.probe.ready && shared.pose.current.ready) check.ready()
    const pose = override.current
    if (pose) applyCameraPose(camera as Parameters<typeof applyCameraPose>[0], pose, state.size)
  }, ALS_FRAME_PRIORITY.Camera + 0.05)

  useEffect(() => {
    const wait = (seconds: number) => new Promise<void>(resolve => waiters.current.push({ at: clock.current + seconds, resolve }))
    const frame = () => wait(0)
    const until = async (test: () => boolean, timeout: number) => {
      const end = clock.current + timeout
      while (clock.current < end) { if (test()) return true; await frame() }
      return test()
    }
    const command = shared.command
    const character = () => shared.pose.current.character
    const position = () => shared.pose.current.ground
    const idle = () => { command.forward = 0; command.right = 0; command.sprint = false; command.walk = false; command.crouch = false }
    const face = (x: number, z: number) => {
      const p = position()
      command.yaw = toDegrees(Math.atan2(z - p.z, x - p.x))
    }

    const place = async (at: Vec3, yaw: number) => {
      idle()
      api.respawn(at, yaw)
      command.yaw = toDegrees(yaw)
      command.pitch = -12
      await wait(0.3)
      await until(() => {
        const c = character()
        return !!c && shared.pose.current.ready && c.locomotionMode === 'Grounded' && c.locomotionAction === null && position().distanceTo(new THREE.Vector3(...at)) < 1.5
      }, 4)
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

    const start = () => { recording.current = { left: [], right: [], clipFrames: 0, frames: 0, cameraLocal: [], times: [] } }
    const stop = () => { const result = recording.current!; recording.current = null; last.current = result; return result }

    const slide = (record: Recording) => {
      const planted = [...contacts(record.left), ...contacts(record.right)]
      const gaps: number[] = []
      for (const list of [record.left, record.right]) {
        for (let index = 1; index < list.length; index++) {
          const a = list[index - 1]!
          const b = list[index]!
          const dt = b.t - a.t
          if (dt <= 0 || !b.grounded) continue
          const height = b.y - b.ground
          if (height < 0.12 && Math.hypot(b.x - a.x, b.z - a.z) / dt < 0.3) gaps.push(Math.abs(height))
        }
      }
      return {
        contacts: planted.length,
        driftP95: percentile(planted.map(contact => contact.drift), 0.95),
        excursionP95: percentile(planted.map(contact => contact.excursion), 0.95),
        jitterMm: percentile(planted.map(contact => contact.jitter), 0.5) * 1000,
        gapP95: percentile(gaps, 0.95),
        clipFrames: record.clipFrames,
      }
    }

    const result = (name: string, metrics: Record<string, number>, limits: Record<string, number>, pass: boolean, notes: string[] = []): CheckResult => ({ name, pass, metrics, limits, notes })

    const route = shared.route
    const runs: Record<CheckName, () => Promise<CheckResult>> = {
      async 'feet-flat'() {
        await place([-16, 0, 0], 0)
        start()
        await follow([[-5, 0, 0]])
        await follow([[-1, 0, 0]], { walk: true })
        await follow([[13.5, 0, 0]], { sprint: true })
        await wait(0.8)
        const m = slide(stop())
        const limits = { driftP95: model.feet.flatDriftP95, excursionP95: model.feet.excursionP95, clipFrames: model.camera.clipFrames }
        return result('feet-flat', m, limits, m.contacts > 12 && m.driftP95 <= limits.driftP95 && m.excursionP95 <= limits.excursionP95 && m.clipFrames <= limits.clipFrames, [`ankle ${(ankle.current ?? 0).toFixed(3)} m`])
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
        return result('stairs', { ...m, reached: reached ? 1 : 0 }, limits, reached && m.contacts > 8 && m.driftP95 <= limits.driftP95 && m.excursionP95 <= limits.excursionP95 && m.gapP95 <= limits.gapP95 && m.clipFrames <= limits.clipFrames)
      },
      async slope() {
        const metrics: Record<string, number> = {}
        let pass = true
        const notes: string[] = []
        for (const ramp of route.ramps) {
          const along = new THREE.Vector3(ramp.to[0] - ramp.from[0], 0, ramp.to[2] - ramp.from[2]).normalize()
          const up = ramp.to[1] > ramp.from[1]
          await place([ramp.from[0] - along.x * 2.5, ramp.from[1], ramp.from[2] - along.z * 2.5], Math.atan2(along.z, along.x))
          start()
          const reached = await follow([ramp.from, ramp.to, [ramp.to[0] + along.x * 2, ramp.to[1], ramp.to[2] + along.z * 2]], { timeout: 10, reach: 0.8 })
          await wait(0.4)
          const m = slide(stop())
          const key = ramp.label.replace(/\W+/g, '-')
          metrics[`${key}.driftP95`] = m.driftP95
          metrics[`${key}.excursionP95`] = m.excursionP95
          metrics[`${key}.gapP95`] = m.gapP95
          metrics[`${key}.degrees`] = ramp.degrees
          const ok = reached && m.contacts > 4 && m.driftP95 <= model.feet.unevenDriftP95 && m.excursionP95 <= model.feet.excursionP95 && m.gapP95 <= model.feet.plantedGap
          if (!ok) notes.push(`${ramp.label} ${up ? 'up' : 'down'} ${ramp.degrees}° reached ${reached} contacts ${m.contacts} drift ${m.driftP95.toFixed(3)} excursion ${m.excursionP95.toFixed(3)} gap ${m.gapP95.toFixed(3)}`)
          pass &&= ok
        }
        return result('slope', metrics, { driftP95: model.feet.unevenDriftP95, excursionP95: model.feet.excursionP95, gapP95: model.feet.plantedGap }, pass, notes)
      },
      async 'mantle-ladder'() {
        const metrics: Record<string, number> = {}
        const notes: string[] = []
        let passed = 0
        for (const ledge of route.ledges) {
          await place(ledge.approach, ledge.yaw)
          const top = ledge.base + ledge.height
          const began = clock.current
          let mantled = -1
          let jumps = 0
          let pressedAt = -1
          const reached = await until(() => {
            const c = character()
            command.yaw = toDegrees(ledge.yaw)
            command.forward = 1
            if (c?.locomotionAction === 'Mantling' && mantled < 0) mantled = clock.current
            const p = position()
            const face = faceDistance(p.x, p.y + 0.3, p.z, ledge.yaw)
            if (c?.locomotionMode === 'Grounded' && c.locomotionAction === null && face < 0.7 && clock.current - pressedAt > 0.3 && jumps < 6) { jumps++; pressedAt = clock.current; command.jumpSequence++ }
            return p.y >= top - 0.12 && c?.locomotionAction === null && c.locomotionMode === 'Grounded'
          }, 7)
          idle()
          const key = `${ledge.label} ${ledge.height.toFixed(2)}`
          const climb = mantled >= 0 ? clock.current - mantled : -1
          metrics[`${key}.seconds`] = reached ? clock.current - began : -1
          metrics[`${key}.mantleSeconds`] = climb
          const ok = reached && mantled >= 0 && climb <= model.mantle.reachTopWithin
          if (ok) passed++
          else notes.push(`${key}: ${!reached ? 'did not reach the top' : mantled < 0 ? 'reached without a mantle' : `mantle took ${climb.toFixed(2)} s`} after ${jumps} jump presses`)
        }
        const rate = passed / route.ledges.length
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
          const baseYaw = command.yaw
          await until(() => {
            const t = (clock.current - began) / 4
            command.yaw = baseYaw + 360 * t
            command.pitch = -55 + 95 * (0.5 + 0.5 * Math.sin(t * Math.PI * 4))
            command.forward = spot.back ? -0.6 : 0
            return t >= 1
          }, 5)
          idle()
          const record = stop()
          clips += record.clipFrames
          frames += record.frames
        }
        command.pitch = -12
        return result('camera-wall', { clipFrames: clips, frames, nearRadius: nearPlaneRadius(model.camera.near, (camera as THREE.PerspectiveCamera).fov, (camera as THREE.PerspectiveCamera).aspect) }, { clipFrames: model.camera.clipFrames }, frames > 100 && clips <= model.camera.clipFrames)
      },
      async shoulder() {
        await place([-12, 0, 0], 0)
        await wait(0.8)
        const steps: number[] = []
        const settle: number[] = []
        const travel: number[] = []
        for (let swap = 0; swap < 2; swap++) {
          start()
          await wait(0.1)
          command.rightShoulder = !command.rightShoulder
          const swapped = clock.current
          await wait(1.4)
          const record = stop()
          const points = record.cameraLocal
          const from = points[0]!
          const to = points[points.length - 1]!
          const distance = from.distanceTo(to)
          travel.push(distance)
          let settled = -1
          for (let index = 1; index < points.length; index++) {
            steps.push(points[index]!.distanceTo(points[index - 1]!))
            if (settled < 0 && points[index]!.distanceTo(to) < distance * 0.1) settled = record.times[index]! - swapped
          }
          settle.push(settled)
        }
        const maxStep = Math.max(...steps)
        const seconds = Math.max(...settle)
        return result('shoulder', { maxStep, seconds, travel: Math.max(...travel) }, { maxStep: model.camera.shoulderMaxStep, seconds: model.camera.shoulderSwapSeconds }, maxStep <= model.camera.shoulderMaxStep && seconds > 0 && seconds <= model.camera.shoulderSwapSeconds + 0.1)
      },
      async route() {
        await place(route.spawn, route.spawnYaw)
        api.restart()
        await wait(0.4)
        start()
        const began = clock.current
        const notes: string[] = []
        let pressedAt = -1
        command.sprint = true
        for (let index = 0; index < route.line.length; index++) {
          const point = route.line[index]!
          const ok = await until(() => {
            const c = character()
            const p = position()
            const yaw = Math.atan2(point.at[2] - p.z, point.at[0] - p.x)
            command.yaw = toDegrees(yaw)
            command.forward = 1
            command.sprint = true
            const free = c?.locomotionMode === 'Grounded' && c.locomotionAction === null && clock.current - pressedAt > 0.35
            const flat = Math.hypot(point.at[0] - p.x, point.at[2] - p.z)
            if (free && point.action === 'mantle' && faceDistance(p.x, p.y + 0.3, p.z, yaw) < 0.7) { pressedAt = clock.current; command.jumpSequence++ }
            if (free && point.action === 'jump' && flat < 0.45) { pressedAt = clock.current; command.jumpSequence++ }
            return flat < (point.action === 'jump' ? 0.3 : 0.6) && Math.abs(p.y - point.at[1]) < 0.6
          }, 9)
          if (!ok) { notes.push(`stuck before waypoint ${index} [${point.at.map(v => v.toFixed(1)).join(', ')}] at [${position().toArray().map(v => v.toFixed(1)).join(', ')}]`); break }
        }
        await until(() => shared.race.current.state === 'finished', 3)
        idle()
        const m = slide(stop())
        const race = shared.race.current
        const finished = race.state === 'finished'
        const time = finished ? race.splits[race.splits.length - 1] ?? -1 : -1
        return result('route', { finished: finished ? 1 : 0, time, wall: clock.current - began, gates: race.next, clipFrames: m.clipFrames, driftP95: m.driftP95 }, { par: model.route.parSeconds, gold: model.route.goldSeconds, clipFrames: model.camera.clipFrames }, finished && time <= model.route.parSeconds && m.clipFrames <= model.camera.clipFrames, notes)
      },
    }

    const run = async (name: CheckName) => {
      if (busy.current) throw new Error('a check is already running')
      busy.current = true
      shared.scripted.current = true
      try {
        return await runs[name]()
      } finally {
        idle()
        shared.scripted.current = false
        busy.current = false
        api.restart()
      }
    }

    const setCamera = (pose: CameraPose | null) => {
      if (!pose && override.current) (camera as THREE.PerspectiveCamera).clearViewOffset()
      override.current = pose
    }

    const scripted = async (body: () => Promise<void>) => {
      shared.scripted.current = true
      try { await body() } finally { idle(); shared.scripted.current = false }
    }

    const bookmarks: Bookmark[] = [
      ...route.bookmarks.map(bookmark => ({ name: bookmark.name, position: bookmark.position, target: bookmark.target, fov: bookmark.fov })),
      { name: 'overview', position: [92, 34, 30], target: [84, 0, -4], fov: 55 },
    ]

    const check = exposeCheck({
      bookmarks,
      camera: setCamera,
      player() {
        const body = shared.pose.current.ownerRigidBody
        if (!body) return null
        const p = body.translation()
        const v = body.linvel()
        const seen = shared.pose.current.ground
        return { position: [seen.x, p.y, seen.z], velocity: [v.x, v.y, v.z], grounded: shared.pose.current.character?.locomotionMode === 'Grounded' }
      },
      audio: () => shared.sound.sample(),
      scripts: {
        feelStart: () => place(feelLane.start, feelLane.yaw),
        perf: () => scripted(async () => {
          for (const leg of perfTour) {
            await place(leg.start, leg.yaw)
            await follow(leg.path, { sprint: leg.sprint, timeout: 6, reach: 0.8 })
          }
        }),
      },
      input: { move: 'KeyW', sprint: 'ShiftLeft', jump: 'Space' },
      model: { feel: model.feel, budget: model.budget },
    })
    exposed.current = check

    const traverse = {
      version: 1,
      model,
      checks: checkNames,
      bookmarks: route.bookmarks.map(bookmark => bookmark.name),
      get ready() { return shared.pose.current.ready },
      state() {
        const sample = shared.pose.current
        const c = sample.character
        const race = shared.race.current
        return { ready: sample.ready, position: sample.ground.toArray(), mode: c?.locomotionMode ?? null, action: c?.locomotionAction ?? null, speed: c?.locomotionState.speed ?? 0, race: race.state, next: race.next, camera: camera.position.toArray(), ankle: ankle.current }
      },
      async view(name: string | null) {
        if (name === null) { setCamera(null); return true }
        const bookmark = route.bookmarks.find(entry => entry.name === name)
        if (!bookmark) throw new Error(`unknown bookmark ${name}`)
        shared.scripted.current = true
        await place(bookmark.stand, bookmark.yaw)
        shared.scripted.current = false
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
      gl: () => ({ calls: gl.info.render.calls, triangles: gl.info.render.triangles }),
      recording: () => last.current && { left: last.current.left, right: last.current.right },
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
