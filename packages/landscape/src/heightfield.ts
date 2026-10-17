import { DataTexture, FloatType, NearestFilter, RedFormat, RGBAFormat, LinearFilter, LinearMipmapLinearFilter, UnsignedByteType, ClampToEdgeWrapping, NoColorSpace } from 'three'

export interface Heightfield {
  readonly size: number
  readonly spacing: number
  readonly extent: number
  readonly origin: readonly [number, number]
  readonly heights: Float32Array
  readonly min: number
  readonly max: number
}

export interface HeightfieldSpec {
  readonly size: number
  readonly extent: number
  readonly origin?: readonly [number, number]
  readonly sample?: (x: number, z: number) => number
  readonly heights?: Float32Array
}

export function createHeightfield(spec: HeightfieldSpec): Heightfield {
  const { size, extent } = spec
  const spacing = extent / (size - 1)
  const origin = spec.origin ?? [-extent / 2, -extent / 2]
  const heights = spec.heights ?? new Float32Array(size * size)
  if (heights.length !== size * size) throw new Error(`Heightfield needs ${size * size} samples, got ${heights.length}`)
  if (spec.sample) {
    for (let row = 0; row < size; row++) {
      const z = origin[1] + row * spacing
      for (let column = 0; column < size; column++) heights[row * size + column] = spec.sample(origin[0] + column * spacing, z)
    }
  }
  let min = Infinity
  let max = -Infinity
  for (let index = 0; index < heights.length; index++) {
    const value = heights[index]!
    if (value < min) min = value
    if (value > max) max = value
  }
  return { size, spacing, extent, origin, heights, min, max }
}

export function contains(field: Heightfield, x: number, z: number, margin = 0): boolean {
  const u = x - field.origin[0]
  const v = z - field.origin[1]
  return u >= margin && v >= margin && u <= field.extent - margin && v <= field.extent - margin
}

export function heightAt(field: Heightfield, x: number, z: number): number {
  const { size, spacing, heights } = field
  const gx = Math.min(size - 1.000001, Math.max(0, (x - field.origin[0]) / spacing))
  const gz = Math.min(size - 1.000001, Math.max(0, (z - field.origin[1]) / spacing))
  const ix = Math.floor(gx)
  const iz = Math.floor(gz)
  const fx = gx - ix
  const fz = gz - iz
  const index = iz * size + ix
  const a = heights[index]!
  const b = heights[index + 1]!
  const c = heights[index + size]!
  const d = heights[index + size + 1]!
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz
}

export function normalAt(field: Heightfield, x: number, z: number, out: [number, number, number] = [0, 1, 0]): [number, number, number] {
  const step = field.spacing
  const dx = heightAt(field, x + step, z) - heightAt(field, x - step, z)
  const dz = heightAt(field, x, z + step) - heightAt(field, x, z - step)
  const nx = -dx
  const ny = 2 * step
  const nz = -dz
  const length = Math.hypot(nx, ny, nz)
  out[0] = nx / length
  out[1] = ny / length
  out[2] = nz / length
  return out
}

export function slopeAt(field: Heightfield, x: number, z: number): number {
  const normal = normalAt(field, x, z)
  return Math.acos(Math.min(1, normal[1])) * 180 / Math.PI
}

export function heightTexture(field: Heightfield): DataTexture {
  const texture = new DataTexture(field.heights, field.size, field.size, RedFormat, FloatType)
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping
  texture.colorSpace = NoColorSpace
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

export type MaskSampler = (x: number, z: number) => readonly [number, number]

export function surfaceTexture(field: Heightfield, masks?: MaskSampler): DataTexture {
  const { size, spacing, origin } = field
  const data = new Uint8Array(size * size * 4)
  const normal: [number, number, number] = [0, 1, 0]
  for (let row = 0; row < size; row++) {
    const z = origin[1] + row * spacing
    for (let column = 0; column < size; column++) {
      const x = origin[0] + column * spacing
      normalAt(field, x, z, normal)
      const index = (row * size + column) * 4
      data[index] = Math.round((normal[0] * 0.5 + 0.5) * 255)
      data[index + 1] = Math.round((normal[2] * 0.5 + 0.5) * 255)
      const mask = masks ? masks(x, z) : [0, 0] as const
      data[index + 2] = Math.round(Math.min(1, Math.max(0, mask[0])) * 255)
      data[index + 3] = Math.round(Math.min(1, Math.max(0, mask[1])) * 255)
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping
  texture.colorSpace = NoColorSpace
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function decodeGrey16Png(buffer: ArrayBuffer): Promise<{ width: number; height: number; data: Uint16Array }> {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!signature.every((value, index) => bytes[index] === value)) throw new Error('Not a PNG')
  let offset = 8
  let width = 0
  let height = 0
  const chunks: Uint8Array[] = []
  while (offset < bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!)
    const body = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8)
      height = view.getUint32(offset + 12)
      if (body[8] !== 16 || body[9] !== 0 || body[12] !== 0) throw new Error('Heightmaps must be 16-bit greyscale, non-interlaced PNGs')
    } else if (type === 'IDAT') chunks.push(body)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  const joined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let cursor = 0
  for (const chunk of chunks) { joined.set(chunk, cursor); cursor += chunk.length }
  const raw = await inflate(joined)
  const stride = width * 2
  const out = new Uint8Array(stride * height)
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)]!
    const source = row * (stride + 1) + 1
    const target = row * stride
    for (let column = 0; column < stride; column++) {
      const value = raw[source + column]!
      const left = column >= 2 ? out[target + column - 2]! : 0
      const up = row > 0 ? out[target - stride + column]! : 0
      const corner = row > 0 && column >= 2 ? out[target - stride + column - 2]! : 0
      let predicted = 0
      if (filter === 1) predicted = left
      else if (filter === 2) predicted = up
      else if (filter === 3) predicted = (left + up) >> 1
      else if (filter === 4) {
        const p = left + up - corner
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - corner)
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner
      }
      out[target + column] = (value + predicted) & 255
    }
  }
  const data = new Uint16Array(width * height)
  for (let index = 0; index < data.length; index++) data[index] = (out[index * 2]! << 8) | out[index * 2 + 1]!
  return { width, height, data }
}

export interface HeightmapOptions {
  readonly spacing: number
  readonly minHeight: number
  readonly maxHeight: number
  readonly verticalScale?: number
  readonly origin?: readonly [number, number]
}

export async function loadHeightmap(url: string, options: HeightmapOptions): Promise<Heightfield> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Heightmap ${url}: ${response.status}`)
  const image = await decodeGrey16Png(await response.arrayBuffer())
  if (image.width !== image.height) throw new Error('Heightmaps must be square')
  const scale = options.verticalScale ?? 1
  const range = (options.maxHeight - options.minHeight) * scale
  const heights = new Float32Array(image.data.length)
  for (let index = 0; index < heights.length; index++) heights[index] = image.data[index]! / 65535 * range
  const extent = (image.width - 1) * options.spacing
  return createHeightfield({ size: image.width, extent, origin: options.origin, heights })
}
