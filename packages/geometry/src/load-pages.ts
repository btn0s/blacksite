import type { MeshletMetadata } from './format'

export interface GeometryPageRange { offset: number; bytes: number; sha256: string }
export interface DecodedGeometryPage { bytes: Uint8Array<ArrayBuffer>; decodeMilliseconds: number; wireBytes: number }

export interface GeometryPageMetadata extends MeshletMetadata {
  version: number
  pageCapacity: number
  pagePack: string
  pages: (GeometryPageRange & { pinned: boolean })[]
  pageCount: number
  rootGroupCount: number
  coarseClusters: number
  coarseTriangles: number
  pinnedPages: number
  residentBytes: number
  edgeCount: number
}

export interface GeometryPageSource {
  metadata: GeometryPageMetadata
  packUrl: string
  groups: Uint32Array
  childOffsets: Uint32Array
  children: Uint32Array
  parentOffsets: Uint32Array
  parents: Uint32Array
  nodeData: Uint32Array
  nodeBounds: Float32Array
  pages: Uint32Array
  roots: Uint32Array
}

export async function loadGeometryPageSource(url: string | URL, signal?: AbortSignal): Promise<GeometryPageSource> {
  const locationUrl = new URL(url, typeof location === 'undefined' ? undefined : location.href)
  const response = await fetch(locationUrl, { signal })
  if (!response.ok) throw new Error(`Geometry directory request failed: ${response.status}`)
  const buffer = await response.arrayBuffer()
  const header = new Uint32Array(buffer, 0, 8)
  if (header[0] !== 0x44475342 || header[1] !== 5 || header[2] !== 9 || header[4] !== buffer.byteLength) throw new Error('Geometry requires a version 5 page directory')
  const metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 176, header[3]!))) as GeometryPageMetadata
  if (metadata.version !== 5 || metadata.pageCapacity !== 131072 || metadata.pages.length !== metadata.pageCount) throw new Error('Geometry page metadata is invalid')
  const names = ['groups', 'childOffsets', 'children', 'parentOffsets', 'parents', 'nodeData', 'nodeBounds', 'pages', 'roots'] as const
  const counts = [metadata.groupCount * 8, metadata.groupCount + 1, metadata.edgeCount, metadata.groupCount + 1, metadata.edgeCount, metadata.nodeCount * 4, metadata.nodeCount * 8, metadata.pageCount * 4, metadata.rootGroupCount]
  const arrays: Record<string, Uint32Array | Float32Array> = {}
  let cursor = Math.ceil((176 + header[3]!) / 16) * 16
  for (let i = 0; i < names.length; i++) {
    const entry = new Uint32Array(buffer, 32 + i * 16, 4)
    const [id, offset, count, type] = entry
    if (id !== i || offset !== cursor || count !== counts[i] || offset! + count! * 4 > buffer.byteLength || type !== Number(i !== 6)) throw new Error('Geometry directory section is invalid')
    arrays[names[i]!] = type ? new Uint32Array(buffer, offset, count) : new Float32Array(buffer, offset, count)
    cursor = Math.ceil((offset! + count! * 4) / 16) * 16
  }
  if (cursor !== buffer.byteLength || arrays.groups!.length !== metadata.groupCount * 8 || arrays.nodeData!.length !== metadata.nodeCount * 4 || arrays.roots!.length !== metadata.rootGroupCount) throw new Error('Geometry directory counts disagree')
  return { metadata, packUrl: new URL(metadata.pagePack, locationUrl).href, ...arrays } as GeometryPageSource
}

export class GeometryPageDecoder {
  readonly ready: Promise<void>
  readonly #worker = new Worker(new URL('./page-worker.mjs', import.meta.url), { type: 'module' })
  #serial = 0
  #disposed = false
  #rejectReady: (error: Error) => void = () => {}
  #pending: { id: number; resolve: (page: DecodedGeometryPage) => void; reject: (error: Error) => void; removeAbort: () => void } | null = null

  constructor() {
    this.ready = new Promise<void>((resolve, reject) => {
      this.#rejectReady = reject
      this.#worker.onmessage = ({ data }) => {
        if (data.ready) { resolve(); return }
        const pending = this.#pending
        if (!pending || pending.id !== data.id) return
        this.#pending = null
        pending.removeAbort()
        if (data.error) pending.reject(new Error(data.error))
        else pending.resolve({ bytes: new Uint8Array(data.buffer), decodeMilliseconds: data.decodeMilliseconds, wireBytes: data.wireBytes })
      }
      this.#worker.onerror = event => {
        const error = new Error(event.message || 'Geometry page worker failed')
        reject(error)
        this.#pending?.removeAbort()
        this.#pending?.reject(error)
        this.#pending = null
        this.#disposed = true
        this.#worker.terminate()
      }
    })
  }

  async fetch(url: string, pageIndex: number, range: GeometryPageRange, signal?: AbortSignal): Promise<DecodedGeometryPage> {
    await this.ready
    signal?.throwIfAborted()
    if (this.#disposed) throw new Error('Geometry page decoder is disposed')
    if (this.#pending) throw new Error('Geometry page decoder accepts one page at a time')
    return new Promise<DecodedGeometryPage>((resolve, reject) => {
      const id = ++this.#serial
      const abort = () => this.#worker.postMessage({ id, cancel: true })
      signal?.addEventListener('abort', abort, { once: true })
      this.#pending = { id, resolve, reject, removeAbort: () => signal?.removeEventListener('abort', abort) }
      this.#worker.postMessage({ id, url: new URL(url, location.href).href, pageIndex, range })
    })
  }

  dispose() {
    this.#disposed = true
    this.#rejectReady(new Error('Geometry page decoder disposed'))
    this.#pending?.removeAbort()
    this.#pending?.reject(new Error('Geometry page decoder disposed'))
    this.#pending = null
    this.#worker.terminate()
  }
}
