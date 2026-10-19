import { BufferAttribute, InstancedBufferGeometry } from 'three/webgpu'
import type { IndirectStorageBufferAttribute, Node, StorageBufferAttribute } from 'three/webgpu'
import { Fn, cos, float, instanceIndex, min, mix, normalLocal, storage, uint, varyingProperty, vec2, vec3, vec4, vertexIndex } from 'three/tsl'
import { DRAW_ARGUMENT_OFFSET, type packScene } from './runtime-data'
import { clusterReader, instanceReader, vertexReader } from './runtime-layout'

export function clusterGeometry(triangles: number, capacity: number, counters: IndirectStorageBufferAttribute, batchIndex: number) {
  const geometry = new InstancedBufferGeometry()
  geometry.instanceCount = capacity
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(triangles * 9), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(triangles * 9), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(triangles * 6), 2))
  geometry.setIndirect(counters, (DRAW_ARGUMENT_OFFSET + batchIndex * 4) * 4)
  return geometry
}

export function clusterVertex(packed: ReturnType<typeof packScene>, visibleAttribute: StorageBufferAttribute, batchIndex: number, offsetsAttribute: StorageBufferAttribute, debug: Node<'uint'> = uint(0)) {
  const readCluster = clusterReader(packed.clusters)
  const readInstance = instanceReader(packed.instances)
  const readVertex = vertexReader(packed.vertices)
  const indices = storage(packed.indices, 'uint', packed.indexCount).toReadOnly()
  const visible = storage(visibleAttribute, 'uvec2', visibleAttribute.count).toReadOnly()
  const offsets = storage(offsetsAttribute, 'uint', offsetsAttribute.count).toReadOnly()
  const uv = varyingProperty('vec2', 'geometryUv')
  const color = varyingProperty('vec3', 'geometryClusterColor')
  const position = Fn(() => {
    const candidate = visible.element(instanceIndex.add(offsets.element(uint(batchIndex)))).toVar()
    const cluster = readCluster(candidate.x)
    const instance = readInstance(candidate.y)
    const draw = cluster.draw
    const corner = vertexIndex.mod(3)
    const mirroredCorner = corner.equal(0).select(uint(0), uint(3).sub(corner))
    const orientedCorner = instance.scale.y.lessThan(0).select(mirroredCorner, corner)
    const localIndex = min(vertexIndex.div(3).mul(3).add(orientedCorner), draw.y.sub(1))
    const index = indices.element(draw.x.add(localIndex))
    const vertex = readVertex(index)
    normalLocal.assign(instance.normal.mul(vec4(vertex.normal.xyz, 0)).xyz)
    uv.assign(vec2(vertex.position.w, vertex.normal.w))
    const shadeId = mix(float(candidate.x), float(draw.z), float(debug.equal(2)))
    color.assign(cos(vec3(0, 2, 4).add(shadeId.mul(2.399963))).mul(0.36).add(0.58))
    return instance.transform.mul(vec4(vertex.position.xyz, 1)).xyz
  })()
  return { position, uv, color }
}
