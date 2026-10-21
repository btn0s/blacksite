import type { Node } from 'three/webgpu'
import { dot, float, max, mix, smoothstep, vec3, vec4 } from 'three/tsl'
import { element, landscapeNoise } from './nodes'
import type { TerrainLayerSpec } from './terrain'

type Averages = readonly (readonly [number, number, number])[]

export function groundLayers(averages: Averages, specs: readonly TerrainLayerSpec[], xz: Node<'vec2'>, surface: Node<'vec4'>, base: Node<'vec3'>) {
  const variation = landscapeNoise(xz.mul(0.045), 21)
  const macro = landscapeNoise(xz.mul(0.011), 23).mul(0.6).add(landscapeNoise(xz.mul(0.06), 29).mul(0.4))
  const slope = float(1).sub(base.y)
  const forest = surface.b.clamp(0, 1)
  const path = smoothstep(0.25, 0.65, surface.a.add(variation.sub(0.5).mul(0.2)))
  const rock = smoothstep(0.24, 0.42, slope.add(macro.sub(0.5).mul(0.12))).mul(float(1).sub(smoothstep(0.3, 0.6, surface.b).mul(0.85)))
  const rawWeights = vec4(float(1).sub(forest).mul(float(1).sub(path)).mul(float(1).sub(rock)), forest.mul(float(1).sub(path)).mul(float(1).sub(rock)), path.mul(float(1).sub(rock)), rock)
  const weights = rawWeights.div(max(dot(rawWeights, vec4(1)), 1e-4))
  const average = vec3(0).toVar()
  const roughness = float(0).toVar()
  for (let layer = 0; layer < 4; layer++) {
    const spec = specs[layer]!
    average.addAssign(vec3(...averages[layer]!).mul(vec3(...spec.tint)).mul(element<'float'>(weights, layer)))
    roughness.addAssign(element<'float'>(weights, layer).mul(spec.roughness))
  }
  return { weights, macro, average, roughness }
}

export function groundTone(albedo: Node<'vec3'>, xz: Node<'vec2'>, macro: Node<'float'>, weights: Node<'vec4'>) {
  const tone = albedo.mul(macro.mul(0.36).add(0.82))
  const dry = smoothstep(0.45, 0.85, landscapeNoise(xz.mul(0.018), 31).mul(0.7).add(landscapeNoise(xz.mul(0.09), 37).mul(0.3)))
  return mix(tone, tone.mul(vec3(1.3, 1.04, 0.6)), dry.mul(weights.x).mul(0.7))
}
