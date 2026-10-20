import { DoubleSide } from 'three'
import { MeshPhysicalNodeMaterial, type Node } from 'three/webgpu'
import { Fn, float, mix, positionView, vec2, vec3 } from 'three/tsl'
import { tangentNormalWithUV } from '@blacksite/geometry'
import type { ScanGraphSurface } from './scan-material-data'
import { luma, rotateUV, scanNormal, sCurve, specularResponse, tint, type ScanSample } from './scan-material-nodes'
import { createVertexBlendMaterial } from './scan-material-blend'
import { metalSurface } from './scan-material-metal'

export function createSurfaceMaterial(surface: ScanGraphSurface, sample: ScanSample, uv: Node<'vec2'>) {
  if (surface.family === 'vertex-blend') return createVertexBlendMaterial(surface, sample, uv)
  const { scalar: s, vector: v, static_switch: switches } = surface.parameters
  const material = new MeshPhysicalNodeMaterial({ name: surface.family, roughness: 1, metalness: 0 })
  if (surface.family === 'solid') {
    material.colorNode = tint(v.Color)
    material.roughnessNode = s.Roughness
  } else if (surface.family === 'emissive') {
    material.colorNode = vec3(0)
    material.emissiveNode = Fn(builder => tint(v.Color).mul(s.Int).mul(builder.context.radianceScale ?? 1))()
  } else if (surface.family === 'steel') {
    const image = sample('Albedo', uv)
    const normal = scanNormal(sample('Normal', uv))
    const macro = sample('Macro', uv.mul(0.2134)).r.add(0.5).mul(sample('Macro', uv.mul(0.05341)).r.add(0.5)).mul(sample('Macro', uv.mul(0.002)).r.add(0.5))
    material.colorNode = mix(vec3(0.5), vec3(1), macro).mul(image.rgb).mul(s.ColourMult)
    material.roughnessNode = mix(float(s.RoughnessLerpA), float(s.RoughnessLerpB), macro.mul(image.a)).clamp(0, 1)
    material.metalness = 1
    material.normalNode = tangentNormalWithUV(normal, uv)
  } else if (surface.family === 'world-grid') {
    const grid = sample('Grid', uv)
    const detail = sample('Grid', uv.mul(10))
    const noise = sample('Grid', uv.mul(20)).r
    const fade = positionView.z.negate().div(15).clamp(0, 1)
    const brightness = mix(float(0.295), float(0.66), mix(grid.g.add(mix(detail.g, float(0), fade)), float(0.5), 0.5)).mul(0.5)
    const variation = mix(float(0.4), float(1), noise)
    material.colorNode = vec3(mix(variation, float(1).sub(variation), mix(detail.g, float(0), fade))).mul(brightness)
    material.roughnessNode = grid.g.mul(0.5).add(mix(mix(float(0.7), float(1), detail.g), float(1), fade)).clamp(0, 1)
    const normal = scanNormal(sample('Normal', uv.mul(20)))
    material.normalNode = tangentNormalWithUV(vec3(normal.xy.mul(0.3), normal.z), uv.mul(20))
  } else if (surface.family === 'cutout') {
    const coordinates = rotateUV(uv.mul(vec2(s.TilingX, s.TilingY)), s.RotationAngle.mul(0.025), vec2(0.5, -0.05))
    const image = sample('Albedo', coordinates).rgb
    const controls = v['Albedo Control']
    const color = mix(vec3(luma(image)), image, controls.x).mul(controls.y).mul(tint(v['Albedo Tint'])).max(0).pow(controls.z)
    const roughness = switches['Use Unique Roughness'].select(sample('Roughness', coordinates).r, float(1).sub(luma(image)))
    material.colorNode = color
    material.roughnessNode = mix(float(s['Roughness Min']), float(s['Roughness Max']), roughness).max(0).pow(s['Roughness Contrast']).clamp(0, 1)
    material.normalNode = tangentNormalWithUV(scanNormal(sample('Normal', coordinates), s['Normal Strength']), coordinates)
    material.specularColorNode = vec3(mix(float(s['Specular Min']), float(s['Specular Max']), sCurve(luma(image), s.SpecularContrast).mul(s['Specular BaseVal'])).clamp(0, 1).mul(2))
    material.opacityNode = sample('Opacity', coordinates).r.mul(s['Opacity Intensity']).clamp(0, 1)
    material.alphaTest = 0.3333
    material.side = DoubleSide
  } else if (surface.family === 'generic-props') {
    const coordinates = uv.mul(vec2(s.U_Tiling, s.V_Tiling))
    const image = sample('Albedo', coordinates).rgb
    const normal = scanNormal(sample('Normal', coordinates), s.NormalAmount)
    const packed = sample('Packed', coordinates)
    const color = mix(image, vec3(luma(image)), s.Desat).max(0).pow(s.ColourContrast).mul(tint(v.ColourTint))
    const roughness = packed.g.max(0).pow(s.RoughnessContrast).mul(s.RoughnessAmount)
    const metalness = switches['Use Standalone Metalness'].select(sample('Metalness', coordinates).r, packed.b)
    const response = metalSurface(surface, image, color, roughness, metalness)
    material.colorNode = response.color
    material.roughnessNode = response.roughness.clamp(0, 1)
    material.metalnessNode = response.metalness.clamp(0, 1)
    material.normalNode = tangentNormalWithUV(normal, coordinates)
    material.specularColorNode = vec3(specularResponse(image, normal, s))
  } else {
    throw new Error(`Unsupported scan surface family: ${surface.family}`)
  }
  return material
}
