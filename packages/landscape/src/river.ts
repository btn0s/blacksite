export type XZ = readonly [number, number]
export type CubicPath = readonly [XZ, XZ, XZ, XZ]

export function sampleCurves(curves: readonly CubicPath[], spacing = 12): XZ[] {
  const points: XZ[] = []
  for (const [a, b, c, d] of curves) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1]) + Math.hypot(d[0] - c[0], d[1] - c[1])
    const steps = Math.max(1, Math.ceil(length / Math.min(4, spacing / 4)))
    for (let index = points.length ? 1 : 0; index <= steps; index++) {
      const t = index / steps
      const u = 1 - t
      points.push([u ** 3 * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t ** 3 * d[0], u ** 3 * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t ** 3 * d[1]])
    }
  }
  if (!points.length) return points
  const samples: XZ[] = [points[0]!]
  let total = 0
  for (let index = 1; index < points.length; index++) total += Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1])
  if (total === 0) return samples
  const interval = total / Math.max(1, Math.round(total / spacing))
  let distance = 0
  let next = interval
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!
    const b = points[index]!
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    while (next <= distance + length) {
      const t = (next - distance) / length
      samples.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
      next += interval
    }
    distance += length
  }
  const end = points[points.length - 1]!
  const last = samples[samples.length - 1]!
  if (Math.hypot(end[0] - last[0], end[1] - last[1]) > 1e-6) samples.push(end)
  return samples
}

export function smoothCurve(points: readonly XZ[]): CubicPath[] {
  const segments: CubicPath[] = []
  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[Math.max(0, index - 1)]!
    const p1 = points[index]!
    const p2 = points[index + 1]!
    const p3 = points[Math.min(points.length - 1, index + 2)]!
    segments.push([p1, [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6], p2])
  }
  return segments
}

export interface RiverSpec {
  readonly kind: 'river'
  readonly name: string
  readonly curves: readonly CubicPath[]
  readonly halfWidth: readonly [number, number]
  readonly depth: readonly [number, number]
  readonly dig: number
  readonly smoothing: number
  readonly spill?: string
  readonly join?: string
}

export interface TarnSpec {
  readonly kind: 'tarn'
  readonly name: string
  readonly at: XZ
  readonly radius: number
  readonly depth: number
  readonly lift: number
}

export type WaterSpec = RiverSpec | TarnSpec

export type RiverSample = readonly [x: number, z: number, level: number, halfWidth: number, depth: number, speed: number]

export interface RiverLayout {
  readonly kind: 'river'
  readonly name: string
  readonly samples: readonly RiverSample[]
}

export interface TarnLayout {
  readonly kind: 'tarn'
  readonly name: string
  readonly at: XZ
  readonly radius: number
  readonly depth: number
  readonly level: number
}

export type WaterFeature = RiverLayout | TarnLayout

export interface SeaSpec {
  readonly min: XZ
  readonly max: XZ
}

export interface WaterLayout {
  readonly seaLevel: number
  readonly sea?: SeaSpec
  readonly features: readonly WaterFeature[]
}

const SPACING = 12
const MIN_FALL = 0.0004
const BANK_HEIGHT = 1.6
const MOUTH_LIFT = 0.05
const TARN_BENCH = 16
const TARN_FADE = 48

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places

function nearestSample(river: RiverLayout, x: number, z: number) {
  let best = 0
  let bestDistance = Infinity
  river.samples.forEach((sample, index) => {
    const distance = Math.hypot(sample[0] - x, sample[1] - z)
    if (distance < bestDistance) { bestDistance = distance; best = index }
  })
  return best
}

