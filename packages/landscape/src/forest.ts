import { Group } from 'three'
import type { Camera, Material } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { bakeImpostor, type ImpostorAtlas } from './impostor'
import { createGpuFoliage, type FoliageTint } from './gpu-foliage'
import type { FoliageModel } from './foliage-model'
import type { ForestCoverage } from './forest-coverage'
import { hash2 } from './random'
import type { Wind } from './wind'

export interface ForestSpecies {
  readonly model: FoliageModel
  readonly lod?: FoliageModel
  readonly scale?: readonly [number, number]
  readonly tint?: FoliageTint
}

export interface ForestOptions {
  readonly renderer: WebGPURenderer
  readonly wind: Wind
  readonly species: readonly ForestSpecies[]
  readonly density: (x: number, z: number) => number
  readonly choose: (x: number, z: number, random: number) => number
  readonly heightAt: (x: number, z: number) => number
  readonly bounds: { readonly min: readonly [number, number]; readonly max: readonly [number, number] }
  readonly spacing: number
  readonly edgeFade?: number
  readonly count: number
  readonly near: readonly [number, number]
  readonly lodRange?: readonly [number, number]
  readonly far: readonly [number, number]
  readonly shadowDistance: number
  readonly frames?: number
  readonly frameSize?: number
  readonly alphaToCoverage?: boolean
  readonly singleFrame?: boolean
  readonly impostorBlur?: number
  readonly impostorFarTint?: readonly [number, number, number]
  readonly proxyLayer?: number
  readonly seed?: number
}

export interface Forest {
  readonly object: Group
  readonly materials: readonly Material[]
  readonly atlases: readonly ImpostorAtlas[]
  readonly stats: { trees: number; candidates: number; near: number; middle: number; proxies: number; impostors: number; bakeMs: number; sceneTriangles: number; drawnTriangles: number; fullDetailTriangles: number; candidateInstances: number; drawnInstances: number; culledInstances: number; cappedInstances: number }
  readonly fallbackDistance: number
  readonly positions: Float32Array
  readonly coverage: ForestCoverage
  setLodView(enabled: boolean): void
  setLodEnabled(enabled: boolean): void
  setCullingEnabled(enabled: boolean): void
  readStats(): Promise<Forest['stats']>
  prepareShadow(renderer: WebGPURenderer, camera: Camera): void
  update(camera: Camera): void
  dispose(): void
}

