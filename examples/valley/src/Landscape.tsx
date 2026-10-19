import { useEffect, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { PerspectiveCamera } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { WebGPULook } from '@blacksite/look/webgpu'
import { createOwnedCover, createForest, createTerrain, smoothstep, terrainUniforms, valueNoise, type Forest, type Terrain, type Wind } from '@blacksite/landscape'
import { site, tiers, type Tier } from './model'
import type { ValleyWorld } from './world'
import type { Owned } from './owned'
import { createRocks, type Rocks } from './rocks'

export type LandscapeHandle = { terrain: Terrain; cover: ReturnType<typeof createOwnedCover>; forest: Forest; rocks: Rocks }

export function Landscape({ world, tier, wind, look, owned, handle }: { world: ValleyWorld; tier: Tier; wind: Wind; look: WebGPULook; owned: Owned; handle: { current: LandscapeHandle | null } }) {
  const gl = useThree(state => state.gl)
  const scene = useThree(state => state.scene)
  const camera = useThree(state => state.camera)
  const settings = tiers[tier]
  const [built, setBuilt] = useState<LandscapeHandle | null>(null)

  useEffect(() => {
    const renderer = gl as unknown as WebGPURenderer
    const uniforms = terrainUniforms(world.sources)
    const path = (x: number, z: number) => smoothstep(1.3, 3, world.pathDistance(x, z))
    const meadow = (x: number, z: number) => (1 - smoothstep(0.25, 0.75, world.forest(x, z))) * path(x, z)
    const understory = (x: number, z: number) => smoothstep(0.2, 0.7, world.forest(x, z)) * path(x, z)
    const cover = createOwnedCover({
      renderer, wind, heightAt: world.heightAt,
      bounds: { min: [-512, -512], max: [512, 512] },
      distance: settings.coverDistance,
      density: settings.coverDensity,
      shadowDistance: Math.min(50, settings.shadowDistance),
      families: [
        { name: 'Meadow grass', model: owned.meadow, density: 4, scale: [0.45, 0.8], mask: meadow, windStrength: 0.18 },
        { name: 'Bunch grass', model: owned.bunch, density: 0.65, scale: [0.5, 0.95], mask: meadow, windStrength: 0.16 },
        { name: 'Dry brome', model: owned.brome, density: 0.4, scale: [0.65, 1.1], mask: meadow, windStrength: 0.2 },
        { name: 'Gooseberry', model: owned.gooseberry, density: 0.02, scale: [0.65, 1.2], mask: understory, windStrength: 0.06 },
        { name: 'Nettle', model: owned.nettle, density: 0.07, scale: [0.65, 1.15], mask: understory, windStrength: 0.1 },
        { name: 'Dock', model: owned.dock, density: 0.04, scale: [0.65, 1.1], mask: (x, z) => path(x, z) * smoothstep(0.55, 0.8, valueNoise(x / 9, z / 9, 71)), windStrength: 0.1 },
        { name: 'Thistle', model: owned.thistle, density: 0.025, scale: [0.6, 1.1], mask: meadow, windStrength: 0.08 },
        { name: 'Ivy', model: owned.ivy, density: 0.055, scale: [0.65, 1.2], mask: understory, windStrength: 0.035 },
      ],
    })
    const terrain = createTerrain({
      sources: world.sources,
      uniforms,
      layers: world.layers,
      layerSpecs: [
        { tile: 3.2, tint: [0.55, 0.65, 0.36], roughness: 0.95, normalScale: 0.8 },
        { tile: 2.6, tint: [0.55, 0.5, 0.4], roughness: 0.92, normalScale: 1 },
        { tile: 2.2, tint: [0.92, 0.84, 0.72], roughness: 0.9, normalScale: 1 },
        { tile: 3.5, tint: [0.86, 0.84, 0.8], roughness: 0.85, normalScale: 1.2 },
      ],
      detailDistance: tier === 'low' ? 140 : 260,
      cover,
      shadowDistance: settings.shadowDistance,
    })
    const forestHalfExtent = site.forestExtent / 2
    const forest = createForest({
      renderer, wind,
      species: [
        { model: owned.birch, scale: [0.8, 1.2] },
        { model: owned.pine, lod: owned.pineLod, scale: [0.9, 1.5] },
      ],
      density: world.forest,
      choose: (x, z, random) => random < 0.25 + 0.5 * smoothstep(0.4, 0.75, valueNoise(x / 110, z / 110, 509)) ? 1 : 0,
      priority: (x, z) => 0.22 + 0.78 * smoothstep(260, 900, Math.hypot(x, z)),
      heightAt: world.heightAt,
      bounds: { min: [-forestHalfExtent, -forestHalfExtent], max: [forestHalfExtent, forestHalfExtent] },
      spacing: 5.2,
      count: settings.trees,
      near: settings.nearFade,
      far: settings.impostorFar,
      shadowDistance: settings.shadowDistance,
      frameSize: settings.frameSize,
      impostorBlur: settings.impostorBlur,
      impostorFarTint: [1, 1, 1],
      alphaToCoverage: false,
      singleFrame: settings.singleFrame,
    })
    const rocks = createRocks(owned, world, renderer)
    const unsubscribe = look.onBeforeShadow((shadowRenderer, shadowCamera, mapSize) => {
      forest.prepareShadow(shadowRenderer, shadowCamera)
      cover.prepareShadow(shadowRenderer, shadowCamera)
      rocks.geometry.prepareShadow(shadowRenderer, shadowCamera, mapSize)
    })
    scene.add(terrain.object, cover.object, forest.object, rocks.object)
    const result = { terrain, cover, forest, rocks }
    handle.current = result
    setBuilt(result)
    return () => {
      unsubscribe()
      scene.remove(terrain.object, cover.object, forest.object, rocks.object)
      handle.current = null
      setBuilt(null)
      terrain.dispose()
      cover.dispose()
      forest.dispose()
      rocks.dispose()
    }
  }, [owned, gl, handle, look, scene, settings, tier, wind, world])

  useFrame((_, delta) => {
    if (!built) return
    const { terrain, cover, forest, rocks } = built
    wind.update(delta)
    camera.updateMatrixWorld()
    terrain.update(camera)
    cover.update(camera)
    forest.update(camera)
    rocks.update(camera as PerspectiveCamera, [terrain.object, forest.object])
  }, 0.5)

  return null
}
