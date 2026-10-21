import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const groundGrid = { cell: 2, originX: -512, originZ: -512, nx: 576, nz: 896 }
const walkable = 0.8

export async function rasterizeLevelGround(collisionDirectory) {
  const { cell, originX, originZ, nx, nz } = groundGrid
  const covered = new Uint8Array(nx * nz)
  const ground = new Float32Array(nx * nz).fill(Infinity)
  const low = new Float32Array(nx * nz).fill(Infinity)
  const index = JSON.parse(await readFile(join(collisionDirectory, 'collision.json'), 'utf8'))
  const inside = (value, minimum, maximum) => value < minimum ? minimum : value > maximum ? maximum : value
  let done = 0
  for (const chunk of index.chunks) {
    const bytes = await readFile(join(collisionDirectory, chunk.file))
    const words = new Uint32Array(bytes.buffer, bytes.byteOffset, 8)
    const vertices = new Float32Array(bytes.buffer, bytes.byteOffset + 32, words[2])
    const indices = new Uint32Array(bytes.buffer, bytes.byteOffset + 32 + words[2] * 4, words[3])
    for (let triangle = 0; triangle < indices.length; triangle += 3) {
      const a = indices[triangle] * 3, b = indices[triangle + 1] * 3, c = indices[triangle + 2] * 3
      const ax = vertices[a], ay = vertices[a + 1], az = vertices[a + 2]
      const bx = vertices[b], by = vertices[b + 1], bz = vertices[b + 2]
      const cx = vertices[c], cy = vertices[c + 1], cz = vertices[c + 2]
      const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx), minZ = Math.min(az, bz, cz), maxZ = Math.max(az, bz, cz)
      const i0 = Math.floor((minX - originX) / cell), i1 = Math.floor((maxX - originX) / cell)
      const j0 = Math.floor((minZ - originZ) / cell), j1 = Math.floor((maxZ - originZ) / cell)
      if (i1 < 0 || j1 < 0 || i0 >= nx || j0 >= nz) continue
      const lowest = Math.min(ay, by, cy)
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az
      const normalX = uy * vz - uz * vy, normalY = uz * vx - ux * vz, normalZ = ux * vy - uy * vx
      const length = Math.hypot(normalX, normalY, normalZ)
      const up = length > 0 ? Math.abs(normalY) / length : 0
      const small = i1 - i0 < 2 && j1 - j0 < 2
      for (let j = Math.max(0, j0); j <= Math.min(nz - 1, j1); j++) {
        for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) {
          const slot = j * nx + i
          covered[slot] = 1
          if (small) {
            if (lowest < low[slot]) low[slot] = lowest
            continue
          }
          const x = originX + (i + 0.5) * cell, z = originZ + (j + 0.5) * cell
          const determinant = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
          if (Math.abs(determinant) < 1e-9) continue
          const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / determinant
          const w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / determinant
          const w2 = 1 - w0 - w1
          if (w0 < 0 || w1 < 0 || w2 < 0) { if (lowest < low[slot] && up < walkable) low[slot] = lowest; continue }
          const height = w0 * ay + w1 * by + w2 * cy
          if (height < low[slot]) low[slot] = height
          if (up >= walkable && height < ground[slot]) ground[slot] = height
        }
      }
      if (small && up >= walkable) {
        const slot = inside(Math.floor(((ax + bx + cx) / 3 - originX) / cell), 0, nx - 1) + inside(Math.floor(((az + bz + cz) / 3 - originZ) / cell), 0, nz - 1) * nx
        const height = (ay + by + cy) / 3
        if (height < ground[slot]) ground[slot] = height
      }
    }
    if (++done % 5000 === 0) console.log(`level ground ${done}/${index.chunks.length}`)
  }
  return { ...groundGrid, covered, ground, low }
}
