import { ReadbackBuffer, StorageBufferAttribute } from 'three/webgpu'
import type { ComputeNode, WebGPURenderer } from 'three/webgpu'
import { Fn, If, Loop, atomicStore, instanceIndex, invocationLocalIndex, storage, uint, uniform, uvec4, workgroupId } from 'three/tsl'
import { uploadAttributes } from './runtime-data'
import { FRAME_UPLOAD_BYTES, GEOMETRY_PAGE_BYTES, GEOMETRY_STAGING_BYTES, PageResidency } from './page-residency'
import type { PageSourceRange, ResidentPage } from './page-residency'
import { ResidencyLedger } from './residency'

const COMMANDS = 15
const COMMAND_WORDS = 256

export class GeometryPageArena {
  readonly residency: PageResidency
  readonly attribute: StorageBufferAttribute
  readonly table: StorageBufferAttribute
  readonly activity: StorageBufferAttribute
  readonly fence = new StorageBufferAttribute(4, 1, Uint32Array)
  readonly frame = uniform(0, 'uint')
  readonly epoch = uniform(0, 'uint')
  readonly count = uniform(0, 'uint')
  private readonly staging
  readonly source
  private readonly copy
  private readonly publish
  private density: ComputeNode | null = null
  private readonly dispatch = [1, 1, 1]
  private uploads: ComputeNode[]
  private uploaded = 0
  private peakUpload = 0
  private peakSchedulingMs = 0
  private lastSchedulingMs = 0
  submissionMs = 0
  private peakSubmissionMs = 0
  private epochCount = 0

  constructor(sources: readonly PageSourceRange[], readonly bytes: number, cpuStaging = new ResidencyLedger(64 * 1048576, {})) {
    if (!Number.isSafeInteger(bytes) || bytes % GEOMETRY_PAGE_BYTES) throw new Error('Geometry arena must contain whole 128 KiB pages')
    if (bytes / GEOMETRY_PAGE_BYTES < sources.reduce((sum, range) => sum + range.source.metadata.pinnedPages, 0)) throw new Error('Geometry arena cannot contain its pinned closure')
    if (!cpuStaging.reserve(this, 'staging', 3 * GEOMETRY_STAGING_BYTES)) throw new Error('Geometry staging exceeds the shared CPU byte budget')
    this.residency = new PageResidency(sources, bytes / GEOMETRY_PAGE_BYTES, cpuStaging)
    this.staging = Array.from({ length: 3 }, () => ({ attribute: new StorageBufferAttribute(GEOMETRY_STAGING_BYTES / 4, 1, Uint32Array), serial: 0 }))
    this.source = storage(this.staging[0]!.attribute, 'uint', GEOMETRY_STAGING_BYTES / 4).toReadOnly()
    this.attribute = new StorageBufferAttribute(bytes / 4, 1, Uint32Array)
    this.attribute.name = 'Shared geometry page arena'
    const table = new Uint32Array(this.residency.pages.length * 4)
    for (let i = 0; i < table.length; i += 4) {
      table[i] = 0xffffffff
      const page = this.residency.pages[i / 4]!
      table[i + 3] = (page.local << 1) | Number(page.pinned)
    }
    this.table = new StorageBufferAttribute(table, 4)
    this.activity = new StorageBufferAttribute(this.residency.pages.length * 2 + 8, 1, Uint32Array)
    const arena = storage(this.attribute, 'uint', this.attribute.count)
    const mappings = storage(this.table, 'uvec4', this.table.count)
    const fence = storage(this.fence, 'uint', 4)
    const activity = storage(this.activity, 'uint', this.activity.count).toAtomic()
    this.copy = Fn(() => {
      const command = workgroupId.x
      If(command.lessThan(this.count), () => {
        const offset = command.mul(4)
        const base = this.source.element(offset.add(1))
        const size = this.source.element(offset.add(3))
        Loop({ start: invocationLocalIndex, end: size, type: 'uint', condition: '<', update: 64 }, ({ i }) => {
          arena.element(base.add(i)).assign(this.source.element(uint(COMMAND_WORDS).add(command.mul(GEOMETRY_PAGE_BYTES / 4)).add(i)))
        })
      })
    })().computeKernel([64]).setName('Geometry page uploads')
    this.publish = Fn(() => {
      If(instanceIndex.lessThan(this.count), () => {
        const offset = instanceIndex.mul(4)
        const page = this.source.element(offset)
        mappings.element(page).assign(uvec4(this.source.element(offset.add(1)), this.source.element(offset.add(2)), this.epoch, mappings.element(page).w))
      })
      If(instanceIndex.equal(0), () => {
        fence.element(0).assign(this.frame); fence.element(1).assign(this.epoch)
        atomicStore(activity.element(this.residency.pages.length * 2), this.epoch)
      })
    })().compute(64).setName('Geometry page epoch publication')
    this.copy.dispatchSize = this.dispatch
    this.uploads = [this.copy, this.publish]
  }

  setDensityCompute(node: ComputeNode) {
    this.density = node
    node.dispatchSize = this.dispatch
    this.uploads = [this.copy, node, this.publish]
  }

