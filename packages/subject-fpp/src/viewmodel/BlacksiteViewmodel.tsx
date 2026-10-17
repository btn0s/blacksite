import { use, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Euler, Quaternion } from 'three'
import { compositePresentation, copyPresentationCrop, createPresentation, frameNarrow, type ArmsViewmodelProps } from '../arms/presentation'
import { preloadViewmodelAssets } from './assets'
import { VIEWMODEL } from './model'
import { createViewmodelRuntime } from './runtime'

const view = new Quaternion()
const inverse = new Quaternion()
const euler = new Euler()
const environment = new Quaternion()

export default function BlacksiteViewmodel({ state, visible = true, manifestUrl, render = 'composite', onPresentation }: ArmsViewmodelProps) {
  const assets = use(preloadViewmodelAssets(manifestUrl))
  const runtime = useMemo(() => createViewmodelRuntime(assets, state), [assets, state])
  const fov = assets.manifest.fov ?? VIEWMODEL.fov
  const presentation = useMemo(() => {
    const presentation = createPresentation(fov)
    presentation.scene.add(runtime.root)
    return presentation
  }, [fov, runtime])
  useEffect(() => () => runtime.dispose(), [runtime])
  useEffect(() => {
    onPresentation?.(presentation)
    return () => onPresentation?.(null)
  }, [presentation, onPresentation])
  const size = useThree(state => state.size)
  useEffect(() => { frameNarrow(presentation.camera, fov, size.width / size.height, 0) }, [presentation, fov, size])
  useFrame(({ gl, scene, camera, size }, delta) => {
    camera.updateWorldMatrix(true, false)
    camera.getWorldQuaternion(view)
    runtime.update(delta, view)
    frameNarrow(presentation.camera, fov, size.width / size.height, state.debug.aimAmount)
    copyPresentationCrop(presentation.camera, camera)
    presentation.camera.updateWorldMatrix(true, true)
    presentation.scene.environment = scene.environment
    presentation.scene.environmentIntensity = scene.environmentIntensity
    inverse.copy(view).invert()
    presentation.scene.environmentRotation.copy(euler.setFromQuaternion(inverse.multiply(environment.setFromEuler(scene.environmentRotation))))
    presentation.scene.visible = visible
    if (render === 'external') return
    compositePresentation(gl, { scene, camera }, presentation, visible)
  }, 0.5)
  return null
}
