import * as THREE from 'three'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import transcoderScript from 'three/examples/jsm/libs/basis/basis_transcoder.js?url'
import transcoderWasm from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url'

export type BakedMaps = { readonly color: string; readonly normal: string; readonly orm: string; readonly masks: string }
export type BakedMaterial = {
  readonly name: string
  readonly title?: string
  readonly size: number
  readonly depth: number
  readonly format: 'ktx2' | 'webp'
  readonly maps: Readonly<Record<number, BakedMaps>>
}

export type MaterialTextures = { readonly name: string; readonly size: number; readonly color: THREE.Texture; readonly normal: THREE.Texture; readonly orm: THREE.Texture; readonly masks: THREE.Texture }

export type SurfaceSource = {
  readonly name: string
  readonly tile: number
  readonly maps: { readonly map: THREE.Texture; readonly normalMap: THREE.Texture; readonly roughnessMap: THREE.Texture; readonly metalnessMap: THREE.Texture; readonly aoMap: THREE.Texture }
  readonly masks: THREE.Texture
}

export type LoadOptions = { readonly renderer?: THREE.WebGLRenderer; readonly resolution?: number; readonly anisotropy?: number }

const loaders = new WeakMap<THREE.WebGLRenderer, KTX2Loader>()

export function ktx2Loader(renderer: THREE.WebGLRenderer) {
  const existing = loaders.get(renderer)
  if (existing) return existing
  const manager = new THREE.LoadingManager()
  manager.setURLModifier(url => url.endsWith('basis_transcoder.js') ? transcoderScript : url.endsWith('basis_transcoder.wasm') ? transcoderWasm : url)
  const loader = new KTX2Loader(manager).setTranscoderPath('/').detectSupport(renderer)
  loaders.set(renderer, loader)
  return loader
}

export function autoResolution() {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 512 : 1024
}

function pickResolution(baked: BakedMaterial, wanted: number) {
  const sizes = Object.keys(baked.maps).map(Number).sort((a, b) => a - b)
  if (!sizes.length || sizes.some(size => !Number.isInteger(size) || size <= 0)) throw new Error(`${baked.name}: material has no valid texture resolutions`)
  if (!Number.isFinite(wanted) || wanted <= 0) throw new Error('resolution must be positive')
  return sizes.reduce((best, size) => Math.abs(size - wanted) < Math.abs(best - wanted) ? size : best, sizes[0]!)
}

function prepare(texture: THREE.Texture, color: boolean, anisotropy: number) {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.anisotropy = anisotropy
  texture.needsUpdate = true
  return texture
}

export async function loadBaked(baked: BakedMaterial, options: LoadOptions = {}): Promise<MaterialTextures> {
  const resolution = pickResolution(baked, options.resolution ?? autoResolution())
  const urls = baked.maps[resolution]!
  const anisotropy = Math.min(8, options.anisotropy ?? options.renderer?.capabilities.getMaxAnisotropy() ?? 4)
  let load: (url: string) => Promise<THREE.Texture>
  if (baked.format === 'ktx2') {
    if (!options.renderer) throw new Error(`${baked.name}: KTX2 materials need { renderer } to pick a GPU format`)
    const loader = ktx2Loader(options.renderer)
    load = url => loader.loadAsync(url)
  } else {
    const loader = new THREE.TextureLoader()
    load = url => loader.loadAsync(url)
  }
  const loaded = await Promise.allSettled([urls.color, urls.normal, urls.orm, urls.masks].map(load))
  const failed = loaded.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') {
    for (const result of loaded) if (result.status === 'fulfilled') result.value.dispose()
    throw failed.reason
  }
  const [color, normal, orm, masks] = loaded.map(result => (result as PromiseFulfilledResult<THREE.Texture>).value)
  return { name: baked.name, size: baked.size, color: prepare(color!, true, anisotropy), normal: prepare(normal!, false, anisotropy), orm: prepare(orm!, false, anisotropy), masks: prepare(masks!, false, anisotropy) }
}

export function surfaceSource(textures: MaterialTextures): SurfaceSource {
  const { orm } = textures
  return { name: textures.name, tile: textures.size, maps: { map: textures.color, normalMap: textures.normal, roughnessMap: orm, metalnessMap: orm, aoMap: orm }, masks: textures.masks }
}

export async function loadBakedSurface(baked: BakedMaterial, options: LoadOptions = {}) {
  return surfaceSource(await loadBaked(baked, options))
}

export function disposeSurfaceSource(source: SurfaceSource) {
  for (const texture of new Set([...Object.values(source.maps), source.masks])) texture.dispose()
}

export function standardMaterial(textures: MaterialTextures, parameters: THREE.MeshStandardMaterialParameters = {}) {
  const material = new THREE.MeshStandardMaterial({
    name: `material-${textures.name}`,
    map: textures.color,
    normalMap: textures.normal,
    roughnessMap: textures.orm,
    metalnessMap: textures.orm,
    aoMap: textures.orm,
    roughness: 1,
    metalness: 1,
    envMapIntensity: 0.55,
    ...parameters,
  })
  material.userData.tile = textures.size
  return material
}

export function decodeFloatColour(material: THREE.MeshStandardMaterial) {
  if (material.defines?.DECODE_VIDEO_TEXTURE !== 1) {
    material.defines = { ...material.defines, DECODE_VIDEO_TEXTURE: 1 }
    material.needsUpdate = true
  }
  return material
}

export function liveMaterial(textures: { readonly color: THREE.Texture; readonly normal: THREE.Texture; readonly orm: THREE.Texture }, name = 'live', parameters: THREE.MeshStandardMaterialParameters = {}) {
  return decodeFloatColour(new THREE.MeshStandardMaterial({
    name: `material-${name}`,
    map: textures.color,
    normalMap: textures.normal,
    roughnessMap: textures.orm,
    metalnessMap: textures.orm,
    aoMap: textures.orm,
    roughness: 1,
    metalness: 1,
    envMapIntensity: 0.55,
    ...parameters,
  }))
}
