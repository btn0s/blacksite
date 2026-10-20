import { GeometryPageDecoder } from './load-pages'
import type { GeometryPageSource } from './load-pages'
import type { ResidencyLedger } from './residency'

export const GEOMETRY_PAGE_BYTES = 131072
export const GEOMETRY_ARENA_BYTES = 1280 * 1048576
export const FRAME_UPLOAD_BYTES = 8 * 1048576
export const GEOMETRY_STAGING_BYTES = 2 * 1048576
const DECODED_QUEUE_BYTES = 4 * 1048576
const PAGE_DECODE_BYTES = 262144 + GEOMETRY_PAGE_BYTES

class PageHeap {
  private readonly ids: number[] = []
  private readonly positions: Int32Array
  constructor(count: number, private readonly before: (a: number, b: number) => boolean) { this.positions = new Int32Array(count).fill(-1) }
  get first() { return this.ids[0] }
  update(id: number) {
    let index = this.positions[id]!
    if (index < 0) { index = this.ids.length; this.ids.push(id); this.positions[id] = index }
    while (index > 0) {
      const parent = (index - 1) >>> 1
      if (!this.before(this.ids[index]!, this.ids[parent]!)) break
      this.swap(index, parent); index = parent
    }
    for (;;) {
      const left = index * 2 + 1, right = left + 1
      let next = index
      if (left < this.ids.length && this.before(this.ids[left]!, this.ids[next]!)) next = left
      if (right < this.ids.length && this.before(this.ids[right]!, this.ids[next]!)) next = right
      if (next === index) break
      this.swap(index, next); index = next
    }
  }
  remove(id: number) {
    const index = this.positions[id]!
    if (index < 0) return
    const last = this.ids.pop()!
    this.positions[id] = -1
    if (index < this.ids.length) { this.ids[index] = last; this.positions[last] = index; this.update(last) }
  }
  private swap(a: number, b: number) {
    const x = this.ids[a]!, y = this.ids[b]!
    this.ids[a] = y; this.ids[b] = x; this.positions[x] = b; this.positions[y] = a
  }
}

export interface PageSourceRange { source: GeometryPageSource; pageBase: number; groupBase: number }
export interface ResidentPage {
  id: number
  source: PageSourceRange
  local: number
  parents: number[]
  children: number[]
  pinned: boolean
  state: 'absent' | 'requested' | 'loading' | 'ready' | 'resident' | 'retiring'
  slot: number
  generation: number
  dependants: number
  importance: number
  lastUse: number
  demanded: number
  admitted: number
  retireAfter: number
  bytes: Uint8Array<ArrayBuffer> | null
}

export class PageResidency {
  readonly pages: ResidentPage[] = []
  readonly generations: Uint32Array
  readonly owners: Int32Array
  readonly retiredAt: Uint32Array
  readonly free: number[] = []
  readonly retiring: ResidentPage[] = []
  readonly ready: ResidentPage[] = []
  readonly residentIds: number[] = []
  private readonly residentPositions: Int32Array
  readonly decoders = Array.from({ length: 8 }, () => ({ decoder: new GeometryPageDecoder(), pending: null as Promise<void> | null }))
  private readonly requests: PageHeap
  private readonly lru: PageHeap
  private readonly controllers = new Map<number, AbortController>()
  private readonly dependencyWork: number[] = []
  private readonly queued: Uint8Array
  private disposed = false
  private failure: unknown
  completed = 0
  frame = 0
  limit: number
  resident = 0
  pinned = 0
  evictions = 0
  reuses = 0
  cancellations = 0
  unsafeReuses = 0
  peakRetiring = 0
  decodedBytes = 0
  peakDecodedBytes = 0
  wireBytes = 0
  decodeMilliseconds = 0
  fetchMilliseconds = 0

