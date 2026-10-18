export type Colour = `#${string}`
export type Constant = number | Colour | readonly [number, number, number]
export type Input = string | Constant
export type Metres = number | readonly [number, number]
export type BlendMode = (typeof BLEND_MODES)[number]
export type ShapeOutput = (typeof OUTPUTS)[number]
type NoiseOptions = { readonly cell?: Metres; readonly seed?: number; readonly octaves?: number; readonly gain?: number; readonly sharpness?: number; readonly mode?: (typeof CELL_MODES)[number]; readonly jitter?: number }
type TileOptions = { readonly tile?: Metres; readonly gap?: number; readonly bevel?: number; readonly offset?: number; readonly offsetJitter?: number; readonly lengthJitter?: number; readonly jitter?: number; readonly seed?: number; readonly output?: ShapeOutput }
type FilterInput = { readonly input: Input }
export type NodeSpec =
  | { readonly op: 'const'; readonly value: Constant }
  | ({ readonly op: 'value' | 'perlin' | 'cellular' | 'ridged' } & NoiseOptions)
  | ({ readonly op: 'fbm'; readonly basis?: 'value' | 'perlin' | 'cellular' } & NoiseOptions)
  | { readonly op: 'wave'; readonly period?: number; readonly axis?: 'u' | 'v'; readonly shape?: 'sine' | 'triangle' | 'saw'; readonly phase?: number }
  | ({ readonly op: 'tiles' | 'bricks' | 'panels' | 'planks' } & TileOptions)
  | { readonly op: 'rivets'; readonly spacing?: Metres; readonly radius?: number; readonly offset?: Metres; readonly output?: ShapeOutput }
  | { readonly op: 'scatter'; readonly cell?: Metres; readonly radius?: number; readonly sizeJitter?: number; readonly density?: number; readonly shape?: (typeof SCATTER_SHAPES)[number]; readonly rotate?: boolean; readonly seed?: number; readonly output?: ShapeOutput; readonly stretch?: number }
  | { readonly op: 'image'; readonly src: string; readonly repeat?: Metres }
  | ({ readonly op: 'seamless'; readonly width?: number } & FilterInput)
  | ({ readonly op: 'blur' | 'highpass'; readonly radius?: number } & FilterInput)
  | ({ readonly op: 'delight' | 'curvature' | 'ao'; readonly radius?: number; readonly strength?: number } & FilterInput)
  | ({ readonly op: 'normal'; readonly strength?: number } & FilterInput)
  | ({ readonly op: 'warp'; readonly by: Input; readonly byY?: Input; readonly amount?: number } & FilterInput)
  | ({ readonly op: 'slopeBlur'; readonly slope: Input; readonly amount?: number; readonly samples?: number; readonly mode?: 'blur' | 'min' | 'max' } & FilterInput)
  | ({ readonly op: 'levels' | 'invert'; readonly in?: readonly [number, number]; readonly out?: readonly [number, number]; readonly gamma?: number } & FilterInput)
  | { readonly op: 'blend'; readonly a: Input; readonly b: Input; readonly mask?: Input; readonly mode?: BlendMode; readonly opacity?: number }
  | ({ readonly op: 'ramp'; readonly stops: readonly (readonly [number, Constant])[] } & FilterInput)
  | ({ readonly op: 'hsv'; readonly hue?: number; readonly saturation?: number; readonly value?: number } & FilterInput)
  | ({ readonly op: 'channel'; readonly channel?: (typeof CHANNELS)[number] } & FilterInput)
  | ({ readonly op: 'transform'; readonly offset?: Metres; readonly rotate?: number; readonly repeat?: number; readonly flip?: boolean } & FilterInput)
type RawNode = { readonly op: string; readonly [field: string]: unknown }
export type Orientation = 'wall' | 'floor' | 'object'

export type Wear = { readonly amount: number; readonly color?: Colour; readonly roughness?: number; readonly metalness?: number }
export type Damage = { readonly chips?: number; readonly bullets?: number; readonly scorch?: number; readonly seed?: number }

export type Weather = {
  readonly age?: number
  readonly dirt?: number
  readonly moisture?: number
  readonly puddles?: number
  readonly rust?: number
  readonly wear?: number | Wear
  readonly damage?: Damage
  readonly dirtColor?: Colour
  readonly seed?: number
}

export type MaterialGraph = {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly size: number
  readonly depth: number
  readonly seed?: number
  readonly orientation?: Orientation
  readonly nodes: Readonly<Record<string, NodeSpec>>
  readonly outputs: {
    readonly color: Input
    readonly height?: Input
    readonly roughness?: Input
    readonly metalness?: Input
    readonly ao?: Input
    readonly normal?: Input
  }
  readonly finish?: { readonly normal?: number; readonly ao?: { readonly radius?: number; readonly strength?: number } }
  readonly weather?: Weather
  readonly porosity?: number
  readonly wear?: Omit<Wear, 'amount'>
}

export type KernelName =
  | 'const' | 'noise' | 'wave' | 'tiles' | 'rivets' | 'scatter' | 'image'
  | 'warp' | 'blurPass' | 'slopeBlur' | 'levels' | 'curvature' | 'normal' | 'ao'
  | 'blend' | 'ramp' | 'hsv' | 'channel' | 'transform' | 'seamlessPass' | 'delight' | 'pack'

export type Step = {
  readonly id: string
  readonly kernel: KernelName
  readonly params: Float32Array
  readonly inputs: readonly string[]
  readonly stops?: Float32Array
  readonly image?: string
}

export type Program = {
  readonly name: string
  readonly res: number
  readonly size: number
  readonly depth: number
  readonly steps: readonly Step[]
  readonly outputs: { readonly color: string; readonly normal: string; readonly orm: string; readonly masks: string }
  readonly images: readonly string[]
}

