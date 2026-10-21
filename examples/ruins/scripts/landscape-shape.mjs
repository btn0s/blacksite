import { fbm, ridged, smoothstep, valueNoise } from '../../../packages/landscape/src/random.ts'

export const world = {
  nearExtent: 4096, nearSize: 2049, farExtent: 16384, farSize: 2049, band: 256,
  centre: [-1250, 350], seaLevel: -300, underLevel: 0.75, rimLip: 0.06, screening: 140, envelope: 250, padding: 160,
}

const valley = { west: -3300, south: 1900, floor: -250, shelf: 120, rim: 0, foot: 880 }

const mix = (a, b, t) => a + (b - a) * t
const bump = (value, centre, width) => Math.exp(-(((value - centre) / width) ** 2))
const smoothMin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k / 4 }

const coastLine = x => -1480 + 70 * Math.sin(x / 380 + 1) + 40 * Math.sin(x / 120)
const frontEdge = [[-400, -923], [-300, -899], [-200, -920], [-100, -945], [0, -959], [100, -964], [200, -976], [300, -958], [500, -1090], [600, -1060], [700, -1063], [1100, -1225], [1700, -1060], [2000, -1000]]
function edgeEast(z) {
  let index = 0
  while (index < frontEdge.length - 2 && z > frontEdge[index + 1][0]) index++
  const [z0, x0] = frontEdge[index], [z1, x1] = frontEdge[index + 1]
  return mix(x0, x1, smoothstep(z0, z1, z)) + 25 * Math.sin(z / 170)
}
const edgeWest = z => valley.west + 220 * Math.sin(z / 800 + 1.3) + 90 * Math.sin(z / 310)
const edgeSouth = x => valley.south + 160 * Math.sin(x / 700) + 80 * Math.sin(x / 260 + 1)

function landform(x, z) {
  const ex = Math.max(edgeWest(z) - x, x - edgeEast(z), 0)
  const ez = Math.max(z - edgeSouth(x), 0)
  return { e: Math.hypot(ex, ez), sea: coastLine(x) - z }
}

function floorHeight(z) {
  const inland = valley.floor + 25 * smoothstep(-1200, 1900, z)
  return mix(-297, inland, smoothstep(-1520, -1050, z))
}

function seabed(sea) {
  return world.seaLevel - 28 * smoothstep(0, 300, sea) - 170 * smoothstep(300, 4000, sea) - 150 * smoothstep(4000, 9000, sea)
}

export function macro(x, z) {
  const { e, sea } = landform(x, z)
  const floor = floorHeight(z)
  const front = floor + (valley.rim - valley.floor) * (e / valley.foot) ** 3.2
  const shelf = valley.shelf - 60 * smoothstep(2500, 3600, e)
  const reach = Math.max(smoothstep(-1500, -3300, x), smoothstep(400, 2000, z))
  const crest = (330 + 170 * reach) * (0.55 + 0.9 * ridged(x / 1100, z / 1100, 3, 401))
  const high = smoothMin(front, shelf, 80) + crest * bump(e, 2300, 450)
  const land = floor + (high - floor) * mix(0.2, 1, smoothstep(-1500, -450, z))
  return mix(land, seabed(sea), smoothstep(-60, 140, sea))
}

export function hills(x, z, detail = true) {
  const { e, sea } = landform(x, z)
  const land = 1 - smoothstep(-20, 150, sea)
  const mountain = smoothstep(450, 1100, e)
  const broad = (fbm(x / 700, z / 700, 3, 301) - 0.5) * 110
  const mid = (fbm(x / 230, z / 230, 3, 311) - 0.5) * 28
  const fine = (fbm(x / 47, z / 47, 2, 317) - 0.5) * 2.6
  const grain = (valueNoise(x / 9, z / 9, 331) - 0.5) * 0.4
  const ripple = (valueNoise(x / 31, z / 31, 337) - 0.5) * 0.5
  const crags = (ridged(x / 380, z / 380, 4, 411) - 0.35) * 90
  const floorHills = broad + mid + (detail ? fine + grain : 0)
  const mountainHills = broad * 1.2 + crags + (detail ? (ridged(x / 110, z / 110, 3, 419) - 0.3) * 22 + fine : 0)
  return mix(floorHills, mountainHills, mountain) * land + (detail ? ripple : 0) * (1 - land)
}

