import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions'
import { center, dedup, flatten, getBounds, join, listTextureSlots, meshopt, prune, simplify, weld } from '@gltf-transform/functions'
import { encodeToKTX2 } from 'ktx2-encoder'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = path.join(root, 'assets/props')
const API = 'https://api.polyhaven.com'

const SMALL = { triangles: 3000, maps: { color: 512, normal: 512, orm: 256 } }
const MEDIUM = { triangles: 5000, maps: { color: 1024, normal: 512, orm: 512 } }
const LARGE = { triangles: 9000, maps: { color: 1024, normal: 512, orm: 512 } }

const PROPS = {
  'crate': { id: 'wooden_crate_02', ...MEDIUM },
  'military-crate': { id: 'old_military_crate', ...LARGE },
  'cardboard-box': { id: 'cardboard_box_01', ...SMALL },
  'oil-drum': { id: 'Barrel_01', ...MEDIUM },
  'plastic-drum': { id: 'Barrel_02', ...MEDIUM },
  'fuel-drum': { id: 'barrel_03', ...MEDIUM },
  'plastic-crate': { id: 'plastic_crate_02', ...SMALL },
  'tote': { id: 'industrial_pastic_container', ...SMALL },
  'jerrycan': { id: 'metal_jerrycan_green', ...SMALL },
  'gas-bottle': { id: 'propane_tank', ...SMALL },
  'cement-bag': { id: 'cement_bag', ...SMALL },
  'trash-cans': { id: 'metal_trash_can', ...LARGE },
  'rack': { id: 'worn_metal_rack', ...LARGE },
  'shelving': { id: 'steel_frame_shelves_01', ...MEDIUM },
  'office-desk': { id: 'metal_office_desk', ...LARGE },
  'dresser': { id: 'WoodenTable_03', ...MEDIUM },
  'school-desk': { id: 'SchoolDesk_01', ...MEDIUM },
  'school-chair': { id: 'SchoolChair_01', ...MEDIUM },
  'monobloc-chair': { id: 'plastic_monobloc_chair_01', ...MEDIUM },
  'wooden-chair': { id: 'painted_wooden_chair_01', ...MEDIUM },
  'cabinet': { id: 'painted_wooden_cabinet', ...MEDIUM },
  'extinguisher': { id: 'korean_fire_extinguisher_01', ...SMALL },
  'toolbox': { id: 'metal_toolbox', ...SMALL },
  'vise': { id: 'bench_vice_01', ...SMALL },
  'tyre': { id: 'old_tyre', ...SMALL },
  'step-ladder': { id: 'wooden_ladder_02', ...LARGE },
  'fuse-box': { id: 'power_box_01', ...SMALL },
  'breaker-box': { id: 'utility_box_01', ...MEDIUM },
  'can': { id: 'can_rusted', ...SMALL, triangles: 1200 },
  'television': { id: 'Television_01', ...SMALL },
  'generator': { id: 'portable_generator', ...LARGE },
  'road-barrier': { id: 'concrete_road_barrier_02', ...LARGE },
}

const KEEP = new Set(['KHR_texture_transform', 'KHR_mesh_quantization', 'EXT_meshopt_compression', 'KHR_texture_basisu'])

const args = process.argv.slice(2)
const option = name => {
  const at = args.indexOf(name)
  return at < 0 ? undefined : args.splice(at, 2)[1]
}
const cache = option('--cache')
const only = args.length ? args : Object.keys(PROPS)
for (const name of only) if (!PROPS[name]) throw new Error(`unknown prop ${name}`)

const work = cache ? path.resolve(cache) : await mkdtemp(path.join(tmpdir(), 'look-props-'))
const json = async url => {
  const response = await fetch(url, { headers: { 'user-agent': 'blacksite-look-props' } })
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  return response.json()
}
const exists = file => stat(file).then(() => true, () => false)

