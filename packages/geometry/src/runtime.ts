import {
  BufferGeometry, Frustum, Group, IndirectStorageBufferAttribute,
  Matrix4, Mesh, MeshStandardNodeMaterial, PerspectiveCamera,
  StorageBufferAttribute, Vector2, Vector3, Vector4, WebGPUCoordinateSystem,
} from 'three/webgpu'
import type { DepthTexture, MeshBasicNodeMaterial, Node, OrthographicCamera, WebGPURenderer } from 'three/webgpu'
import {
  Fn, If, Loop, bool, ceil, clamp, float,
  floor, instanceIndex, log2, max, min, mix, output, storage,
  textureLoad, uint, uniform, uniformArray, uvec2, vec2, vec4,
} from 'three/tsl'
import { packScene, transformScale, uploadAttributes } from './runtime-data'
import type { MeshletSceneEntry, PackedMeshletScene } from './runtime-data'
import { bindGeometryMaterial, createGeometryDepthMaterial, createGeometryMaterial } from './runtime-material'
import { clusterGeometry, clusterVertex } from './runtime-vertex'
import { ClusterShadows } from './runtime-shadows'
import { ClusterTraversal } from './runtime-traversal'
import { ClusterFeedback, type MeshletTextureFeedback } from './runtime-textures'
import type { GeometryPageArena } from './runtime-pages'
import { FRAME_UPLOAD_BYTES, GEOMETRY_ARENA_BYTES, GEOMETRY_PAGE_BYTES, GEOMETRY_STAGING_BYTES } from './page-residency'
import { MaterialSubmission, type GeometryCompilePass } from './runtime-submission'

export type { MeshletTextureFeedback, TextureDemandBinding } from './runtime-textures'

export type { MeshletSceneEntry } from './runtime-data'
export type { GeometryCompilePass } from './runtime-submission'
export { GEOMETRY_ARENA_BYTES } from './page-residency'
export { geometryMaterialId, geometryScaleX, geometrySecondaryUV, geometryVertexColor, normalMapWithUV, tangentNormalWithUV } from './runtime-material'
export type MeshletDebugView = 'normal' | 'meshlets' | 'lod'

export interface MeshletSceneOptions {
  materialIds?: ReadonlyMap<MeshletSceneEntry['materials'][number], number>
  geometryBytes?: number
  textureFeedback?: MeshletTextureFeedback
  pixelError?: number
  occlusion?: boolean
  occlusionSize?: number
  fallbackDistance?: number
  shadowLayer?: number
  shadowPixelError?: number
  triangleBudget?: number
}

export interface MeshletStats {
  candidateClusters: number
  instancesTested: number
  instancesFrustumCulled: number
  instancesPreviousOccluded: number
  instancesOccluded: number
  instancesRecovered: number
  nodesVisited: number
  clustersVisited: number
  selectionMs: number | null
  residentBytes: number
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
  triangleBudget: number
  viewTriangleBudget: number
  shadowTriangleBudget: number
  indexPoolBytes: number
  requestedTriangles: number
  indexOverflows: number
  indexOverflowCount: number
  effectivePixelError: number
  shadowRequestedTriangles: number
  shadowIndexOverflows: number
  shadowIndexOverflowCount: number
  effectiveShadowPixelError: number
  traversalScratchBytes: number
  reachedGroups: number
  admittedWork: number
}

export class MeshletScene {
  readonly object = new Group()
  readonly meshes: Mesh<BufferGeometry, MeshStandardNodeMaterial>[] = []
  private readonly submission: MaterialSubmission
  private readonly lit
  private readonly depth
  readonly triangleBudget: number
  readonly totalTriangles: number
  readonly candidateClusters: number
  readonly residentGeometryBytes: number
  pixelError: number
  occlusionEnabled: boolean
  readonly fallbackDistance: number
  readonly shadowLayer: number
  shadowPixelError: number
  private readonly shadows: ClusterShadows
  private readonly lodEnabled = uniform(true)
  private readonly fallbackReach = uniform(120)
  private shadowPasses = 0
  private readonly materials = new Set<MeshStandardNodeMaterial | MeshBasicNodeMaterial>()
  private readonly counters: IndirectStorageBufferAttribute
  private readonly traversal: ClusterTraversal
  private readonly hierarchyDepth: number
  readonly residentBytes: number
  readonly traversalScratchBytes: number
  private depthTexture: ReturnType<typeof textureLoad> | null = null
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
  private shadowsEnabled = true
  private readonly pyramidCompute
  private readonly reductionCompute
  private readonly occlusionComputes
  private readonly computeNodes
  private readonly uploadBuffers: StorageBufferAttribute[]
  private readonly streaming: ClusterFeedback
  private readonly arena: GeometryPageArena
  private schedulingMs = 0
  private peakSchedulingMs = 0
  private readonly frameViewport = new Vector2()

