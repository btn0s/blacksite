import { IndirectStorageBufferAttribute, StorageBufferAttribute } from 'three/webgpu'
import type { ComputeNode, Node, StorageBufferNode, WebGPURenderer } from 'three/webgpu'
import { Fn, If, Loop, atomicLoad, atomicStore, float, floatBitsToUint, instanceIndex, max, min, sqrt, storage, uint, uintBitsToFloat } from 'three/tsl'
import { DRAW_ARGUMENT_OFFSET, DRAW_ARGUMENT_STRIDE, INDEX_BUDGET_OFFSET, uploadAttributes, type PackedMeshletScene } from './runtime-data'
import { clusterReader, instanceReader } from './runtime-layout'

export class ClusterIndices {
  readonly indices: StorageBufferAttribute
  readonly threshold: Node<'float'>
  readonly residentBytes: number
  private readonly dispatch: IndirectStorageBufferAttribute
  private readonly retryDispatch = new IndirectStorageBufferAttribute(new Uint32Array(3), 1)
  private readonly begin
  private readonly activate
  private readonly check
  private readonly retries
  private readonly prefix
  private readonly compactions
  private readonly nodes
  private readonly fits = new WeakMap<ComputeNode, ComputeNode[]>()

  constructor(packed: PackedMeshletScene, counters: StorageBufferNode<'uint'>, visibleAttribute: StorageBufferAttribute,
    readonly triangleBudget: number, pixelError: Node<'float'>, lodEnabled: Node<'bool'>, coarsestError: Node<'float'>, label: string) {
    if (packed.rootTriangles > triangleBudget) throw new Error(`The ${label.toLowerCase()} index budget cannot cover the coarsest resident cut: ${packed.rootTriangles} triangles require more than ${triangleBudget}`)
    this.indices = new StorageBufferAttribute(triangleBudget * 3, 1, Uint32Array)
    this.indices.name = `${label} compacted cluster indices`
    this.dispatch = new IndirectStorageBufferAttribute(new Uint32Array(3), 1)
    const read = (field: number) => uintBitsToFloat(atomicLoad(counters.element(INDEX_BUDGET_OFFSET + field)))
    const write = (field: number, value: Node<'float'> | number) => atomicStore(counters.element(INDEX_BUDGET_OFFSET + field), floatBitsToUint(float(value)))
    this.threshold = read(0)
    const dispatch = storage(this.dispatch, 'uint', this.dispatch.count)
    const retryDispatch = storage(this.retryDispatch, 'uint', 3)
    const visible = storage(visibleAttribute, 'uvec4', packed.candidateCount).toReadOnly()
    const drawArguments = storage(counters.value, 'uint', counters.value.count).toReadOnly()
    const output = storage(this.indices, 'uint', this.indices.count)
    const readCluster = clusterReader(packed.clusters)
    const readInstance = instanceReader(packed.instances)
    this.begin = Fn(() => {
      const floor = read(1).lessThan(triangleBudget * 0.65).select(read(4).mul(0.99), read(4)).toVar()
      write(4, floor)
      write(0, max(lodEnabled.select(pixelError, float(0)), floor))
      write(1, 0)
      write(2, 0)
      write(3, 1)
    })().compute(1).setName(`${label} Index budget begin`)
    this.activate = Fn(() => { write(3, 1) })().compute(1).setName(`${label} Index budget resume`)
    this.check = Fn(() => {
      If(read(3).greaterThan(0), () => {
        const corners = uint(0).toVar()
        Loop(packed.batches.length, ({ i }) => {
          corners.addAssign(atomicLoad(counters.element(uint(DRAW_ARGUMENT_OFFSET).add(uint(i).mul(DRAW_ARGUMENT_STRIDE)))))
        })
        const triangles = float(corners).div(3)
        write(1, max(read(1), triangles))
        If(corners.greaterThan(triangleBudget * 3), () => {
          const scale = read(0).greaterThan(0).select(read(0), pixelError).mul(max(sqrt(triangles.div(triangleBudget)).mul(1.1), 1.25)).toVar()
          write(0, scale)
          write(2, read(2).add(1))
          write(5, read(5).add(1))
          write(4, scale)
        }).Else(() => { write(3, 0) })
      })
    })().compute(1).setName(`${label} Index budget fit`)
    this.retries = Array.from({ length: 3 }, (_, attempt) => Fn(() => {
      const groups = uint(0).toVar()
      If(read(3).greaterThan(0), () => {
        if (attempt === 2) write(0, max(read(0), coarsestError))
        Loop({ start: 4, end: 13 }, ({ i }) => { atomicStore(counters.element(i), uint(0)) })
        Loop(packed.batches.length * DRAW_ARGUMENT_STRIDE, ({ i }) => { atomicStore(counters.element(uint(DRAW_ARGUMENT_OFFSET).add(uint(i))), uint(0)) })
        groups.assign(atomicLoad(counters.element(22)).add(63).div(64))
      })
      retryDispatch.element(0).assign(min(groups, uint(65535)))
      retryDispatch.element(1).assign(max(groups.add(65534).div(65535), uint(1)))
      retryDispatch.element(2).assign(1)
    })().compute(1).setName(`${label} Index budget retry ${attempt + 1}`))
    this.prefix = Fn(() => {
      const start = uint(0).toVar()
      for (let index = 0; index < packed.batches.length; index++) {
        const argument = DRAW_ARGUMENT_OFFSET + index * DRAW_ARGUMENT_STRIDE
        const count = atomicLoad(counters.element(argument))
        atomicStore(counters.element(argument + 1), uint(1))
        atomicStore(counters.element(argument + 2), start)
        atomicStore(counters.element(argument + 3), uint(0))
        atomicStore(counters.element(argument + 4), uint(0))
        start.addAssign(count)
      }
    })().compute(1).setName(`${label} Index material ranges`)
    this.compactions = packed.batches.map((batch, batchIndex) => {
      const corners = Math.ceil(batch.triangles * 3 / 64) * 64
      const argument = DRAW_ARGUMENT_OFFSET + batchIndex * DRAW_ARGUMENT_STRIDE
      const indices = storage(batch.geometry.indices, 'uint', batch.geometry.indices.count).toReadOnly()
      const prepare = Fn(() => {
        const count = atomicLoad(counters.element(argument))
        const start = atomicLoad(counters.element(argument + 2))
        const changed = count.notEqual(atomicLoad(counters.element(argument + 6))).or(start.notEqual(atomicLoad(counters.element(argument + 7))))
        const groups = changed.select(atomicLoad(counters.element(argument + 5)).mul(corners / 64), uint(0))
        dispatch.element(0).assign(min(groups, uint(65535)))
        dispatch.element(1).assign(max(groups.add(65534).div(65535), uint(1)))
        dispatch.element(2).assign(1)
        atomicStore(counters.element(argument + 6), count)
        atomicStore(counters.element(argument + 7), start)
      })().compute(1).setName(`${label} Index dispatch ${batchIndex}`)
      const compact = Fn(() => {
        const localSlot = instanceIndex.div(corners)
        const corner = instanceIndex.mod(corners)
        If(localSlot.lessThan(drawArguments.element(argument + 5)), () => {
          const slot = localSlot.add(batch.offset)
          const candidate = visible.element(slot).toVar()
          If(corner.lessThan(candidate.w), () => {
            const cluster = readCluster(candidate.x)
            const instance = readInstance(candidate.y)
            const triangleCorner = corner.mod(3)
            const mirrored = triangleCorner.equal(0).select(uint(0), uint(3).sub(triangleCorner))
            const oriented = instance.scale.y.lessThan(0).select(mirrored, triangleCorner)
            const address = cluster.draw.x.add(corner.div(3).mul(3)).add(oriented)
            const localVertex = indices.element(address.div(4)).shiftRight(address.mod(4).mul(8)).bitAnd(255)
            const destination = drawArguments.element(argument + 2).add(candidate.z).add(corner)
            output.element(destination).assign(slot.shiftLeft(8).bitOr(localVertex))
          })
        })
      })().computeKernel([64]).setName(`${label} Index compaction ${batchIndex}`)
      compact.dispatchSize = this.dispatch as unknown as number[]
      return { prepare, compact }
    })
    this.nodes = [this.begin, this.activate, this.check, ...this.retries, this.prefix, ...this.compactions.flatMap(entry => [entry.prepare, entry.compact])]
    this.residentBytes = this.indices.array.byteLength + this.dispatch.array.byteLength + this.retryDispatch.array.byteLength
  }

