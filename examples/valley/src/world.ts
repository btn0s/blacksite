import { createWaterField, fbm, loadLandscape, loadLayerImages, slopeAt, smoothstep, terrainHeightAt, type LayerImages, type TerrainSources, type WaterLayout } from '@blacksite/landscape'
import { site } from './model'

const library = import.meta.glob<string>('../assets/library/*/**/*.{png,webp,json,ogg,m4a}', { eager: true, query: '?url&no-inline', import: 'default' })

export const asset = (path: string) => {
  const url = library[`../assets/library/${path}`]
  if (!url) throw new Error(`Missing Valley asset ${path}`)
  return url
}

export interface ValleyWorld {
  readonly sources: TerrainSources
  readonly water: WaterLayout
  readonly layers: LayerImages
  readonly seaLevel: number
  readonly heightAt: (x: number, z: number) => number
  readonly waterAt: (x: number, z: number) => number
  readonly forest: (x: number, z: number) => number
  readonly spawn: readonly [number, number, number]
  readonly timings: Record<string, number>
}

const surfaceAt = (sources: TerrainSources, x: number, z: number) => {
  const { near, nearSurface } = sources
  const column = Math.min(near.size - 1, Math.max(0, Math.round((x - near.origin[0]) / near.spacing)))
  const row = Math.min(near.size - 1, Math.max(0, Math.round((z - near.origin[1]) / near.spacing)))
  const data = nearSurface.image.data as Uint8Array
  const index = (row * near.size + column) * 4
  return [data[index + 2]! / 255, data[index + 3]! / 255] as const
}

export async function buildValley(onProgress: (value: number) => void): Promise<ValleyWorld> {
  const timings: Record<string, number> = {}
  let mark = performance.now()
  const lap = (name: string) => { const now = performance.now(); timings[name] = Math.round(now - mark); mark = now }
  const [landscape, layers] = await Promise.all([
    loadLandscape(`${import.meta.env.BASE_URL}landscape/`).then(value => { onProgress(0.6); return value }),
    loadLayerImages([
      { color: asset('grass-meadow/1k/c.webp'), normal: asset('grass-meadow/1k/n.webp') },
      { color: asset('soil-mud-scanned/1k/c.webp'), normal: asset('soil-mud-scanned/1k/n.webp') },
      { color: asset('sand-beach/1k/c.webp'), normal: asset('sand-beach/1k/n.webp') },
      { color: asset('rock-cliff/1k/c.webp'), normal: asset('rock-cliff/1k/n.webp') },
    ], site.layerSize).then(value => { onProgress(0.9); return value }),
  ])
  lap('landscape')
  const { sources, water, manifest } = landscape
  const seaLevel = manifest.seaLevel
  const heightAtWorld = (x: number, z: number) => terrainHeightAt(sources, x, z)
  const channel = createWaterField(water)

  const forest = (x: number, z: number) => {
    const above = heightAtWorld(x, z) - seaLevel
    const [soil, bank] = surfaceAt(sources, x, z)
    let density = smoothstep(6, 24, above) * (1 - smoothstep(170, 290, above))
    density *= 1 - smoothstep(30, 42, slopeAt(sources.near, x, z))
    density *= 1 - smoothstep(0.1, 0.4, bank)
    density *= 1 - 0.6 * smoothstep(0.5, 0.9, soil)
    density *= smoothstep(0.32, 0.58, fbm(x / 260, z / 260, 3, 503) * 0.75 + fbm(x / 70, z / 70, 2, 511) * 0.25)
    return Math.min(1, Math.max(0, density))
  }

  const [spawnX, spawnZ] = site.spawn
  const spawn = [spawnX, heightAtWorld(spawnX, spawnZ) + 1.2, spawnZ] as const
  onProgress(1)
  return { sources, water, layers, seaLevel, heightAt: heightAtWorld, waterAt: channel.surface, forest, spawn, timings }
}

export function colliderHeights(world: ValleyWorld, size: number, extent: number, origin: readonly [number, number]) {
  const heights = new Float32Array(size * size)
  const spacing = extent / (size - 1)
  for (let ix = 0; ix < size; ix++) {
    for (let iz = 0; iz < size; iz++) heights[ix * size + iz] = world.heightAt(origin[0] + ix * spacing, origin[1] + iz * spacing)
  }
  return heights
}

