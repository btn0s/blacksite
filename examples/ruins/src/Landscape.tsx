import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { createTerrain, createWater, type Terrain, type Water } from '@blacksite/landscape'
import { landscapeFootprint, landscapeLayerSpecs, type LandscapeAsset } from './landscape-asset'

const shadowDistance = 400

// The terrain is built with the level and compiled in the same warm-up, so it is in the first playable frame.
export function useTerrain(asset: LandscapeAsset) {
  return useMemo(() => {
    const terrain = createTerrain({ sources: asset.sources, uniforms: asset.uniforms, layers: asset.layers, layerSpecs: landscapeLayerSpecs, detailDistance: 260, shadowDistance, footprint: landscapeFootprint })
    terrain.object.visible = false
    return terrain
  }, [asset])
}

export function useWater(asset: LandscapeAsset) {
  return useMemo(() => {
    const water = createWater({ layout: asset.water, uniforms: asset.uniforms })
    water.object.visible = false
    return water
  }, [asset])
}

export function Landscape({ terrain, water }: { terrain: Terrain; water: Water }) {
  const scene = useThree(state => state.scene)
  const camera = useThree(state => state.camera)
  useEffect(() => {
    scene.add(terrain.object, water.object)
    return () => { scene.remove(terrain.object, water.object); terrain.dispose(); water.dispose() }
  }, [scene, terrain, water])
  useFrame(() => {
    camera.updateMatrixWorld()
    terrain.update(camera)
  }, 0.5)
  return null
}
