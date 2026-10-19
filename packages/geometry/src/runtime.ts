import {
  DepthTexture, Frustum, Group, IndirectStorageBufferAttribute, InstancedBufferGeometry,
  Matrix4, Mesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial, RenderTarget, Scene,
  StorageBufferAttribute, Vector2, Vector3, Vector4, WebGPUCoordinateSystem,
} from 'three/webgpu'
import type { Object3D, OrthographicCamera, PerspectiveCamera, WebGPURenderer } from 'three/webgpu'
import {
  Fn, If, Loop, atomicAdd, atomicLoad, atomicStore, bool, ceil, clamp, dot, float,
  floor, instanceIndex, log2, max, min, mix, output, storage,
  textureLoad, uint, uniform, uniformArray, uvec2, vec2, vec4,
} from 'three/tsl'
import { DRAW_ARGUMENT_OFFSET, packScene, validateTransform } from './runtime-data'
import type { MeshletSceneEntry } from './runtime-data'
import { bindGeometryMaterial, createGeometryDepthMaterial, createGeometryMaterial } from './runtime-material'
import { clusterReader, instanceReader } from './runtime-layout'
import { clusterGeometry, clusterVertex } from './runtime-vertex'
import { ClusterShadows } from './runtime-shadows'
import { DepthOccluders } from './runtime-occluders'

export type { MeshletSceneEntry } from './runtime-data'
export { normalMapWithUV, tangentNormalWithUV } from './runtime-material'
export type MeshletDebugView = 'normal' | 'meshlets' | 'lod'

export interface MeshletSceneOptions {
  pixelError?: number
  occlusion?: boolean
  occlusionSize?: number
  fallbackDistance?: number
  shadowLayer?: number
  shadowPixelError?: number
}

export interface MeshletPrepareOptions {
  occluders?: readonly Object3D[]
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
  sceneTriangles: number
  submittedTriangles: number
  totalTriangles: number
  materialBatches: number
  shadowPasses: number
}

export class MeshletScene {
  readonly object = new Group()
  readonly meshes: Mesh<InstancedBufferGeometry, MeshStandardNodeMaterial>[] = []
  readonly totalTriangles: number
  readonly candidateClusters: number
  pixelError: number
  occlusionEnabled: boolean
  readonly fallbackDistance: number
  readonly shadowLayer: number
  shadowPixelError: number
  private readonly shadows: ClusterShadows
  private readonly externalDepth = new DepthOccluders()
  private readonly lodEnabled = uniform(true)
  private readonly fallbackReach = uniform(120)
  private shadowPasses = 0
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
  private readonly selectionComputes
  private readonly occlusionComputes
  private readonly computeNodes

