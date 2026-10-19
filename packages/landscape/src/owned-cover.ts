import { Group, Vector3 } from 'three'
import type { Camera } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { vec4 } from 'three/tsl'
import { createGpuFoliage, type FoliageTint, type GpuFoliageStats } from './gpu-foliage'
import type { FoliageModel } from './foliage-model'
import { bakeImpostor } from './impostor'
import type { CoverGround } from './nodes'
import { hash2 } from './random'
import type { Wind } from './wind'

export interface OwnedCoverFamily {
  readonly name: string
  readonly model: FoliageModel
  readonly lod?: FoliageModel
  readonly density: number
  readonly scale: readonly [number, number]
  readonly mask?: (x: number, z: number) => number
  readonly windStrength?: number
  readonly range?: readonly [number, number]
  readonly meshRange?: readonly [number, number]
  readonly lodRange?: readonly [number, number]
  readonly shadowDistance?: number
  readonly yOffset?: number
  readonly tint?: FoliageTint
}

export interface OwnedCoverOptions {
  readonly renderer: WebGPURenderer
  readonly wind: Wind
  readonly heightAt: (x: number, z: number) => number
  readonly bounds: { readonly min: readonly [number, number]; readonly max: readonly [number, number] }
  readonly families: readonly OwnedCoverFamily[]
  readonly distance: number
  readonly meshRange?: readonly [number, number]
  readonly frames?: number
  readonly frameSize?: number
  readonly shadowDistance?: number
  readonly shadowLayer?: number
  readonly tileSize?: number
  readonly density?: number
  readonly fallbackDistance?: number
  readonly ground?: CoverGround
  readonly alphaToCoverage?: boolean
  readonly seed?: number
}

export interface OwnedCoverStats extends GpuFoliageStats {
  patches: number
  instances: number
  candidates: number
}

