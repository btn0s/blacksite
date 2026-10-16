import { ACESFilmicToneMapping, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, type Camera, type WebGLRenderer } from 'three'
import type { ArmsRig, ArmsState } from './state'

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
  rig?: ArmsRig
  render?: 'composite' | 'external'
  onPresentation?: (presentation: ArmsPresentation | null) => void
  overlay?: boolean
}

export const NARROWEST_ASPECT = 4 / 3

export function createPresentation(fov: number) {
  const scene = new Scene()
  const camera = new PerspectiveCamera(fov, 1, 0.005, 10)
  scene.add(camera, new HemisphereLight('#dfe6ea', '#4a4638', 1.9))
  const light = new DirectionalLight('#fff3e2', 2.2)
  light.position.set(-1, 3, 2)
  camera.add(light, light.target)
  return { scene, camera }
}

export function frameNarrow(view: PerspectiveCamera, fov: number, aspect: number, aim: number) {
  const vertical = portraitFov(fov, aspect, NARROWEST_ASPECT)
  const narrow = Math.min(1, Math.max(0, (NARROWEST_ASPECT - aspect) / (NARROWEST_ASPECT - 0.5)))
  const shift = Math.round(narrow * (1 - aim) * 0.16 * view.getFilmWidth() * 1000) / 1000
  if (view.aspect !== aspect || view.fov !== vertical || view.filmOffset !== shift) { view.aspect = aspect; view.fov = vertical; view.filmOffset = shift; view.updateProjectionMatrix() }
}

export function copyPresentationCrop(view: PerspectiveCamera, source: Camera) {
  const crop = (source as PerspectiveCamera).view
  if (crop?.enabled) view.setViewOffset(crop.fullWidth, crop.fullHeight, crop.offsetX, crop.offsetY, crop.width, crop.height)
  else if (view.view?.enabled) view.clearViewOffset()
}

export function compositePresentation(gl: WebGLRenderer, world: { scene: Scene; camera: Camera }, presentation: ArmsPresentation, visible: boolean, overlay: boolean) {
  const autoClear = gl.autoClear
  if (!overlay) {
    gl.autoClear = true
    gl.render(world.scene, world.camera)
  }
  if (visible) {
    const toneMapping = gl.toneMapping
    if (overlay) gl.toneMapping = ACESFilmicToneMapping
    gl.autoClear = false
    gl.clearDepth()
    gl.render(presentation.scene, presentation.camera)
    gl.toneMapping = toneMapping
  }
  gl.autoClear = autoClear
}