function planRiver(spec: RiverSpec, ground: (x: number, z: number) => number, seaLevel: number, planned: ReadonlyMap<string, WaterFeature>): RiverLayout {
  const path = sampleCurves(spec.curves, SPACING)
  const count = path.length
  const along = new Float64Array(count)
  for (let index = 1; index < count; index++) along[index] = along[index - 1]! + Math.hypot(path[index]![0] - path[index - 1]![0], path[index]![1] - path[index - 1]![1])
  const total = along[count - 1]!
  const heights = path.map(([x, z]) => ground(x, z))
  const window = Math.max(1, Math.round(spec.smoothing / SPACING))
  const averaged = heights.map((_, index) => {
    let sum = 0
    let weight = 0
    for (let k = Math.max(0, index - window); k <= Math.min(count - 1, index + window); k++) { sum += heights[k]!; weight++ }
    return sum / weight
  })
  const source = spec.spill ? planned.get(spec.spill) : undefined
  if (spec.spill && source?.kind !== 'tarn') throw new Error(`River ${spec.name} spills from unknown tarn ${spec.spill}`)
  const level = new Float64Array(count)
  let previous = Infinity
  for (let index = 0; index < count; index++) {
    const fall = index === 0 ? 0 : MIN_FALL * (along[index]! - along[index - 1]!)
    let candidate = averaged[index]! - spec.dig
    if (index === 0 && source?.kind === 'tarn') candidate = source.level - 0.2
    level[index] = previous = Math.min(previous - fall, candidate)
  }
  let end = count
  for (let index = 0; index < count; index++) if (level[index]! <= seaLevel + MOUTH_LIFT) { end = index + 1; break }
  if (spec.join) {
    const target = planned.get(spec.join)
    if (target?.kind !== 'river') throw new Error(`River ${spec.name} joins unknown river ${spec.join}`)
    const last = path[count - 1]!
    const meeting = target.samples[nearestSample(target, last[0], last[1])]!
    level[count - 1] = meeting[2] + 0.25
    for (let index = count - 2; index >= 0; index--) level[index] = Math.max(level[index]!, level[index + 1]! + MIN_FALL * (along[index + 1]! - along[index]!))
  }
  if (end < count) level[end - 1] = seaLevel + MOUTH_LIFT
  const samples: RiverSample[] = []
  for (let index = 0; index < end; index++) {
    const t = along[index]! / total
    const wander = 1 + 0.14 * Math.sin(along[index]! / 230) + 0.08 * Math.sin(along[index]! / 97 + 1)
    const ahead = Math.min(count - 1, index + 2)
    const behind = Math.max(0, index - 2)
    const grade = Math.max(0, (level[behind]! - level[ahead]!) / Math.max(1, along[ahead]! - along[behind]!))
    samples.push([
      round(path[index]![0], 1), round(path[index]![1], 1), round(level[index]!, 2),
      round((spec.halfWidth[0] + (spec.halfWidth[1] - spec.halfWidth[0]) * smooth(0, 1, t)) * wander, 2),
      round(spec.depth[0] + (spec.depth[1] - spec.depth[0]) * smooth(0, 1, t), 2),
      round(Math.min(8, 0.5 + 24 * grade), 2),
    ])
  }
  return { kind: 'river', name: spec.name, samples }
}

export function planWater(specs: readonly WaterSpec[], ground: (x: number, z: number) => number, seaLevel: number, sea?: SeaSpec): WaterLayout {
  const planned = new Map<string, WaterFeature>()
  for (const spec of specs) {
    planned.set(spec.name, spec.kind === 'tarn' ? { kind: 'tarn', name: spec.name, at: spec.at, radius: spec.radius, depth: spec.depth, level: round(ground(spec.at[0], spec.at[1]) + spec.lift, 2) } : planRiver(spec, ground, seaLevel, planned))
  }
  return { seaLevel, sea, features: [...planned.values()] }
}

export interface WaterSample {
  height: number
  shore: number
}

export interface WaterField {
  readonly reach: number
  sample(x: number, z: number, base: number, rough: number, out: WaterSample): WaterSample
  surface(x: number, z: number): number
}

const CELL = 128

interface RiverIndex {
  readonly river: RiverLayout
  readonly cells: Map<number, number[]>
  readonly reach: number
}

interface Reach {
  distance: number
  level: number
  halfWidth: number
  depth: number
}

const cellKey = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096)

const bankWidth = (halfWidth: number) => 10 + halfWidth
const coreOf = (halfWidth: number) => halfWidth + bankWidth(halfWidth) + 16
const fadeOf = (halfWidth: number) => 60 + 3 * halfWidth

