import { Color, FloatType, InspectorBase, Lighting, NearestFilter, NeutralToneMapping, NoToneMapping, NodeMaterial, PCFShadowMap, QuadMesh, RenderPipeline, RenderTarget, Vector2, Vector3 } from 'three/webgpu'
import type { Camera, DepthTexture, Node, Object3D, OrthographicCamera, Scene, WebGPURenderer } from 'three/webgpu'
import { builtinAOContext, context, convertToTexture, faceDirection, float, log2, luminance, max, mix, mrt, normalViewGeometry, output, packNormalToRGB, pass, renderGroup, renderOutput, sample, screenUV, smoothstep, texture3D, uniform, uv, vec2, vec3, vec4, velocity } from 'three/tsl'
import { SunLight } from 'three/addons/lights/SunLight.js'
import { SunLightNode } from 'three/addons/lights/SunLightNode.js'
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js'
import { LightProbeGridNode } from 'three/addons/tsl/lighting/LightProbeGridNode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { traa } from 'three/addons/tsl/display/TRAANode.js'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { film as grainNode } from 'three/addons/tsl/display/FilmNode.js'
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js'
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js'
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js'
import { circle } from 'three/addons/tsl/display/Shape.js'
import type { Atmosphere } from './atmosphere'
import { loadLut } from './lut'
import { atmosphereOf, type PresetName } from './presets'
import { type QualityTier } from './quality'
import { createWebGPUAtmosphere } from './webgpu-physical'
import { sunPenumbra } from './sun-penumbra'
import { StaggeredSunShadowNode } from './sun-cascades'
import { createFilm, type FilmOptions } from './film'
import { EyeAdaptation } from './exposure'
import { LookTelemetry, type MotionProbe } from './telemetry'
import { createGrading } from './grading'
import { sunShafts } from './shafts'
import { resolveTuning, withClouds, type LookFeatures, type LookTuning } from './tuning'

export { LookTelemetry } from './telemetry'
export type { FrameTrace, LookTelemetrySnapshot, MotionProbe, PassTrace } from './telemetry'

const METER = [64, 36] as const
const METER_INTERVAL = 66

export { LOOK_CONTROLS } from './tuning'
export type { LookControl, LookFeatures, LookTuning } from './tuning'

export type WebGPULookStage = 'traa' | 'ao' | 'penumbra' | 'shafts'

export interface WebGPULookOptions {
  readonly disable?: readonly WebGPULookStage[]
  readonly atmosphere?: Atmosphere | PresetName
  readonly quality?: QualityTier
  readonly shadowDistance?: number
  readonly shadowMap?: number
  readonly shadowLayers?: readonly number[]
  readonly shadowCascades?: number
  readonly sunlight?: { readonly sunLux: number; readonly skyLux?: number; readonly ev100: number; readonly sunSize?: number }
  readonly film?: FilmOptions
  readonly camera?: { readonly temperature?: number; readonly tint?: number; readonly contrast?: number; readonly toe?: number; readonly shoulder?: number; readonly lensSoftness?: number }
  readonly tuning?: Partial<LookTuning>
}

export interface WebGPULook {
  readonly sun: SunLight
  readonly pipeline: RenderPipeline
  readonly quality: QualityTier
  readonly telemetry: LookTelemetry
  readonly tuning: Readonly<LookTuning>
  readonly features: Readonly<LookFeatures>
  tune(next: Partial<LookTuning>): void
  setFeature(name: keyof LookFeatures, enabled: boolean): void
  beginFrame(): void
  setCamera(camera: Camera): void
  compile(compiler: WebGPUCompiler, ownedRoots?: readonly Object3D[]): Promise<void>
  render(dt?: number): void
  setSize(width: number, height: number): void
  setDebug(enabled: boolean): void
  setTemporal(options: { traa?: boolean; gtao?: boolean }): void
  probeMotion(): Promise<MotionProbe>
  timings(): Readonly<Record<string, number>> | null
  onBeforeDepth(listener: WebGPUBeforeDepthListener): () => void
  onBeforeLit(listener: WebGPUBeforeDepthListener): () => void
  onAfterDepth(listener: WebGPUAfterDepthListener): () => void
  onBeforeShadow(listener: WebGPUShadowListener): () => void
  dispose(): void
}

