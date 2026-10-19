import {
  BufferAttribute, BufferGeometry, DataTexture, DynamicDrawUsage, Frustum, Group, InstancedBufferAttribute, InstancedMesh,
  Matrix4, Sphere, Vector2, Vector3, Vector4,
} from 'three'
import type { Camera, DataArrayTexture, Material } from 'three'
import { heightAt as fieldHeight, heightTexture, type Heightfield } from './heightfield'
import type { MeshStandardNodeMaterial } from 'three/webgpu'
import type { CoverGround } from './nodes'
import { createTerrainMaterial } from './terrain-nodes'
import type { ForestCoverage } from './forest-coverage'

export interface TerrainSources {
  readonly near: Heightfield
  readonly far: Heightfield
  readonly nearSurface: DataTexture
  readonly farSurface: DataTexture
  readonly band?: number
}

export interface TerrainUniforms {
  terrainHeightNear: { value: DataTexture }
  terrainHeightFar: { value: DataTexture }
  terrainSurfaceNear: { value: DataTexture }
  terrainSurfaceFar: { value: DataTexture }
  terrainNear: { value: Vector4 }
  terrainFar: { value: Vector4 }
  terrainBand: { value: number }
  [name: string]: { value: unknown }
}

export function terrainUniforms(sources: TerrainSources): TerrainUniforms {
  const { near, far } = sources
  return {
    terrainHeightNear: { value: heightTexture(near) },
    terrainHeightFar: { value: heightTexture(far) },
    terrainSurfaceNear: { value: sources.nearSurface },
    terrainSurfaceFar: { value: sources.farSurface },
    terrainNear: { value: new Vector4(near.origin[0], near.origin[1], near.extent, near.size) },
    terrainFar: { value: new Vector4(far.origin[0], far.origin[1], far.extent, far.size) },
    terrainBand: { value: sources.band ?? 240 },
  }
}

export function terrainHeightAt(sources: TerrainSources, x: number, z: number): number {
  const { near, far } = sources
  const band = sources.band ?? 240
  const u = x - near.origin[0]
  const v = z - near.origin[1]
  const edge = Math.min(u, v, near.extent - u, near.extent - v)
  const t = Math.min(1, Math.max(0, edge / band))
  const w = t * t * (3 - 2 * t)
  const farHeight = fieldHeight(far, x, z)
  return w <= 0 ? farHeight : farHeight + (fieldHeight(near, x, z) - farHeight) * w
}

export interface TerrainLayerSpec {
  readonly tile: number
  readonly tint: readonly [number, number, number]
  readonly roughness: number
  readonly normalScale: number
}

export interface CanopySpec {
  readonly height: number
  readonly crown: number
  readonly forest: ForestCoverage
  readonly colors: readonly [readonly [number, number, number], readonly [number, number, number]]
  readonly broadleaf?: number
  readonly dither?: boolean
}

export interface TerrainOptions {
  readonly sources: TerrainSources
  readonly uniforms?: TerrainUniforms
  readonly layers: { readonly color: DataArrayTexture; readonly normal: DataArrayTexture; readonly averages: readonly (readonly [number, number, number])[] }
  readonly layerSpecs: readonly [TerrainLayerSpec, TerrainLayerSpec, TerrainLayerSpec, TerrainLayerSpec]
  readonly leafSize?: number
  readonly grid?: number
  readonly rangeFactor?: number
  readonly detailDistance?: number
  readonly shadowDistance?: number
  readonly cover?: { readonly ground: CoverGround }
  readonly canopy?: CanopySpec
}

export interface Terrain {
  readonly object: Group
  readonly uniforms: TerrainUniforms
  readonly material: MeshStandardNodeMaterial
  readonly materials: readonly Material[]
  readonly stats: { nodes: number; candidateNodes: number; culledNodes: number; sceneTriangles: number; drawnTriangles: number; fullDetailTriangles: number }
  setLodView(enabled: boolean): void
  setLodEnabled(enabled: boolean): void
  update(camera: Camera): void
  heightAt(x: number, z: number): number
  dispose(): void
}

function gridGeometry(cells: number) {
  const geometry = new BufferGeometry()
  const vertices = new Float32Array((cells + 1) * (cells + 1) * 3)
  const normals = new Float32Array(vertices.length)
  let cursor = 0
  for (let j = 0; j <= cells; j++) for (let i = 0; i <= cells; i++) { vertices[cursor++] = i; vertices[cursor++] = 0; vertices[cursor++] = j }
  const indices = new Uint32Array(cells * cells * 6)
  cursor = 0
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const a = j * (cells + 1) + i
    const b = a + 1
    const c = a + cells + 1
    const d = c + 1
    if ((i + j) % 2 === 0) { indices.set([a, c, b, b, c, d], cursor) } else { indices.set([a, c, d, a, d, b], cursor) }
    cursor += 6
  }
  geometry.setAttribute('position', new BufferAttribute(vertices, 3))
  for (let index = 1; index < normals.length; index += 3) normals[index] = 1
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  return geometry
}

