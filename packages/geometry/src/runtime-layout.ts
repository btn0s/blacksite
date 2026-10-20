import type { Node, StorageBufferAttribute, StorageBufferNode } from 'three/webgpu'
import { If, abs, float, int, mat4, max, storage, uint, uintBitsToFloat, uvec4, vec2, vec3, vec4 } from 'three/tsl'
import { GEOMETRY_PAGE_BYTES } from './page-residency'

export function clusterReader(attribute: StorageBufferAttribute) {
  const data = storage(attribute, 'uint', attribute.count).toReadOnly()
  return (index: Node<'uint'>) => {
    const base = index.div(GEOMETRY_PAGE_BYTES / 4).mul(GEOMETRY_PAGE_BYTES / 4)
    const record = (offset: number) => uvec4(...[0, 1, 2, 3].map(i => data.element(index.add(offset * 4 + i))) as [Node<'uint'>, Node<'uint'>, Node<'uint'>, Node<'uint'>])
    const draw = record(4)
    const layout = record(8)
    return {
      bounds: uintBitsToFloat(record(0)),
      selfSphere: uintBitsToFloat(record(1)),
      parentSphere: uintBitsToFloat(record(2)),
      errors: uintBitsToFloat(record(3)).xy,
      material: record(3).z,
      refinedGroup: record(3).w,
      draw: uvec4(draw.x.add(base.mul(4)), draw.yz, draw.w.add(base)),
      origin: uintBitsToFloat(record(5)),
      tangentOffset: data.element(index.add(23)),
      step: uintBitsToFloat(record(6)),
      uvBounds: uintBitsToFloat(record(7)),
      vertexLayout: uvec4(layout.x.add(base), layout.yzw),
      secondaryUvBounds: uintBitsToFloat(record(9)),
    }
  }
}

export function instanceReader(attribute: StorageBufferAttribute) {
  const data = storage(attribute, 'vec4', attribute.count).toReadOnly()
  return (index: Node<'uint'>) => {
    const offset = index.mul(9)
    return {
      transform: mat4(data.element(offset), data.element(offset.add(1)), data.element(offset.add(2)), data.element(offset.add(3))),
      normal: mat4(data.element(offset.add(4)), data.element(offset.add(5)), data.element(offset.add(6)), data.element(offset.add(7))),
      scale: data.element(offset.add(8)),
    }
  }
}

export function vertexReader(data: StorageBufferNode<'uint'>) {
  const oct = (word: Node<'uint'>) => {
    const xy = vec2(float(int(word.shiftLeft(16)).shiftRight(16)), float(int(word).shiftRight(16))).div(32767)
    const z = float(1).sub(abs(xy.x)).sub(abs(xy.y))
    const fold = max(z.negate(), 0)
    return vec3(xy.x.add(xy.x.greaterThanEqual(0).select(fold.negate(), fold)), xy.y.add(xy.y.greaterThanEqual(0).select(fold.negate(), fold)), z).normalize()
  }
  return (index: Node<'uint'>, cluster: ReturnType<ReturnType<typeof clusterReader>>) => {
    const layout = cluster.vertexLayout.toVar()
    const offset = layout.x.add(index.mul(layout.y)).toVar()
    const xy = data.element(offset)
    const zw = data.element(offset.add(1))
    const normalUv = data.element(offset.add(2))
    const uvFlags = data.element(offset.add(3))
    const flags = uvFlags.shiftRight(16)
    const color = vec4(1).toVar()
    If(layout.z.greaterThan(0), () => {
      const rgba = data.element(offset.add(layout.z))
      color.assign(vec4(float(rgba.bitAnd(255)), float(rgba.shiftRight(8).bitAnd(255)), float(rgba.shiftRight(16).bitAnd(255)), float(rgba.shiftRight(24))).div(255))
    })
    const secondaryUv = vec2(0).toVar()
    If(layout.w.greaterThan(0), () => {
      const packedUv = data.element(offset.add(layout.w))
      secondaryUv.assign(vec2(float(packedUv.bitAnd(65535)), float(packedUv.shiftRight(16))).div(65535).mul(cluster.secondaryUvBounds.zw).add(cluster.secondaryUvBounds.xy))
    })
    return {
      position: vec3(float(xy.bitAnd(65535)), float(xy.shiftRight(16)), float(zw.bitAnd(65535))).mul(cluster.step.xyz).add(cluster.origin.xyz),
      normal: oct(zw.shiftRight(16).bitOr(normalUv.shiftLeft(16))),
      uv: vec2(float(normalUv.shiftRight(16)), float(uvFlags.bitAnd(65535))).div(65535).mul(cluster.uvBounds.zw).add(cluster.uvBounds.xy),
      tangent: oct(data.element(offset.add(cluster.tangentOffset))),
      handedness: flags.bitAnd(1).equal(0).select(float(1), float(-1)),
      color,
      secondaryUv,
    }
  }
}
