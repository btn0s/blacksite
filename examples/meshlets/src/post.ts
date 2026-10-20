import { RedFormat, RenderPipeline, UnsignedByteType, Vector2 } from 'three/webgpu'
import type { DepthTexture, PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu'
import { builtinAOContext, mrt, normalView, packNormalToRGB, pass, renderOutput, rtt, sample, screenUV, unpackRGBToNormal } from 'three/tsl'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'

export function createPost(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, depthLifecycle: {
  beforeDepth(size: Readonly<Vector2>): void
  afterDepth(depth: DepthTexture): void
}) {
  const normalPass = pass(scene, camera, { samples: 0 })
  normalPass.name = 'Depth and contact normals'
  normalPass.transparent = false
  normalPass.setMRT(mrt({ output: packNormalToRGB(normalView) }))
  normalPass.getTexture('output').type = UnsignedByteType

  const normals = sample(uv => unpackRGBToNormal(normalPass.getTextureNode().sample(uv)))
  const depth = normalPass.getTextureNode('depth')
  const ambient = ao(depth, normals, camera)
  ambient.resolutionScale = 0.5
  ambient.samples.value = 16
  ambient.radius.value = 1.25
  ambient.thickness.value = 1.1
  ambient.scale.value = 0.85

  const filter = denoise(ambient.getTextureNode(), depth, normals, camera)
  filter.radius.value = 3
  filter.depthPhi.value = 2
  filter.normalPhi.value = 8
  const occlusion = rtt(filter, null, null, { resolutionScale: 0.5, format: RedFormat, type: UnsignedByteType, depthBuffer: false })

  const scenePass = pass(scene, camera, { samples: 0, depthTexture: normalPass.renderTarget.depthTexture, autoClearDepth: false })
  scenePass.name = 'Lit scene'
  scenePass.before(normalPass)
  scenePass.contextNode = builtinAOContext(occlusion.sample(screenUV).r)
  const display = rtt(renderOutput(scenePass), null, null, { type: UnsignedByteType, depthBuffer: false })
  const antialias = fxaa(display)
  const pipeline = new RenderPipeline(renderer, antialias)
  pipeline.outputColorTransform = false
  const size = new Vector2()
  const previousBeforeRender = scene.onBeforeRender
  const previousAfterRender = scene.onAfterRender
  const beforeSceneRender: Scene['onBeforeRender'] = function (...args) {
    previousBeforeRender.apply(this, args)
    if (renderer.getRenderTarget() === normalPass.renderTarget) depthLifecycle.beforeDepth(size.set(normalPass.renderTarget.width, normalPass.renderTarget.height))
  }
  const afterSceneRender: Scene['onAfterRender'] = function (...args) {
    previousAfterRender.apply(this, args)
    if (renderer.getRenderTarget() === normalPass.renderTarget) depthLifecycle.afterDepth(normalPass.renderTarget.depthTexture!)
  }
  scene.onBeforeRender = beforeSceneRender
  scene.onAfterRender = afterSceneRender

  return {
    render() { pipeline.render() },
    dispose() {
      if (scene.onBeforeRender === beforeSceneRender) scene.onBeforeRender = previousBeforeRender
      if (scene.onAfterRender === afterSceneRender) scene.onAfterRender = previousAfterRender
      pipeline.dispose()
      antialias.dispose()
      display.dispose()
      scenePass.dispose()
      occlusion.dispose()
      filter.dispose()
      ambient.dispose()
      normalPass.dispose()
    },
  }
}