async function download(id) {
  const files = await json(`${API}/files/${id}`)
  const gltf = files.gltf?.['1k']?.gltf
  if (!gltf) throw new Error(`${id}: no 1k glTF`)
  const dir = path.join(work, id)
  const entries = [[`${id}.gltf`, gltf], ...Object.entries(gltf.include ?? {})]
  for (const [relative, file] of entries) {
    const target = path.resolve(dir, relative)
    if (!target.startsWith(dir + path.sep)) throw new Error(`${id}: unsafe path ${relative}`)
    if (await exists(target) && (await stat(target)).size === file.size) continue
    await mkdir(path.dirname(target), { recursive: true })
    const response = await fetch(file.url)
    if (!response.ok) throw new Error(`${file.url}: ${response.status}`)
    await writeFile(target, new Uint8Array(await response.arrayBuffer()))
  }
  return path.join(dir, `${id}.gltf`)
}

const triangles = document => document.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives()).reduce((sum, primitive) => sum + (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION').getCount()) / 3, 0)

async function encode(image, size, kind) {
  const { data, info } = await sharp(image).resize(size, size, { fit: 'fill', kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const color = kind === 'color'
  return await encodeToKTX2(new Uint8Array(0), {
    imageDecoder: async () => ({ width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }),
    isUASTC: kind === 'normal',
    qualityLevel: color ? 192 : 160,
    compressionLevel: 2,
    needSupercompression: true,
    enableRDO: kind === 'normal',
    rdoQualityLevel: 1.5,
    uastcLDRQualityLevel: 2,
    generateMipmap: true,
    isPerceptual: color,
    isSetKTX2SRGBTransferFunc: color,
    isNormalMap: kind === 'normal',
    enableDebug: false,
  })
}

async function textures(document, maps) {
  document.createExtension(KHRTextureBasisu).setRequired(true)
  for (const texture of document.getRoot().listTextures()) {
    const slots = listTextureSlots(texture)
    const kind = slots.some(slot => slot.startsWith('normal')) ? 'normal' : slots.some(slot => slot.startsWith('baseColor') || slot.startsWith('emissive')) ? 'color' : 'orm'
    const image = texture.getImage()
    const { width = maps[kind], height = maps[kind] } = await sharp(image).metadata()
    const size = Math.min(maps[kind], 2 ** Math.round(Math.log2(Math.max(width, height))))
    texture.setImage(await encode(image, size, kind)).setMimeType('image/ktx2').setURI(`${texture.getName() || kind}.ktx2`)
  }
}

const round = value => Math.round(value * 1000) / 1000

const scene = document => document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0]
const extent = document => {
  const { min, max } = getBounds(scene(document))
  return Math.max(...max.map((value, axis) => value - min[axis]))
}

async function convert(name, spec, io, listed) {
  const source = await download(spec.id)
  const document = await io.read(source)
  for (const extension of document.getRoot().listExtensionsUsed()) if (!KEEP.has(extension.extensionName)) extension.dispose()
  for (const node of document.getRoot().listNodes()) node.setSkin(null)
  for (const property of [...document.getRoot().listSkins(), ...document.getRoot().listAnimations()]) property.dispose()
  for (const primitive of document.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives())) for (const semantic of primitive.listSemantics()) if (/^(JOINTS|WEIGHTS)_/.test(semantic)) primitive.setAttribute(semantic, null)
  for (const material of document.getRoot().listMaterials()) {
    const orm = material.getMetallicRoughnessTexture()
    if (orm && !material.getOcclusionTexture() && /_arm[_.]/.test(orm.getURI())) material.setOcclusionTexture(orm)
  }
  await document.transform(dedup(), flatten(), join({ keepNamed: false }), weld())
  const before = triangles(document)
  let error = 0.004
  while (triangles(document) > spec.triangles && error < 0.5) {
    await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.02, spec.triangles / triangles(document)), error, lockBorder: false }))
    error *= 2
  }
  await document.transform(center({ pivot: 'below' }), prune(), dedup())
  const factor = listed / extent(document)
  if (Math.abs(factor - 1) > 0.1) {
    for (const node of scene(document).listChildren()) node.setScale(node.getScale().map(value => value * factor)).setTranslation(node.getTranslation().map(value => value * factor))
    await document.transform(center({ pivot: 'below' }))
    process.stderr.write(`${name}: rescaled by ${factor.toFixed(4)} to match the listed ${listed.toFixed(3)} m\n`)
  }
  const bounds = getBounds(scene(document))
  await textures(document, spec.maps)
  await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  const file = path.join(out, `${name}.glb`)
  const bytes = await io.writeBinary(document)
  await writeFile(file, bytes)
  const min = bounds.min.map(round)
  const max = bounds.max.map(round)
  return { id: spec.id, min, max, triangles: triangles(document), source: before, bytes: bytes.byteLength, materials: document.getRoot().listMaterials().length }
}

