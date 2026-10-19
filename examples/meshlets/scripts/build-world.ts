import { mkdir, realpath, rename } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PlaneGeometry } from 'three/webgpu'
import { buildGltfMeshes, buildMeshletGeometry } from '@blacksite/geometry/build'
import { createTerrainSurface } from '../src/terrain'

const sandbox = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const owned = await realpath(resolve(sandbox, 'public/owned'))
const output = resolve(owned, 'geometry')
const families = ['sedge', 'grass', 'yucca', 'sandstone-rock', 'island-tree-02', 'coast-rocks']
await mkdir(output, { recursive: true })
const terrain = createTerrainSurface()
const surface = terrain.geometry
const positions = surface.getAttribute('position').array
const uvs = new Float32Array(positions.length / 3 * 2)
for (let i = 0; i < positions.length / 3; i++) uvs.set([positions[i * 3]! / 2, positions[i * 3 + 2]! / 2], i * 2)
await buildMeshletGeometry({
  name: 'Coastal terrain', positions, normals: surface.getAttribute('normal').array,
  uvs, indices: surface.index!.array,
}, resolve(output, 'terrain.meshlets.pending'))
await rename(resolve(output, 'terrain.meshlets.pending'), resolve(output, 'terrain.meshlets'))
console.log(JSON.stringify({ terrainTriangles: surface.index!.count / 3, output }))
surface.dispose()
const ocean = new PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2)
await buildMeshletGeometry({
  name: 'Tidal ocean', positions: ocean.getAttribute('position').array,
  normals: ocean.getAttribute('normal').array, uvs: ocean.getAttribute('uv').array,
  indices: ocean.index!.array,
}, resolve(output, 'ocean.meshlets'))
ocean.dispose()
await buildGltfMeshes(resolve(owned, 'modular-fort.glb'), resolve(output, 'fort'))
for (const family of families) await buildGltfMeshes(resolve(owned, `${family}.glb`), resolve(output, family))
