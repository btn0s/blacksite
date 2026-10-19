import type { Node, StorageBufferAttribute } from 'three/webgpu'
import { mat4, storage, uintBitsToFloat } from 'three/tsl'

export function clusterReader(attribute: StorageBufferAttribute) {
  const data = storage(attribute, 'uvec4', attribute.count).toReadOnly()
  return (index: Node<'uint'>) => {
    const offset = index.mul(5)
    return {
      bounds: uintBitsToFloat(data.element(offset)),
      selfSphere: uintBitsToFloat(data.element(offset.add(1))),
      parentSphere: uintBitsToFloat(data.element(offset.add(2))),
      errors: uintBitsToFloat(data.element(offset.add(3))),
      draw: data.element(offset.add(4)),
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

export function vertexReader(attribute: StorageBufferAttribute) {
  const data = storage(attribute, 'vec4', attribute.count).toReadOnly()
  return (index: Node<'uint'>) => {
    const offset = index.mul(2)
    return { position: data.element(offset), normal: data.element(offset.add(1)) }
  }
}