  async initialize(renderer: WebGPURenderer) {
    await uploadAttributes(renderer, [this.attribute, this.table, this.activity, this.fence])
    for (const slot of this.staging) {
      const node = storage(slot.attribute, 'uint', slot.attribute.count)
      const initialize = Fn(() => { node.element(0).assign(node.element(0)) })().compute(1)
      try { await renderer.compileComputeAsync(initialize) } finally { initialize.dispose() }
    }
    await Promise.all([this.copy, this.density, this.publish].filter((node): node is ComputeNode => node !== null).map(node => renderer.compileComputeAsync(node)))
    await Promise.all(this.residency.decoders.map(worker => worker.decoder.ready))
    const target = new ReadbackBuffer(16)
    try {
      while (this.residency.pages.some(page => page.pinned && page.state !== 'resident')) {
        this.update(renderer, performance.now() + 0.5)
        if (this.count.value) {
          const result = await renderer.getArrayBufferAsync(this.fence, target)
          this.residency.completed = new Uint32Array(result.buffer!)[0]!
          target.release()
        }
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
    } finally { target.dispose() }
  }

  update(renderer: WebGPURenderer, deadline: number, allowance = FRAME_UPLOAD_BYTES) {
    const start = performance.now()
    const state = this.residency
    this.frame.value = ++state.frame
    this.count.value = 0
    state.releaseCompleted(deadline)
    const slot = this.staging.find(slot => slot.serial <= state.completed)
    let uploaded = 0
    if (slot) {
      const array = slot.attribute.array as Uint32Array
      const command = (page: ResidentPage, resident: boolean) => {
        const index = this.count.value++
        array.set([page.id, resident ? page.slot * GEOMETRY_PAGE_BYTES / 4 : 0xffffffff, page.generation, resident ? page.bytes!.byteLength / 4 : 0], index * 4)
        if (resident) {
          const words = new Uint32Array(page.bytes!.buffer, page.bytes!.byteOffset, page.bytes!.byteLength / 4)
          const offset = COMMAND_WORDS + index * GEOMETRY_PAGE_BYTES / 4
          array.set(words, offset)
          slot.attribute.addUpdateRange(offset, words.length)
          uploaded += words.byteLength
          state.decodedBytes -= words.byteLength
          state.cpuStaging.release(page)
          page.bytes!.buffer.transfer(0)
          page.bytes = null
        }
      }
      const target = Math.max(state.pinned, state.limit - Math.min(state.ready.length, COMMANDS))
      while (this.count.value < COMMANDS && performance.now() < deadline && state.resident > target) {
        const page = state.evict()
        if (!page) break
        command(page, false)
      }
      for (let i = state.ready.length - 1; i >= 0 && this.count.value < COMMANDS && performance.now() < deadline; i--) {
        const page = state.ready[i]!
        if (uploaded + page.bytes!.byteLength + (this.count.value + 1) * 16 > allowance) continue
        if (!state.admit(page)) {
          for (const parent of page.parents) state.demand(parent, page.importance, state.frame)
          continue
        }
        command(page, true)
        state.ready.splice(i, 1)
      }
      if (this.count.value) {
        slot.attribute.addUpdateRange(0, this.count.value * 4)
        slot.attribute.needsUpdate = true
        slot.serial = state.frame
        this.source.value = slot.attribute
        this.epoch.value = ++this.epochCount
        uploaded += this.count.value * 16
      }
    }
    state.schedule(deadline)
    this.lastSchedulingMs = performance.now() - start
    this.peakSchedulingMs = Math.max(this.peakSchedulingMs, this.lastSchedulingMs)
    this.submissionMs = 0
    if (this.count.value) {
      const submissionStart = performance.now()
      this.dispatch[0] = this.count.value
      renderer.compute(this.uploads)
      this.submissionMs = performance.now() - submissionStart
      this.peakSubmissionMs = Math.max(this.peakSubmissionMs, this.submissionMs)
    }
    this.uploaded = uploaded
    this.peakUpload = Math.max(this.peakUpload, uploaded)
    return uploaded
  }

  snapshot() {
    const state = this.residency
    return {
      arenaBytes: this.bytes, residentLimitBytes: state.limit * GEOMETRY_PAGE_BYTES,
      physicalSlots: state.capacity, freeSlots: state.free.length,
      residentPages: state.resident, pinnedPages: state.pinned, retiringPages: state.retiring.length,
      occupiedSlotBytes: (state.resident + state.retiring.length) * GEOMETRY_PAGE_BYTES,
      frame: state.frame, completedSerial: state.completed, epoch: this.epochCount,
      evictions: state.evictions, reuses: state.reuses, unsafeReuses: state.unsafeReuses, peakRetiringPages: state.peakRetiring,
      cancelledRequests: state.cancellations,
      uploadBytes: this.uploaded, peakUploadBytes: this.peakUpload, stagingBytes: this.staging.length * GEOMETRY_STAGING_BYTES,
      cpuStaging: state.cpuStaging.snapshot(),
      decodedBytes: state.decodedBytes, peakDecodedBytes: state.peakDecodedBytes, wireBytes: state.wireBytes, decodeMilliseconds: state.decodeMilliseconds,
      schedulingMs: this.lastSchedulingMs, peakSchedulingMs: this.peakSchedulingMs,
      submissionMs: this.submissionMs, peakSubmissionMs: this.peakSubmissionMs,
    }
  }

  dispose() { this.residency.dispose(); this.residency.cpuStaging.release(this); this.copy.dispose(); this.publish.dispose() }
}
