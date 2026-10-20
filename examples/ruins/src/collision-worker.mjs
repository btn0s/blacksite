let active = null
self.onmessage = async ({ data }) => {
  if (data.cancel) { active?.abort(); return }
  if (active) { self.postMessage({ error: 'Collision worker is busy' }); return }
  const controller = new AbortController()
  active = controller
  try {
    const response = await fetch(data.url, { signal: controller.signal })
    if (!response.ok) throw new Error(`Collision chunk request failed: ${response.status}`)
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength !== data.bytes) throw new Error('Collision chunk byte count disagrees')
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))
    if (Array.from(hash, value => value.toString(16).padStart(2, '0')).join('') !== data.sha256) throw new Error('Collision chunk hash disagrees')
    const header = new Uint32Array(buffer, 0, 8)
    if (header[0] !== 0x52435342 || header[1] !== 1 || header[2] % 3 || header[3] % 3 || header[3] > 16384 * 3 || 32 + (header[2] + header[3]) * 4 !== buffer.byteLength) throw new Error('Collision chunk layout is invalid')
    const indices = new Uint32Array(buffer, 32 + header[2] * 4, header[3])
    if (indices.some(index => index >= header[2] / 3)) throw new Error('Collision index exceeds vertex count')
    controller.signal.throwIfAborted()
    self.postMessage({ buffer }, [buffer])
  } catch (error) { self.postMessage({ error: String(error), cancelled: controller.signal.aborted }) }
  finally { active = null }
}
