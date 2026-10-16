import { use, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AnimationAction, AnimationMixer, Bone, Mesh, DirectionalLight, HemisphereLight, LoopOnce, LoopRepeat, PerspectiveCamera, Scene } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { FOUND_RELOAD_SECONDS } from './model'
import { portraitFov, type ArmsPresentation, type ArmsState } from '@blacksite/subject-fpp/arms'

let source: ReturnType<GLTFLoader['loadAsync']> | undefined
const load = () => source ??= new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}viewmodel/found-pistol.glb`)

export default function FoundViewmodel({ state, onPresentation }: { state: ArmsState; onPresentation: (presentation: ArmsPresentation | null) => void }) {
  const asset = use(load())
  const presentation = useMemo(() => {
    const scene = new Scene()
    const model = clone(asset.scene)
    const camera = new PerspectiveCamera(56, 1, 0.005, 10)
    camera.position.set(0, 1.42, -0.16)
    camera.lookAt(0, 1.42, 1)
    const light = new DirectionalLight('#fff3e2', 2.2)
    light.position.set(-1, 3, -2)
    scene.add(model, camera, light, new HemisphereLight('#dfe6ea', '#4a4638', 1.9))
    let boneCount = 0, triangles = 0
    model.traverse(object => { if (object instanceof Bone) boneCount++; if (object instanceof Mesh) triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3 })
    const mixer = new AnimationMixer(model)
    const actions = new Map(asset.animations.map(clip => [clip.name, mixer.clipAction(clip)]))
    return { scene, camera, mixer, actions, boneCount, triangles }
  }, [asset])
  const motion = useRef({ action: null as AnimationAction | null, name: '', remaining: 0, fire: state.fireSequence, reload: state.reloadSequence, time: 0 })
  useEffect(() => {
    onPresentation(presentation)
    return () => { onPresentation(null); presentation.mixer.stopAllAction(); presentation.mixer.uncacheRoot(presentation.mixer.getRoot()) }
  }, [presentation, onPresentation])
  useFrame(({ size, scene, camera }, delta) => {
    const current = motion.current
    const dt = Math.min(delta, 0.1) * state.timeScale + state.debug.advance
    state.debug.advance = 0
    const play = (name: string, once: boolean) => {
      const action = presentation.actions.get(name)!
      current.action?.fadeOut(0.06)
      const timeScale = name.startsWith('Reload') ? action.getClip().duration / FOUND_RELOAD_SECONDS : 1
      action.reset().setEffectiveTimeScale(timeScale).setLoop(once ? LoopOnce : LoopRepeat, Infinity).fadeIn(0.06).play()
      action.clampWhenFinished = once
      current.action = action
      current.name = name
      current.remaining = once ? action.getClip().duration / timeScale : 0
      current.time = 0
    }
    if (state.reloadSequence !== current.reload) { current.reload = state.reloadSequence; play(state.empty ? 'Reload_Empty' : 'Reload', true) }
    else if (state.fireSequence !== current.fire) { current.fire = state.fireSequence; play('Fire', true) }
    else if (current.remaining <= 0) {
      const name = state.sprinting ? 'Run' : state.speed > 0.05 ? 'Walk' : 'Idle'
      if (name !== current.name) play(name, false)
    }
    current.remaining = Math.max(0, current.remaining - dt)
    current.time += dt
    presentation.mixer.update(dt)
    const aspect = size.width / size.height
    presentation.camera.aspect = aspect
    presentation.camera.fov = portraitFov(56, aspect, 4 / 3)
    const crop = camera instanceof PerspectiveCamera ? camera.view : null
    if (crop?.enabled) presentation.camera.setViewOffset(crop.fullWidth, crop.fullHeight, crop.offsetX, crop.offsetY, crop.width, crop.height)
    else presentation.camera.clearViewOffset()
    presentation.camera.updateProjectionMatrix()
    presentation.scene.environment = scene.environment
    presentation.scene.environmentIntensity = scene.environmentIntensity
    state.debug.animationSeconds += dt
    state.debug.frames++
    state.debug.action = current.name.startsWith('Reload') ? 'reload' : current.name === 'Fire' ? 'fire' : null
    state.debug.actionTime = current.time
    state.debug.aimAmount = 0
    state.debug.sprintAmount = state.sprinting ? 1 : 0
    state.debug.weapon = 'pistol'
    state.debug.boneCount = presentation.boneCount
    state.debug.triangles = presentation.triangles
  }, 0.5)
  return null
}
