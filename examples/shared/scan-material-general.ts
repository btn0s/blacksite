import { DoubleSide, Matrix3 } from 'three'
import { MeshPhysicalNodeMaterial, MeshSSSNodeMaterial, type Node } from 'three/webgpu'
import { float, max, mix, positionWorld, uniform, vec3 } from 'three/tsl'
import { tangentNormalWithUV } from '@blacksite/geometry'
import { boxUV, cheapContrast, colorTransform, luma, sCurve, saturate, type ScanSample } from './scan-material-nodes'
import type { ScanSurface } from './scan-material'
import { metalSurface } from './scan-material-metal'

export function createGeneralMaterial(surface: ScanSurface, sample: ScanSample, primaryUV: Node<'vec2'>) {
  const { scalar: s, vector: v, static_switch: switches } = surface.parameters
  for (const feature of ['Use Reconstructed Normal?']) {
    if (switches[feature]) throw new Error(`${surface.path}: unsupported surface feature ${feature}`)
  }
  if ((s['Base - Metallic Intensity'] ?? 0) !== 0) throw new Error(`${surface.path}: metallic color response is unsupported`)
  const transform = new Matrix3().setUvTransform(s['UVs - Base  Offset X'], s['UVs - Base  Offset  Y'], s['UVs - Base  Scale'], s['UVs - Base  Scale'], s['UVs - Base  Rotation'], s['UVs - Base  Pivot X'], s['UVs - Base  Pivot Y'])
  const coordinates = uniform(transform).mul(vec3(primaryUV, 1)).xy
  const read = (name: string, coordinatesNode = coordinates) => sample(name, coordinatesNode)
  const albedo = read('Albedo').rgb
  const controls = v['Base - Albedo Controls']
  const tint = vec3(...v['Base - Albedo Tint'].slice(0, 3) as [number, number, number])
  const baseColor = mix(vec3(luma(albedo)), albedo, controls[0]).max(0).pow(controls[2] + s['Base - Contrast (Offset)']).mul(controls[1]).mul(tint)
  const normalXY = read('Normal').xy.mul(2).sub(1)
  const sampledNormal = vec3(normalXY, float(1).sub(normalXY.dot(normalXY)).max(0).sqrt())
  const baseNormal = mix(vec3(0, 0, 1), sampledNormal, s['Base - Normal Intensity'])
  const finalNormal = mix(vec3(0, 0, 1), baseNormal, 1 + s['Gen - Normal Intensity (Offset)'])
  const rawRoughness = switches['Use Dedrived Roughness from Albedo?'] ? float(1).sub(luma(albedo)) : read('Packed')[surface.channels.roughness]
  const remappedRoughness = switches['Use Roughness MinMax']
    ? mix(float(s['Base - Roughness Min']), float(s['Base - Roughness Max']), rawRoughness)
    : rawRoughness.max(0).pow(s['Base - Roughness Contrast']).mul(s['Base - Roughness Mult'])
  let roughness = remappedRoughness.mul(0.98).add(0.01).add(s['Gen - Final Roughness (Offset)'])
  const specularBase = sCurve(saturate(baseColor.dot(vec3(s['Dot Base']))), s['Specular Base Contrast']).mul(s['Specular Base Intensity']).clamp(0, 1)
  const normalDx = baseNormal.dFdx()
  const normalDy = baseNormal.dFdy()
  const normalVariance = max(normalDx.dot(normalDx), normalDy.dot(normalDy))
  const specularShape = cheapContrast(specularBase, s['Contrast']).add(baseNormal.x.clamp(0, 0.75)).clamp(0, 1).sub(normalVariance.mul(s['Normal Spec occlusion Amount'])).clamp(0, 1)
  let specular = mix(float(s['Specular Min']), float(s['Specular Max']), specularShape)
  let color = colorTransform(baseColor, v['Base - HSV (Offset)'])
  if (switches['Enable Wetness']) {
    const height = positionWorld.y.mul(100)
    const shore1 = cheapContrast(height.div(s['Shore Wetness Height 01']), s['Shore Wetness Contrast 01'])
    const shore2 = cheapContrast(height.div(s['Shore Wetness Height 02']), s['Shore Wetness Contrast 02'])
    const wet1 = vec3(...v['Shore Wetness Base Color 01'].slice(0, 3) as [number, number, number])
    const wet2 = vec3(...v['Shore Wetness Base Color 02'].slice(0, 3) as [number, number, number])
    color = mix(color.mul(wet2), mix(color.mul(wet1), color, shore1), shore2)
    roughness = mix(roughness.mul(s['Shore Wetness - Roughness Overwrite']), roughness, shore1)
    specular = mix(specular.add(s['Shore Wetness - Additional Spec']), specular, shore1)
  }
  if (!switches['RGB Blend - Disable']) {
    const noiseTint = vec3(...v['RGB Noise - Tint'].slice(0, 3) as [number, number, number])
    const noise = read('RGBNoise', boxUV().mul(s['RGB Noise- Scaling'])).rgb.max(0).pow(s['RGB Noise - Contrast']).mul(s['RGB Noise - Intensity']).mul(noiseTint).clamp(0, 1)
    const blend = mix(vec3(luma(noise)), noise, s['RGB Noise - Saturation'])
    const overlay = color.greaterThan(0.5).select(vec3(1).sub(vec3(1).sub(color).mul(vec3(1).sub(blend)).mul(2)), color.mul(blend).mul(2))
    color = mix(color, switches['RGB Blend - Use Overlay?'] ? overlay : color.mul(blend), s['RGB Blend - Intenstiy'])
  }
  const material = surface.family === 'foliage'
    ? new MeshSSSNodeMaterial({ name: surface.path.split('/').at(-1), roughness: 1, metalness: 0, side: DoubleSide, alphaTest: 0.3333 })
    : new MeshPhysicalNodeMaterial({ name: surface.path.split('/').at(-1), roughness: 1, metalness: 0 })
  if (material instanceof MeshSSSNodeMaterial) {
    const packed = read('Packed')
    material.opacityNode = packed.b.max(0).pow(s['Base - Opacity Contrast']).mul(s['Base - Opacity Intensity']).clamp(0, 1)
    const transmission = mix(color, vec3(luma(color)), s['Translucency Desaturation'])
    material.thicknessColorNode = transmission.mul(packed.r).mul(s['Translucency Strength'])
    material.thicknessScaleNode = float(1)
    material.thicknessAttenuationNode = float(1)
  }
  const response = metalSurface(surface, albedo, color, roughness, float(0))
  material.colorNode = response.color
  material.normalNode = tangentNormalWithUV(vec3(finalNormal.x, finalNormal.y.negate(), finalNormal.z), coordinates)
  material.roughnessNode = response.roughness.clamp(0, 1)
  material.metalnessNode = response.metalness.clamp(0, 1)
  material.specularColorNode = vec3(specular.clamp(0, 1).mul(2))
  return material
}
