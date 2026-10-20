import { readFile, mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises'
import { basename, resolve, join } from 'node:path'
import { Box3, Matrix4, Vector3 } from 'three'
import { buildGltfMeshes } from '../../../packages/geometry/scripts/build.mjs'
import { buildScanMaterials } from '../../shared/build-scan-materials.mjs'
import { buildCourtyardCollision } from './build-collision.mjs'
import { tsImport } from 'tsx/esm/api'

const source = resolve(process.argv[2] ?? 'D:/Archive/dark-ruins-export')
const outputRoot = resolve(process.argv[3] ?? 'D:/dev/owned-assets/dark-ruins')
await mkdir(outputRoot, { recursive: true })
const output = await mkdtemp(join(outputRoot, 'build-'))
const generation = basename(output)
const materialSource = resolve(process.argv[4] ?? 'D:/dev/owned-assets/dark-ruins-source/materials.json')
const json = async file => JSON.parse(await readFile(join(source, file), 'utf8'))
const meshes = (await json('meshes.json')).meshes
const instances = (await json('placements.json')).instances
const anchor = instances.find(entry => entry.mesh_name === 'SM_ArchWay_01_N1' && entry.transform.matrix.slice(12, 15).every(value => value === 0))
if (!anchor) throw new Error('The origin archway placement is required')
const localBounds = new Map()
async function placementBounds(entry) {
  const id = `${entry.geometry.file}:${entry.geometry.mesh_index}`
  if (!localBounds.has(id)) {
    const document = await json(entry.geometry.file)
    const bounds = new Box3()
    for (const primitive of document.meshes[entry.geometry.mesh_index].primitives) {
      const position = document.accessors[primitive.attributes.POSITION]
      if (!position.min || !position.max) throw new Error(`Missing source bounds for ${entry.actor_label}`)
      bounds.expandByPoint(new Vector3().fromArray(position.min))
      bounds.expandByPoint(new Vector3().fromArray(position.max))
    }
    localBounds.set(id, bounds)
  }
  return localBounds.get(id).clone().applyMatrix4(new Matrix4().fromArray(entry.transform.matrix))
}
const anchorBounds = await placementBounds(anchor)
const centre = anchorBounds.getCenter(new Vector3())
centre.y = anchorBounds.min.y
const placements = []
for (const entry of instances) if ((await placementBounds(entry)).distanceToPoint(centre) <= 10) placements.push(entry)
console.log(JSON.stringify({ centre: centre.toArray(), radius: 10, placements: placements.length, uniqueGeometry: new Set(placements.map(entry => `${entry.geometry.file}:${entry.geometry.mesh_index}`)).size }))
const geometrySources = [...new Set(placements.map(entry => entry.geometry.file))]
const { parseMeshletAsset } = await tsImport('../../../packages/geometry/src/load.ts', import.meta.url)
await mkdir(output, { recursive: true })
const geometries = []
for (const file of geometrySources) {
  const id = geometries.length
  const directory = join(output, 'geometry', String(id))
  const manifest = await buildGltfMeshes(join(source, file), directory)
  for (const geometry of manifest.geometries) {
    if (!placements.some(entry => entry.geometry.file === file && entry.geometry.mesh_index === geometry.meshIndex)) continue
    const url = `geometry/${id}/${geometry.url}`
    const bytes = await readFile(join(output, url))
    const asset = parseMeshletAsset(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    geometries.push({ file, meshIndex: geometry.meshIndex, url, metadata: asset.metadata, bytes: bytes.byteLength })
  }
}
const materialExport = (await json('materials.json')).materials
const textures = (await json('textures.json')).textures
const approved = JSON.parse(await readFile(materialSource, 'utf8')).surfaces[0]
const materialPaths = [...new Set(placements.flatMap(entry => entry.materials))]
const surfaces = [], untranslated = []
for (const path of materialPaths) {
  const material = materialExport[path]
  if (material.properties.parent !== approved.parent) {
    untranslated.push({ path, parent: material.properties.parent ?? null, placements: placements.filter(entry => entry.materials.includes(path)).map(entry => entry.actor_label) })
    continue
  }
  const maps = {}
  for (const name of ['Albedo', 'Normal', 'Packed', 'Metalness', 'RGBNoise']) {
    if (name === 'RGBNoise') { maps[name] = { ...approved.maps[name], file: resolve(materialSource, '..', approved.maps[name].file) }; continue }
    const texture = textures[material.parameters.texture[name]]
    if (!texture?.success || texture.files.length !== 1) throw new Error(`Missing source image for ${path}: ${name}`)
    maps[name] = { file: join(source, texture.files[0]), srgb: texture.srgb }
  }
  surfaces.push({ family: approved.family, path, parent: material.properties.parent, parameters: material.parameters, channels: approved.channels, maps })
}
const descriptor = join(output, 'material-source.json')
await writeFile(descriptor, JSON.stringify({ version: 1, surfaces }))
await buildScanMaterials(descriptor, output)
const environment = await json('environment.json')
const manifest = {
  radius: 10, centre: centre.toArray(), geometries: geometries.map(geometry => ({ ...geometry, url: `${generation}/${geometry.url}` })), materialPaths, untranslated,
  surfacesUrl: `${generation}/surfaces.json`, colliderUrl: `${generation}/colliders.bin`,
  placements: placements.map(entry => ({ name: entry.actor_label, visible: entry.visible && !entry.hidden_in_game && !entry.actor_hidden_in_game && !entry.actor_editor_only && !entry.component_editor_only, componentClass: entry.component_class, geometry: geometries.findIndex(geometry => geometry.file === entry.geometry.file && geometry.meshIndex === entry.geometry.mesh_index), materials: meshes[entry.mesh].primitive_material_slots.map(slot => entry.materials[slot] ?? meshes[entry.mesh].materials[slot]), matrix: entry.transform.matrix })),
  environment: environment.components.filter(entry => ['DirectionalLightComponent', 'SkyAtmosphereComponent', 'SkyLightComponent', 'ExponentialHeightFogComponent'].includes(entry.class)),
}
await buildCourtyardCollision(outputRoot, manifest)
const publication = join(outputRoot, `${generation}.partial`)
await writeFile(publication, JSON.stringify(manifest))
await rename(publication, join(outputRoot, 'courtyard.json'))
console.log(JSON.stringify({ placements: placements.length, uniqueMeshes: geometries.length, sourceTriangles: geometries.reduce((sum, geometry) => sum + geometry.metadata.sourceTriangles, 0), meshlets: geometries.reduce((sum, geometry) => sum + geometry.metadata.clusterCount, 0), geometryBytes: geometries.reduce((sum, geometry) => sum + geometry.bytes, 0), untranslated }, null, 2))