  constructor(sources: readonly PageSourceRange[], readonly capacity: number, readonly cpuStaging: ResidencyLedger) {
    this.limit = capacity
    for (const source of sources) for (let local = 0; local < source.source.metadata.pageCount; local++) {
      const id = source.pageBase + local
      this.pages.push({ id, source, local, parents: [], children: [], pinned: source.source.metadata.pages[local]!.pinned, state: 'absent', slot: -1, generation: 0, dependants: 0, importance: 0, lastUse: 0, demanded: 0, admitted: 0, retireAfter: 0, bytes: null })
    }
    for (const source of sources) {
      const { groups, parentOffsets, parents } = source.source
      const dependencies = Array.from({ length: source.source.metadata.pageCount }, () => new Set<number>())
      for (let group = 0; group < source.source.metadata.groupCount; group++) {
        const page = groups[group * 8 + 5]!
        for (let i = parentOffsets[group]!; i < parentOffsets[group + 1]!; i++) {
          const parent = groups[parents[i]! * 8 + 5]!
          if (page !== parent) dependencies[page]!.add(source.pageBase + parent)
        }
      }
      for (let page = 0; page < dependencies.length; page++) {
        const record = this.pages[source.pageBase + page]!
        record.parents = [...dependencies[page]!]
        for (const parent of record.parents) this.pages[parent]!.children.push(record.id)
      }
    }
    this.pinned = this.pages.filter(page => page.pinned).length
    if (capacity < this.pinned) throw new Error('Geometry arena cannot contain its pinned closure')
    this.generations = new Uint32Array(capacity)
    this.owners = new Int32Array(capacity).fill(-1)
    this.retiredAt = new Uint32Array(capacity)
    this.queued = new Uint8Array(this.pages.length)
    this.residentPositions = new Int32Array(this.pages.length).fill(-1)
    for (let slot = capacity - 1; slot >= 0; slot--) this.free.push(slot)
    this.requests = new PageHeap(this.pages.length, (a, b) => this.pages[a]!.importance > this.pages[b]!.importance || (this.pages[a]!.importance === this.pages[b]!.importance && a < b))
    const age = (id: number) => Math.max(this.pages[id]!.lastUse, this.pages[id]!.admitted + 16)
    this.lru = new PageHeap(this.pages.length, (a, b) => age(a) < age(b) || (age(a) === age(b) && a < b))
    for (const page of this.pages) if (page.pinned) this.demand(page.id, Number.MAX_VALUE, 0)
  }

  setLimit(bytes: number) {
    const pages = Math.floor(bytes / GEOMETRY_PAGE_BYTES)
    if (!Number.isSafeInteger(pages) || pages < this.pinned || pages > this.capacity) throw new Error('Geometry resident limit is outside its pinned closure and arena capacity')
    this.limit = pages
  }

  demand(id: number, importance: number, frame: number) {
    const page = this.pages[id]
    if (!page) throw new Error('GPU requested an invalid geometry page')
    const renewed = frame > page.demanded
    page.demanded = Math.max(page.demanded, frame)
    const changed = page.state === 'absent' || importance > page.importance
    page.importance = Math.max(page.importance, importance)
    if (page.state === 'absent') page.state = 'requested'
    const dependenciesMissing = renewed && page.state === 'requested' && page.parents.some(parent => this.pages[parent]!.state !== 'resident')
    if (page.state === 'requested' && (changed || dependenciesMissing) && !this.queued[id]) { this.dependencyWork.push(id); this.queued[id] = 1 }
  }

  used(id: number, frame: number) {
    const page = this.pages[id]!
    if (frame <= page.lastUse) return
    page.lastUse = frame
    if (page.state === 'resident' && !page.pinned && page.dependants === 0) this.lru.update(id)
  }

  releaseCompleted(deadline: number) {
    for (let i = this.retiring.length - 1; i >= 0 && performance.now() < deadline; i--) {
      const page = this.retiring[i]!
      if (page.retireAfter > this.completed) continue
      if (this.owners[page.slot] !== page.id) throw new Error('Retiring geometry slot changed ownership')
      this.owners[page.slot] = -1
      this.free.push(page.slot)
      page.slot = -1
      page.state = 'absent'
      this.retiring.splice(i, 1)
      if (this.frame - page.demanded <= 120) this.demand(page.id, page.importance, page.demanded)
    }
  }

  evict() {
    const id = this.lru.first
    if (id === undefined) return null
    const page = this.pages[id]!
    if (this.frame - page.admitted < 16) return null
    this.lru.remove(id)
    page.state = 'retiring'
    page.retireAfter = this.frame
    this.retiredAt[page.slot] = this.frame
    this.retiring.push(page)
    this.peakRetiring = Math.max(this.peakRetiring, this.retiring.length)
    this.resident--
    const position = this.residentPositions[id]!, last = this.residentIds.pop()!
    this.residentPositions[id] = -1
    if (position < this.residentIds.length) { this.residentIds[position] = last; this.residentPositions[last] = position }
    this.evictions++
    for (const child of page.children) {
      const dependant = this.pages[child]!
      if (dependant.state === 'loading') this.controllers.get(child)?.abort()
      if (dependant.state === 'ready') {
        this.ready.splice(this.ready.indexOf(dependant), 1)
        this.decodedBytes -= dependant.bytes!.byteLength
        dependant.bytes!.buffer.transfer(0)
        dependant.bytes = null
        this.cpuStaging.release(dependant)
        dependant.state = 'absent'
        this.cancellations++
        this.demand(child, dependant.importance, dependant.demanded)
      }
    }
    for (const parent of page.parents) {
      const ancestor = this.pages[parent]!
      if (--ancestor.dependants === 0 && !ancestor.pinned) this.lru.update(parent)
    }
    return page
  }

