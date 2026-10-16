import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { CharacterPoseSample } from 'als-ue5-r3f/app/CharacterPoseSample'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { applyCameraPose, exposeCheck, type Bookmark, type CameraPose } from '@blacksite/check'

const bookmarks: Bookmark[] = [
  { name: 'spawn', position: [-4, 2.1, 0.6], target: [12, 1.2, 0] },
  { name: 'gate', position: [14, 1.8, 6.5], target: [30, 1.2, -1.6] },
  { name: 'street', position: [40, 1.7, 3], target: [82, 9, -6] },
  { name: 'yard', position: [46, 2.2, 18], target: [70, 3, 34] },
  { name: 'overview', position: [-12, 16, 24], target: [30, 0, -2] },
]

export function CheckProbe({ pose }: { pose: { current: CharacterPoseSample } }) {
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
    input: { move: 'KeyS', sprint: 'ShiftLeft', jump: 'Space' },
    model: {
      feel: { moveSpeed: 3.75, sprintSpeed: 6.5, jumpApex: 0.9, tolerance: 0.12 },
      budget: { frameMs: 8.3, phoneFrameMs: 16.7, hitchMs: 33, firstPlayableMs: 5000 },
    },
  }), [pose])
  useEffect(() => check.dispose, [check])
  useFrame(() => {
    if (!check.probe.ready && pose.current.ready) check.ready()
    if (override.current) applyCameraPose(camera as Parameters<typeof applyCameraPose>[0], override.current, size)
  }, ALS_FRAME_PRIORITY.Camera + 0.05)
  return null
}
