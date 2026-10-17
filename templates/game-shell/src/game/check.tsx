import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { applyCameraPose, exposeCheck, sampleView, type CameraPose, type FeelModel, type PlayerSample } from '@blacksite/check'
import { BUDGET, FEEL } from './model'
import { sound } from './sound'
import { bookmarks } from './yard'

const checkFeel: FeelModel = { moveSpeed: FEEL.moveSpeed, sprintSpeed: FEEL.sprintSpeed, timeToTopSpeed: FEEL.timeToTopSpeed, jumpApex: FEEL.jumpApex, tolerance: FEEL.tolerance }

export function CheckProbe({ player, ready, reset, onCameraOverride, feel = checkFeel, priority = 0.5, viewmodel }: {
  player: () => PlayerSample | null
  viewmodel?: () => readonly number[]
  ready: () => boolean
  reset?: () => void
  onCameraOverride?: (active: boolean) => void
  feel?: FeelModel
  priority?: number
}) {
  const camera = useThree(state => state.camera)
  const size = useThree(state => state.size)
  const override = useRef<CameraPose | null>(null)
  const rendered = useRef(false)
  const latest = useRef({ player, ready, reset, onCameraOverride })
  latest.current = { player, ready, reset, onCameraOverride }
  const check = useMemo(() => exposeCheck({
    bookmarks,
    camera(next) {
      override.current = next
      latest.current.onCameraOverride?.(next !== null)
      if (!next) { camera.clearViewOffset(); camera.updateProjectionMatrix() }
    },
    player: () => latest.current.player(),
    view: () => sampleView(camera, viewmodel?.()),
    audio: () => sound.sample(),
    scripts: { feelStart: async () => latest.current.reset?.() },
    input: { move: 'KeyW', sprint: 'ShiftLeft', jump: 'Space' },
    model: { feel, budget: BUDGET },
  }), [camera, feel])
  useEffect(() => () => { latest.current.onCameraOverride?.(false); check.dispose() }, [check])
  useFrame(() => {
    if (!check.probe.ready && latest.current.ready()) {
      if (rendered.current) check.ready()
      rendered.current = true
    }
    if (override.current) applyCameraPose(camera as Parameters<typeof applyCameraPose>[0], override.current, size)
  }, priority)
  return null
}