export const PARAMS: Record<KernelName, readonly string[]> = {
  const: ['r', 'g', 'b', 'a'],
  noise: ['basis', 'px', 'py', 'seed', 'octaves', 'gain', 'ridged', 'sharpness', 'mode', 'jitter'],
  wave: ['axis', 'cycles', 'shape', 'phase'],
  tiles: ['cols', 'rows', 'gap', 'bevel', 'offset', 'offsetJitter', 'lengthJitter', 'jitter', 'seed', 'output', 'size', 'pixel'],
  rivets: ['cols', 'rows', 'radius', 'offsetU', 'offsetV', 'size', 'pixel', 'output'],
  scatter: ['cols', 'rows', 'radius', 'sizeJitter', 'density', 'shape', 'rotate', 'seed', 'output', 'size', 'pixel', 'stretch', 'reachX', 'reachY'],
  image: ['repeatU', 'repeatV'],
  warp: ['amount', 'size', 'vector'],
  blurPass: ['axis', 'sigma', 'taps'],
  slopeBlur: ['step', 'samples', 'mode'],
  levels: ['inLow', 'inHigh', 'gamma', 'outLow', 'outHigh'],
  curvature: ['radius', 'scale'],
  normal: ['scale', 'based'],
  ao: ['radius', 'depth', 'strength'],
  blend: ['mode', 'opacity', 'masked'],
  ramp: ['count'],
  hsv: ['hue', 'saturation', 'value'],
  channel: ['channel'],
  transform: ['repeat', 'offsetU', 'offsetV', 'rotate', 'flip'],
  seamlessPass: ['axis', 'width'],
  delight: ['strength'],
  pack: ['c0', 'c1', 'c2', 'c3'],
}

export const BLEND_MODES = ['mix', 'add', 'subtract', 'multiply', 'screen', 'overlay', 'max', 'min', 'difference', 'highpass'] as const
export const SCATTER_SHAPES = ['disc', 'crater', 'chip', 'blob', 'streak'] as const
export const CELL_MODES = ['f1', 'f2', 'edge', 'id'] as const
const CHANNELS = ['r', 'g', 'b', 'a', 'luma'] as const
const OUTPUTS = ['height', 'random', 'mask', 'distance'] as const

export function parseColour(value: unknown): [number, number, number] {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new GraphError('constant must be finite')
  if (typeof value === 'number') return [value, value, value]
  if (Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n))) return [value[0], value[1], value[2]]
  if (typeof value !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) throw new GraphError('colour must be #rgb, #rrggbb, a finite number or [r, g, b]')
  const hex = value.slice(1)
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex
  const n = parseInt(full, 16)
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]
}

export function hashString(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0) & 0xffffff
}

export class GraphError extends Error {}