  static async create(renderer: WebGPURenderer, entries: readonly MeshletSceneEntry[], options: MeshletSceneOptions = {}) {
    await renderer.init()
    const backend = renderer.backend as typeof renderer.backend & { device?: { limits: { maxBufferSize: number; maxStorageBufferBindingSize: number; maxStorageBuffersPerShaderStage: number } } }
    const limits = backend.device?.limits
    if (!limits || limits.maxStorageBuffersPerShaderStage < 12) throw new Error('Geometry paging requires a WebGPU device requested with twelve storage buffers per shader stage')
    const maximum = Math.floor(Math.min(limits.maxBufferSize, limits.maxStorageBufferBindingSize) / GEOMETRY_PAGE_BYTES) * GEOMETRY_PAGE_BYTES
    const bytes = options.geometryBytes ?? Math.min(GEOMETRY_ARENA_BYTES, maximum)
    if (bytes > maximum) throw new Error('Geometry arena exceeds the requested WebGPU device limits')
    const packed = await packScene(renderer, entries, bytes, options.textureFeedback?.cpuStaging, options.materialIds)
    let scene: MeshletScene | undefined
    try {
      scene = new MeshletScene(packed, options)
      await uploadAttributes(renderer, scene.uploadBuffers)
      await Promise.all([scene.traversal.upload(renderer), scene.shadows.upload(renderer), scene.streaming.upload(renderer), scene.arena.initialize(renderer), ...scene.reductionCompute.map(node => renderer.compileComputeAsync(node))])
      return scene
    } catch (error) {
      if (scene) scene.dispose()
      else { packed.arena.dispose(); options.textureFeedback?.ledger.release(packed.arena) }
      throw error
    }
  }

