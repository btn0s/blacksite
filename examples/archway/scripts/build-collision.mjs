import { open, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Matrix4, Vector3 } from 'three'
import { tsImport } from 'tsx/esm/api'

export async function buildCourtyardCollision(root, manifest) {
  const { parseMeshletAsset, meshletPosition, meshletIndex } = await tsImport('../../../packages/geometry/src/load.ts', import.meta.url)
  const cache = new Map()
  const destination = join(root, manifest.colliderUrl)
  const partial = `${destination}.partial`
  const output = await open(partial, 'w')
  const write = array => output.writeFile(Buffer.from(array.buffer, array.byteOffset, array.byteLength))
  let triangles = 0
  let largest = 0
  try {
    await write(new Uint32Array([0x434c5342, 1, manifest.placements.length, 0]))
    for (const placement of manifest.placements) {
      if (!cache.has(placement.geometry)) {
        const bytes = await readFile(join(root, manifest.geometries[placement.geometry].url))
        const asset = parseMeshletAsset(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
        const clusters = []
        let vertices = 0, corners = 0
        for (let cluster = 0; cluster < asset.metadata.clusterCount; cluster++) {
          if (asset.clusterLod[cluster * 12 + 8] > 0.025 || asset.clusterLod[cluster * 12 + 9] <= 0.025) continue
          clusters.push(cluster)
          vertices += asset.clusterData[cluster * 8 + 6]
          corners += asset.clusterData[cluster * 8 + 1]
        }
        const positions = new Float32Array(vertices * 3), indices = new Uint32Array(corners)
        let vertexOffset = 0, indexOffset = 0
        for (const cluster of clusters) {
          for (let vertex = 0; vertex < asset.clusterData[cluster * 8 + 6]; vertex++) positions.set(meshletPosition(asset, cluster, vertex), (vertexOffset + vertex) * 3)
          for (let corner = 0; corner < asset.clusterData[cluster * 8 + 1]; corner++) indices[indexOffset++] = vertexOffset + meshletIndex(asset, cluster, corner)
          vertexOffset += asset.clusterData[cluster * 8 + 6]
        }
        cache.set(placement.geometry, { positions, indices })
      }
      const source = cache.get(placement.geometry)
      const positions = new Float32Array(source.positions.length), indices = source.indices.slice()
      const matrix = new Matrix4().fromArray(placement.matrix), point = new Vector3()
      for (let i = 0; i < positions.length; i += 3) point.fromArray(source.positions, i).applyMatrix4(matrix).toArray(positions, i)
      if (matrix.determinant() < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]]
      await write(new Uint32Array([positions.length, indices.length]))
      await write(positions)
      await write(indices)
      triangles += indices.length / 3
      largest = Math.max(largest, indices.length / 3)
    }
  } finally {
    await output.close()
  }
  await rename(partial, destination)
  console.log(JSON.stringify({ colliders: manifest.placements.length, collisionTriangles: triangles, largestColliderTriangles: largest }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const file = resolve(process.argv[2])
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.colliderUrl = manifest.colliderUrl.replace(/[^/]+$/, 'colliders.bin')
  await buildCourtyardCollision(dirname(file), manifest)
  await writeFile(`${file}.partial`, JSON.stringify(manifest))
  await rename(`${file}.partial`, file)
}