type Check = (value: unknown, at: string) => void
const finite: Check = (value, at) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e20) throw new GraphError(`${at} must be a finite number within ±1e20`)
}
const range = (low: number, high: number, open = false): Check => (value, at) => {
  finite(value, at)
  if ((value as number) < low || (value as number) > high || (open && value === low)) throw new GraphError(`${at} must be ${open ? 'greater than' : 'at least'} ${low} and at most ${high}`)
}
const positive = range(0, 1e20, true)
const nonnegative = range(0, 1e20)
const unit = range(0, 1)
const integer = (low: number, high: number): Check => (value, at) => {
  range(low, high)(value, at)
  if (!Number.isInteger(value)) throw new GraphError(`${at} must be an integer`)
}
const seedCheck = integer(-2147483648, 2147483647)
const textCheck: Check = (value, at) => { if (typeof value !== 'string' || !value.trim()) throw new GraphError(`${at} must be a nonempty string`) }
const boolCheck: Check = (value, at) => { if (typeof value !== 'boolean') throw new GraphError(`${at} must be a boolean`) }
const enumCheck = (values: readonly string[]): Check => (value, at) => { if (typeof value !== 'string' || !values.includes(value)) throw new GraphError(`${at} must be one of ${values.join(', ')}`) }
const tupleCheck = (check: Check): Check => (value, at) => {
  if (!Array.isArray(value) || value.length !== 2) throw new GraphError(`${at} must be [x, y]`)
  value.forEach((v, i) => check(v, `${at}[${i}]`))
}
const pairCheck = (check: Check): Check => (value, at) => typeof value === 'number' ? check(value, at) : tupleCheck(check)(value, at)
const colourCheck: Check = (value, at) => {
  try { parseColour(value).forEach(v => finite(v, at)) } catch (error) { if (error instanceof GraphError) throw new GraphError(`${at}: ${error.message}`); throw error }
}
const inputCheck: Check = (value, at) => typeof value === 'string' && !value.startsWith('#') ? textCheck(value, at) : colourCheck(value, at)
const record = (value: unknown, at: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new GraphError(`${at} must be an object`)
  return value as Record<string, unknown>
}
const objectCheck = (checks: Readonly<Record<string, Check>>, required: readonly string[] = []): Check => (value, at) => {
  const data = record(value, at)
  for (const field of required) if (data[field] === undefined) throw new GraphError(`${at}.${field} is required`)
  for (const [field, entry] of Object.entries(data)) {
    if (!Object.hasOwn(checks, field)) throw new GraphError(`${at}.${field} is not a supported field`)
    if (entry !== undefined) checks[field]!(entry, `${at}.${field}`)
  }
}
const noiseChecks = { cell: pairCheck(positive), seed: seedCheck, octaves: integer(1, 10), gain: unit, sharpness: positive, mode: enumCheck(CELL_MODES), jitter: unit }
const tileChecks = { tile: pairCheck(positive), gap: nonnegative, bevel: nonnegative, offset: unit, offsetJitter: unit, lengthJitter: range(0, 0.8), jitter: unit, seed: seedCheck, output: enumCheck(OUTPUTS) }
const filterChecks = { input: inputCheck }
const radiusChecks = { ...filterChecks, radius: nonnegative }
const strengthChecks = { ...radiusChecks, strength: nonnegative }
const levelsChecks = { ...filterChecks, in: tupleCheck(finite), out: tupleCheck(finite), gamma: positive }
const stopsCheck: Check = (value, at) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new GraphError(`${at} needs 1–16 [position, colour] pairs`)
  let previous = -Infinity
  value.forEach((stop, i) => {
    if (!Array.isArray(stop) || stop.length !== 2) throw new GraphError(`${at}[${i}] must be [position, colour]`)
    unit(stop[0], `${at}[${i}][0]`)
    if (stop[0] <= previous) throw new GraphError(`${at} positions must be strictly increasing`)
    previous = stop[0]
    colourCheck(stop[1], `${at}[${i}][1]`)
  })
}
const nodeChecks: Record<NodeSpec['op'], Readonly<Record<string, Check>>> = {
  const: { value: colourCheck },
  value: noiseChecks, perlin: noiseChecks, cellular: noiseChecks, ridged: noiseChecks,
  fbm: { ...noiseChecks, basis: enumCheck(['value', 'perlin', 'cellular']) },
  wave: { period: positive, axis: enumCheck(['u', 'v']), shape: enumCheck(['sine', 'triangle', 'saw']), phase: finite },
  tiles: tileChecks, bricks: tileChecks, panels: tileChecks, planks: tileChecks,
  rivets: { spacing: pairCheck(positive), radius: positive, offset: pairCheck(finite), output: enumCheck(OUTPUTS) },
  scatter: { cell: pairCheck(positive), radius: positive, sizeJitter: range(0, 0.999999), density: unit, shape: enumCheck(SCATTER_SHAPES), rotate: boolCheck, seed: seedCheck, output: enumCheck(OUTPUTS), stretch: positive },
  image: { src: textCheck, repeat: pairCheck(integer(1, 64)) },
  seamless: { ...filterChecks, width: range(0, 0.5, true) },
  blur: radiusChecks, highpass: radiusChecks, delight: { ...radiusChecks, strength: unit }, curvature: strengthChecks, ao: strengthChecks,
  normal: { ...filterChecks, strength: nonnegative },
  warp: { ...filterChecks, by: inputCheck, byY: inputCheck, amount: nonnegative },
  slopeBlur: { ...filterChecks, slope: inputCheck, amount: nonnegative, samples: integer(1, 32), mode: enumCheck(['blur', 'min', 'max']) },
  levels: levelsChecks, invert: levelsChecks,
  blend: { a: inputCheck, b: inputCheck, mask: inputCheck, mode: enumCheck(BLEND_MODES), opacity: unit },
  ramp: { ...filterChecks, stops: stopsCheck },
  hsv: { ...filterChecks, hue: finite, saturation: nonnegative, value: nonnegative },
  channel: { ...filterChecks, channel: enumCheck(CHANNELS) },
  transform: { ...filterChecks, offset: pairCheck(finite), rotate: finite, repeat: integer(1, 65536), flip: boolCheck },
}
const wearChecks = { color: colourCheck, roughness: unit, metalness: unit }
const weatherCheck = objectCheck({
  age: unit, dirt: unit, moisture: unit, puddles: unit, rust: unit, dirtColor: colourCheck, seed: seedCheck,
  wear: (value, at) => typeof value === 'number' ? unit(value, at) : objectCheck({ ...wearChecks, amount: unit }, ['amount'])(value, at),
  damage: objectCheck({ chips: unit, bullets: unit, scorch: unit, seed: seedCheck }),
})

export function parseGraph(value: unknown): MaterialGraph {
  objectCheck({
    name: (name, at) => { textCheck(name, at); if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name as string)) throw new GraphError(`${at} must contain only letters, numbers, underscores and hyphens`) },
    title: textCheck, description: textCheck, size: positive, depth: nonnegative, seed: seedCheck, orientation: enumCheck(['wall', 'floor', 'object']), porosity: unit,
    wear: objectCheck(wearChecks), weather: weatherCheck,
    finish: objectCheck({ normal: nonnegative, ao: objectCheck({ radius: nonnegative, strength: nonnegative }) }),
    outputs: objectCheck({ color: inputCheck, height: inputCheck, roughness: inputCheck, metalness: inputCheck, ao: inputCheck, normal: inputCheck }, ['color']),
    nodes: (nodes, at) => {
      const entries = Object.entries(record(nodes, at))
      if (entries.length > 1024) throw new GraphError(`${at} may contain at most 1024 nodes`)
      for (const [id, value] of entries) {
        if (!id || /[#:]/.test(id)) throw new GraphError(`node id "${id}" must be nonempty and may not contain # or :`)
        const data = record(value, `${at}.${id}`)
        if (typeof data.op !== 'string' || !Object.hasOwn(nodeChecks, data.op)) throw new GraphError(`${at}.${id}: unknown op "${String(data.op)}"`)
        const checks = nodeChecks[data.op as NodeSpec['op']]
        const required = ['input', 'a', 'b', 'by', 'slope', 'stops', 'src', ...(data.op === 'const' ? ['value'] : [])].filter(field => Object.hasOwn(checks, field))
        objectCheck({ op: textCheck, ...checks }, required)(data, `${at}.${id}`)
      }
    },
  }, ['name', 'size', 'depth', 'nodes', 'outputs'])(value, 'graph')
  return value as MaterialGraph
}

type Ctx = {
  graph: MaterialGraph
  res: number
  pixel: number
  steps: Step[]
  specs: Map<string, RawNode>
  built: Map<string, string>
  building: Set<string>
  consts: Map<string, string>
  images: Set<string>
  counter: number
}

