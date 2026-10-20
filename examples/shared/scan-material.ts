import { LoadingManager, Matrix3 } from 'three'
import { MeshPhysicalNodeMaterial, type MeshStandardNodeMaterial, type Node, type WebGPURenderer } from 'three/webgpu'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import transcoderScript from 'three/examples/jsm/libs/basis/basis_transcoder.js?url'
import transcoderWasm from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url'
import { Fn, float, max, mix, positionWorld, texture, uniform, uv, vec3 } from 'three/tsl'
import { tangentNormalWithUV, type TextureDemandBinding } from '@blacksite/geometry'
import { boxUV, cheapContrast, colorTransform, luma, sCurve, saturate } from './scan-material-nodes'
import { createSmartMaterial, createPropMaterial } from './scan-surface-materials'
import { ScanTextureStreaming, type ScanImageSource, type ScanTexture } from './scan-texture-streaming'

type Channel = 'r' | 'g' | 'b' | 'a'
type Parameters = { scalar: Record<string, number>; vector: Record<string, number[]>; static_switch: Record<string, boolean> }
export type ScanSurface = {
  family: 'custom-general' | 'smart-layers' | 'simple-orm' | 'candle'
  path: string
  parameters: Parameters
  channels: { roughness: Channel; metalness: Channel }
  maps: Record<string, ScanImageSource>
}

const materialSets = new WeakMap<WebGPURenderer, ScanTextureStreaming>()
export function createScanMaterialStreaming(renderer: WebGPURenderer) {
  const streaming = materialSets.get(renderer)
  if (!streaming) throw new Error('Load scan materials before using texture residency')
  return streaming
}
export const residentScanTextures = (renderer: WebGPURenderer) => materialSets.get(renderer)?.resident ?? []
export const scanTextureFeedback = (renderer: WebGPURenderer) => createScanMaterialStreaming(renderer).feedback

function textureBinding(surface: ScanSurface, name: string, image: number): TextureDemandBinding {
  const s = surface.parameters.scalar
  if (name === 'RGBNoise') return { image, uv: 2, scale: s['RGB Noise- Scaling'] * 100 / 128, placementScale: false }
  if (surface.family === 'custom-general') return { image, uv: 0, scale: s['UVs - Base  Scale'], placementScale: false }
  if (surface.family === 'smart-layers') {
    const layer = /^([0-4]) - Detail Texture$/.exec(name)
    if (layer) return { image, uv: 1, scale: 5 * s[layer[1] === '0' ? '0 - Detail Texture Tiling' : `${layer[1]} - Detail Textures - Tiling`], placementScale: true }
    if (name.startsWith('Large Scale Rock Texture Sample')) return { image, uv: 1, scale: s['Large Scale Rock Tiling'] * (name.endsWith('01') ? 0.6 : 0.35), placementScale: true }
  }
  return { image, uv: 0, scale: 1, placementScale: false }
}

export async function loadScanMaterials(surfaces: readonly ScanSurface[], root: string, renderer: WebGPURenderer): Promise<Map<string, MeshStandardNodeMaterial>> {
  const manager = new LoadingManager()
  manager.setURLModifier(url => url.endsWith('basis_transcoder.js') ? transcoderScript : url.endsWith('basis_transcoder.wasm') ? transcoderWasm : url)
  const loader = new KTX2Loader(manager).setTranscoderPath('/').setWorkerLimit(2).detectSupport(renderer)
  const streaming = new ScanTextureStreaming(renderer, loader, root)
  materialSets.set(renderer, streaming)
  const images = new Map<string, Promise<ScanTexture>>()
  try {
    const materials = new Map<string, MeshStandardNodeMaterial>()
    for (const surface of surfaces) {
      const bindings: TextureDemandBinding[] = []
      const material = await loadScanMaterial(surface, source => {
        const identity = `${new URL(root + source.file, location.href).href}:${source.srgb}`
        if (!images.has(identity)) images.set(identity, streaming.load(source))
        return images.get(identity)!
      }, (name, image) => { bindings.push(textureBinding(surface, name, image.id)) })
      materials.set(surface.path, material)
      streaming.bindings.set(material, bindings)
    }
    return materials
  } catch (error) {
    streaming.dispose()
    materialSets.delete(renderer)
    throw error
  }
}

