import { IndirectStorageBufferAttribute, ReadbackBuffer, StorageBufferAttribute } from 'three/webgpu'
import type { Node, WebGPURenderer } from 'three/webgpu'
import { Fn, If, Loop, abs, atomicAdd, atomicLoad, atomicMin, atomicStore, clamp, float, floor, instanceIndex, invocationLocalIndex, log2, max, min, storage, uint, vec2, vec4, workgroupId } from 'three/tsl'
import { uploadAttributes, type PackedMeshletScene } from './runtime-data'
import { clusterReader, instanceReader, vertexReader } from './runtime-layout'
import type { ResidencyLedger } from './residency'

export interface TextureDemandBinding { image: number; uv: 0 | 1 | 2; scale: number; placementScale: boolean }
export interface MeshletTextureFeedback {
  imageCount: number
  materials: ReadonlyMap<object, readonly TextureDemandBinding[]>
  ledger: ResidencyLedger
  cpuStaging: ResidencyLedger
  frame: number
  bindingVersions: ReadonlyMap<object, number>
  consume(mips: Uint32Array, serial: number): void
}

type FeedbackSlot = { target: ReadbackBuffer; busy: boolean; values: Uint32Array | null; residentIds: number[]; useCursor: number; requestCursor: number; serial: number; epoch: number; pending: Promise<void> | null }
const REQUESTS = 4096

export class ClusterFeedback {
  readonly residentBytes: number
  private readonly density
  private readonly reset
  private readonly gather
  private readonly pages
  private readonly buffers: StorageBufferAttribute[]
  private readonly dispatch = new IndirectStorageBufferAttribute(new Uint32Array(3), 1)
  private readonly snapshot: StorageBufferAttribute
  private readonly slots: FeedbackSlot[]
  private sampledFrame = -4
  private disposed = false
  private failure: unknown
  private latest: { view: Uint32Array; shadow: Uint32Array } | null = null
  private requests = 0
  private overflows = 0
  private samples = 0
  private skipped = 0
  private fallbacks = 0
  private epochMismatches = 0
  private invalidMappings = 0
  private missingPinned = 0
  private readonly useOffset: number
  private readonly requestOffset: number
  private readonly mipOffset: number
  private readonly viewCount: number
  private readonly shadowCount: number
  private readonly pageCount: number

