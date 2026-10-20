export interface GeometryPageRange { offset: number; bytes: number; sha256: string }
export interface DecodedGeometryPage { bytes: Uint8Array; decodeMilliseconds: number; wireBytes: number }

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
