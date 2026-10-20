import { MeshPhysicalNodeMaterial, type Node } from 'three/webgpu'
import { float, mix, positionWorld, time, vec2, vec3 } from 'three/tsl'
import { geometryVertexColor, tangentNormalWithUV } from '@blacksite/geometry'
import type { ScanGraphSurface } from './scan-material-data'
import { cheapContrast, luma, rotateUV, scanNormal, tint, type ScanSample } from './scan-material-nodes'

function heightLerp(first: Node<'float'>, second: Node<'float'>, phase: Node<'float'>, contrast: Node<'float'>) {
  const alpha = first.add(1).sub(phase).add(1).sub(phase.mul(2).add(second)).clamp(0, 1)
  const weight = cheapContrast(alpha, contrast.abs())
  return { weight, height: mix(second, first, weight) }
}

export function createVertexBlendMaterial(surface: ScanGraphSurface, sample: ScanSample, uv: Node<'vec2'>) {
  const { scalar: s, vector: v, static_switch: switches } = surface.parameters
  const world = positionWorld.xz
  const layerUV = (index: number) => {
    const scale = s[`Layer ${index} - Tiling`]
    return switches['Use World Alignment'].select(world.div(scale), rotateUV(uv.mul(scale), s[`Layer ${index} - Rotation Angle`], v[`Layer ${index} - Rotation Center`].xy))
  }
  const layers = [1, 2, 3].map(index => {
    const name = `Layer 0${index}`
    const coordinates = layerUV(index)
    const image = sample(`${name} | Albedo`, coordinates).rgb
    const packed = sample(`${name} | DR`, coordinates)
    const adjusted = mix(vec3(luma(image)), image, s[`${name} | Saturation`]).mul(s[`${name} | Brightness`]).mul(tint(v[`${name} | Albedo Tint`])).max(0).pow(s[`${name} | Contrast`])
    const normal = tangentNormalWithUV(scanNormal(sample(`${name} | Normal`, coordinates), switches['Use Adjusted Maps'].select(s[`${name} | Normal Strength`], float(1))), coordinates)
    return {
      color: switches['Use Adjusted Maps'].select(adjusted, image),
      roughness: switches['Use Adjusted Maps'].select(mix(float(s[`${name} | Min Roughness`]), float(s[`${name} | Max Roughness`]), packed.r), packed.r),
      height: packed.b,
      normal,
    }
  })
  const [a, b, c] = layers as [typeof layers[number], typeof layers[number], typeof layers[number]]
  const paint = geometryVertexColor()
  const blend1 = heightLerp(b.height.mul(s['Mat 2 Height']).max(0).pow(s['Mat 2 Height Contrast']), a.height.mul(s['Mat 1 Height']), paint.r.div(s['Mat 1 Border Blend Amount']), s['Height Control - Mat 2'])
  const blend2 = heightLerp(c.height.mul(s['Mat 3 Height']).max(0).pow(s['Mat 3 Height Contrast']), blend1.height, paint.g.div(s['Mat 2 Border Blend Amount']), s['Height Control - Mat 3'])
  const puddle = heightLerp(c.height.mul(s['Mat 4 Height']), blend2.height, paint.b.div(s['Mat 3 Border Blend Amount']), s['Height Control - Mat 4']).weight
  const blend = <T extends 'float' | 'vec3'>(x: Node<T>, y: Node<T>, z: Node<T>) => mix(mix(x, y, blend1.weight), z, blend2.weight)
  const color = blend(a.color, b.color, c.color)
  const roughness = blend(a.roughness, b.roughness, c.roughness)
  const normal = blend(a.normal, b.normal, c.normal).normalize()
  const puddleUV = switches['Use World Alignment'].select(world.div(s['Puddle - Tiling']), uv.mul(s['Puddle - Tiling'])).add(time.mul(vec2(s['Speed X'], s['Speed Y'])))
  const puddleNormal = tangentNormalWithUV(scanNormal(sample('PuddleNormal', puddleUV), s['Normal Strength']), puddleUV)
  const material = new MeshPhysicalNodeMaterial({ name: surface.family, roughness: 1, metalness: 0 })
  material.colorNode = mix(color, color.mul(tint(v['Puddle Layer | Albedo Tint'])), puddle)
  material.roughnessNode = mix(roughness, float(s['Puddle Layer | Roughness']), puddle).clamp(0, 1)
  material.normalNode = mix(normal, puddleNormal, puddle).normalize()
  material.specularIntensityNode = s['Base Specular'].mul(2)
  return material
}