async function loadScanMaterial(surface: ScanSurface, loadTexture: (source: ScanSurface['maps'][keyof ScanSurface['maps']]) => Promise<ScanTexture>, bind: (name: string, image: ScanTexture) => void) {
  const { scalar: s, vector: v, static_switch: switches } = surface.parameters
  const used = Object.entries(surface.maps).filter(([name]) => surface.family !== 'custom-general' || (name !== 'Metalness' && (name !== 'Packed' || !switches['Use Dedrived Roughness from Albedo?']) && (name !== 'RGBNoise' || !switches['RGB Blend - Disable'])))
  const entries = await Promise.all(used.map(async ([name, source]) => {
    return [name, await loadTexture(source)] as const
  }))
  const maps = Object.fromEntries(entries) as Record<keyof ScanSurface['maps'], ScanTexture>
  const primaryUV = Fn(builder => builder.context.getUV?.() ?? uv())()
  const sampleImage = (image: ScanTexture, coordinatesNode: Node<'vec2'>, name: string) => {
    bind(name, image)
    const node = texture(image.allocation.texture, coordinatesNode).setUpdateMatrix(false)
    image.nodes.push(node)
    return node
  }
  const sampleSurface = (name: string, coordinates = primaryUV) => sampleImage(maps[name]!, coordinates, name)
  if (surface.family === 'smart-layers') return createSmartMaterial(surface, sampleSurface, primaryUV)
  if (surface.family === 'simple-orm' || surface.family === 'candle') return createPropMaterial(surface, sampleSurface, primaryUV)
  for (const feature of ['Use Pure Metallic Base?', 'Switch - Use UV Random Offset?', 'Use Reconstructed Normal?']) {
    if (switches[feature]) throw new Error(`${surface.path}: unsupported surface feature ${feature}`)
  }
  if (s['Base - Metallic Intensity'] !== 0) throw new Error(`${surface.path}: metallic color response is unsupported`)
  const transform = new Matrix3().setUvTransform(s['UVs - Base  Offset X'], s['UVs - Base  Offset  Y'], s['UVs - Base  Scale'], s['UVs - Base  Scale'], s['UVs - Base  Rotation'], s['UVs - Base  Pivot X'], s['UVs - Base  Pivot Y'])
  const coordinates = uniform(transform).mul(vec3(primaryUV, 1)).xy
  const sample = (name: string, coordinatesNode = coordinates) => sampleImage(maps[name]!, coordinatesNode, name)
  const albedo = sample('Albedo').rgb
  const controls = v['Base - Albedo Controls']
  const tint = vec3(...v['Base - Albedo Tint'].slice(0, 3) as [number, number, number])
  const baseColor = mix(vec3(luma(albedo)), albedo, controls[0]).max(0).pow(controls[2] + s['Base - Contrast (Offset)']).mul(controls[1]).mul(tint)
  const normalXY = sample('Normal').xy.mul(2).sub(1)
  const sampledNormal = vec3(normalXY, float(1).sub(normalXY.dot(normalXY)).max(0).sqrt())
  const baseNormal = mix(vec3(0, 0, 1), sampledNormal, s['Base - Normal Intensity'])
  const finalNormal = mix(vec3(0, 0, 1), baseNormal, 1 + s['Gen - Normal Intensity (Offset)'])
  const rawRoughness = switches['Use Dedrived Roughness from Albedo?'] ? float(1).sub(luma(albedo)) : sample('Packed')[surface.channels.roughness]
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
    const noise = sample('RGBNoise', boxUV().mul(s['RGB Noise- Scaling'])).rgb.max(0).pow(s['RGB Noise - Contrast']).mul(s['RGB Noise - Intensity']).mul(noiseTint).clamp(0, 1)
    const blend = mix(vec3(luma(noise)), noise, s['RGB Noise - Saturation'])
    const overlay = color.greaterThan(0.5).select(vec3(1).sub(vec3(1).sub(color).mul(vec3(1).sub(blend)).mul(2)), color.mul(blend).mul(2))
    color = mix(color, switches['RGB Blend - Use Overlay?'] ? overlay : color.mul(blend), s['RGB Blend - Intenstiy'])
  }
  const material = new MeshPhysicalNodeMaterial({ name: surface.path.split('/').at(-1), roughness: 1, metalness: 0 })
  material.colorNode = color
  material.normalNode = tangentNormalWithUV(vec3(finalNormal.x, finalNormal.y.negate(), finalNormal.z), coordinates)
  material.roughnessNode = roughness.clamp(0, 1)
  material.specularColorNode = vec3(specular.clamp(0, 1).mul(2))
  return material
}
