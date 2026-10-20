import { IndirectStorageBufferAttribute, StorageBufferAttribute } from 'three/webgpu'
import type { Node, WebGPURenderer } from 'three/webgpu'
import { Fn, If, Loop, atomicAdd, atomicLoad, atomicStore, bool, dot, instanceIndex, max, min, storage, uint, uintBitsToFloat, uvec2, uvec4, vec4 } from 'three/tsl'
import { DRAW_ARGUMENT_OFFSET, DRAW_ARGUMENT_STRIDE, INDEX_BUDGET_OFFSET, uploadAttributes, type PackedMeshletScene } from './runtime-data'
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
  private readonly recoverSeed
  private readonly recoverDispatch
  private readonly evaluate
  private readonly recoverEvaluate
  private readonly retryEvaluate
  private readonly evaluateDispatch
  private readonly rejectedDispatch
  private readonly evaluateRejected
  private readonly steps
  private readonly nodes
  private readonly buffers: StorageBufferAttribute[]

  constructor(packed: PackedMeshletScene, world: Node<'mat4'>, worldScale: Node<'float'>,
    planes: ReturnType<typeof import('three/tsl').uniformArray>,
    projectedError: (sphere: Node<'vec4'>, error: Node<'float'>, scale: Node<'float'>) => Node<'float'>,
    threshold: Node<'float'>, lodEnabled: Node<'bool'>, reach: Node<'float'>, eye: Node<'vec3'>,
    previousHidden: SphereTest, currentHidden: SphereTest, triangleBudget: number, coarsestError: Node<'float'>, label = 'View') {
    const capacity = packed.candidateCount
    const queueCapacity = packed.queueCapacity
    const leafCapacity = packed.leafCapacity
    const count = DRAW_ARGUMENT_OFFSET + packed.batches.length * DRAW_ARGUMENT_STRIDE
    this.counters = new IndirectStorageBufferAttribute(new Uint32Array(count), 1)
    this.visible = new StorageBufferAttribute(capacity, 4, Uint32Array)
    const rejectedAttribute = new StorageBufferAttribute(capacity, 2, Uint32Array)
    const rejectedInstancesAttribute = new StorageBufferAttribute(packed.instanceCount, 1, Uint32Array)
    const leafAttribute = new StorageBufferAttribute(leafCapacity, 2, Uint32Array)
    const queues = [new StorageBufferAttribute(queueCapacity, 2, Uint32Array), new StorageBufferAttribute(queueCapacity, 2, Uint32Array)]
    const counters = storage(this.counters, 'uint', count).toAtomic()
    this.indices = new ClusterIndices(packed, counters, this.visible, triangleBudget, threshold, lodEnabled, coarsestError, label)
    const effectiveThreshold = this.indices.threshold
    const effectiveLod = lodEnabled.or(effectiveThreshold.greaterThan(0))
    const rejected = storage(rejectedAttribute, 'uvec2', capacity)
    const rejectedInstances = storage(rejectedInstancesAttribute, 'uint', packed.instanceCount)
    const leaves = storage(leafAttribute, 'uvec2', leafCapacity)
    const queue = queues.map(attribute => storage(attribute, 'uvec2', queueCapacity))
    const nodes = storage(packed.nodes, 'uvec4', packed.nodes.count).toReadOnly()
    const info = storage(packed.instanceInfo, 'uvec4', packed.instanceCount).toReadOnly()
    const bounds = storage(packed.instanceBounds, 'vec4', packed.instanceCount).toReadOnly()
    const materials = storage(packed.materialMap, 'uint', packed.materialMap.count).toReadOnly()
    const readInstance = instanceReader(packed.instances)
    const readCluster = clusterReader(packed.clusters)
    const dispatch = storage(this.dispatch, 'uint', 3)
    const visible = storage(this.visible, 'uvec4', capacity)
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
    const seedInstance = (id: Node<'uint'>) => {
      const entry = info.element(id).toVar()
      const slot = atomicAdd(counters.element(0), entry.y)
      Loop({ start: uint(0), end: entry.y, type: 'uint', condition: '<' }, ({ i }) => {
        If(slot.add(i).lessThan(queueCapacity), () => { queue[0]!.element(slot.add(i)).assign(uvec2(entry.x.add(i), id)) }).Else(overflow)
      })
    }
    this.reset = Fn(() => {
      Loop(count, ({ i }) => {
        If(i.lessThan(INDEX_BUDGET_OFFSET).or(i.greaterThanEqual(DRAW_ARGUMENT_OFFSET)), () => { atomicStore(counters.element(i), uint(0)) })
      })
    })().compute(1).setName(`${label} Traversal reset`)
    this.seed = Fn(() => {
      const id = instanceIndex
      atomicAdd(counters.element(13), uint(1))
      const sphere = bounds.element(id)
      const transformed = vec4(world.mul(vec4(sphere.xyz, 1)).xyz, sphere.w.mul(worldScale)).toVar()
      If(inside(transformed), () => {
        If(previousHidden(transformed), () => {
          const slot = atomicAdd(counters.element(3), uint(1))
          rejectedInstances.element(slot).assign(id)
          atomicAdd(counters.element(15), uint(1))
        }).Else(() => { seedInstance(id) })
      }).Else(() => { atomicAdd(counters.element(14), uint(1)) })
    })().compute(packed.instanceCount, [64]).setName(`${label} Instance broad phase`)
    const writeDispatch = (counter: number, limit: number) => {
      const size = min(atomicLoad(counters.element(counter)), uint(limit))
      const groups = size.add(63).div(64)
      dispatch.element(0).assign(min(groups, uint(65535)))
      dispatch.element(1).assign(max(groups.add(65534).div(65535), uint(1)))
      dispatch.element(2).assign(1)
    }
    this.recoverDispatch = Fn(() => {
      atomicStore(counters.element(0), uint(0))
      atomicStore(counters.element(1), uint(0))
      atomicStore(counters.element(23), atomicLoad(counters.element(22)))
      writeDispatch(3, packed.instanceCount)
    })().compute(1).setName(`${label} Instance recovery dispatch`)
    this.recoverSeed = Fn(() => {
      If(instanceIndex.lessThan(atomicLoad(counters.element(3))), () => {
        const id = rejectedInstances.element(instanceIndex).toVar()
        const sphere = bounds.element(id)
        const transformed = vec4(world.mul(vec4(sphere.xyz, 1)).xyz, sphere.w.mul(worldScale)).toVar()
        If(currentHidden(transformed), () => { atomicAdd(counters.element(16), uint(1)) }).Else(() => {
          atomicAdd(counters.element(17), uint(1))
          seedInstance(id)
        })
      })
    })().compute(packed.instanceCount, [64]).setName(`${label} Instance recovery`)
    this.steps = [0, 1].map(input => {
      const output = 1 - input
      const prepare = Fn(() => { writeDispatch(input, queueCapacity); atomicStore(counters.element(output), uint(0)) })().compute(1).setName(`${label} Traversal dispatch`)
      const visit = Fn(() => {
        If(instanceIndex.lessThan(min(atomicLoad(counters.element(input)), uint(queueCapacity))), () => {
          atomicAdd(counters.element(18), uint(1))
          const task = queue[input]!.element(instanceIndex).toVar()
          const instance = readInstance(task.y)
          const node = task.x.mul(3)
          const sphere = sphereWorld(uintBitsToFloat(nodes.element(node)), instance.transform, instance.scale.x).toVar()
          const error = uintBitsToFloat(nodes.element(node.add(1))).x
          const refine = effectiveLod.not().or(projectedError(sphere, error, instance.scale.x).greaterThan(effectiveThreshold))
          const withinReach = lodEnabled.or(eye.sub(sphere.xyz).length().sub(sphere.w).lessThanEqual(reach))
          If(inside(sphere).and(refine).and(withinReach), () => {
            const record = nodes.element(node.add(2)).toVar()
            If(record.x.equal(0xffffffff), () => {
              const slot = atomicAdd(counters.element(output), record.z)
              Loop({ start: uint(0), end: record.z, type: 'uint', condition: '<' }, ({ i }) => {
                If(slot.add(i).lessThan(queueCapacity), () => { queue[output]!.element(slot.add(i)).assign(uvec2(record.y.add(i), task.y)) }).Else(overflow)
              })
            }).Else(() => {
              const slot = atomicAdd(counters.element(22), record.y)
              Loop({ start: uint(0), end: record.y, type: 'uint', condition: '<' }, ({ i }) => {
                If(slot.add(i).lessThan(leafCapacity), () => { leaves.element(slot.add(i)).assign(uvec2(record.x.add(i), task.y)) }).Else(overflow)
              })
            })
          })
        })
      })().compute(queueCapacity, [64]).setName(`${label} Group hierarchy traversal`)
      return { prepare, visit }
    })
    const append = (task: Node<'uvec2'>, corners: Node<'uint'>, batch: Node<'uint'>) => {
      const argument = uint(DRAW_ARGUMENT_OFFSET).add(batch.mul(DRAW_ARGUMENT_STRIDE))
      const slot = atomicAdd(counters.element(10), uint(1))
      If(slot.lessThan(capacity), () => {
        const first = atomicAdd(counters.element(argument), corners)
        visible.element(slot).assign(uvec4(task, first, batch))
        atomicAdd(counters.element(9), corners.div(3))
        atomicAdd(counters.element(11), corners.div(3))
      }).Else(overflow)
    }
    const evaluate = (recover: boolean, start: Node<'uint'> = uint(0)) => Fn(() => {
      const id = instanceIndex.add(start)
      If(id.lessThan(min(atomicLoad(counters.element(22)), uint(leafCapacity))), () => {
        atomicAdd(counters.element(19), uint(1))
        const task = leaves.element(id).toVar()
        const cluster = readCluster(task.x)
        const instance = readInstance(task.y)
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
            If(recover ? currentHidden(sphere) : previousHidden(sphere), () => {
              if (recover) atomicAdd(counters.element(7), uint(1))
              else {
                const slot = atomicAdd(counters.element(6), uint(1))
                If(slot.lessThan(capacity), () => { rejected.element(slot).assign(task) }).Else(overflow)
              }
            }).Else(() => {
              append(task, cluster.draw.y, batch)
              if (recover) atomicAdd(counters.element(8), uint(1))
            })
          }).Else(() => { atomicAdd(counters.element(5), uint(1)) })
        })
      })
    })().compute(leafCapacity, [64]).setName(`${label} ${recover ? 'Recovered group cut' : 'Group cut'}`)
    this.evaluate = evaluate(false)
    this.recoverEvaluate = evaluate(true, atomicLoad(counters.element(23)))
    this.retryEvaluate = evaluate(true)
    this.evaluateDispatch = Fn(() => { writeDispatch(22, leafCapacity) })().compute(1).setName(`${label} Group cut dispatch`)
    this.rejectedDispatch = Fn(() => { writeDispatch(6, capacity) })().compute(1).setName(`${label} Cluster recovery dispatch`)
    this.evaluateRejected = Fn(() => {
      If(instanceIndex.lessThan(min(atomicLoad(counters.element(6)), uint(capacity))), () => {
        const task = rejected.element(instanceIndex).toVar()
        const cluster = readCluster(task.x)
        const instance = readInstance(task.y)
        const batch = materials.element(uint(instance.scale.z).add(cluster.material)).toVar()
        const sphere = sphereWorld(cluster.bounds, instance.transform, instance.scale.x)
        If(currentHidden(sphere), () => { atomicAdd(counters.element(7), uint(1)) }).Else(() => {
          append(task, cluster.draw.y, batch)
          atomicAdd(counters.element(8), uint(1))
        })
      })
    })().compute(capacity, [64]).setName(`${label} Cluster recovery`)
    this.nodes = [this.reset, this.seed, this.recoverSeed, this.recoverDispatch, this.evaluate, this.recoverEvaluate, this.retryEvaluate, this.evaluateDispatch, this.rejectedDispatch, this.evaluateRejected, ...this.steps.flatMap(step => [step.prepare, step.visit])]
    this.buffers = [this.counters, this.visible, rejectedAttribute, rejectedInstancesAttribute, leafAttribute, ...queues, this.dispatch]
    this.residentBytes = this.indices.residentBytes + this.buffers.reduce((sum, attribute) => sum + attribute.array.byteLength, 0)
  }

  async upload(renderer: WebGPURenderer) {
    await uploadAttributes(renderer, this.buffers)
    await this.indices.upload(renderer)
    for (const node of this.nodes) await renderer.compileComputeAsync(node)
  }

  select(renderer: WebGPURenderer, depth: number) {
    this.indices.start(renderer)
    renderer.compute([this.reset, this.seed])
    this.traverse(renderer, depth, false)
    this.indices.fit(renderer, this.evaluate)
  }

  recover(renderer: WebGPURenderer, depth: number) {
    renderer.compute(this.recoverDispatch)
    renderer.compute(this.recoverSeed, this.dispatch)
    this.traverse(renderer, depth, true)
    renderer.compute(this.rejectedDispatch)
    renderer.compute(this.evaluateRejected, this.dispatch)
    this.indices.fit(renderer, this.retryEvaluate)
  }

  private traverse(renderer: WebGPURenderer, depth: number, recover: boolean) {
    for (let i = 0; i < depth; i++) {
      const step = this.steps[i % 2]!
      renderer.compute(step.prepare)
      renderer.compute(step.visit, this.dispatch)
    }
    renderer.compute(this.evaluateDispatch)
    renderer.compute(recover ? this.recoverEvaluate : this.evaluate, this.dispatch)
  }

  dispose() {
    for (const node of this.nodes) node.dispose()
    this.indices.dispose()
  }
}
