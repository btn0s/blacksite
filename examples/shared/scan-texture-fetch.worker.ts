type Request = { type: 'read'; id: number; url: string; bytes: number } | { type: 'abort'; id: number }
const requests = new Map<number, AbortController>()

self.onmessage = ({ data }: MessageEvent<Request>) => {
  if (data.type === 'abort') {
    requests.get(data.id)?.abort()
    return
  }
  const controller = new AbortController()
  requests.set(data.id, controller)
  void (async () => {
    try {
      const response = await fetch(data.url, { signal: controller.signal })
      if (!response.ok) throw new Error(`Texture tail unavailable: ${data.url}`)
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength !== data.bytes) throw new Error('Texture tail size changed')
      controller.signal.throwIfAborted()
      self.postMessage({ id: data.id, buffer }, { transfer: [buffer] })
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      self.postMessage({ id: data.id, error: { name: failure.name, message: failure.message } })
    } finally {
      requests.delete(data.id)
    }
  })()
}

export {}
