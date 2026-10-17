import { createHeightfield, decodeGrey16Png, fbm, heightAt, slopeAt, loadLayerImages, ridged, smoothstep, surfaceTexture, terrainHeightAt, valueNoise, type Heightfield, type LayerImages, type TerrainSources } from '@blacksite/landscape'
import { site, type Tier } from './model'

const library = import.meta.glob<string>('../assets/library/*/**/*.{png,webp,json,ogg,m4a}', { eager: true, query: '?url&no-inline', import: 'default' })
const shared = import.meta.glob<string>('../../../packages/look/assets/world/{grass,dirt,gravel}_{c,n}.webp', { eager: true, query: '?url&no-inline', import: 'default' })

export const asset = (path: string) => {
  const url = library[`../assets/library/${path}`]
  if (!url) throw new Error(`Missing Valley asset ${path}`)
  return url
}

const kit = (name: string) => {
  const url = shared[`../../../packages/look/assets/world/${name}.webp`]
  if (!url) throw new Error(`Missing world kit surface ${name}`)
  return url
}

export interface ValleyWorld {
  readonly sources: TerrainSources
  readonly layers: LayerImages
  readonly heightAt: (x: number, z: number) => number
  readonly forest: (x: number, z: number) => number
  readonly path: readonly (readonly [number, number])[]
  readonly pathDistance: (x: number, z: number) => number
  readonly spawn: readonly [number, number, number]
  readonly timings: Record<string, number>
}

type Scan = { size: number; spacing: number; origin: readonly [number, number]; heights: Float32Array }

function scanHeight(scan: Scan, x: number, z: number) {
  const gx = Math.min(scan.size - 1.0001, Math.max(0, (x - scan.origin[0]) / scan.spacing))
  const gz = Math.min(scan.size - 1.0001, Math.max(0, (z - scan.origin[1]) / scan.spacing))
  const ix = Math.floor(gx)
  const iz = Math.floor(gz)
  const fx = gx - ix
  const fz = gz - iz
  const at = (i: number, j: number) => scan.heights[Math.min(scan.size - 1, Math.max(0, j)) * scan.size + Math.min(scan.size - 1, Math.max(0, i))]!
  const cubic = (p0: number, p1: number, p2: number, p3: number, t: number) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))
  const rows = [-1, 0, 1, 2].map(dj => cubic(at(ix - 1, iz + dj), at(ix, iz + dj), at(ix + 1, iz + dj), at(ix + 2, iz + dj), fx))
  return cubic(rows[0]!, rows[1]!, rows[2]!, rows[3]!, fz)
}

function buildPath(scan: Scan): [number, number][] {
  const points: [number, number][] = [[18, 26]]
  let heading = Math.atan2(-1, -0.6)
  let [x, z] = points[0]!
  for (let step = 0; step < 90; step++) {
    let bestHeading = heading
    let bestScore = Infinity
    for (let turn = -0.5; turn <= 0.5; turn += 0.125) {
      const candidate = heading + turn
      const nx = x + Math.cos(candidate) * 9
      const nz = z + Math.sin(candidate) * 9
      const drop = scanHeight(scan, nx, nz) - scanHeight(scan, x, z)
      const grade = Math.abs(drop) / 9
      const score = Math.max(0, grade - 0.12) * 40 + drop * 0.04 + Math.abs(turn) * 0.6 + (valueNoise(nx / 60, nz / 60, 909) - 0.5) * 0.8
      if (score < bestScore) { bestScore = score; bestHeading = candidate }
    }
    heading = bestHeading
    x += Math.cos(heading) * 9
    z += Math.sin(heading) * 9
    if (Math.abs(x) > site.walkable / 2 - 30 || Math.abs(z) > site.walkable / 2 - 30) break
    points.push([x, z])
  }
  return points
}