  constructor(entries: readonly MeshletSceneEntry[], options: MeshletSceneOptions = {}) {
    const packed = packScene(entries)
    this.object.name = 'Cluster scene'
    this.pixelError = options.pixelError ?? 2
    this.occlusionEnabled = options.occlusion ?? true
    this.candidateClusters = packed.candidateCount
    this.totalTriangles = packed.totalTriangles
    this.fallbackDistance = options.fallbackDistance ?? 120
    if (!(this.fallbackDistance > 0)) throw new Error('Geometry fallback distance must be positive')
    this.fallbackReach.value = this.fallbackDistance
    this.shadowLayer = options.shadowLayer ?? 31
    this.shadowPixelError = options.shadowPixelError ?? 1
    this.shadows = new ClusterShadows(packed, this.world, this.worldScale, this.shadowLayer)
    this.object.add(this.shadows.object)
    const pyramidSize = options.occlusionSize ?? 512
    if (pyramidSize < 32 || pyramidSize > 2048 || (pyramidSize & (pyramidSize - 1)) !== 0) {
      throw new Error('Occlusion size must be a power of two between 32 and 2048')
    }
    const argumentCount = DRAW_ARGUMENT_OFFSET + packed.batches.length * 4
    this.counters = new IndirectStorageBufferAttribute(new Uint32Array(argumentCount), 1)
    const visibleAttribute = new StorageBufferAttribute(this.candidateClusters, 1, Uint32Array)
    const rejectedAttribute = new StorageBufferAttribute(this.candidateClusters, 1, Uint32Array)
    const pyramidAttribute = new StorageBufferAttribute((pyramidSize * pyramidSize * 4 - 1) / 3, 1)
    const readCluster = clusterReader(packed.clusters)
    const readInstance = instanceReader(packed.instances)
    const candidates = storage(packed.candidates, 'uvec4', this.candidateClusters).toReadOnly()
    const visibleWrite = storage(visibleAttribute, 'uint', this.candidateClusters)
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
    })().compute(1).setName('Cluster reset')
    this.cullCompute = Fn(() => {
      const candidate = candidates.element(instanceIndex)
      const cluster = readCluster(candidate.x)
      const instance = readInstance(candidate.y)
      const scale = instance.scale.x
      const ownSphere = sphereInWorld(cluster.selfSphere, instance.transform, scale)
      const parentSphere = sphereInWorld(cluster.parentSphere, instance.transform, scale)
      const ownError = projectedError(ownSphere, cluster.errors.x, scale)
      const parentError = projectedError(parentSphere, cluster.errors.y, scale)
      const bounds = sphereInWorld(cluster.bounds, instance.transform, scale).toVar()
      const lod = ownError.lessThanEqual(this.threshold).and(parentError.greaterThan(this.threshold))
      const finest = cluster.draw.z.equal(0).and(this.eye.sub(bounds.xyz).length().sub(bounds.w).lessThanEqual(this.fallbackReach))
      If(this.lodEnabled.select(lod, finest), () => {
        atomicAdd(counters.element(4), uint(1))
        atomicAdd(counters.element(12), cluster.draw.y.div(3))
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
          }).Else(() => { appendVisible(instanceIndex, cluster.draw.y) })
        }).Else(() => { atomicAdd(counters.element(5), uint(1)) })
      })
    })().compute(this.candidateClusters, [64]).setName('Cluster selection')
    this.dispatchCompute = Fn(() => {
      const count = atomicLoad(counters.element(6))
      const groups = count.div(64).add(uint(count.mod(64).greaterThan(0)))
      dispatch.element(0).assign(min(groups, uint(65535)))
      dispatch.element(1).assign(max(groups.add(65534).div(65535), uint(1)))
      dispatch.element(2).assign(1)
    })().compute(1).setName('Recovery dispatch')
    this.recoverCompute = Fn(() => {
      If(instanceIndex.lessThan(atomicLoad(counters.element(6))), () => {
        const candidateId = rejectedRead.element(instanceIndex).toVar()
        const candidate = candidates.element(candidateId)
        const cluster = readCluster(candidate.x)
        const instance = readInstance(candidate.y)
        const bounds = sphereInWorld(cluster.bounds, instance.transform, instance.scale.x)
        If(isOccluded(bounds, this.currentView, this.currentProjection, this.currentNear), () => {
          atomicAdd(counters.element(7), uint(1))
        }).Else(() => {
          appendVisible(candidateId, cluster.draw.y)
          atomicAdd(counters.element(8), uint(1))
        })
      })
    })().compute(this.candidateClusters, [64]).setName('Cluster recovery')
    for (let batchIndex = 0; batchIndex < packed.batches.length; batchIndex++) {
      const batch = packed.batches[batchIndex]!
      const geometry = clusterGeometry(batch.triangles, batch.capacity, this.counters, batchIndex)
      const pulled = clusterVertex(packed, visibleAttribute, batch.offset, this.debug)
      const material = createGeometryMaterial(batch.material)
      bindGeometryMaterial(material, pulled.uv, pulled.position)
      const depthMaterial = createGeometryDepthMaterial(material)
      const standardOutput = material.outputNode ?? output
      material.outputNode = vec4(mix(standardOutput.rgb, pulled.color, float(this.debug.greaterThan(0))), standardOutput.a)
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
    })().compute(pyramidSize * pyramidSize, [64]).setName('HiZ depth')
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
      })().compute(destinationSize * destinationSize, [64]).setName(`HiZ ${destinationSize}`)
      this.reductionCompute.push(reduction)
      sourceOffset = destinationOffset
      size = destinationSize
      destinationOffset += size * size
    }
    this.selectionComputes = [this.resetCompute, this.cullCompute]
    this.occlusionComputes = [this.pyramidCompute, ...this.reductionCompute, this.dispatchCompute]
    this.computeNodes = [this.resetCompute, this.cullCompute, this.dispatchCompute, this.recoverCompute, this.pyramidCompute, ...this.reductionCompute]
  }
  setDebugView(view: MeshletDebugView) {
    this.debug.value = view === 'meshlets' ? 1 : view === 'lod' ? 2 : 0
  }

  setLodEnabled(enabled: boolean) {
    if (this.lodEnabled.value === enabled) return
    this.lodEnabled.value = enabled
    this.resetHistory()
  }

  get shadowEnabled() { return this.shadows.object.visible }

  setShadowEnabled(enabled: boolean) { this.shadows.object.visible = enabled }

  prepareShadow(renderer: WebGPURenderer, camera: OrthographicCamera, mapSize: Readonly<Vector2>) {
    if (!this.shadowEnabled) return
    this.object.updateWorldMatrix(true, true)
    validateTransform(this.object.matrixWorld)
    this.world.value.copy(this.object.matrixWorld)
    this.worldScale.value = this.object.matrixWorld.getMaxScaleOnAxis()
    this.shadows.prepare(renderer, camera, mapSize, this.shadowPixelError)
    this.shadowPasses++
  }

  resetHistory() {
    this.historyValid = false
  }

  prepare(renderer: WebGPURenderer, camera: PerspectiveCamera, options: MeshletPrepareOptions = {}) {
    this.shadowPasses = 0
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
    renderer.compute(this.selectionComputes)
    if (this.occlusionEnabled) {
      this.target.setSize(this.viewport.x, this.viewport.y)
      this.depthSize.value.copy(this.viewport)
      const previousTarget = renderer.getRenderTarget()
      const previousAutoClear = renderer.autoClear
      const previousMrt = renderer.getMRT()
      for (const depthMesh of this.depthMeshes) depthMesh.matrix.copy(this.object.matrixWorld)
      try {
        renderer.setMRT(null)
        renderer.setRenderTarget(this.target)
        renderer.autoClear = true
        renderer.render(this.depthScene, camera)
        renderer.autoClear = false
        this.externalDepth.render(renderer, camera, options.occluders ?? [])
      } finally {
        renderer.setRenderTarget(previousTarget)
        renderer.setMRT(previousMrt)
        renderer.autoClear = previousAutoClear
      }
      renderer.compute(this.occlusionComputes)
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
      sceneTriangles: values[12]!,
      submittedTriangles: values[11]!,
      totalTriangles: this.totalTriangles,
      materialBatches: this.meshes.length,
      shadowPasses: this.shadowPasses,
    }
  }

  dispose() {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    for (const mesh of this.depthMeshes) mesh.material.dispose()
    this.shadows.dispose()
    this.externalDepth.dispose()
    this.target.dispose()
    for (const node of this.computeNodes) node.dispose()
  }
}
