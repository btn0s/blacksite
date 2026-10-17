import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Color, DirectionalLight, PerspectiveCamera, Vector3 } from 'three'
import {
  BIRCH, OAK, PINE, createCover, createForest, createSunShadows, createTerrain, flowerTexture, generateTree, grassTexture, leafClusterTexture,
  litterTexture, needleClusterTexture, smoothstep, valueNoise, type Cover, type Forest, type SunShadows, type Terrain, type Wind,
} from '@blacksite/landscape'
import type { Texture } from 'three'
import { canopy, tiers, type Tier } from './model'
import type { ValleyWorld } from './world'

export type LandscapeHandle = { terrain: Terrain; cover: Cover; forest: Forest; shadows: SunShadows; frozen: boolean }

export type BarkSet = { pine: { color: Texture; normal: Texture } }

const BROADLEAF = { ...OAK, crown: 5.6, leafSize: 1.75, leafCount: 780 }
const SHRUB = { ...OAK, name: 'shrub', height: 4.2, trunk: 0.09, crown: 2.5, leafSize: 1.15, leafCount: 340, seed: 19 }
const MEADOW = '(1.0 - smoothstep(0.22, 0.55, bsSurface.b)) * (1.0 - smoothstep(0.2, 0.6, bsSurface.a)) * (1.0 - smoothstep(0.3, 0.46, bsSlope))'