  async upload(renderer: WebGPURenderer) {
    await uploadAttributes(renderer, [this.indices, this.dispatch, this.retryDispatch])
    for (const node of this.nodes) await renderer.compileComputeAsync(node)
  }

  start(renderer: WebGPURenderer) { renderer.compute(this.begin) }

  fit(renderer: WebGPURenderer, evaluate: ComputeNode) {
    let nodes = this.fits.get(evaluate)
    if (!nodes) {
      evaluate.dispatchSize = this.retryDispatch as unknown as number[]
      nodes = [this.activate, this.check, ...this.retries.flatMap(retry => [retry, evaluate, this.check]), this.prefix,
        ...this.compactions.flatMap(entry => [entry.prepare, entry.compact])]
      this.fits.set(evaluate, nodes)
    }
    renderer.compute(nodes)
  }

  readStats(values: Uint32Array) {
    const state = new Float32Array(values.buffer, values.byteOffset + INDEX_BUDGET_OFFSET * 4, 8)
    if (state[3]) throw new Error('The coarsest resident cut exceeded its validated index budget')
    return { triangleBudget: this.triangleBudget, requestedTriangles: state[1]!, indexOverflows: state[2]!, indexOverflowCount: state[5]!, effectivePixelError: state[0]! }
  }

  dispose() { for (const node of this.nodes) node.dispose() }
}
