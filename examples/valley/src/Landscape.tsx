import { useEffect, useMemo, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Color, Vector3 } from 'three'
import { clamp, float, max, mix, smoothstep as smooth } from 'three/tsl'
import type { WebGPURenderer } from 'three/webgpu'
import type { SunLight } from 'three/addons/lights/SunLight.js'
import {
  BIRCH, OAK, PINE, createCover, createForest, createTerrain, flowerTexture, generateTree, grassTexture, leafClusterTexture,
  litterTexture, needleClusterTexture, smoothstep, terrainUniforms, valueNoise, landscapeNoise, type CoverSample, type Cover, type Forest, type Terrain, type Wind,
} from '@blacksite/landscape'
import type { Texture } from 'three'
import { canopy, tiers, type Tier } from './model'
import type { ValleyWorld } from './world'

export type LandscapeHandle = { terrain: Terrain; cover: Cover; forest: Forest }

export type BarkSet = { pine: { color: Texture; normal: Texture } }

const BROADLEAF = { ...OAK, crown: 5.6, leafSize: 1.75, leafCount: 780 }
const SHRUB = { ...OAK, name: 'shrub', height: 4.2, trunk: 0.09, crown: 2.5, leafSize: 1.15, leafCount: 340, seed: 19 }
const meadow = ({ surface, slope }: CoverSample) => float(1).sub(smooth(0.22, 0.55, surface.b)).mul(float(1).sub(smooth(0.2, 0.6, surface.a))).mul(float(1).sub(smooth(0.3, 0.46, slope)))