  admit(page: ResidentPage) {
    if (!this.free.length || this.resident + this.retiring.length >= this.limit || page.parents.some(id => this.pages[id]!.state !== 'resident')) return false
    const slot = this.free.pop()!
    if (this.owners[slot] !== -1 || this.retiredAt[slot]! > this.completed) { this.unsafeReuses++; throw new Error('Geometry slot reused before completion') }
    if (this.generations[slot]) this.reuses++
    this.generations[slot] = this.generations[slot]! + 1
    this.owners[slot] = page.id
    page.slot = slot; page.generation = this.generations[slot]!; page.admitted = this.frame; page.lastUse = this.frame
    page.state = 'resident'
    this.resident++
    this.residentPositions[page.id] = this.residentIds.length
    this.residentIds.push(page.id)
    if (!page.pinned && page.dependants === 0) this.lru.update(page.id)
    for (const parent of page.parents) { this.pages[parent]!.dependants++; this.lru.remove(parent) }
    for (const child of page.children) {
      const dependant = this.pages[child]!
      if (dependant.state === 'requested' && dependant.parents.every(id => this.pages[id]!.state === 'resident')) this.requests.update(child)
    }
    return true
  }

  schedule(deadline: number) {
    if (this.disposed) throw new Error('Geometry page residency is disposed')
    if (this.failure) throw this.failure
    for (const [id, controller] of this.controllers) {
      const page = this.pages[id]!
      if (!page.pinned && this.frame - page.demanded > 120) controller.abort()
    }
    for (const worker of this.decoders) this.launch(worker, deadline)
    while (this.dependencyWork.length && performance.now() < deadline) {
      const id = this.dependencyWork.pop()!
      this.queued[id] = 0
      const page = this.pages[id]!
      if (page.state !== 'requested') continue
      let available = true
      for (const parent of page.parents) {
        if (this.pages[parent]!.state === 'resident') continue
        available = false
        this.demand(parent, page.importance, page.demanded)
      }
      if (available) this.requests.update(id)
    }
  }

  idle() {
    return this.requests.first === undefined && this.ready.length === 0 && this.dependencyWork.length === 0 && this.decoders.every(worker => !worker.pending)
  }

  private launch(worker: PageResidency['decoders'][number], deadline: number) {
    if (worker.pending || this.decodedBytes >= DECODED_QUEUE_BYTES || performance.now() >= deadline) return
    let examined = 0
    while (this.requests.first !== undefined && examined++ < 32 && performance.now() < deadline) {
      const page = this.pages[this.requests.first]!
      this.requests.remove(page.id)
      if (!page.pinned && this.frame - page.demanded > 120) { page.state = 'absent'; page.importance = 0; continue }
      if (page.parents.some(id => this.pages[id]!.state !== 'resident')) {
        if (!this.queued[page.id]) { this.dependencyWork.push(page.id); this.queued[page.id] = 1 }
        continue
      }
      if (!this.cpuStaging.reserve(page, 'decoded', PAGE_DECODE_BYTES)) { this.requests.update(page.id); break }
      page.state = 'loading'
      const controller = new AbortController()
      this.controllers.set(page.id, controller)
      worker.pending = worker.decoder.fetch(page.source.source.packUrl, page.local, page.source.source.metadata.pages[page.local]!, controller.signal).then(result => {
        if (this.disposed) return
        controller.signal.throwIfAborted()
        page.bytes = result.bytes
        page.state = 'ready'
        this.ready.push(page)
        this.decodedBytes += result.bytes.byteLength
        this.peakDecodedBytes = Math.max(this.peakDecodedBytes, this.decodedBytes)
        this.wireBytes += result.wireBytes
        this.decodeMilliseconds += result.decodeMilliseconds
        this.fetchMilliseconds += result.fetchMilliseconds
      }).catch(error => {
        this.cpuStaging.release(page)
        if (controller.signal.aborted) { page.state = 'absent'; page.importance = 0; this.cancellations++ }
        else if (!this.disposed) this.failure = error
      }).finally(() => {
        worker.pending = null
        this.controllers.delete(page.id)
        if (!this.disposed && !this.failure) this.launch(worker, Infinity)
      })
      return
    }
  }

  waitForData() {
    const pending = this.decoders.flatMap(worker => worker.pending ? [worker.pending] : [])
    return pending.length ? Promise.race(pending) : new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }

  dispose() {
    this.disposed = true
    for (const controller of this.controllers.values()) controller.abort()
    for (const worker of this.decoders) worker.decoder.dispose()
    for (const page of this.pages) { this.cpuStaging.release(page); page.bytes = null }
    this.ready.length = 0
  }
}