export function createOwnedCover(options: OwnedCoverOptions) {
  const tileSize = options.tileSize ?? 32
  if (!(tileSize > 0) || !(options.distance > 0)) throw new Error('Owned cover requires positive tile size and distance')
  if (!(options.bounds.max[0] > options.bounds.min[0]) || !(options.bounds.max[1] > options.bounds.min[1])) throw new Error('Owned cover requires nonempty world bounds')
  const object = new Group()
  object.name = 'Owned ground cover'
  const ground: CoverGround = options.ground ?? (() => vec4(0))
  const seed = options.seed ?? 43
  const fallbackDistance = options.fallbackDistance ?? Math.min(24, options.distance)
  const families = options.families.filter(family => family.density * (options.density ?? 1) > 0).map((family, index) => {
    const range = family.range ?? [options.distance * 0.8, options.distance] as const
    const meshRange = family.meshRange ?? options.meshRange ?? [Math.min(18, range[1] * 0.6), Math.min(28, range[1] * 0.8)] as const
    const shadowDistance = Math.min(family.shadowDistance ?? options.shadowDistance ?? range[1], range[1])
    const radius = Math.ceil(range[1] / tileSize)
    const side = radius * 2 + 1
    const tiles = side * side
    const perTile = Math.ceil(family.density * (options.density ?? 1) * tileSize * tileSize)
    const placements = new Float32Array(tiles * perTile * 8)
    const tileX = new Float64Array(tiles).fill(Infinity)
    const tileZ = new Float64Array(tiles).fill(Infinity)
    const occupied = new Uint32Array(tiles)
    const atlas = bakeImpostor(options.renderer, family.model, { frames: options.frames ?? 4, frameSize: options.frameSize ?? 64 })
    const foliage = createGpuFoliage({
      renderer: options.renderer,
      model: family.model,
      lod: family.lod,
      impostor: atlas,
      placements,
      wind: options.wind,
      range,
      meshRange,
      lodRange: family.lodRange,
      shadowDistance,
      shadowLayer: options.shadowLayer,
      fallbackDistance,
      windStrength: family.windStrength,
      tint: family.tint,
      alphaToCoverage: options.alphaToCoverage,
    })
    foliage.object.name = `Owned cover · ${family.name}`
    object.add(foliage.object)
    return { family, foliage, atlas, placements, tileX, tileZ, occupied, radius, side, perTile, seed: seed + index * 101, population: 0, activeTiles: 0 }
  })
  const materials = families.flatMap(family => family.foliage.materials)
  const stats: OwnedCoverStats = { population: 0, candidateInstances: 0, drawnInstances: 0, culledInstances: 0, sceneTriangles: 0, drawnTriangles: 0, fullDetailTriangles: 0, near: 0, middle: 0, impostors: 0, shadows: 0, cappedInstances: 0, patches: 0, instances: 0, candidates: 0 }
  const eye = new Vector3()
  let centreX = Infinity
  let centreZ = Infinity
  const modulo = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor
  const populate = (entry: typeof families[number], x: number, z: number) => {
    const { family, side, perTile, placements } = entry
    const tile = modulo(z, side) * side + modulo(x, side)
    if (entry.tileX[tile] === x && entry.tileZ[tile] === z) return
    entry.tileX[tile] = x
    entry.tileZ[tile] = z
    entry.population -= entry.occupied[tile]!
    if (entry.occupied[tile]! > 0) entry.activeTiles--
    let occupied = 0
    const salt = Math.floor(hash2(x, z, entry.seed) * 4294967296)
    const offsetX = hash2(x, z, entry.seed + 3)
    const offsetZ = hash2(x, z, entry.seed + 5)
    const first = tile * perTile
    for (let item = 0; item < perTile; item++) {
      const px = (x + (offsetX + (item + 1) * 0.7548776662466927) % 1) * tileSize
      const pz = (z + (offsetZ + (item + 1) * 0.5698402909980532) % 1) * tileSize
      const at = (first + item) * 8
      const inside = px >= options.bounds.min[0] && px <= options.bounds.max[0] && pz >= options.bounds.min[1] && pz <= options.bounds.max[1]
      const mask = inside ? Math.min(1, Math.max(0, family.mask?.(px, pz) ?? 1)) : 0
      if (!(hash2(item, salt, entry.seed + 7) < mask)) {
        placements[at + 4] = 0
        continue
      }
      const scale = family.scale[0] + (family.scale[1] - family.scale[0]) * hash2(item, salt, entry.seed + 11)
      placements[at] = px
      placements[at + 1] = options.heightAt(px, pz) - family.model.box.min.y * scale + (family.yOffset ?? 0)
      placements[at + 2] = pz
      placements[at + 3] = hash2(item, salt, entry.seed + 13) * Math.PI * 2
      placements[at + 4] = scale
      occupied++
    }
    entry.occupied[tile] = occupied
    entry.population += occupied
    if (occupied > 0) entry.activeTiles++
    entry.foliage.updatePlacements(first, perTile)
  }
  const collect = () => {
    for (const name of Object.keys(stats) as (keyof OwnedCoverStats)[]) stats[name] = 0
    for (const entry of families) {
      const current = entry.foliage.stats
      stats.population += entry.population
      stats.fullDetailTriangles += entry.population * entry.family.model.triangles
      stats.patches += entry.activeTiles
      for (const name of ['candidateInstances', 'drawnInstances', 'culledInstances', 'sceneTriangles', 'drawnTriangles', 'near', 'middle', 'impostors', 'shadows', 'cappedInstances'] as const) stats[name] += current[name]
    }
    stats.instances = stats.drawnInstances
    stats.candidates = stats.candidateInstances
    return stats
  }
  return {
    object,
    materials,
    atlases: families.map(entry => entry.atlas),
    ground,
    stats,
    fallbackDistance,
    setCullingEnabled(enabled: boolean) { for (const entry of families) entry.foliage.setCullingEnabled(enabled) },
    setLodEnabled(enabled: boolean) { for (const entry of families) entry.foliage.setLodEnabled(enabled) },
    setLodView(enabled: boolean) { for (const entry of families) entry.foliage.setLodView(enabled) },
    prepareShadow(renderer: WebGPURenderer, camera: Camera) { for (const entry of families) entry.foliage.prepareShadow(renderer, camera) },
    update(camera: Camera) {
      eye.setFromMatrixPosition(camera.matrixWorld)
      const x = Math.floor(eye.x / tileSize)
      const z = Math.floor(eye.z / tileSize)
      if (x !== centreX || z !== centreZ) {
        centreX = x
        centreZ = z
        for (const entry of families) {
          for (let dz = -entry.radius; dz <= entry.radius; dz++) {
            for (let dx = -entry.radius; dx <= entry.radius; dx++) populate(entry, x + dx, z + dz)
          }
        }
      }
      for (const entry of families) entry.foliage.update(camera)
      collect()
    },
    async readStats() { await Promise.all(families.map(entry => entry.foliage.readStats())); return collect() },
    dispose() { object.removeFromParent(); for (const entry of families) { entry.foliage.dispose(); entry.atlas.dispose() } },
  }
}

export type OwnedCover = ReturnType<typeof createOwnedCover>
