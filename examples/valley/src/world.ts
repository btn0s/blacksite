import { createHeightfield, fbm, heightAt, loadLayerImages, ridged, smoothstep, surfaceTexture, terrainHeightAt, valueNoise, type Heightfield, type LayerImages, type TerrainSources } from '@blacksite/landscape'
import { site, type Tier, type ValleyBookmark } from './model'
import { aqueductPath, bookmarkSites, layout, mainPathCurves, riverLevel, riverPath, sampleCurves, walkingPaths, type XZ } from './layout'

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
  readonly coverMask: (x: number, z: number) => number
  readonly riverDistance: (x: number, z: number) => number
  readonly path: readonly XZ[]
  readonly paths: readonly (readonly XZ[])[]
  readonly pathDistance: (x: number, z: number) => number
  readonly spawn: readonly [number, number, number]
  readonly bookmarks: readonly ValleyBookmark[]
  readonly timings: Record<string, number>
}

function distanceField(paths: readonly (readonly XZ[])[], reach: number) {
  const cell = 64
  const segments: { ax: number; az: number; dx: number; dz: number; length2: number; index: number; path: number }[] = []
  const grid = new Map<number, number[]>()
  const cellId = (x: number, z: number) => (x + 65536) * 131072 + z + 65536
  paths.forEach((points, path) => {
    for (let index = 0; index < points.length - 1; index++) {
      const [ax, az] = points[index]!
      const [bx, bz] = points[index + 1]!
      const id = segments.length
      segments.push({ ax, az, dx: bx - ax, dz: bz - az, length2: (bx - ax) ** 2 + (bz - az) ** 2, index, path })
      for (let x = Math.floor((Math.min(ax, bx) - reach) / cell); x <= Math.floor((Math.max(ax, bx) + reach) / cell); x++) {
        for (let z = Math.floor((Math.min(az, bz) - reach) / cell); z <= Math.floor((Math.max(az, bz) + reach) / cell); z++) {
          const idCell = cellId(x, z)
          const entries = grid.get(idCell) ?? []
          entries.push(id)
          grid.set(idCell, entries)
        }
      }
    }
  })
  const sample = { distance: Infinity, x: 0, z: 0, t: 0, index: 0, path: 0 }
  return (x: number, z: number) => {
    sample.distance = Infinity
    const entries = grid.get(cellId(Math.floor(x / cell), Math.floor(z / cell)))
    if (!entries) return sample
    let squared = reach * reach
    for (const id of entries) {
      const segment = segments[id]!
      const t = Math.max(0, Math.min(1, ((x - segment.ax) * segment.dx + (z - segment.az) * segment.dz) / Math.max(segment.length2, 1e-6)))
      const px = segment.ax + segment.dx * t
      const pz = segment.az + segment.dz * t
      const distance = (x - px) ** 2 + (z - pz) ** 2
      if (distance >= squared) continue
      squared = distance
      sample.distance = Math.sqrt(distance)
      sample.x = px
      sample.z = pz
      sample.t = t
      sample.index = segment.index
      sample.path = segment.path
    }
    return sample
  }
}

const riverSample = distanceField([riverPath], 180)
const pathSample = distanceField(walkingPaths, 40)
const aqueductSample = distanceField([aqueductPath], 20)
const mainProfiles = mainPathCurves.map(curve => sampleCurves([curve]))
const mainSample = distanceField(mainProfiles, 35)
const pathLevels = [276, 165, 138, 125, 120, 118.6, 155]
const clearings = [layout.watchtower, layout.stones, layout.arch, layout.shrine] as const
const landings = [layout.bridge.start, layout.bridge.end] as const
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const rectangleDistance = (x: number, z: number, min: XZ, max: XZ) => Math.hypot(Math.max(min[0] - x, 0, x - max[0]), Math.max(min[1] - z, 0, z - max[1]))

function mainPathHeight(x: number, z: number, path: number, index: number, t: number) {
  if (path === mainProfiles.length - 1) return mix(riverLevel(z) - 0.28, layout.bridge.start[1], smoothstep(490, 600, x))
  const progress = (index + t) / (mainProfiles[path]!.length - 1)
  return mix(pathLevels[path]!, pathLevels[path + 1]!, progress)
}

