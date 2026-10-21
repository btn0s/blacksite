import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { createTerrain, type Terrain } from '@blacksite/landscape'
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

export function Landscape({ terrain }: { terrain: Terrain }) {
  const scene = useThree(state => state.scene)
  const camera = useThree(state => state.camera)
  useEffect(() => {
    scene.add(terrain.object)
    return () => { scene.remove(terrain.object); terrain.dispose() }
  }, [scene, terrain])
  useFrame(() => {
    camera.updateMatrixWorld()
    terrain.update(camera)
  }, 0.5)
  return null
}
