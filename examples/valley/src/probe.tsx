import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { applyCameraPose, exposeCheck, type Bookmark, type CameraPose } from '@blacksite/check'
import type { Shared } from './Game'
import * as model from './model'
import type { ValleyWorld } from './world'

type Vec3 = [number, number, number]
type Waiter = { at: number; resolve: () => void }

export type ProbeApi = { respawn(position: Vec3, yaw: number): void }

const toDegrees = (radians: number) => radians * 180 / Math.PI

export function resolvePose(world: ValleyWorld, pose: { position: Vec3; target: Vec3 }): { position: Vec3; target: Vec3 } {
  const [px, py, pz] = pose.position
  const [tx, ty, tz] = pose.target
  return { position: [px, world.heightAt(px, pz) + py, pz], target: [tx, world.heightAt(tx, tz) + ty, tz] }
}

export function Probe({ shared, world, api }: { shared: Shared; world: ValleyWorld; api: ProbeApi }) {
  const { camera, gl, scene } = useThree()
  const clock = useRef(0)
  const waiters = useRef<Waiter[]>([])
  const override = useRef<CameraPose | null>(null)
  const exposed = useRef<ReturnType<typeof exposeCheck> | null>(null)

  useFrame((_, delta) => {
    clock.current += Math.min(delta, 0.1)
    const ready = waiters.current.filter(waiter => waiter.at <= clock.current)
    if (ready.length) {
      waiters.current = waiters.current.filter(waiter => waiter.at > clock.current)
      for (const waiter of ready) waiter.resolve()
    }
  }, ALS_FRAME_PRIORITY.Camera + 0.2)

  useFrame(state => {
    const check = exposed.current
    if (check && !check.probe.ready && shared.pose.current.ready && shared.landscape.current) check.ready()
    const pose = override.current
    if (pose) applyCameraPose(camera as Parameters<typeof applyCameraPose>[0], pose, state.size)
  }, ALS_FRAME_PRIORITY.Camera + 0.05)

  useEffect(() => {
    const wait = (seconds: number) => new Promise<void>(resolve => waiters.current.push({ at: clock.current + seconds, resolve }))
    const until = async (test: () => boolean, timeout: number) => {
      const end = clock.current + timeout
      while (clock.current < end) { if (test()) return true; await wait(0) }
      return test()
    }
    const command = shared.command
    const position = () => shared.pose.current.ground
    const idle = () => { command.forward = 0; command.right = 0; command.sprint = false; command.walk = false; command.crouch = false }
    const place = async (x: number, z: number, yaw: number) => {
      idle()
      const at: Vec3 = [x, world.heightAt(x, z) + 1.2, z]
      api.respawn(at, yaw)
      command.yaw = toDegrees(yaw)
      command.pitch = -8
      await wait(0.3)
      await until(() => {
        const c = shared.pose.current.character
        return !!c && shared.pose.current.ready && c.locomotionMode === 'Grounded' && c.locomotionAction === null && Math.hypot(position().x - x, position().z - z) < 1.5
      }, 4)
      await wait(0.4)
    }
    const follow = async (points: [number, number][], sprint: boolean) => {
      command.sprint = sprint
      for (const [x, z] of points) {
        const ok = await until(() => {
          const p = position()
          command.yaw = toDegrees(Math.atan2(z - p.z, x - p.x))
          command.forward = 1
          return Math.hypot(x - p.x, z - p.z) < 1.2
        }, 12)
        if (!ok) break
      }
      idle()
    }
    const scripted = async (body: () => Promise<void>) => {
      shared.scripted.current = true
      try { await body() } finally { idle(); shared.scripted.current = false }
    }
    const setCamera = (pose: CameraPose | null) => {
      if (!pose && override.current) (camera as THREE.PerspectiveCamera).clearViewOffset()
      override.current = pose
    }
    const freeze = (value: boolean) => { const landscape = shared.landscape.current; if (landscape) landscape.frozen = value }

    const bookmarks: Bookmark[] = model.bookmarks.map(bookmark => ({ name: bookmark.name, note: bookmark.note, fov: bookmark.fov, ...resolvePose(world, bookmark) }))
    const flyover: CameraPose[] = model.flyover.map(pose => ({ ...resolvePose(world, pose), fov: 55 }))
    const feelStart = model.site.spawn
    const flattest = (() => {
      let best = { yaw: 0, rise: Infinity }
      for (let step = 0; step < 32; step++) {
        const yaw = step / 32 * Math.PI * 2
        let rise = 0
        for (let d = 2; d <= 30; d += 2) rise += Math.abs(world.heightAt(feelStart[0] + Math.cos(yaw) * d, feelStart[1] + Math.sin(yaw) * d) - world.heightAt(feelStart[0] + Math.cos(yaw) * (d - 2), feelStart[1] + Math.sin(yaw) * (d - 2)))
        if (rise < best.rise) best = { yaw, rise }
      }
      return best.yaw
    })()

    const check = exposeCheck({
      bookmarks,
      flyover,
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
        feelStart: () => scripted(() => place(feelStart[0], feelStart[1], flattest)),
        freeze: async () => freeze(true),
        unfreeze: async () => freeze(false),
        perf: () => scripted(async () => {
          await place(model.site.spawn[0], model.site.spawn[1], model.site.spawnYaw)
          const path = world.path.slice(0, 7).map(([x, z]) => [x, z] as [number, number])
          await follow(path, true)
          setCamera(null)
          for (let index = 0; index < flyover.length - 1; index++) {
            const a = flyover[index]!
            const b = flyover[index + 1]!
            const began = clock.current
            await until(() => {
              const t = Math.min(1, (clock.current - began) / 2.4)
              const s = t * t * (3 - 2 * t)
              setCamera({ position: a.position.map((v, i) => v + (b.position[i]! - v) * s) as Vec3, target: a.target.map((v, i) => v + (b.target[i]! - v) * s) as Vec3, fov: 55 })
              return t >= 1
            }, 4)
          }
          setCamera(null)
        }),
      },
      input: { move: 'KeyW', sprint: 'ShiftLeft', jump: 'Space' },
      model: { feel: model.feel, budget: model.budget, quality: model.quality },
    })
    exposed.current = check

    const valley = {
      version: 1,
      model,
      state() {
        const landscape = shared.landscape.current
        return {
          ready: shared.pose.current.ready,
          position: shared.pose.current.ground.toArray(),
          camera: camera.position.toArray(),
          terrain: landscape?.terrain.stats,
          cover: landscape?.cover.stats,
          forest: landscape?.forest.stats,
          timings: world.timings,
        }
      },
      gl: () => ({ calls: gl.info.render.calls, triangles: gl.info.render.triangles, programs: gl.info.programs?.length ?? 0, textures: gl.info.memory.textures, geometries: gl.info.memory.geometries }),
      view: (name: string | null) => setCamera(name === null ? null : bookmarks.find(bookmark => bookmark.name === name) ?? null),
      pose: (position: Vec3, target: Vec3, fov = 55) => setCamera({ ...resolvePose(world, { position, target }), fov }),
      freeze,
      scene,
    }
    Object.assign(window, { __valley: valley })
    return () => {
      check.dispose()
      exposed.current = null
      if ((window as { __valley?: unknown }).__valley === valley) delete (window as { __valley?: unknown }).__valley
    }
  }, [api, camera, gl, scene, shared, world])

  return null
}
