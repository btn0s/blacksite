import { createWaterField, planWater } from './river.ts'
import type { SeaSpec, WaterLayout, WaterSpec, XZ } from './river.ts'

export interface LandscapeShape {
  readonly name: string
  readonly centre: XZ
  readonly near: { readonly extent: number; readonly size: number }
  readonly far: { readonly extent: number; readonly size: number }
  readonly band: number
  readonly seaLevel: number
  readonly sea?: SeaSpec
  readonly water: readonly WaterSpec[]
  macro(x: number, z: number): number
  hills(x: number, z: number, detail: boolean): number
  masks(x: number, z: number, height: number, slope: number, bank: number): readonly [number, number]
}

export interface FieldRecord {
  readonly file: string
  readonly size: number
  readonly extent: number
  readonly origin: XZ
  readonly min: number
  readonly max: number
}

export interface LandscapeManifest {
  readonly version: 1
  readonly name: string
  readonly band: number
  readonly seaLevel: number
  readonly near: FieldRecord
  readonly far: FieldRecord
  readonly water: string
}

export interface BakedField {
  readonly record: FieldRecord
  readonly data: Uint8Array
}

export interface BakedLandscape {
  readonly manifest: LandscapeManifest
  readonly near: BakedField
  readonly far: BakedField
  readonly water: WaterLayout
}

export interface LandscapeBakeOptions {
  readonly onProgress?: (fraction: number) => void
}

export function bakeLandscape(shape: LandscapeShape, options: LandscapeBakeOptions = {}): BakedLandscape {
  const layout = planWater(shape.water, shape.macro, shape.seaLevel, shape.sea)
  const channel = createWaterField(layout)
  const scratch = { height: 0, shore: 0 }
  const parts = (x: number, z: number, detail: boolean) => channel.sample(x, z, shape.macro(x, z), shape.hills(x, z, detail), scratch)
  const total = shape.near.size + shape.far.size
  let done = 0
  const bake = (file: string, field: { extent: number; size: number }, detail: boolean): BakedField => {
    const { size, extent } = field
    const spacing = extent / (size - 1)
    const origin: XZ = [shape.centre[0] - extent / 2, shape.centre[1] - extent / 2]
    const heights = new Float32Array(size * size)
    const banks = new Float32Array(size * size)
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        const sample = parts(origin[0] + column * spacing, origin[1] + row * spacing, detail)
        heights[row * size + column] = sample.height
        banks[row * size + column] = sample.shore
      }
      options.onProgress?.((done + row / size) / total)
    }
    done += size
    let min = Infinity
    let max = -Infinity
    for (const value of heights) { if (value < min) min = value; if (value > max) max = value }
    const data = new Uint8Array(size * size * 6)
    const quantized = new Uint16Array(data.buffer, 0, size * size)
    const surface = data.subarray(size * size * 2)
    const at = (column: number, row: number) => heights[Math.min(size - 1, Math.max(0, row)) * size + Math.min(size - 1, Math.max(0, column))]!
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        const index = row * size + column
        const value = heights[index]!
        quantized[index] = Math.round((value - min) / (max - min) * 65535)
        const dx = at(column + 1, row) - at(column - 1, row)
        const dz = at(column, row + 1) - at(column, row - 1)
        const length = Math.hypot(dx, 2 * spacing, dz)
        const [b, a] = shape.masks(origin[0] + column * spacing, origin[1] + row * spacing, value, Math.hypot(dx, dz) / (2 * spacing), banks[index]!)
        surface[index * 4] = Math.round((-dx / length * 0.5 + 0.5) * 255)
        surface[index * 4 + 1] = Math.round((-dz / length * 0.5 + 0.5) * 255)
        surface[index * 4 + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255)
        surface[index * 4 + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255)
      }
    }
    return { record: { file, size, extent, origin, min, max }, data }
  }
  const near = bake('near.bin', shape.near, true)
  const far = bake('far.bin', shape.far, false)
  return {
    manifest: { version: 1, name: shape.name, band: shape.band, seaLevel: shape.seaLevel, near: near.record, far: far.record, water: 'water.json' },
    near, far, water: layout,
  }
}
