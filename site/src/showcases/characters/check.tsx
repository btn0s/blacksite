import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { CharacterPoseSample } from 'als-ue5-r3f/app/CharacterPoseSample'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { applyCameraPose, exposeCheck, type Bookmark, type CameraPose } from '@blacksite/check'
import type { CheckpointAudio } from './audio'

const bookmarks: Bookmark[] = [
  { name: 'spawn', position: [-4, 2.1, 0.6], target: [12, 1.2, 0] },
  { name: 'gate', position: [14, 1.8, 6.5], target: [30, 1.2, -1.6] },
  { name: 'street', position: [40, 1.7, 3], target: [82, 9, -6] },
  { name: 'yard', position: [46, 2.2, 18], target: [70, 3, 34] },
  { name: 'overview', position: [-12, 16, 24], target: [30, 0, -2] },
]

function blend(a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function press(code: string, down: boolean) {
  window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true }))
}

function wait(milliseconds: number) {
  return new Promise<void>(resolve => window.setTimeout(resolve, milliseconds))
}

export function CheckProbe({ pose, audio }: { pose: { current: CharacterPoseSample }; audio: CheckpointAudio }) {
  const camera = useThree(state => state.camera)
  const size = useThree(state => state.size)
  const override = useRef<CameraPose | null>(null)
  const check = useMemo(() => exposeCheck({
    bookmarks,
    camera(next) { override.current = next },
    player() {
      const body = pose.current.ownerRigidBody
      if (!body) return null
      const position = body.translation()
      const velocity = body.linvel()
      return { position: [position.x, position.y, position.z], velocity: [velocity.x, velocity.y, velocity.z] }
    },
    audio() { return audio.sample() },
    scripts: {
      async perf() {
        await audio.start()
        if (audio.state !== 'running') throw new Error(`Soundscape did not unlock: ${audio.state}`)
        const body = pose.current.ownerRigidBody
        const home = body?.translation()
        try {
          press('KeyS', true)
          await wait(2500)
          press('KeyS', false)
          if (body && home) {
            body.setTranslation({ x: 39, y: home.y, z: 13 }, true)
            body.setLinvel({ x: 0, y: 0, z: 0 }, true)
            await wait(450)
            if (audio.zone() !== 'small-room') throw new Error(`Expected room audio zone, got ${audio.zone()}`)
            press('KeyW', true)
            await wait(1500)
            press('KeyW', false)
            body.setTranslation({ x: home.x, y: home.y, z: home.z }, true)
            body.setLinvel({ x: 0, y: 0, z: 0 }, true)
            await wait(450)
            if (audio.zone() !== 'outdoor') throw new Error(`Expected outdoor audio zone, got ${audio.zone()}`)
          }
          const start = performance.now()
          let progress = 0
          while (progress < 1) {
            progress = Math.min(1, (performance.now() - start) / 10000)
            const travel = progress * (bookmarks.length - 1)
            const index = Math.min(Math.floor(travel), bookmarks.length - 2)
            const from = bookmarks[index]!
            const to = bookmarks[index + 1]!
            const t = travel - index
            override.current = { position: blend(from.position, to.position, t), target: blend(from.target, to.target, t) }
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          }
        } finally {
          press('KeyS', false)
          press('KeyW', false)
          if (body && home) {
            body.setTranslation({ x: home.x, y: home.y, z: home.z }, true)
            body.setLinvel({ x: 0, y: 0, z: 0 }, true)
          }
          override.current = null
        }
      },
    },
    input: { move: 'KeyS', sprint: 'ShiftLeft', jump: 'Space' },
    model: {
      feel: { moveSpeed: 3.75, sprintSpeed: 6.5, jumpApex: 0.9, tolerance: 0.12 },
      budget: { frameMs: 8.3, phoneFrameMs: 16.7, hitchMs: 33, firstPlayableMs: 5000, voices: audio.cap },
    },
  }), [pose, audio])
  useEffect(() => check.dispose, [check])
  useFrame(() => {
    if (!check.probe.ready && pose.current.ready) check.ready()
    if (override.current) applyCameraPose(camera as Parameters<typeof applyCameraPose>[0], override.current, size)
  }, ALS_FRAME_PRIORITY.Camera + 0.05)
  return null
}
