import { Color, InspectorBase, Lighting, NeutralToneMapping, NoToneMapping, PCFShadowMap, RenderPipeline, Vector2, Vector3 } from 'three/webgpu'
import type { Camera, Node, Object3D, OrthographicCamera, RenderTarget, Scene, WebGPURenderer } from 'three/webgpu'
import { builtinAOContext, float, luminance, mix, mrt, normalView, output, packNormalToRGB, pass, renderOutput, sample, screenUV, texture3D, uniform, uv, vec3, vec4, velocity } from 'three/tsl'
import { SunLight } from 'three/addons/lights/SunLight.js'
import { SunLightNode } from 'three/addons/lights/SunLightNode.js'
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js'
import { LightProbeGridNode } from 'three/addons/tsl/lighting/LightProbeGridNode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { traa } from 'three/addons/tsl/display/TRAANode.js'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { film } from 'three/addons/tsl/display/FilmNode.js'
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js'
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js'
import { circle } from 'three/addons/tsl/display/Shape.js'
import type { Atmosphere } from './atmosphere'
import { loadLut } from './lut'
import { atmosphereOf, type PresetName } from './presets'
import { type QualityTier } from './quality'
import { createWebGPUAtmosphere } from './webgpu-physical'
import { sunPenumbra } from './sun-penumbra'

export interface WebGPULookOptions {
  readonly atmosphere?: Atmosphere | PresetName
  readonly quality?: QualityTier
  readonly shadowDistance?: number
  readonly shadowMap?: number
  readonly shadowLayers?: readonly number[]
  readonly sunlight?: { readonly sunLux: number; readonly skyLux: number; readonly ev100: number; readonly sunSize?: number }
  readonly camera?: { readonly temperature?: number; readonly tint?: number; readonly contrast?: number; readonly toe?: number; readonly shoulder?: number; readonly lensSoftness?: number }
}

export interface WebGPULook {
  readonly sun: SunLight
  readonly pipeline: RenderPipeline
  readonly quality: QualityTier
  beginFrame(): void
  render(dt?: number): void
  setSize(width: number, height: number): void
  setDebug(enabled: boolean): void
  timings(): Readonly<Record<string, number>> | null
  onBeforeShadow(listener: WebGPUShadowListener): () => void
  dispose(): void
}

export type WebGPUShadowListener = (renderer: WebGPURenderer, camera: OrthographicCamera, mapSize: Readonly<Vector2>, cascade: number) => void

type TimestampBackend = WebGPURenderer['backend'] & {
  readonly isWebGPUBackend?: boolean
  hasTimestampQuery(uid: string): boolean
  getTimestamp(uid: string): number
}

class LookTimings extends InspectorBase {
  private readonly labels = { render: new Map<string, string>(), compute: new Map<string, string>() }
  private readonly targets = new WeakMap<RenderTarget, string>()
  private readonly cameras = new WeakMap<Camera, string>()
  private readonly latest: { render: Readonly<Record<string, number>> | null; compute: Readonly<Record<string, number>> | null } = { render: null, compute: null }
  private readonly pending = { render: false, compute: false }

  startFrame() { this.labels.render.clear(); this.labels.compute.clear() }
  labelTarget(target: RenderTarget, label: string) { this.targets.set(target, label) }
  labelCamera(camera: Camera, label: string) { this.cameras.set(camera, label) }

  override beginRender(uid: string, scene: Object3D, camera: Camera, target: RenderTarget | null) {
    const label = this.cameras.get(camera) || (target && this.targets.get(target)) || scene.name || target?.texture.name || 'Output'
    this.labels.render.set(uid, label)
  }

  override beginCompute(uid: string, nodes: Node | Node[]) {
    const group = Array.isArray(nodes) ? nodes : [nodes]
    this.labels.compute.set(uid, `Compute · ${group.map(node => node.name || node.type).join(' + ')}`)
  }

  resolve(renderer: WebGPURenderer) {
    if (!renderer.hasFeature('timestamp-query')) return
    const backend = renderer.backend as TimestampBackend
    for (const type of ['render', 'compute'] as const) {
      if (this.pending[type] || this.labels[type].size === 0) continue
      this.pending[type] = true
      const labels = new Map(this.labels[type])
      void renderer.resolveTimestampsAsync(type).then(() => {
        const timings: Record<string, number> = {}
        const occurrences = new Map<string, number>()
        for (const [uid, label] of labels) {
          if (!backend.hasTimestampQuery(uid)) continue
          const occurrence = (occurrences.get(label) ?? 0) + 1
          occurrences.set(label, occurrence)
          timings[occurrence === 1 ? label : `${label} (${occurrence})`] = backend.getTimestamp(uid)
        }
        if (Object.keys(timings).length) this.latest[type] = timings
      }).catch(() => { this.latest[type] = null }).finally(() => { this.pending[type] = false })
    }
  }

