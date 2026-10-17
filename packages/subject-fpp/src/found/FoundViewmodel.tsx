import { use, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Euler, Quaternion } from 'three'
import { compositePresentation, copyPresentationCrop, createPresentation, frameNarrow, type ArmsViewmodelProps } from '../arms/presentation'
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
  const size = useThree(state => state.size)
  useEffect(() => { frameNarrow(presentation.camera, fov, size.width / size.height, 0, found.portrait.aspect, found.portrait.camera) }, [presentation, fov, size, found])
  useFrame(({ gl, scene, camera, size }, delta) => {
    camera.updateWorldMatrix(true, false)
    camera.getWorldQuaternion(view)
    runtime.update(delta, view)
    const aim = state.debug.aimAmount
    frameNarrow(presentation.camera, fov, size.width / size.height, aim, found.portrait.aspect + (found.portrait.aimAspect - found.portrait.aspect) * aim, found.portrait.camera)
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
