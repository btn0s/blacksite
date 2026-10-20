import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { cloneDocument } from '@gltf-transform/functions'
import { MeshoptDecoder } from 'meshoptimizer'
import { Matrix3, Matrix4, Vector3 } from 'three'
import { packPageDirectory, readNativePages, verifyGeometryPages } from './pages.mjs'

const revision = 'f0a684f11ead064e176775c9b796f82a55910e92'
const archiveSha256 = '52cec854745cd6b39531e07161a2224778700bdc7c8f0e2d8bc8825efde8af1a'
const configuration = { deduplicate_vertices: 'exact', max_triangles: 128, min_triangles: 64, partition_size: 16, optimize_bounds: true, simplify_ratio: 0.5, simplify_error_merge_previous: 1, simplify_error_merge_additive: 1, simplify_permissive: true, simplify_fallback_sloppy: true, normal_weight: 0.5, protect_uv_seams: true }
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const sha256 = (data) => createHash('sha256').update(data).digest('hex')
const run = (command, args) => new Promise((resolvePromise, reject) => {
  const child = spawn(command, args, { stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`)))
})

let nativeBuilderPromise
const getNativeBuilder = () => nativeBuilderPromise ??= nativeBuilder()

async function nativeBuilder() {
  const cache = process.env.BLACKSITE_GEOMETRY_CACHE || join(tmpdir(), `blacksite-geometry-meshopt-${revision}`)
  await mkdir(cache, { recursive: true })
  const archive = join(cache, 'source.tar.gz')
  let archiveData
  try { archiveData = await readFile(archive) } catch {
    console.log('Downloading the pinned MIT geometry builder')
    const response = await fetch(`https://codeload.github.com/zeux/meshoptimizer/tar.gz/${revision}`)
    if (!response.ok) throw new Error(`Source download failed: ${response.status}`)
    archiveData = Buffer.from(await response.arrayBuffer())
  }
  if (sha256(archiveData) !== archiveSha256) throw new Error('Geometry builder archive checksum mismatch')
  await writeFile(archive, archiveData)
  await run('tar', ['-xzf', archive, '-C', cache, '--strip-components=1', `meshoptimizer-${revision}/src`, `meshoptimizer-${revision}/demo/clusterlod.h`, `meshoptimizer-${revision}/LICENSE.md`])
  const source = join(scriptDirectory, 'build-native.cpp')
  const compiler = process.env.CXX || (process.platform === 'win32' ? 'cl.exe' : 'c++')
  const identity = sha256(Buffer.concat([await readFile(source), Buffer.from(`${revision}:${compiler}:${process.platform}:${process.arch}`)])).slice(0, 16)
  const executable = join(cache, `build-${identity}${process.platform === 'win32' ? '.exe' : ''}`)
  try { await access(executable) } catch {
    console.log('Compiling the native cluster hierarchy builder')
    const files = (await readdir(join(cache, 'src'))).filter((name) => name.endsWith('.cpp')).sort().map((name) => join(cache, 'src', name))
    const args = /(^|[\\/])cl(\.exe)?$/i.test(compiler)
      ? ['/nologo', '/std:c++17', '/O2', '/DNDEBUG', '/EHsc', '/I', join(cache, 'src'), '/I', join(cache, 'demo'), source, ...files, `/Fe:${executable}`, `/Fo:${cache}\\`]
      : ['-std=c++17', '-O3', '-DNDEBUG', '-I', join(cache, 'src'), '-I', join(cache, 'demo'), source, ...files, '-o', executable]
    await run(compiler, args)
  }
  return executable
}

async function readGeometry(path) {
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  const document = await io.read(path)
  const root = document.getRoot()
  const scene = root.getDefaultScene() || root.listScenes()[0]
  if (!scene) throw new Error('The source has no scene')
  const entries = []
  scene.traverse((node) => {
    const mesh = node.getMesh()
    if (!mesh) return
    if (node.getSkin()) throw new Error('The geometry builder accepts static meshes only')
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() !== 4 || primitive.listTargets().length) throw new Error('The geometry builder accepts static triangle primitives only')
      const position = primitive.getAttribute('POSITION')
      if (!position) throw new Error('A primitive has no positions')
      entries.push({ primitive, matrix: new Matrix4().fromArray(node.getWorldMatrix()), count: position.getCount() })
    }
  })
  if (!entries.length) throw new Error('The source contains no mesh geometry')
  return geometryFromEntries(entries, root.listMaterials())
}

