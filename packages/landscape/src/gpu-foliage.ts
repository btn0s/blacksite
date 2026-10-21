import { Box3, Color, Frustum, Group, InstancedBufferGeometry, Matrix4, Mesh, PlaneGeometry, Sphere, Vector3, Vector4 } from 'three'
import type { Camera, Material } from 'three'
import { IndirectStorageBufferAttribute, StorageBufferAttribute, StorageInstancedBufferAttribute } from 'three/webgpu'
import type { MeshStandardNodeMaterial, Node, WebGPURenderer } from 'three/webgpu'
import { Fn, If, Loop, Return, atan, atomicAdd, atomicLoad, atomicStore, bool, cos, float, floor, instanceIndex, mat4, materialColor, max, mix, normalGeometry, normalLocal, output, positionGeometry, positionPrevious, screenCoordinate, sin, smoothstep, storage, transformNormal, uint, uniform, uniformArray, varying, vec3, vec4 } from 'three/tsl'
import type { FoliageModel, FoliagePrimitive } from './foliage-model'
import { createImpostorMaterial, type ImpostorAtlas } from './impostor'
import { createWindNodes, element, landscapeDither, landscapeHash, landscapeNoise } from './nodes'
import type { Wind } from './wind'
import { forestDomainWeight, type ForestCoverage } from './forest-coverage'

export interface GpuFoliageOptions {
  readonly renderer: WebGPURenderer
  readonly model: FoliageModel
  readonly lod?: FoliageModel
  readonly impostor?: ImpostorAtlas
  readonly placements: Float32Array
  readonly wind: Wind
  readonly range: readonly [number, number]
  readonly meshRange?: readonly [number, number]
  readonly lodRange?: readonly [number, number]
  readonly shadowDistance?: number
  readonly shadowLayer?: number
  readonly fallbackDistance?: number
  readonly windStrength?: number
  readonly alphaToCoverage?: boolean
  readonly singleFrame?: boolean
  readonly impostorBlur?: number
  readonly impostorFarTint?: readonly [number, number, number]
  readonly tint?: FoliageTint
  readonly coverage?: ForestCoverage
}

export interface FoliageTint {
  readonly low: readonly [number, number, number]
  readonly high: readonly [number, number, number]
  readonly patchSize?: number
  readonly individual?: number
  readonly seed?: number
}

export interface GpuFoliageStats {
  population: number
  candidateInstances: number
  drawnInstances: number
  culledInstances: number
  sceneTriangles: number
  drawnTriangles: number
  fullDetailTriangles: number
  near: number
  middle: number
  impostors: number
  shadows: number
  cappedInstances: number
}

const HEADER = 32
const LANE_COUNT = 6

