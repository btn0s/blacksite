import { BufferAttribute, BufferGeometry } from 'three/webgpu'
import { meshletPosition, type MeshletAsset } from '@blacksite/geometry'
import { createHeightfield, fbm, heightAt, normalAt, ridged, slopeAt, smoothstep } from '@blacksite/landscape'

const islands = [
  { x: -25, z: -55, rx: 62, rz: 69, height: 24, seed: 17 },
  { x: 108, z: 24, rx: 62, rz: 85, height: 34, seed: 31 },
  { x: -128, z: -184, rx: 55, rz: 45, height: 32, seed: 47 },
  { x: 55, z: -185, rx: 73, rz: 45, height: 32, seed: 69 },
  { x: -84, z: 45, rx: 24, rz: 18, height: 13, seed: 93 },
]

export function createTerrainSurface(heights?: Float32Array) {
  if (heights && heights.length !== 513 * 513) throw new Error('Coastal terrain requires a 513 by 513 heightfield')
  const coastDistance = (x: number, z: number, island: typeof islands[number]) => {
    const warpX = (fbm(x * 0.011, z * 0.011, 3, 303) - 0.5) * 24
    const warpZ = (fbm(x * 0.011 + 47, z * 0.011 - 21, 3, 409) - 0.5) * 24
    const dx = (x + warpX - island.x) / island.rx
    const dz = (z + warpZ - island.z) / island.rz
    const erosion = (fbm(x * 0.024, z * 0.024, 3, island.seed) - 0.5) * 0.25
    return (1 - Math.hypot(dx, dz) + erosion) * Math.min(island.rx, island.rz)
  }
  const fortDistance = (x: number, z: number) => Math.max(Math.abs(x + 27) - 25, Math.abs(z + 53) - 24)
  const field = createHeightfield({
    size: 513,
    extent: 512,
    origin: [-256, -256],
    sample: (x, z) => {
      if (heights) return heights[Math.round(z + 256) * 513 + Math.round(x + 256)]!
      let elevation = -9
      for (const island of islands) {
        const coast = coastDistance(x, z, island)
        const exposure = smoothstep(0.25, 0.75, fbm(x * 0.013, z * 0.013, 3, island.seed + 444))
        const shoreWidth = Math.min(Math.min(island.rx, island.rz) * 0.9, 27 + exposure * 28)
        const shore = island.height * smoothstep(0, shoreWidth, coast) - 9 * smoothstep(0, 35, -coast)
        const macro = (fbm(x * 0.032, z * 0.029, 3, island.seed + 125) - 0.5) * 6
          + (ridged(x * 0.021, z * 0.027, 3, island.seed + 265) - 0.5) * 4
        const micro = (fbm(x * 0.16, z * 0.16, 2, island.seed + 82) - 0.5) * 0.6
        const relief = macro * smoothstep(6, 28, coast) + micro * smoothstep(0, 5, coast)
        elevation = Math.max(elevation, shore + relief)
      }
      const foundation = 1 - smoothstep(0, 18, fortDistance(x, z))
      return elevation * (1 - foundation) + 22.3 * foundation
    },
  })
  const vertices = new Float32Array(field.size * field.size * 3)
  const normals = new Float32Array(vertices.length)
  const indices = new Uint32Array((field.size - 1) * (field.size - 1) * 6)
  for (let row = 0; row < field.size; row++) {
    for (let column = 0; column < field.size; column++) {
      const index = row * field.size + column
      const x = field.origin[0] + column * field.spacing
      const z = field.origin[1] + row * field.spacing
      vertices.set([x, field.heights[index]!, z], index * 3)
      normals.set(normalAt(field, x, z), index * 3)
      if (row < field.size - 1 && column < field.size - 1) {
        const a = index
        const b = a + 1
        const c = a + field.size
        const d = c + 1
        indices.set([a, c, b, b, c, d], (row * (field.size - 1) + column) * 6)
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(vertices, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()
  const shoreDistance = (x: number, z: number) => Math.max(...islands.map(island => coastDistance(x, z, island)))
  return {
    field,
    geometry,
    heightAt: (x: number, z: number) => heightAt(field, x, z),
    normalAt: (x: number, z: number) => normalAt(field, x, z),
    slopeAt: (x: number, z: number) => slopeAt(field, x, z),
    shoreDistance,
    canPlant: (x: number, z: number) => heightAt(field, x, z) > 5 && fortDistance(x, z) > 5 && shoreDistance(x, z) > 5,
  }
}

export type CoastalTerrain = ReturnType<typeof createTerrainSurface>

export function createTerrainFromAsset(asset: MeshletAsset) {
  const heights = new Float32Array(513 * 513)
  for (let cluster = 0; cluster < asset.metadata.clusterCount; cluster++) {
    if (asset.clusterData[cluster * 8 + 4] !== 0) continue
    for (let vertex = 0; vertex < asset.clusterData[cluster * 8 + 6]!; vertex++) {
      const [x, y, z] = meshletPosition(asset, cluster, vertex)
      const column = Math.round(x + 256), row = Math.round(z + 256)
      if (column < 0 || column > 512 || row < 0 || row > 512) throw new Error('Packed coastal terrain is outside its heightfield')
      heights[row * 513 + column] = y
    }
  }
  return createTerrainSurface(heights)
}
