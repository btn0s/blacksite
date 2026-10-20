import { LoadingManager } from 'three'
import { type MeshStandardNodeMaterial, type Node, type WebGPURenderer } from 'three/webgpu'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import transcoderScript from 'three/examples/jsm/libs/basis/basis_transcoder.js?url'
import transcoderWasm from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url'
import { Fn, texture, uv } from 'three/tsl'
import { type TextureDemandBinding } from '@blacksite/geometry'
import { createGeneralMaterial } from './scan-material-general'
import { createSurfaceMaterial } from './scan-material-surfaces'
import { createSmartMaterial, createPropMaterial } from './scan-surface-materials'
import { ScanTextureStreaming, type ScanImageSource, type ScanTexture } from './scan-texture-streaming'

type Channel = 'r' | 'g' | 'b' | 'a'
type Parameters = { scalar: Record<string, number>; vector: Record<string, number[]>; static_switch: Record<string, boolean> }
export type ScanSurface = {
  family: 'custom-general' | 'smart-layers' | 'simple-orm' | 'candle' | 'foliage' | 'generic-props' | 'cutout' | 'vertex-blend' | 'solid' | 'world-grid' | 'steel' | 'emissive'
  path: string
  parent?: string | null
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
  if (surface.family === 'custom-general' || surface.family === 'foliage') return { image, uv: 0, scale: s['UVs - Base  Scale'], placementScale: false }
  if (surface.family === 'smart-layers') {
    const layer = /^([0-4]) - Detail Texture$/.exec(name)
    if (layer) return { image, uv: 1, scale: 5 * s[layer[1] === '0' ? '0 - Detail Texture Tiling' : `${layer[1]} - Detail Textures - Tiling`], placementScale: true }
    if (name.startsWith('Large Scale Rock Texture Sample')) return { image, uv: 1, scale: s['Large Scale Rock Tiling'] * (name.endsWith('01') ? 0.6 : 0.35), placementScale: true }
  }
  if (surface.family === 'generic-props') return { image, uv: 0, scale: Math.max(s.U_Tiling, s.V_Tiling), placementScale: false }
  if (surface.family === 'cutout') return { image, uv: 0, scale: Math.max(s.TilingX, s.TilingY), placementScale: false }
  if (surface.family === 'world-grid') return { image, uv: 0, scale: name === 'Normal' ? 20 : 1, placementScale: false }
  if (surface.family === 'vertex-blend') {
    const index = /^Layer 0([1-3])/.exec(name)?.[1]
    const scale = s[index ? `Layer ${index} - Tiling` : 'Puddle - Tiling']
    return { image, uv: surface.parameters.static_switch['Use World Alignment'] ? 2 : 0, scale: surface.parameters.static_switch['Use World Alignment'] ? 1 / scale : scale, placementScale: false }
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
  const switches = surface.parameters.static_switch
  const used = Object.entries(surface.maps).filter(([name]) => (surface.family !== 'custom-general' && surface.family !== 'foliage') || (name !== 'Metalness' && (name !== 'Packed' || !switches['Use Dedrived Roughness from Albedo?']) && (name !== 'RGBNoise' || !switches['RGB Blend - Disable'])))
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
  if (surface.family === 'custom-general' || surface.family === 'foliage') return createGeneralMaterial(surface, sampleSurface, primaryUV)
  return createSurfaceMaterial(surface, sampleSurface, primaryUV)
}