export function createGpuFoliage(options: GpuFoliageOptions) {
  if (options.placements.length % 8 !== 0) throw new Error('Foliage placements require eight floats per instance')
  const count = options.placements.length / 8
  if (count === 0) throw new Error('GPU foliage requires at least one placement')
  const { model, lod, impostor, renderer } = options
  const meshRange = options.meshRange ?? options.range
  const lodRange = options.lodRange ?? [meshRange[0] * 0.45, meshRange[0] * 0.7]
  const fallbackDistance = Math.min(options.range[1], options.fallbackDistance ?? meshRange[1])
  const shadowDistance = options.shadowDistance ?? 0
  const object = new Group()
  object.name = `GPU foliage · ${model.name}`
  const materials: Material[] = []
  const geometries: InstancedBufferGeometry[] = []
  const sourceAttribute = new StorageBufferAttribute(options.placements, 4)
  const source = storage(sourceAttribute, 'vec4', count * 2).toReadOnly()
  const activeLanes = [true, Boolean(lod), Boolean(impostor), shadowDistance > 0, shadowDistance > 0 && Boolean(lod), shadowDistance > 0 && Boolean(impostor)]
  const matrices = Array.from({ length: LANE_COUNT }, (_, lane) => new StorageInstancedBufferAttribute(activeLanes[lane] ? count : 1, 16))
  const matrixWrite = matrices.map(attribute => storage(attribute, 'mat4', attribute.count))
  const matrixRead = matrices.map(attribute => storage(attribute, 'mat4', attribute.count).toReadOnly())
  const drawRecords: { lane: number; indices: number }[] = []
  const argumentsCount = HEADER + ((model.primitives.length + (lod?.primitives.length ?? 0)) * (shadowDistance > 0 ? 2 : 1) + (impostor ? (shadowDistance > 0 ? 2 : 1) : 0)) * 5
  const indirect = new IndirectStorageBufferAttribute(new Uint32Array(argumentsCount), 1)
  const counters = storage(indirect, 'uint', argumentsCount).toAtomic()
  const viewer = uniform(new Vector3())
  const previousViewer = uniform(new Vector3())
  let hasPreviousViewer = false
  const frustumPlanes = uniformArray(Array.from({ length: 6 }, () => new Vector4()))
  const shadowPlanes = uniformArray(Array.from({ length: 6 }, () => new Vector4()))
  const lodEnabled = uniform(1, 'uint')
  const cullingEnabled = uniform(1, 'uint')
  const lodView = uniform(0)
  const wind = createWindNodes(options.wind)
  const previousTime = uniform(options.wind.time)
  const previousWind = createWindNodes(options.wind, previousTime)
  let lastWindTime = options.wind.time
  const windStrength = options.windStrength ?? 0.08
  const geometryBounds = new Box3().copy(model.box)
  if (lod) geometryBounds.union(lod.box)
  const bounds = geometryBounds.getBoundingSphere(new Sphere())
  const boundCentre = uniform(bounds.center)
  const boundRadius = bounds.radius + Math.max(0.2, model.height * windStrength)
  const triangleCounts = [model.triangles, lod?.triangles ?? 0, 2]
  const tintAt = (root: Node<'vec3'>) => {
    const tint = options.tint
    if (!tint) return vec3(1)
    const patch = landscapeNoise(root.xz.div(tint.patchSize ?? 90), tint.seed ?? 97)
    const individual = landscapeHash(floor(root.xz.mul(4)), tint.seed ?? 97)
    return varying(mix(vec3(...tint.low), vec3(...tint.high), mix(patch, individual, tint.individual ?? 0.25)))
  }
  const fadeFor = (lane: number, distance: Node<'float'>) => {
    const noLod = lodEnabled.equal(0)
    const bounded = noLod.or(cullingEnabled.equal(0))
    const capFade = bounded.select(float(1).sub(smoothstep(fallbackDistance * 0.9, fallbackDistance, distance)), float(1))
    const far = float(1).sub(smoothstep(options.range[0], options.range[1], distance)).mul(capFade)
    if (lane >= 3) {
      const shadowFar = float(1).sub(smoothstep(shadowDistance * 0.9, shadowDistance, distance)).mul(capFade)
      const transition = smoothstep(lodRange[0], lodRange[1], distance)
      const representation = lod ? (lane === 4 ? transition : float(1).sub(transition)) : float(1)
      const meshOut = impostor ? float(1).sub(smoothstep(meshRange[0], meshRange[1], distance)) : float(1)
      return noLod.select(shadowFar, shadowFar.mul(representation).mul(meshOut))
    }
    const meshOut = impostor ? float(1).sub(smoothstep(meshRange[0], meshRange[1], distance)) : far
    const highOut = lod ? float(1).sub(smoothstep(lodRange[0], lodRange[1], distance)) : meshOut
    const fade = lane === 1 || lane === 4 ? smoothstep(lodRange[0], lodRange[1], distance).mul(meshOut) : highOut
    return noLod.select(far, fade.mul(capFade))
  }
  function attachPrimitive(primitive: FoliagePrimitive, lane: number) {
    const geometry = new InstancedBufferGeometry()
    geometry.copy(primitive.geometry as unknown as InstancedBufferGeometry)
    geometry.instanceCount = count
    const argumentOffset = HEADER + drawRecords.length * 5
    drawRecords.push({ lane, indices: primitive.geometry.index!.count })
    geometry.setIndirect(indirect, argumentOffset * 4)
    geometries.push(geometry)
    const material = renderer.library.fromMaterial(primitive.material.clone()) as MeshStandardNodeMaterial
    if (!material) throw new Error(`Unsupported foliage material: ${primitive.material.type}`)
    material.name = `${primitive.material.name} · foliage ${lane}`
    const transform = matrixRead[lane]!.element(instanceIndex)
    const root = element(transform, 3).xyz
    const scale = element(transform, 0).xyz.length()
    const height = max(positionGeometry.y.sub(model.box.min.y).div(Math.max(model.height, 0.001)), 0)
    const transformedNormal = transformNormal(normalGeometry, transform)
    const windOffset = (field: typeof wind) => {
      const strength = field.sample(root.xz)
      const sway = field.direction.mul(strength).mul(height.mul(height)).mul(model.height * windStrength).mul(scale)
      const flutter = sin(field.time.mul(2.1).add(positionGeometry.x.mul(2.3)).add(root.x.mul(0.12))).mul(height).mul(strength).mul(windStrength * 0.3).mul(scale)
      return vec3(sway.x, 0, sway.y).add(transformedNormal.mul(flutter))
    }
    material.positionNode = Fn(() => {
      normalLocal.assign(transformedNormal)
      const base = transform.mul(vec4(positionGeometry, 1)).xyz
      positionPrevious.assign(base.add(windOffset(previousWind)))
      return base.add(windOffset(wind))
    })()
    if (options.tint) material.colorNode = vec4((material.colorNode ?? materialColor) as Node<'vec4'>).mul(vec4(tintAt(root), 1))
    const distance = varying(viewer.sub(root).length())
    const domainWeight = options.coverage ? forestDomainWeight(options.coverage, root.xz) : float(1)
    const fade = fadeFor(lane, distance as unknown as Node<'float'>).mul(domainWeight)
    material.maskNode = landscapeDither(screenCoordinate.xy).lessThan(fade)
    material.maskShadowNode = material.maskNode
    material.alphaToCoverage = options.alphaToCoverage === true && material.alphaTest > 0
    const palette = uniform(new Color(lane === 0 || lane === 3 ? '#62d995' : '#f2c45a'))
    material.outputNode = vec4(mix(output.rgb, palette, lodView), output.a)
    const mesh = new Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.receiveShadow = true
    mesh.castShadow = lane >= 3
    if (lane >= 3) mesh.layers.set(options.shadowLayer ?? 2)
    mesh.name = `${model.name} · ${lane >= 3 ? 'shadow' : 'view'} · ${primitive.name}`
    materials.push(material)
    object.add(mesh)
  }
  for (const primitive of model.primitives) attachPrimitive(primitive, 0)
  if (lod) for (const primitive of lod.primitives) attachPrimitive(primitive, 1)
  function attachImpostor(lane: number) {
    if (!impostor) return
    const shadow = lane >= 3
    const plane = new PlaneGeometry(1, 1)
    const geometry = new InstancedBufferGeometry()
    geometry.copy(plane as unknown as InstancedBufferGeometry)
    geometry.instanceCount = count
    const argumentOffset = HEADER + drawRecords.length * 5
    drawRecords.push({ lane, indices: plane.index!.count })
    geometry.setIndirect(indirect, argumentOffset * 4)
    geometries.push(geometry)
    const transform = matrixRead[lane]!.element(instanceIndex)
    const material = createImpostorMaterial({
      atlas: impostor, wind: options.wind,
      range: [meshRange[0], meshRange[1], shadow ? shadowDistance * 0.9 : options.range[0], shadow ? shadowDistance : options.range[1]],
      distanceOrigin: viewer, orthographic: shadow,
      alphaToCoverage: options.alphaToCoverage, singleFrame: options.singleFrame, blur: options.impostorBlur,
      farTint: options.impostorFarTint, lodView,
      tintNode: tintAt(element<'vec3'>(transform, 3).xyz),
      coverageNode: options.coverage ? forestDomainWeight(options.coverage, element(transform, 3).xz) : undefined,
      previousCamera: previousViewer, previousWindTime: previousTime,
      instance: vec4(element(transform, 3).xyz, atan(element(transform, 2).x, element(transform, 0).x)),
      scale: element(transform, 0).xyz.length(),
    })
    const mesh = new Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.receiveShadow = !shadow
    mesh.castShadow = shadow
    if (shadow) mesh.layers.set(options.shadowLayer ?? 2)
    mesh.name = `${model.name} · ${shadow ? 'shadow' : 'view'} impostors`
    materials.push(material)
    object.add(mesh)
    plane.dispose()
  }
  attachImpostor(2)
  if (shadowDistance > 0) {
    for (const primitive of model.primitives) attachPrimitive(primitive, 3)
    if (lod) for (const primitive of lod.primitives) attachPrimitive(primitive, 4)
    attachImpostor(5)
  }
  function createComputeSequence(shadow: boolean) {
    const lanes = shadow ? [3, 4, 5] : [0, 1, 2]
    const planes = shadow ? shadowPlanes : frustumPlanes
    const reset = Fn(() => {
      if (!shadow) for (const index of [0, 1, 2, 3, 9]) atomicStore(counters.element(index), uint(0))
      for (const lane of lanes) atomicStore(counters.element(16 + lane), uint(0))
    })().compute(1)
    const cull = Fn(() => {
      const pose = source.element(instanceIndex.mul(2))
      const params = source.element(instanceIndex.mul(2).add(1))
      const scale = params.x
      If(scale.lessThanEqual(0), () => { Return() })
      const distance = viewer.sub(pose.xyz).length().toVar()
      If(distance.greaterThanEqual(shadow ? shadowDistance : options.range[1]), () => { Return() })
      If(lodEnabled.equal(0).or(cullingEnabled.equal(0)).and(distance.greaterThanEqual(fallbackDistance)), () => {
        if (!shadow) atomicAdd(counters.element(9), uint(1))
        Return()
      })
      const c = cos(pose.w).toVar()
      const s = sin(pose.w).toVar()
      const transform = mat4(vec4(c.mul(scale), 0, s.negate().mul(scale), 0), vec4(0, scale, 0, 0), vec4(s.mul(scale), 0, c.mul(scale), 0), vec4(pose.xyz, 1)).toVar()
      const centre = pose.xyz.add(vec3(c.mul(boundCentre.x).add(s.mul(boundCentre.z)), boundCentre.y, s.negate().mul(boundCentre.x).add(c.mul(boundCentre.z))).mul(scale))
      const radius = scale.mul(boundRadius)
      const inside = bool(true).toVar()
      If(cullingEnabled.greaterThan(0), () => {
        Loop(6, ({ i }) => {
          const plane = planes.element(i) as unknown as Node<'vec4'>
          If(plane.xyz.dot(centre).add(plane.w).lessThan(radius.negate()), () => { inside.assign(false) })
        })
      })
      const append = (lane: number, condition: Node<'bool'>) => {
        If(condition, () => {
          if (!shadow) {
            atomicAdd(counters.element(0), uint(1))
            atomicAdd(counters.element(2), uint(triangleCounts[lane]!))
          }
          If(inside, () => {
            const slot = atomicAdd(counters.element(16 + lane), uint(1)).toVar()
            matrixWrite[lane]!.element(slot).assign(transform)
            if (!shadow) {
              atomicAdd(counters.element(1), uint(1))
              atomicAdd(counters.element(3), uint(triangleCounts[lane]!))
            }
          })
        })
      }
      const normal = lodEnabled.greaterThan(0)
      const meshEnd = shadow && !impostor ? shadowDistance : meshRange[1]
      const firstLane = shadow ? 3 : 0
      append(firstLane, normal.select(distance.lessThan(lod ? Math.min(lodRange[1], meshEnd) : meshEnd), bool(true)) as Node<'bool'>)
      if (lod) append(firstLane + 1, normal.and(distance.greaterThan(lodRange[0])).and(distance.lessThan(meshEnd)) as Node<'bool'>)
      if (impostor) append(firstLane + 2, normal.and(distance.greaterThan(meshRange[0])) as Node<'bool'>)
    })().compute(count, [64])
    const finalize = Fn(() => {
      for (let index = 0; index < drawRecords.length; index++) {
        const draw = drawRecords[index]!
        if ((draw.lane >= 3) !== shadow) continue
        const offset = HEADER + index * 5
        atomicStore(counters.element(offset), uint(draw.indices))
        atomicStore(counters.element(offset + 1), atomicLoad(counters.element(16 + draw.lane)))
        atomicStore(counters.element(offset + 2), uint(0))
        atomicStore(counters.element(offset + 3), uint(0))
        atomicStore(counters.element(offset + 4), uint(0))
      }
    })().compute(1)
    const label = `Foliage ${model.name}${shadow ? ' shadow' : ''}`
    reset.name = `${label}: reset`
    cull.name = `${label}: select`
    finalize.name = `${label}: draw counts`
    return [reset, cull, finalize]
  }
  const computeSequence = createComputeSequence(false)
  const shadowComputeSequence = shadowDistance > 0 ? createComputeSequence(true) : []
  const frustum = new Frustum()
  const projection = new Matrix4()
  const stats: GpuFoliageStats = { population: count, candidateInstances: 0, drawnInstances: 0, culledInstances: 0, sceneTriangles: 0, drawnTriangles: 0, fullDetailTriangles: count * model.triangles, near: 0, middle: 0, impostors: 0, shadows: 0, cappedInstances: 0 }
  let pending: Promise<GpuFoliageStats> | null = null
  let lastRead = 0
  let disposed = false
  const readStats = () => {
    if (pending) return pending
    pending = renderer.getArrayBufferAsync(indirect, null, 0, HEADER * 4).then(buffer => {
      const values = new Uint32Array(buffer)
      if (!disposed) Object.assign(stats, {
        candidateInstances: values[0]!, drawnInstances: values[1]!, culledInstances: values[0]! - values[1]!,
        sceneTriangles: values[2]!, drawnTriangles: values[3]!, near: values[16]!, middle: values[17]!,
        impostors: values[18]!, shadows: values[19]! + values[20]! + values[21]!, cappedInstances: values[9]!,
      })
      return stats
    }).finally(() => { pending = null })
    return pending
  }
  return {
    object, materials, stats, fallbackDistance, readStats,
    updatePlacements(startInstance = 0, instanceCount = count) {
      if (startInstance < 0 || instanceCount < 0 || startInstance + instanceCount > count) throw new Error('Foliage placement update exceeds its fixed capacity')
      sourceAttribute.addUpdateRange(startInstance * 8, instanceCount * 8)
      sourceAttribute.needsUpdate = true
    },
    setLodView(enabled: boolean) { lodView.value = enabled ? 1 : 0 },
    setLodEnabled(enabled: boolean) { lodEnabled.value = enabled ? 1 : 0 },
    setCullingEnabled(enabled: boolean) { cullingEnabled.value = enabled ? 1 : 0 },
    prepareShadow(shadowRenderer: WebGPURenderer, camera: Camera) {
      if (!shadowComputeSequence.length) return
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      frustum.setFromProjectionMatrix(projection, camera.coordinateSystem)
      for (let i = 0; i < 6; i++) {
        const plane = frustum.planes[i]!
        const target = shadowPlanes.array[i] as Vector4
        target.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant)
      }
      shadowRenderer.compute(shadowComputeSequence)
    },
    update(camera: Camera) {
      previousTime.value = lastWindTime
      lastWindTime = options.wind.time
      previousViewer.value.copy(viewer.value)
      viewer.value.setFromMatrixPosition(camera.matrixWorld)
      if (!hasPreviousViewer) { previousViewer.value.copy(viewer.value); hasPreviousViewer = true }
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      frustum.setFromProjectionMatrix(projection, camera.coordinateSystem)
      for (let i = 0; i < 6; i++) {
        const plane = frustum.planes[i]!
        const target = frustumPlanes.array[i] as Vector4
        target.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant)
      }
      renderer.compute(computeSequence)
      const now = performance.now()
      if (!pending && now - lastRead > 500) {
        lastRead = now
        void readStats().catch(error => console.error('Foliage telemetry readback failed', error))
      }
    },
    dispose() {
      disposed = true
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
      for (const compute of [...computeSequence, ...shadowComputeSequence]) compute.dispose()
    },
  }
}