  constructor(private readonly packed: PackedMeshletScene, visibleAttribute: StorageBufferAttribute, countersAttribute: StorageBufferAttribute,
    shadowCounters: StorageBufferAttribute, world: Node<'mat4'>, worldScale: Node<'float'>, eye: Node<'vec3'>, projection: Node<'float'>, readonly feedback?: MeshletTextureFeedback) {
    this.viewCount = countersAttribute.count
    this.shadowCount = shadowCounters.count
    this.pageCount = packed.arena.table.count
    this.useOffset = 8 + this.viewCount + this.shadowCount
    this.requestOffset = this.useOffset + this.pageCount
    this.mipOffset = this.requestOffset + REQUESTS * 2
    const count = this.mipOffset + (feedback?.imageCount ?? 0)
    this.snapshot = new StorageBufferAttribute(count, 1, Uint32Array)
    this.slots = Array.from({ length: 3 }, () => ({ target: new ReadbackBuffer(count * 4), busy: false, values: null, residentIds: [], useCursor: 0, requestCursor: 0, serial: 0, epoch: 0, pending: null }))
    const densityCount = Math.ceil(packed.arena.attribute.count / 40)
    const densityAttribute = new StorageBufferAttribute(densityCount, 2)
    const densities = storage(densityAttribute, 'vec2', densityCount)
    const ranges = new Uint32Array(packed.batches.length * 2), records: number[] = []
    packed.batches.forEach((batch, index) => {
      const bindings = feedback?.materials.get(batch.material) ?? []
      ranges.set([records.length / 4, bindings.length], index * 2)
      for (const binding of bindings) records.push(binding.image, binding.uv, binding.scale, Number(binding.placementScale))
    })
    const recordAttribute = new StorageBufferAttribute(new Float32Array(records.length ? records : [0, 0, 1, 0]), 4)
    const rangeAttribute = new StorageBufferAttribute(ranges, 2)
    this.buffers = [densityAttribute, recordAttribute, rangeAttribute, this.snapshot, this.dispatch]
    this.residentBytes = this.buffers.reduce((sum, buffer) => sum + buffer.array.byteLength, 0) + count * 4 * 3
    const arena = storage(packed.arena.attribute, 'uint', packed.arena.attribute.count).toReadOnly()
    const readCluster = clusterReader(packed.arena.attribute)
    const readInstance = instanceReader(packed.instances)
    const readVertex = vertexReader(arena)
    const readIndex = (index: Node<'uint'>) => arena.element(index.shiftRight(2)).shiftRight(index.bitAnd(3).mul(8)).bitAnd(255)
    this.density = Fn(() => {
      const command = workgroupId.x.mul(4)
      const base = packed.arena.source.element(command.add(1))
      If(packed.arena.source.element(command.add(3)).greaterThan(0), () => {
        const first = base.add(arena.element(base.add(13)).div(4)).toVar()
        const count = arena.element(base.add(9)).toVar()
        Loop({ start: invocationLocalIndex, end: count, type: 'uint', condition: '<', update: 64 }, ({ i: index }) => {
          const address = first.add(index.mul(40)).toVar()
          const cluster = readCluster(address)
          const density = vec2(0).toVar()
          Loop({ start: uint(0), end: cluster.draw.y, type: 'uint', update: 3 }, ({ i }) => {
            const vertices = [0, 1, 2].map(corner => readVertex(arena.element(cluster.draw.w.add(readIndex(cluster.draw.x.add(i).add(corner)))), cluster))
            const edge0 = vertices[1]!.position.sub(vertices[0]!.position).toVar(), edge1 = vertices[2]!.position.sub(vertices[0]!.position).toVar()
            const area = edge0.cross(edge1).length().toVar()
            If(area.greaterThan(0.000000000001), () => {
              const length = edge0.length().toVar(), x = edge0.dot(edge1).div(length).toVar(), y = area.div(length).toVar()
              for (const [channel, field] of ['uv', 'secondaryUv'].entries()) {
                const uv0 = vertices[1]![field as 'uv' | 'secondaryUv'].sub(vertices[0]![field as 'uv' | 'secondaryUv']).toVar()
                const uv1 = vertices[2]![field as 'uv' | 'secondaryUv'].sub(vertices[0]![field as 'uv' | 'secondaryUv']).toVar()
                const u = uv0.div(length).toVar(), v = uv1.sub(u.mul(x)).div(y).toVar()
                const a = u.dot(u), b = u.dot(v), c = v.dot(v), difference = a.sub(c)
                const major = a.add(c).add(difference.mul(difference).add(b.mul(b).mul(4)).sqrt()).mul(0.5).toVar()
                const value = float(0).toVar()
                If(major.greaterThan(0), () => { value.assign(float(1).div(max(max(a.mul(c).sub(b.mul(b)).div(major), 0).sqrt(), major.sqrt().div(8)))) })
                density.element(channel).assign(max(density.element(channel), value))
              }
            })
          })
          densities.element(address.div(40)).assign(density)
        })
      })
    })().computeKernel([64]).setName('Geometry page texture density')
    packed.arena.setDensityCompute(this.density)
    const counters = storage(countersAttribute, 'uint', this.viewCount).toReadOnly()
    const shadows = storage(shadowCounters, 'uint', this.shadowCount).toReadOnly()
    const snapshot = storage(this.snapshot, 'uint', count).toAtomic()
    const dispatch = storage(this.dispatch, 'uint', 3)
    this.reset = Fn(() => {
      If(instanceIndex.lessThan(this.viewCount), () => { atomicStore(snapshot.element(instanceIndex.add(8)), counters.element(instanceIndex)) })
      If(instanceIndex.lessThan(this.shadowCount), () => { atomicStore(snapshot.element(instanceIndex.add(8 + this.viewCount)), shadows.element(instanceIndex)) })
      If(instanceIndex.lessThan(feedback?.imageCount ?? 0), () => { atomicStore(snapshot.element(instanceIndex.add(this.mipOffset)), uint(3)) })
      If(instanceIndex.equal(0), () => {
        atomicStore(snapshot.element(0), packed.arena.frame); atomicStore(snapshot.element(1), packed.arena.epoch)
        atomicStore(snapshot.element(2), uint(0)); atomicStore(snapshot.element(3), uint(0))
        const groups = min(counters.element(10), uint(visibleAttribute.count)).add(63).div(64)
        dispatch.element(0).assign(min(groups, uint(65535))); dispatch.element(1).assign(max(groups.add(65534).div(65535), uint(1))); dispatch.element(2).assign(1)
      })
    })().compute(Math.max(this.viewCount, this.shadowCount, feedback?.imageCount ?? 0)).setName('Streaming feedback begin')
    const activity = storage(packed.arena.activity, 'uint', packed.arena.activity.count).toAtomic()
    this.pages = Fn(() => {
      If(instanceIndex.equal(0), () => {
        for (let i = 0; i < 4; i++) {
          const address = this.pageCount * 2 + i + 1
          atomicStore(snapshot.element(4 + i), atomicLoad(activity.element(address)))
          atomicStore(activity.element(address), uint(0))
        }
      })
      If(instanceIndex.lessThan(this.pageCount), () => {
        atomicStore(snapshot.element(instanceIndex.add(this.useOffset)), atomicLoad(activity.element(instanceIndex.mul(2))))
        const importance = atomicLoad(activity.element(instanceIndex.mul(2).add(1))).toVar()
        If(importance.greaterThan(0), () => {
          const slot = atomicAdd(snapshot.element(2), uint(1))
          If(slot.lessThan(REQUESTS), () => {
            atomicStore(snapshot.element(uint(this.requestOffset).add(slot.mul(2))), instanceIndex)
            atomicStore(snapshot.element(uint(this.requestOffset + 1).add(slot.mul(2))), importance)
          }).Else(() => { atomicAdd(snapshot.element(3), uint(1)) })
          atomicStore(activity.element(instanceIndex.mul(2).add(1)), uint(0))
        })
      })
    })().compute(this.pageCount).setName('Geometry page requests and usage')
    const visible = storage(visibleAttribute, 'uvec4', visibleAttribute.count).toReadOnly()
    const materialRanges = storage(rangeAttribute, 'uvec2', packed.batches.length).toReadOnly()
    const bindings = storage(recordAttribute, 'vec4', recordAttribute.count).toReadOnly()
    this.gather = Fn(() => {
      If(instanceIndex.lessThan(min(counters.element(10), uint(visibleAttribute.count))), () => {
        const selected = visible.element(instanceIndex).toVar()
        If(selected.z.notEqual(0xffffffff), () => {
          const cluster = readCluster(selected.x), instance = readInstance(selected.y), localDensity = densities.element(selected.x.div(40)).toVar()
          const center = world.mul(instance.transform).mul(vec4(cluster.bounds.xyz, 1)).xyz
          const scale = instance.scale.x.mul(worldScale), distance = max(eye.sub(center).length().sub(cluster.bounds.w.mul(scale)), 0.01)
          const pixelsPerWorld = projection.div(distance), range = materialRanges.element(selected.w).toVar()
          Loop({ start: uint(0), end: range.y, type: 'uint', condition: '<' }, ({ i }) => {
            const binding = bindings.element(range.x.add(i)).toVar(), uv = uint(binding.y), extent = float(1).toVar()
            If(uv.lessThan(2), () => { extent.assign(localDensity.element(uv).mul(scale)) })
            If(binding.w.greaterThan(0), () => { extent.divAssign(clamp(instance.transform.element(0).xyz.length(), 0.5, 10)) })
            const required = pixelsPerWorld.mul(extent).div(max(abs(binding.z), 0.000001)).mul(1.25)
            const mip = uint(clamp(floor(log2(float(2048).div(max(required, 1)))), 0, 3))
            atomicMin(snapshot.element(uint(this.mipOffset).add(uint(binding.x))), mip)
          })
        })
      })
    })().computeKernel([64]).setName('Selected cluster texture demand')
    this.gather.dispatchSize = this.dispatch as unknown as number[]
  }