function indexRiver(river: RiverLayout): RiverIndex {
  const cells = new Map<number, number[]>()
  let reach = 0
  for (const sample of river.samples) reach = Math.max(reach, coreOf(sample[3]) + fadeOf(sample[3]))
  for (let index = 0; index < river.samples.length - 1; index++) {
    const a = river.samples[index]!
    const b = river.samples[index + 1]!
    const i0 = Math.floor((Math.min(a[0], b[0]) - reach) / CELL)
    const i1 = Math.floor((Math.max(a[0], b[0]) + reach) / CELL)
    const j0 = Math.floor((Math.min(a[1], b[1]) - reach) / CELL)
    const j1 = Math.floor((Math.max(a[1], b[1]) + reach) / CELL)
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const key = cellKey(i, j)
      const list = cells.get(key)
      if (list) list.push(index)
      else cells.set(key, [index])
    }
  }
  return { river, cells, reach }
}

function nearest(indexed: RiverIndex, x: number, z: number, out: Reach): Reach | null {
  const { river, cells } = indexed
  const list = cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)))
  if (!list) return null
  let best = Infinity
  let at = 0
  let along = 0
  for (const index of list) {
    const a = river.samples[index]!
    const b = river.samples[index + 1]!
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const t = Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)))
    const distance = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t)
    if (distance < best) { best = distance; at = index; along = t }
  }
  if (best === Infinity) return null
  const a = river.samples[at]!
  const b = river.samples[at + 1]!
  out.distance = best
  out.level = a[2] + (b[2] - a[2]) * along
  out.halfWidth = a[3] + (b[3] - a[3]) * along
  out.depth = a[4] + (b[4] - a[4]) * along
  return out
}

export function createWaterField(layout: WaterLayout): WaterField {
  const indexed = layout.features.map(feature => feature.kind === 'river' ? indexRiver(feature) : null)
  const scratch: Reach = { distance: 0, level: 0, halfWidth: 0, depth: 0 }
  let reach = 0
  layout.features.forEach((feature, slot) => { reach = Math.max(reach, feature.kind === 'river' ? indexed[slot]!.reach : feature.radius + TARN_BENCH + TARN_FADE) })
  return {
    reach,
    sample(x, z, base, rough, out) {
      let shore = 0
      let wet = 0
      layout.features.forEach((feature, slot) => {
        if (feature.kind === 'tarn') {
          const r = Math.hypot(x - feature.at[0], z - feature.at[1])
          const outer = feature.radius + TARN_BENCH
          if (r >= outer + TARN_FADE) return
          const u = Math.min(1, r / feature.radius)
          const profile = r < feature.radius ? feature.level - feature.depth * (1 - u * u) : feature.level + 1.4 * smooth(feature.radius, feature.radius + 10, r)
          const c = (1 - smooth(outer, outer + TARN_FADE, r)) * (1 - wet)
          base += (profile - base) * c
          rough *= 1 - c
          shore = Math.max(shore, 1 - smooth(feature.radius, feature.radius + 9, r))
          wet = Math.max(wet, 1 - smooth(feature.radius, feature.radius + 6, r))
          return
        }
        const found = nearest(indexed[slot]!, x, z, scratch)
        if (!found) return
        const bank = bankWidth(found.halfWidth)
        const core = coreOf(found.halfWidth)
        const c = (1 - smooth(core, core + fadeOf(found.halfWidth), found.distance)) * (1 - wet)
        wet = Math.max(wet, 1 - smooth(found.halfWidth, found.halfWidth + 6, found.distance))
        if (c <= 0) return
        const u = Math.min(1, found.distance / found.halfWidth)
        const profile = found.distance < found.halfWidth ? found.level - found.depth * (1 - u * u) : found.level + BANK_HEIGHT * smooth(found.halfWidth, found.halfWidth + bank, found.distance)
        base += (profile - base) * c
        rough *= 1 - c
        shore = Math.max(shore, 1 - smooth(found.halfWidth, found.halfWidth + 10, found.distance))
      })
      out.height = base + rough
      out.shore = shore
      return out
    },
    surface(x, z) {
      let top = -Infinity
      layout.features.forEach((feature, slot) => {
        if (feature.kind === 'tarn') {
          if (Math.hypot(x - feature.at[0], z - feature.at[1]) < feature.radius) top = Math.max(top, feature.level)
          return
        }
        const found = nearest(indexed[slot]!, x, z, scratch)
        if (found && found.distance < found.halfWidth) top = Math.max(top, found.level)
      })
      return top
    },
  }
}