  private constructor(packed: PackedMeshletScene, options: MeshletSceneOptions) {
    this.arena = packed.arena
    this.submission = new MaterialSubmission(packed.coverage)
    this.lit = this.submission.lit
    this.depth = this.submission.depth
    this.object.name = 'Cluster scene'
    this.lit.name = 'Cluster lit materials'
    this.depth.name = 'Cluster depth buckets'
    this.depth.visible = false
    this.object.add(this.lit, this.depth)
    this.pixelError = options.pixelError ?? 2
    this.triangleBudget = options.triangleBudget ?? 16_000_000
    if (!Number.isSafeInteger(this.triangleBudget) || this.triangleBudget < 2 || this.triangleBudget % 2) throw new Error('Geometry triangle budget must be a positive even integer')
    const streamBudget = this.triangleBudget / 2
    this.occlusionEnabled = options.occlusion ?? true
    this.candidateClusters = packed.candidateCount
    this.totalTriangles = packed.totalTriangles
    this.residentGeometryBytes = packed.residentGeometryBytes
    this.fallbackDistance = options.fallbackDistance ?? 120
    if (!(this.fallbackDistance > 0)) throw new Error('Geometry fallback distance must be positive')
    this.fallbackReach.value = this.fallbackDistance
    this.shadowLayer = options.shadowLayer ?? 31
    this.shadowPixelError = options.shadowPixelError ?? 1
    this.hierarchyDepth = packed.hierarchyDepth
    this.shadows = new ClusterShadows(packed, this.world, this.worldScale, this.shadowLayer, streamBudget, this.submission)
    this.object.add(this.shadows.object)
    const pyramidSize = options.occlusionSize ?? 512
    if (pyramidSize < 32 || pyramidSize > 2048 || (pyramidSize & (pyramidSize - 1)) !== 0) {
      throw new Error('Occlusion size must be a power of two between 32 and 2048')
    }
    const pyramidAttribute = new StorageBufferAttribute((pyramidSize * pyramidSize * 4 - 1) / 3, 1)
    this.uploadBuffers = [pyramidAttribute]
    const pyramidWrite = storage(pyramidAttribute, 'float', pyramidAttribute.count)
    const pyramidRead = storage(pyramidAttribute, 'float', pyramidAttribute.count).toReadOnly()

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

    this.traversal = new ClusterTraversal(packed, this.world, this.worldScale, this.frustumPlanes, projectedError,
      this.threshold, this.lodEnabled, this.fallbackReach, this.eye,
      sphere => this.history.greaterThan(0).and(isOccluded(sphere, this.previousView, this.previousProjection, this.previousNear)),
      sphere => isOccluded(sphere, this.currentView, this.currentProjection, this.currentNear),
      streamBudget, float(Math.max(packed.maximumError, 0.000001) * 1.001).mul(this.worldScale).mul(this.projectionScale).div(0.000001))
    this.counters = this.traversal.counters
    this.residentBytes = packed.residentBytes + this.traversal.residentBytes + this.shadows.residentBytes + pyramidAttribute.array.byteLength
    this.traversalScratchBytes = this.traversal.residentBytes + this.shadows.residentBytes - this.triangleBudget * 12
    const pulled = clusterVertex(packed, this.traversal.visible, this.debug)
    const debugOutputs = new Map<Node, Node<'vec4'>>()
    for (let batchIndex = 0; batchIndex < packed.batches.length; batchIndex++) {
      const batch = packed.batches[batchIndex]!
      const geometry = clusterGeometry(this.traversal.indices.indices, this.counters, batchIndex)
      const material = createGeometryMaterial(batch.material)
      bindGeometryMaterial(material, pulled)
      const standardOutput = material.outputNode ?? output
      if (!debugOutputs.has(standardOutput)) debugOutputs.set(standardOutput, vec4(mix(standardOutput.rgb, pulled.color, float(this.debug.greaterThan(0))), standardOutput.a))
      material.outputNode = debugOutputs.get(standardOutput)!
      this.materials.add(material)
      const mesh = new Mesh(geometry, material)
      mesh.name = batch.material.name || `Cluster material ${batchIndex}`
      mesh.frustumCulled = false
      mesh.receiveShadow = true
      mesh.castShadow = false
      this.meshes.push(mesh)
      this.submission.add(this.lit, mesh, batchIndex, 1, batch.material)
    }
    for (const batch of packed.depthBatches) {
      const material = createGeometryDepthMaterial(batch, pulled)
      this.materials.add(material)
      const mesh = new Mesh(clusterGeometry(this.traversal.indices.indices, this.counters, batch.argument), material)
      mesh.name = `Cluster depth ${batch.material?.name || 'opaque'}`
      mesh.frustumCulled = false
      this.submission.add(this.depth, mesh, batch.firstMaterial, batch.materialCount, batch.material)
    }
    this.pyramidCompute = Fn(() => {
      const xy = uvec2(instanceIndex.mod(pyramidSize), instanceIndex.div(pyramidSize))
      const low = uvec2(floor(vec2(xy).mul(this.depthSize).div(pyramidSize))).toVar()
      const high = uvec2(ceil(vec2(xy.add(1)).mul(this.depthSize).div(pyramidSize))).toVar()
      const farthest = float(0).toVar()
      Loop({ name: 'sourceY', start: low.y, end: high.y, type: 'uint', condition: '<' }, ({ sourceY: y }) => {
        Loop({ name: 'sourceX', start: low.x, end: high.x, type: 'uint', condition: '<' }, ({ sourceX: x }) => {
          farthest.assign(max(farthest, this.depthTexture!.load(uvec2(x, y)).r))
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
    this.occlusionComputes = [this.pyramidCompute, ...this.reductionCompute]
    this.computeNodes = [this.pyramidCompute, ...this.reductionCompute]
    this.streaming = new ClusterFeedback(packed, this.traversal.visible, this.counters, this.shadows.counters,
      this.world, this.worldScale, this.eye, this.projectionScale, options.textureFeedback)
    this.residentBytes += this.streaming.residentBytes
    if (options.textureFeedback) {
      const stagingBytes = 3 * GEOMETRY_STAGING_BYTES
      if (!options.textureFeedback.ledger.reserve(this.arena, 'staging', stagingBytes) || !options.textureFeedback.ledger.reserve(this, 'geometry', this.residentBytes - stagingBytes)) throw new Error('Geometry, staging and minimum texture tails exceed the shared byte budget')
    }
  }
  setDebugView(view: MeshletDebugView) {
    this.debug.value = view === 'meshlets' ? 1 : view === 'lod' ? 2 : 0
  }

  compile(passes: readonly GeometryCompilePass[]) {
    this.object.updateWorldMatrix(true, true)
    return this.submission.compile(passes, this.object.matrixWorld)
  }

  setLodEnabled(enabled: boolean) {
    if (this.lodEnabled.value === enabled) return
    this.lodEnabled.value = enabled
    this.resetHistory()
  }

  get shadowEnabled() { return this.shadowsEnabled }

  setShadowEnabled(enabled: boolean) { this.shadowsEnabled = enabled; if (!enabled) this.shadows.object.visible = false }

  prepareLit() { this.lit.visible = true; this.depth.visible = false; this.shadows.object.visible = false }

  prepareShadow(renderer: WebGPURenderer, camera: OrthographicCamera, mapSize: Readonly<Vector2>, cascade: number) {
    if (!this.shadowEnabled) return
    this.lit.visible = false
    this.depth.visible = false
    this.shadows.object.visible = true
    this.object.updateWorldMatrix(true, true)
    this.world.value.copy(this.object.matrixWorld)
    this.worldScale.value = transformScale(this.object.matrixWorld)
    this.shadows.prepare(renderer, camera, mapSize, this.shadowPixelError, this.object.matrixWorld, cascade)
    this.shadowPasses++
  }

  resetHistory() {
    this.historyValid = false
  }

  setGeometryLimit(bytes: number) { this.arena.residency.setLimit(bytes) }

  update(renderer: WebGPURenderer, deadline = performance.now() + 0.5, allowance = FRAME_UPLOAD_BYTES) {
    const start = performance.now()
    this.streaming.consume(start + Math.max(0, deadline - start) * 0.5)
    const uploaded = this.arena.update(renderer, deadline, allowance)
    renderer.getDrawingBufferSize(this.frameViewport)
    this.submission.updateBindings(this.streaming.feedback?.bindingVersions, this.frameViewport)
    this.schedulingMs = performance.now() - start - this.arena.submissionMs
    this.peakSchedulingMs = Math.max(this.peakSchedulingMs, this.schedulingMs)
    if (this.streaming.feedback) this.streaming.feedback.frame = this.arena.frame.value
    return uploaded
  }

  endFrame(renderer: WebGPURenderer) { this.streaming.sample(renderer) }

  completeFrame(renderer: WebGPURenderer) { return this.streaming.completeFrame(renderer) }

  pagingStats() { return { ...this.arena.snapshot(), ...this.streaming.stats(), materialWarmup: this.submission.warmupStats(), schedulingMs: this.schedulingMs, peakSchedulingMs: this.peakSchedulingMs } }

  prepare(renderer: WebGPURenderer, camera: PerspectiveCamera, viewport: Readonly<Vector2>) {
    this.lit.visible = false
    this.depth.visible = true
    this.shadows.object.visible = false
    this.shadowPasses = 0
    if (!camera.isPerspectiveCamera) throw new Error('Geometry currently requires a perspective camera')
    if (!(this.pixelError > 0)) throw new Error('Geometry pixel error must be positive')
    if (renderer.reversedDepthBuffer) throw new Error('Geometry currently requires standard depth')
    if (renderer.logarithmicDepthBuffer) throw new Error('Geometry currently requires standard depth')
    if (camera.coordinateSystem !== WebGPUCoordinateSystem) {
      camera.coordinateSystem = WebGPUCoordinateSystem
      camera.updateProjectionMatrix()
    }
    camera.updateMatrixWorld()
    this.object.updateWorldMatrix(true, true)
    this.world.value.copy(this.object.matrixWorld)
    this.worldScale.value = transformScale(this.object.matrixWorld)
    this.eye.value.setFromMatrixPosition(camera.matrixWorld)
    this.threshold.value = this.pixelError
    this.projectionScale.value = viewport.y * camera.projectionMatrix.elements[5]! * 0.5
    this.currentView.value.copy(camera.matrixWorldInverse)
    this.currentProjection.value.copy(camera.projectionMatrix)
    this.currentNear.value = camera.near
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.viewProjection, WebGPUCoordinateSystem)
    for (let i = 0; i < 6; i++) {
      const plane = this.frustum.planes[i]!
      this.frustumPlanes.array[i]!.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant)
    }
    this.submission.update(this.frustum, this.object.matrixWorld, 0)
    this.history.value = this.historyValid && this.occlusionEnabled ? 1 : 0
    this.historyValid = false
    this.traversal.select(renderer, this.hierarchyDepth)
  }

  recover(renderer: WebGPURenderer, depth: DepthTexture) {
    this.depth.visible = false
    this.lit.visible = true
    if (!this.occlusionEnabled) return
    if (this.depthTexture) this.depthTexture.value = depth
    else this.depthTexture = textureLoad(depth)
    this.depthSize.value.set(depth.image.width, depth.image.height)
    renderer.compute(this.occlusionComputes)
    this.traversal.recover(renderer)
    this.previousView.value.copy(this.currentView.value)
    this.previousProjection.value.copy(this.currentProjection.value)
    this.previousNear.value = this.currentNear.value
    this.historyValid = true
  }

  async readStats(renderer: WebGPURenderer, timings?: Readonly<Record<string, number>>): Promise<MeshletStats> {
    const sample = await this.streaming.read(renderer)
    const values = sample.view
    if (values[20]) throw new Error(`Geometry selection budget exhausted: ${values[20]} queue or visible records exceeded capacity`)
    const selectionTimings = timings ? Object.entries(timings).filter(([name]) => name.startsWith('Compute \u00b7 View ')) : []
    const selectionMs = selectionTimings.length ? selectionTimings.reduce((sum, [, value]) => sum + value, 0) : null
    const [indices, shadows] = await Promise.all([
      this.traversal.indices.readStats(values),
      this.shadows.readStats(sample.shadow),
    ])
    return {
      triangleBudget: this.triangleBudget, indexPoolBytes: this.triangleBudget * 12,
      viewTriangleBudget: indices.triangleBudget, shadowTriangleBudget: shadows.triangleBudget,
      requestedTriangles: indices.requestedTriangles, indexOverflows: indices.indexOverflows, indexOverflowCount: indices.indexOverflowCount,
      effectivePixelError: indices.effectivePixelError,
      shadowRequestedTriangles: shadows.requestedTriangles, shadowIndexOverflows: shadows.indexOverflows,
      shadowIndexOverflowCount: shadows.indexOverflowCount, effectiveShadowPixelError: shadows.effectivePixelError,
      instancesTested: values[13]!, instancesFrustumCulled: values[14]!, instancesPreviousOccluded: values[15]!, instancesOccluded: values[16]!, instancesRecovered: values[17]!,
      nodesVisited: values[18]!, clustersVisited: values[19]!, selectionMs, residentBytes: this.residentBytes,
      candidateClusters: this.candidateClusters,
      selectedClusters: values[4]!,
      frustumCulled: values[5]!,
      previousOccluded: values[6]!,
      occludedClusters: values[7]!,
      recoveredClusters: values[8]!,
      visibleClusters: values[0]!,
      firstPassClusters: values[11]!,
      drawnTriangles: values[9]!,
      sceneTriangles: values[12]!,
      submittedTriangles: values[9]!,
      totalTriangles: this.totalTriangles,
      materialBatches: this.meshes.length,
      shadowPasses: this.shadowPasses,
      traversalScratchBytes: this.traversalScratchBytes, reachedGroups: values[22]!, admittedWork: values[21]!,
    }
  }

  dispose() {
    this.streaming.feedback?.ledger.release(this)
    this.streaming.feedback?.ledger.release(this.arena)
    this.streaming.dispose()
    this.arena.dispose()
    this.submission.disposeGeometry('lit')
    this.submission.disposeGeometry('depth')
    for (const material of this.materials) material.dispose()
    this.shadows.dispose()
    this.traversal.dispose()
    for (const node of this.computeNodes) node.dispose()
  }
}
