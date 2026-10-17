import { use, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { preloadArmsAssets } from './manifest'
import { compositePresentation, copyPresentationCrop, createPresentation, frameNarrow, type ArmsViewmodelProps } from './presentation'
import { createArmsRuntime, measureArmsAttachment } from './runtime'

export default function AlsViewmodel({ state, visible = true, manifestUrl, render = 'composite', onPresentation }: ArmsViewmodelProps) {
  const renderer = useThree(state => state.gl)
  const assets = use(preloadArmsAssets(manifestUrl, renderer))
  const runtime = useMemo(() => createArmsRuntime(assets, state), [assets, state])
  const fov = assets.manifest.fov ?? 56
  const presentation = useMemo(() => {
    const presentation = createPresentation(fov)
    presentation.camera.add(runtime.root)
    return presentation
  }, [fov, runtime])
  useEffect(() => () => runtime.dispose(), [runtime])
  useEffect(() => {
    onPresentation?.(presentation)
    return () => onPresentation?.(null)
  }, [presentation, onPresentation])
  useFrame(({ gl, scene, camera, size }, delta) => {
    runtime.update(Math.min(delta, 0.1) * state.timeScale + state.debug.advance)
    state.debug.advance = 0
    camera.updateWorldMatrix(true, false)
    const view = presentation.camera
    camera.getWorldPosition(view.position)
    camera.getWorldQuaternion(view.quaternion)
    frameNarrow(view, fov, size.width / size.height, state.debug.aimAmount)
    copyPresentationCrop(view, camera)
    view.updateWorldMatrix(true, true)
    presentation.scene.environment = scene.environment
    presentation.scene.visible = visible
    const error = measureArmsAttachment(camera, runtime.root)
    state.debug.cameraRelativeError = error
    state.debug.maxCameraRelativeError = Math.max(state.debug.maxCameraRelativeError, error)
    if (render === 'external') return
    compositePresentation(gl, { scene, camera }, presentation, visible)
  }, 0.5)
  return null
}
