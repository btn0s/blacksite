import { Frustum, Group, IndirectStorageBufferAttribute, Matrix4, Mesh, Vector4, WebGPUCoordinateSystem } from 'three/webgpu'
import type { Node, OrthographicCamera, Vector2, WebGPURenderer } from 'three/webgpu'
import { bool, float, vec3, uniform, uniformArray } from 'three/tsl'
import { type packScene } from './runtime-data'
import { ClusterTraversal } from './runtime-traversal'
import { createGeometryShadowMaterial } from './runtime-material'
import { clusterGeometry, clusterVertex } from './runtime-vertex'

export class ClusterShadows {
  readonly object = new Group()
  private readonly counters: IndirectStorageBufferAttribute
  private readonly frustum = new Frustum()
  private readonly viewProjection = new Matrix4()
  private readonly planes = uniformArray(Array.from({ length: 6 }, () => new Vector4()))
  private readonly projectionScale = uniform(1)
  private readonly threshold = uniform(1)
  private readonly traversal: ClusterTraversal
  private readonly hierarchyDepth: number
  readonly residentBytes: number

  constructor(packed: ReturnType<typeof packScene>, world: Node<'mat4'>, worldScale: Node<'float'>, layer: number, capacity: number) {
    if (!Number.isInteger(layer) || layer < 0 || layer > 31) throw new Error('Shadow layer must be an integer between 0 and 31')
    this.object.name = 'Cluster sun-shadow selection'
    this.hierarchyDepth = packed.hierarchyDepth
    this.traversal = new ClusterTraversal(packed, capacity, world, worldScale, this.planes,
      (_sphere, error, scale) => error.mul(scale).mul(worldScale).mul(this.projectionScale),
      this.threshold, bool(true), float(0), vec3(0), () => bool(false), () => bool(false), 'Shadow')
    this.counters = this.traversal.counters
    this.residentBytes = this.traversal.residentBytes
    for (let index = 0; index < packed.batches.length; index++) {
      const batch = packed.batches[index]!
      const geometry = clusterGeometry(batch.triangles, capacity, this.counters, index)
      const pulled = clusterVertex(packed, this.traversal.visible, index, this.traversal.offsets)
      const material = createGeometryShadowMaterial(batch.material, pulled.uv, pulled.position)
      const mesh = new Mesh(geometry, material)
      mesh.name = `Cluster shadow ${batch.material.name || index}`
      mesh.layers.set(layer)
      mesh.frustumCulled = false
      mesh.castShadow = true
      mesh.receiveShadow = false
      this.object.add(mesh)
    }
  }

  prepare(renderer: WebGPURenderer, camera: OrthographicCamera, mapSize: Readonly<Vector2>, pixelError: number) {
    if (!this.object.visible) return
    if (!camera.isOrthographicCamera) throw new Error('Cluster sun shadows require an orthographic cascade camera')
    if (!(pixelError > 0)) throw new Error('Cluster shadow pixel error must be positive')
    camera.updateMatrixWorld()
    this.projectionScale.value = mapSize.y * camera.projectionMatrix.elements[5]! * 0.5
    this.threshold.value = pixelError
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.viewProjection, WebGPUCoordinateSystem)
    for (let i = 0; i < 6; i++) {
      const plane = this.frustum.planes[i]!
      this.planes.array[i]!.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant)
    }
    this.traversal.select(renderer, this.hierarchyDepth)
  }

  dispose() {
    for (const child of this.object.children) {
      const mesh = child as Mesh
      mesh.geometry.dispose()
      if (Array.isArray(mesh.material)) mesh.material.forEach(material => material.dispose())
      else mesh.material.dispose()
    }
    this.traversal.dispose()
  }
}
