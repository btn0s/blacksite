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

async function warm(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const hidden: THREE.Object3D[] = []
  scene.traverse(object => { if (!object.visible) { hidden.push(object); object.visible = true } })
  try { await gl.compileAsync(scene, camera) } catch { gl.compile(scene, camera) }
  for (const object of hidden) object.visible = false
}

export function CheckProbe({ driver, audio, ready }: { driver: Controls; audio: BreachAudio; ready: boolean }) {
  const camera = useThree(state => state.camera)
  const size = useThree(state => state.size)
  const gl = useThree(state => state.gl)
  const scene = useThree(state => state.scene)
  const override = useRef<CameraPose | null>(null)
  const state = useRef({ warming: false, warmed: false, frames: 0 })
  const check = useMemo(() => exposeCheck({
    bookmarks,
    camera(next) { override.current = next; driver.override(next) },
    player() {
      const body = driver.body
      return { position: [body.position.x, body.position.y, body.position.z], velocity: [body.velocity.x, body.velocity.y, body.velocity.z], grounded: body.grounded }
    },
    audio: () => audio.log.sample(),
    scripts: {
      async feelStart() {
        driver.drive(null)
        driver.heal()
        driver.place(FEEL_START.position, FEEL_START.yaw)
        await wait(400)
      },
      async perf() {
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
    },
    input: { move: 'KeyW', sprint: 'ShiftLeft', jump: 'Space' },
    model: { feel: FEEL, budget: CHECK_BUDGET },
  }), [driver, audio])
  useEffect(() => check.dispose, [check])
  useFrame(() => {
    const local = state.current
    if (ready && !local.warming) {
      local.warming = true
      void warm(gl, scene, camera).then(() => { local.warmed = true })
    }
    if (local.warmed && !check.probe.ready && ++local.frames > 3) check.ready()
    if (override.current) applyCameraPose(camera as Parameters<typeof applyCameraPose>[0], override.current, size)
  }, 0.9)
  return null
}
