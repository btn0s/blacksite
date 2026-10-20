import type { Node } from 'three/webgpu'
import { float, mix, vec3 } from 'three/tsl'
import { geometryVertexColor } from '@blacksite/geometry'
import type { ScanGraphSurface } from './scan-material-data'
import { overlay, tint } from './scan-material-nodes'

export function metalSurface(surface: ScanGraphSurface, image: Node<'vec3'>, color: Node<'vec3'>, roughness: Node<'float'>, metalness: Node<'float'>) {
  const { scalar: s, vector: v, static_switch: switches } = surface.parameters
  {
    const luminance = color.dot(vec3(0.5))
    const modulation = switches['Invert Modulation Mask?'].select(float(1).sub(luminance), luminance).max(0).pow(s['Albedo Modulation Contrast']).mul(s['Albedo Modulation Intensity']).clamp(0, 1)
    const base = mix(overlay(image.mul(s['Albedo Modulation Brightness']), color), image, s['Albedo Metallic Modulation Intensity'])
    const pure = mix(tint(v['PBR Metal Base Color']), base, modulation)
    const variation = mix(float(1), float(s['Metallic Min']), modulation.max(0).pow(s['Metallic Modulation Contrast']).mul(s['Metallic Modulation Intensity']).clamp(0, 1))
    const source = switches['Use VC for Pure Metallic Mask?'].select(geometryVertexColor().r, float(0))
    const mask = switches['Mask Pure Metallic Base?'].select(source.max(0).pow(s['Metallic Mask - Contrast']).mul(s['Metallic Mask - Intensity']).clamp(0, 1), float(1))
    color = switches['Use Pure Metallic Base?'].select(mix(color, pure, mask), color)
    metalness = switches['Use Pure Metallic Base?'].select(mix(metalness, variation, mask), metalness)
  }
  {
    const source = image.dot(vec3(0.5))
    const mask = switches['Invert Modulation Mask?'].select(float(1).sub(source), source)
    const derived = switches['Invert Roughness Mask?'].select(float(1).sub(mask), mask).max(0).pow(s['Derived Roughness Contrast']).mul(s['Derived Roughness Intensity']).clamp(0, 1).mul(0.98)
    roughness = switches['Use Derived Roughness?'].select(mix(derived, roughness, s['Original Roughness Mix']), roughness)
  }
  return { color, roughness, metalness }
}
