import type { Camera, Material, MeshStandardMaterial, NodeMaterial, Object3D, WebGPURenderer } from 'three/webgpu'
import { createGeometryDepthMaterial } from './runtime-material'

export class DepthOccluders {
  private readonly materials = new Map<Material, { version: number; depth: ReturnType<typeof createGeometryDepthMaterial> }>()

  render(renderer: WebGPURenderer, camera: Camera, roots: readonly Object3D[]) {
    const previous = renderer.getRenderObjectFunction()
    renderer.setRenderObjectFunction((object, scene, view, geometry, material, group, lights, clipping, passId) => {
      if (material.transparent || !material.depthWrite) return
      let entry = this.materials.get(material)
      if (!entry || entry.version !== material.version) {
        entry?.depth.dispose()
        entry = { version: material.version, depth: createGeometryDepthMaterial(material as MeshStandardMaterial & Partial<NodeMaterial>) }
        this.materials.set(material, entry)
      }
      renderer.renderObject(object, scene, view, geometry, entry.depth, group, lights, clipping, passId)
    })
    try {
      for (const root of roots) {
        root.updateWorldMatrix(true, true)
        renderer.render(root, camera)
      }
    } finally {
      renderer.setRenderObjectFunction(previous)
    }
  }

  dispose() {
    for (const entry of this.materials.values()) entry.depth.dispose()
    this.materials.clear()
  }
}
