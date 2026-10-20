import { decodeGeometryPage, pageCodecReady } from './page-codec.mjs'

let active = null
self.onmessage = async ({ data: request }) => {
  if (request.cancel) { if (active?.id === request.id) active.controller.abort(); return }
  if (active) { self.postMessage({ id: request.id, error: 'Geometry page worker is busy' }); return }
  const controller = new AbortController()
  active = { id: request.id, controller }
  try {
    const { range } = request
    if (!Number.isSafeInteger(range.offset) || range.offset < 0 || !Number.isSafeInteger(range.bytes) || range.bytes < 96 || range.bytes > 262144 || !/^[a-f0-9]{64}$/.test(range.sha256)) throw new Error('Invalid geometry page range')
    const end = range.offset + range.bytes - 1
    const response = await fetch(request.url, { headers: { Range: `bytes=${range.offset}-${end}` }, signal: controller.signal })
    if (response.status !== 206 || !response.headers.get('Content-Range')?.startsWith(`bytes ${range.offset}-${end}/`)) throw new Error('Geometry page fetch requires the exact HTTP byte range')
    if (!response.body) throw new Error('Geometry page fetch has no body')
    const wire = new Uint8Array(range.bytes), reader = response.body.getReader()
    let received = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (received + value.byteLength > wire.byteLength) { controller.abort(); throw new Error('Geometry page response exceeds its range') }
        wire.set(value, received); received += value.byteLength
      }
    } finally { reader.releaseLock() }
    if (received !== range.bytes) throw new Error('Geometry page fetch length disagrees')
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', wire))
    if (Array.from(digest, value => value.toString(16).padStart(2, '0')).join('') !== range.sha256) throw new Error('Geometry page wire hash disagrees')
    controller.signal.throwIfAborted()
    const start = performance.now(), decoded = decodeGeometryPage(wire), decodeMilliseconds = performance.now() - start
    if (new DataView(decoded.buffer).getUint32(8, true) !== request.pageIndex) throw new Error('Decoded page identity disagrees')
    controller.signal.throwIfAborted()
    self.postMessage({ id: request.id, buffer: decoded.buffer, decodeMilliseconds, wireBytes: wire.byteLength }, [decoded.buffer])
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) })
  } finally { active = null }
}
await pageCodecReady
self.postMessage({ ready: true })