function terrainShape(x: number, z: number) {
  const broad = fbm(x / 680, z / 680, 3, 71)
  const detail = (fbm(x / 55, z / 55, 3, 401) - 0.5) * 3.4 + (valueNoise(x / 8, z / 8, 409) - 0.5) * 0.3
  let height = riverLevel(z) + 15 + (broad - 0.5) * 36 + detail
  const crest = -1640 + Math.sin(z / 620) * 85
  const across = x - crest
  const reach = 1 - smoothstep(1250, 2000, Math.abs(z))
  const ridge = (across < 0 ? 1 - smoothstep(120, 480, -across) : 1 - smoothstep(150, 400, across)) * reach
  const bench = across < 0 ? 0 : (1 - smoothstep(380, 820, across)) * reach
  height = mix(height + 45 * bench, 268 + Math.sin(z / 380) * 15 + (broad - 0.5) * 14 + detail, ridge)
  const mesaRadius = Math.hypot((x - 1195) / 390, (z + 65) / 700)
  const mesa = 1 - smoothstep(0.83, 1.04, mesaRadius)
  height = mix(height, layout.temple.ground + (valueNoise(x / 130, z / 130, 211) - 0.5) * 5, mesa)
  const gorgeCentre = 742 + Math.sin((z + 100) / 430) * 22
  const gorge = (1 - smoothstep(65, 108, Math.abs(x - gorgeCentre))) * (1 - smoothstep(570, 760, Math.abs(z + 25)))
  height = mix(height, 37 - z * 0.012 + (valueNoise(x / 38, z / 38, 217) - 0.5) * 7, gorge)
  const southFace = 1315 + Math.sin(x / 310) * 26
  const southWall = smoothstep(southFace - 27, southFace + 22, z) * (1 - smoothstep(1490, 1850, z)) * (1 - smoothstep(570, 850, Math.abs(x - 25)))
  height += southWall * (85 + (valueNoise(x / 85, z / 85, 223) - 0.5) * 13)
  const outer = smoothstep(1800, 3650, Math.hypot(x * 0.9, z))
  const mountain = 250 + ridged(x / 2300, z / 2300, 6, 77) ** 2 * 1540 + fbm(x / 700, z / 700, 3, 79) * 280
  height = mix(height, mountain, outer)
  const river = riverSample(x, z)
  if (river.distance < 180) {
    const water = riverLevel(river.z)
    const channel = 1 - smoothstep(layout.river.halfWidth - 3, layout.river.halfWidth + layout.river.bankWidth, river.distance)
    const bed = water - 1.9 + smoothstep(3, layout.river.halfWidth + 6, river.distance) * 1.1
    height = mix(height, bed, channel)
  }
  const trail = mainSample(x, z)
  if (trail.distance < 35) height = mix(height, mainPathHeight(trail.x, trail.z, trail.path, trail.index, trail.t), 1 - smoothstep(4, 24, trail.distance))
  for (const poi of clearings) {
    const distance = Math.hypot(x - poi.at[0], z - poi.at[1])
    height = mix(height, poi.ground, 1 - smoothstep(...poi.pad, distance))
  }
  const forecourt = rectangleDistance(x, z, layout.temple.footprint.min, layout.temple.footprint.max)
  height = mix(height, layout.temple.ground, 1 - smoothstep(0, 45, forecourt))
  for (const landing of landings) {
    const radius = Math.hypot((x - landing[0]) / 50, (z - landing[2]) / 42)
    height = mix(height, landing[1], 1 - smoothstep(0.55, 1.5, radius))
  }
  const pool = layout.shrine.pool
  const poolRadius = Math.hypot((x - pool.centre[0]) / pool.radius[0], (z - pool.centre[1]) / pool.radius[1])
  height = mix(height, pool.bed, 1 - smoothstep(0.78, 1.18, poolRadius))
  return height
}

function vegetationClearance(x: number, z: number, forest: boolean) {
  let amount = smoothstep(forest ? 12 : 2.5, forest ? 23 : 4.5, pathSample(x, z).distance)
  amount *= smoothstep(layout.river.halfWidth + (forest ? 12 : 1), layout.river.halfWidth + (forest ? 45 : 9), riverSample(x, z).distance)
  amount *= smoothstep(forest ? 6 : 3, forest ? 15 : 7, aqueductSample(x, z).distance)
  for (const poi of clearings) {
    const distance = Math.hypot(x - poi.at[0], z - poi.at[1])
    const inner = forest ? poi.clearing[0] : poi === layout.shrine ? 35 : poi === layout.watchtower ? 12 : poi === layout.stones ? 18 : 12
    const outer = forest ? poi.clearing[1] : inner + 8
    amount *= smoothstep(inner, outer, distance)
  }
  amount *= smoothstep(forest ? 30 : 3, forest ? 75 : 9, rectangleDistance(x, z, layout.temple.footprint.min, layout.temple.footprint.max))
  return amount
}

