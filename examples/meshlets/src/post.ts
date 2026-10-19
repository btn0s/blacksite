import { RedFormat, RenderPipeline, UnsignedByteType } from 'three/webgpu'
import type { PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu'
import { builtinAOContext, mrt, normalView, packNormalToRGB, pass, renderOutput, rtt, sample, screenUV, unpackRGBToNormal } from 'three/tsl'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'

export function createPost(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera) {
  const normalPass = pass(scene, camera, { samples: 0 })
  normalPass.name = 'Contact occlusion normals'
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

  const scenePass = pass(scene, camera, { samples: 0 })
  scenePass.name = 'Lit scene'
  scenePass.contextNode = builtinAOContext(occlusion.sample(screenUV).r)
  const display = rtt(renderOutput(scenePass), null, null, { type: UnsignedByteType, depthBuffer: false })
  const antialias = fxaa(display)
  const pipeline = new RenderPipeline(renderer, antialias)
  pipeline.outputColorTransform = false

  return {
    render() { pipeline.render() },
    dispose() {
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