  async upload(renderer: WebGPURenderer) {
    await uploadAttributes(renderer, this.buffers)
    await Promise.all([this.reset, this.pages, this.gather].map(node => renderer.compileComputeAsync(node)))
  }

  sample(renderer: WebGPURenderer, force = false) {
    const state = this.packed.arena.residency
    if (!force && state.frame - this.sampledFrame < 4) return null
    const slot = this.slots.find(slot => !slot.busy)
    if (!slot) { this.skipped++; return null }
    slot.busy = true; slot.serial = state.frame; slot.epoch = this.packed.arena.epoch.value; this.sampledFrame = state.frame
    renderer.compute([this.reset, this.pages, this.gather])
    slot.pending = renderer.getArrayBufferAsync(this.snapshot, slot.target).then(result => {
      if (this.disposed) { slot.target.release(); slot.target.dispose(); return }
      slot.values = new Uint32Array(result.buffer!)
      if (slot.values[0] !== slot.serial || slot.values[1] !== slot.epoch) throw new Error('Geometry feedback serial or epoch disagrees with its GPU snapshot')
      state.completed = Math.max(state.completed, slot.values[0]!)
      slot.residentIds = state.residentIds.slice()
      slot.useCursor = 0; slot.requestCursor = 0
    }).catch(error => { this.failure = error; slot.target.release(); slot.busy = false })
    return slot.pending
  }