export function Landscape({ world, tier, wind, sun, bark, handle }: { world: ValleyWorld; tier: Tier; wind: Wind; sun: DirectionalLight; bark: BarkSet; handle: { current: LandscapeHandle | null } }) {
  const gl = useThree(state => state.gl)
  const scene = useThree(state => state.scene)
  const camera = useThree(state => state.camera)
  const settings = tiers[tier]
  const sunState = useMemo(() => ({ direction: new Vector3(0.4, 0.8, 0.3).normalize(), color: new Color(1, 0.95, 0.85) }), [])

  const [built, setBuilt] = useState<{ terrain: Terrain; cover: Cover; forest: Forest; shadows: SunShadows } | null>(null)

  useEffect(() => {
    const terrain = createTerrain({
      sources: world.sources,
      layers: world.layers,
      layerSpecs: [
        { tile: 3.2, tint: [0.36, 0.48, 0.2], roughness: 0.95, normalScale: 0.8 },
        { tile: 2.6, tint: [0.4, 0.4, 0.28], roughness: 0.92, normalScale: 1 },
        { tile: 2.2, tint: [0.92, 0.84, 0.72], roughness: 0.9, normalScale: 1 },
        { tile: 3.5, tint: [0.86, 0.84, 0.8], roughness: 0.85, normalScale: 1.2 },
      ],
      canopy: { height: canopy.height, start: settings.impostorFar[0] - canopy.lead, end: settings.impostorFar[1] - canopy.lead, crown: canopy.crown, color: [0.125, 0.15, 0.03], shade: [0.004, 0.007, 0.009], dither: tier === 'low' },
      detailDistance: tier === 'low' ? 140 : 260,
      coverShade: { distance: settings.coverDistance, strength: 0.4 },
      shadowDistance: settings.shadowDistance,
    })
    const cover = createCover({
      terrain: terrain.uniforms,
      wind,
      heightAt: world.heightAt,
      sun: sunState,
      distance: settings.coverDistance,
      density: settings.coverDensity,
      alphaToCoverage: settings.a2c,
      families: [
        { name: 'sward', shape: 'clump', perPatch: 1800, mask: MEADOW, height: 'mix(0.55, 1.45, smoothstep(0.25, 0.8, bsNoise(bsRoot * 0.022, 81u)))', size: [0.05, 0.11], width: 2.3, quads: 2, texture: grassTexture(128, 29), colors: [[0.44, 0.6, 0.25], [0.76, 0.69, 0.4], [0.6, 0.66, 0.34]], bend: 0.3, translucency: 0.35, ao: 0.72, roughness: 0.85 },
        { name: 'tall', shape: 'clump', perPatch: 430, mask: `${MEADOW} * clamp(0.06 + smoothstep(0.44, 0.64, bsNoise(bsRoot * 0.04, 83u) * 0.65 + bsNoise(bsRoot * 0.13, 89u) * 0.35) + smoothstep(0.06, 0.3, bsSurface.b) * 0.9 + smoothstep(0.5, 0.7, bsNoise(bsRoot * 0.05, 87u)) * 0.7, 0.0, 1.0)`, height: 'mix(0.75, 1.2, bsNoise(bsRoot * 0.03, 85u)) * (1.0 + 0.35 * smoothstep(0.06, 0.3, bsSurface.b))', size: [0.34, 0.7], width: 0.75, quads: 3, texture: grassTexture(), colors: [[0.54, 0.62, 0.3], [0.8, 0.72, 0.42], [0.9, 0.82, 0.55]], bend: 0.42, translucency: 0.4, ao: 0.55, roughness: 0.82 },
        { name: 'flowers', shape: 'flower', perPatch: 60, mask: `${MEADOW} * (0.3 + 0.7 * smoothstep(0.45, 0.7, bsNoise(bsRoot * 0.045, 71u)))`, size: [0.16, 0.3], width: 0.4, texture: flowerTexture(), colors: [[1, 0.84, 0.3], [1, 1, 1], [0.78, 0.62, 1]], bend: 0.3, translucency: 0.25, ao: 0.6, fade: 0.8 },
        { name: 'stones', shape: 'pebble', perPatch: 3, mask: `${MEADOW} * smoothstep(0.52, 0.78, bsNoise(bsRoot * 0.05, 87u))`, size: [0.18, 0.5], colors: [[0.56, 0.54, 0.5], [0.66, 0.63, 0.58], [0.48, 0.46, 0.42]], ao: 1, fade: 0.6, roughness: 0.8 },
        { name: 'understory', shape: 'clump', perPatch: 70, mask: 'smoothstep(0.35, 0.7, bsSurface.b) * smoothstep(0.35, 0.6, bsNoise(bsRoot * 0.06, 73u)) * (1.0 - bsSurface.a)', size: [0.35, 0.65], width: 1.1, quads: 3, texture: grassTexture(256, 19), colors: [[0.42, 0.5, 0.26], [0.55, 0.58, 0.3], [0.7, 0.62, 0.36]], bend: 0.3, translucency: 0.3, ao: 0.35, fade: 0.75 },
        { name: 'litter', shape: 'card', perPatch: 54, mask: 'smoothstep(0.3, 0.65, bsSurface.b) * (1.0 - bsSurface.a)', size: [0.5, 0.95], texture: litterTexture(), colors: [[0.9, 0.82, 0.72], [0.8, 0.7, 0.55], [1, 0.82, 0.6]], ao: 1, fade: 0.6 },
        { name: 'pebbles', shape: 'pebble', perPatch: 16, mask: 'max(bsSurface.a * 0.9, smoothstep(0.3, 0.48, bsSlope) * 0.8) + 0.06', size: [0.06, 0.24], colors: [[0.5, 0.48, 0.45], [0.62, 0.6, 0.56], [0.42, 0.4, 0.37]], ao: 1, fade: 0.55, roughness: 0.75 },
      ],
    })
    const species = [
      { model: generateTree(BROADLEAF), textures: { bark: bark.pine.color, barkNormal: bark.pine.normal, leaf: leafClusterTexture(256, 41) }, scale: [0.8, 1.25] as const },
      { model: generateTree(PINE), textures: { bark: bark.pine.color, barkNormal: bark.pine.normal, leaf: needleClusterTexture() }, scale: [0.75, 1.3] as const },
      { model: generateTree(BIRCH), textures: { bark: bark.pine.color, barkNormal: bark.pine.normal, leaf: leafClusterTexture(256, 47, [[132, 146, 64], [150, 160, 72], [112, 128, 52], [170, 168, 84]]) }, scale: [0.8, 1.2] as const },
      { model: generateTree(SHRUB), textures: { bark: bark.pine.color, barkNormal: bark.pine.normal, leaf: leafClusterTexture(256, 53, [[96, 116, 44], [114, 130, 52], [82, 100, 38], [128, 138, 60]]) }, scale: [0.7, 1.35] as const },
    ]
    const forest = createForest({
      renderer: gl,
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
      alphaToCoverage: settings.a2c,
      singleFrame: settings.singleFrame,
      sun: sunState,
    })
    const shadows = createSunShadows({ camera: camera as PerspectiveCamera, parent: scene, cascades: settings.cascades, distance: settings.shadowDistance, mapSize: settings.shadowMap })
    shadows.follow(sun)
    scene.add(terrain.object, cover.object, forest.object)
    shadows.track(scene)
    const result = { terrain, cover, forest, shadows }
    handle.current = { ...result, frozen: false }
    setBuilt(result)
    return () => {
      scene.remove(terrain.object, cover.object, forest.object)
      handle.current = null
      setBuilt(null)
      shadows.dispose()
      terrain.dispose()
      cover.dispose()
      forest.dispose()
    }
  }, [bark, camera, gl, handle, scene, settings, sun, sunState, tier, wind, world])

  const frame = useRef(0)
  useFrame((_, delta) => {
    if (!built) return
    const { terrain, cover, forest, shadows } = built
    wind.frozen = handle.current?.frozen ?? false
    wind.update(delta)
    sunState.direction.copy(sun.position).sub(sun.target.position).normalize()
    sunState.color.copy(sun.color).multiplyScalar(sun.intensity * 0.3)
    camera.updateMatrixWorld()
    terrain.update(camera)
    cover.update(camera)
    forest.update(camera)
    shadows.update()
    if (++frame.current % 90 === 0) shadows.track(scene)
  }, 0.5)

  return null
}
