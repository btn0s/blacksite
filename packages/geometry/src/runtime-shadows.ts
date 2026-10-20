import { Frustum, Group, IndirectStorageBufferAttribute, Matrix4, Mesh, StorageBufferAttribute, Vector4, WebGPUCoordinateSystem } from 'three/webgpu'
import type { Node, OrthographicCamera, Vector2, WebGPURenderer } from 'three/webgpu'
import { Fn, If, Loop, atomicAdd, atomicStore, bool, dot, instanceIndex, storage, uint, uniform, uniformArray, vec4 } from 'three/tsl'
import { DRAW_ARGUMENT_OFFSET, uploadAttributes, type PackedMeshletScene } from './runtime-data'
import { clusterReader, instanceReader } from './runtime-layout'
import { createGeometryShadowMaterial } from './runtime-material'
import { clusterGeometry, clusterVertex } from './runtime-vertex'

export class ClusterShadows {
  readonly object = new Group()
  private readonly counters: IndirectStorageBufferAttribute
  private readonly visibleAttribute: StorageBufferAttribute
  private readonly frustum = new Frustum()
  private readonly viewProjection = new Matrix4()
  private readonly planes = uniformArray(Array.from({ length: 6 }, () => new Vector4()))
  private readonly projectionScale = uniform(1)
  private readonly threshold = uniform(1)
  private readonly reset
  private readonly select
  private readonly computes
  private readonly materials = new Set<ReturnType<typeof createGeometryShadowMaterial>>()

  constructor(packed: PackedMeshletScene, world: Node<'mat4'>, worldScale: Node<'float'>, layer: number) {
    if (!Number.isInteger(layer) || layer < 0 || layer > 31) throw new Error('Shadow layer must be an integer between 0 and 31')
    this.object.name = 'Cluster sun-shadow selection'
    const argumentCount = DRAW_ARGUMENT_OFFSET + packed.batches.length * 4
    this.counters = new IndirectStorageBufferAttribute(new Uint32Array(argumentCount), 1)
    const visibleAttribute = this.visibleAttribute = new StorageBufferAttribute(packed.candidateCount, 1, Uint32Array)
    const visible = storage(visibleAttribute, 'uint', packed.candidateCount)
    const counters = storage(this.counters, 'uint', argumentCount).toAtomic()
    const readCluster = clusterReader(packed.clusters)
    const readInstance = instanceReader(packed.instances)
    const candidates = storage(packed.candidates, 'uvec4', packed.candidateCount).toReadOnly()
    this.reset = Fn(() => {
      Loop(argumentCount, ({ i }) => { atomicStore(counters.element(i), uint(0)) })
      for (let i = 0; i < packed.batches.length; i++) atomicStore(counters.element(DRAW_ARGUMENT_OFFSET + i * 4), uint(packed.batches[i]!.triangles * 3))
    })().compute(1).setName('Shadow cluster reset')
    this.select = Fn(() => {
      const candidate = candidates.element(instanceIndex)
      const cluster = readCluster(candidate.x)
      const instance = readInstance(candidate.y)
      const scale = instance.scale.x.mul(worldScale)
      const errorScale = scale.mul(this.projectionScale)
      const ownError = cluster.errors.x.mul(errorScale)
      const parentError = cluster.errors.y.mul(errorScale)
      If(ownError.lessThanEqual(this.threshold).and(parentError.greaterThan(this.threshold)), () => {
        const localBounds = cluster.bounds
        const center = world.mul(instance.transform).mul(vec4(localBounds.xyz, 1)).xyz
        const radius = localBounds.w.mul(scale)
        const inside = bool(true).toVar()
        Loop(6, ({ i }) => {
          const plane = this.planes.element(i)
          If(dot(plane.xyz, center).add(plane.w).lessThan(radius.negate()), () => { inside.assign(false) })
        })
        If(inside, () => {
          const slot = atomicAdd(counters.element(candidate.z.add(1)), uint(1))
          visible.element(candidate.w.add(slot)).assign(instanceIndex)
        })
      })
    })().compute(packed.candidateCount, [64]).setName('Shadow cluster selection')
    this.computes = [this.reset, this.select]
    const pulled = clusterVertex(packed, visibleAttribute)
    const materials = new Map<PackedMeshletScene['batches'][number]['material'], ReturnType<typeof createGeometryShadowMaterial>>()
    for (let index = 0; index < packed.batches.length; index++) {
      const batch = packed.batches[index]!
      const geometry = clusterGeometry(batch.triangles, batch.capacity, this.counters, index)
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
    await uploadAttributes(renderer, [this.counters, this.visibleAttribute])
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
    renderer.compute(this.computes)
  }

  dispose() {
    for (const child of this.object.children) {
      const mesh = child as Mesh
      mesh.geometry.dispose()
    }
    for (const material of this.materials) material.dispose()
    this.reset.dispose()
    this.select.dispose()
  }
}
