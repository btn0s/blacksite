import { readFile } from 'node:fs/promises'
import path from 'node:path'

export async function readGltfSoup(file) {
  const { NodeIO } = await import('@gltf-transform/core')
  const io = new NodeIO()
  try {
    const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions')
    io.registerExtensions(ALL_EXTENSIONS)
    const { MeshoptDecoder } = await import('meshoptimizer')
    await MeshoptDecoder.ready
    io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  } catch {}
  const document = /\.glb$/i.test(file) ? await io.readBinary(new Uint8Array(await readFile(file))) : await io.read(file)
  const chunks = []
  const meshes = []
  let total = 0
  let index = 0
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const matrix = node.getWorldMatrix()
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() !== 4) continue
      const position = primitive.getAttribute('POSITION')
      if (!position) continue
      const array = position.getArray()
      const indices = primitive.getIndices()?.getArray()
      const count = indices ? Math.floor(indices.length / 3) : Math.floor(position.getCount() / 3)
      const out = new Float32Array(count * 9)
      for (let t = 0; t < count * 3; t++) {
        const v = indices ? indices[t] : t
        const x = array[v * 3], y = array[v * 3 + 1], z = array[v * 3 + 2]
        out[t * 3] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]
        out[t * 3 + 1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]
        out[t * 3 + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]
      }
      const material = primitive.getMaterial()
      meshes.push({
        index,
        name: node.getName() || mesh.getName() || `mesh#${index}`,
        path: [node.getName(), mesh.getName()].filter(Boolean).join('/'),
        uuid: `${path.basename(file)}#${index}`,
        material: material?.getName() ?? '',
        doubleSided: material?.getDoubleSided() ?? false,
        offsetFactor: 0,
        offsetUnits: 0,
        blended: material?.getAlphaMode() === 'BLEND',
        depthWrite: true,
        first: total,
        count,
        perInstance: count,
        parts: null,
      })
      chunks.push(out)
      total += count
      index++
    }
  }
  const positions = new Float32Array(total * 9)
  const owner = new Uint32Array(total)
  let cursor = 0
  chunks.forEach((chunk, i) => {
    positions.set(chunk, cursor * 9)
    owner.fill(i, cursor, cursor + chunk.length / 9)
    cursor += chunk.length / 9
  })
  return { positions, owner, count: total, meshes, truncated: false, sampledInstances: 0, skipped: { invisible: 0, unsupported: 0 } }
}
