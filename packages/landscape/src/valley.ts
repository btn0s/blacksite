import { fbm, ridged, smoothstep, valueNoise } from './random.ts'
import { smoothCurve } from './river.ts'
import type { LandscapeShape } from './bake.ts'
import type { WaterSpec } from './river.ts'

const valley = { west: -3300, south: 1900, floor: -250, shelf: -10, rim: 0, foot: 880 }
const seaLevel = -300

const mix = (a: number, b: number, t: number) => a + (b - a) * t
const bump = (value: number, centre: number, width: number) => Math.exp(-(((value - centre) / width) ** 2))
const smoothMin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k / 4 }

const coastLine = (x: number) => -1480 + 70 * Math.sin(x / 380 + 1) + 40 * Math.sin(x / 120)
const frontEdge = [[-400, -923], [-300, -899], [-200, -920], [-100, -945], [0, -959], [100, -964], [200, -976], [300, -958], [500, -1090], [600, -1060], [700, -1063], [1100, -1225], [1700, -1060], [2000, -1000]] as const

function edgeEast(z: number) {
  let index = 0
  while (index < frontEdge.length - 2 && z > frontEdge[index + 1]![0]) index++
  const [z0, x0] = frontEdge[index]!
  const [z1, x1] = frontEdge[index + 1]!
  return mix(x0, x1, smoothstep(z0, z1, z)) + 25 * Math.sin(z / 170)
}
const edgeWest = (z: number) => valley.west + 220 * Math.sin(z / 800 + 1.3) + 90 * Math.sin(z / 310)
const edgeSouth = (x: number) => valley.south + 160 * Math.sin(x / 700) + 80 * Math.sin(x / 260 + 1)

function landform(x: number, z: number) {
  const ex = Math.max(edgeWest(z) - x, x - edgeEast(z), 0)
  const ez = Math.max(z - edgeSouth(x), 0)
  return { e: Math.hypot(ex, ez), sea: coastLine(x) - z }
}

function floorHeight(z: number) {
  const inland = valley.floor + 25 * smoothstep(-1200, 1900, z)
  return mix(-297, inland, smoothstep(-1520, -1050, z))
}

function seabed(sea: number) {
  return seaLevel - 28 * smoothstep(0, 300, sea) - 170 * smoothstep(300, 4000, sea) - 150 * smoothstep(4000, 9000, sea)
}

function macro(x: number, z: number) {
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

function hills(x: number, z: number, detail: boolean) {
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

function masks(x: number, z: number, height: number, slope: number, bank: number): readonly [number, number] {
  const above = height - seaLevel
  const shore = 1 - smoothstep(2, 9 + 5 * (valueNoise(x / 40, z / 40, 347) - 0.5), above)
  const sand = Math.min(1, Math.max(shore + (1 - smoothstep(1, 16, above)) * 0.4, bank * (0.75 + 0.25 * valueNoise(x / 6, z / 6, 361))))
  const patches = smoothstep(0.52, 0.78, fbm(x / 85, z / 85, 3, 353))
  const altitude = smoothstep(240, 430, height + (fbm(x / 160, z / 160, 3, 431) - 0.5) * 90)
  const soil = Math.min(1, patches * 0.9 + smoothstep(0.09, 0.2, slope) * 0.6 + altitude * 0.9)
  return [soil * (1 - sand), sand]
}

const riverWaypoints = [
  [-1700, 2700], [-1760, 2480], [-1850, 2300], [-1800, 2100], [-1700, 1900], [-1650, 1700], [-1800, 1480], [-1900, 1250], [-1850, 1000], [-1700, 800],
  [-1600, 600], [-1700, 380], [-1850, 200], [-1800, 0], [-1650, -200], [-1600, -420], [-1750, -640], [-1900, -860], [-1850, -1080], [-1700, -1260], [-1650, -1420], [-1680, -1560], [-1720, -1700],
] as const

const creekWaypoints = [[-223, -50], [-300, -60], [-420, -90], [-560, -140], [-700, -190], [-900, -260], [-1150, -300], [-1400, -280], [-1600, -230]] as const

const water: readonly WaterSpec[] = [
  { kind: 'river', name: 'valley', curves: smoothCurve(riverWaypoints), halfWidth: [5, 24], depth: [1.2, 3], dig: 1.5, smoothing: 180 },
  { kind: 'tarn', name: 'tarn', at: [-185, -50], radius: 46, depth: 4.5, lift: 0.4 },
  { kind: 'river', name: 'creek', curves: smoothCurve(creekWaypoints), halfWidth: [2.5, 4.5], depth: [0.7, 1.1], dig: 1, smoothing: 60, spill: 'tarn', join: 'valley' },
]

export const valleyShape: LandscapeShape = {
  name: 'valley',
  centre: [-1250, 350],
  near: { extent: 4096, size: 2049 },
  far: { extent: 16384, size: 2049 },
  band: 256,
  seaLevel,
  sea: { min: [-40000, -40000], max: [40000, -1300] },
  water,
  macro,
  hills,
  masks,
}
