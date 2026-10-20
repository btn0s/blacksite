import { MeshPhysicalNodeMaterial, type Node } from 'three/webgpu'
import { float, mix, normalView, positionView, positionWorld, smoothstep, texture, vec2, vec3, vec4 } from 'three/tsl'
import { geometryScaleX, geometrySecondaryUV, tangentNormalWithUV } from '@blacksite/geometry'
import type { ScanSurface } from './scan-material'
import { boxUV, cheapContrast, luma, sCurve } from './scan-material-nodes'

type Sample = (name: string, coordinates?: Node<'vec2'>) => ReturnType<typeof texture>
const tint = (value: number[]) => vec3(...value.slice(0, 3) as [number, number, number])
const overlay = <T extends 'float' | 'vec3'>(base: Node<T>, blend: Node<T>) => base.greaterThan(0.5).select(float(1).sub(float(1).sub(base).mul(float(1).sub(blend)).mul(2)), base.mul(blend).mul(2))
const reconstruct = (sample: Node<'vec4'>) => {
  const xy = sample.xy.mul(2).sub(1)
  return vec3(xy, float(1).sub(xy.dot(xy)).clamp(0, 1).sqrt())
}
const flipNormal = (normal: Node<'vec3'>) => vec3(normal.x, normal.y.negate(), normal.z)
const blendNormals = (base: Node<'vec3'>, detail: Node<'vec3'>) => {
  const a = base.add(vec3(0, 0, 1))
  const b = detail.mul(vec3(-1, -1, 1))
  return a.mul(a.dot(b)).sub(b.mul(a.z)).normalize()
}

function normalBetweenUVs(normal: Node<'vec3'>, source: Node<'vec2'>, target: Node<'vec2'>) {
  const view = tangentNormalWithUV(flipNormal(normal), source)
  const n = normalView.normalize()
  const q0 = positionView.dFdx(), q1 = positionView.dFdy()
  const st0 = target.dFdx(), st1 = target.dFdy()
  const t = q1.cross(n).mul(st0.x).add(n.cross(q0).mul(st1.x)).normalize()
  const b = q1.cross(n).mul(st0.y).add(n.cross(q0).mul(st1.y)).normalize()
  return vec3(view.dot(t), view.dot(b).negate(), view.dot(n))
}

function rotate(coordinates: Node<'vec2'>, turns: number) {
  const angle = turns * Math.PI * 2
  const point = coordinates.sub(0.5)
  return vec2(point.dot(vec2(Math.cos(angle), -Math.sin(angle))), point.dot(vec2(Math.sin(angle), Math.cos(angle)))).add(0.5)
}

function heightBlend(base: Node<'vec4'>, top: Node<'vec4'>, mask: Node<'float'>) {
  const factor = mask.clamp(0, 1)
  const height = top.a.clamp(0, 1)
  const low = height.sub(1).add(factor.mul(2)).div(factor.mul(2).max(0.00001))
  const high = height.div(float(1).sub(factor).mul(2).max(0.00001))
  return mix(base, top, mix(low, high, factor).clamp(0, 1))
}

export function createPropMaterial(surface: ScanSurface, sample: Sample, coordinates: Node<'vec2'>) {
  const s = surface.parameters.scalar, v = surface.parameters.vector
  const material = new MeshPhysicalNodeMaterial({ name: surface.path.split('/').at(-1), roughness: 1, metalness: 0 })
  const albedo = sample('Albedo').rgb
  const normal = sample('Normal').rgb.mul(2).sub(1)
  if (surface.family === 'candle') {
    material.colorNode = albedo.max(0).pow(0.8).mul(vec3(1, 0.878712, 0.697917))
    material.roughnessNode = sample('Roughness').r.mul(s.Roughness).clamp(0, 1)
    material.normalNode = tangentNormalWithUV(flipNormal(normal), coordinates)
  } else {
    const packed = sample('Packed')
    material.colorNode = mix(albedo, vec3(albedo.dot(vec3(0.3, 0.59, 0.11))), s.Desat).max(0).pow(s.ColorContrast).mul(tint(v.ColorMult))
    material.roughnessNode = packed.g.max(0).pow(s.RoughnessContrast).mul(s.RoughnessAmount).clamp(0, 1)
    material.metalnessNode = packed.b.mul(s.MetallicAmount).clamp(0, 1)
    material.aoNode = packed.r
    material.specularIntensity = s.Spec * 2
    material.normalNode = tangentNormalWithUV(flipNormal(vec3(normal.xy.mul(s.NormalAmount), normal.z)), coordinates)
  }
  return material
}

