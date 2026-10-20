import type { Node } from 'three/webgpu'
import { float, mix, vec3 } from 'three/tsl'
import { geometryVertexColor } from '@blacksite/geometry'
import type { ScanSurface } from './scan-material'
import { overlay, tint } from './scan-material-nodes'

export function metalSurface(surface: ScanSurface, image: Node<'vec3'>, color: Node<'vec3'>, roughness: Node<'float'>, metalness: Node<'float'>) {
  const { scalar: s, vector: v, static_switch: switches } = surface.parameters
  if (switches['Use Pure Metallic Base?']) {
    const luminance = color.dot(vec3(0.5))
    const modulation = (switches['Invert Modulation Mask?'] ? float(1).sub(luminance) : luminance).max(0).pow(s['Albedo Modulation Contrast']).mul(s['Albedo Modulation Intensity']).clamp(0, 1)
    const base = mix(overlay(image.mul(s['Albedo Modulation Brightness']), color), image, s['Albedo Metallic Modulation Intensity'])
    const pure = mix(tint(v['PBR Metal Base Color']), base, modulation)
    const variation = mix(float(1), float(s['Metallic Min']), modulation.max(0).pow(s['Metallic Modulation Contrast']).mul(s['Metallic Modulation Intensity']).clamp(0, 1))
    if (switches['Mask Pure Metallic Base?']) {
      const source = switches['Use VC for Pure Metallic Mask?'] ? geometryVertexColor().r : float(0)
      const mask = source.max(0).pow(s['Metallic Mask - Contrast']).mul(s['Metallic Mask - Intensity']).clamp(0, 1)
      color = mix(color, pure, mask)
      metalness = mix(metalness, variation, mask)
    } else {
      color = pure
      metalness = variation
    }
  }
  if (switches['Use Derived Roughness?']) {
    const source = image.dot(vec3(0.5))
    const mask = switches['Invert Modulation Mask?'] ? float(1).sub(source) : source
    const derived = (switches['Invert Roughness Mask?'] ? float(1).sub(mask) : mask).max(0).pow(s['Derived Roughness Contrast']).mul(s['Derived Roughness Intensity']).clamp(0, 1).mul(0.98)
    roughness = mix(derived, roughness, s['Original Roughness Mix'])
  }
  return { color, roughness, metalness }
}
