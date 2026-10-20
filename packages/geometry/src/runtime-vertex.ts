import { BufferAttribute, InstancedBufferGeometry, Vector4 } from 'three/webgpu'
import type { IndirectStorageBufferAttribute, Node, Object3D, StorageBufferAttribute } from 'three/webgpu'
import { Fn, cos, float, instanceIndex, min, mix, normalLocal, storage, uint, uniform, varyingProperty, vec3, vec4, vertexIndex } from 'three/tsl'
import { DRAW_ARGUMENT_OFFSET, type PackedMeshletScene } from './runtime-data'
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

export function clusterVertex(packed: PackedMeshletScene, visibleAttribute: StorageBufferAttribute, debug: Node<'uint'> = uint(0)) {
  type Draw = Pick<PackedMeshletScene['batches'][number], 'geometry' | 'offset'>
  const draws = new WeakMap<Object3D, Draw>()
  const drawFor = (object: Object3D | null) => {
    const draw = object ? draws.get(object) : undefined
    if (!draw) throw new Error('Cluster draw has no resident geometry binding')
    return draw
  }
  const geometry = packed.batches[0]!.geometry
  const readCluster = clusterReader(packed.clusters)
  const readInstance = instanceReader(packed.instances)
  const vertices = storage(geometry.vertices, 'uint', geometry.vertices.count).toReadOnly()
    .onObjectUpdate(({ object }) => drawFor(object).geometry.vertices)
  const words = uniform(geometry.vertexWords, 'uint').onObjectUpdate(({ object }) => drawFor(object).geometry.vertexWords)
  const colorOffset = uniform(geometry.colorOffset, 'uint').onObjectUpdate(({ object }) => drawFor(object).geometry.colorOffset)
  const secondaryUvOffset = uniform(geometry.secondaryUvOffset, 'uint').onObjectUpdate(({ object }) => drawFor(object).geometry.secondaryUvOffset)
  const uvBounds = new Vector4()
  const secondaryUvBounds = uniform(uvBounds).onObjectUpdate(({ object }) => uvBounds.fromArray(drawFor(object).geometry.secondaryUvBounds))
  const readVertex = vertexReader(vertices, words, colorOffset, secondaryUvOffset, secondaryUvBounds)
  const indices = storage(geometry.indices, 'uint', geometry.indices.count).toReadOnly()
    .onObjectUpdate(({ object }) => drawFor(object).geometry.indices)
  const references = storage(geometry.vertexReferences, 'uint', geometry.vertexReferences.count).toReadOnly()
    .onObjectUpdate(({ object }) => drawFor(object).geometry.vertexReferences)
  const offset = uniform(0, 'uint').onObjectUpdate(({ object }) => drawFor(object).offset)
  const visible = storage(visibleAttribute, 'uvec2', packed.candidateCount).toReadOnly()
  const uv = varyingProperty('vec2', 'geometryUv')
  const color = varyingProperty('vec3', 'geometryClusterColor')
  const vertexColor = varyingProperty('vec4', 'geometryVertexColor')
  const secondaryUv = varyingProperty('vec2', 'geometrySecondaryUv')
  const scaleX = varyingProperty('float', 'geometryScaleX')
  const position = Fn(() => {
    const candidate = visible.element(instanceIndex.add(offset)).toVar()
    const cluster = readCluster(candidate.x)
    const instance = readInstance(candidate.y)
    const draw = cluster.draw
    const corner = vertexIndex.mod(3)
    const mirroredCorner = corner.equal(0).select(uint(0), uint(3).sub(corner))
    const orientedCorner = instance.scale.y.lessThan(0).select(mirroredCorner, corner)
    const localIndex = min(vertexIndex.div(3).mul(3).add(orientedCorner), draw.y.sub(1))
    const address = draw.x.add(localIndex)
    const index = indices.element(address.div(4)).shiftRight(address.mod(4).mul(8)).bitAnd(255).add(draw.w)
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
  return { position, uv, color, vertexColor, secondaryUv, scaleX, bind: (object: Object3D, draw: Draw) => { draws.set(object, draw) } }
}
