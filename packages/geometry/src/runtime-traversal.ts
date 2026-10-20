import { IndirectStorageBufferAttribute, StorageBufferAttribute } from 'three/webgpu'
import type { ComputeNode, Node, WebGPURenderer } from 'three/webgpu'
import { Fn, If, Loop, atomicAdd, atomicLoad, atomicStore, bool, dot, instanceIndex, max, min, storage, uint, uintBitsToFloat, uvec2, uvec4, vec4 } from 'three/tsl'
import { DRAW_ARGUMENT_OFFSET, DRAW_ARGUMENT_STRIDE, FRONTIER_CAPACITY, GROUP_CAPACITY, SELECTED_CAPACITY, SELECTION_WORK_BUDGET, uploadAttributes, type PackedMeshletScene } from './runtime-data'
import { clusterReader, instanceReader } from './runtime-layout'
import { ClusterIndices } from './runtime-indices'

type SphereTest = (sphere: Node<'vec4'>) => Node<'bool'>

export class ClusterTraversal {
  readonly counters: IndirectStorageBufferAttribute
  readonly visible: StorageBufferAttribute
  readonly residentBytes: number
  readonly indices: ClusterIndices
  private readonly dispatch = new IndirectStorageBufferAttribute(new Uint32Array(3), 1)
  private readonly reset
  private readonly seed
  private readonly evaluate
  private readonly evaluateDispatch
  private readonly visibilityDispatch
  private readonly visibility
  private readonly recovery
  private readonly steps
  private readonly nodes
  private readonly selections = new Map<number, ComputeNode[]>()
  private readonly buffers: StorageBufferAttribute[]

