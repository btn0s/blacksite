import { LoadingManager, Matrix3, NoColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'
import { MeshPhysicalNodeMaterial, type Node, type WebGPURenderer } from 'three/webgpu'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import transcoderScript from 'three/examples/jsm/libs/basis/basis_transcoder.js?url'
import transcoderWasm from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url'
import { Fn, float, frameId, max, mix, normalWorldGeometry, positionWorld, screenCoordinate, texture, uniform, uv, varying, vec2, vec3 } from 'three/tsl'
import { tangentNormalWithUV } from '@blacksite/geometry'

type Channel = 'r' | 'g' | 'b' | 'a'
type Parameters = { scalar: Record<string, number>; vector: Record<string, number[]>; static_switch: Record<string, boolean> }
export type ScanSurface = {
  family: 'custom-general'
  path: string
  parameters: Parameters
  channels: { roughness: Channel; metalness: Channel }
  maps: Record<'Albedo' | 'Normal' | 'Packed' | 'Metalness' | 'RGBNoise', { file: string; srgb: boolean }>
}

const luma = (value: Node<'vec3'>) => value.dot(vec3(0.212639, 0.715169, 0.072192))
const saturate = (value: Node<'float'>) => value.clamp(0, 1)
const cheapContrast = (value: Node<'float'>, contrast: number) => saturate(value.mul(1 + 2 * contrast).sub(contrast))
const loaders = new WeakMap<WebGPURenderer, { loader: KTX2Loader; images: Map<string, Promise<Texture>>; resident: Map<Texture, number> }>()

export function residentScanTextures(renderer: WebGPURenderer) {
  return [...(loaders.get(renderer)?.resident ?? [])].map(([texture, reportedBytes]) => ({ texture, reportedBytes }))
}

function sCurve(value: Node<'float'>, power: number) {
  const high = float(1).sub(float(1).sub(value.sub(0.5).mul(2).clamp(0, 1)).pow(power))
  return mix(value.mul(2).clamp(0, 1).pow(power).mul(0.5), high.mul(0.5).add(0.5), high.mul(500).clamp(0, 1))
}

function colorTransform(color: Node<'vec3'>, offset: number[]) {
  const h = (offset[0] + 1) * Math.PI * 2
  const v = offset[2] + 1
  const a = v * (offset[1] + 1) * Math.cos(h)
  const b = v * (offset[1] + 1) * Math.sin(h)
  return vec3(
    color.dot(vec3(0.299 * v + 0.701 * a + 0.168 * b, 0.587 * v - 0.587 * a + 0.330 * b, 0.114 * v - 0.114 * a - 0.497 * b)),
    color.dot(vec3(0.299 * v - 0.299 * a - 0.328 * b, 0.587 * v + 0.413 * a + 0.035 * b, 0.114 * v - 0.114 * a + 0.292 * b)),
    color.dot(vec3(0.299 * v - 0.300 * a + 1.25 * b, 0.587 * v - 0.588 * a - 1.05 * b, 0.114 * v + 0.886 * a - 0.203 * b)),
  )
}

function boxUV() {
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

export async function loadScanMaterial(surface: ScanSurface, root: string, renderer: WebGPURenderer) {
  if (surface.family !== 'custom-general') throw new Error(`Unsupported surface family: ${surface.family}`)
  const { scalar: s, vector: v, static_switch: switches } = surface.parameters
  for (const feature of ['Use Pure Metallic Base?', 'Switch - Use UV Random Offset?', 'Use Reconstructed Normal?']) {
    if (switches[feature]) throw new Error(`${surface.path}: unsupported surface feature ${feature}`)
  }
  if (s['Base - Metallic Intensity'] !== 0) throw new Error(`${surface.path}: metallic color response is unsupported`)
  if (!loaders.has(renderer)) {
    const manager = new LoadingManager()
    manager.setURLModifier(url => url.endsWith('basis_transcoder.js') ? transcoderScript : url.endsWith('basis_transcoder.wasm') ? transcoderWasm : url)
    loaders.set(renderer, { loader: new KTX2Loader(manager).setTranscoderPath('/').detectSupport(renderer), images: new Map(), resident: new Map() })
  }
  const { loader, images, resident } = loaders.get(renderer)!
  const used = Object.entries(surface.maps).filter(([name]) => name !== 'Metalness' && (name !== 'Packed' || !switches['Use Dedrived Roughness from Albedo?']) && (name !== 'RGBNoise' || !switches['RGB Blend - Disable']))
  const entries = await Promise.all(used.map(async ([name, source]) => {
    const url = root + source.file
    if (!images.has(url)) images.set(url, loader.loadAsync(url))
    const map = await images.get(url)!
    map.flipY = false
    map.wrapS = map.wrapT = RepeatWrapping
    map.anisotropy = 8
    map.colorSpace = source.srgb ? SRGBColorSpace : NoColorSpace
    if (!resident.has(map)) {
      const before = renderer.info.memory.texturesSize
      renderer.initTexture(map)
      resident.set(map, renderer.info.memory.texturesSize - before)
    }
    return [name, map] as const
  }))
  const maps = Object.fromEntries(entries) as Record<keyof ScanSurface['maps'], Texture>
  const primaryUV = Fn(builder => builder.context.getUV?.() ?? uv())()
  const transform = new Matrix3().setUvTransform(s['UVs - Base  Offset X'], s['UVs - Base  Offset  Y'], s['UVs - Base  Scale'], s['UVs - Base  Scale'], s['UVs - Base  Rotation'], s['UVs - Base  Pivot X'], s['UVs - Base  Pivot Y'])
  const coordinates = uniform(transform).mul(vec3(primaryUV, 1)).xy
  const sample = (map: Texture) => texture(map, coordinates).setUpdateMatrix(false)
  const albedo = sample(maps.Albedo).rgb
  const controls = v['Base - Albedo Controls']
  const tint = vec3(...v['Base - Albedo Tint'].slice(0, 3) as [number, number, number])
  const baseColor = mix(vec3(luma(albedo)), albedo, controls[0]).max(0).pow(controls[2] + s['Base - Contrast (Offset)']).mul(controls[1]).mul(tint)
  const normalXY = sample(maps.Normal).xy.mul(2).sub(1)
  const sampledNormal = vec3(normalXY, float(1).sub(normalXY.dot(normalXY)).max(0).sqrt())
  const baseNormal = mix(vec3(0, 0, 1), sampledNormal, s['Base - Normal Intensity'])
  const finalNormal = mix(vec3(0, 0, 1), baseNormal, 1 + s['Gen - Normal Intensity (Offset)'])
  const rawRoughness = switches['Use Dedrived Roughness from Albedo?'] ? float(1).sub(luma(albedo)) : sample(maps.Packed)[surface.channels.roughness]
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
    const noise = texture(maps.RGBNoise, boxUV().mul(s['RGB Noise- Scaling'])).rgb.max(0).pow(s['RGB Noise - Contrast']).mul(s['RGB Noise - Intensity']).mul(noiseTint).clamp(0, 1)
    const blend = mix(vec3(luma(noise)), noise, s['RGB Noise - Saturation'])
    const overlay = color.greaterThan(0.5).select(vec3(1).sub(vec3(1).sub(color).mul(vec3(1).sub(blend)).mul(2)), color.mul(blend).mul(2))
    color = mix(color, switches['RGB Blend - Use Overlay?'] ? overlay : color.mul(blend), s['RGB Blend - Intenstiy'])
  }
  const material = new MeshPhysicalNodeMaterial({ name: surface.path.split('/').at(-1), map: maps.Albedo, normalMap: maps.Normal, roughness: 1, metalness: 0 })
  material.colorNode = color
  material.normalNode = tangentNormalWithUV(vec3(finalNormal.x, finalNormal.y.negate(), finalNormal.z), coordinates)
  material.roughnessNode = roughness.clamp(0, 1)
  material.specularColorNode = vec3(specular.clamp(0, 1).mul(2))
  return material
}
