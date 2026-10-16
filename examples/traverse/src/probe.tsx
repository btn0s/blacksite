import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import type { Shared } from './Game'
import * as model from './model'
import { mean, nearPlaneRadius, percentile, plantedSpeeds, type FootSample } from './model'

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

export function Probe({ shared, api }: { shared: Shared; api: ProbeApi }) {
  const { world, rapier } = useRapier()
  const { camera, gl } = useThree()
  const clock = useRef(0)
  const waiters = useRef<Waiter[]>([])
  const recording = useRef<Recording | null>(null)
  const ankle = useRef<number | null>(null)
  const ankleSamples = useRef<number[]>([])
  const view = useRef<{ position: THREE.Vector3; target: THREE.Vector3; fov: number } | null>(null)
  const restoreFov = useRef<number | null>(null)
  const busy = useRef(false)
  const scratch = useMemo(() => ({ center: new THREE.Vector3(), forward: new THREE.Vector3(), inverse: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0) }), [])

  const fixedOnly = (collider: { parent(): { isFixed(): boolean } | null }) => collider.parent()?.isFixed() ?? true

  const groundBelow = (x: number, y: number, z: number) => {
    const hit = world.castRay(new rapier.Ray({ x, y: y + 0.6, z }, { x: 0, y: -1, z: 0 }), 3, true, undefined, undefined, undefined, undefined, fixedOnly as never)
    return hit ? y + 0.6 - hit.timeOfImpact : -Infinity
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

  useFrame(() => {
    const bookmark = view.current
    if (!bookmark) return
    const perspective = camera as THREE.PerspectiveCamera
    if (restoreFov.current === null) restoreFov.current = perspective.fov
    perspective.position.copy(bookmark.position)
    perspective.lookAt(bookmark.target)
    if (perspective.fov !== bookmark.fov) { perspective.fov = bookmark.fov; perspective.updateProjectionMatrix() }
  }, ALS_FRAME_PRIORITY.Camera + 0.3)

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
    const stop = () => { const result = recording.current!; recording.current = null; return result }

    const slide = (record: Recording) => {
      const speeds = [...plantedSpeeds(record.left), ...plantedSpeeds(record.right)]
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
      return { planted: speeds.length, slideP95: percentile(speeds, 0.95), slideMean: mean(speeds), gapP95: percentile(gaps, 0.95), clipFrames: record.clipFrames }
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
        const limits = { slideP95: model.feet.flatSlideP95, slideMean: model.feet.flatSlideMean, clipFrames: model.camera.clipFrames }
        return result('feet-flat', m, limits, m.planted > 40 && m.slideP95 <= limits.slideP95 && m.slideMean <= limits.slideMean && m.clipFrames <= limits.clipFrames, [`ankle ${(ankle.current ?? 0).toFixed(3)} m`])
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
        const limits = { slideP95: model.feet.unevenSlideP95, gapP95: model.feet.plantedGap, clipFrames: model.camera.clipFrames }
        return result('stairs', { ...m, reached: reached ? 1 : 0 }, limits, reached && m.slideP95 <= limits.slideP95 && m.gapP95 <= limits.gapP95 && m.clipFrames <= limits.clipFrames)
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
          metrics[`${key}.slideP95`] = m.slideP95
          metrics[`${key}.gapP95`] = m.gapP95
          metrics[`${key}.degrees`] = ramp.degrees
          const ok = reached && m.slideP95 <= model.feet.unevenSlideP95 && m.gapP95 <= model.feet.plantedGap
          if (!ok) notes.push(`${ramp.label} ${up ? 'up' : 'down'} ${ramp.degrees}° reached ${reached} slide ${m.slideP95.toFixed(3)} gap ${m.gapP95.toFixed(3)}`)
          pass &&= ok
        }
        return result('slope', metrics, { slideP95: model.feet.unevenSlideP95, gapP95: model.feet.plantedGap }, pass, notes)
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
          command.forward = 1
          const reached = await until(() => {
            const c = character()
            command.yaw = toDegrees(ledge.yaw)
            command.forward = 1
            if (c?.locomotionAction === 'Mantling' && mantled < 0) mantled = clock.current - began
            if (c?.locomotionMode === 'Grounded' && c.locomotionAction === null && clock.current - began > 0.35 && jumps < 12 && Math.round((clock.current - began) / 0.25) > jumps) { jumps++; command.jumpSequence++ }
            return position().y >= top - 0.12 && c?.locomotionAction === null && c.locomotionMode === 'Grounded'
          }, 6)
          idle()
          const elapsed = clock.current - began
          const key = `${ledge.label} ${ledge.height.toFixed(2)}`
          metrics[`${key}.seconds`] = reached ? elapsed : -1
          metrics[`${key}.mantled`] = mantled >= 0 ? 1 : 0
          if (reached && mantled >= 0) passed++
          else notes.push(`${key}: ${reached ? 'reached without mantle' : 'did not reach the top'} after ${jumps} jump presses`)
        }
        const rate = passed / route.ledges.length
        metrics.successRate = rate
        return result('mantle-ladder', metrics, { successRate: model.mantle.successRate, minLedge: model.mantle.minLedge, maxLedge: 2 }, rate >= model.mantle.successRate, notes)
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
          let settled = -1
          for (let index = 1; index < points.length; index++) {
            steps.push(points[index]!.distanceTo(points[index - 1]!))
            if (settled < 0 && points[index]!.distanceTo(to) < distance * 0.05) settled = record.times[index]! - swapped
          }
          settle.push(settled)
        }
        const maxStep = Math.max(...steps)
        const seconds = Math.max(...settle)
        return result('shoulder', { maxStep, seconds }, { maxStep: model.camera.shoulderMaxStep, seconds: model.camera.shoulderSwapSeconds }, maxStep <= model.camera.shoulderMaxStep && seconds > 0 && seconds <= model.camera.shoulderSwapSeconds + 0.25)
      },
      async route() {
        await place(route.spawn, route.spawnYaw)
        api.restart()
        await wait(0.6)
        start()
        const began = clock.current
        const reached = await until(() => shared.race.current.state === 'finished', 0.1)
        const m = slide(stop())
        return result('route', { finished: reached ? 1 : 0, seconds: clock.current - began, clipFrames: m.clipFrames }, { par: model.route.parSeconds }, reached, ['scripted route not yet authored'])
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
        if (name === null) {
          view.current = null
          if (restoreFov.current !== null) { (camera as THREE.PerspectiveCamera).fov = restoreFov.current; (camera as THREE.PerspectiveCamera).updateProjectionMatrix(); restoreFov.current = null }
          return true
        }
        const bookmark = route.bookmarks.find(entry => entry.name === name)
        if (!bookmark) throw new Error(`unknown bookmark ${name}`)
        shared.scripted.current = true
        await place(bookmark.stand, bookmark.yaw)
        shared.scripted.current = false
        view.current = { position: new THREE.Vector3(...bookmark.position), target: new THREE.Vector3(...bookmark.target), fov: bookmark.fov }
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
    }
    Object.assign(window, { __traverse: traverse })
    return () => { if ((window as { __traverse?: unknown }).__traverse === traverse) delete (window as { __traverse?: unknown }).__traverse }
  }, [api, camera, gl, rapier, shared, world])

  return null
}
