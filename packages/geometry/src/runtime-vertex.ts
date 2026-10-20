import { BufferAttribute, BufferGeometry } from 'three/webgpu'
import type { IndirectStorageBufferAttribute, Node, StorageBufferAttribute } from 'three/webgpu'
import { Fn, cos, float, mix, normalLocal, storage, uint, varyingProperty, vec3, vec4, vertexIndex } from 'three/tsl'
import { DRAW_ARGUMENT_OFFSET, DRAW_ARGUMENT_STRIDE, type PackedMeshletScene } from './runtime-data'
import { clusterReader, instanceReader, vertexReader } from './runtime-layout'

export function clusterGeometry(indices: StorageBufferAttribute, counters: IndirectStorageBufferAttribute, batchIndex: number) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(3), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(2), 2))
  geometry.setIndex(indices)
  geometry.setIndirect(counters, (DRAW_ARGUMENT_OFFSET + batchIndex * DRAW_ARGUMENT_STRIDE) * 4)
  return geometry
}

export function clusterVertex(packed: PackedMeshletScene, visibleAttribute: StorageBufferAttribute, debug: Node<'uint'> = uint(0)) {
  const readCluster = clusterReader(packed.clusters)
  const readInstance = instanceReader(packed.instances)
  const vertices = storage(packed.vertices, 'uint', packed.vertices.count).toReadOnly()
  const readVertex = vertexReader(vertices)
  const references = storage(packed.vertexReferences, 'uint', packed.vertexReferences.count).toReadOnly()
  const visible = storage(visibleAttribute, 'uvec4', visibleAttribute.count).toReadOnly()
  const uv = varyingProperty('vec2', 'geometryUv')
  const color = varyingProperty('vec3', 'geometryClusterColor')
  const vertexColor = varyingProperty('vec4', 'geometryVertexColor')
  const secondaryUv = varyingProperty('vec2', 'geometrySecondaryUv')
  const scaleX = varyingProperty('float', 'geometryScaleX')
  const position = Fn(() => {
    const candidate = visible.element(vertexIndex.shiftRight(8)).toVar()
    const cluster = readCluster(candidate.x)
    const instance = readInstance(candidate.y)
    const draw = cluster.draw
    const index = vertexIndex.bitAnd(255).add(draw.w)
    const vertex = readVertex(references.element(index), cluster)
    normalLocal.assign(instance.normal.mul(vec4(vertex.normal, 0)).xyz)
    uv.assign(vertex.uv)
    vertexColor.assign(vertex.color)
    secondaryUv.assign(vertex.secondaryUv)
    scaleX.assign(instance.transform.element(0).xyz.length())
    const shadeId = mix(float(candidate.x), float(draw.z), float(debug.equal(2)))
    color.assign(cos(vec3(0, 2, 4).add(shadeId.mul(2.399963))).mul(0.36).add(0.58))
    return instance.transform.mul(vec4(vertex.position, 1)).xyz
  })()
  return { position, uv, color, vertexColor, secondaryUv, scaleX }
}