  consume(deadline: number) {
    if (this.failure) throw this.failure
    const state = this.packed.arena.residency
    for (const slot of this.slots) {
      const values = slot.values
      if (!values) continue
      while (slot.useCursor < slot.residentIds.length && performance.now() < deadline) {
        const end = Math.min(slot.useCursor + 64, slot.residentIds.length)
        while (slot.useCursor < end) { const id = slot.residentIds[slot.useCursor++]!; state.used(id, values[this.useOffset + id]!) }
      }
      if (slot.useCursor < slot.residentIds.length) return
      const count = Math.min(values[2]!, REQUESTS), floats = new Float32Array(values.buffer, values.byteOffset, values.length)
      while (slot.requestCursor < count && performance.now() < deadline) {
        const offset = this.requestOffset + slot.requestCursor++ * 2
        state.demand(values[offset]!, floats[offset + 1]!, slot.serial)
      }
      if (slot.requestCursor < count || performance.now() >= deadline) return
      this.epochMismatches += values[4]!; this.invalidMappings += values[5]!; this.missingPinned += values[6]!; this.fallbacks += values[7]!
      if (values[4] || values[5] || values[6]) throw new Error('Geometry page epoch, mapping or pinned-closure invariant failed')
      this.feedback?.consume(values.subarray(this.mipOffset), slot.serial)
      this.latest = { view: values.slice(8, 8 + this.viewCount), shadow: values.slice(8 + this.viewCount, this.useOffset) }
      this.requests += values[2]!; this.overflows += values[3]!; this.samples++
      slot.values = null; slot.residentIds.length = 0; slot.busy = false; slot.pending = null; slot.target.release()
    }
  }

  async read(renderer: WebGPURenderer) {
    if (!this.latest) { await (this.sample(renderer, true) ?? this.slots.find(slot => slot.pending)?.pending); this.consume(Infinity) }
    if (!this.latest) throw new Error('Geometry feedback has not completed')
    return this.latest
  }

  async completeFrame(renderer: WebGPURenderer) {
    for (;;) {
      const completion = this.sample(renderer, true)
      if (completion) { await completion; this.consume(Infinity); return }
      const pending = this.slots.find(slot => slot.pending)?.pending
      if (!pending) throw new Error('Geometry has no available feedback completion')
      await pending
      this.consume(Infinity)
    }
  }

  stats() { return { feedbackSamples: this.samples, feedbackSkipped: this.skipped, pageRequests: this.requests, requestOverflows: this.overflows, fallbackClusters: this.fallbacks, epochMismatches: this.epochMismatches, invalidMappings: this.invalidMappings, missingPinned: this.missingPinned } }

  dispose() {
    this.disposed = true
    for (const slot of this.slots) if (!slot.busy || slot.values) { slot.target.release(); slot.target.dispose() }
    for (const node of [this.density, this.reset, this.pages, this.gather]) node.dispose()
  }
}
