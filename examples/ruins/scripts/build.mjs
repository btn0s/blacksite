import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { buildGltfPages } from '../../../packages/geometry/scripts/build.mjs'
import { buildLevelDirectory, conservativeScale } from './directory.mjs'

const source = resolve(process.argv[2] ?? 'D:/Archive/dark-ruins-export')
if (!process.argv[3]) throw new Error('Supply a new immutable owned build directory')
const output = resolve(process.argv[3])
const minimumWorldError = Number(process.argv[4] ?? 0.005)
if (!(minimumWorldError > 0) || !Number.isFinite(minimumWorldError)) throw new Error('World error must be finite and positive')
const json = async name => JSON.parse(await readFile(join(source, `${name}.json`), 'utf8'))
const [placementExport, meshExport, materialExport, summary] = await Promise.all(['placements', 'meshes', 'materials', 'summary'].map(json))
const instances = placementExport.instances, meshes = meshExport.meshes, materials = materialExport.materials
const groups = new Map()
const visible = instance => instance.visible && !instance.hidden_in_game && !instance.actor_hidden_in_game && !instance.actor_editor_only && !instance.component_editor_only
for (const [placement, instance] of instances.entries()) {
  const id = `${instance.geometry.file}:${instance.geometry.mesh_index}`
  if (!groups.has(id)) groups.set(id, { id, file: instance.geometry.file, meshIndex: instance.geometry.mesh_index, maxScale: 0, placements: [], sourceMeshes: new Set() })
  const group = groups.get(id)
  group.maxScale = Math.max(group.maxScale, conservativeScale(instance.transform.matrix))
  group.placements.push(placement)
  group.sourceMeshes.add(instance.mesh)
}
const uses = new Map()
for (const group of groups.values()) {
  const document = JSON.parse(await readFile(join(source, group.file), 'utf8'))
  group.primitives = document.meshes[group.meshIndex].primitives.map(primitive => ({ triangles: document.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3 }))
  group.sourceTriangles = group.primitives.reduce((sum, primitive) => sum + primitive.triangles, 0)
  for (const placement of group.placements) {
    const instance = instances[placement], slots = meshes[instance.mesh].primitive_material_slots
    for (const [primitive, sourcePrimitive] of group.primitives.entries()) {
      const path = instance.materials[slots[primitive]]
      if (!path || !materials[path]) throw new Error(`Missing active surface: ${group.id}, placement ${placement}, primitive ${primitive}`)
      if (!uses.has(path)) uses.set(path, { path, parent: materials[path].properties.parent ?? null, uses: [], placements: 0, visiblePlacements: 0, placedTriangles: 0, visibleTriangles: 0 })
      const use = uses.get(path)
      use.uses.push({ placement, geometry: group.id, primitive, slot: slots[primitive], triangles: sourcePrimitive.triangles, visible: visible(instance) })
      use.placedTriangles += sourcePrimitive.triangles
      if (visible(instance)) use.visibleTriangles += sourcePrimitive.triangles
    }
  }
}
for (const use of uses.values()) {
  use.placements = new Set(use.uses.map(item => item.placement)).size
  use.visiblePlacements = new Set(use.uses.filter(item => item.visible).map(item => item.placement)).size
  const parent = use.parent ?? ''
  use.reason = parent.includes('/Candles_FX/') ? 'Flame FX' : parent.includes('/FogCards/') ? 'Fog card FX' : parent.includes('/Fog/Local/') ? 'Volumetric fog FX' : null
  use.family = use.reason ? 'excluded' : parent.endsWith('/M_MS_CustomGeneral.M_MS_CustomGeneral') ? 'custom-general' : parent.endsWith('/M_Smart_Master_02.M_Smart_Master_02') ? 'smart-layers' : parent.endsWith('/M_Candle.M_Candle') ? 'candle' : parent.endsWith('/M_SimpleORM.M_SimpleORM') ? 'simple-orm' : 'untranslated'
  if (use.family === 'untranslated') use.reason = 'No authored material translation'
}
await mkdir(output)
await mkdir(join(output, 'geometry'))
const unsupported = [...uses.values()].filter(use => use.family === 'untranslated' || use.family === 'excluded')
await writeFile(join(output, 'surfaces.json'), JSON.stringify({ version: 4, surfaces: [...uses.values()], unsupported, omittedGeometry: summary.not_exported_as_geometry, unbakedEffects: ['Runtime material animation', 'Displacement and world-position offsets', 'Other authored shader effects'] }))
const geometries = []
const totals = { sourceTriangles: 0, residentTriangles: 0, clusters: 0, groups: 0, nodes: 0, pages: 0, uniquePayloadBytes: 0, payloadBytes: 0, packBytes: 0, directoryGpuBytes: 0, directoryWireBytes: 0, duplicatedVertices: 0, duplicatedVertexBytes: 0, pageHeaderBytes: 0, alignmentBytes: 0, arenaBytes: 0, arenaSlackBytes: 0, pinnedPages: 0, pinnedPayloadBytes: 0, pinnedWireBytes: 0, pinnedArenaBytes: 0, coarseClusters: 0, coarseTriangles: 0 }
for (const group of [...groups.values()].sort((a, b) => a.sourceTriangles - b.sourceTriangles || a.id.localeCompare(b.id))) {
  const name = createHash('sha256').update(group.id).digest('hex').slice(0, 16)
  const url = `geometry/${name}.directory`
  const minimumError = minimumWorldError / group.maxScale
  const { metadata: m, verification: verified } = await buildGltfPages(join(source, group.file), group.meshIndex, join(output, url), { minimumError })
  if (m.sourceTriangles !== group.sourceTriangles) throw new Error(`Source triangle mismatch: ${group.id}`)
  const primitiveSlots = [...group.sourceMeshes].map(mesh => meshes[mesh].primitive_material_slots)
  if (primitiveSlots.some(slots => JSON.stringify(slots) !== JSON.stringify(primitiveSlots[0]))) throw new Error(`Inconsistent primitive slot maps: ${group.id}`)
  geometries.push({ id: group.id, url, sha256: verified.sha256, packSha256: verified.packSha256, maxScale: group.maxScale, placements: group.placements, primitiveSlots: primitiveSlots[0], metadata: m })
  const additions = { sourceTriangles: m.sourceTriangles, residentTriangles: m.residentTriangles, clusters: m.clusterCount, groups: m.groupCount, nodes: m.nodeCount, pages: m.pageCount, uniquePayloadBytes: m.uniquePayloadBytes, payloadBytes: m.payloadBytes, packBytes: m.packBytes, directoryGpuBytes: verified.gpuBytes, directoryWireBytes: verified.bytes, duplicatedVertices: m.pageVertices - m.residentVertices, duplicatedVertexBytes: (m.pageVertices - m.residentVertices) * m.vertexStride, pageHeaderBytes: m.pageCount * 64, alignmentBytes: m.alignmentBytes, arenaBytes: m.pageCount * 131072, arenaSlackBytes: m.pageCount * 131072 - m.packBytes, pinnedPages: m.pinnedPages, pinnedPayloadBytes: m.coarsePayloadBytes, pinnedWireBytes: m.pinnedWireBytes, pinnedArenaBytes: m.pinnedPages * 131072, coarseClusters: m.coarseClusters, coarseTriangles: m.coarseTriangles }
  for (const [name, value] of Object.entries(additions)) totals[name] += value
  await writeFile(join(output, 'build-progress.json'), JSON.stringify({ built: geometries.length, total: groups.size, minimumWorldError, totals }))
  console.log(JSON.stringify({ built: geometries.length, total: groups.size, totals }))
}
const level = await buildLevelDirectory(output, geometries, instances, meshes, [...uses.keys()])
const census = { version: 4, minimumWorldError, source, geometries: geometries.length, sourceMeshAssets: new Set(instances.map(instance => instance.mesh)).size, placements: instances.length, visiblePlacements: instances.filter(visible).length, totals, directory: level.bytes, coarse: level.coarse, surfaces: { active: uses.size, supported: uses.size - unsupported.length, untranslated: unsupported.filter(use => use.family === 'untranslated').length, excluded: unsupported.filter(use => use.family === 'excluded').length, unsupported: unsupported.map(({ uses, ...use }) => use), omittedGeometry: summary.not_exported_as_geometry }, contract: { maxGroupClusters: Math.max(...geometries.map(g => g.metadata.maxGroupClusters)), maxGroupBytes: Math.max(...geometries.map(g => g.metadata.maxGroupBytes)), maxClusterVertices: Math.max(...geometries.map(g => g.metadata.maxClusterVertices)), maxClusterTriangles: Math.max(...geometries.map(g => g.metadata.maxClusterTriangles)) } }
if (census.geometries !== groups.size || totals.sourceTriangles !== [...groups.values()].reduce((sum, group) => sum + group.sourceTriangles, 0) || totals.payloadBytes !== totals.uniquePayloadBytes + totals.duplicatedVertexBytes || totals.packBytes !== totals.payloadBytes + totals.pageHeaderBytes + totals.alignmentBytes) throw new Error('Whole-level census accounting mismatch')
await writeFile(join(output, 'environment.json'), JSON.stringify(await json('environment')))
await writeFile(join(output, 'census.json'), JSON.stringify(census, null, 2))
await writeFile(join(output, 'level.json'), JSON.stringify({ version: 4, minimumWorldError, directory: 'level.directory', census: 'census.json', surfaces: 'surfaces.json', environment: 'environment.json', materialPaths: [...uses.keys()], geometries }))
console.log(JSON.stringify(census, null, 2))
