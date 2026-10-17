import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { disposeSurfaceSource, loadBaked, loadBakedSurface, standardMaterial, surfaceSource, type BakedMaterial, type MaterialTextures } from './three'
import { meterSurface, releaseSurface, surface, SURFACES, worldBoxGeometry } from '../../look/src/world/surfaces'

const urls = (size: number) => ({ color: `${size}/color.webp`, normal: `${size}/normal.webp`, orm: `${size}/orm.webp`, masks: `${size}/masks.webp` })
const baked: BakedMaterial = { name: 'fixture', size: 2, depth: 0.02, format: 'webp', maps: { 512: urls(512), 1024: urls(1024) } }
const textures = (): MaterialTextures => ({ name: 'fixture', size: 2, color: new THREE.Texture(), normal: new THREE.Texture(), orm: new THREE.Texture(), masks: new THREE.Texture() })
afterEach(() => { vi.restoreAllMocks() })

describe('baked material runtime', () => {
  it('loads only the requested resolution and assigns correct colour/data sampling', async () => {
    const load = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new THREE.Texture())
    const result = await loadBaked(baked, { resolution: 600, anisotropy: 16 })
    expect(load.mock.calls.map(call => call[0])).toEqual(Object.values(urls(512)))
    expect(result.color.colorSpace).toBe(THREE.SRGBColorSpace)
    for (const map of [result.normal, result.orm, result.masks]) expect(map.colorSpace).toBe(THREE.NoColorSpace)
    for (const map of [result.color, result.normal, result.orm, result.masks]) {
      expect([map.wrapS, map.wrapT]).toEqual([THREE.RepeatWrapping, THREE.RepeatWrapping])
      expect(map.anisotropy).toBe(8)
    }
  })

  it('disposes every successful parallel load when another texture fails', async () => {
    const loaded = [new THREE.Texture<HTMLImageElement>(), new THREE.Texture<HTMLImageElement>(), new THREE.Texture<HTMLImageElement>()]
    const dispose = loaded.map(texture => vi.spyOn(texture, 'dispose'))
    const failure = new Error('normal failed')
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async url => {
      if (url.endsWith('/normal.webp')) throw failure
      return loaded[url.endsWith('/color.webp') ? 0 : url.endsWith('/orm.webp') ? 1 : 2]!
    })
    await expect(loadBaked(baked, { resolution: 512 })).rejects.toBe(failure)
    for (const call of dispose) expect(call).toHaveBeenCalledOnce()
  })

  it('rejects missing KTX2 renderer and invalid resolution selection before network work', async () => {
    const load = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync')
    await expect(loadBaked({ ...baked, format: 'ktx2' })).rejects.toThrow('renderer')
    await expect(loadBaked({ ...baked, maps: {} })).rejects.toThrow('resolutions')
    await expect(loadBaked(baked, { resolution: NaN })).rejects.toThrow('positive')
    await expect(loadBaked(baked, { resolution: 0 })).rejects.toThrow('positive')
    expect(load).not.toHaveBeenCalled()
  })

  it('shares ORM between all three material slots and disposes each owned map once', async () => {
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new THREE.Texture())
    const source = await loadBakedSurface(baked, { resolution: 1024 })
    expect(source.maps.roughnessMap).toBe(source.maps.metalnessMap)
    expect(source.maps.roughnessMap).toBe(source.maps.aoMap)
    const maps = [source.maps.map, source.maps.normalMap, source.maps.roughnessMap, source.masks]
    const dispose = maps.map(texture => vi.spyOn(texture, 'dispose'))
    disposeSurfaceSource(source)
    for (const call of dispose) expect(call).toHaveBeenCalledOnce()
  })

  it('keeps baked PBR values unscaled in the standard material', () => {
    const source = textures()
    const material = standardMaterial(source)
    expect(material.map).toBe(source.color)
    expect(material.normalMap).toBe(source.normal)
    expect(material.roughnessMap).toBe(source.orm)
    expect(material.metalnessMap).toBe(source.orm)
    expect(material.aoMap).toBe(source.orm)
    expect(material.roughness).toBe(1)
    expect(material.metalness).toBe(1)
    expect(material.userData.tile).toBe(2)
    material.dispose()
    disposeSurfaceSource(surfaceSource(source))
  })
})

describe('world surface integration', () => {
  it('caches by source identity and invalidates disposed variants without disposing source textures', () => {
    const source = surfaceSource(textures())
    const originalSpec = { ...SURFACES.cast }
    const normal = surface(source, { ao: false })
    const scaled = surface(source, { ao: false, scale: 2 })
    expect(surface(source, { ao: false })).toBe(normal)
    expect(scaled).not.toBe(normal)
    expect(normal.roughnessMap).toBe(source.maps.roughnessMap)
    expect(normal.color.getHexString()).toBe('ffffff')
    expect(scaled.userData.tile).toBe(4)
    const disposeNormal = vi.spyOn(normal, 'dispose')
    const disposeScaled = vi.spyOn(scaled, 'dispose')
    const disposeTexture = vi.spyOn(source.maps.map, 'dispose')
    releaseSurface(source)
    expect(disposeNormal).toHaveBeenCalledOnce()
    expect(disposeScaled).toHaveBeenCalledOnce()
    expect(disposeTexture).not.toHaveBeenCalled()
    expect(surface(source, { ao: false })).not.toBe(normal)
    expect(SURFACES.cast).toEqual(originalSpec)
    releaseSurface(source)
    disposeSurfaceSource(source)
  })

  it('preserves shared ORM when cloning to metre UVs and leaves source repeats alone', () => {
    const source = surfaceSource(textures())
    const material = meterSurface(source, { ao: false })
    expect(material.roughnessMap).toBe(material.metalnessMap)
    expect(material.roughnessMap).toBe(material.aoMap)
    expect(material.roughnessMap).not.toBe(source.maps.roughnessMap)
    expect(material.roughnessMap!.repeat.toArray()).toEqual([0.5, 0.5])
    expect(source.maps.roughnessMap.repeat.toArray()).toEqual([1, 1])
    const geometry = worldBoxGeometry(4, 2, 1, source.tile)
    const uv = geometry.getAttribute('uv')
    expect(Math.max(...Array.from({ length: uv.count }, (_, i) => uv.getX(i)))).toBe(2)
    geometry.dispose()
    material.dispose()
    for (const map of new Set([material.map, material.normalMap, material.roughnessMap])) map?.dispose()
    releaseSurface(source)
    disposeSurfaceSource(source)
  })
})