export function surfaceMasks(x, z, height, slope, rimDistance) {
  const above = height - world.seaLevel
  const shore = 1 - smoothstep(2, 9 + 5 * (valueNoise(x / 40, z / 40, 347) - 0.5), above)
  const sand = Math.min(1, shore + (1 - smoothstep(1, 16, above)) * 0.4)
  const patches = smoothstep(0.52, 0.78, fbm(x / 85, z / 85, 3, 353))
  const apron = (1 - smoothstep(10, 60, rimDistance)) * (0.55 + 0.45 * valueNoise(x / 14, z / 14, 359))
  const altitude = smoothstep(240, 430, height + (fbm(x / 160, z / 160, 3, 431) - 0.5) * 90)
  const soil = Math.min(1, patches * 0.9 + apron + smoothstep(0.09, 0.2, slope) * 0.6 + altitude * 0.9)
  return [soil * (1 - sand), sand]
}

export function distanceTransform(blocked, nx, nz) {
  const distance = new Float32Array(nx * nz)
  for (let index = 0; index < distance.length; index++) distance[index] = blocked[index] ? 0 : 1e9
  const root2 = Math.SQRT2
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const slot = j * nx + i
    let value = distance[slot]
    if (i > 0) value = Math.min(value, distance[slot - 1] + 1)
    if (j > 0) {
      value = Math.min(value, distance[slot - nx] + 1)
      if (i > 0) value = Math.min(value, distance[slot - nx - 1] + root2)
      if (i < nx - 1) value = Math.min(value, distance[slot - nx + 1] + root2)
    }
    distance[slot] = value
  }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const slot = j * nx + i
    let value = distance[slot]
    if (i < nx - 1) value = Math.min(value, distance[slot + 1] + 1)
    if (j < nz - 1) {
      value = Math.min(value, distance[slot + nx] + 1)
      if (i < nx - 1) value = Math.min(value, distance[slot + nx + 1] + root2)
      if (i > 0) value = Math.min(value, distance[slot + nx - 1] + root2)
    }
    distance[slot] = value
  }
  return distance
}

export function levelSurface(raster) {
  const { cell, originX, originZ, nx, nz, covered, ground, low } = raster
  const pad = world.padding, width = nx + 2 * pad, height = nz + 2 * pad
  const x0 = originX - pad * cell, z0 = originZ - pad * cell
  const solid = new Uint8Array(width * height)
  const base = new Float32Array(width * height).fill(NaN)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const source = j * nx + i
    if (!covered[source]) continue
    const slot = (j + pad) * width + i + pad
    solid[slot] = 1
    const lowest = Math.min(ground[source], low[source])
    base[slot] = Number.isFinite(lowest) ? lowest : NaN
  }
  for (let pass = 0; pass < 3; pass++) {
    const next = base.slice()
    for (let j = 1; j < height - 1; j++) for (let i = 1; i < width - 1; i++) {
      const slot = j * width + i
      if (!solid[slot] || !Number.isNaN(base[slot])) continue
      let sum = 0, count = 0
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const value = base[slot + dj * width + di]
        if (!Number.isNaN(value)) { sum += value; count++ }
      }
      if (count) next[slot] = sum / count
    }
    base.set(next)
  }
  const under = new Float32Array(width * height).fill(NaN)
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const slot = j * width + i
    if (!solid[slot]) continue
    let lowest = Infinity
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const jj = j + dj, ii = i + di
      if (jj < 0 || ii < 0 || jj >= height || ii >= width) continue
      const value = base[jj * width + ii]
      if (!Number.isNaN(value) && value < lowest) lowest = value
    }
    under[slot] = Number.isFinite(lowest) ? lowest - world.underLevel : NaN
  }
  const floor = new Float32Array(width * height).fill(NaN)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const source = j * nx + i
    if (covered[source] && Number.isFinite(ground[source])) floor[(j + pad) * width + i + pad] = ground[source]
  }
  const rim = new Uint8Array(width * height)
  const rimValue = new Float32Array(width * height)
  for (let j = 4; j < height - 4; j++) for (let i = 4; i < width - 4; i++) {
    const slot = j * width + i
    if (solid[slot]) continue
    let touching = false
    for (let dj = -1; dj <= 1 && !touching; dj++) for (let di = -1; di <= 1; di++) if (solid[slot + dj * width + di]) { touching = true; break }
    if (!touching) continue
    const values = []
    for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {
      const value = floor[slot + dj * width + di]
      if (!Number.isNaN(value)) values.push(value)
    }
    if (values.length) { values.sort((a, b) => a - b); rim[slot] = 1; rimValue[slot] = values[values.length >> 1] - world.rimLip }
  }
  return { width, height, x0, z0, cell, solid, under, rim, rimValue, rimDistance: distanceTransform(solid, width, height) }
}

