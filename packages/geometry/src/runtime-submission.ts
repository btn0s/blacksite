import { Box3, BundleGroup, Frustum, Group, Matrix4, Vector2, Vector3 } from 'three/webgpu'
import type { Camera, Mesh, Scene, WebGPURenderer } from 'three/webgpu'

export type GeometryPass = 'lit' | 'depth' | 'shadow'

type CoverageNode = { bounds: Box3; materials: Uint32Array; left: number; right: number }

export class MaterialCoverage {
  private readonly nodes: CoverageNode[] = []
  private readonly stack = new Int32Array(64)
  private readonly frustum = new Frustum()
  private readonly inverse = new Matrix4()
  readonly words: number

  constructor(bounds: Float32Array, instances: Float32Array, materialMap: readonly number[], materials: number, slots: readonly number[]) {
    this.words = Math.ceil(materials / 32)
    const build = (ids: number[]) => {
      const box = new Box3()
      const bits = new Uint32Array(this.words)
      for (const id of ids) {
        const offset = id * 4
        const radius = bounds[offset + 3]!
        box.expandByPoint(new Vector3(bounds[offset]! - radius, bounds[offset + 1]! - radius, bounds[offset + 2]! - radius))
        box.expandByPoint(new Vector3(bounds[offset]! + radius, bounds[offset + 1]! + radius, bounds[offset + 2]! + radius))
        const first = instances[id * 36 + 34]!
        for (let slot = 0; slot < slots[id]!; slot++) {
          const material = materialMap[first + slot]!
          if (material !== 0xffffffff) bits[material >>> 5] = bits[material >>> 5]! | (1 << (material & 31))
        }
      }
      const index = this.nodes.length
      const node = { bounds: box, materials: bits, left: -1, right: -1 }
      this.nodes.push(node)
      if (ids.length > 8) {
        const size = box.getSize(new Vector3())
        const axis = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2
        ids.sort((a, b) => bounds[a * 4 + axis]! - bounds[b * 4 + axis]!)
        const middle = ids.length >>> 1
        node.left = build(ids.slice(0, middle))
        node.right = build(ids.slice(middle))
      }
      return index
    }
    build(Array.from({ length: bounds.length / 4 }, (_, i) => i))
  }

  query(frustum: Frustum, world: Matrix4, result: Uint32Array) {
    this.inverse.copy(world).invert()
    for (let i = 0; i < 6; i++) this.frustum.planes[i]!.copy(frustum.planes[i]!).applyMatrix4(this.inverse)
    result.fill(0)
    let size = 1
    this.stack[0] = 0
    let visited = 0
    while (size) {
      const node = this.nodes[this.stack[--size]!]!
      if (visited++ < 4096 && !this.frustum.intersectsBox(node.bounds)) continue
      if (node.left >= 0 && visited < 4096) { this.stack[size++] = node.left; this.stack[size++] = node.right }
      else for (let word = 0; word < this.words; word++) result[word] = result[word]! | node.materials[word]!
    }
  }
}

export class MaterialSubmission {
  readonly lit = new Group()
  readonly depth = new Group()
  readonly shadow = new Group()
  private readonly records: { pass: Group; bundle: BundleGroup; mesh: Mesh; first: number; count: number; material: object | null; bindingVersion: number }[] = []
  private readonly masks: Uint32Array[]
  private readonly union: Uint32Array
  private readonly viewport = new Vector2()

  constructor(private readonly coverage: MaterialCoverage) {
    this.masks = Array.from({ length: 3 }, () => new Uint32Array(coverage.words))
    this.union = new Uint32Array(coverage.words).fill(0xffffffff)
    this.lit.name = 'Cluster lit materials'
    this.depth.name = 'Cluster depth buckets'
    this.shadow.name = 'Cluster sun-shadow selection'
  }

  add(pass: Group, mesh: Mesh, first: number, count: number, material: object | null) {
    mesh.matrixAutoUpdate = false
    const bundle = new BundleGroup()
    bundle.name = mesh.name
    bundle.matrixAutoUpdate = false
    bundle.layers.mask = mesh.layers.mask
    bundle.add(mesh)
    pass.add(bundle)
    this.records.push({ pass, bundle, mesh, first, count, material, bindingVersion: 0 })
  }

  initialize(renderer: WebGPURenderer) {
    const indices = new Set(this.records.map(({ mesh }) => mesh.geometry.index!))
    for (const index of indices) renderer.backend.createIndexAttribute(index)
  }

  async compile(renderer: WebGPURenderer, camera: Camera, scene: Scene, pass: GeometryPass) {
    for (const record of this.records) {
      if (record.pass !== this[pass]) continue
      const visible = record.mesh.visible
      record.mesh.visible = true
      try { await renderer.compileAsync(record.mesh, camera, scene) }
      finally { record.mesh.visible = visible }
      record.bundle.needsUpdate = true
    }
  }

  updateBindings(versions: ReadonlyMap<object, number> | undefined, viewport: Readonly<Vector2>) {
    const resized = !this.viewport.equals(viewport)
    this.viewport.copy(viewport)
    for (const record of this.records) {
      const version = record.material ? versions?.get(record.material) ?? 0 : 0
      if (resized || record.bindingVersion !== version) record.bundle.needsUpdate = true
      record.bindingVersion = version
    }
  }

  disposeGeometry(pass: GeometryPass) {
    for (const record of this.records) if (record.pass === this[pass]) record.mesh.geometry.dispose()
  }

  update(frustum: Frustum, world: Matrix4, view: number) {
    if (view < 0 || view >= this.masks.length) throw new Error('Cluster submission supports one view and two shadow cascades')
    this.coverage.query(frustum, world, this.masks[view]!)
    let changed = false
    for (let word = 0; word < this.union.length; word++) {
      const value = (this.masks[0]![word]! | this.masks[1]![word]! | this.masks[2]![word]!) >>> 0
      if (this.union[word] !== value) { this.union[word] = value; changed = true }
    }
    if (!changed) return
    for (const record of this.records) {
      let visible = false
      for (let material = record.first; material < record.first + record.count; material++) if (this.union[material >>> 5]! & (1 << (material & 31))) { visible = true; break }
      record.bundle.visible = visible
    }
  }
}
