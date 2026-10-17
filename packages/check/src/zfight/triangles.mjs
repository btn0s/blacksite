const DOUBLE_SIDE = 2

function nameOf(object, index) {
  if (object.name) return object.name
  const material = Array.isArray(object.material) ? object.material[0] : object.material
  return `${material?.name || object.geometry?.type || 'mesh'}#${index}`
}

function pathOf(object) {
  const parts = []
  for (let node = object; node; node = node.parent) if (node.name) parts.push(node.name)
  return parts.reverse().join('/')
}

function visibleChain(object) {
  for (let node = object; node; node = node.parent) if (node.visible === false) return false
  return true
}

function surfaceOf(material) {
  const first = Array.isArray(material) ? material[0] : material
  if (!first) return null
  if (first.colorWrite === false || first.depthTest === false || first.visible === false) return null
  return {
    material: first.name ?? '',
    doubleSided: first.side === DOUBLE_SIDE,
    offsetFactor: first.polygonOffset ? first.polygonOffsetFactor ?? 0 : 0,
    offsetUnits: first.polygonOffset ? first.polygonOffsetUnits ?? 0 : 0,
    blended: first.transparent === true,
    depthWrite: first.depthWrite !== false,
  }
}

function localVertex(mesh, geometry, index, out, skinned) {
  if (skinned) {
    mesh.getVertexPosition(index, out)
    return
  }
  const position = geometry.attributes.position
  out.set(position.getX(index), position.getY(index), position.getZ(index))
}

export function extractTriangles(root, options = {}) {
  const maxTriangles = options.maxTriangles ?? 3_000_000
  const maxInstances = options.maxInstances ?? 512
  root.updateMatrixWorld?.(true)
  const meshes = []
  const chunks = []
  let total = 0
  let truncated = false
  let sampledInstances = 0
  const skipped = { invisible: 0, unsupported: 0 }
  let meshIndex = 0
  root.traverse(object => {
    if (!object.isMesh || !object.geometry?.attributes?.position) return
    if (!visibleChain(object)) { skipped.invisible++; return }
    const surface = surfaceOf(object.material)
    if (!surface) { skipped.unsupported++; return }
    if (options.filter && !options.filter(object)) return
    const geometry = object.geometry
    const index = geometry.index
    const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(geometry.attributes.position.count / 3)
    if (triangleCount === 0) return
    const skinned = object.isSkinnedMesh === true && typeof object.getVertexPosition === 'function'
    const instances = object.isInstancedMesh ? Math.min(object.count, maxInstances) : 1
    if (object.isInstancedMesh && object.count > maxInstances) sampledInstances += object.count - instances
    const needed = triangleCount * instances
    if (total + needed > maxTriangles) { truncated = true; return }
    const positions = new Float32Array(needed * 9)
    const matrix = object.matrixWorld.elements
    const local = new object.position.constructor()
    const instanceMatrix = object.isInstancedMesh ? new object.matrixWorld.constructor() : null
    const composed = instanceMatrix ? new object.matrixWorld.constructor() : null
    let write = 0
    for (let instance = 0; instance < instances; instance++) {
      let e = matrix
      if (instanceMatrix) {
        object.getMatrixAt(instance, instanceMatrix)
        composed.multiplyMatrices(object.matrixWorld, instanceMatrix)
        e = composed.elements
      }
      for (let t = 0; t < triangleCount; t++) {
        for (let corner = 0; corner < 3; corner++) {
          const vertex = index ? index.getX(t * 3 + corner) : t * 3 + corner
          localVertex(object, geometry, vertex, local, skinned)
          const x = local.x, y = local.y, z = local.z
          const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15])
          positions[write++] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w
          positions[write++] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w
          positions[write++] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w
        }
      }
    }
    const parts = Array.isArray(object.userData?.parts) ? object.userData.parts : null
    meshes.push({ index: meshIndex, name: nameOf(object, meshIndex), path: pathOf(object), uuid: object.uuid, ...surface, first: total, count: needed, perInstance: triangleCount, parts })
    chunks.push(positions)
    total += needed
    meshIndex++
  })
  const positions = new Float32Array(total * 9)
  const owner = new Uint32Array(total)
  let cursor = 0
  chunks.forEach((chunk, i) => {
    positions.set(chunk, cursor * 9)
    owner.fill(i, cursor, cursor + chunk.length / 9)
    cursor += chunk.length / 9
  })
  return { positions, owner, count: total, meshes, truncated, sampledInstances, skipped }
}

export function labelOf(soup, mesh, triangle) {
  const local = (triangle - mesh.first) % Math.max(1, mesh.perInstance ?? mesh.count)
  if (mesh.parts) for (const part of mesh.parts) if (local >= part.start && local < part.start + part.count) return part.label
  return null
}
