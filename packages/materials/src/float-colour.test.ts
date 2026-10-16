import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { decodeFloatColour, liveMaterial } from './three'
import { applyStochasticTiling } from '@blacksite/look'
import { surface, releaseSurface } from '@blacksite/look/world'

describe('float texture colour decoding', () => {
  it('uses the native map decode branch without consuming shader chunk anchors or hooks', () => {
    const material = new THREE.MeshStandardMaterial()
    const priorCompile = vi.fn()
    const priorCache = () => 'prior-modifier'
    material.onBeforeCompile = priorCompile
    material.customProgramCacheKey = priorCache
    material.defines = { ...material.defines, EXISTING_MODIFIER: 1 }
    const version = material.version
    expect(decodeFloatColour(material)).toBe(material)
    expect(material.onBeforeCompile).toBe(priorCompile)
    expect(material.customProgramCacheKey).toBe(priorCache)
    expect(material.defines?.DECODE_VIDEO_TEXTURE).toBe(1)
    expect(material.defines?.EXISTING_MODIFIER).toBe(1)
    expect(material.version).toBe(version + 1)
    expect(THREE.ShaderChunk.map_fragment).toContain('#ifdef DECODE_VIDEO_TEXTURE')
    expect(THREE.ShaderChunk.map_fragment).toContain('sRGBTransferEOTF( sampledDiffuseColor )')
    decodeFloatColour(material)
    expect(material.version).toBe(version + 1)
    material.dispose()
  })

  it('enables decoding for live output without changing PBR map bindings', () => {
    const color = new THREE.Texture()
    const normal = new THREE.Texture()
    const orm = new THREE.Texture()
    const material = liveMaterial({ color, normal, orm })
    expect(material.map).toBe(color)
    expect(material.normalMap).toBe(normal)
    expect(material.roughnessMap).toBe(orm)
    expect(material.metalnessMap).toBe(orm)
    expect(material.aoMap).toBe(orm)
    expect(material.defines?.DECODE_VIDEO_TEXTURE).toBe(1)
    material.dispose()
    color.dispose()
    normal.dispose()
    orm.dispose()
  })

  it.each(['before', 'after'])('composes native decoding %s shared tiling with packed ORM and surface AO', order => {
    const color = new THREE.Texture()
    const normal = new THREE.Texture()
    const orm = new THREE.Texture()
    for (const texture of [color, normal, orm]) texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    const source = { name: `float-tiling-${order}`, tile: 2, maps: { map: color, normalMap: normal, roughnessMap: orm, metalnessMap: orm, aoMap: orm } }
    const material = surface(source)
    const previousCompile = vi.fn(material.onBeforeCompile)
    const previousCache = vi.fn(material.customProgramCacheKey)
    material.onBeforeCompile = previousCompile
    material.customProgramCacheKey = previousCache
    if (order === 'before') decodeFloatColour(material)
    const uninstall = applyStochasticTiling(material, { tileSpan: 2, seed: 23 })
    if (order === 'after') decodeFloatColour(material)
    const makeShader = () => ({
      uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    }) as Parameters<typeof material.onBeforeCompile>[0]
    const shader = makeShader()
    const renderer = Object.create(THREE.WebGLRenderer.prototype) as THREE.WebGLRenderer
    material.onBeforeCompile(shader, renderer)
    expect(previousCompile).toHaveBeenCalledTimes(1)
    expect(shader.fragmentShader.match(/sRGBTransferEOTF\( sampledDiffuseColor \)/g)).toHaveLength(1)
    expect(shader.fragmentShader.match(/blacksiteOrm = blacksiteTileSample\(roughnessMap, blacksiteTiles\)/g)).toHaveLength(1)
    expect(shader.fragmentShader).toContain('sampledDiffuseColor = blacksiteTileColour(map, blacksiteTiles)')
    const colourSampling = shader.fragmentShader.slice(shader.fragmentShader.indexOf('vec4 blacksiteTileColour'), shader.fragmentShader.indexOf('vec3 blacksiteTileNormalSample'))
    expect(colourSampling).toContain('#if defined(DECODE_VIDEO_TEXTURE) || BLACKSITE_TILE_SHADER_SRGB == 1')
    expect(colourSampling.match(/sRGBTransferEOTF\(textureGrad/g)).toHaveLength(3)
    expect(colourSampling).toContain('return sRGBTransferOETF(a * tile.weights.x + b * tile.weights.y + c * tile.weights.z);')
    expect(shader.fragmentShader).toContain('#define BLACKSITE_TILE_ROTATION 4')
    expect(shader.fragmentShader).toContain('mapN = blacksiteTileNormal(normalMap, blacksiteTiles, normalScale)')
    expect(shader.fragmentShader).not.toMatch(/mapN\.xy\s*\*=\s*normalScale/)
    expect(shader.fragmentShader).toContain('reflectedLight.indirectDiffuse *= lookAO;')
    expect(shader.uniforms.aoHeight?.value).toBe(1.1)
    expect(material.customProgramCacheKey()).toContain('look-ao-1.1-0.5|blacksite-stochastic-v2:')
    expect(previousCache).toHaveBeenCalledTimes(1)
    const differentSampler = orm.clone()
    differentSampler.minFilter = THREE.NearestFilter
    material.metalnessMap = differentSampler
    const separate = makeShader()
    material.onBeforeCompile(separate, renderer)
    expect(separate.fragmentShader).not.toContain('vec4 blacksiteOrm =')
    expect(separate.fragmentShader).toContain('blacksiteTileSample(metalnessMap, blacksiteTiles)')
    expect(material.customProgramCacheKey()).toMatch(/:false$/)
    material.metalnessMap = orm
    differentSampler.dispose()
    uninstall()
    expect(material.onBeforeCompile).toBe(previousCompile)
    expect(material.customProgramCacheKey).toBe(previousCache)
    expect(material.defines?.DECODE_VIDEO_TEXTURE).toBe(1)
    const restored = makeShader()
    material.onBeforeCompile(restored, renderer)
    expect(restored.fragmentShader).toContain('#include <map_fragment>')
    expect(restored.fragmentShader).toContain('reflectedLight.indirectDiffuse *= lookAO;')
    expect(restored.fragmentShader).not.toContain('blacksiteTileSample')
    releaseSurface(source)
    color.dispose()
    normal.dispose()
    orm.dispose()
  })

  it.each([THREE.SRGBColorSpace, THREE.LinearSRGBColorSpace])('does not enable shader decoding for a standard %s colour texture', colorSpace => {
    const color = new THREE.Texture()
    const normal = new THREE.Texture()
    const orm = new THREE.Texture()
    color.colorSpace = colorSpace
    for (const texture of [color, normal, orm]) texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    const source = { name: `standard-tiling-${colorSpace}`, tile: 2, maps: { map: color, normalMap: normal, roughnessMap: orm, metalnessMap: orm, aoMap: orm } }
    const material = surface(source)
    const uninstall = applyStochasticTiling(material)
    const shader = {
      uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    } as Parameters<typeof material.onBeforeCompile>[0]
    material.onBeforeCompile(shader, Object.create(THREE.WebGLRenderer.prototype) as THREE.WebGLRenderer)
    expect(material.defines?.DECODE_VIDEO_TEXTURE).toBeUndefined()
    expect(shader.fragmentShader).toContain('#define BLACKSITE_TILE_SHADER_SRGB 0')
    expect(shader.fragmentShader).toContain('return blacksiteTileSample(sourceMap, tile);')
    expect(shader.fragmentShader.match(/blacksiteOrm = blacksiteTileSample\(roughnessMap, blacksiteTiles\)/g)).toHaveLength(1)
    uninstall()
    releaseSurface(source)
    color.dispose()
    normal.dispose()
    orm.dispose()
  })
})
