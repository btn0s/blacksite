import { useEffect, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { createTerrain, type Terrain } from '@blacksite/landscape'
import type { WebGPULook } from '@blacksite/look/webgpu'
import { landscapeFootprint, landscapeLayerSpecs, type LandscapeAsset } from './landscape-asset'

const shadowDistance = 400

export function Landscape({ asset, look, onError }: { asset: LandscapeAsset; look: WebGPULook; onError(error: unknown): void }) {
  const scene = useThree(state => state.scene)
  const camera = useThree(state => state.camera)
  const [terrain, setTerrain] = useState<Terrain | null>(null)
  useEffect(() => {
    let active = true
    const state: { created: Terrain | null } = { created: null }
    void asset.loadLayers().then(async layers => {
      if (!active) return
      const terrain = state.created = createTerrain({ sources: asset.sources, uniforms: asset.uniforms, layers, layerSpecs: landscapeLayerSpecs, detailDistance: 260, shadowDistance, footprint: landscapeFootprint })
      await look.compile(passes => Promise.all(passes.map(pass => pass.compile(terrain.object))).then(() => undefined))
      if (!active) return
      scene.add(terrain.object)
      setTerrain(terrain)
    }).catch(onError)
    return () => {
      active = false
      setTerrain(null)
      if (state.created) { scene.remove(state.created.object); state.created.dispose() }
    }
  }, [asset, look, onError, scene])
  useFrame(() => {
    if (!terrain) return
    camera.updateMatrixWorld()
    terrain.update(camera)
  }, 0.5)
  return null
}