await MeshoptEncoder.ready
await MeshoptSimplifier.ready
const io = new NodeIO(fetch).registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
await mkdir(out, { recursive: true })
const manifest = path.join(out, 'props.json')
const previous = await readFile(manifest, 'utf8').then(JSON.parse, () => ({}))
const entries = {}
for (const [name, spec] of Object.entries(PROPS)) {
  if (!only.includes(name)) { if (previous[name]) entries[name] = previous[name]; continue }
  const info = await json(`${API}/info/${spec.id}`)
  const result = await convert(name, spec, io, Math.max(...info.dimensions) / 1000)
  entries[name] = { ...result, title: info.name, authors: Object.keys(info.authors), url: `https://polyhaven.com/a/${spec.id}`, license: 'CC0-1.0' }
  process.stderr.write(`${name}: ${result.source} -> ${result.triangles} triangles, ${(result.bytes / 1024).toFixed(0)} KB\n`)
  await writeFile(manifest, `${JSON.stringify({ ...previous, ...entries }, null, 2)}\n`)
}
await writeFile(manifest, `${JSON.stringify(entries, null, 2)}\n`)

const names = Object.keys(entries)
const id = name => name.replace(/-(\w)/g, (_, letter) => letter.toUpperCase())
const vec = values => `[${values.join(', ')}]`
const body = names.map(name => {
  const entry = entries[name]
  const size = entry.max.map((value, axis) => round(value - entry.min[axis]))
  return `  '${name}': { url: ${id(name)}, title: ${JSON.stringify(entry.title)}, min: ${vec(entry.min)}, max: ${vec(entry.max)}, size: ${vec(size)}, footprint: ${vec([size[0], size[2]])}, triangles: ${entry.triangles} },`
})
await writeFile(path.join(root, 'src/world/catalog.ts'), `${names.map(name => `import ${id(name)} from '../../assets/props/${name}.glb?url'`).join('\n')}\n\nexport const CATALOG = {\n${body.join('\n')}\n} as const\n`)

const table = names.map(name => {
  const entry = entries[name]
  return `| \`${name}.glb\` | [${entry.title}](${entry.url}) | \`${entry.id}\` | ${entry.authors.join(', ')} |`
})
await writeFile(path.join(out, 'CREDITS.md'), `# Prop credits\n\nEvery prop is a photoscanned model from [Poly Haven](https://polyhaven.com/models), released under [CC0 1.0](https://polyhaven.com/license). \`scripts/fetch-props.mjs\` downloads the 1k glTF, welds and simplifies the mesh, rests it on the origin, encodes its textures as KTX2 (ETC1S colour and ORM, UASTC normals) and compresses it with meshopt. Rigs and animations are dropped, so every prop is a static pose. Sizes are in metres and match the dimensions Poly Haven lists; `shelving` was authored at ten times that and is scaled down.\n\n| File | Model | Poly Haven id | Author |\n| --- | --- | --- | --- |\n${table.join('\n')}\n`)
if (!cache) await rm(work, { recursive: true, force: true })
const total = Object.values(entries).reduce((sum, entry) => sum + entry.bytes, 0)
process.stderr.write(`Wrote ${names.length} props, ${(total / 1048576).toFixed(2)} MB\n`)