const num = (spec: RawNode, key: string, fallback: number) => {
  const value = spec[key]
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new GraphError(`${String(spec.op)}.${key} must be a number`)
  return value
}
const pair = (value: unknown, fallback: Metres): [number, number] => {
  const v = value ?? fallback
  if (typeof v === 'number' && Number.isFinite(v)) return [v, v]
  if (Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && Number.isFinite(n))) return [v[0], v[1]]
  throw new GraphError(`expected a number or [x, y], got ${JSON.stringify(value)}`)
}
const pick = <T extends readonly string[]>(spec: RawNode, key: string, list: T, fallback: T[number]) => {
  const value = (spec[key] ?? fallback) as string
  const index = list.indexOf(value)
  if (index < 0) throw new GraphError(`${String(spec.op)}.${key} must be one of ${list.join(', ')}`)
  return index
}
const periods = (size: number, cell: [number, number]) => {
  const result = [Math.max(1, Math.round(size / cell[0])), Math.max(1, Math.round(size / cell[1]))] as const
  if (result.some(value => !Number.isFinite(value) || value > 1048576)) throw new GraphError('cell dimensions must produce at most 1048576 periods per tile')
  return result
}

function push(ctx: Ctx, id: string, kernel: KernelName, values: Record<string, number>, inputs: string[], extra: Partial<Step> = {}) {
  if (kernel === 'scatter') {
    const lobes = values.shape === 2 || values.shape === 3 ? 1.47 : 1
    const stretch = Math.max(1, values.stretch! * (values.shape === 4 ? 4 : 1))
    const extent = (values.radius! * lobes + values.pixel! / 2) * stretch
    values.reachX = Math.max(1, Math.ceil(extent * values.cols! / values.size!))
    values.reachY = Math.max(1, Math.ceil(extent * values.rows! / values.size!))
    if (values.reachX > 8 || values.reachY > 8) throw new GraphError(`${id}: scatter radius and stretch may span at most eight neighbouring cells`)
  }
  const names = PARAMS[kernel]
  const params = new Float32Array(16)
  names.forEach((name, i) => {
    params[i] = values[name] ?? 0
    if (!Number.isFinite(params[i])) throw new GraphError(`${id}.${name} exceeds the finite shader range`)
  })
  for (const key of Object.keys(values)) if (!names.includes(key)) throw new Error(`kernel ${kernel} has no param ${key}`)
  ctx.steps.push({ id, kernel, params, inputs, ...extra })
  return id
}

function constant(ctx: Ctx, value: Input) {
  const [r, g, b] = parseColour(value)
  const key = `${r},${g},${b}`
  const existing = ctx.consts.get(key)
  if (existing) return existing
  const id = push(ctx, `const:${key}`, 'const', { r, g, b, a: 1 }, [])
  ctx.consts.set(key, id)
  return id
}

function input(ctx: Ctx, value: unknown, owner: string, key: string): string {
  if (value === undefined) throw new GraphError(`${owner}.${key} is required`)
  if (typeof value === 'number' || Array.isArray(value)) return constant(ctx, value as Input)
  if (typeof value === 'string' && value.startsWith('#')) return constant(ctx, value as Colour)
  if (typeof value === 'string') return node(ctx, value)
  throw new GraphError(`${owner}.${key} must be a node id, a number or a colour`)
}

function seedOf(ctx: Ctx, id: string, spec: RawNode) {
  return (num(spec, 'seed', hashString(id)) ^ Math.imul(ctx.graph.seed ?? 0, 2654435761)) & 0xffffff
}

function blurSteps(ctx: Ctx, id: string, source: string, radius: number) {
  const sigma = Math.max(0.35, radius / ctx.pixel / 2)
  const taps = Math.min(256, Math.ceil(sigma * 2.5))
  push(ctx, `${id}#x`, 'blurPass', { axis: 0, sigma, taps }, [source])
  return push(ctx, id, 'blurPass', { axis: 1, sigma, taps }, [`${id}#x`])
}

function node(ctx: Ctx, id: string): string {
  const done = ctx.built.get(id)
  if (done) return done
  const spec = ctx.specs.get(id)
  if (!spec) throw new GraphError(`unknown node "${id}"`)
  if (ctx.building.has(id)) throw new GraphError(`cycle through "${id}"`)
  ctx.building.add(id)
  const out = build(ctx, id, spec)
  ctx.building.delete(id)
  ctx.built.set(id, out)
  return out
}

export function octaveCap(res: number, px: number, py: number, wanted: number) {
  const nyquist = Math.floor(Math.log2(res / 2 / Math.max(px, py))) + 1
  return Math.max(1, Math.min(10, Math.round(wanted), nyquist))
}

function noise(ctx: Ctx, id: string, spec: RawNode, basis: number, octaves: number, ridged: number) {
  const [px, py] = periods(ctx.graph.size, pair(spec.cell, 0.25))
  return push(ctx, id, 'noise', {
    basis, px, py, seed: seedOf(ctx, id, spec), octaves: octaveCap(ctx.res, px, py, num(spec, 'octaves', octaves)),
    gain: num(spec, 'gain', 0.5), ridged, sharpness: num(spec, 'sharpness', 2), mode: pick(spec, 'mode', CELL_MODES, 'f1'), jitter: num(spec, 'jitter', 0.9),
  }, [])
}

const TILE_DEFAULTS: Record<string, Record<string, unknown>> = {
  tiles: { tile: 0.2, gap: 0.004, bevel: 0.002, offset: 0 },
  bricks: { tile: [0.25, 0.075], gap: 0.01, bevel: 0.005, offset: 0.5, jitter: 0.25 },
  panels: { tile: [1.5, 3], gap: 0.02, bevel: 0.008, offset: 0 },
  planks: { tile: [1.2, 0.15], gap: 0.004, bevel: 0.002, offset: 0, offsetJitter: 1, lengthJitter: 0.6, jitter: 0.2 },
}