  constructor(packed: PackedMeshletScene, world: Node<'mat4'>, worldScale: Node<'float'>,
    planes: ReturnType<typeof import('three/tsl').uniformArray>,
    projectedError: (sphere: Node<'vec4'>, error: Node<'float'>, scale: Node<'float'>) => Node<'float'>,
    threshold: Node<'float'>, lodEnabled: Node<'bool'>, reach: Node<'float'>, eye: Node<'vec3'>,
    previousHidden: SphereTest, currentHidden: SphereTest, triangleBudget: number, coarsestError: Node<'float'>, label = 'View') {
    const count = DRAW_ARGUMENT_OFFSET + packed.drawCount * DRAW_ARGUMENT_STRIDE
    this.counters = new IndirectStorageBufferAttribute(new Uint32Array(count), 1)
    this.visible = new StorageBufferAttribute(SELECTED_CAPACITY, 4, Uint32Array)
    const leafAttribute = new StorageBufferAttribute(GROUP_CAPACITY, 2, Uint32Array)
    const queues = [new StorageBufferAttribute(FRONTIER_CAPACITY, 2, Uint32Array), new StorageBufferAttribute(FRONTIER_CAPACITY, 2, Uint32Array)]
    const counters = storage(this.counters, 'uint', count).toAtomic()
    this.indices = new ClusterIndices(packed, counters, this.visible, triangleBudget, threshold, lodEnabled, coarsestError, label)
    const leaves = storage(leafAttribute, 'uvec2', GROUP_CAPACITY)
    const queue = queues.map(attribute => storage(attribute, 'uvec2', FRONTIER_CAPACITY))
    const nodes = storage(packed.nodes, 'uvec4', packed.nodes.count).toReadOnly()
    const info = storage(packed.instanceInfo, 'uvec4', packed.instanceCount).toReadOnly()
    const bounds = storage(packed.instanceBounds, 'vec4', packed.instanceCount).toReadOnly()
    const materials = storage(packed.materialMap, 'uint', packed.materialMap.count).toReadOnly()
    const readInstance = instanceReader(packed.instances)
    const readCluster = clusterReader(packed.clusters)
    const dispatch = storage(this.dispatch, 'uint', 3)
    const visible = storage(this.visible, 'uvec4', SELECTED_CAPACITY)
    const sphereWorld = Fn(([sphere, transform, scale]) => vec4(world.mul(transform).mul(vec4(sphere.xyz, 1)).xyz, sphere.w.mul(scale).mul(worldScale)))
    const inside = Fn(([sphere]) => {
      const result = bool(true).toVar()
      Loop(6, ({ i }) => {
        const plane = planes.element(i)
        If(dot(plane.xyz, sphere.xyz).add(plane.w).lessThan(sphere.w.negate()), () => { result.assign(false) })
      })
      return result
    })
    const overflow = () => { atomicAdd(counters.element(20), uint(1)) }
    const admit = Fn(([size]) => {
      const allowed = bool(true).toVar()
      If(atomicLoad(counters.element(2)).lessThan(3), () => {
        const total = atomicLoad(counters.element(21)).add(size).toVar()
        If(total.lessThanEqual(SELECTION_WORK_BUDGET - packed.coarsest.work), () => { atomicStore(counters.element(21), total) }).Else(() => { allowed.assign(false); overflow() })
      })
      return allowed
    })
    const writeDispatch = (size: Node<'uint'>) => {
      const groups = size.add(63).div(64)
      dispatch.element(0).assign(min(groups, uint(65535)))
      dispatch.element(1).assign(max(groups.add(65534).div(65535), uint(1)))
      dispatch.element(2).assign(1)
    }
    this.reset = Fn(() => {
      writeDispatch(uint(0))
      If(this.indices.active, () => {
        Loop({ start: 0, end: 2 }, ({ i }) => { atomicStore(counters.element(i), uint(0)) })
        Loop({ start: 4, end: 11 }, ({ i }) => { atomicStore(counters.element(i), uint(0)) })
        Loop({ start: 12, end: 21 }, ({ i }) => { atomicStore(counters.element(i), uint(0)) })
        atomicStore(counters.element(22), uint(0))
        atomicStore(counters.element(23), uint(0))
        If(atomicLoad(counters.element(2)).equal(3), () => { atomicAdd(counters.element(21), uint(packed.coarsest.work)) })
        Loop(packed.drawCount * DRAW_ARGUMENT_STRIDE, ({ i }) => { atomicStore(counters.element(uint(DRAW_ARGUMENT_OFFSET).add(uint(i))), uint(0)) })
        If(admit(uint(packed.instanceCount)), () => { writeDispatch(uint(packed.instanceCount)) })
      })
    })().compute(1).setName(`${label} Root restart`)
    this.seed = Fn(() => {
      If(instanceIndex.lessThan(packed.instanceCount), () => {
        const id = instanceIndex
        atomicAdd(counters.element(13), uint(1))
        const sphere = bounds.element(id)
        const transformed = vec4(world.mul(vec4(sphere.xyz, 1)).xyz, sphere.w.mul(worldScale)).toVar()
        If(inside(transformed), () => {
          const entry = info.element(id).toVar()
          const slot = atomicAdd(counters.element(0), entry.y)
          If(slot.add(entry.y).lessThanEqual(FRONTIER_CAPACITY), () => {
            Loop({ start: uint(0), end: entry.y, type: 'uint', condition: '<' }, ({ i }) => { queue[0]!.element(slot.add(i)).assign(uvec2(entry.x.add(i), id)) })
          }).Else(overflow)
        }).Else(() => { atomicAdd(counters.element(14), uint(1)) })
      })
    })().computeKernel([64]).setName(`${label} Instance broad phase`)
    this.seed.dispatchSize = this.dispatch as unknown as number[]
    this.steps = [0, 1].map(input => {
      const output = 1 - input
      const prepare = Fn(() => {
        const size = atomicLoad(counters.element(input)).toVar()
        writeDispatch(uint(0))
        atomicStore(counters.element(output), uint(0))
        If(this.indices.active.and(atomicLoad(counters.element(20)).equal(0)), () => {
          If(size.lessThanEqual(FRONTIER_CAPACITY), () => { If(admit(size), () => { writeDispatch(size) }) }).Else(overflow)
        })
      })().compute(1).setName(`${label} Traversal dispatch`)
      const visit = Fn(() => {
        If(instanceIndex.lessThan(atomicLoad(counters.element(input))), () => {
          atomicAdd(counters.element(18), uint(1))
          const task = queue[input]!.element(instanceIndex).toVar()
          const instance = readInstance(task.y)
          const node = task.x.mul(3)
          const sphere = sphereWorld(uintBitsToFloat(nodes.element(node)), instance.transform, instance.scale.x).toVar()
          const error = uintBitsToFloat(nodes.element(node.add(1))).x
          const effectiveThreshold = this.indices.threshold.toVar()
          const effectiveLod = lodEnabled.or(effectiveThreshold.greaterThan(0))
          const refine = effectiveLod.not().or(projectedError(sphere, error, instance.scale.x).greaterThan(effectiveThreshold))
          const withinReach = lodEnabled.or(eye.sub(sphere.xyz).length().sub(sphere.w).lessThanEqual(reach))
          If(inside(sphere).and(refine).and(withinReach), () => {
            const record = nodes.element(node.add(2)).toVar()
            If(record.x.equal(0xffffffff), () => {
              const slot = atomicAdd(counters.element(output), record.z)
              If(slot.add(record.z).lessThanEqual(FRONTIER_CAPACITY), () => {
                Loop({ start: uint(0), end: record.z, type: 'uint', condition: '<' }, ({ i }) => { queue[output]!.element(slot.add(i)).assign(uvec2(record.y.add(i), task.y)) })
              }).Else(overflow)
            }).Else(() => {
              const slot = atomicAdd(counters.element(22), uint(1))
              atomicAdd(counters.element(23), record.y)
              If(slot.lessThan(GROUP_CAPACITY), () => { leaves.element(slot).assign(task) }).Else(overflow)
            })
          })
        })
      })().computeKernel([64]).setName(`${label} Group hierarchy traversal`)
      visit.dispatchSize = this.dispatch as unknown as number[]
      return { prepare, visit }
    })
    this.evaluateDispatch = Fn(() => {
      writeDispatch(uint(0))
      If(this.indices.active.and(atomicLoad(counters.element(20)).equal(0)), () => {
        const size = atomicLoad(counters.element(22)).toVar()
        If(size.lessThanEqual(GROUP_CAPACITY), () => { If(admit(atomicLoad(counters.element(23))), () => { writeDispatch(size) }) }).Else(overflow)
      })
    })().compute(1).setName(`${label} Group cut dispatch`)
    this.evaluate = Fn(() => {
      If(instanceIndex.lessThan(atomicLoad(counters.element(22))), () => {
        const leaf = leaves.element(instanceIndex).toVar()
        const group = nodes.element(leaf.x.mul(3).add(2)).toVar()
        {
          const instance = readInstance(leaf.y)
          const effectiveThreshold = this.indices.threshold.toVar()
          const effectiveLod = lodEnabled.or(effectiveThreshold.greaterThan(0))
          Loop({ start: uint(0), end: group.y, type: 'uint', condition: '<' }, ({ i }) => {
            atomicAdd(counters.element(19), uint(1))
            const task = uvec2(group.x.add(i), leaf.y).toVar()
            const cluster = readCluster(task.x)
            const own = sphereWorld(cluster.selfSphere, instance.transform, instance.scale.x)
            const parent = sphereWorld(cluster.parentSphere, instance.transform, instance.scale.x)
            const sphere = sphereWorld(cluster.bounds, instance.transform, instance.scale.x).toVar()
            const batch = materials.element(uint(instance.scale.z).add(cluster.material)).toVar()
            const cut = projectedError(own, cluster.errors.x, instance.scale.x).lessThanEqual(effectiveThreshold).and(projectedError(parent, cluster.errors.y, instance.scale.x).greaterThan(effectiveThreshold))
            const finest = cluster.refinedGroup.equal(0xffffffff)
            const withinReach = lodEnabled.or(eye.sub(sphere.xyz).length().sub(sphere.w).lessThanEqual(reach))
            If(batch.notEqual(0xffffffff).and(withinReach).and(effectiveLod.select(cut, finest)), () => {
              atomicAdd(counters.element(4), uint(1))
              atomicAdd(counters.element(12), cluster.draw.y.div(3))
              If(inside(sphere), () => {
                const slot = atomicAdd(counters.element(10), uint(1))
                If(slot.lessThan(SELECTED_CAPACITY), () => {
                  visible.element(slot).assign(uvec4(task, uint(0xffffffff), batch))
                  atomicAdd(counters.element(9), cluster.draw.y.div(3))
                }).Else(overflow)
              }).Else(() => { atomicAdd(counters.element(5), uint(1)) })
            })
          })
        }
      })
    })().computeKernel([64]).setName(`${label} Group cut`)
    this.evaluate.dispatchSize = this.dispatch as unknown as number[]
    this.visibilityDispatch = Fn(() => {
      writeDispatch(uint(0))
      If(this.indices.active.not(), () => { writeDispatch(atomicLoad(counters.element(10))) })
    })().compute(1).setName(`${label} Visibility dispatch`)
    this.visibility = Fn(() => {
      If(instanceIndex.lessThan(atomicLoad(counters.element(10))), () => {
        const candidate = visible.element(instanceIndex).toVar()
        const cluster = readCluster(candidate.x)
        const instance = readInstance(candidate.y)
        const sphere = sphereWorld(cluster.bounds, instance.transform, instance.scale.x).toVar()
        const recovering = atomicLoad(counters.element(3)).greaterThan(0)
        const hidden = recovering.select(currentHidden(sphere), previousHidden(sphere))
        If(hidden, () => {
          If(recovering, () => { atomicAdd(counters.element(7), uint(1)) }).Else(() => { atomicAdd(counters.element(6), uint(1)) })
          visible.element(instanceIndex).z.assign(uint(0xffffffff))
        }).Else(() => {
          const argument = uint(DRAW_ARGUMENT_OFFSET).add(candidate.w.mul(DRAW_ARGUMENT_STRIDE))
          visible.element(instanceIndex).z.assign(atomicAdd(counters.element(argument), cluster.draw.y))
          atomicAdd(counters.element(0), uint(1))
          atomicAdd(counters.element(9), cluster.draw.y.div(3))
          If(recovering.and(candidate.z.equal(0xffffffff)), () => { atomicAdd(counters.element(8), uint(1)) })
        })
      })
    })().computeKernel([64]).setName(`${label} Stable cut visibility`)
    this.visibility.dispatchSize = this.dispatch as unknown as number[]
    this.recovery = [this.indices.resume, this.indices.visibilityBegin, this.visibilityDispatch, this.visibility, ...this.indices.finish]
    this.nodes = [this.reset, this.seed, this.evaluate, this.evaluateDispatch, this.visibilityDispatch, this.visibility, ...this.steps.flatMap(step => [step.prepare, step.visit])]
    this.buffers = [this.counters, this.visible, leafAttribute, ...queues, this.dispatch]
    this.residentBytes = this.indices.residentBytes + this.buffers.reduce((sum, attribute) => sum + attribute.array.byteLength, 0)
  }

  async upload(renderer: WebGPURenderer) {
    await uploadAttributes(renderer, this.buffers)
    await this.indices.upload(renderer)
    for (const node of this.nodes) await renderer.compileComputeAsync(node)
  }

  select(renderer: WebGPURenderer, depth: number) { renderer.compute(this.sequence(depth)) }

  recover(renderer: WebGPURenderer) { renderer.compute(this.recovery) }

  private sequence(depth: number) {
    const cache = this.selections
    let nodes = cache.get(depth)
    if (!nodes) {
      const traversal: ComputeNode[] = [this.reset, this.seed]
      for (let i = 0; i < depth; i++) traversal.push(this.steps[i % 2]!.prepare, this.steps[i % 2]!.visit)
      traversal.push(this.evaluateDispatch, this.evaluate, this.indices.check)
      nodes = [this.indices.begin, ...traversal, ...this.indices.retries.flatMap(retry => [retry, ...traversal]), this.indices.visibilityBegin, this.visibilityDispatch, this.visibility, ...this.indices.finish]
      cache.set(depth, nodes)
    }
    return nodes
  }

  dispose() {
    for (const node of this.nodes) node.dispose()
    this.indices.dispose()
  }
}
