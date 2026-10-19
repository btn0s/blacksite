import {
  BufferAttribute, DepthTexture, Frustum, Group, IndirectStorageBufferAttribute, InstancedBufferGeometry,
  Matrix4, Mesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial, RenderTarget, Scene,
  StorageBufferAttribute, Vector2, Vector3, Vector4, WebGPUCoordinateSystem,
} from 'three/webgpu'
import type { PerspectiveCamera, WebGPURenderer } from 'three/webgpu'
import {
  Fn, If, Loop, atomicAdd, atomicLoad, atomicStore, bool, ceil, clamp, cos, dot, float,
  floor, instanceIndex, log2, max, min, mix, normalLocal, output, storage, struct,
  textureLoad, uint, uniform, uniformArray, uvec2, vec2, vec3, vec4, vertexIndex, varyingProperty,
} from 'three/tsl'
import { DRAW_ARGUMENT_OFFSET, packScene, validateTransform } from './runtime-data'
import type { MeshletSceneEntry } from './runtime-data'
import { bindGeometryMaterial, createGeometryMaterial } from './runtime-material'

export type { MeshletSceneEntry } from './runtime-data'
export { normalMapWithUV } from './runtime-material'
export type MeshletDebugView = 'normal' | 'meshlets' | 'lod'

export interface MeshletSceneOptions {
  pixelError?: number
  occlusion?: boolean
  occlusionSize?: number
}

export interface MeshletStats {
  candidateClusters: number
  selectedClusters: number
  frustumCulled: number
  previousOccluded: number
  occludedClusters: number
  recoveredClusters: number
  visibleClusters: number
  firstPassClusters: number
  drawnTriangles: number
  submittedTriangles: number
  totalTriangles: number
  materialBatches: number
}

const clusterLayout = struct({ bounds: 'vec4', selfSphere: 'vec4', parentSphere: 'vec4', errors: 'vec4', draw: 'uvec4' }, 'GeometryCluster')
const instanceLayout = struct({ transform: 'mat4', normal: 'mat4', scale: 'vec4' }, 'GeometryInstance')
const vertexLayout = struct({ position: 'vec4', normal: 'vec4' }, 'GeometryVertex')

export class MeshletScene {
  readonly object = new Group()
  readonly meshes: Mesh<InstancedBufferGeometry, MeshStandardNodeMaterial>[] = []
  readonly totalTriangles: number
  readonly candidateClusters: number
  pixelError: number
  occlusionEnabled: boolean
  private readonly depthScene = new Scene()
  private readonly depthMeshes: Mesh<InstancedBufferGeometry, MeshBasicNodeMaterial>[] = []
  private readonly target: RenderTarget
  private readonly counters: IndirectStorageBufferAttribute
  private readonly dispatch = new IndirectStorageBufferAttribute(new Uint32Array(3), 1)
  private readonly viewport = new Vector2()
  private readonly depthSize = uniform(new Vector2(1, 1))
  private readonly frustum = new Frustum()
  private readonly viewProjection = new Matrix4()
  private readonly world = uniform(new Matrix4())
  private readonly worldScale = uniform(1)
  private readonly eye = uniform(new Vector3())
  private readonly projectionScale = uniform(1)
  private readonly threshold = uniform(1)
  private readonly frustumPlanes = uniformArray(Array.from({ length: 6 }, () => new Vector4()))
  private readonly currentView = uniform(new Matrix4())
  private readonly currentProjection = uniform(new Matrix4())
  private readonly previousView = uniform(new Matrix4())
  private readonly previousProjection = uniform(new Matrix4())
  private readonly currentNear = uniform(0.1)
  private readonly previousNear = uniform(0.1)
  private readonly history = uniform(0, 'uint')
  private readonly debug = uniform(0, 'uint')
  private historyValid = false
  private readonly resetCompute
  private readonly cullCompute
  private readonly dispatchCompute
  private readonly recoverCompute
  private readonly pyramidCompute
  private readonly reductionCompute
  private readonly computeNodes

