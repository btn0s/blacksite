import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { applyCameraPose, exposeCheck, type CameraPose, type FeelModel, type PlayerSample } from '@blacksite/check'
import { BUDGET, FEEL } from './model'
import { sound } from './sound'
import { bookmarks } from './yard'

const checkFeel: FeelModel = { moveSpeed: FEEL.moveSpeed, sprintSpeed: FEEL.sprintSpeed, timeToTopSpeed: FEEL.timeToTopSpeed, jumpApex: FEEL.jumpApex, tolerance: FEEL.tolerance }

export function CheckProbe({ player, ready, reset, feel = checkFeel, priority = 0.5 }: {
  player: () => PlayerSample | null
  ready: () => boolean
  reset?: () => void
  feel?: FeelModel
  priority?: number
}) {
  const camera = useThree(state => state.camera)
  const size = useThree(state => state.size)
  const override = useRef<CameraPose | null>(null)
  const latest = useRef({ player, ready, reset })
  latest.current = { player, ready, reset }
  const check = useMemo(() => exposeCheck({
    bookmarks,
    camera(next) {
      override.current = next
      if (!next) { camera.clearViewOffset(); camera.updateProjectionMatrix() }
    },
    player: () => latest.current.player(),
    audio: () => sound.sample(),
    scripts: { feelStart: async () => latest.current.reset?.() },
    input: { move: 'KeyW', sprint: 'ShiftLeft', jump: 'Space' },
    model: { feel, budget: BUDGET },
  }), [camera, feel])
  useEffect(() => check.dispose, [check])
  useFrame(() => {
    if (!check.probe.ready && latest.current.ready()) check.ready()
    if (override.current) applyCameraPose(camera as Parameters<typeof applyCameraPose>[0], override.current, size)
  }, priority)
  return null
}
