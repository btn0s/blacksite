import { Box3, CompressedTexture, LoadingManager, Matrix3, NoColorSpace, RepeatWrapping, SRGBColorSpace, Vector3, type Camera, type Texture } from 'three'
import { MeshPhysicalNodeMaterial, type MeshStandardNodeMaterial, type Node, type WebGPURenderer } from 'three/webgpu'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import transcoderScript from 'three/examples/jsm/libs/basis/basis_transcoder.js?url'
import transcoderWasm from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url'
import { Fn, float, max, mix, positionWorld, texture, uniform, uv, vec3 } from 'three/tsl'
import { tangentNormalWithUV } from '@blacksite/geometry'
import { boxUV, cheapContrast, colorTransform, luma, sCurve, saturate } from './scan-material-nodes'
import { createSmartMaterial, createPropMaterial } from './scan-surface-materials'

type Channel = 'r' | 'g' | 'b' | 'a'
type Parameters = { scalar: Record<string, number>; vector: Record<string, number[]>; static_switch: Record<string, boolean> }
export type ScanSurface = {
  family: 'custom-general' | 'smart-layers' | 'simple-orm' | 'candle'
  path: string
  parameters: Parameters
  channels: { roughness: Channel; metalness: Channel }
  maps: Record<string, { file: string; detailFile?: string; srgb: boolean }>
}

type ScanTexture = {
  source: ScanSurface['maps']['Albedo']
  baseline: Texture
  detail: Texture | null
  nodes: ReturnType<typeof texture>[]
  distance: number
  density: number
  lastNeeded: number
  retryAt: number
}
type ResidentTexture = { texture: Texture; reportedBytes: number; residentBytes: number }
type ScanMaterialSet = {
  resident: ResidentTexture[]
  images: ScanTexture[]
  surfaces: Map<string, { scale: number; images: ScanTexture[] }>
  upload(map: Texture, source: ScanTexture['source']): Texture
  load(file: string): Promise<Texture>
  loader: KTX2Loader
  disposed: boolean
}

const materialSets = new WeakMap<WebGPURenderer, ScanMaterialSet>()
const detailLimit = 24

export function residentScanTextures(renderer: WebGPURenderer) {
  return materialSets.get(renderer)?.resident ?? []
}

export async function loadScanMaterials(surfaces: readonly ScanSurface[], root: string, renderer: WebGPURenderer): Promise<Map<string, MeshStandardNodeMaterial>> {
  const manager = new LoadingManager()
  manager.setURLModifier(url => url.endsWith('basis_transcoder.js') ? transcoderScript : url.endsWith('basis_transcoder.wasm') ? transcoderWasm : url)
  const loader = new KTX2Loader(manager).setTranscoderPath('/').setWorkerLimit(2).detectSupport(renderer)
  const images = new Map<string, Promise<ScanTexture>>()
  const resident: ResidentTexture[] = []
  const set: ScanMaterialSet = {
    resident, images: [], surfaces: new Map(), loader, disposed: false,
    load: file => loader.loadAsync(root + file),
    upload: (map, source) => {
      map.flipY = false
      map.wrapS = map.wrapT = RepeatWrapping
      map.anisotropy = 8
      map.colorSpace = source.srgb ? SRGBColorSpace : NoColorSpace
      const bytes = map instanceof CompressedTexture ? map.mipmaps.reduce((sum, mip) => sum + mip.data.byteLength, 0) : null
      if (map instanceof CompressedTexture) map.onUpdate = () => {
        const buffers = new Set(map.mipmaps.map(mip => mip.data.buffer))
        const empty = new Uint8Array(0)
        for (const mip of map.mipmaps) mip.data = empty
        for (const buffer of buffers) {
          if (!(buffer instanceof ArrayBuffer)) throw new Error('Texture upload requires transferable buffers')
          buffer.transfer(0)
        }
        map.onUpdate = null
      }
      const before = renderer.info.memory.texturesSize
      renderer.initTexture(map)
      const reportedBytes = renderer.info.memory.texturesSize - before
      resident.push({ texture: map, reportedBytes, residentBytes: bytes ?? reportedBytes })
      return map
    },
  }
  materialSets.set(renderer, set)
  const loadTexture = (source: ScanSurface['maps'][keyof ScanSurface['maps']]) => {
    const url = root + source.file
    if (!images.has(url)) images.set(url, loader.loadAsync(url).then(map => {
      const image: ScanTexture = { source, baseline: set.upload(map, source), detail: null, nodes: [], distance: Infinity, density: 0, lastNeeded: 0, retryAt: 0 }
      set.images.push(image)
      return image
    }))
    return images.get(url)!
  }
  try {
    const materials = new Map<string, MeshStandardNodeMaterial>()
    for (const surface of surfaces) {
      const used = new Set<ScanTexture>()
      materials.set(surface.path, await loadScanMaterial(surface, async source => {
        const image = await loadTexture(source)
        used.add(image)
        return image
      }))
      set.surfaces.set(surface.path, { scale: surface.family === 'custom-general' ? Math.abs(surface.parameters.scalar['UVs - Base  Scale']) : 1, images: [...used] })
    }
    return materials
  } catch (error) {
    set.disposed = true
    loader.dispose()
    for (const entry of resident) entry.texture.dispose()
    materialSets.delete(renderer)
    throw error
  }
}