export function Landscape({ world, tier, wind, sun, bark, handle }: { world: ValleyWorld; tier: Tier; wind: Wind; sun: SunLight; bark: BarkSet; handle: { current: LandscapeHandle | null } }) {
  const gl = useThree(state => state.gl)
  const scene = useThree(state => state.scene)
  const camera = useThree(state => state.camera)
  const settings = tiers[tier]
  const sunState = useMemo(() => ({ direction: new Vector3(0.4, 0.8, 0.3).normalize(), color: new Color(1, 0.95, 0.85) }), [])

  const [built, setBuilt] = useState<{ terrain: Terrain; cover: Cover; forest: Forest } | null>(null)

  useEffect(() => {
    const uniforms = terrainUniforms(world.sources)
    const cover = createCover({
      terrain: uniforms,
      wind,
      heightAt: world.heightAt,
      sun: sunState,
      distance: settings.coverDistance,
      near: settings.coverNear,
      density: settings.coverDensity,
      alphaToCoverage: settings.a2c,
      families: [
        { name: 'sward', shape: 'clump', perPatch: 1800, mask: meadow, height: ({ root }) => mix(0.55, 1.45, smooth(0.25, 0.8, landscapeNoise(root.mul(0.022), 81))), size: [0.05, 0.11], width: 2.3, quads: 2, texture: grassTexture(128, 29), colors: [[0.44, 0.6, 0.25], [0.76, 0.69, 0.4], [0.6, 0.66, 0.34]], bend: 0.3, translucency: 0.35, ao: 0.72, roughness: 0.85, fade: 0.32 },
        { name: 'tall', shape: 'clump', perPatch: 430, mask: sample => meadow(sample).mul(clamp(float(0.06).add(smooth(0.44, 0.64, landscapeNoise(sample.root.mul(0.04), 83).mul(0.65).add(landscapeNoise(sample.root.mul(0.13), 89).mul(0.35)))).add(smooth(0.06, 0.3, sample.surface.b).mul(0.9)).add(smooth(0.5, 0.7, landscapeNoise(sample.root.mul(0.05), 87)).mul(0.7)), 0, 1)), height: ({ root, surface }) => mix(0.75, 1.2, landscapeNoise(root.mul(0.03), 85)).mul(float(1).add(smooth(0.06, 0.3, surface.b).mul(0.35))), size: [0.34, 0.7], width: 0.75, quads: 3, texture: grassTexture(), colors: [[0.54, 0.62, 0.3], [0.8, 0.72, 0.42], [0.9, 0.82, 0.55]], bend: 0.42, translucency: 0.4, ao: 0.55, roughness: 0.82 },
        { name: 'flowers', shape: 'flower', perPatch: 60, mask: sample => meadow(sample).mul(float(0.3).add(smooth(0.45, 0.7, landscapeNoise(sample.root.mul(0.045), 71)).mul(0.7))), size: [0.16, 0.3], width: 0.4, texture: flowerTexture(), colors: [[1, 0.84, 0.3], [1, 1, 1], [0.78, 0.62, 1]], bend: 0.3, translucency: 0.25, ao: 0.6, fade: 0.24 },
        { name: 'stones', shape: 'pebble', perPatch: 3, mask: sample => meadow(sample).mul(smooth(0.52, 0.78, landscapeNoise(sample.root.mul(0.05), 87))), size: [0.18, 0.5], colors: [[0.56, 0.54, 0.5], [0.66, 0.63, 0.58], [0.48, 0.46, 0.42]], ao: 1, fade: 0.18, roughness: 0.8 },
        { name: 'understory', shape: 'clump', perPatch: 70, mask: ({ root, surface }) => smooth(0.35, 0.7, surface.b).mul(smooth(0.35, 0.6, landscapeNoise(root.mul(0.06), 73))).mul(float(1).sub(surface.a)), size: [0.35, 0.65], width: 1.1, quads: 3, texture: grassTexture(256, 19), colors: [[0.42, 0.5, 0.26], [0.55, 0.58, 0.3], [0.7, 0.62, 0.36]], bend: 0.3, translucency: 0.3, ao: 0.35, fade: 0.22 },
        { name: 'litter', shape: 'card', perPatch: 54, mask: ({ surface }) => smooth(0.3, 0.65, surface.b).mul(float(1).sub(surface.a)), size: [0.5, 0.95], texture: litterTexture(), colors: [[0.9, 0.82, 0.72], [0.8, 0.7, 0.55], [1, 0.82, 0.6]], ao: 1, fade: 0.18 },
        { name: 'pebbles', shape: 'pebble', perPatch: 16, mask: ({ surface, slope }) => max(surface.a.mul(0.9), smooth(0.3, 0.48, slope).mul(0.8)).add(0.06), size: [0.06, 0.24], colors: [[0.5, 0.48, 0.45], [0.62, 0.6, 0.56], [0.42, 0.4, 0.37]], ao: 1, fade: 0.16, roughness: 0.75 },
      ],
    })
    const terrain = createTerrain({
      sources: world.sources,
      uniforms,
      layers: world.layers,
      layerSpecs: [
        { tile: 3.2, tint: [0.36, 0.48, 0.2], roughness: 0.95, normalScale: 0.8 },
        { tile: 2.6, tint: [0.4, 0.4, 0.28], roughness: 0.92, normalScale: 1 },
        { tile: 2.2, tint: [0.92, 0.84, 0.72], roughness: 0.9, normalScale: 1 },
        { tile: 3.5, tint: [0.86, 0.84, 0.8], roughness: 0.85, normalScale: 1.2 },
      ],
      canopy: { height: canopy.height, start: settings.impostorFar[0] - canopy.lead, end: settings.impostorFar[1] - canopy.lead, crown: canopy.crown, color: [0.125, 0.15, 0.03], shade: [0.004, 0.007, 0.009], dither: tier === 'low' },
      detailDistance: tier === 'low' ? 140 : 260,
      cover,
      shadowDistance: settings.shadowDistance,
    })
    const species = [
      { model: generateTree(BROADLEAF), textures: { bark: bark.pine.color, barkNormal: bark.pine.normal, leaf: leafClusterTexture(256, 41) }, scale: [0.8, 1.25] as const },
      { model: generateTree(PINE), textures: { bark: bark.pine.color, barkNormal: bark.pine.normal, leaf: needleClusterTexture() }, scale: [0.75, 1.3] as const },
      { model: generateTree(BIRCH), textures: { bark: bark.pine.color, barkNormal: bark.pine.normal, leaf: leafClusterTexture(256, 47, [[132, 146, 64], [150, 160, 72], [112, 128, 52], [170, 168, 84]]) }, scale: [0.8, 1.2] as const },
      { model: generateTree(SHRUB), textures: { bark: bark.pine.color, barkNormal: bark.pine.normal, leaf: leafClusterTexture(256, 53, [[96, 116, 44], [114, 130, 52], [82, 100, 38], [128, 138, 60]]) }, scale: [0.7, 1.35] as const },
    ]
    const forest = createForest({
      renderer: gl as unknown as WebGPURenderer,
      wind,
      species,
      density: world.forest,
      choose: (x, z, random) => {
        const density = world.forest(x, z)
        const height = world.heightAt(x, z)
        const shrub = 0.14 + 0.42 * (1 - smoothstep(0.4, 0.85, density))
        if (random < shrub) return 3
        const rest = (random - shrub) / (1 - shrub)
        if (density < 0.55 && rest < 0.3) return 2
        const stand = smoothstep(0.58, 0.78, valueNoise(x / 110, z / 110, 509))
        return rest < 0.1 + 0.25 * smoothstep(140, 320, height) + 0.55 * stand ? 1 : 0
      },
      priority: (x, z) => 0.22 + 0.78 * smoothstep(260, 900, Math.hypot(x, z)),
      heightAt: world.heightAt,
      bounds: { min: [-980, -980], max: [980, 980] },
      spacing: 5.2,
      count: settings.trees,
      near: settings.nearFade,
      far: settings.impostorFar,
      shadowDistance: settings.shadowDistance,
      frameSize: settings.frameSize,
      impostorBlur: settings.impostorBlur,
      impostorFarTint: [1.2, 1.18, 0.98],
      alphaToCoverage: settings.a2c,
      singleFrame: settings.singleFrame,
      sun: sunState,
    })
    scene.add(terrain.object, cover.object, forest.object)
    const result = { terrain, cover, forest }
    handle.current = result
    setBuilt(result)
    return () => {
      scene.remove(terrain.object, cover.object, forest.object)
      handle.current = null
      setBuilt(null)
      terrain.dispose()
      cover.dispose()
      forest.dispose()
    }
  }, [bark, camera, gl, handle, scene, settings, sun, sunState, tier, wind, world])

  useFrame((_, delta) => {
    if (!built) return
    const { terrain, cover, forest } = built
    wind.update(delta)
    sunState.direction.copy(sun.position).normalize()
    sunState.color.copy(sun.color).multiplyScalar(sun.intensity * 0.3)
    camera.updateMatrixWorld()
    terrain.setSunDirection(sunState.direction)
    terrain.update(camera)
    cover.update(camera)
    forest.update(camera)
  }, 0.5)

  return null
}
