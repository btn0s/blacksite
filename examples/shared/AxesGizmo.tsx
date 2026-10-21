import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { WebGLRenderer } from 'three'
import { ViewHelper } from 'three/addons/helpers/ViewHelper.js'

const SIZE = 128

// The gizmo draws on its own small canvas, so it never enters the level's frame, its temporal history or its screenshots.
export function AxesGizmo({ right = 16, bottom = 16 }: { right?: number; bottom?: number }) {
  const { camera, gl } = useThree()
  const overlay = useMemo(() => {
    const canvas = document.createElement('canvas')
    Object.assign(canvas.style, { position: 'absolute', width: `${SIZE}px`, height: `${SIZE}px`, pointerEvents: 'none', zIndex: '4' })
    const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(SIZE, SIZE, false)
    const helper = new ViewHelper(camera, canvas)
    helper.setLabels('X', 'Y', 'Z')
    return { canvas, renderer, helper }
  }, [camera])
  useEffect(() => {
    gl.domElement.parentElement?.appendChild(overlay.canvas)
    return () => { overlay.canvas.remove(); overlay.helper.dispose(); overlay.renderer.dispose() }
  }, [gl, overlay])
  useEffect(() => { Object.assign(overlay.canvas.style, { right: `${right}px`, bottom: `${bottom}px` }) }, [overlay, right, bottom])
  useFrame(() => {
    overlay.renderer.clear()
    overlay.helper.render(overlay.renderer)
  })
  return null
}
