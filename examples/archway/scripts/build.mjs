import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import sharp from 'sharp'
import { FloatType } from 'three'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { buildGltfMeshes } from '../../../packages/geometry/scripts/build.mjs'
import { tsImport } from 'tsx/esm/api'

const source = resolve(process.argv[2] ?? 'D:/Archive/dark-ruins-export')
const output = resolve(process.argv[3] ?? 'D:/dev/owned-assets/dark-ruins')
const json = async file => JSON.parse(await readFile(join(source, file), 'utf8'))
const meshes = (await json('meshes.json')).meshes
const mesh = Object.values(meshes).find(entry => entry.name === 'SM_ArchWay_01_N1')
if (!mesh || mesh.triangles !== 7204387) throw new Error('The full source archway is required')
const placements = (await json('placements.json')).instances.filter(entry => entry.mesh === mesh.path && entry.visible && !entry.hidden_in_game)
if (!placements.length) throw new Error('The source archway has no visible placement')
const slots = placements[0].materials
if (placements.some(entry => JSON.stringify(entry.materials) !== JSON.stringify(slots))) throw new Error('Select a placement before building different material overrides')
const materials = (await json('materials.json')).materials
const textures = (await json('textures.json')).textures
await mkdir(output, { recursive: true })
const surfaces = []
for (const slot of mesh.primitive_material_slots) {
  const path = slots[slot]
  const material = materials[path]
  if (!material) throw new Error(`Missing source material ${path}`)
  const maps = {}
  for (const name of ['Albedo', 'Normal', 'Packed']) {
    const record = textures[material.parameters.texture[name]]
    if (!record?.success || record.files.length !== 1) throw new Error(`Missing source image ${name}`)
    const file = join(source, record.files[0])
    const destination = `${slot}-${name.toLowerCase()}.webp`
    if (name === 'Normal' && file.endsWith('.exr')) {
      const bytes = await readFile(file)
      const image = new EXRLoader().setDataType(FloatType).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const pixels = new Uint8Array(image.width * image.height * 4)
      for (let i = 0; i < pixels.length; i++) pixels[i] = Math.round(Math.max(0, Math.min(1, image.data[i])) * 255)
      await sharp(pixels, { raw: { width: image.width, height: image.height, channels: 4 } }).flip().webp({ lossless: true, effort: 6 }).toFile(join(output, destination))
    } else {
      await sharp(file).webp({ lossless: true, effort: 6 }).toFile(join(output, destination))
    }
    maps[name] = destination
  }
  surfaces.push({ path, parameters: material.parameters, maps })
}
await writeFile(join(output, 'surfaces.json'), JSON.stringify({ name: mesh.name, sourceTriangles: mesh.triangles, surfaces }, null, 2))
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