export function createScanMaterialStreaming(renderer: WebGPURenderer, placements: readonly { materials: readonly string[]; bounds: Box3 }[]) {
  const set = materialSets.get(renderer)
  if (!set) throw new Error('Load scan materials before configuring their placements')
  const size = new Vector3()
  const position = new Vector3()
  const uses = placements.flatMap(placement => {
    placement.bounds.getSize(size)
    const extent = Math.max(size.x, size.y, size.z)
    return [...new Set(placement.materials)].flatMap(path => {
      const surface = set.surfaces.get(path)
      return surface ? [{ bounds: placement.bounds, extent: extent / Math.max(surface.scale, 0.0001), images: surface.images.filter(image => image.source.detailFile) }] : []
    })
  })
  const detailed = new Set<ScanTexture>()
  let desired = new Set<ScanTexture>()
  let pending: { image: ScanTexture; texture: Texture | null } | null = null
  let nextSelection = 0
  const demote = (image: ScanTexture) => {
    if (!image.detail) return
    for (const node of image.nodes) node.value = image.baseline
    const index = set.resident.findIndex(entry => entry.texture === image.detail)
    if (index >= 0) set.resident.splice(index, 1)
    image.detail.dispose()
    image.detail = null
    detailed.delete(image)
  }
  return {
    update(camera: Camera, viewportHeight: number) {
      if (set.disposed) return
      const now = performance.now()
      if (now >= nextSelection) {
        nextSelection = now + 200
        camera.getWorldPosition(position)
        const projection = viewportHeight * Math.abs(camera.projectionMatrix.elements[5]!) / 2
        for (const image of set.images) { image.distance = Infinity; image.density = 0 }
        for (const use of uses) {
          const distance = use.bounds.distanceToPoint(position)
          const pixels = projection * use.extent / Math.max(distance, 0.01)
          for (const image of use.images) {
            image.distance = Math.min(image.distance, distance)
            image.density = Math.max(image.density, pixels / Math.max(image.baseline.image.width, image.baseline.image.height))
          }
        }
        const candidates = set.images.filter(image => image.source.detailFile && image.density > (image.detail ? 0.8 : 1))
        candidates.sort((a, b) => a.distance - b.distance || b.density - a.density)
        desired = new Set(candidates.slice(0, detailLimit))
        for (const image of desired) image.lastNeeded = now
        for (const image of detailed) if (!desired.has(image) && now - image.lastNeeded > 3000) demote(image)
      }
      if (pending?.texture) {
        const { image, texture: map } = pending
        pending = null
        if (desired.has(image)) {
          image.detail = set.upload(map, image.source)
          detailed.add(image)
          for (const node of image.nodes) node.value = image.detail
        } else map.dispose()
      }
      if (pending) return
      const next = [...desired].find(image => !image.detail && now >= image.retryAt)
      if (!next) return
      if (detailed.size >= detailLimit) {
        const farthest = [...detailed].filter(image => !desired.has(image)).sort((a, b) => b.distance - a.distance)[0]
        if (!farthest) return
        demote(farthest)
      }
      const request = { image: next, texture: null as Texture | null }
      pending = request
      void set.load(next.source.detailFile!).then(map => {
        if (set.disposed) map.dispose()
        else request.texture = map
      }).catch(error => {
        next.retryAt = performance.now() + 30000
        if (pending === request) pending = null
        if (!set.disposed) console.warn('Scan detail unavailable; retaining 2K texture', error)
      })
    },
    dispose() {
      set.disposed = true
      pending?.texture?.dispose()
      for (const image of detailed) demote(image)
      for (const entry of set.resident) entry.texture.dispose()
      set.resident.length = 0
      set.loader.dispose()
      materialSets.delete(renderer)
    },
  }
}