  constructor(entries: readonly MeshletSceneEntry[], options: MeshletSceneOptions = {}) {
    const packed = packScene(entries)
    this.object.name = 'Cluster scene'
    this.pixelError = options.pixelError ?? 2
    this.occlusionEnabled = options.occlusion ?? true
    this.candidateClusters = packed.candidateCount
    this.totalTriangles = packed.totalTriangles
    const pyramidSize = options.occlusionSize ?? 512
    if (pyramidSize < 32 || pyramidSize > 2048 || (pyramidSize & (pyramidSize - 1)) !== 0) {
      throw new Error('Occlusion size must be a power of two between 32 and 2048')
    }
    const argumentCount = DRAW_ARGUMENT_OFFSET + packed.batches.length * 4
    this.counters = new IndirectStorageBufferAttribute(new Uint32Array(argumentCount), 1)
    const visibleAttribute = new StorageBufferAttribute(this.candidateClusters, 1, Uint32Array)
    const rejectedAttribute = new StorageBufferAttribute(this.candidateClusters, 1, Uint32Array)
    const pyramidAttribute = new StorageBufferAttribute((pyramidSize * pyramidSize * 4 - 1) / 3, 1)
    const clusters = storage(packed.clusters, clusterLayout, packed.clusterCount).toReadOnly()
    const instances = storage(packed.instances, instanceLayout, packed.instanceCount).toReadOnly()
    const vertices = storage(packed.vertices, vertexLayout, packed.vertexCount).toReadOnly()
    const indices = storage(packed.indices, 'uint', packed.indexCount).toReadOnly()
    const candidates = storage(packed.candidates, 'uvec4', this.candidateClusters).toReadOnly()
    const visibleWrite = storage(visibleAttribute, 'uint', this.candidateClusters)
    const visibleRead = storage(visibleAttribute, 'uint', this.candidateClusters).toReadOnly()
    const rejectedWrite = storage(rejectedAttribute, 'uint', this.candidateClusters)
    const rejectedRead = storage(rejectedAttribute, 'uint', this.candidateClusters).toReadOnly()
    const counters = storage(this.counters, 'uint', argumentCount).toAtomic()
    const dispatch = storage(this.dispatch, 'uint', 3)
    const pyramidWrite = storage(pyramidAttribute, 'float', pyramidAttribute.count)
    const pyramidRead = storage(pyramidAttribute, 'float', pyramidAttribute.count).toReadOnly()

    const sphereInWorld = Fn(([sphere, transform, scale]) => vec4(
      this.world.mul(transform).mul(vec4(sphere.xyz, 1)).xyz,
      sphere.w.mul(scale).mul(this.worldScale),
    ))

    const projectedError = Fn(([sphere, error, scale]) => {
      const nearest = max(this.eye.sub(sphere.xyz).length().sub(sphere.w), 0.000001)
      return error.mul(scale).mul(this.worldScale).mul(this.projectionScale).div(nearest)
    })

    const isOccluded = Fn(([sphere, view, projection, near]) => {
      const hidden = bool(false).toVar()
      const center = view.mul(vec4(sphere.xyz, 1)).xyz.toVar()
      const nearest = center.z.negate().sub(sphere.w).toVar()
      If(nearest.greaterThan(near), () => {
        const farthest = center.z.negate().add(sphere.w)
        const low = center.xy.sub(vec2(sphere.w))
        const high = center.xy.add(vec2(sphere.w))
        const projectionXY = vec2(projection.element(0).x, projection.element(1).y)
        const projectionOffset = vec2(projection.element(2).x, projection.element(2).y)
        const ndcLow = min(low.div(nearest), low.div(farthest)).mul(projectionXY).sub(projectionOffset)
        const ndcHigh = max(high.div(nearest), high.div(farthest)).mul(projectionXY).sub(projectionOffset)
        const uvLow = vec2(ndcLow.x.mul(0.5).add(0.5), ndcHigh.y.mul(-0.5).add(0.5)).sub(1 / pyramidSize).toVar()
        const uvHigh = vec2(ndcHigh.x.mul(0.5).add(0.5), ndcLow.y.mul(-0.5).add(0.5)).add(1 / pyramidSize).toVar()
        If(uvLow.x.greaterThanEqual(0).and(uvLow.y.greaterThanEqual(0)).and(uvHigh.x.lessThan(1)).and(uvHigh.y.lessThan(1)), () => {
          const extent = max(uvHigh.x.sub(uvLow.x), uvHigh.y.sub(uvLow.y)).mul(pyramidSize)
          const level = uint(clamp(ceil(log2(max(extent, 1))), 0, Math.log2(pyramidSize))).toVar()
          const size = uint(pyramidSize).shiftRight(level).toVar()
          const offset = uint(pyramidSize * pyramidSize).sub(size.mul(size)).div(3).mul(4).toVar()
          const lowPixel = uvec2(floor(uvLow.mul(float(size)))).toVar()
          const highPixel = min(uvec2(floor(uvHigh.mul(float(size)))), uvec2(size.sub(1))).toVar()
          const a = pyramidRead.element(offset.add(lowPixel.y.mul(size)).add(lowPixel.x))
          const b = pyramidRead.element(offset.add(lowPixel.y.mul(size)).add(highPixel.x))
          const c = pyramidRead.element(offset.add(highPixel.y.mul(size)).add(lowPixel.x))
          const d = pyramidRead.element(offset.add(highPixel.y.mul(size)).add(highPixel.x))
          const farDepth = max(max(a, b), max(c, d))
          const clip = projection.mul(vec4(0, 0, nearest.negate(), 1))
          hidden.assign(clip.z.div(clip.w).greaterThan(farDepth.add(0.00005)))
        })
      })
      return hidden
    })

    const appendVisible = Fn(([candidateId, count]) => {
      const candidate = candidates.element(candidateId)
      const slot = atomicAdd(counters.element(candidate.z.add(1)), uint(1))
      visibleWrite.element(candidate.w.add(slot)).assign(candidateId)
      atomicAdd(counters.element(9), count.div(3))
      atomicAdd(counters.element(10), uint(1))
      atomicAdd(counters.element(11), atomicLoad(counters.element(candidate.z)).div(3))
    }, 'void')
    this.resetCompute = Fn(() => {
      Loop(argumentCount, ({ i }) => { atomicStore(counters.element(i), uint(0)) })
      for (let i = 0; i < packed.batches.length; i++) {
        atomicStore(counters.element(DRAW_ARGUMENT_OFFSET + i * 4), uint(packed.batches[i]!.triangles * 3))
      }
    })().compute(1)
    this.cullCompute = Fn(() => {
      const candidate = candidates.element(instanceIndex)
      const cluster = clusters.element(candidate.x)
      const instance = instances.element(candidate.y)
      const scale = instance.get('scale').x
      const ownSphere = sphereInWorld(cluster.get('selfSphere'), instance.get('transform'), scale)
      const parentSphere = sphereInWorld(cluster.get('parentSphere'), instance.get('transform'), scale)
      const ownError = projectedError(ownSphere, cluster.get('errors').x, scale)
      const parentError = projectedError(parentSphere, cluster.get('errors').y, scale)
      If(ownError.lessThanEqual(this.threshold).and(parentError.greaterThan(this.threshold)), () => {
        atomicAdd(counters.element(4), uint(1))
        const bounds = sphereInWorld(cluster.get('bounds'), instance.get('transform'), scale).toVar()
        const inside = bool(true).toVar()
        Loop(6, ({ i }) => {
          const plane = this.frustumPlanes.element(i)
          If(dot(plane.xyz, bounds.xyz).add(plane.w).lessThan(bounds.w.negate()), () => { inside.assign(false) })
        })
        If(inside, () => {
          const hidden = bool(false).toVar()
          If(this.history.greaterThan(0), () => { hidden.assign(isOccluded(bounds, this.previousView, this.previousProjection, this.previousNear)) })
          If(hidden, () => {
            const slot = atomicAdd(counters.element(6), uint(1))
            rejectedWrite.element(slot).assign(instanceIndex)
          }).Else(() => { appendVisible(instanceIndex, cluster.get('draw').y) })
        }).Else(() => { atomicAdd(counters.element(5), uint(1)) })
      })
    })().compute(this.candidateClusters, [64])
    this.dispatchCompute = Fn(() => {
      dispatch.element(0).assign(atomicLoad(counters.element(6)).add(63).div(64))
      dispatch.element(1).assign(1)
      dispatch.element(2).assign(1)
    })().compute(1)
    this.recoverCompute = Fn(() => {
      If(instanceIndex.lessThan(atomicLoad(counters.element(6))), () => {
        const candidateId = rejectedRead.element(instanceIndex).toVar()
        const candidate = candidates.element(candidateId)
        const cluster = clusters.element(candidate.x)
        const instance = instances.element(candidate.y)
        const bounds = sphereInWorld(cluster.get('bounds'), instance.get('transform'), instance.get('scale').x)
        If(isOccluded(bounds, this.currentView, this.currentProjection, this.currentNear), () => {
          atomicAdd(counters.element(7), uint(1))
        }).Else(() => {
          appendVisible(candidateId, cluster.get('draw').y)
          atomicAdd(counters.element(8), uint(1))
        })
      })
    })().compute(this.candidateClusters, [64])
    for (let batchIndex = 0; batchIndex < packed.batches.length; batchIndex++) {
      const batch = packed.batches[batchIndex]!
      const geometry = new InstancedBufferGeometry()
      geometry.instanceCount = batch.capacity
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(batch.triangles * 9), 3))
      geometry.setAttribute('normal', new BufferAttribute(new Float32Array(batch.triangles * 9), 3))
      geometry.setAttribute('uv', new BufferAttribute(new Float32Array(batch.triangles * 6), 2))
      geometry.setIndirect(this.counters, (DRAW_ARGUMENT_OFFSET + batchIndex * 4) * 4)
      const pulledUv = varyingProperty('vec2', 'geometryUv')
      const clusterColor = varyingProperty('vec3', 'geometryClusterColor')
      const position = Fn(() => {
        const candidateId = visibleRead.element(instanceIndex.add(batch.offset)).toVar()
        const candidate = candidates.element(candidateId)
        const cluster = clusters.element(candidate.x)
        const instance = instances.element(candidate.y)
        const draw = cluster.get('draw')
        const corner = vertexIndex.mod(3)
        const mirroredCorner = corner.equal(0).select(uint(0), uint(3).sub(corner))
        const orientedCorner = instance.get('scale').y.lessThan(0).select(mirroredCorner, corner)
        const localIndex = min(vertexIndex.div(3).mul(3).add(orientedCorner), draw.y.sub(1))
        const index = indices.element(draw.x.add(localIndex))
        const vertex = vertices.element(index)
        normalLocal.assign(instance.get('normal').mul(vec4(vertex.get('normal').xyz, 0)).xyz)
        pulledUv.assign(vec2(vertex.get('position').w, vertex.get('normal').w))
        const shadeId = mix(float(candidate.x), float(draw.z), float(this.debug.equal(2)))
        clusterColor.assign(cos(vec3(0, 2, 4).add(shadeId.mul(2.399963))).mul(0.36).add(0.58))
        return instance.get('transform').mul(vec4(vertex.get('position').xyz, 1)).xyz
      })()
      const material = createGeometryMaterial(batch.material)
      const depthMaterial = bindGeometryMaterial(material, pulledUv, position)
      const standardOutput = material.outputNode ?? output
      material.outputNode = vec4(mix(standardOutput.rgb, clusterColor, float(this.debug.greaterThan(0))), standardOutput.a)
      const mesh = new Mesh(geometry, material)
      mesh.name = batch.material.name || `Cluster material ${batchIndex}`
      mesh.frustumCulled = false
      mesh.receiveShadow = true
      mesh.castShadow = false
      this.meshes.push(mesh)
      this.object.add(mesh)
      const depthMesh = new Mesh(geometry, depthMaterial)
      depthMesh.frustumCulled = false
      depthMesh.matrixAutoUpdate = false
      this.depthMeshes.push(depthMesh)
      this.depthScene.add(depthMesh)
    }
    this.target = new RenderTarget(pyramidSize, pyramidSize, { depthBuffer: true, samples: 0 })
    this.target.depthTexture = new DepthTexture(pyramidSize, pyramidSize)
    this.target.texture.name = 'Geometry occlusion depth attachment'
    this.target.depthTexture.name = 'Geometry occlusion depth'
    this.pyramidCompute = Fn(() => {
      const xy = uvec2(instanceIndex.mod(pyramidSize), instanceIndex.div(pyramidSize))
      const low = uvec2(floor(vec2(xy).mul(this.depthSize).div(pyramidSize))).toVar()
      const high = uvec2(ceil(vec2(xy.add(1)).mul(this.depthSize).div(pyramidSize))).toVar()
      const farthest = float(0).toVar()
      Loop({ name: 'sourceY', start: low.y, end: high.y, type: 'uint', condition: '<' }, ({ sourceY: y }) => {
        Loop({ name: 'sourceX', start: low.x, end: high.x, type: 'uint', condition: '<' }, ({ sourceX: x }) => {
          farthest.assign(max(farthest, textureLoad(this.target.depthTexture!, uvec2(x, y)).r))
        })
      })
      pyramidWrite.element(instanceIndex).assign(farthest)
    })().compute(pyramidSize * pyramidSize, [64])
    this.reductionCompute = []
    let sourceOffset = 0
    let size = pyramidSize
    let destinationOffset = size * size
    while (size > 1) {
      const sourceSize = size
      const destinationSize = size / 2
      const readOffset = sourceOffset
      const writeOffset = destinationOffset
      const reduction = Fn(() => {
        const x = instanceIndex.mod(destinationSize).mul(2)
        const y = instanceIndex.div(destinationSize).mul(2)
        const index = uint(readOffset).add(y.mul(sourceSize)).add(x)
        const a = pyramidWrite.element(index)
        const b = pyramidWrite.element(index.add(1))
        const c = pyramidWrite.element(index.add(sourceSize))
        const d = pyramidWrite.element(index.add(sourceSize + 1))
        pyramidWrite.element(uint(writeOffset).add(instanceIndex)).assign(max(max(a, b), max(c, d)))
      })().compute(destinationSize * destinationSize, [64])
      this.reductionCompute.push(reduction)
      sourceOffset = destinationOffset
      size = destinationSize
      destinationOffset += size * size
    }
    this.computeNodes = [this.resetCompute, this.cullCompute, this.dispatchCompute, this.recoverCompute, this.pyramidCompute, ...this.reductionCompute]
  }
  setDebugView(view: MeshletDebugView) {
    this.debug.value = view === 'meshlets' ? 1 : view === 'lod' ? 2 : 0
  }

  resetHistory() {
    this.historyValid = false
  }

  prepare(renderer: WebGPURenderer, camera: PerspectiveCamera) {
    if (!camera.isPerspectiveCamera) throw new Error('Geometry currently requires a perspective camera')
    if (!(this.pixelError > 0)) throw new Error('Geometry pixel error must be positive')
    const finalTarget = renderer.getRenderTarget()
    if (renderer.reversedDepthBuffer) throw new Error('Geometry currently requires standard depth')
    if (this.occlusionEnabled && ((finalTarget?.samples ?? renderer.samples) > 1 || renderer.logarithmicDepthBuffer)) {
      throw new Error('Geometry occlusion requires single-sample standard depth')
    }
    if (camera.coordinateSystem !== WebGPUCoordinateSystem) {
      camera.coordinateSystem = WebGPUCoordinateSystem
      camera.updateProjectionMatrix()
    }
    camera.updateMatrixWorld()
    this.object.updateWorldMatrix(true, true)
    validateTransform(this.object.matrixWorld)
    this.world.value.copy(this.object.matrixWorld)
    this.worldScale.value = this.object.matrixWorld.getMaxScaleOnAxis()
    this.eye.value.setFromMatrixPosition(camera.matrixWorld)
    this.threshold.value = this.pixelError
    if (finalTarget) this.viewport.set(finalTarget.width, finalTarget.height)
    else renderer.getDrawingBufferSize(this.viewport)
    this.projectionScale.value = this.viewport.y * camera.projectionMatrix.elements[5]! * 0.5
    this.currentView.value.copy(camera.matrixWorldInverse)
    this.currentProjection.value.copy(camera.projectionMatrix)
    this.currentNear.value = camera.near
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.viewProjection, WebGPUCoordinateSystem)
    for (let i = 0; i < 6; i++) {
      const plane = this.frustum.planes[i]!
      this.frustumPlanes.array[i]!.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant)
    }
    this.history.value = this.historyValid && this.occlusionEnabled ? 1 : 0
    renderer.compute([this.resetCompute, this.cullCompute])
    if (this.occlusionEnabled) {
      this.target.setSize(this.viewport.x, this.viewport.y)
      this.depthSize.value.copy(this.viewport)
      const previousTarget = renderer.getRenderTarget()
      const previousAutoClear = renderer.autoClear
      const previousMrt = renderer.getMRT()
      for (const depthMesh of this.depthMeshes) depthMesh.matrix.copy(this.object.matrixWorld)
      renderer.setMRT(null)
      renderer.setRenderTarget(this.target)
      renderer.autoClear = true
      renderer.render(this.depthScene, camera)
      renderer.setRenderTarget(previousTarget)
      renderer.setMRT(previousMrt)
      renderer.autoClear = previousAutoClear
      renderer.compute([this.pyramidCompute, ...this.reductionCompute, this.dispatchCompute])
      renderer.compute(this.recoverCompute, this.dispatch)
      this.previousView.value.copy(camera.matrixWorldInverse)
      this.previousProjection.value.copy(camera.projectionMatrix)
      this.previousNear.value = camera.near
      this.historyValid = true
    } else {
      this.historyValid = false
    }
  }

  async readStats(renderer: WebGPURenderer): Promise<MeshletStats> {
    const values = new Uint32Array(await renderer.getArrayBufferAsync(this.counters))
    return {
      candidateClusters: this.candidateClusters,
      selectedClusters: values[4]!,
      frustumCulled: values[5]!,
      previousOccluded: values[6]!,
      occludedClusters: values[7]!,
      recoveredClusters: values[8]!,
      visibleClusters: values[10]!,
      firstPassClusters: values[10]! - values[8]!,
      drawnTriangles: values[9]!,
      submittedTriangles: values[11]!,
      totalTriangles: this.totalTriangles,
      materialBatches: this.meshes.length,
    }
  }

  dispose() {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    for (const mesh of this.depthMeshes) mesh.material.dispose()
    this.target.dispose()
    for (const node of this.computeNodes) node.dispose()
  }
}
