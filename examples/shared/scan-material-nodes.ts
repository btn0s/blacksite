import type { Node } from 'three/webgpu'
import type { ScanGraphSurface } from './scan-material-data'
import { float, frameId, max, mix, normalWorldGeometry, positionWorld, screenCoordinate, varying, vec2, vec3 } from 'three/tsl'

export type ScanSample = (name: string, coordinates?: Node<'vec2'>) => Node<'vec4'>
export const tint = (value: Node<'vec4'>) => value.rgb
export const overlay = <T extends 'float' | 'vec3'>(base: Node<T>, blend: Node<T>) => base.greaterThan(0.5).select(float(1).sub(float(1).sub(base).mul(float(1).sub(blend)).mul(2)), base.mul(blend).mul(2))
export const scanNormal = (sample: Node<'vec4'>, strength: number | Node<'float'> = 1) => {
  const xy = sample.xy.mul(2).sub(1)
  return vec3(xy.mul(vec2(strength, float(strength).negate())), float(1).sub(xy.dot(xy)).max(0).sqrt())
}

export function rotateUV(coordinates: Node<'vec2'>, turns: Node<'float'>, pivot: Node<'vec2'> = vec2(0.5)) {
  const angle = turns.mul(Math.PI * 2)
  const point = coordinates.sub(pivot)
  return vec2(point.dot(vec2(angle.cos(), angle.sin().negate())), point.dot(vec2(angle.sin(), angle.cos()))).add(pivot)
}

export function specularResponse(color: Node<'vec3'>, normal: Node<'vec3'>, s: ScanGraphSurface['parameters']['scalar']) {
  const base = sCurve(color.dot(vec3(s['Dot Base'])).clamp(0, 1), s['Specular Base Contrast']).mul(s['Specular Base Intensity']).clamp(0, 1)
  const dx = normal.dFdx(), dy = normal.dFdy()
  const variance = max(dx.dot(dx), dy.dot(dy))
  const shape = cheapContrast(base, s.Contrast).add(normal.x.clamp(0, 0.75)).clamp(0, 1).sub(variance.mul(s['Normal Spec occlusion Amount'])).clamp(0, 1)
  return mix(float(s['Specular Min']), float(s['Specular Max']), shape).clamp(0, 1).mul(2)
}

export const luma = (value: Node<'vec3'>) => value.dot(vec3(0.212639, 0.715169, 0.072192))
export const saturate = (value: Node<'float'>) => value.clamp(0, 1)
export const cheapContrast = <T extends 'float' | 'vec2'>(value: Node<T>, contrast: number | Node<'float'>) => value.mul(float(contrast).mul(2).add(1)).sub(contrast).clamp(0, 1)

export function sCurve(value: Node<'float'>, power: Node<'float'>) {
  const high = float(1).sub(float(1).sub(value.sub(0.5).mul(2).clamp(0, 1)).pow(power))
  return mix(value.mul(2).clamp(0, 1).pow(power).mul(0.5), high.mul(0.5).add(0.5), high.mul(500).clamp(0, 1))
}

export function colorTransform(color: Node<'vec3'>, offset: Node<'vec4'>) {
  const h = offset.x.add(1).mul(Math.PI * 2)
  const v = offset.z.add(1)
  const a = v.mul(offset.y.add(1)).mul(h.cos())
  const b = v.mul(offset.y.add(1)).mul(h.sin())
  return vec3(
    color.dot(vec3(v.mul(0.299).add(a.mul(0.701)).add(b.mul(0.168)), v.mul(0.587).sub(a.mul(0.587)).add(b.mul(0.330)), v.mul(0.114).sub(a.mul(0.114)).sub(b.mul(0.497)))),
    color.dot(vec3(v.mul(0.299).sub(a.mul(0.299)).sub(b.mul(0.328)), v.mul(0.587).add(a.mul(0.413)).add(b.mul(0.035)), v.mul(0.114).sub(a.mul(0.114)).add(b.mul(0.292)))),
    color.dot(vec3(v.mul(0.299).sub(a.mul(0.300)).add(b.mul(1.25)), v.mul(0.587).sub(a.mul(0.588)).sub(b.mul(1.05)), v.mul(0.114).add(a.mul(0.886)).sub(b.mul(0.203)))),
  )
}

export function boxUV() {
  const normal = normalWorldGeometry.xzy
  const squared = normal.mul(normal)
  const powers = squared.mul(squared)
  const weights = varying(powers.div(powers.x.add(powers.y).add(powers.z)).add(vec3(0, 0.000001, 0.000001))).clamp(0, 1)
  const pixel = screenCoordinate.floor().add(float(frameId.mod(64)).mul(5.588238))
  const dither = pixel.dot(vec2(0.06711056, 0.00583715)).fract().mul(52.9829189).fract().sub(0.5).mul(0.25)
  const point = positionWorld.xzy.mul(100 / 128)
  const signs = normal.sign()
  const x = vec2(point.y.negate().mul(signs.x), point.z.negate())
  const y = vec2(point.x.mul(signs.y), point.z.negate())
  const z = vec2(point.x.mul(signs.z), point.y)
  const side = max(weights.x.sub(dither), weights.z.sub(dither)).greaterThan(weights.y).select(x, y)
  return weights.z.sub(dither).greaterThan(max(weights.x, weights.y)).select(z, side)
}