function geometryFromEntries(entries, materials) {
  const vertexCount = entries.reduce((sum, entry) => sum + entry.count, 0)
  const indexCount = entries.reduce((sum, entry) => sum + (entry.primitive.getIndices()?.getCount() ?? entry.count), 0)
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const secondaryUvs = entries.some(entry => entry.primitive.getAttribute('TEXCOORD_1')) ? new Float32Array(vertexCount * 2) : null
  const tangents = new Float32Array(vertexCount * 4)
  const colors = entries.some(entry => entry.primitive.getAttribute('COLOR_0')) ? new Float32Array(vertexCount * 4).fill(1) : null
  const sourceIndices = new Uint32Array(indexCount)
  const primitives = []
  let vertexOffset = 0
  let indexOffset = 0
  const point = new Vector3()
  const normalMatrix = new Matrix3()
  const tuple = []
  for (const { primitive, matrix, count } of entries) {
    const position = primitive.getAttribute('POSITION')
    const normal = primitive.getAttribute('NORMAL')
    const uv = primitive.getAttribute('TEXCOORD_0')
    const secondaryUv = primitive.getAttribute('TEXCOORD_1')
    const tangent = primitive.getAttribute('TANGENT')
    const color = primitive.getAttribute('COLOR_0')
    normalMatrix.getNormalMatrix(matrix)
    for (let i = 0; i < count; i++) {
      const global = vertexOffset + i
      position.getElement(i, tuple)
      point.fromArray(tuple).applyMatrix4(matrix)
      positions.set([point.x, point.y, point.z], global * 3)
      if (normal) {
        normal.getElement(i, tuple)
        point.fromArray(tuple).applyMatrix3(normalMatrix).normalize()
        normals.set([point.x, point.y, point.z], global * 3)
      }
      if (tangent) {
        tangent.getElement(i, tuple)
        point.fromArray(tuple).transformDirection(matrix)
        tangents.set([point.x, point.y, point.z, tuple[3] * Math.sign(matrix.determinant())], global * 4)
      }
      if (uv) {
        uv.getElement(i, tuple)
        uvs.set([tuple[0], tuple[1]], global * 2)
      }
      if (color) {
        color.getElement(i, tuple)
        colors.set([tuple[0], tuple[1], tuple[2], color.getElementSize() === 4 ? tuple[3] : 1], global * 4)
      }
      if (secondaryUv) {
        secondaryUv.getElement(i, tuple)
        secondaryUvs.set([tuple[0], tuple[1]], global * 2)
      }
    }
    const accessor = primitive.getIndices()
    const countIndices = accessor?.getCount() ?? count
    if (countIndices % 3) throw new Error('Triangle indices must be divisible by three')
    for (let i = 0; i < countIndices; i++) sourceIndices[indexOffset + i] = vertexOffset + (accessor ? accessor.getScalar(i) : i)
    if (matrix.determinant() < 0) for (let i = indexOffset; i < indexOffset + countIndices; i += 3) [sourceIndices[i + 1], sourceIndices[i + 2]] = [sourceIndices[i + 2], sourceIndices[i + 1]]
    if (!normal) {
      const a = new Vector3(), b = new Vector3(), c = new Vector3()
      for (let i = indexOffset; i < indexOffset + countIndices; i += 3) {
        const ids = [sourceIndices[i], sourceIndices[i + 1], sourceIndices[i + 2]]
        a.fromArray(positions, ids[0] * 3)
        b.fromArray(positions, ids[1] * 3).sub(a)
        c.fromArray(positions, ids[2] * 3).sub(a)
        b.cross(c)
        for (const id of ids) for (let axis = 0; axis < 3; axis++) normals[id * 3 + axis] += b.getComponent(axis)
      }
      for (let i = vertexOffset; i < vertexOffset + count; i++) {
        point.fromArray(normals, i * 3).normalize()
        normals.set([point.x, point.y, point.z], i * 3)
      }
    }
    primitives.push({ indexOffset, indexCount: countIndices, materialIndex: Math.max(0, materials.indexOf(primitive.getMaterial())) })
    vertexOffset += count
    indexOffset += countIndices
  }
  return {
    positions, normals, uvs, secondaryUvs, tangents, colors: colors?.some(value => value !== 1) ? colors : null, sourceIndices, primitives,
    materials: materials.map(describeMaterial),
  }
}

