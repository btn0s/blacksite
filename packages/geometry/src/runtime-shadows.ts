import { Frustum, Group, Matrix4, Mesh, Vector4, WebGPUCoordinateSystem } from 'three/webgpu'
import type { Node, OrthographicCamera, Vector2, WebGPURenderer } from 'three/webgpu'
import { bool, float, vec3, uniform, uniformArray } from 'three/tsl'
import type { PackedMeshletScene } from './runtime-data'
import { ClusterTraversal } from './runtime-traversal'
import { createGeometryShadowMaterial } from './runtime-material'
import { clusterGeometry, clusterVertex } from './runtime-vertex'

export class ClusterShadows {
  readonly object = new Group()
  private readonly frustum = new Frustum()
  private readonly viewProjection = new Matrix4()
  private readonly planes = uniformArray(Array.from({ length: 6 }, () => new Vector4()))
  private readonly projectionScale = uniform(1)
  private readonly threshold = uniform(1)
  private readonly traversal: ClusterTraversal
  private readonly hierarchyDepth: number
  private readonly materials = new Set<ReturnType<typeof createGeometryShadowMaterial>>()
  readonly residentBytes: number

  constructor(packed: PackedMeshletScene, world: Node<'mat4'>, worldScale: Node<'float'>, layer: number, triangleBudget: number) {
    if (!Number.isInteger(layer) || layer < 0 || layer > 31) throw new Error('Shadow layer must be an integer between 0 and 31')
    this.object.name = 'Cluster sun-shadow selection'
    this.hierarchyDepth = packed.hierarchyDepth
    this.traversal = new ClusterTraversal(packed, world, worldScale, this.planes,
      (_sphere, error, scale) => error.mul(scale).mul(worldScale).mul(this.projectionScale),
      this.threshold, bool(true), float(0), vec3(0), () => bool(false), () => bool(false),
      triangleBudget, float(Math.max(packed.maximumError, 0.000001) * 1.001).mul(worldScale).mul(this.projectionScale), 'Shadow')
    this.residentBytes = this.traversal.residentBytes
    const pulled = clusterVertex(packed, this.traversal.visible)
    const materials = new Map<PackedMeshletScene['batches'][number]['material'], ReturnType<typeof createGeometryShadowMaterial>>()
    for (let index = 0; index < packed.batches.length; index++) {
      const batch = packed.batches[index]!
      const geometry = clusterGeometry(this.traversal.indices.indices, this.traversal.counters, index)
      let material = materials.get(batch.material)
      if (!material) {
        material = createGeometryShadowMaterial(batch.material, pulled.uv, pulled.position)
        materials.set(batch.material, material)
        this.materials.add(material)
      }
      const mesh = new Mesh(geometry, material)
      pulled.bind(mesh, batch)
      mesh.name = `Cluster shadow ${batch.material.name || index}`
      mesh.layers.set(layer)
      mesh.frustumCulled = false
      mesh.castShadow = true
      mesh.receiveShadow = false
      this.object.add(mesh)
    }
  }

  async upload(renderer: WebGPURenderer) {
    await this.traversal.upload(renderer)
  }

  async readStats(renderer: WebGPURenderer) {
    const values = new Uint32Array(await renderer.getArrayBufferAsync(this.traversal.counters))
    if (values[20]) throw new Error(`Shadow selection exceeded its hierarchy capacity: ${values[20]}`)
    return this.traversal.indices.readStats(values)
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
    }
    for (const material of this.materials) material.dispose()
    this.traversal.dispose()
  }
}
