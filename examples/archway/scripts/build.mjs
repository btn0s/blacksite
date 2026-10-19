import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { buildGltfMeshes } from '../../../packages/geometry/scripts/build.mjs'
import { buildScanMaterials } from '../../shared/build-scan-materials.mjs'
import { tsImport } from 'tsx/esm/api'

const source = resolve(process.argv[2] ?? 'D:/Archive/dark-ruins-export')
const output = resolve(process.argv[3] ?? 'D:/dev/owned-assets/dark-ruins')
const materialSource = resolve(process.argv[4] ?? 'D:/dev/owned-assets/dark-ruins-source/materials.json')
const json = async file => JSON.parse(await readFile(join(source, file), 'utf8'))
const meshes = (await json('meshes.json')).meshes
const mesh = Object.values(meshes).find(entry => entry.name === 'SM_ArchWay_01_N1')
if (!mesh || mesh.triangles !== 7204387) throw new Error('The full source archway is required')
const placements = (await json('placements.json')).instances.filter(entry => entry.mesh === mesh.path && entry.visible && !entry.hidden_in_game)
if (!placements.length) throw new Error('The source archway has no visible placement')
const slots = placements[0].materials
if (placements.some(entry => JSON.stringify(entry.materials) !== JSON.stringify(slots))) throw new Error('Select a placement before building different material overrides')
await mkdir(output, { recursive: true })
const surfaces = await buildScanMaterials(materialSource, output)
if (surfaces.length !== mesh.primitive_material_slots.length || surfaces.some((surface, index) => surface.path !== slots[mesh.primitive_material_slots[index]])) throw new Error('Material source order must match the visible placement primitive slots')
const manifest = await buildGltfMeshes(join(source, mesh.file), output)
const { parseMeshletAsset } = await tsImport('../../../packages/geometry/src/load.ts', import.meta.url)
const bytes = await readFile(join(output, manifest.geometries[0].url))
const asset = parseMeshletAsset(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
const remap = new Map()
const positions = []
const indices = []
for (let cluster = 0; cluster < asset.metadata.clusterCount; cluster++) {
  if (asset.clusterLod[cluster * 12 + 8] > 0.025 || asset.clusterLod[cluster * 12 + 9] <= 0.025) continue
  const offset = asset.clusterData[cluster * 8]
  const count = asset.clusterData[cluster * 8 + 1]
  for (let i = offset; i < offset + count; i++) {
    const source = asset.indices[i]
    if (!remap.has(source)) { remap.set(source, positions.length / 3); positions.push(...asset.positions.subarray(source * 3, source * 3 + 3)) }
    indices.push(remap.get(source))
  }
}
await writeFile(join(output, 'collider.json'), JSON.stringify({ errorMetres: 0.025, positions, indices }))
console.log(`Collision: ${indices.length / 3} triangles at 2.5 cm geometric error`)
