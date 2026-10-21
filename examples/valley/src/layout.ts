import { sampleCurves, type CubicPath, type XZ } from '@blacksite/landscape'

export { sampleCurves, type CubicPath, type XZ }
export type XYZ = readonly [number, number, number]

export const layout = {
  watchtower: { at: [-1500, 150] as XZ, ground: 276, clearing: [52, 90] as XZ, pad: [10, 30] as XZ },
  stones: { at: [-1100, 300] as XZ, ground: 165, clearing: [65, 120] as XZ, pad: [24, 60] as XZ },
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

export const bookmarkSites: readonly { id: number; name: string; at: XZ; floor?: number; target: XYZ; note: string }[] = [
  { id: 1, name: 'reveal', at: [-1507, 171], target: [-563, 70, -159], note: 'Watchtower ridge: the forest basin, river, aqueduct and temple share the first view' },
  { id: 2, name: 'stones', at: [-1128, 322], target: [1270, -20, -95], note: 'Among the standing stones on the meadow, the temple on the horizon' },
  { id: 3, name: 'arch', at: [-536, -116], target: [-500, 128, -150], note: 'The swallowed gateway under the canopy, trees growing through it' },
  { id: 4, name: 'aqueduct', at: [-128, -880], target: [400, 60, -150], note: 'The broken aqueduct beside the river, leading toward the temple' },
  { id: 5, name: 'shrine', at: [40, 1205], target: [50, 66, 1275], note: 'The spring shrine: the carved face in the cliff above its pool' },
  { id: 6, name: 'bridge', at: [650, -63], floor: bridgeDeckHeight(650, -63), target: [1190, 215, -95], note: 'Crossing the bridge over the gorge, the temple stair ahead' },
  { id: 7, name: 'temple', at: [1035, -80], target: [1190, 240, -95], note: 'The forecourt and the monumental stair below the temple facade' },
  { id: 8, name: 'lookback', at: [1184, -196], floor: layout.temple.platform, target: [-1450, -80, 140], note: 'From the temple terrace, the forest valley back to the watchtower ridge' },
] as const
