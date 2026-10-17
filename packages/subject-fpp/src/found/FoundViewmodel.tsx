import { use, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Euler, Quaternion } from 'three'
import { compositePresentation, createPresentation, framePresentation, type ArmsViewmodelProps } from '../arms/presentation'
import { VIEWMODEL } from '../viewmodel/model'
import { preloadFoundAssets } from './assets'
import { createFoundRuntime } from './runtime'
import { FIELD_SET } from './sets'

const view = new Quaternion()
const inverse = new Quaternion()
const euler = new Euler()
const environment = new Quaternion()

export default function FoundViewmodel({ state, visible = true, render = 'composite', onPresentation, found = FIELD_SET }: ArmsViewmodelProps) {
  const assets = use(preloadFoundAssets(found))
  const runtime = useMemo(() => createFoundRuntime(assets, found, state), [assets, found, state])
  const fov = VIEWMODEL.fov
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
  useFrame(({ gl, scene, camera, size }, delta) => {
    camera.updateWorldMatrix(true, false)
    camera.getWorldQuaternion(view)
    runtime.update(delta, view)
    framePresentation(presentation.camera, camera, fov, size.width, size.height, found.portrait.aspect)
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
