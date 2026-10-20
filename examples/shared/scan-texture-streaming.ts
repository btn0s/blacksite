import { CompressedTexture, NoColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { getByteLength } from 'three/src/extras/TextureUtils.js'
import { ResidencyLedger, type MeshletTextureFeedback, type TextureDemandBinding } from '@blacksite/geometry'
import type { texture } from 'three/tsl'
import { TextureTailReader } from './scan-texture-fetch'

export type ScanTail = { file: string; size: number; width: number; height: number; levels: number; wireBytes: number }
export type ScanImageSource = { file: string; srgb: boolean; tails: ScanTail[] }
type Allocation = { texture: Texture; reportedBytes: number; residentBytes: number }
export type ScanTexture = {
  id: number
  source: ScanImageSource
  allocation: Allocation
  tail: ScanTail
  target: ScanTail
  nodes: ReturnType<typeof texture>[]
  coldSince: number
  retryAt: number
  maxSize: number
}
type Request = { image: ScanTexture; tail: ScanTail; controller: AbortController; texture: Texture | null; staging: object; upload: object; bytes: number }
const MiB = 1024 * 1024
const uploadLimit = 8 * MiB
const textureBytes = (tail: Pick<ScanTail, 'width' | 'height' | 'levels'>, map: Texture) => {
  let bytes = 0
  for (let mip = 0; mip < tail.levels; mip++) bytes += getByteLength(Math.max(1, tail.width >> mip), Math.max(1, tail.height >> mip), map.format, map.type)
  return bytes
}

export class ScanTextureStreaming {
  private readonly reader = new TextureTailReader()
  readonly ledger = new ResidencyLedger(2560 * MiB, { textures: 768 * MiB, staging: 64 * MiB })
  private readonly decoding = new ResidencyLedger(64 * MiB, {})
  readonly resident: Allocation[] = []
  readonly images: ScanTexture[] = []
  readonly bindings = new Map<object, readonly TextureDemandBinding[]>()
  private readonly bindingVersions = new Map<object, number>()
  readonly feedback: MeshletTextureFeedback = {
    imageCount: 0, materials: this.bindings, ledger: this.ledger, frame: 0, bindingVersions: this.bindingVersions,
    consume: (mips, serial) => {
      if (serial <= this.completed || this.disposed) return
      this.completed = serial
      const now = performance.now()
      this.samples++
      for (const image of this.images) {
        const size = Math.min(image.maxSize, 2048 >> mips[image.id]!)
        const target = image.source.tails.find(tail => tail.size >= size) ?? image.source.tails.at(-1)!
        if (target !== image.target) { image.target = target; image.coldSince = now }
      }
    },
  }
  private completed = -1
  private pending: Request | null = null
  private readonly retiring: { allocation: Allocation; serial: number }[] = []
  private readonly uploads: { owner: object; serial: number }[] = []
  private disposed = false
  private promotions = 0
  private demotions = 0
  private cancelled = 0
  private samples = 0
  private uploadBytes = 0
  private peakUploadBytes = 0
  private peakUploadMs = 0
  private lastUploadMs = 0
  private lastUploadAt = 0
  private minimumSwapBytes = 0

  constructor(private readonly renderer: WebGPURenderer, private readonly loader: KTX2Loader, private readonly root: string) {}

  private async decode(tail: ScanTail, signal?: AbortSignal) {
    const buffer = await this.reader.read(new URL(this.root + tail.file, location.href).href, tail.wireBytes, signal)
    signal?.throwIfAborted()
    return new Promise<Texture>((resolve, reject) => { this.loader.parse(buffer, resolve, reject) })
  }

  private upload(map: Texture, source: ScanImageSource, tail: ScanTail, staging: object) {
    map.flipY = false
    map.wrapS = map.wrapT = RepeatWrapping
    map.anisotropy = 8
    map.colorSpace = source.srgb ? SRGBColorSpace : NoColorSpace
    const bytes = textureBytes(tail, map)
    if (map instanceof CompressedTexture) {
      const decoded = map.mipmaps.reduce((sum, mip) => sum + mip.data.byteLength, 0)
      if (bytes !== decoded) throw new Error('Texture tail block layout does not match its decoded allocation')
      map.onUpdate = () => {
        const buffers = new Set(map.mipmaps.map(mip => mip.data.buffer))
        for (const mip of map.mipmaps) mip.data = new Uint8Array(0)
        for (const buffer of buffers) {
          if (!(buffer instanceof ArrayBuffer)) throw new Error('Texture upload requires transferable buffers')
          buffer.transfer(0)
        }
        map.onUpdate = null
      }
    }
    const allocation = { texture: map, reportedBytes: 0, residentBytes: bytes }
    if (!this.ledger.reserve(allocation, 'textures', bytes)) { this.ledger.release(staging); map.dispose(); throw new Error('Texture allocation exceeds the shared residency budget') }
    try {
      const before = this.renderer.info.memory.texturesSize
      this.renderer.initTexture(map)
      allocation.reportedBytes = this.renderer.info.memory.texturesSize - before
      this.resident.push(allocation)
      this.uploads.push({ owner: staging, serial: this.feedback.frame + 1 })
      return allocation
    } catch (error) {
      this.ledger.release(allocation)
      this.ledger.release(staging)
      map.dispose()
      throw error
    }
  }

  async load(source: ScanImageSource) {
    if (!source.tails?.length || source.tails[0]!.size > 256) throw new Error('Rebuild scan materials with version 2 mip-tail descriptors')
    const tail = source.tails[0]!
    const staging = {}
    if (!this.decoding.reserve(staging, 'decoded', tail.wireBytes + Math.ceil(tail.width * tail.height * 4 * 4 / 3) * 2)) throw new Error('Minimum texture tails exceed decode staging capacity')
    try {
      const map = await this.decode(tail)
      if (this.disposed) { map.dispose(); throw new Error('Texture residency was disposed during loading') }
      const upload = {}
      if (!this.ledger.reserve(upload, 'staging', textureBytes(tail, map))) { map.dispose(); throw new Error('Minimum texture tails exceed upload staging capacity') }
      const allocation = this.upload(map, source, tail, upload)
      this.minimumSwapBytes = Math.max(this.minimumSwapBytes, allocation.residentBytes * 2)
      const maxSize = Math.max(...source.tails.filter(tail => tail.size <= 2048 && textureBytes(tail, map) <= uploadLimit).map(tail => tail.size))
      const image: ScanTexture = { id: this.images.length, source, allocation, tail, target: tail, nodes: [], coldSince: 0, retryAt: 0, maxSize }
      this.images.push(image)
      this.feedback.imageCount = this.images.length
      return image
    } finally { this.decoding.release(staging) }
  }

  private release(allocation: Allocation) {
    allocation.texture.dispose()
    this.ledger.release(allocation)
    const index = this.resident.indexOf(allocation)
    if (index >= 0) this.resident.splice(index, 1)
  }

  private cancel(request: Request) {
    request.controller.abort()
    request.texture?.dispose()
    this.ledger.release(request)
    this.ledger.release(request.upload)
    if (request.texture) this.decoding.release(request.staging)
    if (this.pending === request) this.pending = null
    this.cancelled++
  }

  update() {
    if (this.disposed) return
    const start = performance.now()
    this.uploadBytes = 0
    for (let i = this.uploads.length - 1; i >= 0; i--) {
      if (performance.now() - start >= 0.5) return
      const upload = this.uploads[i]!
      if (upload.serial > this.completed) continue
      this.ledger.release(upload.owner)
      this.uploads.splice(i, 1)
    }
    for (let i = this.retiring.length - 1; i >= 0; i--) {
      if (performance.now() - start >= 0.5) return
      const entry = this.retiring[i]!
      if (entry.serial > this.completed) continue
      this.release(entry.allocation)
      this.retiring.splice(i, 1)
    }
    const pending = this.pending
    if (pending) {
      if (pending.image.target !== pending.tail) this.cancel(pending)
      else if (pending.texture) {
        this.pending = null
        const { image, tail, texture } = pending
        this.ledger.release(pending)
        try {
          const before = performance.now()
          const allocation = this.upload(texture, image.source, tail, pending.upload)
          this.lastUploadMs = performance.now() - before
          this.lastUploadAt = performance.now()
          performance.measure('Texture tail upload', { start: before, end: this.lastUploadAt, detail: { bytes: allocation.residentBytes, serial: this.feedback.frame } })
          performance.clearMeasures('Texture tail upload')
          this.peakUploadMs = Math.max(this.peakUploadMs, this.lastUploadMs)
          this.uploadBytes = allocation.residentBytes
          this.peakUploadBytes = Math.max(this.peakUploadBytes, this.uploadBytes)
          this.retiring.push({ allocation: image.allocation, serial: this.feedback.frame })
          if (tail.size > image.tail.size) this.promotions++
          else this.demotions++
          image.allocation = allocation
          image.tail = tail
          for (const node of image.nodes) node.value = texture
          for (const [material, bindings] of this.bindings) {
            if (bindings.some(binding => binding.image === image.id)) this.bindingVersions.set(material, (this.bindingVersions.get(material) ?? 0) + 1)
          }
        } finally { this.decoding.release(pending.staging) }
        return
      }
    }
    if (this.pending || performance.now() - start >= 0.5) return
    let next: ScanTexture | null = null
    for (const image of this.images) {
      if (image.target === image.tail || start < image.retryAt) continue
      if (image.target.size < image.tail.size && start - image.coldSince < 3000) continue
      const bytes = textureBytes(image.target, image.allocation.texture)
      const stagingBytes = image.target.wireBytes + Math.ceil(image.target.width * image.target.height * 4 * 4 / 3) * 2
      const spare = image.target.size > image.tail.size ? this.minimumSwapBytes : 0
      if (bytes + spare / 2 > this.ledger.available('textures') || bytes > this.ledger.available('staging') || stagingBytes > this.decoding.available() || bytes * 2 + spare > this.ledger.available()) continue
      if (!next || image.target.size < image.tail.size || image.target.size / image.tail.size > next.target.size / next.tail.size) next = image
    }
    if (!next || performance.now() - start >= 0.5) return
    const tail = next.target
    const bytes = textureBytes(tail, next.allocation.texture)
    const request: Request = { image: next, tail, controller: new AbortController(), texture: null, staging: {}, upload: {}, bytes }
    const stagingBytes = tail.wireBytes + Math.ceil(tail.width * tail.height * 4 * 4 / 3) * 2
    if (!this.ledger.reserve(request, 'textures', bytes)) return
    if (!this.ledger.reserve(request.upload, 'staging', bytes)) { this.ledger.release(request); return }
    if (!this.decoding.reserve(request.staging, 'decoded', stagingBytes)) { this.ledger.release(request); this.ledger.release(request.upload); return }
    this.pending = request
    void this.decode(tail, request.controller.signal).then(texture => {
      if (this.disposed || this.pending !== request || request.controller.signal.aborted) {
        texture.dispose()
        this.decoding.release(request.staging)
      } else request.texture = texture
    }).catch(error => {
      this.ledger.release(request)
      this.ledger.release(request.upload)
      this.decoding.release(request.staging)
      if (this.pending === request) this.pending = null
      if (!request.controller.signal.aborted && !this.disposed) {
        request.image.retryAt = performance.now() + 30000
        console.warn('Texture tail unavailable; retaining the resident tail', error)
      }
    })
  }

  snapshot() {
    const tails: Record<string, number> = {}
    for (const image of this.images) tails[image.tail.size] = (tails[image.tail.size] ?? 0) + 1
    return {
      ledger: this.ledger.snapshot(), cpuStaging: this.decoding.snapshot(), tails, images: this.images.length,
      residentBytes: this.resident.reduce((sum, entry) => sum + entry.residentBytes, 0),
      retiringBytes: this.retiring.reduce((sum, entry) => sum + entry.allocation.residentBytes, 0),
      pendingBytes: this.pending?.bytes ?? 0, promotions: this.promotions, demotions: this.demotions, cancelled: this.cancelled, samples: this.samples,
      uploadBytes: this.uploadBytes, peakUploadBytes: this.peakUploadBytes, peakUploadMs: this.peakUploadMs, lastUploadMs: this.lastUploadMs, lastUploadAt: this.lastUploadAt,
      completedSerial: this.completed,
    }
  }

  dispose() {
    this.disposed = true
    this.reader.dispose()
    if (this.pending) this.cancel(this.pending)
    for (const allocation of [...this.resident]) this.release(allocation)
    this.retiring.length = 0
    for (const upload of this.uploads) this.ledger.release(upload.owner)
    this.uploads.length = 0
    this.loader.dispose()
  }
}
