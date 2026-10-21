import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { NoToneMapping } from 'three'
import { ViewHelper } from 'three/addons/helpers/ViewHelper.js'
import type { WebGPURenderer } from 'three/webgpu'

export const GIZMO_RENDER_PRIORITY = 2

export function AxesGizmo({ right = 16, bottom = 16 }: { right?: number; bottom?: number }) {
  const { gl, camera } = useThree()
  const renderer = gl as unknown as WebGPURenderer
  const helper = useMemo(() => {
    const created = new ViewHelper(camera, renderer.domElement)
    created.setLabels('X', 'Y', 'Z')
    return created
  }, [camera, renderer])
  useEffect(() => () => helper.dispose(), [helper])
  useFrame(() => {
    helper.location.right = right
    helper.location.bottom = bottom
    const { autoClear, toneMapping } = renderer
    const info = renderer.info.render
    const counters = { calls: info.calls, frameCalls: info.frameCalls, drawCalls: info.drawCalls, triangles: info.triangles }
    renderer.autoClear = false
    renderer.toneMapping = NoToneMapping
    helper.render(renderer as never)
    renderer.autoClear = autoClear
    renderer.toneMapping = toneMapping
    Object.assign(info, counters)
  }, GIZMO_RENDER_PRIORITY)
  return null
}
