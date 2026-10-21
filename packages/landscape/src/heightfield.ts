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
  return surfaceTextureFromData(data, size)
}

export function surfaceTextureFromData(data: Uint8Array, size: number): DataTexture {
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping
  texture.colorSpace = NoColorSpace
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}
