import { IndirectStorageBufferAttribute, ReadbackBuffer, StorageBufferAttribute } from 'three/webgpu'
import type { Node, WebGPURenderer } from 'three/webgpu'
import { Fn, If, Loop, abs, atomicMin, atomicStore, clamp, float, floor, instanceIndex, log2, max, min, storage, uint, vec2, vec4 } from 'three/tsl'
import { uploadAttributes, type PackedMeshletScene } from './runtime-data'
import { clusterReader, instanceReader, vertexReader } from './runtime-layout'
import type { ResidencyLedger } from './residency'

export interface TextureDemandBinding {
  image: number
  uv: 0 | 1 | 2
  scale: number
  placementScale: boolean
}

export interface MeshletTextureFeedback {
  imageCount: number
  materials: ReadonlyMap<object, readonly TextureDemandBinding[]>
  ledger: ResidencyLedger
  frame: number
  consume(mips: Uint32Array, serial: number): void
}

export class ClusterTextureFeedback {
  readonly residentBytes: number
  private readonly density
  private readonly reset
  private readonly gather
  private readonly buffers: StorageBufferAttribute[]
  private readonly dispatch = new IndirectStorageBufferAttribute(new Uint32Array(3), 1)
  private readonly snapshot: StorageBufferAttribute
  private readonly slots: { target: ReadbackBuffer; busy: boolean }[]
  private sampledFrame = -4
  private disposed = false
  private lastCounters: Uint32Array