function pack(metadata, arrays) {
  const names = ['vertices', 'vertexReferences', 'indices', 'clusterData', 'clusterBounds', 'clusterLod', 'clusterQuantization', 'groupData', 'groupBounds', 'groupChildren', 'nodeData', 'nodeBounds']
  const json = Buffer.from(JSON.stringify(metadata))
  const metadataOffset = 32 + names.length * 16
  let offset = (metadataOffset + json.length + 15) & ~15
  const entries = names.map((name, id) => {
    const array = arrays[name]
    const entry = { id, offset, count: array.length, type: array instanceof Float32Array ? 0 : 1, array }
    offset += array.byteLength
    offset = (offset + 15) & ~15
    return entry
  })
  const output = Buffer.alloc(offset)
  ;[0x4c4d5342, 3, names.length, json.length, output.length, 0, 0, 0].forEach((value, i) => output.writeUInt32LE(value, i * 4))
  json.copy(output, metadataOffset)
  for (const { id, offset: start, count, type, array } of entries) {
    ;[id, start, count, type].forEach((value, i) => output.writeUInt32LE(value, 32 + id * 16 + i * 4))
    Buffer.from(array.buffer, array.byteOffset, array.byteLength).copy(output, start)
  }
  return output
}

function describeMaterial(material) {
  return { name: material.getName(), baseColor: material.getBaseColorFactor(), metalness: material.getMetallicFactor(), roughness: material.getRoughnessFactor(), doubleSided: material.getDoubleSided(), alphaMode: material.getAlphaMode(), alphaCutoff: material.getAlphaCutoff(), normalScale: material.getNormalScale() }
}

function prepareGeometry(input) {
  const positions = Float32Array.from(input.positions)
  const normals = Float32Array.from(input.normals)
  const uvs = Float32Array.from(input.uvs)
  const sourceIndices = Uint32Array.from(input.indices)
  const vertexCount = positions.length / 3
  const tangents = input.tangents ? Float32Array.from(input.tangents) : new Float32Array(vertexCount * 4)
  const colors = input.colors ? Float32Array.from(input.colors) : null
  const secondaryUvs = input.secondaryUvs ? Float32Array.from(input.secondaryUvs) : null
  if (secondaryUvs && (secondaryUvs.length !== vertexCount * 2 || !secondaryUvs.every(Number.isFinite))) throw new Error('Secondary UVs must be finite two-component values')
  if (colors && (colors.length !== vertexCount * 4 || !colors.every(value => Number.isFinite(value) && value >= 0 && value <= 1))) throw new Error('Geometry colors must be normalized four-component values')
  if (tangents.length !== vertexCount * 4 || !tangents.every(Number.isFinite)) throw new Error('Geometry tangents must be finite four-component values')
  if (!vertexCount || positions.length % 3 || normals.length !== positions.length || uvs.length !== vertexCount * 2 || sourceIndices.length % 3 || !sourceIndices.length) throw new Error('Geometry requires positions, normals, UVs and triangle indices')
  if (![positions, normals, uvs].every(array => array.every(Number.isFinite)) || sourceIndices.some(index => index >= vertexCount)) throw new Error('Geometry contains invalid vertex data')
  const materials = input.materials ?? [{ name: 'Surface', baseColor: [1, 1, 1, 1], metalness: 0, roughness: 1, doubleSided: false, alphaMode: 'OPAQUE', alphaCutoff: 0.5, normalScale: 1 }]
  const primitives = input.primitives ?? [{ indexOffset: 0, indexCount: sourceIndices.length, materialIndex: 0 }]
  let expected = 0
  for (const primitive of primitives) {
    if (primitive.indexOffset !== expected || primitive.indexCount <= 0 || primitive.indexCount % 3 || !Number.isInteger(primitive.materialIndex) || primitive.materialIndex < 0 || primitive.materialIndex >= materials.length) throw new Error('Geometry primitives must partition indices and reference a material')
    expected += primitive.indexCount
  }
  if (expected !== sourceIndices.length) throw new Error('Geometry primitive ranges do not cover the indices')
  const vertices = new Float32Array(vertexCount * 18)
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  for (let i = 0; i < vertexCount; i++) {
    vertices.set(positions.subarray(i * 3, i * 3 + 3), i * 18)
    vertices.set(normals.subarray(i * 3, i * 3 + 3), i * 18 + 3)
    vertices.set(uvs.subarray(i * 2, i * 2 + 2), i * 18 + 6)
    vertices.set(tangents.subarray(i * 4, i * 4 + 4), i * 18 + 8)
    vertices.set(colors ? colors.subarray(i * 4, i * 4 + 4) : [1, 1, 1, 1], i * 18 + 12)
    if (secondaryUvs) vertices.set(secondaryUvs.subarray(i * 2, i * 2 + 2), i * 18 + 16)
    for (let axis = 0; axis < 3; axis++) {
      bounds.min[axis] = Math.min(bounds.min[axis], positions[i * 3 + axis])
      bounds.max[axis] = Math.max(bounds.max[axis], positions[i * 3 + axis])
    }
  }
  return { positions, normals, uvs, secondaryUvs, colors, sourceIndices, vertices, primitives, materials, bounds }
}

