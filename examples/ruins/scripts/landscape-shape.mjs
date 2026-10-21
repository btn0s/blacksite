import { fbm, ridged, smoothstep, valueNoise } from '../../../packages/landscape/src/random.ts'

export const world = {
  nearExtent: 4096, nearSize: 2049, farExtent: 16384, farSize: 2049, band: 256,
  centre: [-1250, 350], seaLevel: -300, padding: 160,
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


export const ground = { bury: 1, sinkFloor: 0.25, sinkRock: 1, overlap: [2, 8], fall: 0.8, rise: 0.5, taper: [200, 300], hillRamp: [20, 180], edgeRange: 64 }

const reach = [[-1, 0, 1], [0, -1, 1], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-2, -1, Math.sqrt(5)], [-1, -2, Math.sqrt(5)], [1, -2, Math.sqrt(5)], [2, -1, Math.sqrt(5)]]

export function propagate(values, width, height, perCell) {
  for (let pass = 0; pass < 2; pass++) {
    const sign = pass ? -1 : 1
    for (let jj = 0; jj < height; jj++) {
      const j = pass ? height - 1 - jj : jj
      for (let ii = 0; ii < width; ii++) {
        const i = pass ? width - 1 - ii : ii
        let value = values[j * width + i]
        for (const [di, dj, length] of reach) {
          const ni = i + sign * di, nj = j + sign * dj
          if (ni < 0 || nj < 0 || ni >= width || nj >= height) continue
          const candidate = values[nj * width + ni] + perCell * length
          if (candidate < value) value = candidate
        }
        values[j * width + i] = value
      }
    }
  }
  return values
}

export function levelGround(raster) {
  const { cell, originX, originZ, nx, nz, low, top, topUp, walkable } = raster
  const pad = world.padding, width = nx + 2 * pad, height = nz + 2 * pad
  const x0 = originX - pad * cell, z0 = originZ - pad * cell
  const count = width * height
  const covered = new Uint8Array(count)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (Number.isFinite(low[j * nx + i])) covered[(j + pad) * width + i + pad] = 1
  const distance = propagate(Float32Array.from(covered, value => value ? 0 : Infinity), width, height, cell)
  const depth = propagate(Float32Array.from(covered, value => value ? Infinity : 0), width, height, cell)
  // The terrain buries the level's foot and stays under its lowest upward surface, except along the rim, where it rises over that surface too.
  const base = new Float32Array(count).fill(-Infinity), ceiling = new Float32Array(count).fill(Infinity)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const source = j * nx + i
    if (!Number.isFinite(low[source])) continue
    const slot = (j + pad) * width + i + pad
    const sink = ground.sinkRock + (ground.sinkFloor - ground.sinkRock) * smoothstep(0.3, walkable, topUp[source])
    if (Number.isFinite(top[source])) ceiling[slot] = top[source] + (ground.bury + sink) * (1 - smoothstep(ground.overlap[0], ground.overlap[1], depth[slot])) - sink
    base[slot] = Math.min(low[source] + ground.bury, ceiling[slot])
  }
  const lower = propagate(base.map(value => -value), width, height, ground.fall * cell).map(value => -value)
  const upper = propagate(base.map(value => value === -Infinity ? Infinity : value), width, height, ground.rise * cell)
  const field = new Float32Array(count)
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const slot = j * width + i
    const landform = macro(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell)
    const held = Math.min(Math.max(landform, lower[slot]), Math.max(lower[slot], upper[slot]))
    field[slot] = Math.min(ceiling[slot], held + (landform - held) * smoothstep(ground.taper[0], ground.taper[1], distance[slot]))
  }
  const edge = new Float32Array(count)
  for (let slot = 0; slot < count; slot++) edge[slot] = covered[slot] ? -depth[slot] : distance[slot]
  const grid = (array, x, z) => {
    const gx = Math.min(width - 1.0001, Math.max(0, (x - x0) / cell - 0.5)), gz = Math.min(height - 1.0001, Math.max(0, (z - z0) / cell - 0.5))
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j
    const a = array[j * width + i], b = array[j * width + i + 1], c = array[(j + 1) * width + i], d = array[(j + 1) * width + i + 1]
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz
  }
  const covers = (x, z) => x >= x0 + cell && z >= z0 + cell && x <= x0 + (width - 1) * cell && z <= z0 + (height - 1) * cell
  return {
    covered, width, height, x0, z0, cell,
    rimDistance: (x, z) => covers(x, z) ? grid(distance, x, z) : 1e6,
    edge: (x, z) => covers(x, z) ? grid(edge, x, z) : ground.edgeRange,
    height(x, z, detail) {
      if (!covers(x, z)) return macro(x, z) + hills(x, z, detail)
      return grid(field, x, z) + hills(x, z, detail) * smoothstep(ground.hillRamp[0], ground.hillRamp[1], grid(distance, x, z))
    },
  }
}
