import { LoadingManager } from 'three'
import { type MeshStandardNodeMaterial, type Node, type WebGPURenderer } from 'three/webgpu'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import transcoderScript from 'three/examples/jsm/libs/basis/basis_transcoder.js?url'
import transcoderWasm from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url'
import { Fn, context, nodeObject, uint, uv, vec4 } from 'three/tsl'
import { type TextureDemandBinding } from '@blacksite/geometry'
import { createGeneralMaterial } from './scan-material-general'
import { createSurfaceMaterial } from './scan-material-surfaces'
import { createSmartMaterial, createPropMaterial } from './scan-surface-materials'
import { createFlameMaterial } from './scan-material-flame'
import { ScanTextureStreaming, type ScanImageSource, type ScanTexture } from './scan-texture-streaming'
import { ScanMaterialData, ScanMaterialTexture } from './scan-material-data'

type Channel = 'r' | 'g' | 'b' | 'a'
type Parameters = { scalar: Record<string, number>; vector: Record<string, number[]>; static_switch: Record<string, boolean> }
export type ScanSurface = {
  family: 'custom-general' | 'smart-layers' | 'simple-orm' | 'candle' | 'foliage' | 'generic-props' | 'cutout' | 'vertex-blend' | 'solid' | 'world-grid' | 'steel' | 'emissive' | 'flame'
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

export async function loadScanMaterials(surfaces: readonly ScanSurface[], root: string, renderer: WebGPURenderer) {
  const manager = new LoadingManager()
  manager.setURLModifier(url => url.endsWith('basis_transcoder.js') ? transcoderScript : url.endsWith('basis_transcoder.wasm') ? transcoderWasm : url)
  const loader = new KTX2Loader(manager).setTranscoderPath('/').setWorkerLimit(8).detectSupport(renderer)
  const streaming = new ScanTextureStreaming(renderer, loader, root)
  materialSets.set(renderer, streaming)
  const images = new Map<string, Promise<ScanTexture>>()
  try {
    const data = new ScanMaterialData(surfaces)
    if (!streaming.ledger.reserve(data, 'materials', data.attribute.array.byteLength)) throw new Error('Material parameters exceed the shared residency budget')
    const materialIds = new Map<MeshStandardNodeMaterial, number>()
    const materials = Object.assign(new Map<string, MeshStandardNodeMaterial>(), { materialIds })
    const families = new Map<ScanSurface['family'], MeshStandardNodeMaterial>()
    const primaryUV = Fn(builder => builder.context.getUV?.() ?? uv())()
    const loaded: Record<string, ScanTexture>[] = [], defaults = new Map<ScanSurface['family'], Record<string, ScanTexture>>()
    let cursor = 0
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (cursor < surfaces.length) {
        const id = cursor++, surface = surfaces[id]!
        validateSurface(surface)
        loaded[id] = Object.fromEntries(await Promise.all(Object.entries(surface.maps).map(async ([name, source]) => {
          const identity = `${new URL(root + source.file, location.href).href}:${source.srgb}`
          if (!images.has(identity)) images.set(identity, streaming.load(source))
          return [name, await images.get(identity)!] as const
        })))
      }
    }))
    for (const [id, surface] of surfaces.entries()) defaults.set(surface.family, { ...defaults.get(surface.family), ...loaded[id] })
    for (const [id, surface] of surfaces.entries()) {
      const maps = { ...defaults.get(surface.family), ...loaded[id] }
      if (!families.has(surface.family)) {
        const graph = data.graph(surface.family)
        const sample = (name: string, coordinates: Node<'vec2'> = primaryUV) => {
          const image = maps[name]
          if (!image) throw new Error(`${surface.family} has no texture slot ${name}`)
          return vec4(nodeObject(new ScanMaterialTexture(name, image.allocation.texture, coordinates)))
        }
        const template = surface.family === 'smart-layers' ? createSmartMaterial(graph, sample, primaryUV)
          : surface.family === 'simple-orm' || surface.family === 'candle' ? createPropMaterial(graph, sample, primaryUV)
          : surface.family === 'custom-general' || surface.family === 'foliage' ? createGeneralMaterial(graph, sample, primaryUV)
          : surface.family === 'flame' ? createFlameMaterial(graph, sample, primaryUV)
          : createSurfaceMaterial(graph, sample, primaryUV)
        families.set(surface.family, template)
      }
      const material = families.get(surface.family)!.clone()
      material.name = surface.path.split('/').at(-1)!
      Object.assign(material, { scanTextures: maps })
      materials.set(surface.path, material)
      materialIds.set(material, id)
      if (surface.family === 'flame') {
        material.contextNode = context({ getMaterialId: () => uint(id) })
        for (const image of Object.values(maps)) streaming.pin(image, 256)
      } else streaming.bindings.set(material, Object.entries(maps).map(([name, image]) => textureBinding(surface, name, image.id)))
    }
    return materials
  } catch (error) {
    streaming.dispose()
    materialSets.delete(renderer)
    throw error
  }
}

function validateSurface(surface: ScanSurface) {
  const switches = surface.parameters.static_switch
  if (surface.family === 'custom-general' || surface.family === 'foliage') {
    if (switches['Use Reconstructed Normal?']) throw new Error(`${surface.path}: unsupported reconstructed normal`)
    if ((surface.parameters.scalar['Base - Metallic Intensity'] ?? 0) !== 0) throw new Error(`${surface.path}: unsupported metallic color response`)
  }
  if (surface.family === 'smart-layers') for (const feature of ['Enable', 'Surface Overlay', 'Enable Tessellation']) if (switches[feature]) throw new Error(`${surface.path}: unsupported smart surface feature ${feature}`)
}
