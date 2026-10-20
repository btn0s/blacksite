import { Box3, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three/webgpu'
import { loadMeshletModel } from '@blacksite/geometry'
import type { GeometryPageSource, MeshletSceneEntry } from '@blacksite/geometry'
import { fbm, hash2, smoothstep } from '@blacksite/landscape'
import type { CoastalTerrain } from './terrain'

type Habitat = 'sedge' | 'grass' | 'yucca' | 'sandstone-rock' | 'island-tree-02' | 'coast-rocks'

interface Variant {
  asset: GeometryPageSource
  materials: MeshStandardMaterial[]
  height: number
  width: number
  anchor: Matrix4
  footprint: Vector3[]
}

const habitats = {
  'coast-rocks': { spacing: 5.2, density: 0.92, clusterSize: 19, shore: -2, slope: 34, cap: 180, tilt: 1, seed: 709 },
  sedge: { spacing: 0.85, density: 0.86, clusterSize: 13, shore: 5, slope: 42, cap: 7000, tilt: 0.8, seed: 1129 },
  grass: { spacing: 1.9, density: 0.88, clusterSize: 12, shore: 8, slope: 38, cap: 2400, tilt: 0.65, seed: 1357 },
  yucca: { spacing: 5.4, density: 0.48, clusterSize: 38, shore: 11, slope: 32, cap: 260, tilt: 0.15, seed: 877 },
  'sandstone-rock': { spacing: 1.1, density: 0.82, clusterSize: 9, shore: -3, slope: 46, cap: 1600, tilt: 0.95, seed: 1619 },
  'island-tree-02': { spacing: 7.5, density: 0.68, clusterSize: 34, shore: 12, slope: 30, cap: 180, tilt: 0.08, seed: 2341 },
} satisfies Record<Habitat, { spacing: number; density: number; clusterSize: number; shore: number; slope: number; cap: number; tilt: number; seed: number }>

async function loadVariants(family: Habitat): Promise<Variant[]> {
  const model = await loadMeshletModel(`/owned/geometry/${family}/manifest.json`)
  const materials = model.materials.map(material => {
    if (!(material instanceof MeshStandardMaterial)) throw new Error(`Vegetation requires a standard PBR material: ${material.name}`)
    return material
  })
  return model.instances.map(instance => {
    const asset = model.geometries.get(instance.geometry)!
    const bounds = new Box3(new Vector3().fromArray(asset.metadata.bounds.min), new Vector3().fromArray(asset.metadata.bounds.max)).applyMatrix4(instance.matrix)
    const size = bounds.getSize(new Vector3())
    if (![size.x, size.y, size.z].every(Number.isFinite) || size.y <= 0) throw new Error(`Vegetation asset dimensions are invalid: ${instance.name}`)
    const centre = bounds.getCenter(new Vector3())
    const anchor = new Matrix4().makeTranslation(-centre.x, -bounds.min.y, -centre.z).multiply(instance.matrix)
    const footprint = [-0.5, 0, 0.5].flatMap(x => [-0.5, 0, 0.5].map(z => new Vector3(x * size.x, size.y * 0.27, z * size.z)))
    return { asset, materials, height: size.y, width: Math.max(size.x, size.z), anchor, footprint }
  })
}

function placeFamily(terrain: CoastalTerrain, variants: Variant[], family: Habitat): MeshletSceneEntry[] {
  const rule = habitats[family]
  const rock = family === 'sandstone-rock' || family === 'coast-rocks'
  const outcrop = family === 'coast-rocks'
  const meanWidth = variants.reduce((sum, variant) => sum + variant.width, 0) / variants.length
  const spacing = Math.max(rule.spacing, meanWidth * 0.8)
  const [minX, minZ] = terrain.field.origin
  const maxX = minX + terrain.field.extent
  const maxZ = minZ + terrain.field.extent
  const candidates: { variant: Variant; matrix: Matrix4; rank: number }[] = []
  const up = new Vector3(0, 1, 0)
  const surface = new Vector3()
  const position = new Vector3()
  const scale = new Vector3()
  const rotation = new Quaternion()
  const yaw = new Quaternion()
  for (let row = Math.floor(minZ / spacing); row * spacing < maxZ; row++) {
    for (let column = Math.floor(minX / spacing); column * spacing < maxX; column++) {
      const x = (column + 0.15 + hash2(column, row, rule.seed) * 0.7) * spacing
      const z = (row + 0.15 + hash2(column, row, rule.seed + 1) * 0.7) * spacing
      if (x < minX || z < minZ || x > maxX || z > maxZ) continue
      const elevation = terrain.heightAt(x, z)
      if (rock ? elevation < 0 || elevation > (outcrop ? 26 : 10) : elevation < 5) continue
      if (terrain.slopeAt(x, z) > rule.slope || (!rock && !terrain.canPlant(x, z))) continue
      const shore = terrain.shoreDistance(x, z)
      if (shore < rule.shore || (rock && shore > (outcrop ? 36 : 15))) continue
      const grove = fbm(x / rule.clusterSize, z / rule.clusterSize, 3, rule.seed + 7)
      const shoreline = rock ? 1 - smoothstep(outcrop ? 16 : 5, outcrop ? 36 : 15, shore) : smoothstep(rule.shore, rule.shore + 7, shore)
      const density = smoothstep(0.3, 0.68, grove) * rule.density * shoreline
      if (hash2(column, row, rule.seed + 2) > density) continue
      const region = hash2(Math.floor(x / rule.clusterSize), Math.floor(z / rule.clusterSize), rule.seed + 19)
      const variant = variants[Math.min(variants.length - 1, Math.floor(region * variants.length))]!
      const naturalScale = outcrop ? 0.9 + hash2(column, row, rule.seed + 3) * 0.25 : rock ? 0.8 + hash2(column, row, rule.seed + 3) : 0.82 + hash2(column, row, rule.seed + 3) * 0.36
      surface.fromArray(terrain.normalAt(x, z)).lerp(up, 1 - rule.tilt).normalize()
      rotation.setFromUnitVectors(up, surface)
      yaw.setFromAxisAngle(up, hash2(column, row, rule.seed + 4) * Math.PI * 2)
      rotation.multiply(yaw)
      position.set(x, elevation - variant.height * naturalScale * (rock ? 0.24 : 0.015), z)
      scale.setScalar(naturalScale)
      if (outcrop) {
        let supportedHeight = Infinity
        for (const point of variant.footprint) {
          const offset = point.clone().multiplyScalar(naturalScale).applyQuaternion(rotation)
          supportedHeight = Math.min(supportedHeight, terrain.heightAt(x + offset.x, z + offset.z) - offset.y - 0.06)
        }
        position.y = supportedHeight
      }
      const matrix = new Matrix4().compose(position, rotation, scale).multiply(variant.anchor)
      candidates.push({ variant, matrix, rank: hash2(column, row, rule.seed + 5) })
    }
  }
  if (candidates.length > rule.cap) candidates.sort((a, b) => a.rank - b.rank).length = rule.cap
  const entries = new Map<MeshletAsset, { asset: MeshletAsset; materials: MeshStandardMaterial[]; instances: Matrix4[] }>()
  for (const { variant, matrix } of candidates) {
    let entry = entries.get(variant.asset)
    if (!entry) {
      entry = { asset: variant.asset, materials: variant.materials, instances: [] }
      entries.set(variant.asset, entry)
    }
    entry.instances.push(matrix)
  }
  return [...entries.values()]
}

export async function createVegetation(terrain: CoastalTerrain): Promise<MeshletSceneEntry[]> {
  const families = Object.keys(habitats) as Habitat[]
  const models = await Promise.all(families.map(loadVariants))
  return families.flatMap((family, index) => placeFamily(terrain, models[index]!, family))
}