function build(ctx: Ctx, id: string, raw: RawNode): string {
  const op = raw.op
  const size = ctx.graph.size
  const depth = ctx.graph.depth
  const pixel = ctx.pixel
  const at = (key: string) => input(ctx, raw[key], id, key)
  switch (op) {
    case 'const': return push(ctx, id, 'const', Object.fromEntries(['r', 'g', 'b'].map((k, i) => [k, parseColour(raw.value as Input)[i]!]).concat([['a', 1]])), [])
    case 'value': return noise(ctx, id, raw, 0, 1, 0)
    case 'perlin': return noise(ctx, id, raw, 1, 1, 0)
    case 'cellular': return noise(ctx, id, raw, 2, 1, 0)
    case 'fbm': return noise(ctx, id, raw, pick(raw, 'basis', ['value', 'perlin', 'cellular'] as const, 'perlin'), 5, 0)
    case 'ridged': return noise(ctx, id, raw, 1, 5, 1)
    case 'wave': {
      const [cycles] = periods(size, pair(raw.period, 0.1))
      return push(ctx, id, 'wave', { axis: pick(raw, 'axis', ['u', 'v'] as const, 'u'), cycles, shape: pick(raw, 'shape', ['sine', 'triangle', 'saw'] as const, 'sine'), phase: num(raw, 'phase', 0) }, [])
    }
    case 'tiles': case 'bricks': case 'panels': case 'planks': {
      const spec = { ...TILE_DEFAULTS[op], ...raw }
      const tile = pair(spec.tile, 0.2)
      const [cols, baseRows] = periods(size, tile)
      let rows = baseRows
      const offset = num(spec, 'offset', 0)
      for (let k = 0; k < 24 && Math.abs(offset * rows - Math.round(offset * rows)) > 1e-4; k++) rows++
      return push(ctx, id, 'tiles', {
        cols, rows, gap: num(spec, 'gap', 0.004), bevel: Math.max(pixel, num(spec, 'bevel', 0.002)), offset,
        offsetJitter: num(spec, 'offsetJitter', 0), lengthJitter: Math.min(0.8, num(spec, 'lengthJitter', 0)), jitter: num(spec, 'jitter', 0),
        seed: seedOf(ctx, id, spec), output: pick(spec, 'output', OUTPUTS, 'height'), size, pixel,
      }, [])
    }
    case 'rivets': {
      const spacing = pair(raw.spacing, 0.1)
      const [cols, rows] = periods(size, spacing)
      const offset = pair(raw.offset, 0)
      return push(ctx, id, 'rivets', { cols, rows, radius: num(raw, 'radius', 0.008), offsetU: offset[0], offsetV: offset[1], size, pixel, output: pick(raw, 'output', OUTPUTS, 'height') }, [])
    }
    case 'scatter': {
      const [cols, rows] = periods(size, pair(raw.cell, 0.2))
      return push(ctx, id, 'scatter', {
        cols, rows, radius: num(raw, 'radius', 0.03), sizeJitter: num(raw, 'sizeJitter', 0.5), density: num(raw, 'density', 1),
        shape: pick(raw, 'shape', SCATTER_SHAPES, 'disc'), rotate: raw.rotate === false ? 0 : 1, seed: seedOf(ctx, id, raw),
        output: pick(raw, 'output', OUTPUTS, 'height'), size, pixel, stretch: num(raw, 'stretch', 1),
      }, [])
    }
    case 'image': {
      if (typeof raw.src !== 'string') throw new GraphError(`${id}.src must be a path`)
      ctx.images.add(raw.src)
      const [repeatU, repeatV] = pair(raw.repeat, 1)
      return push(ctx, id, 'image', { repeatU, repeatV }, [], { image: raw.src })
    }
    case 'seamless': {
      const width = num(raw, 'width', 0.25)
      push(ctx, `${id}#u`, 'seamlessPass', { axis: 0, width }, [at('input')])
      return push(ctx, id, 'seamlessPass', { axis: 1, width }, [`${id}#u`])
    }
    case 'blur': return blurSteps(ctx, id, at('input'), num(raw, 'radius', 0.01))
    case 'highpass': {
      const source = at('input')
      const low = blurSteps(ctx, `${id}#low`, source, num(raw, 'radius', 0.1))
      return push(ctx, id, 'blend', { mode: BLEND_MODES.indexOf('highpass'), opacity: 1, masked: 0 }, [source, low])
    }
    case 'delight': {
      const source = at('input')
      const luma = push(ctx, `${id}#luma`, 'channel', { channel: 4 }, [source])
      const low = blurSteps(ctx, `${id}#low`, luma, num(raw, 'radius', 0.25))
      return push(ctx, id, 'delight', { strength: num(raw, 'strength', 1) }, [source, low])
    }
    case 'warp': {
      const inputs = [at('input'), at('by')]
      if (raw.byY !== undefined) inputs.push(at('byY'))
      return push(ctx, id, 'warp', { amount: num(raw, 'amount', 0.02), size, vector: raw.byY !== undefined ? 1 : 0 }, inputs)
    }
    case 'slopeBlur': {
      const samples = Math.max(1, Math.min(32, Math.round(num(raw, 'samples', 8))))
      return push(ctx, id, 'slopeBlur', { step: num(raw, 'amount', 0.02) / pixel / samples, samples, mode: pick(raw, 'mode', ['blur', 'min', 'max'] as const, 'blur') }, [at('input'), at('slope')])
    }
    case 'levels': case 'invert': {
      const inRange = pair(raw.in, [0, 1])
      const outRange = pair(raw.out, op === 'invert' ? [1, 0] : [0, 1])
      return push(ctx, id, 'levels', { inLow: inRange[0], inHigh: inRange[1], gamma: num(raw, 'gamma', 1), outLow: outRange[0], outHigh: outRange[1] }, [at('input')])
    }
    case 'curvature': {
      const radius = Math.max(pixel, num(raw, 'radius', 0.005))
      return push(ctx, id, 'curvature', { radius: radius / pixel, scale: depth / radius * num(raw, 'strength', 4) }, [at('input')])
    }
    case 'normal': return push(ctx, id, 'normal', { scale: depth / (2 * pixel) * num(raw, 'strength', 1), based: 0 }, [at('input')])
    case 'ao': {
      const radius = Math.max(2 * pixel, num(raw, 'radius', 0.05))
      return push(ctx, id, 'ao', { radius: radius / pixel, depth: depth / pixel, strength: num(raw, 'strength', 1) }, [at('input')])
    }
    case 'blend': {
      const inputs = [at('a'), at('b')]
      if (raw.mask !== undefined) inputs.push(at('mask'))
      return push(ctx, id, 'blend', { mode: pick(raw, 'mode', BLEND_MODES, 'mix'), opacity: num(raw, 'opacity', 1), masked: raw.mask !== undefined ? 1 : 0 }, inputs)
    }
    case 'ramp': {
      const stops = raw.stops
      if (!Array.isArray(stops) || stops.length < 1 || stops.length > 16) throw new GraphError(`${id}.stops needs 1–16 [position, colour] pairs`)
      const data = new Float32Array(64)
      stops.forEach((stop, i) => {
        if (!Array.isArray(stop) || typeof stop[0] !== 'number') throw new GraphError(`${id}.stops[${i}] must be [position, colour]`)
        const [r, g, b] = parseColour(stop[1] as Input)
        data.set([stop[0], r, g, b], i * 4)
      })
      return push(ctx, id, 'ramp', { count: stops.length }, [at('input')], { stops: data })
    }
    case 'hsv': return push(ctx, id, 'hsv', { hue: num(raw, 'hue', 0), saturation: num(raw, 'saturation', 1), value: num(raw, 'value', 1) }, [at('input')])
    case 'channel': return push(ctx, id, 'channel', { channel: pick(raw, 'channel', CHANNELS, 'luma') }, [at('input')])
    case 'transform': {
      const offset = pair(raw.offset, 0)
      const rotate = num(raw, 'rotate', 0)
      if (rotate % 90 !== 0) throw new GraphError(`${id}.rotate must be a multiple of 90 to keep the tile seamless`)
      return push(ctx, id, 'transform', { repeat: Math.max(1, Math.round(num(raw, 'repeat', 1))), offsetU: offset[0], offsetV: offset[1], rotate: ((rotate / 90) % 4 + 4) % 4, flip: raw.flip ? 1 : 0 }, [at('input')])
    }
    default: throw new GraphError(`${id}: unknown op "${String(op)}"`)
  }
}

