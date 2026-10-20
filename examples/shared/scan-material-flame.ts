import { DoubleSide } from 'three'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import { float, fract, instanceIndex, mix, sin, time, vec2, vec4 } from 'three/tsl'
import type { ScanGraphSurface } from './scan-material-data'
import type { ScanSample } from './scan-material-nodes'

export function createFlameMaterial(surface: ScanGraphSurface, sample: ScanSample, uv: Node<'vec2'>) {
  const { scalar: s, vector: v } = surface.parameters
  const random = fract(sin(float(instanceIndex).mul(12.9898).add(78.233)).mul(43758.5453))
  const coordinates = uv.sub(vec2(s['U Offset'], s['V Offset'])).mul(vec2(s['UV Scale X'], s['UV Scale Y']))
  const flow = vec2(s['FlowSpeed X'], s['FlowSpeed Y'])
  const speed = mix(flow, flow.mul(mix(float(s.FlowMin), float(s.FlowMax), random)), s['Random Flow'])
  const wave = uv.add(random.mul(333)).mul(s.Param).mul(vec2(s.WaveScaleX, s.WaveScaleY)).add(speed.mul(time))
  const noise = sample('Distortion', wave).rgb.clamp(0, 1)
  const gradient = float(1).sub(uv.y.mul(s.Param)).add(s.BottomOffset).clamp(0, 1)
  const distortion = gradient.mul(noise).clamp(0, 1).mul(s['Distortion Strength']).xy
  const flame = sample('Flame', mix(coordinates, distortion, s.DistortionOpacity).clamp(0, 1))
  const control = v['Albedo + Alpha Control']
  const enabled = float(s['ON / OFF']).clamp(0, 1)
  const material = new MeshBasicNodeMaterial({ name: surface.family, alphaHash: true, side: DoubleSide, fog: false })
  material.colorNode = vec4(control.rgb.mul(flame.rgb).mul(s.EmissiveStrength).mul(enabled), 1)
  material.opacityNode = control.a.mul(flame.a).mul(enabled).clamp(0, 1)
  return material
}
