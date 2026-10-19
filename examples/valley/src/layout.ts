export type XZ = readonly [number, number]
export type XYZ = readonly [number, number, number]
export type CubicPath = readonly [XZ, XZ, XZ, XZ]

export const layout = {
  watchtower: { at: [-1500, 150] as XZ, ground: 260, clearing: [52, 90] as XZ, pad: [62, 90] as XZ },
  stones: { at: [-1100, 300] as XZ, ground: 205, clearing: [65, 120] as XZ, pad: [65, 120] as XZ },
  arch: { at: [-500, -150] as XZ, ground: 125, clearing: [12, 28] as XZ, pad: [18, 45] as XZ },
  shrine: { at: [50, 1260] as XZ, ground: 70, clearing: [55, 100] as XZ, pad: [48, 100] as XZ, pool: { centre: [50, 1238] as XZ, radius: [15, 23] as XZ, level: 68.8, bed: 67.2 } },
  temple: { at: [1270, -95] as XZ, ground: 210, platform: 234, footprint: { min: [950, -335] as XZ, max: [1400, 90] as XZ }, frontX: 1190, stairStartX: 1094 },
  bridge: { start: [600, 155, -60] as XYZ, end: [930, 210, -80] as XYZ, width: 14 },
  river: { halfWidth: 20, bankWidth: 55 },
  forest: { extent: 16384, densitySize: 2049, timberline: [1350, 1700] as XZ },
} as const

export const riverCurves: readonly CubicPath[] = [
  [[-250, -2048], [-150, -1300], [100, -700], [380, -300]],
  [[380, -300], [560, -60], [520, 400], [300, 900]],
  [[300, 900], [150, 1250], [250, 1700], [400, 2048]],
]

export const aqueductCurves: readonly CubicPath[] = [
  [[-350, -2000], [-300, -1500], [-250, -1200], [-150, -900]],
  [[-150, -900], [-50, -650], [150, -380], [330, -230]],
  [[330, -230], [450, -130], [520, -80], [600, -60]],
]

export const mainPathCurves: readonly CubicPath[] = [
  [[-1500, 150], [-1350, 250], [-1250, 330], [-1150, 350]],
  [[-1150, 350], [-950, 380], [-850, 250], [-750, 100]],
  [[-750, 100], [-650, -50], [-580, -120], [-500, -150]],
  [[-500, -150], [-300, -200], [-150, -120], [0, -200]],
  [[0, -200], [150, -280], [330, -230], [450, -120]],
  [[450, -120], [520, -70], [560, -60], [600, -60]],
]

export const shrinePathCurves: readonly CubicPath[] = [
  [[0, -200], [80, 100], [180, 500], [200, 600]],
  [[200, 600], [150, 850], [80, 1050], [50, 1240]],
]

export const aqueductTrailCurves: readonly CubicPath[] = [
  [[-500, -150], [-450, -450], [-260, -650], [-170, -960]],
  [[-170, -960], [-260, -1260], [-340, -1530], [-400, -1880]],
]

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

export const riverPath = sampleCurves(riverCurves)
export const aqueductPath = sampleCurves(aqueductCurves)
export const walkingPaths = [sampleCurves(mainPathCurves), sampleCurves(shrinePathCurves), sampleCurves(aqueductTrailCurves)] as const

export function bridgeDeckHeight(x: number, z: number) {
  const [ax, ay, az] = layout.bridge.start
  const [bx, by, bz] = layout.bridge.end
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)))
  return ay + (by - ay) * t
}

export function riverLevel(z: number) {
  const t = Math.max(0, Math.min(1, (z - 300) / 1200))
  return 115 - z * 0.03 - 18 * t * t * (3 - 2 * t)
}

export const bookmarkSites = [
  { id: 1, name: 'reveal', at: [-1450, 140] as XZ, target: [1270, 280, -95] as XYZ, note: 'Watchtower ridge: the forest basin, river, aqueduct and temple share the first view' },
  { id: 2, name: 'stones', at: [-1250, 430] as XZ, target: [-1100, 210, 300] as XYZ, note: 'Standing stones in the meadow, with the mesa beyond' },
  { id: 3, name: 'arch', at: [-640, -30] as XZ, target: [-500, 142, -150] as XYZ, note: 'The swallowed arch frames the forest and distant temple' },
  { id: 4, name: 'aqueduct', at: [-170, -960] as XZ, target: [170, 170, -380] as XYZ, note: 'Follow the broken aqueduct and river toward the mesa' },
  { id: 5, name: 'shrine', at: [0, 1080] as XZ, target: [50, 85, 1260] as XYZ, note: 'The spring shrine beneath the south valley wall' },
  { id: 6, name: 'bridge', at: [560, -55] as XZ, target: [1270, 280, -95] as XYZ, note: 'The rising bridge crosses the gorge to the temple forecourt' },
  { id: 7, name: 'temple', at: [960, -90] as XZ, target: [1190, 270, -95] as XYZ, note: 'The forecourt leads to the monumental western staircase and entrance' },
  { id: 8, name: 'lookback', at: [1100, -380] as XZ, target: [-1450, 260, 140] as XYZ, note: 'From the mesa terrace, look back across the whole route to the watchtower' },
] as const