export function createSmartMaterial(surface: ScanSurface, sample: Sample, primaryUV: Node<'vec2'>) {
  const { scalar: s, vector: v, static_switch: switches } = surface.parameters
  for (const feature of ['Enable', 'Surface Overlay', 'Enable Tessellation']) if (switches[feature]) throw new Error(`${surface.path}: unsupported smart surface feature ${feature}`)
  const secondaryUV = geometrySecondaryUV()
  const scale = geometryScaleX().clamp(0.5, 10)
  const coordinates = rotate(secondaryUV.mul(scale).mul(5), s['Detail Texture Rotation'])
  const mask = sample('Unique_Mask', primaryUV).toVar()
  const layers = [0, 1, 2, 3, 4].filter(index => index === 0 || switches[`${index} - Detail Textures`]).map(index => {
    const tiling = s[index === 0 ? '0 - Detail Texture Tiling' : `${index} - Detail Textures - Tiling`]
    const image = sample(`${index} - Detail Texture`, coordinates.mul(tiling)).toVar()
    if (!switches[`${index}.1 - Displacement Control`]) return { index, image }
    return { index, image: vec4(image.rgb, image.a.sub(0.5).mul(s[`${index}.1 - Displacement Power`]).add(0.5)) }
  })
  let detail = layers[0]!.image as Node<'vec4'>
  for (const layer of layers.slice(1)) detail = heightBlend(detail, layer.image, [mask.b, mask.g, mask.r, mask.a][layer.index - 1]!)
  detail = detail.toVar()
  const rawDetail = reconstruct(detail)
  const detailNormal = vec3(rawDetail.xy.mul(s['Normal Strength']), rawDetail.z)
  const largeUV = rotate(secondaryUV, s['Large Scale Rock Rotation']).mul(s['Large Scale Rock Tiling']).mul(scale)
  const layerMask = (index: number) => {
    let value = float(0)
    for (const [name, channel] of [['Red', mask.r], ['Green', mask.g], ['Blue', mask.b]] as const) if (switches[`${index} - Large Scale Rock - ${name}`]) value = value.add(channel)
    if (switches[`${index} - Large Scale Rock - Base`]) value = value.add(float(1).sub(mask.r.add(mask.g).add(mask.b)))
    return value.clamp(0, 1)
  }
  let large = vec4(0.5)
  if (switches['1 - Large Scale Rock']) large = mix(large, sample('Large Scale Rock Texture Sample 01', largeUV.mul(0.6)), layerMask(1))
  if (switches['2 - Large Scale Rock']) large = mix(large, sample('Large Scale Rock Texture Sample 02', largeUV.mul(0.35)), layerMask(2))
  const largeNormal = normalBetweenUVs(reconstruct(large), secondaryUV, primaryUV)
  const combinedDetail = blendNormals(detailNormal, largeNormal)
  let albedoUV = primaryUV
  if (switches.Albedo_Distortion && switches['Detail Distortion']) {
    const distortion = cheapContrast(vec2(combinedDetail.x, combinedDetail.z).mul(0.002 * 20467348), -0.495)
    albedoUV = primaryUV.add(distortion.mul(-0.00025).add(float(1).sub(distortion).mul(0.5)))
  }
  let uniqueColor = sample('Unique_BaseColor', albedoUV).rgb
  if (switches['01 - Albedo Controls']) uniqueColor = mix(vec3(uniqueColor.dot(vec3(0.3, 0.59, 0.11))), uniqueColor, s['Albedo Saturation']).mul(s['Albedo Brightness']).mul(tint(v['Albedo Tint'])).max(0).pow(s['Albedo Contrast'])
  const detailColor = overlay(detail.b, large.b)
  let color = uniqueColor.mul(detailColor).mul(2).clamp(0, 1)
  const uniquePacked = sample('Unique_Normal', primaryUV)
  const uniqueNormal = reconstruct(uniquePacked)
  const baseNormal = switches['Large Scale Rock Global Toggle'] ? blendNormals(uniqueNormal, largeNormal) : uniqueNormal
  const normal = blendNormals(baseNormal, normalBetweenUVs(detailNormal, secondaryUV, primaryUV))
  const roughnessBlend = mix(float(s['Roughness Low']), float(s['Roughness High']), cheapContrast(detailColor, s['Roughness Contrast']))
  let rawRoughness = overlay(mix(float(0.5), detail.a, 0.75), roughnessBlend)
  if (switches['Invert Roughness']) rawRoughness = float(1).sub(rawRoughness)
  let roughness = mix(float(s['Final Roughness Min']), float(s['Final Roughness Max']), rawRoughness)
  const specularBase = sCurve(color.dot(vec3(s['Dot Base'])).clamp(0, 1), s['Specular Base Contrast']).mul(s['Specular Base Intensity']).clamp(0, 1)
  const dx = normal.dFdx(), dy = normal.dFdy()
  const variance = dx.dot(dx).max(dy.dot(dy))
  const shape = cheapContrast(specularBase, s.Contrast).add(normal.x.clamp(0, 0.75)).clamp(0, 1).sub(variance.mul(s['Normal Spec occlusion Amount'])).clamp(0, 1)
  let specular = mix(overlay(float(1).sub(uniquePacked.b), float(0.75)), mix(float(s['Specular Min']), float(s['Specular Max']), shape), 0.8)
  if (switches['Enable Wetness']) {
    const height = positionWorld.y.mul(100)
    const shore1 = cheapContrast(height.div(s['Shore Wetness Height 01']), s['Shore Wetness Contrast 01'])
    const shore2 = cheapContrast(height.div(s['Shore Wetness Height 02']), s['Shore Wetness Contrast 02'])
    color = mix(color.mul(tint(v['Shore Wetness Base Color 02'])), mix(color.mul(tint(v['Shore Wetness Base Color 01'])), color, shore1), shore2)
    roughness = mix(roughness.mul(s['Shore Wetness - Roughness Overwrite']), roughness, shore1)
    specular = mix(specular.add(s['Shore Wetness - Additional Spec']), specular, shore1)
  }
  if (!switches['RGB Blend - Disable']) {
    const noise = sample('RGBNoise', boxUV().mul(s['RGB Noise- Scaling'])).rgb.max(0).pow(s['RGB Noise - Contrast']).mul(s['RGB Noise - Intensity']).mul(tint(v['RGB Noise - Tint'])).clamp(0, 1)
    const blend = mix(vec3(luma(noise)), noise, s['RGB Noise - Saturation'])
    color = mix(color, switches['RGB Blend - Use Overlay?'] ? overlay(color, blend) : color.mul(blend), s['RGB Blend - Intenstiy'])
  }
  const material = new MeshPhysicalNodeMaterial({ name: surface.path.split('/').at(-1), roughness: 1, metalness: 0 })
  material.colorNode = color
  material.normalNode = tangentNormalWithUV(flipNormal(normal), primaryUV)
  material.roughnessNode = roughness.clamp(0, 1)
  material.aoNode = smoothstep(-0.2, 0.5, detail.a)
  material.specularColorNode = vec3(specular.clamp(0, 1).mul(2))
  return material
}