  constructor(packed: PackedMeshletScene, visibleAttribute: StorageBufferAttribute, countersAttribute: StorageBufferAttribute,
    world: Node<'mat4'>, worldScale: Node<'float'>, eye: Node<'vec3'>, projection: Node<'float'>, readonly feedback: MeshletTextureFeedback) {
    const counterCount = countersAttribute.count
    const count = counterCount + feedback.imageCount
    this.lastCounters = new Uint32Array(counterCount)
    this.snapshot = new StorageBufferAttribute(count, 1, Uint32Array)
    this.slots = Array.from({ length: 3 }, () => ({ target: new ReadbackBuffer(count * 4), busy: false }))
    const densityAttribute = new StorageBufferAttribute(packed.clusterCount, 2)
    const ranges = new Uint32Array(packed.batches.length * 2)
    const records: number[] = []
    packed.batches.forEach((batch, index) => {
      const bindings = feedback.materials.get(batch.material) ?? []
      ranges.set([records.length / 4, bindings.length], index * 2)
      for (const binding of bindings) records.push(binding.image, binding.uv, binding.scale, Number(binding.placementScale))
    })
    const recordAttribute = new StorageBufferAttribute(new Float32Array(records.length ? records : [0, 0, 1, 0]), 4)
    const rangeAttribute = new StorageBufferAttribute(ranges, 2)
    this.buffers = [densityAttribute, recordAttribute, rangeAttribute, this.snapshot, this.dispatch]
    this.residentBytes = this.buffers.reduce((sum, buffer) => sum + buffer.array.byteLength, 0) + count * 12
    const densities = storage(densityAttribute, 'vec2', packed.clusterCount)
    const readCluster = clusterReader(packed.clusters)
    const readInstance = instanceReader(packed.instances)
    const readVertex = vertexReader(storage(packed.vertices, 'uint', packed.vertices.count).toReadOnly())
    const references = storage(packed.vertexReferences, 'uint', packed.vertexReferences.count).toReadOnly()
    const indices = storage(packed.indices, 'uint', packed.indices.count).toReadOnly()
    const readIndex = (index: Node<'uint'>) => indices.element(index.shiftRight(2)).shiftRight(index.bitAnd(3).mul(8)).bitAnd(255)
    this.density = Fn(() => {
      const cluster = readCluster(instanceIndex)
      const density = vec2(0).toVar()
      Loop({ start: uint(0), end: cluster.draw.y, type: 'uint', update: 3 }, ({ i }) => {
        const vertices = [0, 1, 2].map(corner => readVertex(references.element(cluster.draw.w.add(readIndex(cluster.draw.x.add(i).add(corner)))), cluster))
        const edge0 = vertices[1]!.position.sub(vertices[0]!.position).toVar()
        const edge1 = vertices[2]!.position.sub(vertices[0]!.position).toVar()
        const area = edge0.cross(edge1).length().toVar()
        If(area.greaterThan(0.000000000001), () => {
          const length = edge0.length().toVar()
          const x = edge0.dot(edge1).div(length).toVar()
          const y = area.div(length).toVar()
          for (const [channel, field] of ['uv', 'secondaryUv'].entries()) {
            const uv0 = vertices[1]![field as 'uv' | 'secondaryUv'].sub(vertices[0]![field as 'uv' | 'secondaryUv']).toVar()
            const uv1 = vertices[2]![field as 'uv' | 'secondaryUv'].sub(vertices[0]![field as 'uv' | 'secondaryUv']).toVar()
            const u = uv0.div(length).toVar()
            const v = uv1.sub(u.mul(x)).div(y).toVar()
            const a = u.dot(u), b = u.dot(v), c = v.dot(v)
            const difference = a.sub(c)
            const major = a.add(c).add(difference.mul(difference).add(b.mul(b).mul(4)).sqrt()).mul(0.5).toVar()
            const value = float(0).toVar()
            If(major.greaterThan(0), () => {
              const minor = max(a.mul(c).sub(b.mul(b)).div(major), 0)
              value.assign(float(1).div(max(minor.sqrt(), major.sqrt().div(8))))
            })
            density.element(channel).assign(max(density.element(channel), value))
          }
        })
      })
      densities.element(instanceIndex).assign(density)
    })().compute(packed.clusterCount, [64]).setName('Texture UV density bounds')
    const counters = storage(countersAttribute, 'uint', counterCount).toReadOnly()
    const snapshot = storage(this.snapshot, 'uint', count).toAtomic()
    const dispatch = storage(this.dispatch, 'uint', 3)
    this.reset = Fn(() => {
      If(instanceIndex.lessThan(counterCount), () => { atomicStore(snapshot.element(instanceIndex), counters.element(instanceIndex)) }).Else(() => {
        atomicStore(snapshot.element(instanceIndex), uint(3))
      })
      If(instanceIndex.equal(0), () => {
        const groups = min(counters.element(10), uint(visibleAttribute.count)).add(63).div(64)
        dispatch.element(0).assign(min(groups, uint(65535)))
        dispatch.element(1).assign(max(groups.add(65534).div(65535), uint(1)))
        dispatch.element(2).assign(1)
      })
    })().compute(count, [64]).setName('Selection and texture feedback snapshot')
    const visible = storage(visibleAttribute, 'uvec4', visibleAttribute.count).toReadOnly()
    const materialRanges = storage(rangeAttribute, 'uvec2', packed.batches.length).toReadOnly()
    const bindings = storage(recordAttribute, 'vec4', recordAttribute.count).toReadOnly()
    this.gather = Fn(() => {
      If(instanceIndex.lessThan(min(counters.element(10), uint(visibleAttribute.count))), () => {
        const selected = visible.element(instanceIndex).toVar()
        If(selected.z.notEqual(0xffffffff), () => {
          const cluster = readCluster(selected.x)
          const instance = readInstance(selected.y)
          const localDensity = densities.element(selected.x).toVar()
          const center = world.mul(instance.transform).mul(vec4(cluster.bounds.xyz, 1)).xyz
          const scale = instance.scale.x.mul(worldScale)
          const distance = max(eye.sub(center).length().sub(cluster.bounds.w.mul(scale)), 0.01)
          const pixelsPerWorld = projection.div(distance)
          const range = materialRanges.element(selected.w).toVar()
          Loop({ start: uint(0), end: range.y, type: 'uint', condition: '<' }, ({ i }) => {
            const binding = bindings.element(range.x.add(i)).toVar()
            const uv = uint(binding.y)
            const extent = float(1).toVar()
            If(uv.lessThan(2), () => {
              extent.assign(localDensity.element(uv).mul(scale))
            })
            If(binding.w.greaterThan(0), () => { extent.divAssign(clamp(instance.transform.element(0).xyz.length(), 0.5, 10)) })
            const required = pixelsPerWorld.mul(extent).div(max(abs(binding.z), 0.000001)).mul(1.25)
            const mip = uint(clamp(floor(log2(float(2048).div(max(required, 1)))), 0, 3))
            atomicMin(snapshot.element(uint(counterCount).add(uint(binding.x))), mip)
          })
        })
      })
    })().computeKernel([64]).setName('Selected cluster texture demand')
  }

  async upload(renderer: WebGPURenderer) {
    await uploadAttributes(renderer, this.buffers)
    await renderer.compileComputeAsync(this.density)
    renderer.compute(this.density)
    await renderer.compileComputeAsync(this.reset)
    await renderer.compileComputeAsync(this.gather)
  }

  async read(renderer: WebGPURenderer) {
    const slot = this.slots.find(slot => !slot.busy)
    const frame = this.feedback.frame
    if (!slot || frame - this.sampledFrame < 4) return this.lastCounters
    slot.busy = true
    this.sampledFrame = frame
    try {
      renderer.compute(this.reset)
      renderer.compute(this.gather, this.dispatch)
      const result = await renderer.getArrayBufferAsync(this.snapshot, slot.target)
      if (!this.disposed) {
        const values = new Uint32Array(result.buffer!)
        this.lastCounters = values.slice(0, this.lastCounters.length)
        this.feedback.consume(values.subarray(this.lastCounters.length), frame)
      }
      return this.lastCounters
    } finally {
      slot.target.release()
      slot.busy = false
      if (this.disposed) slot.target.dispose()
    }
  }

  dispose() {
    this.disposed = true
    for (const slot of this.slots) if (!slot.busy) slot.target.dispose()
    this.density.dispose()
    this.reset.dispose()
    this.gather.dispose()
  }
}
