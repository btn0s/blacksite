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
        { tile: 3.2, tint: [0.44, 0.5, 0.29], roughness: 0.95, normalScale: 0.8 },
        { tile: 2.6, tint: [0.4, 0.4, 0.28], roughness: 0.92, normalScale: 1 },
        { tile: 2.2, tint: [0.92, 0.84, 0.72], roughness: 0.9, normalScale: 1 },
        { tile: 3.5, tint: [0.86, 0.84, 0.8], roughness: 0.85, normalScale: 1.2 },
      ],
      canopy: { height: canopy.height, start: settings.impostorFar[0] - canopy.lead, end: settings.impostorFar[1] - canopy.lead, crown: canopy.crown, color: [0.095, 0.125, 0.05], shade: [0.022, 0.032, 0.014] },
      detailDistance: tier === 'low' ? 140 : 260,
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
        { name: 'grass', shape: 'clump', perPatch: 420, mask: MEADOW, size: [0.28, 0.62], width: 1.3, quads: 3, texture: grassTexture(), colors: [[0.5, 0.62, 0.3], [0.62, 0.68, 0.36], [0.86, 0.8, 0.5]], bend: 0.42, translucency: 0.4, ao: 0.4, roughness: 0.82 },
        { name: 'sward', shape: 'clump', perPatch: 520, mask: MEADOW, size: [0.13, 0.28], width: 1.5, quads: 2, texture: grassTexture(128, 29), colors: [[0.46, 0.58, 0.28], [0.56, 0.64, 0.32], [0.72, 0.7, 0.42]], bend: 0.3, translucency: 0.35, ao: 0.5, fade: 0.7, roughness: 0.85 },
        { name: 'flowers', shape: 'flower', perPatch: 40, mask: `${MEADOW} * smoothstep(0.52, 0.7, bsNoise(bsRoot * 0.045, 71u))`, size: [0.32, 0.56], width: 0.55, texture: flowerTexture(), colors: [[1, 0.84, 0.3], [1, 1, 1], [1, 0.78, 0.36]], bend: 0.3, translucency: 0.25, ao: 0.6, fade: 0.8 },
        { name: 'understory', shape: 'clump', perPatch: 70, mask: 'smoothstep(0.35, 0.7, bsSurface.b) * smoothstep(0.35, 0.6, bsNoise(bsRoot * 0.06, 73u)) * (1.0 - bsSurface.a)', size: [0.35, 0.65], width: 1.1, quads: 3, texture: grassTexture(256, 19), colors: [[0.42, 0.5, 0.26], [0.55, 0.58, 0.3], [0.7, 0.62, 0.36]], bend: 0.3, translucency: 0.3, ao: 0.35, fade: 0.75 },
        { name: 'litter', shape: 'card', perPatch: 54, mask: 'smoothstep(0.3, 0.65, bsSurface.b) * (1.0 - bsSurface.a)', size: [0.5, 0.95], texture: litterTexture(), colors: [[0.9, 0.82, 0.72], [0.8, 0.7, 0.55], [1, 0.82, 0.6]], ao: 1, fade: 0.6 },
        { name: 'pebbles', shape: 'pebble', perPatch: 16, mask: 'max(bsSurface.a * 0.9, smoothstep(0.3, 0.48, bsSlope) * 0.8) + 0.06', size: [0.06, 0.24], colors: [[0.5, 0.48, 0.45], [0.62, 0.6, 0.56], [0.42, 0.4, 0.37]], ao: 1, fade: 0.55, roughness: 0.75 },
      ],
    })
    const species = [
      { model: generateTree(BROADLEAF), textures: { bark: bark.pine.color, barkNormal: bark.pine.normal, leaf: leafClusterTexture(256, 41) }, scale: [0.8, 1.25] as const },
      { model: generateTree(PINE), textures: { bark: bark.pine.color, barkNormal: bark.pine.normal, leaf: needleClusterTexture() }, scale: [0.75, 1.3] as const },
      { model: generateTree(BIRCH), textures: { bark: bark.pine.color, barkNormal: bark.pine.normal, leaf: leafClusterTexture(256, 47, [[132, 146, 64], [150, 160, 72], [112, 128, 52], [170, 168, 84]]) }, scale: [0.8, 1.2] as const },
    ]
    const forest = createForest({
      renderer: gl,
      wind,
      species,
      density: world.forest,
      choose: (x, z, random) => {
        const density = world.forest(x, z)
        const height = world.heightAt(x, z)
        if (density < 0.55 && random < 0.3) return 2
        const stand = smoothstep(0.58, 0.78, valueNoise(x / 110, z / 110, 509))
        return random < 0.1 + 0.25 * smoothstep(140, 320, height) + 0.55 * stand ? 1 : 0
      },
      heightAt: world.heightAt,
      bounds: { min: [-980, -980], max: [980, 980] },
      spacing: 5.2,
      count: settings.trees,
      near: settings.nearFade,
      far: settings.impostorFar,
      shadowDistance: settings.shadowDistance,
      frameSize: settings.frameSize,
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