export function validate(graph: unknown): string[] {
  try { compile(parseGraph(graph), 64); return [] } catch (error) { if (error instanceof GraphError) return [error.message]; throw error }
}

export type CompileOptions = { readonly weather?: Weather | null }

export function compile(graph: MaterialGraph, res: number, options: CompileOptions = {}): Program {
  parseGraph(graph)
  integer(1, 4096)(res, 'resolution')
  objectCheck({ weather: (value, at) => { if (value !== null) weatherCheck(value, at) } })(options, 'options')
  const ctx: Ctx = { graph, res, pixel: graph.size / res, steps: [], specs: new Map(Object.entries(graph.nodes)), built: new Map(), building: new Set(), consts: new Map(), images: new Set(), counter: 0 }
  for (const id of ctx.specs.keys()) node(ctx, id)
  const base = {
    color: input(ctx, graph.outputs.color, 'outputs', 'color'),
    height: input(ctx, graph.outputs.height ?? 0.5, 'outputs', 'height'),
    roughness: input(ctx, graph.outputs.roughness ?? 0.85, 'outputs', 'roughness'),
    metalness: input(ctx, graph.outputs.metalness ?? 0, 'outputs', 'metalness'),
  }
  const weather = options.weather === null ? undefined : options.weather ?? graph.weather
  const weathered = weatherSteps(ctx, base, weather)
  const finishAo = graph.finish?.ao ?? {}
  const normalScale = graph.depth / (2 * ctx.pixel) * (graph.finish?.normal ?? 1)
  const normalId = graph.outputs.normal === undefined
    ? push(ctx, 'out:normalrgb', 'normal', { scale: normalScale, based: 0 }, [weathered.height])
    : push(ctx, 'out:normalrgb', 'normal', { scale: normalScale, based: 1 }, [push(ctx, 'out:relief', 'blend', { mode: BLEND_MODES.indexOf('highpass'), opacity: 1, masked: 0 }, [weathered.height, base.height]), input(ctx, graph.outputs.normal, 'outputs', 'normal')])
  const aoRadius = Math.max(2 * ctx.pixel, finishAo.radius ?? 0.04)
  let ao = push(ctx, 'out:ao', 'ao', { radius: aoRadius / ctx.pixel, depth: graph.depth / ctx.pixel, strength: finishAo.strength ?? 0.8 }, [weathered.height])
  if (graph.outputs.ao !== undefined) ao = push(ctx, 'out:aomul', 'blend', { mode: BLEND_MODES.indexOf('multiply'), opacity: 1, masked: 0 }, [ao, input(ctx, graph.outputs.ao, 'outputs', 'ao')])
  const color = push(ctx, 'out:color', 'pack', { c0: 0, c1: 1, c2: 2, c3: 5 }, [weathered.color, weathered.color, weathered.color, weathered.color])
  const normal = push(ctx, 'out:normal', 'pack', { c0: 0, c1: 1, c2: 2, c3: 0 }, [normalId, normalId, normalId, weathered.height])
  const orm = push(ctx, 'out:orm', 'pack', { c0: 0, c1: 0, c2: 0, c3: 5 }, [ao, weathered.roughness, weathered.metalness, ao])
  const masks = push(ctx, 'out:masks', 'pack', { c0: 0, c1: 0, c2: 0, c3: 0 }, [weathered.wear, weathered.dirt, weathered.wet, weathered.damage])
  const steps = prune(ctx.steps, [color, normal, orm, masks])
  const images = [...new Set(steps.flatMap(step => step.image ? [step.image] : []))]
  return { name: graph.name, res, size: graph.size, depth: graph.depth, steps, outputs: { color, normal, orm, masks }, images }
}

