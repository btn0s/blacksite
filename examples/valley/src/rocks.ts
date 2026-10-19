import { Matrix4, type Object3D, type PerspectiveCamera, type MeshStandardMaterial } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { MeshletScene, type MeshletModel, type MeshletSceneEntry } from '@blacksite/geometry'
import type { Stonework, RuinPiece } from './stonework'
import type { Owned } from './owned'

export function createRocks(owned: Owned, stones: Stonework, renderer: WebGPURenderer) {
  const entries: MeshletSceneEntry[] = []
  const add = (model: MeshletModel, transforms: Matrix4[]) => {
    if (!transforms.length) return
    for (const [id, asset] of model.geometries) {
      const local = model.instances.filter(instance => instance.geometry === id)
      entries.push({ asset, materials: model.materials as MeshStandardMaterial[], instances: transforms.flatMap(matrix => local.map(instance => matrix.clone().multiply(instance.matrix))) })
    }
  }
  for (const id of Object.keys(stones.pieces) as RuinPiece[]) add(owned.ruins[id].model, stones.pieces[id])
  const geometry = new MeshletScene(entries, { pixelError: 2, occlusion: true, shadowLayer: 2, fallbackDistance: 120 })
  geometry.object.name = 'Valley stonework'
  const stats = { sceneTriangles: 0, drawnTriangles: 0, totalTriangles: geometry.totalTriangles, candidateClusters: geometry.candidateClusters, visibleClusters: 0, occludedClusters: 0, submittedTriangles: 0 }
  let pending = false
  let lastRead = 0
  let disposed = false
  return {
    object: geometry.object,
    geometry,
    stats,
    setLodView: (enabled: boolean) => geometry.setDebugView(enabled ? 'meshlets' : 'normal'),
    setLodEnabled: (enabled: boolean) => geometry.setLodEnabled(enabled),
    setOcclusionEnabled: (enabled: boolean) => { geometry.occlusionEnabled = enabled; geometry.resetHistory() },
    setShadowEnabled: (enabled: boolean) => geometry.setShadowEnabled(enabled),
    update(camera: PerspectiveCamera, occluders: readonly Object3D[]) {
      geometry.prepare(renderer, camera, { occluders })
      const now = performance.now()
      if (!pending && now - lastRead > 300) {
        pending = true
        lastRead = now
        void geometry.readStats(renderer).then(next => { if (!disposed) Object.assign(stats, next) }).finally(() => { pending = false })
      }
    },
    dispose() { disposed = true; geometry.dispose() },
  }
}

export type Rocks = ReturnType<typeof createRocks>
