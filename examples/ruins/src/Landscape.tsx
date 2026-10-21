import { useEffect, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { createTerrain, terrainUniforms, type Terrain } from '@blacksite/landscape'
import type { WebGPULook } from '@blacksite/look/webgpu'
import { landscapeLayerSpecs, type LandscapeAsset } from './landscape-asset'

const shadowDistance = 400

export function Landscape({ asset, look, onError }: { asset: LandscapeAsset; look: WebGPULook; onError(error: unknown): void }) {
  const scene = useThree(state => state.scene)
  const camera = useThree(state => state.camera)
  const [terrain, setTerrain] = useState<Terrain | null>(null)
  useEffect(() => {
    let active = true
    const created = createTerrain({ sources: asset.sources, uniforms: terrainUniforms(asset.sources), layers: asset.layers, layerSpecs: landscapeLayerSpecs, detailDistance: 260, shadowDistance })
    void look.compile(passes => Promise.all(passes.map(pass => pass.compile(created.object))).then(() => undefined)).then(() => {
      if (!active) return
      scene.add(created.object)
      setTerrain(created)
    }).catch(onError)
    return () => {
      active = false
      scene.remove(created.object)
      setTerrain(null)
      created.dispose()
    }
  }, [asset, look, onError, scene])
  useFrame(() => {
    if (!terrain) return
    camera.updateMatrixWorld()
    terrain.update(camera)
  }, 0.5)
  return null
}