  snapshot() { return this.latest.render || this.latest.compute ? { ...this.latest.render, ...this.latest.compute } : null }
}

export function registerWebGPULighting(renderer: WebGPURenderer) {
  renderer.library.addLight(SunLightNode, SunLight)
  renderer.library.addLight(LightProbeGridNode, LightProbeGrid)
}

export async function createWebGPULook(renderer: WebGPURenderer, scene: Scene, camera: Camera, options: WebGPULookOptions = {}): Promise<WebGPULook> {
  await renderer.init()
  if (!(renderer.backend as TimestampBackend).isWebGPUBackend) throw new Error('This scene requires WebGPU')
  registerWebGPULighting(renderer)
  const atmosphere = atmosphereOf(options.atmosphere ?? 'nature')
  const quality = options.quality ?? 'high'
  const previous = { background: scene.background, backgroundNode: scene.backgroundNode, backgroundIntensity: scene.backgroundIntensity, environment: scene.environment, environmentIntensity: scene.environmentIntensity, fog: scene.fog, toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, autoReset: renderer.info.autoReset, inspector: renderer.inspector }
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = 1
  renderer.info.autoReset = false
  const sunlight = options.sunlight ?? { sunLux: 63000, skyLux: 16000, ev100: 14 }
  const exposure = 1 / (1.2 * 2 ** sunlight.ev100)
  const sun = new SunLight(new Color().setRGB(...atmosphere.sun.color), sunlight.sunLux * exposure)
  sun.name = 'Sun cascades'
  sun.position.set(...atmosphere.sun.direction)
  sun.castShadow = true
  sun.shadow.mapSize.setScalar(options.shadowMap ?? (quality === 'low' ? 1024 : 2048))
  sun.shadow.camera.far = options.shadowDistance ?? (quality === 'low' ? 90 : 180)
  sun.shadow.normalBias = 0.03
  sun.shadow.bias = -0.0002
  const sunAngle = uniform((sunlight.sunSize ?? 0.53) * Math.PI / 180)
  sun.shadow.filterNode = sunPenumbra(sun, sunAngle, quality === 'low' ? 8 : 16, quality === 'low' ? 12 : 24)
  scene.add(sun)
  const atmosphereGPU = await createWebGPUAtmosphere(renderer, atmosphere, quality)
  scene.background = null
  scene.backgroundNode = atmosphereGPU.backgroundNode
  scene.environment = atmosphereGPU.environment.texture
  const skyScale = sunlight.skyLux * exposure / atmosphereGPU.irradiance
  scene.environmentIntensity = skyScale
  scene.backgroundIntensity = skyScale
  scene.fog = null
  const pipeline = new RenderPipeline(renderer)
  pipeline.outputColorTransform = false
  const timings = new LookTimings()
  for (let index = 0; index < sun.shadow.getViewportCount(); index++) timings.labelCamera(sun.shadow.getCamera(index), `Sun cascade ${index + 1}`)
  const disposables: Array<{ dispose(): void }> = []
  const prePass = pass(scene, camera)
  prePass.name = 'Depth, normals and motion'
  prePass.transparent = false
  prePass.lighting = new Lighting()
  prePass.lighting.enabled = false
  prePass.setMRT(mrt({ output: packNormalToRGB(normalView), velocity }))
  timings.labelTarget(prePass.renderTarget, prePass.name)
  const normal = sample(coordinate => prePass.getTextureNode().sample(coordinate).rgb.mul(2).sub(1))
  const depth = prePass.getTextureNode('depth')
  const motion = prePass.getTextureNode('velocity')
  const scenePass = pass(scene, camera)
  scenePass.name = 'Scene lighting'
  scenePass.setMRT(mrt({ output }))
  timings.labelTarget(scenePass.renderTarget, scenePass.name)
  disposables.push(prePass, scenePass)
  if (quality !== 'low') {
    const gtao = ao(depth, normal, camera)
    gtao.resolutionScale = 0.5
    gtao.samples.value = quality === 'high' ? 16 : 8
    gtao.radius.value = 0.35
    gtao.scale.value = 1.8
    gtao.thickness.value = 0.5
    gtao.useTemporalFiltering = true
    scenePass.contextNode = builtinAOContext(gtao.getTextureNode().sample(screenUV).r)
    disposables.push(gtao)
  }
  const beauty = scenePass.getTextureNode('output')
  let color: Node<'vec4'> = atmosphereGPU.aerial(beauty, depth, camera, skyScale)
  const resolved = traa(color, depth, motion, camera)
  disposables.push(resolved)
  color = resolved
  if (quality !== 'low' && (atmosphere.grade.bloom ?? 0) > 0) {
    const glow = bloom(color, atmosphere.grade.bloom ?? 0, 0.6, 1.35)
    glow.smoothWidth.value = 0.5
    disposables.push(glow)
    color = vec4(color.rgb.add(glow.rgb), color.a)
  }
  const cameraGrade = options.camera ?? {}
  if (quality !== 'low' && (cameraGrade.lensSoftness ?? 0) > 0) {
    const soft = gaussianBlur(color, null, 3)
    disposables.push(soft)
    color = mix(color, soft, float(1).sub(circle(float(1.5), float(0.75), uv())).mul(cameraGrade.lensSoftness ?? 0))
  }
  const temperature = cameraGrade.temperature ?? 0
  const tint = cameraGrade.tint ?? 0
  const balance = new Vector3(1 + 0.25 * temperature, 1 + 0.12 * tint, 1 - 0.25 * temperature)
  balance.multiplyScalar(1 / (0.2126 * balance.x + 0.7152 * balance.y + 0.0722 * balance.z))
  const balanced = color.rgb.mul(uniform(balance)).mul(atmosphere.exposure)
  const saturated = mix(vec3(luminance(balanced)), balanced, atmosphere.grade.saturation ?? 1)
  const display = renderOutput(vec4(saturated, 1)).rgb
  const rolled = display.sub(display.pow(3).mul(cameraGrade.shoulder ?? 0))
  const toe = cameraGrade.toe ?? 0
  const lifted = rolled.mul(1 - toe).add(toe)
  const shaped = lifted.sub(0.5).mul(cameraGrade.contrast ?? 1).add(0.5).clamp(0, 1)
  let graded: Node<'vec4'> = vec4(shaped, 1)
  if (atmosphere.grade.lut) {
    const lut = await loadLut(atmosphere.grade.lut)
    graded = lut3D(graded, texture3D(lut.texture), lut.size, 1)
  }
  const centred = uv().sub(0.5)
  graded = vec4(graded.rgb.mul(float(1).sub(centred.dot(centred).mul(atmosphere.grade.vignette))), 1)
  if (atmosphere.grade.grain > 0) graded = film(graded, atmosphere.grade.grain)
  pipeline.outputNode = graded
  renderer.inspector = timings
  const shadowListeners = new Set<WebGPUShadowListener>()
  const previousBeforeRender = scene.onBeforeRender
  const beforeSceneRender: Scene['onBeforeRender'] = function (...args) {
    previousBeforeRender.apply(this, args)
    const [renderer, , activeCamera] = args
    for (let cascade = 0; cascade < sun.shadow.getViewportCount(); cascade++) {
      const shadowCamera = sun.shadow.getCamera(cascade)
      if (activeCamera !== shadowCamera) continue
      for (const listener of shadowListeners) listener(renderer as unknown as WebGPURenderer, shadowCamera, sun.shadow.mapSize, cascade)
      break
    }
  }
  scene.onBeforeRender = beforeSceneRender
  let disposed = false
  return {
    sun,
    pipeline,
    quality,
    beginFrame() {
      renderer.info.reset()
      timings.startFrame()
    },
    render(dt = 0) {
      if (disposed) return
      atmosphereGPU.tick(dt)
      for (let index = 0; index < sun.shadow.getViewportCount(); index++) {
        const layers = sun.shadow.getCamera(index).layers
        layers.mask = camera.layers.mask
        for (const layer of options.shadowLayers ?? []) layers.enable(layer)
      }
      pipeline.render()
      timings.resolve(renderer)
    },
    setSize(width, height) {
      const current = renderer.getSize(new Vector2())
      if (current.x !== width || current.y !== height) renderer.setSize(width, height, false)
    },
    setDebug(enabled) {
      pipeline.outputNode = enabled ? renderOutput(beauty, NoToneMapping) : graded
      pipeline.needsUpdate = true
    },
    timings() { return timings.snapshot() },
    onBeforeShadow(listener) {
      shadowListeners.add(listener)
      return () => { shadowListeners.delete(listener) }
    },
    dispose() {
      disposed = true
      shadowListeners.clear()
      if (scene.onBeforeRender === beforeSceneRender) scene.onBeforeRender = previousBeforeRender
      renderer.inspector = previous.inspector
      timings.dispose()
      pipeline.dispose()
      for (const resource of disposables) resource.dispose()
      atmosphereGPU.dispose()
      sun.removeFromParent()
      sun.dispose()
      scene.background = previous.background
      scene.backgroundNode = previous.backgroundNode
      scene.backgroundIntensity = previous.backgroundIntensity
      scene.environment = previous.environment
      scene.environmentIntensity = previous.environmentIntensity
      scene.fog = previous.fog
      renderer.toneMapping = previous.toneMapping
      renderer.toneMappingExposure = previous.exposure
      renderer.info.autoReset = previous.autoReset
    },
  }
}