function relax(field, shape, fixed, width, height, cell, screening, sweeps, report, label) {
  const stiffness = (cell / screening) ** 2
  const omega = 2 / (1 + Math.sin(Math.PI / Math.max(width, height)))
  for (let sweep = 0; sweep < sweeps; sweep++) {
    let change = 0
    for (let j = 1; j < height - 1; j++) for (let i = 1; i < width - 1; i++) {
      const slot = j * width + i
      if (fixed[slot]) continue
      const target = (field[slot - 1] + field[slot + 1] + field[slot - width] + field[slot + width] + stiffness * shape[slot]) / (4 + stiffness)
      const delta = (target - field[slot]) * omega
      field[slot] += delta
      if (Math.abs(delta) > change) change = Math.abs(delta)
    }
    if (sweep % 100 === 0) report?.(`${label} sweep ${sweep} change ${change.toExponential(2)}`)
    if (change < 2e-2) break
  }
}

function envelope(surface, report) {
  const { width, height, x0, z0, cell, rim, rimValue } = surface
  const scale = 4, w = width / scale, h = height / scale
  const field = new Float32Array(w * h), shape = new Float32Array(w * h), fixed = new Uint8Array(w * h)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const slot = j * w + i
    shape[slot] = field[slot] = macro(x0 + (i * scale + scale / 2) * cell, z0 + (j * scale + scale / 2) * cell)
    let sum = 0, count = 0
    for (let dj = 0; dj < scale; dj++) for (let di = 0; di < scale; di++) {
      const fine = (j * scale + dj) * width + i * scale + di
      if (rim[fine]) { sum += rimValue[fine]; count++ }
    }
    if (count) { fixed[slot] = 1; field[slot] = sum / count }
    if (i === 0 || j === 0 || i === w - 1 || j === h - 1) fixed[slot] = 1
  }
  relax(field, shape, fixed, w, h, cell * scale, world.envelope, 4000, report, 'envelope')
  const out = new Float32Array(width * height)
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const gx = Math.min(w - 1.0001, Math.max(0, (i + 0.5) / scale - 0.5)), gz = Math.min(h - 1.0001, Math.max(0, (j + 0.5) / scale - 0.5))
    const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz
    const a = field[iz * w + ix], b = field[iz * w + ix + 1], c = field[(iz + 1) * w + ix], d = field[(iz + 1) * w + ix + 1]
    out[j * width + i] = a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz
  }
  return out
}

export function relaxMembrane(surface, report) {
  const { width, height, solid, rim, rimValue } = surface
  const shape = envelope(surface, report)
  const field = shape.slice()
  const fixed = new Uint8Array(width * height)
  for (let slot = 0; slot < fixed.length; slot++) {
    if (rim[slot]) { fixed[slot] = 1; field[slot] = rimValue[slot] }
    else if (solid[slot]) fixed[slot] = 1
  }
  for (let i = 0; i < width; i++) { fixed[i] = 1; fixed[(height - 1) * width + i] = 1 }
  for (let j = 0; j < height; j++) { fixed[j * width] = 1; fixed[j * width + width - 1] = 1 }
  relax(field, shape, fixed, width, height, surface.cell, world.screening, 1200, report, 'membrane')
  return { field, shape }
}
