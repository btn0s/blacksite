import { ReferenceNode, StorageBufferAttribute, TextureNode, type Node, type Texture } from 'three/webgpu'
import { nodeObject, storage, uint } from 'three/tsl'
import { geometryMaterialId } from '@blacksite/geometry'
import type { ScanSurface } from './scan-material'

export type ScanGraphSurface = {
  family: ScanSurface['family']
  parameters: {
    scalar: Record<string, Node<'float'>>
    vector: Record<string, Node<'vec4'>>
    static_switch: Record<string, Node<'bool'>>
  }
  channels: { roughness: Node<'uint'>; metalness: Node<'uint'> }
}

export class ScanMaterialData {
  readonly attribute: StorageBufferAttribute
  private readonly fields: { kind: 'scalar' | 'vector' | 'static_switch'; name: string }[]
  private readonly buffer
  private readonly stride

  constructor(surfaces: readonly ScanSurface[]) {
    this.fields = (['scalar', 'vector', 'static_switch'] as const).flatMap(kind => [...new Set(surfaces.flatMap(surface => Object.keys(surface.parameters[kind])))].sort().map(name => ({ kind, name })))
    this.stride = this.fields.length + 2
    const values = new Float32Array(surfaces.length * this.stride * 4)
    for (const [id, surface] of surfaces.entries()) {
      for (const [field, { kind, name }] of this.fields.entries()) {
        const value = surface.parameters[kind][name]
        const offset = (id * this.stride + field) * 4
        if (Array.isArray(value)) values.set(value.slice(0, 4), offset)
        else values[offset] = Number(value ?? 0)
      }
      values.set(['rgba'.indexOf(surface.channels.roughness), 'rgba'.indexOf(surface.channels.metalness)], (id * this.stride + this.fields.length) * 4)
    }
    this.attribute = new StorageBufferAttribute(values, 4)
    this.buffer = storage(this.attribute, 'vec4', this.attribute.count).toReadOnly()
  }

  graph(family: ScanSurface['family']): ScanGraphSurface {
    const base = uint(geometryMaterialId()).mul(this.stride)
    const scalar: ScanGraphSurface['parameters']['scalar'] = {}, vector: ScanGraphSurface['parameters']['vector'] = {}, switches: ScanGraphSurface['parameters']['static_switch'] = {}
    this.fields.forEach(({ kind, name }, field) => {
      const value = this.buffer.element(base.add(field))
      if (kind === 'scalar') scalar[name] = value.x
      else if (kind === 'vector') vector[name] = value
      else switches[name] = value.x.notEqual(0)
    })
    const channels = this.buffer.element(base.add(this.fields.length))
    const zero = this.buffer.element(base.add(this.fields.length + 1))
    const defaults = <T>(values: Record<string, T>, fallback: T) => new Proxy(values, { get: (target, name: string) => target[name] ?? fallback })
    return { family, parameters: { scalar: defaults(scalar, zero.x), vector: defaults(vector, zero), static_switch: defaults(switches, zero.x.notEqual(0)) }, channels: { roughness: uint(channels.x), metalness: uint(channels.y) } }
  }
}

class ScanTextureSlot extends TextureNode {
  getUniformHash() { return this.uuid }
}

export class ScanMaterialTexture extends ReferenceNode {
  constructor(slot: string, value: Texture, coordinates: Node<'vec2'>) {
    super(`userData.material.scanTextures.${slot}.allocation.texture`, 'texture')
    this.node = nodeObject(new ScanTextureSlot(value, coordinates))
  }
}