const MAX_LEVELS = 14

export function createTerrain(options: TerrainOptions): Terrain {
  const { sources } = options
  const leafSize = options.leafSize ?? 32
  const grid = options.grid ?? 32
  const rangeFactor = options.rangeFactor ?? 2.4
  const far = sources.far
  const rootSize = (() => { let size = leafSize; while (size < far.extent) size *= 2; return size })()
  const maxLevel = Math.round(Math.log2(rootSize / leafSize))
  if (maxLevel + 1 > MAX_LEVELS) throw new Error(`Terrain needs ${maxLevel + 1} levels; at most ${MAX_LEVELS}`)
  const rootOrigin = new Vector2(far.origin[0] + far.extent / 2 - rootSize / 2, far.origin[1] + far.extent / 2 - rootSize / 2)
  const ranges = Array.from({ length: maxLevel + 1 }, (_, level) => level === maxLevel ? Infinity : leafSize * 2 ** level * rangeFactor)
  const morph = Array.from({ length: MAX_LEVELS }, (_, level) => {
    if (level > maxLevel) return new Vector2(1e9, 1e9 + 1)
    const end = level === maxLevel ? 1e9 : ranges[level]!
    const start = level === 0 ? end * 0.7 : ranges[level - 1]! + (end - ranges[level - 1]!) * 0.55
    return new Vector2(start, level === maxLevel ? 1e9 + 1 : end * 0.97)
  })

  const cellsPerSide = rootSize / leafSize
  const pyramid: { min: Float32Array; max: Float32Array; side: number }[] = []
  {
    const side = cellsPerSide
    const corners = new Float32Array((side + 1) * (side + 1))
    for (let j = 0; j <= side; j++) for (let i = 0; i <= side; i++) corners[j * (side + 1) + i] = terrainHeightAt(sources, rootOrigin.x + i * leafSize, rootOrigin.y + j * leafSize)
    const min = new Float32Array(side * side)
    const max = new Float32Array(side * side)
    for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
      const a = corners[j * (side + 1) + i]!
      const b = corners[j * (side + 1) + i + 1]!
      const c = corners[(j + 1) * (side + 1) + i]!
      const d = corners[(j + 1) * (side + 1) + i + 1]!
      const centre = terrainHeightAt(sources, rootOrigin.x + (i + 0.5) * leafSize, rootOrigin.y + (j + 0.5) * leafSize)
      min[j * side + i] = Math.min(a, b, c, d, centre) - 6
      max[j * side + i] = Math.max(a, b, c, d, centre) + 6 + (options.canopy?.height ?? 0)
    }
    pyramid.push({ min, max, side })
    let current = pyramid[0]!
    while (current.side > 1) {
      const next = current.side / 2
      const nmin = new Float32Array(next * next)
      const nmax = new Float32Array(next * next)
      for (let j = 0; j < next; j++) for (let i = 0; i < next; i++) {
        let lo = Infinity
        let hi = -Infinity
        for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
          const index = (j * 2 + dj) * current.side + i * 2 + di
          lo = Math.min(lo, current.min[index]!)
          hi = Math.max(hi, current.max[index]!)
        }
        nmin[j * next + i] = lo
        nmax[j * next + i] = hi
      }
      current = { min: nmin, max: nmax, side: next }
      pyramid.push(current)
    }
  }

  const uniforms = options.uniforms ?? terrainUniforms(sources)
  const viewer = new Vector3()
  const { material, lodView } = createTerrainMaterial(options, uniforms, viewer, morph)
  const baseRanges = [...ranges]
  const capacity = 1024
  const makeMesh = (cells: number) => {
    const geometry = gridGeometry(cells)
    const info = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
    info.setUsage(DynamicDrawUsage)
    geometry.setAttribute('nodeInfo', info)
    const mesh = new InstancedMesh(geometry, material, capacity)
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.receiveShadow = true
    mesh.castShadow = true
    mesh.matrixAutoUpdate = false
    for (let index = 0; index < capacity; index++) mesh.setMatrixAt(index, identity)
    return { mesh, info, cells }
  }
  const identity = new Matrix4()
  const full = makeMesh(grid)
  const quad = makeMesh(grid / 2)
  full.mesh.name = 'world-terrain'
  quad.mesh.name = 'world-terrain-quadrants'
  const object = new Group()
  object.name = 'world-terrain-root'
  object.add(full.mesh, quad.mesh)

  const frustum = new Frustum()
  const projection = new Matrix4()
  const sphere = new Sphere()
  const box = { min: new Vector3(), max: new Vector3() }
  const shadowDistance = options.shadowDistance ?? 220
  const stats = { nodes: 0, candidateNodes: 0, culledNodes: 0, sceneTriangles: 0, drawnTriangles: 0, fullDetailTriangles: cellsPerSide * cellsPerSide * grid * grid * 2 }

  const nodeBounds = (level: number, i: number, j: number) => {
    const layer = pyramid[level]!
    const index = j * layer.side + i
    const size = leafSize * 2 ** level
    box.min.set(rootOrigin.x + i * size, layer.min[index]!, rootOrigin.y + j * size)
    box.max.set(box.min.x + size, layer.max[index]!, box.min.z + size)
  }
  const distanceToBox = () => {
    const dx = Math.max(box.min.x - viewer.x, 0, viewer.x - box.max.x)
    const dy = Math.max(box.min.y - viewer.y, 0, viewer.y - box.max.y)
    const dz = Math.max(box.min.z - viewer.z, 0, viewer.z - box.max.z)
    return Math.hypot(dx, dy, dz)
  }
  const visible = () => {
    if (distanceToBox() < shadowDistance) return true
    sphere.center.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2)
    sphere.radius = box.min.distanceTo(box.max) / 2
    return frustum.intersectsSphere(sphere)
  }
  const push = (target: typeof full, x: number, z: number, spacing: number, level: number) => {
    const triangles = target.cells * target.cells * 2
    stats.candidateNodes++
    stats.sceneTriangles += triangles
    if (!visible() || target.mesh.count >= capacity) { stats.culledNodes++; return }
    stats.drawnTriangles += triangles
    const offset = target.mesh.count * 4
    const array = target.info.array as Float32Array
    array[offset] = x
    array[offset + 1] = z
    array[offset + 2] = spacing
    array[offset + 3] = level
    target.mesh.count++
  }
  const select = (level: number, i: number, j: number): boolean => {
    nodeBounds(level, i, j)
    const distance = distanceToBox()
    if (distance > ranges[level]!) return false
    const size = leafSize * 2 ** level
    const x = rootOrigin.x + i * size
    const z = rootOrigin.y + j * size
    const spacing = size / grid
    if (level === 0) { push(full, x, z, spacing, level); return true }
    nodeBounds(level, i, j)
    if (distanceToBox() > ranges[level - 1]!) { push(full, x, z, spacing, level); return true }
    for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
      if (!select(level - 1, i * 2 + di, j * 2 + dj)) push(quad, x + di * size / 2, z + dj * size / 2, spacing, level)
    }
    return true
  }

  return {
    object,
    uniforms,
    material,
    materials: [material],
    stats,
    setLodView(enabled) { lodView.value = enabled },
    setLodEnabled(enabled) {
      for (let level = 0; level <= maxLevel; level++) {
        ranges[level] = enabled ? baseRanges[level]! : baseRanges[level]! + 180
        const end = level === maxLevel ? 1e9 : ranges[level]!
        const start = level === 0 ? end * 0.7 : ranges[level - 1]! + (end - ranges[level - 1]!) * 0.55
        morph[level]!.set(start, level === maxLevel ? 1e9 + 1 : end * 0.97)
      }
    },
    update(camera) {
      viewer.setFromMatrixPosition(camera.matrixWorld)
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      frustum.setFromProjectionMatrix(projection, camera.coordinateSystem)
      stats.candidateNodes = 0
      stats.culledNodes = 0
      stats.sceneTriangles = 0
      stats.drawnTriangles = 0
      full.mesh.count = 0
      quad.mesh.count = 0
      select(maxLevel, 0, 0)
      full.info.needsUpdate = true
      quad.info.needsUpdate = true
      full.info.clearUpdateRanges()
      full.info.addUpdateRange(0, full.mesh.count * 4)
      quad.info.clearUpdateRanges()
      quad.info.addUpdateRange(0, quad.mesh.count * 4)
      stats.nodes = full.mesh.count + quad.mesh.count
    },
    heightAt: (x, z) => terrainHeightAt(sources, x, z),
    dispose() {
      for (const mesh of [full.mesh, quad.mesh]) { mesh.geometry.dispose(); mesh.dispose() }
      material.dispose()
    },
  }
}
