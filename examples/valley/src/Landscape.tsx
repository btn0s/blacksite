import { useEffect, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Texture } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { float, smoothstep } from 'three/tsl'
import type { WebGPULook } from '@blacksite/look/webgpu'
import {
  BIRCH, PINE, createCover, createForest, createTerrain, createWater, flowerTexture, generateTree, grassTexture, leafClusterTexture, needleClusterTexture,
  terrainUniforms, treeFoliage, valueNoise, type CoverMask, type Cover, type Forest, type Terrain, type Water, type Wind,
} from '@blacksite/landscape'
import { tiers, type Tier } from './model'
import type { ValleyWorld } from './world'

export type LandscapeHandle = { terrain: Terrain; water: Water; cover: Cover; forest: Forest; frozen: boolean }

export type BarkSet = { pine: { color: Texture; normal: Texture } }

const slopeLimit = (slope: Parameters<CoverMask>[0]['slope']) => float(1).sub(smoothstep(0.3, 0.46, slope))

export function Landscape({ world, tier, wind, look, bark, handle }: { world: ValleyWorld; tier: Tier; wind: Wind; look: WebGPULook; bark: BarkSet; handle: { current: LandscapeHandle | null } }) {
  const gl = useThree(state => state.gl)
  const scene = useThree(state => state.scene)
  const camera = useThree(state => state.camera)
  const settings = tiers[tier]
  const [built, setBuilt] = useState<Omit<LandscapeHandle, 'frozen'> | null>(null)

  useEffect(() => {
    const renderer = gl as unknown as WebGPURenderer
    const uniforms = terrainUniforms(world.sources)
    const dry = (ground: Parameters<CoverMask>[0]['ground']) => smoothstep(world.seaLevel + 2, world.seaLevel + 6, ground)
    const meadow: CoverMask = ({ surface, slope, ground }) => float(1).sub(surface.b.mul(0.8)).mul(float(1).sub(surface.a)).mul(slopeLimit(slope)).mul(dry(ground))
    const cover = createCover({
      terrain: uniforms,
      wind,
      heightAt: world.heightAt,
      distance: settings.coverDistance,
      near: settings.coverNear,
      density: settings.coverDensity,
      alphaToCoverage: settings.a2c,
      families: [
        { name: 'sward', shape: 'clump', perPatch: 1800, mask: meadow, size: [0.05, 0.11], width: 2.3, quads: 2, texture: grassTexture(128, 29), colors: [[0.44, 0.6, 0.25], [0.76, 0.69, 0.4], [0.6, 0.66, 0.34]], bend: 0.3, translucency: 0.35, ao: 0.72, roughness: 0.85, fade: 0.32 },
        { name: 'tall', shape: 'clump', perPatch: 430, mask: sample => meadow(sample).mul(0.15), size: [0.34, 0.7], width: 0.75, quads: 3, texture: grassTexture(), colors: [[0.54, 0.62, 0.3], [0.8, 0.72, 0.42], [0.9, 0.82, 0.55]], bend: 0.42, translucency: 0.4, ao: 0.55, roughness: 0.82 },
        { name: 'flowers', shape: 'flower', perPatch: 60, mask: sample => meadow(sample).mul(0.35), size: [0.16, 0.3], width: 0.4, texture: flowerTexture(), colors: [[1, 0.84, 0.3], [1, 1, 1], [0.78, 0.62, 1]], bend: 0.3, translucency: 0.25, ao: 0.6, fade: 0.24 },
        { name: 'pebbles', shape: 'pebble', perPatch: 16, mask: ({ surface, slope }) => surface.a.mul(0.9).max(smoothstep(0.3, 0.48, slope).mul(0.8)).add(0.04), size: [0.06, 0.24], colors: [[0.5, 0.48, 0.45], [0.62, 0.6, 0.56], [0.42, 0.4, 0.37]], ao: 1, fade: 0.16, roughness: 0.75 },
      ],
    })
    const terrain = createTerrain({
      sources: world.sources,
      uniforms,
      layers: world.layers,
      layerSpecs: [
        { tile: 3.2, tint: [0.4, 0.52, 0.24], roughness: 0.95, normalScale: 0.8 },
        { tile: 2.6, tint: [0.55, 0.5, 0.4], roughness: 0.92, normalScale: 1 },
        { tile: 2.8, tint: [0.95, 0.9, 0.82], roughness: 0.9, normalScale: 1 },
        { tile: 3.6, tint: [0.95, 0.93, 0.88], roughness: 0.85, normalScale: 1.1 },
      ],
      detailDistance: tier === 'low' ? 140 : 260,
      cover,
      shadowDistance: settings.shadowDistance,
    })
    const water = createWater({ layout: world.water, uniforms })
    const pine = treeFoliage(generateTree(PINE), { bark: bark.pine.color, barkNormal: bark.pine.normal, leaf: needleClusterTexture() })
    const birch = treeFoliage(generateTree(BIRCH), { bark: bark.pine.color, barkNormal: bark.pine.normal, leaf: leafClusterTexture(256, 47, [[132, 146, 64], [150, 160, 72], [112, 128, 52], [170, 168, 84]]) })
    const near = world.sources.near
    const forest = createForest({
      renderer, wind,
      species: [
        { model: pine, scale: [1.2, 1.9], tint: { low: [0.8, 0.9, 0.9], high: [1.1, 1.08, 0.88], patchSize: 110, seed: 167 } },
        { model: birch, scale: [1, 1.5], tint: { low: [0.95, 0.92, 0.7], high: [1.15, 1.1, 0.9], patchSize: 110, seed: 163 } },
      ],
      density: world.forest,
      choose: (x, z, random) => random < 0.3 + 0.55 * valueNoise(x / 140, z / 140, 509) ? 0 : 1,
      heightAt: world.heightAt,
      bounds: { min: [near.origin[0], near.origin[1]], max: [near.origin[0] + near.extent, near.origin[1] + near.extent] },
      spacing: 5.2,
      count: settings.trees,
      near: settings.nearFade,
      far: settings.impostorFar,
      shadowDistance: settings.shadowDistance,
      frameSize: settings.frameSize,
      impostorBlur: settings.impostorBlur,
      alphaToCoverage: false,
      singleFrame: settings.singleFrame,
    })
    const subscription = look.onBeforeShadow((shadowRenderer, shadowCamera) => forest.prepareShadow(shadowRenderer, shadowCamera))
    scene.add(terrain.object, water.object, cover.object, forest.object)
    const far = world.sources.far
    look.setGroundExtent(far.origin, [far.origin[0] + far.extent, far.origin[1] + far.extent], 2500)
    const result = { terrain, water, cover, forest }
    handle.current = { ...result, frozen: false }
    setBuilt(result)
    return () => {
      subscription()
      scene.remove(terrain.object, water.object, cover.object, forest.object)
      handle.current = null
      setBuilt(null)
      terrain.dispose()
      water.dispose()
      cover.dispose()
      forest.dispose()
      pine.dispose()
      birch.dispose()
    }
  }, [bark, gl, handle, look, scene, settings, tier, wind, world])

  useFrame((_, delta) => {
    if (!built) return
    wind.frozen = handle.current?.frozen ?? false
    wind.update(delta)
    camera.updateMatrixWorld()
    built.terrain.update(camera)
    built.cover.update(camera)
    built.forest.update(camera)
  }, 0.5)

  return null
}