export async function buildValley(tier: Tier, onProgress: (value: number) => void): Promise<ValleyWorld> {
  const timings: Record<string, number> = {}
  let mark = performance.now()
  const lap = (name: string) => { const now = performance.now(); timings[name] = Math.round(now - mark); mark = now }
  const near = createHeightfield({ size: tier === 'low' ? (site.nearSize - 1) / 2 + 1 : site.nearSize, extent: site.walkable, sample: terrainShape })
  lap('near')
  onProgress(0.2)
  const far = createHeightfield({ size: tier === 'low' ? (site.farSize - 1) / 2 + 1 : site.farSize, extent: site.farExtent, sample: terrainShape })
  lap('far')
  onProgress(0.38)
  const sources: TerrainSources = { near, far, nearSurface: null as never, farSurface: null as never, band: site.band }
  const heightAtWorld = (x: number, z: number) => terrainHeightAt(sources, x, z)
  const density = createHeightfield({
    size: layout.forest.densitySize,
    extent: layout.forest.extent,
    sample: (x, z) => {
      const clearance = vegetationClearance(x, z, true)
      if (clearance === 0) return 0
      const h = heightAtWorld(x, z)
      const altitude = 1 - smoothstep(...layout.forest.timberline, h)
      if (altitude === 0) return 0
      const dx = (heightAtWorld(x + 4, z) - heightAtWorld(x - 4, z)) / 8
      const dz = (heightAtWorld(x, z + 4) - heightAtWorld(x, z - 4)) / 8
      const slope = 1 - smoothstep(0.7, 1.25, Math.hypot(dx, dz))
      const noise = fbm(x / 280, z / 280, 3, 503)
      const wobble = (valueNoise(x / 220, z / 220, 501) - 0.5) * 135
      const coreEdge = Math.min(x + 1040, 710 - x, z + 1510, 1290 - z)
      const core = smoothstep(-90, 90, coreEdge + wobble)
      const westernMeadow = 1 - smoothstep(-2250, -1900, x + wobble) * (1 - smoothstep(-1230, -890, x + wobble)) * (1 - smoothstep(1300, 1750, Math.abs(z)))
      const foothills = smoothstep(1500, 2600, Math.hypot(x, z))
      const pockets = mix(smoothstep(0.36, 0.64, noise) * 0.28, 0.38 + smoothstep(0.25, 0.7, noise) * 0.54, foothills)
      const stand = mix(pockets, 0.7 + smoothstep(0.3, 0.7, noise) * 0.28, core)
      const outerEdge = 1 - smoothstep(layout.forest.extent * 0.46, layout.forest.extent / 2, Math.max(Math.abs(x), Math.abs(z)))
      return stand * westernMeadow * slope * altitude * clearance * outerEdge
    },
  })
  const forest = (x: number, z: number) => Math.abs(x) > layout.forest.extent / 2 || Math.abs(z) > layout.forest.extent / 2 ? 0 : heightAt(density, x, z)
  const pathDistance = (x: number, z: number) => pathSample(x, z).distance
  const pathMask = (x: number, z: number) => 1 - smoothstep(1.2, 4.5, pathDistance(x, z))
  lap('forestDensity')
  onProgress(0.62)
  const nearSurface = surfaceTexture(near, (x, z) => [forest(x, z), pathMask(x, z)])
  const farSurface = surfaceTexture(far, (x, z) => [forest(x, z), pathMask(x, z)])
  Object.assign(sources, { nearSurface, farSurface })
  lap('surfaces')
  onProgress(0.82)
  const layers = await loadLayerImages([
    { color: kit('grass_c'), normal: kit('grass_n') },
    { color: asset('soil-mud-scanned/1k/c.webp'), normal: asset('soil-mud-scanned/1k/n.webp') },
    { color: kit('dirt_c'), normal: kit('dirt_n') },
    { color: kit('gravel_c'), normal: kit('gravel_n') },
  ], site.layerSize)
  lap('layers')
  onProgress(0.95)
  const bookmarks: ValleyBookmark[] = bookmarkSites.map(bookmark => ({ id: bookmark.id, name: bookmark.name, position: [bookmark.at[0], (bookmark.floor ?? heightAtWorld(...bookmark.at)) + 1.2, bookmark.at[1]], target: [...bookmark.target], note: bookmark.note }))
  const spawn = bookmarks[0]!.position
  return { sources, layers, heightAt: heightAtWorld, forest, coverMask: (x, z) => vegetationClearance(x, z, false), riverDistance: (x, z) => riverSample(x, z).distance, path: walkingPaths[0], paths: walkingPaths, pathDistance, spawn, bookmarks, timings }
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
