import { Matrix4, Quaternion, Euler, Vector3, type Object3D, type PerspectiveCamera, type MeshStandardMaterial } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { MeshletScene, type MeshletModel, type MeshletSceneEntry } from '@blacksite/geometry'
import { hash2 } from '@blacksite/landscape'
import type { ValleyWorld } from './world'
import type { Owned } from './owned'

export function rockPlacements(world: ValleyWorld) {
  const fields = [[-24, -30], [55, -58], [-130, -140], [130, 55], [-230, -265], [240, -210]]
  const boulders: Matrix4[] = []
  const rotation = new Quaternion()
  const position = new Vector3()
  for (let field = 0; field < fields.length; field++) {
    const [cx, cz] = fields[field]
    for (let i = 0; i < 24; i++) {
      const angle = hash2(i, field, 721) * Math.PI * 2
      const radius = Math.sqrt(hash2(i, field, 727)) * 22
      const x = cx + Math.cos(angle) * radius
      const z = cz + Math.sin(angle) * radius
      if (world.pathDistance(x, z) < 3.5) continue
      const size = 0.35 + hash2(i, field, 733) ** 2 * 3.2
      position.set(x, world.heightAt(x, z) - size * 0.12, z)
      rotation.setFromEuler(new Euler((hash2(i, field, 739) - 0.5) * 0.3, angle, (hash2(i, field, 743) - 0.5) * 0.25))
      boulders.push(new Matrix4().compose(position, rotation, new Vector3(size, size, size)))
    }
  }
  const cliffs = [
    [-100.651, -52.902, 0.48, -1.571, -1.22831, -0.552955, -0.690758],
    [149.976, -107.22, 0.6, -2.133, -1.386081, -0.836683, -0.960662],
    [-174.694, -231.864, 0.75, -2.307, -1.900662, 0.482557, 1.844297],
    [228.682, -153.156, 0.85, -2.92, -2.316516, 0.264196, -3.075854],
    [-357.951, 58.319, 0.65, -2.177, -1.504372, -0.90112, -1.918615],
    [143.304, 295.689, 0.55, -1.948, -2.214756, -0.340926, -3.12143],
  ].map(([x, z, scale, heightOffset, rx, ry, rz]) => {
    rotation.setFromEuler(new Euler(rx, ry, rz))
    position.set(x, world.heightAt(x, z) + heightOffset, z)
    return new Matrix4().compose(position, rotation, new Vector3(scale, scale, scale))
  })
  return { boulders, cliffs }
}

export function createRocks(owned: Owned, world: ValleyWorld, renderer: WebGPURenderer) {
  const placements = rockPlacements(world)
  const entries: MeshletSceneEntry[] = []
  const add = (model: MeshletModel, transforms: Matrix4[]) => {
    for (const [id, asset] of model.geometries) {
      const local = model.instances.filter(instance => instance.geometry === id)
      entries.push({ asset, materials: model.materials as MeshStandardMaterial[], instances: transforms.flatMap(matrix => local.map(instance => matrix.clone().multiply(instance.matrix))) })
    }
  }
  add(owned.rock, placements.boulders)
  add(owned.cliff, placements.cliffs)
  const geometry = new MeshletScene(entries, { pixelError: 2, occlusion: true, shadowLayer: 2, fallbackDistance: 120 })
  geometry.object.name = 'Valley rocks and cliffs'
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
