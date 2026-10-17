import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { applyCameraPose, exposeCheck, type Bookmark, type CameraPose } from '@blacksite/check'
import type { BreachAudio } from './audio'
import { clearLine, type Target, type V3 } from './geometry'
import { BOOKMARKS, FEEL_START } from './layout'
import { CHECK_BUDGET, FEEL } from './model'
import type { Body } from './player'

export type Driver = { forward: number; right: number; sprint: boolean; jump: boolean; fire: boolean; aim: boolean }

export type Controls = {
  drive(next: Driver | null): void
  place(position: readonly [number, number, number], yaw: number): void
  body: Body
  override(pose: CameraPose | null): void
  restart(): void
  face(target: V3): void
  targets(): Target[]
  heal(): void
}

const bookmarks: Bookmark[] = BOOKMARKS.map(mark => ({ ...mark, position: [...mark.position], target: [...mark.target] }))
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const HALL_DOOR: [number, number, number] = [0.2, 0, -5.9]

function reveal(scenes: THREE.Object3D[]) {
  const shown = new Set<THREE.Object3D>()
  const dimmed: THREE.Light[] = []
  for (const scene of scenes) scene.traverse(object => { if (!object.visible && !(object instanceof THREE.Light)) { shown.add(object); object.visible = true } })
  for (const scene of scenes) scene.traverse(object => {
    if (!(object instanceof THREE.Light) || !object.visible) return
    for (let parent = object.parent; parent; parent = parent.parent) if (shown.has(parent)) { dimmed.push(object); object.visible = false; break }
  })
  return () => {
    for (const object of shown) object.visible = false
    for (const light of dimmed) light.visible = true
  }
}

async function warm(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const restore = reveal([scene])
  try { await gl.compileAsync(scene, camera) } catch { gl.compile(scene, camera) }
  restore()
}

export function CheckProbe({ driver, audio, ready, overlay, onWarmed }: { driver: Controls; audio: BreachAudio; ready: boolean; overlay: { scene: THREE.Scene; camera: THREE.Camera } | null; onWarmed: () => void }) {
  const camera = useThree(state => state.camera)
  const size = useThree(state => state.size)
  const gl = useThree(state => state.gl)
  const scene = useThree(state => state.scene)
  const override = useRef<CameraPose | null>(null)
  const state = useRef({ phase: 'idle' as 'idle' | 'compiling' | 'reveal' | 'restore' | 'done', restore: null as (() => void) | null, frames: 0 })
  const check = useMemo(() => exposeCheck({
    bookmarks,
    camera(next) { override.current = next; driver.override(next) },
    player() {
      const body = driver.body
      return { position: [body.position.x, body.position.y, body.position.z], velocity: [body.velocity.x, body.velocity.y, body.velocity.z], grounded: body.grounded }
    },
    audio: () => audio.sample(),
    scripts: {
      async feelStart() {
        driver.drive(null)
        driver.heal()
        driver.place(FEEL_START.position, FEEL_START.yaw)
        await wait(400)
      },
      async perf() {
        audio.start()
        driver.restart()
        await wait(300)
        driver.place(HALL_DOOR, 0)
        const drive: Driver = { forward: 0, right: 0, sprint: false, jump: false, fire: false, aim: false }
        driver.drive(drive)
        const started = performance.now()
        let side = 1
        while (performance.now() - started < 12000) {
          driver.heal()
          const elapsed = performance.now() - started
          const body = driver.body
          const targets = driver.targets()
          let best: Target | null = null
          let distance = Infinity
          for (const target of targets) {
            if (!clearLine({ x: body.position.x, y: body.position.y + 1.5, z: body.position.z }, { x: target.x, y: target.crouch ? 0.85 : 1.25, z: target.z })) continue
            const d = Math.hypot(target.x - body.position.x, target.z - body.position.z)
            if (d < distance) { distance = d; best = target }
          }
          if (best) driver.face({ x: best.x, y: best.crouch ? 0.85 : 1.25, z: best.z })
          drive.fire = !!best && elapsed % 1400 < 900
          drive.aim = elapsed % 5000 > 2500
          if (elapsed % 2000 < 50) side = -side
          drive.right = elapsed > 2500 ? side * 0.35 : 0
          drive.forward = elapsed > 6000 && elapsed < 7000 ? 0.4 : 0
          await wait(50)
        }
        driver.drive(null)
      },
      async death() {
        audio.start()
        driver.restart()
        await wait(300)
        driver.place(HALL_DOOR, 0)
        const drive: Driver = { forward: 0, right: 0, sprint: false, jump: false, fire: false, aim: true }
        driver.drive(drive)
        const started = performance.now()
        let aimed: Target | null = null
        while (performance.now() - started < 10000) {
          driver.heal()
          const body = driver.body
          const targets = driver.targets()
          if (aimed && !targets.some(target => target.id === aimed!.id)) break
          aimed = null
          let distance = Infinity
          for (const target of targets) {
            if (!clearLine({ x: body.position.x, y: body.position.y + 1.5, z: body.position.z }, { x: target.x, y: target.crouch ? 0.85 : 1.25, z: target.z })) continue
            const d = Math.hypot(target.x - body.position.x, target.z - body.position.z)
            if (d < distance) { distance = d; aimed = { ...target } }
          }
          if (aimed) driver.face({ x: aimed.x, y: aimed.crouch ? 0.85 : 1.25, z: aimed.z })
          drive.fire = !!aimed
          await wait(30)
        }
        drive.fire = false
        if (aimed) {
          const body = driver.body
          const away = Math.atan2(aimed.x - body.position.x, aimed.z - body.position.z)
          const side = { x: Math.cos(away), z: -Math.sin(away) }
          window.__blacksite?.camera({ position: [aimed.x + side.x * 2.9, 3.4, aimed.z + side.z * 2.9], target: [aimed.x, 0.3, aimed.z], fov: 70 })
          await wait(3200)
          window.__blacksite?.camera(null)
        }
        driver.drive(null)
      },
    },
    input: { move: 'KeyW', sprint: 'ShiftLeft', jump: 'Space' },
    model: { feel: FEEL, budget: CHECK_BUDGET },
  }), [driver, audio])
  useEffect(() => check.dispose, [check])
  useFrame(() => {
    const local = state.current
    if (ready && local.phase === 'idle') {
      local.phase = 'compiling'
      void warm(gl, scene, camera).then(() => overlay ? warm(gl, overlay.scene, overlay.camera) : undefined).then(() => { local.phase = 'reveal' })
    }
    if (local.phase === 'reveal') {
      local.restore = reveal(overlay ? [scene, overlay.scene] : [scene])
      local.phase = 'restore'
    }
    if (local.phase === 'done' && !check.probe.ready && ++local.frames > 3) { check.ready(); onWarmed() }
    if (override.current) applyCameraPose(camera as Parameters<typeof applyCameraPose>[0], override.current, size)
  }, 0.9)
  useFrame(() => {
    const local = state.current
    if (local.phase !== 'restore') return
    local.restore?.()
    local.restore = null
    local.phase = 'done'
  }, 1.5)
  return null
}