function prune(steps: Step[], roots: string[]) {
  const byId = new Map(steps.map(step => [step.id, step]))
  const keep = new Set<string>()
  const visit = (id: string) => { if (keep.has(id)) return; keep.add(id); for (const dep of byId.get(id)!.inputs) visit(dep) }
  roots.forEach(visit)
  return steps.filter(step => keep.has(step.id))
}

type Channels = { color: string; height: string; roughness: string; metalness: string; wear: string; dirt: string; wet: string; damage: string }

function weatherSteps(ctx: Ctx, base: { color: string; height: string; roughness: string; metalness: string }, weather: Weather | undefined): Channels {
  const zero = constant(ctx, 0)
  const g = ctx.graph
  const pixel = ctx.pixel
  let n = 0
  const id = (name: string) => `w:${name}:${n++}`
  const k = (kernel: KernelName, values: Record<string, number>, inputs: string[], extra: Partial<Step> = {}) => push(ctx, id(kernel), kernel, values, inputs, extra)
  const c = (value: Input) => constant(ctx, value)
  const blend = (a: string, b: string, mode: (typeof BLEND_MODES)[number], opacity = 1, mask?: string) => k('blend', { mode: BLEND_MODES.indexOf(mode), opacity, masked: mask ? 1 : 0 }, mask ? [a, b, mask] : [a, b])
  const levels = (source: string, lo: number, hi: number, outLow = 0, outHigh = 1, gamma = 1) => k('levels', { inLow: lo, inHigh: hi, gamma, outLow, outHigh }, [source])
  const cavity = k('ao', { radius: Math.max(2, 0.05 / pixel), depth: g.depth / pixel, strength: 1 }, [base.height])
  const crevice = levels(cavity, 0.6, 0.97, 1, 0)
  const sharp = k('curvature', { radius: Math.max(1, 0.004 / pixel), scale: g.depth / Math.max(pixel, 0.004) * 4 }, [base.height])
  const broad = k('curvature', { radius: Math.max(1, 0.015 / pixel), scale: g.depth / Math.max(pixel, 0.015) * 4 }, [base.height])
  const edge = blend(levels(sharp, 0.53, 0.7), levels(broad, 0.53, 0.68), 'max')
  const low = blend(levels(base.height, 0.2, 0.7, 1, 0), crevice, 'max')
  const out: Channels = { ...base, wear: edge, dirt: crevice, wet: low, damage: zero }
  if (!weather) return out
  const seed = weather.seed ?? 0
  const fbm = (name: string, cell: Metres, octaves: number, basis = 1, extra: Record<string, number> = {}) => {
    const [px, py] = periods(g.size, pair(cell, 0.1))
    return k('noise', { basis, px, py, seed: hashString(`${name}:${seed}:${g.seed ?? 0}`), octaves: octaveCap(ctx.res, px, py, octaves), gain: 0.5, ridged: 0, sharpness: 2, mode: 0, jitter: 0.9, ...extra }, [])
  }
  const ramp = (source: string, stops: Array<[number, Colour]>) => {
    const data = new Float32Array(64)
    stops.forEach(([p, colour], i) => data.set([p, ...parseColour(colour)], i * 4))
    return k('ramp', { count: stops.length }, [source], { stops: data })
  }
  const scatter = (name: string, cell: number, radius: number, density: number, shape: (typeof SCATTER_SHAPES)[number], output: (typeof OUTPUTS)[number], sizeJitter = 0.5) => {
    const [cols, rows] = periods(g.size, [cell, cell])
    return k('scatter', { cols, rows, radius, sizeJitter, density, shape: SCATTER_SHAPES.indexOf(shape), rotate: 1, seed: hashString(`${name}:${weather.damage?.seed ?? 0}:${seed}:${g.seed ?? 0}`), output: OUTPUTS.indexOf(output), size: g.size, pixel, stretch: 1 }, [])
  }
  const clamp01 = (v: number | undefined) => Math.max(0, Math.min(1, v ?? 0))
  const age = clamp01(weather.age)
  const dirt = clamp01(weather.dirt)
  const rust = clamp01(weather.rust)
  const moisture = clamp01(weather.moisture)
  const puddles = clamp01(weather.puddles ?? (g.orientation === 'floor' ? Math.max(0, moisture - 0.35) / 0.65 : 0))
  const wearSpec: Wear = typeof weather.wear === 'number' ? { amount: weather.wear, ...g.wear } : weather.wear ? { ...g.wear, ...weather.wear } : { amount: 0 }
  const wear = clamp01(wearSpec.amount)
  const wall = g.orientation !== 'floor'
  const grime = fbm('grime', 0.4, 6)
  const fine = fbm('fine', 0.025, 3, 0)

  if (age > 0) {
    out.color = k('hsv', { hue: 0, saturation: 1 - 0.3 * age, value: 1 - 0.06 * age }, [out.color])
    const streaks = wall ? k('warp', { amount: 0.04, size: g.size, vector: 0 }, [fbm('streak', [0.04, 0.7], 5), grime]) : fbm('blotch', 0.6, 5)
    const stain = levels(blend(streaks, grime, 'multiply'), 0.36 - 0.12 * age, 0.6 - 0.12 * age)
    out.color = blend(out.color, c('#5a5957'), 'multiply', 0.55 * age, stain)
    out.roughness = blend(out.roughness, c(0.06 * age), 'add')
  }
  if (rust > 0) {
    const field = blend(blend(fbm('rust', 0.22, 6), edge, 'add', 0.2), crevice, 'add', 0.3)
    const threshold = 1.25 - rust * 0.95
    const mask = k('slopeBlur', { step: 0.004 / pixel / 6, samples: 6, mode: 0 }, [levels(field, threshold, threshold + 0.12), fbm('rustslope', 0.08, 3)])
    const tone = ramp(blend(fbm('rusttone', 0.04, 4, 0), fine, 'mix', 0.5), [[0, '#2e1a10'], [0.35, '#5a2f17'], [0.6, '#7d4421'], [0.85, '#9a5a2e'], [1, '#a8703f']])
    out.color = blend(out.color, tone, 'mix', 1, mask)
    out.roughness = blend(out.roughness, c(0.86), 'mix', 1, mask)
    out.metalness = blend(out.metalness, c(0), 'mix', 1, mask)
    out.height = blend(out.height, fine, 'add', 0.06, mask)
  }
  if (wear > 0) {
    const breakup = fbm('wear', 0.06, 5)
    const threshold = 0.62 - wear * 0.5
    const mask = levels(blend(edge, breakup, 'subtract', 0.55), threshold, threshold + 0.08)
    out.color = blend(out.color, c(wearSpec.color ?? '#9a968c'), 'mix', 1, mask)
    out.roughness = blend(out.roughness, c(wearSpec.roughness ?? 0.6), 'mix', 1, mask)
    out.metalness = blend(out.metalness, c(wearSpec.metalness ?? 0), 'mix', 1, mask)
    out.height = blend(out.height, c(0.04), 'subtract', 1, mask)
  }
  if (dirt > 0) {
    const low = levels(out.height, 0.2, 0.7, 1, 0)
    const field = blend(blend(crevice, grime, 'mix', 0.45), low, 'add', wall ? 0.1 : 0.3)
    const mask = levels(field, 0.72 - 0.45 * dirt, 0.92 - 0.45 * dirt)
    const tone = ramp(fine, [[0, weather.dirtColor ?? '#3b3a38'], [1, '#67655f']])
    out.color = blend(out.color, tone, 'mix', 0.85, mask)
    out.roughness = blend(out.roughness, c(0.97), 'mix', 0.6, mask)
  }
  const damage = weather.damage
  if (damage && (damage.chips || damage.bullets || damage.scorch)) {
    let damageMask = zero
    if (damage.chips) {
      const chip = scatter('chips', 0.22, 0.035, clamp01(damage.chips), 'chip', 'height', 0.7)
      const chipColour = k('hsv', { hue: 0, saturation: 0.7, value: 1.22 }, [out.color])
      out.color = blend(out.color, chipColour, 'mix', 1, chip)
      out.height = blend(out.height, blend(c(0.5), fine, 'mix', 0.5), 'subtract', 0.45, chip)
      out.roughness = blend(out.roughness, c(0.95), 'mix', 1, chip)
      damageMask = blend(damageMask, chip, 'max')
    }
    if (damage.bullets) {
      const dist = scatter('bullets', 0.32, 0.045, clamp01(damage.bullets), 'crater', 'distance', 0.35)
      const shape = ramp(dist, [[0, '#000000'], [0.16, '#000000'], [0.24, '#5a5a5a'], [0.6, '#b4b4b4'], [0.95, '#ffffff'], [1, '#ffffff']])
      const mask = levels(dist, 0.95, 0.6)
      const tone = ramp(dist, [[0, '#0b0a09'], [0.18, '#1a1815'], [0.26, '#8d877b'], [0.7, '#a9a397'], [1, '#a9a397']])
      out.color = blend(out.color, tone, 'mix', 0.9, mask)
      out.height = blend(out.height, shape, 'multiply', 1, mask)
      out.roughness = blend(out.roughness, c(0.97), 'mix', 1, mask)
      damageMask = blend(damageMask, mask, 'max')
    }
    if (damage.scorch) {
      const dist = scatter('scorch', 1.4, 0.55, clamp01(damage.scorch), 'blob', 'distance', 0.3)
      const mask = blend(levels(dist, 1, 0.15), levels(grime, 0.2, 0.8), 'multiply')
      out.color = blend(out.color, c('#15130f'), 'mix', 0.92, mask)
      out.roughness = blend(out.roughness, c(0.98), 'mix', 1, mask)
      damageMask = blend(damageMask, mask, 'max')
    }
    out.damage = damageMask
  }
  if (moisture > 0 || puddles > 0) {
    const porosity = g.porosity ?? 0.8
    const darker = blend(out.color, out.color, 'multiply')
    const wetness = levels(low, 0, 1, 0.35 * moisture, moisture)
    out.color = blend(out.color, darker, 'mix', porosity * 0.85, wetness)
    out.roughness = blend(out.roughness, blend(out.roughness, c(0.22), 'min'), 'mix', 0.75, wetness)
    if (puddles > 0) {
      const smooth = blurSteps(ctx, id('puddleblur'), out.height, 0.04)
      const field = blend(levels(smooth, 0.3, 0.7, 1, 0), fbm('puddle', 0.9, 4), 'mix', 0.55)
      const threshold = 0.82 - puddles * 0.42
      const mask = levels(field, threshold, threshold + 0.03)
      out.color = blend(out.color, blend(darker, c('#5b5a52'), 'multiply'), 'mix', 0.9, mask)
      out.roughness = blend(out.roughness, blend(out.roughness, c(0.03), 'min'), 'mix', 1, mask)
      out.metalness = blend(out.metalness, c(0), 'mix', 1, mask)
      out.height = blend(out.height, blurSteps(ctx, id('puddleflat'), out.height, 0.25), 'mix', 1, mask)
    }
  }
  return out
}