export const buildMeshletGeometry = (input, output, source, budget = {}) => buildGeometry(input, output, source, budget, false)
export const buildMeshletPages = (input, output, source, budget = {}) => buildGeometry(input, output, source, budget, true)

async function buildGeometry(input, outputArgument, source, budget, paged) {
  const outputPath = resolve(outputArgument)
  const started = performance.now()
  const executable = await getNativeBuilder()
  const geometry = prepareGeometry(input)
  const work = await mkdtemp(join(tmpdir(), 'blacksite-geometry-build-'))
  try {
    const header = new Uint32Array([0x49475342, geometry.positions.length / 3, geometry.sourceIndices.length, geometry.primitives.length, Number(Boolean(geometry.colors)), Number(Boolean(geometry.secondaryUvs))])
    const primitiveData = new Uint32Array(geometry.primitives.flatMap((primitive) => [primitive.indexOffset, primitive.indexCount, primitive.materialIndex]))
    const sourceData = Buffer.concat([header, geometry.vertices, geometry.sourceIndices, primitiveData].map((array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength)))
    await writeFile(join(work, 'input.bin'), sourceData)
    const minimumError = budget.minimumError ?? 0
    if (!Number.isFinite(minimumError) || minimumError < 0) throw new Error('Minimum resident error must be finite and nonnegative')
    await run(executable, [join(work, 'input.bin'), join(work, 'output.bin'), String(minimumError), ...(paged ? [join(work, 'pages.bin')] : [])])
    const nativeOutput = await readFile(join(work, 'output.bin'))
    if (paged) {
      const { stats, arrays } = readNativePages(nativeOutput)
      const pageData = await readFile(join(work, 'pages.bin'))
      const pages = Array.from({ length: stats.pageCount }, (_, i) => {
        const offset = arrays.pages[i * 4] + arrays.pages[i * 4 + 1] * 4294967296
        const bytes = arrays.pages[i * 4 + 2]
        return { offset, bytes, pinned: Boolean(arrays.pages[i * 4 + 3]), sha256: sha256(pageData.subarray(offset, offset + bytes)) }
      })
      const metadata = {
        version: 4, name: input.name ?? basename(outputPath, '.directory'), minimumError,
        sourceTriangles: geometry.sourceIndices.length / 3, sourceVertices: geometry.positions.length / 3,
        residentTriangles: stats.residentIndices / 3, vertexStride: stats.vertexWords * 4,
        colorBits: geometry.colors ? 8 : 0, vertexAttributes: { ...(geometry.colors ? { color: 5 } : {}), ...(geometry.secondaryUvs ? { uv1: 5 + Number(Boolean(geometry.colors)) } : {}) },
        bounds: geometry.bounds, primitives: geometry.primitives, materials: geometry.materials,
        pageCapacity: 131072, pagePack: `${basename(outputPath, '.directory')}.pages`, pages, ...stats,
        builder: { project: 'https://github.com/zeux/meshoptimizer', revision, archiveSha256, configuration },
        source: source ?? { sha256: sha256(sourceData), bytes: sourceData.byteLength },
      }
      const packed = packPageDirectory(metadata, arrays)
      await mkdir(dirname(outputPath), { recursive: true })
      await writeFile(join(dirname(outputPath), metadata.pagePack), pageData)
      await writeFile(outputPath, packed)
      const verification = await verifyGeometryPages(outputPath)
      const result = { metadata, verification, output: outputPath, bytes: packed.byteLength + pageData.byteLength, seconds: (performance.now() - started) / 1000 }
      console.log(JSON.stringify({ output: outputPath, bytes: result.bytes, ...stats, seconds: result.seconds }))
      return result
    }
    const buffer = nativeOutput.buffer.slice(nativeOutput.byteOffset, nativeOutput.byteOffset + nativeOutput.byteLength)
    const data = new Uint32Array(buffer, 0, 12)
    if (data[0] !== 0x4f475342) throw new Error('Native builder output signature is invalid')
    const [, clusterCount, groupCount, indexCount, edgeCount, levelCount, vertexCount, residentIndexCount, meshletVertices, nodeCount, vertexWords] = data
    let offset = 48
    const section = (Type, count) => { const value = new Type(buffer, offset, count); offset += count * 4; return value }
    const secondaryUvBounds = [...section(Float32Array, 4)]
    const arrays = {
      vertices: section(Uint32Array, vertexCount * vertexWords), vertexReferences: section(Uint32Array, meshletVertices), indices: section(Uint32Array, indexCount),
      clusterData: section(Uint32Array, clusterCount * 8), clusterBounds: section(Float32Array, clusterCount * 4), clusterLod: section(Float32Array, clusterCount * 12),
      clusterQuantization: section(Float32Array, clusterCount * 12),
      groupData: section(Uint32Array, groupCount * 4), groupBounds: section(Float32Array, groupCount * 8), groupChildren: section(Uint32Array, edgeCount),
      nodeData: section(Uint32Array, nodeCount * 4), nodeBounds: section(Float32Array, nodeCount * 8),
    }
    const metadata = {
      name: input.name ?? basename(outputPath, '.meshlets'), sourceTriangles: geometry.sourceIndices.length / 3,
      sourceVertices: geometry.positions.length / 3, residentVertices: vertexCount, meshletVertices,
      residentTriangles: residentIndexCount / 3, minimumError, nodeCount, rootCount: levelCount,
      vertexStride: vertexWords * 4, colorBits: geometry.colors ? 8 : 0, positionBits: 16, normalBits: 16, tangentBits: 16, uvBits: 16, indexBits: 8,
      vertexAttributes: { ...(geometry.colors ? { color: 5 } : {}), ...(geometry.secondaryUvs ? { uv1: 5 + Number(Boolean(geometry.colors)) } : {}) },
      secondaryUvBounds,
      clusterCount, groupCount, levelCount, maxClusterTriangles: 128, bounds: geometry.bounds,
      primitives: geometry.primitives, materials: geometry.materials,
      builder: { project: 'https://github.com/zeux/meshoptimizer', revision, archiveSha256, configuration },
      source: source ?? { sha256: sha256(sourceData), bytes: sourceData.byteLength },
    }
    const packed = pack(metadata, arrays)
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, packed)
    const result = { metadata, output: outputPath, bytes: packed.byteLength, seconds: (performance.now() - started) / 1000 }
    console.log(JSON.stringify({ output: outputPath, bytes: packed.byteLength, sourceTriangles: metadata.sourceTriangles, clusterCount, groupCount, levelCount, seconds: result.seconds }))
    return result
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

export async function buildGltfPages(inputArgument, meshIndex, outputArgument, budget = {}) {
  const inputPath = resolve(inputArgument)
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  const document = await io.read(inputPath)
  const root = document.getRoot()
  const mesh = root.listMeshes()[meshIndex]
  if (!mesh) throw new Error(`Missing component-local mesh ${meshIndex}: ${inputPath}`)
  const entries = mesh.listPrimitives().map(primitive => {
    if (primitive.getMode() !== 4 || primitive.listTargets().length) throw new Error('The geometry builder accepts static triangle primitives only')
    const position = primitive.getAttribute('POSITION')
    if (!position) throw new Error('A primitive has no positions')
    return { primitive, matrix: new Matrix4(), count: position.getCount() }
  })
  const geometry = geometryFromEntries(entries, root.listMaterials())
  const source = await readFile(inputPath)
  return buildMeshletPages({ name: mesh.getName(), ...geometry, indices: geometry.sourceIndices }, outputArgument,
    { sha256: sha256(source), bytes: source.byteLength, meshIndex }, budget)
}

async function writeDocumentMaterials(document, outputPath) {
  const library = cloneDocument(document)
  const root = library.getRoot()
  const geometryExtensions = new Set(['EXT_meshopt_compression', 'KHR_draco_mesh_compression', 'KHR_mesh_quantization', 'EXT_mesh_gpu_instancing', 'KHR_lights_punctual'])
  for (const extension of root.listExtensionsUsed()) {
    if (geometryExtensions.has(extension.extensionName)) extension.dispose()
  }
  for (const property of [
    ...root.listScenes(), ...root.listNodes(), ...root.listAnimations(), ...root.listSkins(),
    ...root.listCameras(), ...root.listMeshes(), ...root.listAccessors(), ...root.listBuffers(),
  ]) property.dispose()
  if (root.listTextures().length) library.createBuffer('Material images')
  await mkdir(dirname(outputPath), { recursive: true })
  await new NodeIO().registerExtensions(ALL_EXTENSIONS).write(outputPath, library)
  return { output: outputPath, materials: root.listMaterials().length, textures: root.listTextures().length }
}

export async function writeMaterialLibrary(inputArgument, outputArgument) {
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  return writeDocumentMaterials(await io.read(resolve(inputArgument)), resolve(outputArgument))
}

export async function buildGltfMeshes(inputArgument, outputArgument, budget = {}) {
  const inputPath = resolve(inputArgument)
  const outputDirectory = resolve(outputArgument)
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  const document = await io.read(inputPath)
  const root = document.getRoot()
  const scene = root.getDefaultScene() || root.listScenes()[0]
  if (!scene) throw new Error('The source has no scene')
  const materials = root.listMaterials()
  const meshes = root.listMeshes()
  const instances = []
  const used = new Set()
  scene.traverse(node => {
    const mesh = node.getMesh()
    if (!mesh) return
    if (node.getSkin()) throw new Error('The geometry builder accepts static meshes only')
    const meshIndex = meshes.indexOf(mesh)
    used.add(meshIndex)
    instances.push({ name: node.getName(), geometry: meshIndex, matrix: node.getWorldMatrix() })
  })
  const sourceData = await readFile(inputPath)
  const source = { sha256: sha256(sourceData), bytes: sourceData.byteLength }
  const geometries = []
  for (const meshIndex of used) {
    const mesh = meshes[meshIndex]
    const entries = mesh.listPrimitives().map(primitive => {
      if (primitive.getMode() !== 4 || primitive.listTargets().length) throw new Error('The geometry builder accepts static triangle primitives only')
      const position = primitive.getAttribute('POSITION')
      if (!position) throw new Error('A primitive has no positions')
      return { primitive, matrix: new Matrix4(), count: position.getCount() }
    })
    const geometry = geometryFromEntries(entries, materials)
    const name = mesh.getName() || `geometry-${meshIndex}`
    const filename = `${meshIndex}-${name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()}.meshlets`
    const { metadata } = await buildMeshletGeometry({ name, ...geometry, indices: geometry.sourceIndices }, join(outputDirectory, filename), source, budget)
    geometries.push({ meshIndex, name, url: filename, primitives: metadata.primitives, sourceTriangles: metadata.sourceTriangles, bounds: metadata.bounds })
  }
  if (!geometries.length) throw new Error('The source contains no mesh geometry')
  const materialUrl = 'materials.glb'
  await writeDocumentMaterials(document, join(outputDirectory, materialUrl))
  const manifest = { source, materialUrl, materials: materials.map(describeMaterial), geometries, instances }
  await writeFile(join(outputDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

async function main() {
  const [inputArgument, outputArgument] = process.argv.slice(2)
  if (!inputArgument || !outputArgument) throw new Error('Usage: node packages/geometry/scripts/build.mjs input.glb output.meshlets')
  const inputPath = resolve(inputArgument)
  const geometry = await readGeometry(inputPath)
  const sourceData = await readFile(inputPath)
  await buildMeshletGeometry({ name: basename(inputPath, '.glb'), ...geometry, indices: geometry.sourceIndices }, outputArgument, { sha256: sha256(sourceData), bytes: sourceData.byteLength })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