async function loadScanMaterial(surface: ScanSurface, loadTexture: (source: ScanSurface['maps'][keyof ScanSurface['maps']]) => Promise<ScanTexture>) {
  const { scalar: s, vector: v, static_switch: switches } = surface.parameters
  const used = Object.entries(surface.maps).filter(([name]) => surface.family !== 'custom-general' || (name !== 'Metalness' && (name !== 'Packed' || !switches['Use Dedrived Roughness from Albedo?']) && (name !== 'RGBNoise' || !switches['RGB Blend - Disable'])))
  const entries = await Promise.all(used.map(async ([name, source]) => {
    return [name, await loadTexture(source)] as const
  }))
  const maps = Object.fromEntries(entries) as Record<keyof ScanSurface['maps'], ScanTexture>
  const primaryUV = Fn(builder => builder.context.getUV?.() ?? uv())()
  const sampleImage = (image: ScanTexture, coordinatesNode: Node<'vec2'>) => {
    const node = texture(image.baseline, coordinatesNode).setUpdateMatrix(false)
    image.nodes.push(node)
    return node
  }
  const sampleSurface = (name: string, coordinates = primaryUV) => sampleImage(maps[name]!, coordinates)
  if (surface.family === 'smart-layers') return createSmartMaterial(surface, sampleSurface, primaryUV)
  if (surface.family === 'simple-orm' || surface.family === 'candle') return createPropMaterial(surface, sampleSurface, primaryUV)
  for (const feature of ['Use Pure Metallic Base?', 'Switch - Use UV Random Offset?', 'Use Reconstructed Normal?']) {
    if (switches[feature]) throw new Error(`${surface.path}: unsupported surface feature ${feature}`)
  }
  if (s['Base - Metallic Intensity'] !== 0) throw new Error(`${surface.path}: metallic color response is unsupported`)
  const transform = new Matrix3().setUvTransform(s['UVs - Base  Offset X'], s['UVs - Base  Offset  Y'], s['UVs - Base  Scale'], s['UVs - Base  Scale'], s['UVs - Base  Rotation'], s['UVs - Base  Pivot X'], s['UVs - Base  Pivot Y'])
  const coordinates = uniform(transform).mul(vec3(primaryUV, 1)).xy
  const sample = (image: ScanTexture, coordinatesNode = coordinates) => {
    return sampleImage(image, coordinatesNode)
  }
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
    const noise = sample(maps.RGBNoise, boxUV().mul(s['RGB Noise- Scaling'])).rgb.max(0).pow(s['RGB Noise - Contrast']).mul(s['RGB Noise - Intensity']).mul(noiseTint).clamp(0, 1)
    const blend = mix(vec3(luma(noise)), noise, s['RGB Noise - Saturation'])
    const overlay = color.greaterThan(0.5).select(vec3(1).sub(vec3(1).sub(color).mul(vec3(1).sub(blend)).mul(2)), color.mul(blend).mul(2))
    color = mix(color, switches['RGB Blend - Use Overlay?'] ? overlay : color.mul(blend), s['RGB Blend - Intenstiy'])
  }
  const material = new MeshPhysicalNodeMaterial({ name: surface.path.split('/').at(-1), map: maps.Albedo.baseline, normalMap: maps.Normal.baseline, roughness: 1, metalness: 0 })
  material.colorNode = color
  material.normalNode = tangentNormalWithUV(vec3(finalNormal.x, finalNormal.y.negate(), finalNormal.z), coordinates)
  material.roughnessNode = roughness.clamp(0, 1)
  material.specularColorNode = vec3(specular.clamp(0, 1).mul(2))
  return material
}