export function createForest(options: ForestOptions): Forest {
  const { wind, species } = options
  const seed = options.seed ?? 5
  const stats = { trees: 0, candidates: 0, near: 0, middle: 0, proxies: 0, impostors: 0, bakeMs: 0, sceneTriangles: 0, drawnTriangles: 0, fullDetailTriangles: 0, candidateInstances: 0, drawnInstances: 0, culledInstances: 0, cappedInstances: 0 }
  const [minX, minZ] = options.bounds.min
  const [maxX, maxZ] = options.bounds.max
  const spacing = options.spacing
  const candidates: { x: number; z: number; rank: number; species: number; yaw: number; scale: number }[] = []
  for (let gz = Math.floor(minZ / spacing); gz * spacing < maxZ; gz++) {
    for (let gx = Math.floor(minX / spacing); gx * spacing < maxX; gx++) {
      const x = (gx + 0.15 + hash2(gx, gz, seed) * 0.7) * spacing
      const z = (gz + 0.15 + hash2(gx, gz, seed + 1) * 0.7) * spacing
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue
      const density = options.density(x, z)
      if (density <= 0.02 || hash2(gx, gz, seed + 2) > density) continue
      const kind = options.choose(x, z, hash2(gx, gz, seed + 3))
      const range = species[kind]?.scale ?? [0.8, 1.2]
      candidates.push({ x, z, rank: hash2(gx, gz, seed + 4), species: kind, yaw: hash2(gx, gz, seed + 5) * Math.PI * 2, scale: range[0] + (range[1] - range[0]) * hash2(gx, gz, seed + 6) })
    }
  }
  stats.candidates = candidates.length
  if (candidates.length > options.count) candidates.sort((a, b) => a.rank - b.rank).length = options.count
  const total = candidates.length
  stats.trees = total
  const coverage: ForestCoverage = {
    bounds: options.bounds,
    edgeFade: options.edgeFade ?? Math.min(500, (maxX - minX) * 0.15, (maxZ - minZ) * 0.15),
    range: options.far,
    spacing,
    densityScale: stats.candidates > 0 ? total / stats.candidates : 0,
  }
  const cellSize = 64
  const cellsX = Math.ceil((maxX - minX) / cellSize)
  const cellsZ = Math.ceil((maxZ - minZ) / cellSize)
  const cellOf = (x: number, z: number) => Math.min(cellsZ - 1, Math.max(0, Math.floor((z - minZ) / cellSize))) * cellsX + Math.min(cellsX - 1, Math.max(0, Math.floor((x - minX) / cellSize)))
  candidates.sort((a, b) => cellOf(a.x, a.z) - cellOf(b.x, b.z))
  const positions = new Float32Array(total * 4)
  const scales = new Float32Array(total)
  const kinds = new Uint8Array(total)
  candidates.forEach((tree, index) => {
    positions[index * 4] = tree.x
    positions[index * 4 + 1] = options.heightAt(tree.x, tree.z) - 0.15
    positions[index * 4 + 2] = tree.z
    positions[index * 4 + 3] = tree.yaw
    scales[index] = tree.scale
    kinds[index] = tree.species
  })

  const object = new Group()
  object.name = 'world-forest'
  const materials: Material[] = []
  const atlases: ImpostorAtlas[] = []
  const fallbackDistance = options.near[1]
  const groups = species.flatMap((entry, kind) => {
    let population = 0
    for (let index = 0; index < total; index++) if (kinds[index] === kind) population++
    if (population === 0) return []
    const placements = new Float32Array(population * 8)
    let target = 0
    for (let index = 0; index < total; index++) {
      if (kinds[index] !== kind) continue
      placements.set(positions.subarray(index * 4, index * 4 + 4), target * 8)
      placements[target * 8 + 4] = scales[index]!
      target++
    }
    const atlas = bakeImpostor(options.renderer, entry.model, { frames: options.frames, frameSize: options.frameSize })
    atlases.push(atlas)
    stats.bakeMs += atlas.milliseconds
    const group = createGpuFoliage({
      renderer: options.renderer, model: entry.model, lod: entry.lod, impostor: atlas, placements, wind,
      range: options.far, meshRange: options.near, lodRange: options.lodRange,
      shadowDistance: options.shadowDistance, shadowLayer: options.proxyLayer,
      fallbackDistance,
      alphaToCoverage: options.alphaToCoverage, singleFrame: options.singleFrame,
      impostorBlur: options.impostorBlur, impostorFarTint: options.impostorFarTint,
      tint: entry.tint,
      coverage,
    })
    object.add(group.object)
    materials.push(...group.materials)
    return [group]
  })
  function refreshStats() {
    stats.near = stats.middle = stats.proxies = stats.impostors = stats.sceneTriangles = stats.drawnTriangles = stats.fullDetailTriangles = stats.candidateInstances = stats.drawnInstances = stats.culledInstances = stats.cappedInstances = 0
    for (const group of groups) {
      stats.near += group.stats.near
      stats.middle += group.stats.middle
      stats.proxies += group.stats.shadows
      stats.impostors += group.stats.impostors
      stats.sceneTriangles += group.stats.sceneTriangles
      stats.drawnTriangles += group.stats.drawnTriangles
      stats.fullDetailTriangles += group.stats.fullDetailTriangles
      stats.candidateInstances += group.stats.candidateInstances
      stats.drawnInstances += group.stats.drawnInstances
      stats.culledInstances += group.stats.culledInstances
      stats.cappedInstances += group.stats.cappedInstances
    }
  }
  return {
    object, materials, atlases, stats, positions, fallbackDistance, coverage,
    setLodView(enabled) { for (const group of groups) group.setLodView(enabled) },
    setLodEnabled(enabled) { for (const group of groups) group.setLodEnabled(enabled) },
    setCullingEnabled(enabled) { for (const group of groups) group.setCullingEnabled(enabled) },
    async readStats() { await Promise.all(groups.map(group => group.readStats())); refreshStats(); return stats },
    prepareShadow(renderer, camera) { for (const group of groups) group.prepareShadow(renderer, camera) },
    update(camera) { for (const group of groups) group.update(camera); refreshStats() },
    dispose() { for (const group of groups) group.dispose(); for (const atlas of atlases) atlas.dispose() },
  }
}