function segmentDistance(path: readonly (readonly [number, number])[]) {
  const cell = 32
  const grid = new Map<number, number[]>()
  for (let index = 0; index < path.length - 1; index++) {
    const [ax, az] = path[index]!
    const [bx, bz] = path[index + 1]!
    for (let gx = Math.floor((Math.min(ax, bx) - 8) / cell); gx <= Math.floor((Math.max(ax, bx) + 8) / cell); gx++) {
      for (let gz = Math.floor((Math.min(az, bz) - 8) / cell); gz <= Math.floor((Math.max(az, bz) + 8) / cell); gz++) {
        const key = (gx + 32768) * 65536 + gz + 32768
        const list = grid.get(key) ?? []
        list.push(index)
        grid.set(key, list)
      }
    }
  }
  return (x: number, z: number) => {
    const list = grid.get((Math.floor(x / cell) + 32768) * 65536 + Math.floor(z / cell) + 32768)
    if (!list) return Infinity
    let best = Infinity
    for (const index of list) {
      const [ax, az] = path[index]!
      const [bx, bz] = path[index + 1]!
      const dx = bx - ax
      const dz = bz - az
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t))
    }
    return best
  }
}

export async function buildValley(tier: Tier, onProgress: (value: number) => void): Promise<ValleyWorld> {
  const timings: Record<string, number> = {}
  let mark = performance.now()
  const lap = (name: string) => { const now = performance.now(); timings[name] = Math.round(now - mark); mark = now }
  const meta = await (await fetch(asset('terrain-ridge-valley/height.json'))).json() as { size: number; minMetres: number; maxMetres: number; metresPerPixel: number }
  const png = await decodeGrey16Png(await (await fetch(asset('terrain-ridge-valley/height.png'))).arrayBuffer())
  const range = meta.maxMetres - meta.minMetres
  const scanHeights = new Float32Array(png.data.length)
  for (let index = 0; index < scanHeights.length; index++) scanHeights[index] = png.data[index]! / 65535 * range * site.verticalScale
  const scan: Scan = { size: png.width, spacing: meta.metresPerPixel, origin: [-site.scanCentre[0] * meta.metresPerPixel, -site.scanCentre[1] * meta.metresPerPixel], heights: scanHeights }
  const scanExtent = (png.width - 1) * meta.metresPerPixel
  const scanMid = [scan.origin[0] + scanExtent / 2, scan.origin[1] + scanExtent / 2] as const
  lap('decode')
  onProgress(0.15)

  const path = buildPath(scan)
  const pathDistance = segmentDistance(path)
  const pathTop = scanHeight(scan, path[0]![0], path[0]![1])

  const nearDetail = (x: number, z: number) => (fbm(x / 23, z / 23, 3, 401) - 0.5) * 0.9 + (valueNoise(x / 4.5, z / 4.5, 409) - 0.5) * 0.18
  const near = createHeightfield({
    size: tier === 'low' ? (site.nearSize - 1) / 2 + 1 : site.nearSize,
    extent: site.walkable,
    origin: [-site.walkable / 2, -site.walkable / 2],
    sample: (x, z) => {
      const base = scanHeight(scan, x, z) + nearDetail(x, z)
      const d = pathDistance(x, z)
      if (d > 4) return base
      const sunk = 0.18 * (1 - smoothstep(1.2, 3.4, d))
      return base - sunk
    },
  })
  lap('near')
  onProgress(0.3)

  const mountains = (x: number, z: number) => {
    const dx = x - scanMid[0]
    const dz = z - scanMid[1]
    const radial = Math.hypot(dx, dz)
    const rise = smoothstep(1800, 6200, radial)
    const ridges = ridged(x / 2600, z / 2600, 5, 77) * 0.75 + fbm(x / 900, z / 900, 3, 79) * 0.25
    return 120 + rise * (220 + ridges * 1150) + ridges * 90
  }
  const farExtent = site.farExtent
  const far = createHeightfield({
    size: tier === 'low' ? (site.farSize - 1) / 2 + 1 : site.farSize,
    extent: farExtent,
    origin: [-farExtent / 2, -farExtent / 2],
    sample: (x, z) => {
      const ex = Math.max(scan.origin[0] - x, 0, x - (scan.origin[0] + scanExtent))
      const ez = Math.max(scan.origin[1] - z, 0, z - (scan.origin[1] + scanExtent))
      const outside = Math.hypot(ex, ez)
      const inner = Math.min(x - scan.origin[0], z - scan.origin[1], scan.origin[0] + scanExtent - x, scan.origin[1] + scanExtent - z)
      const t = outside > 0 ? 1 : 1 - smoothstep(0, 700, inner)
      const scanned = scanHeight(scan, x, z)
      if (t <= 0) return scanned
      return scanned + (mountains(x, z) - scanned) * smoothstep(0, 1, t)
    },
  })
  lap('far')
  onProgress(0.5)

  const sources: TerrainSources = { near, far, nearSurface: null as never, farSurface: null as never, band: site.band }
  const heightAtWorld = (x: number, z: number) => terrainHeightAt(sources, x, z)

  const forest = (x: number, z: number) => {
    const wobble = (fbm(x / 140, z / 140, 3, 501) - 0.5) * 190
    const meadow = 1 - smoothstep(site.meadowRadius - 50, site.meadowRadius + 70, Math.hypot(x - site.meadowCentre[0], z - site.meadowCentre[1]) + wobble)
    const h = heightAt(far, x, z)
    const local = 1 - smoothstep(900, 1400, Math.hypot(x, z))
    const relief = 1 - smoothstep(pathTop - 20, pathTop + 70, h) * local
    const patches = fbm(x / 260, z / 260, 3, 503)
    let density = smoothstep(0.3, 0.46, patches * 0.6 + relief * 0.35 + 0.12)
    density *= 1 - meadow
    density *= 1 - smoothstep(site.treeline - 220, site.treeline, h)
    density *= 1 - smoothstep(34, 46, slopeAt(far, x, z))
    const grove = smoothstep(0.8, 0.88, valueNoise(x / 34, z / 34, 507)) * meadow * (1 - smoothstep(site.meadowRadius * 0.45, site.meadowRadius * 0.7, Math.hypot(x, z)) * 0)
    density = Math.max(density, grove * 0.9)
    const lane = pathDistance(x, z)
    if (lane < 6) density *= smoothstep(2.5, 6, lane)
    return Math.min(1, Math.max(0, density))
  }

  const pathMask = (x: number, z: number) => 1 - smoothstep(0.9, 2.4, pathDistance(x, z))
  const nearSurface = surfaceTexture(near, (x, z) => [forest(x, z), pathMask(x, z)])
  lap('nearSurface')
  onProgress(0.65)
  const farSurface = surfaceTexture(far, (x, z) => [forest(x, z), 0])
  lap('farSurface')
  onProgress(0.8)
  Object.assign(sources, { nearSurface, farSurface })

  const layers = await loadLayerImages([
    { color: kit('grass_c'), normal: kit('grass_n') },
    { color: asset('soil-mud-scanned/1k/c.webp'), normal: asset('soil-mud-scanned/1k/n.webp') },
    { color: kit('dirt_c'), normal: kit('dirt_n') },
    { color: kit('gravel_c'), normal: kit('gravel_n') },
  ], site.layerSize)
  lap('layers')
  onProgress(0.95)

  const spawnXZ = site.spawn
  const spawn = [spawnXZ[0], heightAtWorld(spawnXZ[0], spawnXZ[1]) + 1.2, spawnXZ[1]] as const
  return { sources, layers, heightAt: heightAtWorld, forest, path, pathDistance, spawn, timings }
}

export function colliderHeights(world: ValleyWorld, size: number, extent: number) {
  const heights = new Float32Array(size * size)
  const spacing = extent / (size - 1)
  const origin = -extent / 2
  for (let ix = 0; ix < size; ix++) {
    for (let iz = 0; iz < size; iz++) heights[ix * size + iz] = world.heightAt(origin + ix * spacing, origin + iz * spacing)
  }
  return heights
}

export type { Heightfield }
