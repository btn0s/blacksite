import { Suspense, use, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ACESFilmicToneMapping, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene } from 'three'
import { preloadArmsAssets } from './arms/manifest'
import { createArmsRuntime, measureArmsAttachment } from './arms/runtime'
import type { ArmsState } from './arms/state'

export { createArmsState } from './arms/state'
export type { ArmsState, ArmsWeapon, ArmsAction } from './arms/state'
export type { ArmsManifest, ArmsWeaponManifest } from './arms/manifest'

export function portraitFov(fov: number, aspect: number, minimum = 0.8) {
  if (aspect >= minimum) return fov
  return 2 * Math.atan(Math.tan(fov * Math.PI / 360) * minimum / aspect) * 180 / Math.PI
}

export interface ArmsPresentation {
  scene: Scene
  camera: PerspectiveCamera
}

export interface ArmsViewmodelProps {
  state: ArmsState
  visible?: boolean
  manifestUrl?: string
  render?: 'composite' | 'external'
  onPresentation?: (presentation: ArmsPresentation | null) => void
  overlay?: boolean
}

const NARROWEST_ASPECT = 4 / 3

export function ArmsViewmodel(props: ArmsViewmodelProps) {
  return <Suspense fallback={null}><LoadedArmsViewmodel {...props} /></Suspense>
}

function LoadedArmsViewmodel({ state, visible = true, manifestUrl, render = 'composite', onPresentation, overlay = false }: ArmsViewmodelProps) {
  const renderer = useThree(state => state.gl)
  const assets = use(preloadArmsAssets(manifestUrl, renderer))
  const runtime = useMemo(() => createArmsRuntime(assets, state), [assets, state])
  const presentation = useMemo(() => {
    const scene = new Scene()
    const camera = new PerspectiveCamera(assets.manifest.fov ?? 70, 1, 0.005, 10)
    camera.add(runtime.root)
    scene.add(camera, new HemisphereLight('#dfe6ea', '#4a4638', 1.9))
    const light = new DirectionalLight('#fff3e2', 2.2)
    light.position.set(-1, 3, 2)
    camera.add(light, light.target)
    return { scene, camera }
  }, [assets, runtime])
  useEffect(() => () => runtime.dispose(), [runtime])
  useEffect(() => {
    onPresentation?.(presentation)
    return () => onPresentation?.(null)
  }, [presentation, onPresentation])
  useFrame(({ gl, scene, camera, size }, delta) => {
    runtime.update(delta)
    camera.updateWorldMatrix(true, false)
    const view = presentation.camera
    camera.getWorldPosition(view.position)
    camera.getWorldQuaternion(view.quaternion)
    const aspect = size.width / size.height
    const fov = portraitFov(assets.manifest.fov ?? 70, aspect, NARROWEST_ASPECT)
    if (view.aspect !== aspect || view.fov !== fov) { view.aspect = aspect; view.fov = fov; view.updateProjectionMatrix() }
    view.updateWorldMatrix(true, true)
    presentation.scene.environment = scene.environment
    presentation.scene.visible = visible
    const error = measureArmsAttachment(camera, runtime.root)
    state.debug.cameraRelativeError = error
    state.debug.maxCameraRelativeError = Math.max(state.debug.maxCameraRelativeError, error)
    if (render === 'external') return
    const autoClear = gl.autoClear
    if (!overlay) {
      gl.autoClear = true
      gl.render(scene, camera)
    }
    if (visible) {
      const toneMapping = gl.toneMapping
      if (overlay) gl.toneMapping = ACESFilmicToneMapping
      gl.autoClear = false
      gl.clearDepth()
      gl.render(presentation.scene, view)
      gl.toneMapping = toneMapping
    }
    gl.autoClear = autoClear
  }, overlay ? 2 : 0.5)
  return null
}
