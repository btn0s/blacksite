import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const groundGrid = { cell: 2, originX: -513, originZ: -513, nx: 576, nz: 896 }
const walkable = 0.8
const facing = 0.02

export async function rasterizeLevelGround(collisionDirectory) {
  const { cell, originX, originZ, nx, nz } = groundGrid
  const count = nx * nz
  const low = new Float32Array(count).fill(Infinity)
  const top = new Float32Array(count).fill(Infinity)
  const topUp = new Float32Array(count)
  const index = JSON.parse(await readFile(join(collisionDirectory, 'collision.json'), 'utf8'))
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
      const i0 = Math.ceil((minX - originX) / cell - 0.5), i1 = Math.floor((maxX - originX) / cell - 0.5)
      const j0 = Math.ceil((minZ - originZ) / cell - 0.5), j1 = Math.floor((maxZ - originZ) / cell - 0.5)
      if (i1 < 0 || j1 < 0 || i0 >= nx || j0 >= nz) continue
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az
      const normalY = uz * vx - ux * vz
      const length = Math.hypot(uy * vz - uz * vy, normalY, ux * vy - uy * vx)
      if (length === 0) continue
      const up = normalY / length
      const determinant = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
      if (Math.abs(determinant) < 1e-9) continue
      for (let j = Math.max(0, j0); j <= Math.min(nz - 1, j1); j++) {
        for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) {
          const x = originX + (i + 0.5) * cell, z = originZ + (j + 0.5) * cell
          const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / determinant
          const w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / determinant
          const w2 = 1 - w0 - w1
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue
          const height = w0 * ay + w1 * by + w2 * cy
          const slot = j * nx + i
          if (height < low[slot]) low[slot] = height
          if (up > facing && height < top[slot]) { top[slot] = height; topUp[slot] = up }
        }
      }
    }
    if (++done % 5000 === 0) console.log(`level ground ${done}/${index.chunks.length}`)
  }
  return { ...groundGrid, low, top, topUp, walkable }
}
