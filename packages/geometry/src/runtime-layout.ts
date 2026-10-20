import type { Node, StorageBufferAttribute, StorageBufferNode } from 'three/webgpu'
import { abs, float, int, mat4, max, storage, uintBitsToFloat, vec2, vec3 } from 'three/tsl'

export function clusterReader(attribute: StorageBufferAttribute) {
  const data = storage(attribute, 'uvec4', attribute.count).toReadOnly()
  return (index: Node<'uint'>) => {
    const offset = index.mul(8)
    return {
      bounds: uintBitsToFloat(data.element(offset)),
      selfSphere: uintBitsToFloat(data.element(offset.add(1))),
      parentSphere: uintBitsToFloat(data.element(offset.add(2))),
      errors: uintBitsToFloat(data.element(offset.add(3))),
      draw: data.element(offset.add(4)),
      origin: uintBitsToFloat(data.element(offset.add(5))),
      step: uintBitsToFloat(data.element(offset.add(6))),
      uvBounds: uintBitsToFloat(data.element(offset.add(7))),
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
    const offset = index.mul(5)
    const xy = data.element(offset)
    const zw = data.element(offset.add(1))
    const uv = data.element(offset.add(3))
    return {
      position: vec3(float(xy.bitAnd(65535)), float(xy.shiftRight(16)), float(zw.bitAnd(65535))).mul(cluster.step.xyz).add(cluster.origin.xyz),
      normal: oct(data.element(offset.add(2))),
      uv: vec2(float(uv.bitAnd(65535)), float(uv.shiftRight(16))).div(65535).mul(cluster.uvBounds.zw).add(cluster.uvBounds.xy),
      tangent: oct(data.element(offset.add(4))),
      handedness: float(int(zw).shiftRight(16)).div(32767),
    }
  }
}
