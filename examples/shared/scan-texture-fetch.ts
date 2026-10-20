type Pending = { resolve(buffer: ArrayBuffer): void; reject(error: Error): void; cleanup(): void }
type Response = { id: number; buffer: ArrayBuffer; error?: { name: string; message: string } }

export class TextureTailReader {
  private worker: Worker | null = new Worker(new URL('./scan-texture-fetch.worker.ts', import.meta.url), { type: 'module' })
  private readonly pending = new Map<number, Pending>()
  private serial = 0

  constructor() {
    this.worker!.onmessage = ({ data }: MessageEvent<Response>) => {
      const pending = this.pending.get(data.id)
      if (!pending) return
      this.pending.delete(data.id)
      pending.cleanup()
      if (data.error) pending.reject(Object.assign(new Error(data.error.message), { name: data.error.name }))
      else pending.resolve(data.buffer)
    }
    this.worker!.onerror = event => this.dispose(new Error(event.message))
  }

  read(url: string, bytes: number, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const worker = this.worker
    if (!worker) return Promise.reject(new Error('Texture tail reader is closed'))
    const id = this.serial++
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const abort = () => worker.postMessage({ type: 'abort', id })
      this.pending.set(id, { resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) })
      worker.postMessage({ type: 'read', id, url, bytes })
      signal?.addEventListener('abort', abort, { once: true })
    })
  }

  dispose(error = new Error('Texture tail reader was disposed')) {
    this.worker?.terminate()
    this.worker = null
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(error) }
    this.pending.clear()
  }
}