export type WebGPUShadowListener = (renderer: WebGPURenderer, camera: OrthographicCamera, mapSize: Readonly<Vector2>, cascade: number) => void
export type WebGPUBeforeDepthListener = (renderer: WebGPURenderer, camera: Camera, size: Readonly<Vector2>) => void
export type WebGPUAfterDepthListener = (renderer: WebGPURenderer, camera: Camera, depth: DepthTexture) => void
export interface WebGPUCompilePass {
  readonly camera: Camera
  readonly pass: 'depth' | 'lit' | 'shadow'
  compile(object: Object3D): Promise<void>
}
export type WebGPUCompiler = (passes: readonly WebGPUCompilePass[]) => Promise<void>

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

export async function createWebGPULook(renderer: WebGPURenderer, scene: Scene, viewCamera: Camera, options: WebGPULookOptions = {}): Promise<WebGPULook> {
  await renderer.init()
  const camera = viewCamera.clone()
  const syncCamera = () => {
    viewCamera.updateWorldMatrix(true, false)
    camera.copy(viewCamera, false)
    camera.matrixAutoUpdate = false
    camera.matrixWorldAutoUpdate = false
  }
  syncCamera()
  if (!(renderer.backend as TimestampBackend).isWebGPUBackend) throw new Error('This scene requires WebGPU')
  registerWebGPULighting(renderer)
  const authored = atmosphereOf(options.atmosphere ?? 'nature')
  const tuning = resolveTuning(authored, options.tuning)
  const features: LookFeatures = { shafts: true, bloom: true, clouds: true, lens: true }
  const atmosphere = withClouds(authored, tuning)
  const quality = options.quality ?? 'high'
  const disabled = new Set(options.disable ?? [])
  const previous = { background: scene.background, backgroundNode: scene.backgroundNode, backgroundIntensity: scene.backgroundIntensity, environment: scene.environment, environmentIntensity: scene.environmentIntensity, fog: scene.fog, toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, autoReset: renderer.info.autoReset, inspector: renderer.inspector }
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = 1
  renderer.info.autoReset = false
  const sunlight = options.sunlight ?? { sunLux: 63000, skyLux: 16000, ev100: 14 }
  const exposure = 1 / (1.2 * 2 ** sunlight.ev100)
  const sunIntensity = sunlight.sunLux * exposure
  const sun = new SunLight(new Color().setRGB(...atmosphere.sun.color), sunIntensity * tuning.sunStrength, options.shadowCascades ?? 2)
  sun.name = 'Sun cascades'
  sun.position.set(...atmosphere.sun.direction)
  sun.castShadow = true
  sun.shadow.mapSize.setScalar(options.shadowMap ?? (quality === 'low' ? 1024 : 2048))
  sun.shadow.camera.far = options.shadowDistance ?? (quality === 'low' ? 90 : 180)
  sun.shadow.normalBias = 0.03
  sun.shadow.bias = -0.0002
  const sunAngle = uniform((sunlight.sunSize ?? 0.53) * Math.PI / 180).setGroup(renderGroup)
  if (!disabled.has('penumbra')) sun.shadow.filterNode = sunPenumbra(sun, sunAngle, 8, 12)
  const shadows = new StaggeredSunShadowNode(sun, scene, camera, renderer.reversedDepthBuffer)
  sun.shadow.shadowNode = shadows
  scene.add(sun)
  const atmosphereGPU = await createWebGPUAtmosphere(renderer, atmosphere, quality, tuning.groundBounce)
  scene.background = null
  scene.backgroundNode = atmosphereGPU.backgroundNode
  scene.environment = atmosphereGPU.environment.texture
  const skyScale = (sunlight.skyLux === undefined ? sunlight.sunLux / atmosphere.physical!.illuminance : sunlight.skyLux / atmosphereGPU.irradiance) * exposure
  scene.environmentIntensity = skyScale * tuning.ambient
  scene.backgroundIntensity = skyScale
  scene.fog = null
  const pipeline = new RenderPipeline(renderer)
  pipeline.outputColorTransform = false
  const timings = new LookTimings()
  for (let index = 0; index < sun.shadow.getViewportCount(); index++) timings.labelCamera(sun.shadow.getCamera(index), `Sun cascade ${index + 1}`)
  const disposables: Array<{ dispose(): void }> = []
  let gtaoNode: { useTemporalFiltering: boolean } | null = null
  const prePass = pass(scene, camera)
  prePass.name = 'Depth, normals and motion'
  prePass.transparent = false
  prePass.lighting = new Lighting()
  prePass.lighting.enabled = false
  prePass.setMRT(mrt({ output: packNormalToRGB(normalViewGeometry.mul(faceDirection)), velocity }))
  timings.labelTarget(prePass.renderTarget, prePass.name)
  const normal = sample(coordinate => prePass.getTextureNode().sample(coordinate).rgb.mul(2).sub(1))
  const depth = prePass.getTextureNode('depth')
  const motion = prePass.getTextureNode('velocity')
  const scenePass = pass(scene, camera, { depthTexture: prePass.renderTarget.depthTexture!, autoClearDepth: false })
  scenePass.name = 'Scene lighting'
  scenePass.before(prePass)
  scenePass.before(shadows)
  scenePass.setMRT(mrt({ output }))
  const litContext = { radianceScale: uniform(exposure).setGroup(renderGroup) }
  scenePass.contextNode = context(litContext)
  timings.labelTarget(scenePass.renderTarget, scenePass.name)
  disposables.push(prePass, scenePass)
  if (quality !== 'low' && !disabled.has('ao')) {
    const gtao = ao(depth, normal, camera)
    gtao.resolutionScale = 0.5
    gtao.samples.value = quality === 'high' ? 16 : 8
    gtao.radius.value = 0.35
    gtao.scale.value = 1.8
    gtao.thickness.value = 0.5
    gtao.useTemporalFiltering = true
    gtaoNode = gtao
    scenePass.before(gtao)
    scenePass.contextNode = context({ ...builtinAOContext(gtao.getTextureNode().sample(screenUV).r).value, ...litContext })
    disposables.push(gtao)
  }
  const beauty = scenePass.getTextureNode('output')
  const fogged: Node<'vec4'> = atmosphereGPU.aerial(beauty, depth, camera, skyScale)
  const shafts = disabled.has('shafts') ? null : sunShafts({ sun, shadowMap: shadows.depthTexture, direction: atmosphere.sun.direction, camera, depth, fog: atmosphereGPU.fog, fogAlbedo: atmosphereGPU.fogAlbedo, color: [atmosphere.sun.color[0] * atmosphere.physical!.illuminance, atmosphere.sun.color[1] * atmosphere.physical!.illuminance, atmosphere.sun.color[2] * atmosphere.physical!.illuminance], radianceScale: skyScale, reversedShadow: renderer.reversedDepthBuffer })
  const aerial: Node<'vec4'> = shafts ? vec4(fogged.rgb.add(shafts.node), fogged.a) : fogged
  const resolved = disabled.has('traa') ? null : traa(aerial, depth, motion, camera)
  const stable = resolved ? resolved.getTextureNode() : convertToTexture(aerial)
  disposables.push(resolved ?? stable)
  const cameraGrade = options.camera ?? {}
  const film = options.film ? createFilm(options.film) : null
  const lutImage = atmosphere.grade.lut ? await loadLut(atmosphere.grade.lut) : null
  const adaptation = film ? new EyeAdaptation(film.exposure, 2 ** sunlight.ev100) : null
  const filmScale = uniform(adaptation ? adaptation.scale / exposure : 1).setGroup(renderGroup)
  const grading = createGrading({ film, quality, atmosphere, camera: cameraGrade, lut: lutImage, filmScale, tuning })
  disposables.push(...grading.disposables)
  const grade = grading.grade
  const exposureScale = grading.exposureScale
  const temporal = { traa: resolved !== null, gtao: true }
  const stages = () => ({ bloom: quality !== 'low' && features.bloom && tuning.bloom > 0, lens: quality !== 'low' && features.lens && tuning.aberration > 0, grain: tuning.grain > 0 })
  const outputs = new Map<string, Node<'vec4'>>()
  const compose = () => {
    const active = stages()
    const mode = resolved && !temporal.traa ? 'plain' : 'temporal'
    const key = `${mode}|${active.bloom}|${active.lens}|${active.grain}`
    let node = outputs.get(key)
    if (!node) {
      node = grade(mode === 'plain' ? aerial : stable, active)
      outputs.set(key, node)
    }
    return node
  }
  const meter = film ? (() => {
    const target = new RenderTarget(METER[0], METER[1], { type: FloatType, depthBuffer: false, minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false })
    target.texture.name = 'Exposure metering'
    const jitter = uniform(new Vector2()).setGroup(renderGroup)
    const materialFor = (source: { sample(coordinate: Node<'vec2'>): Node<'vec4'> }) => {
      const material = new NodeMaterial({ depthTest: false, depthWrite: false })
      const sampled = source.sample(screenUV.add(jitter.sub(0.5).div(vec2(METER[0], METER[1])))).rgb
      material.fragmentNode = vec4(log2(sampled.dot(vec3(1 / 3)).div(exposure).max(2 ** film.exposure.histogram[0])), 0, 0, 1)
      return material
    }
    const temporalMeter = materialFor(stable), plain = materialFor(beauty)
    timings.labelTarget(target, 'Exposure metering')
    return { target, jitter, temporal: temporalMeter, plain, quad: new QuadMesh(temporalMeter) }
  })() : null
  let graded = compose()
  pipeline.outputNode = graded
  renderer.inspector = timings
  const trace = new LookTelemetry(renderer, camera, () => sun.shadow.getViewportCount(), index => shadows.age(index), () => {
    const history = (resolved as unknown as { _historyRenderTarget?: { width: number; height: number } } | null)?._historyRenderTarget
    return history ? { width: history.width, height: history.height } : null
  }, temporal)
  const backend = renderer.backend as unknown as { draw(renderObject: unknown, info: unknown): void; get(object: unknown): { pipeline?: unknown; error?: boolean } }
  const originalDraw = backend.draw
  backend.draw = function (this: unknown, renderObject: { pipeline: unknown }, info: unknown) {
    const data = backend.get(renderObject.pipeline)
    trace.recordDraw(data.pipeline !== undefined && data.error !== true)
    return originalDraw.call(backend, renderObject, info)
  } as typeof backend.draw
  let motionRequest: { resolve(value: MotionProbe): void; reject(error: unknown): void } | null = null
  let motionPromise: Promise<MotionProbe> | null = null
  const shadowListeners = new Set<WebGPUShadowListener>()
  const beforeDepthListeners = new Set<WebGPUBeforeDepthListener>()
  const beforeLitListeners = new Set<WebGPUBeforeDepthListener>()
  const afterDepthListeners = new Set<WebGPUAfterDepthListener>()
  const depthSize = new Vector2()
  let preparingCompile = false
  const captureState = (camera: Camera, pass: 'depth' | 'lit' | 'shadow') => ({
    camera, pass, target: renderer.getRenderTarget(), mrt: renderer.getMRT(), lighting: renderer.lighting,
    context: renderer.contextNode, override: scene.overrideMaterial, toneMapping: renderer.toneMapping, outputColorSpace: renderer.outputColorSpace,
    cubeFace: renderer.getActiveCubeFace(), mipLevel: renderer.getActiveMipmapLevel(),
    opaque: renderer.opaque, transparent: renderer.transparent,
  })
  const applyState = (state: ReturnType<typeof captureState>) => {
    renderer.setRenderTarget(state.target, state.cubeFace, state.mipLevel)
    renderer.setMRT(state.mrt)
    renderer.lighting = state.lighting
    renderer.contextNode = state.context
    renderer.toneMapping = state.toneMapping
    renderer.outputColorSpace = state.outputColorSpace
    renderer.opaque = state.opaque
    renderer.transparent = state.transparent
    scene.overrideMaterial = state.override
  }
  const states = new Map<string, ReturnType<typeof captureState>>()
  const shadowKind = (active: Camera) => {
    for (let cascade = 0; cascade < sun.shadow.getViewportCount(); cascade++) if (active === sun.shadow.getCamera(cascade)) return `shadow${cascade}`
    return 'other'
  }
  const previousBeforeRender = scene.onBeforeRender
  const previousAfterRender = scene.onAfterRender
  const beforeSceneRender: Scene['onBeforeRender'] = function (...args) {
    previousBeforeRender.apply(this, args)
    if (preparingCompile || args[1] !== scene) return
    const [renderer, , activeCamera, target] = args
    trace.beginPass(target === prePass.renderTarget ? 'depth' : target === scenePass.renderTarget ? 'lit' : shadowKind(activeCamera), activeCamera, target)
    if (target === prePass.renderTarget) {
      states.set('depth', captureState(activeCamera, 'depth'))
      depthSize.set(target.width, target.height)
      for (const listener of beforeDepthListeners) listener(renderer as unknown as WebGPURenderer, activeCamera, depthSize)
    }
    if (target === scenePass.renderTarget) {
      states.set('lit', captureState(activeCamera, 'lit'))
      depthSize.set(target.width, target.height)
      for (const listener of beforeLitListeners) listener(renderer as unknown as WebGPURenderer, activeCamera, depthSize)
    }
    for (let cascade = 0; cascade < sun.shadow.getViewportCount(); cascade++) {
      const shadowCamera = sun.shadow.getCamera(cascade)
      if (activeCamera !== shadowCamera) continue
      states.set(`shadow${cascade}`, captureState(shadowCamera, 'shadow'))
      for (const listener of shadowListeners) listener(renderer as unknown as WebGPURenderer, shadowCamera, sun.shadow.mapSize, cascade)
      break
    }
  }
  const afterSceneRender: Scene['onAfterRender'] = function (...args) {
    previousAfterRender.apply(this, args)
    if (preparingCompile || args[1] !== scene) return
    const [renderer, , activeCamera, target] = args
    trace.endPass()
    if (target === prePass.renderTarget) {
      for (const listener of afterDepthListeners) listener(renderer as unknown as WebGPURenderer, activeCamera, prePass.renderTarget.depthTexture!)
    }
  }
  scene.onBeforeRender = beforeSceneRender
  scene.onAfterRender = afterSceneRender
  const updateCamera = () => {
    syncCamera()
    for (let index = 0; index < sun.shadow.getViewportCount(); index++) {
      const layers = sun.shadow.getCamera(index).layers
      layers.mask = camera.layers.mask
      for (const layer of options.shadowLayers ?? []) layers.enable(layer)
    }
  }
  let disposed = false
  let debugging = false
  let metering = false
  let meterTime = performance.now()
  let rebakeAt = 0
  const ENVIRONMENT_KEYS: ReadonlyArray<keyof LookTuning> = ['cloudCoverage', 'cloudAltitude', 'cloudDensity', 'groundBounce']
  const reselect = () => {
    graded = compose()
    if (!debugging) { pipeline.outputNode = graded; pipeline.needsUpdate = true }
  }
  const applyTuning = () => {
    atmosphereGPU.setClouds(features.clouds ? tuning.cloudCoverage : 0, tuning.cloudAltitude, tuning.cloudDensity)
    atmosphereGPU.setFog(tuning.fogDensity, tuning.fogHeight)
    atmosphereGPU.setHaze(tuning.haze)
    const shaftStrength = shafts && features.shafts ? tuning.shafts * tuning.sunStrength : 0
    atmosphereGPU.setFogSun(shaftStrength > 0 ? 0 : tuning.sunStrength)
    atmosphereGPU.setGroundBounce(tuning.groundBounce)
    sun.intensity = sunIntensity * tuning.sunStrength
    scene.environmentIntensity = skyScale * tuning.ambient
    if (shafts) shafts.strength.value = shaftStrength
    grading.values.ev.value = 2 ** tuning.exposure
    grading.values.bloom.value = tuning.bloom
    grading.values.saturation.value = tuning.saturation
    grading.values.coolness.value = tuning.coolness
    grading.values.vignette.value = tuning.vignette
    grading.values.grain.value = tuning.grain
    grading.values.aberration.value = tuning.aberration
  }
  applyTuning()
  return {
    sun,
    pipeline,
    quality,
    telemetry: trace,
    tuning,
    features,
    tune(next) {
      let environment = false
      for (const key of Object.keys(next) as Array<keyof LookTuning>) {
        const value = next[key]
        if (value === undefined || value === tuning[key]) continue
        tuning[key] = value
        if (ENVIRONMENT_KEYS.includes(key)) environment = true
      }
      applyTuning()
      if (environment) rebakeAt = performance.now() + 200
      if (compose() !== graded) reselect()
    },
    setFeature(name, enabled) {
      if (features[name] === enabled) return
      features[name] = enabled
      applyTuning()
      if (name === 'clouds') rebakeAt = performance.now() + 50
      if (name === 'bloom' || name === 'lens') reselect()
    },
    beginFrame() {
      if (disposed) return
      renderer.info.reset()
      timings.startFrame()
    },
    setCamera(next) {
      if (viewCamera === next) return
      viewCamera = next
      syncCamera()
      shadows.reset()
      resolved?.setSize(1, 1)
    },
    async compile(compiler, ownedRoots = []) {
      if (disposed) return
      const visibility = ownedRoots.map(root => root.visible)
      for (const root of ownedRoots) root.visible = false
      const ordinary: Promise<void>[] = []
      const passes: WebGPUCompilePass[] = []
      try {
        updateCamera()
        pipeline.render()
        for (const state of states.values()) {
          const compile = (object: Object3D) => {
            const previous = captureState(camera, 'lit')
            preparingCompile = true
            try {
              applyState(state)
              return renderer.compileAsync(object, state.camera, scene)
            } finally {
              applyState(previous)
              preparingCompile = false
            }
          }
          passes.push({ camera: state.camera, pass: state.pass, compile })
          if (state.pass !== 'shadow') ordinary.push(compile(scene))
        }
      } finally {
        ownedRoots.forEach((root, index) => { root.visible = visibility[index]! })
      }
      await Promise.all([...ordinary, compiler(passes)])
      shadows.reset()
    },
    render(dt = 0) {
      if (disposed) return
      if (rebakeAt && performance.now() >= rebakeAt) { rebakeAt = 0; atmosphereGPU.rebake() }
      updateCamera()
      trace.beginFrame(dt)
      atmosphereGPU.tick(dt)
      pipeline.render()
      trace.endFrame()
      if (motionRequest) {
        const request = motionRequest
        motionRequest = null
        const velocityTarget = prePass.renderTarget
        const internals = resolved as unknown as { beautyNode: { renderTarget: RenderTarget }; _resolveRenderTarget: RenderTarget } | null
        if (!internals) request.reject(new Error('Temporal AA is disabled'))
        else trace.probeMotion(velocityTarget, velocityTarget.textures.findIndex(texture => texture.name === 'velocity'), internals.beautyNode.renderTarget, internals._resolveRenderTarget).then(request.resolve, request.reject)
      }
      if (meter && adaptation && !metering && performance.now() - meterTime > METER_INTERVAL) {
        metering = true
        meter.jitter.value.set(Math.random(), Math.random())
        const previous = renderer.getRenderTarget()
        renderer.setRenderTarget(meter.target)
        meter.quad.material = temporal.traa ? meter.temporal : meter.plain
        meter.quad.render(renderer)
        renderer.setRenderTarget(previous)
        void renderer.readRenderTargetPixelsAsync(meter.target, 0, 0, METER[0], METER[1]).then(data => {
          const now = performance.now()
          adaptation.update(data as Float32Array, 4, Math.min((now - meterTime) / 1000, 0.25))
          meterTime = now
          filmScale.value = adaptation.scale / exposure
        }).catch(() => {}).finally(() => { metering = false })
      }
      timings.resolve(renderer)
    },
    setSize(width, height) {
      const current = renderer.getSize(new Vector2())
      if (current.x !== width || current.y !== height) renderer.setSize(width, height, false)
    },
    setDebug(enabled) {
      debugging = enabled
      pipeline.outputNode = enabled ? renderOutput(beauty, NoToneMapping) : graded
      pipeline.needsUpdate = true
    },
    setTemporal(next) {
      if (next.gtao !== undefined && gtaoNode) { gtaoNode.useTemporalFiltering = next.gtao; temporal.gtao = next.gtao }
      if (resolved && next.traa !== undefined && next.traa !== temporal.traa) {
        temporal.traa = next.traa
        if (next.traa) resolved.setSize(1, 1)
        reselect()
        trace.mark(next.traa ? 'traa-on' : 'traa-off')
      }
    },
    probeMotion() {
      motionPromise ??= new Promise<MotionProbe>((resolve, reject) => {
        motionRequest = { resolve: value => { motionPromise = null; resolve(value) }, reject: error => { motionPromise = null; reject(error) } }
      })
      return motionPromise
    },
    timings() { return timings.snapshot() },
    onBeforeDepth(listener) {
      beforeDepthListeners.add(listener)
      return () => { beforeDepthListeners.delete(listener) }
    },
    onBeforeLit(listener) {
      beforeLitListeners.add(listener)
      return () => { beforeLitListeners.delete(listener) }
    },
    onAfterDepth(listener) {
      afterDepthListeners.add(listener)
      return () => { afterDepthListeners.delete(listener) }
    },
    onBeforeShadow(listener) {
      shadowListeners.add(listener)
      return () => { shadowListeners.delete(listener) }
    },
    dispose() {
      disposed = true
      shadowListeners.clear()
      beforeDepthListeners.clear()
      beforeLitListeners.clear()
      afterDepthListeners.clear()
      if (scene.onBeforeRender === beforeSceneRender) scene.onBeforeRender = previousBeforeRender
      if (scene.onAfterRender === afterSceneRender) scene.onAfterRender = previousAfterRender
      renderer.inspector = previous.inspector
      timings.dispose()
      pipeline.dispose()
      for (const resource of disposables) resource.dispose()
      atmosphereGPU.dispose()
      meter?.target.dispose()
      meter?.temporal.dispose()
      meter?.plain.dispose()
      backend.draw = originalDraw
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
