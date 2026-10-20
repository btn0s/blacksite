import { Box3, BundleGroup, Frustum, Group, Matrix4, StorageBufferAttribute, Vector2, Vector3 } from 'three/webgpu'
import type { Camera, Mesh, Scene, WebGPURenderer } from 'three/webgpu'

export type GeometryPass = 'lit' | 'depth' | 'shadow'

type CoverageNode = { bounds: Box3; materials: Uint32Array; left: number; right: number; first: number; count: number }

export class MaterialCoverage {
  private readonly nodes: CoverageNode[] = []
  private readonly stack = new Int32Array(64)
  private readonly frustum = new Frustum()
  private readonly inverse = new Matrix4()
  readonly words: number
  readonly spatial: StorageBufferAttribute
  readonly spatialRoots: StorageBufferAttribute
  readonly placements: StorageBufferAttribute

  constructor(bounds: Float32Array, instances: Float32Array, materialMap: readonly number[], materials: number, slots: readonly number[]) {
    this.words = Math.ceil(materials / 32)
    const placements: number[] = []
    const build = (ids: number[]) => {
      const box = new Box3()
      const bits = new Uint32Array(this.words)
      for (const id of ids) {
        const offset = id * 6
        box.expandByPoint(new Vector3(bounds[offset]!, bounds[offset + 1]!, bounds[offset + 2]!))
        box.expandByPoint(new Vector3(bounds[offset + 3]!, bounds[offset + 4]!, bounds[offset + 5]!))
        const first = instances[id * 36 + 34]!
        for (let slot = 0; slot < slots[id]!; slot++) {
          const material = materialMap[first + slot]!
          if (material !== 0xffffffff) bits[material >>> 5] = bits[material >>> 5]! | (1 << (material & 31))
        }
      }
      const index = this.nodes.length
      const node = { bounds: box, materials: bits, left: -1, right: -1, first: 0, count: 0 }
      this.nodes.push(node)
      if (ids.length > 8) {
        const size = box.getSize(new Vector3())
        const axis = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2
        ids.sort((a, b) => bounds[a * 6 + axis]! - bounds[b * 6 + axis]!)
        const middle = ids.length >>> 1
        node.left = build(ids.slice(0, middle))
        node.right = build(ids.slice(middle))
      } else { node.first = placements.length; node.count = ids.length; placements.push(...ids) }
      return index
    }
    build(Array.from({ length: bounds.length / 6 }, (_, i) => i))
    const spatial = new Uint32Array(this.nodes.length * 8), floats = new Float32Array(spatial.buffer)
    const center = new Vector3(), size = new Vector3(), rounding = new Float32Array(1), bits = new Uint32Array(rounding.buffer)
    for (const [index, node] of this.nodes.entries()) {
      node.bounds.getCenter(center)
      const offset = index * 8
      floats.set(center.toArray(), offset)
      const error = Math.hypot(center.x - floats[offset]!, center.y - floats[offset + 1]!, center.z - floats[offset + 2]!)
      const radius = node.bounds.getSize(size).length() * 0.5 + error
      rounding[0] = radius
      if (rounding[0]! < radius) bits[0] = bits[0]! + 1
      floats[offset + 3] = rounding[0]!
      spatial.set([node.left < 0 ? 0xffffffff : node.left, node.right < 0 ? 0xffffffff : node.right, node.first, node.count], offset + 4)
    }
    let roots = [0]
    for (let depth = 0; depth < 5; depth++) roots = roots.flatMap(id => this.nodes[id]!.left < 0 ? [id] : [this.nodes[id]!.left, this.nodes[id]!.right])
    this.spatial = new StorageBufferAttribute(spatial, 4)
    this.spatialRoots = new StorageBufferAttribute(new Uint32Array(roots), 1)
    this.placements = new StorageBufferAttribute(new Uint32Array(placements), 1)
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
  private readonly queried: Uint32Array
  private readonly viewport = new Vector2()
  private readonly compiled = new WeakMap<Camera, Set<Mesh>>()
  private readonly pending = new WeakMap<Camera, Map<Mesh, Promise<void>>>()

  constructor(private readonly coverage: MaterialCoverage) {
    this.masks = Array.from({ length: 2 }, () => new Uint32Array(coverage.words).fill(0xffffffff))
    this.queried = new Uint32Array(coverage.words)
    this.lit.name = 'Cluster lit materials'
    this.depth.name = 'Cluster depth buckets'
    this.shadow.name = 'Cluster sun-shadow selection'
  }

  add(pass: Group, mesh: Mesh, first: number, count: number, material: object | null) {
    mesh.userData.material = material
    mesh.static = true
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
    if (!this.compiled.has(camera)) this.compiled.set(camera, new Set())
    if (!this.pending.has(camera)) this.pending.set(camera, new Map())
    const compiled = this.compiled.get(camera)!, pending = this.pending.get(camera)!
    await Promise.all(this.records.map(async record => {
      if (record.pass !== this[pass] || compiled.has(record.mesh)) return
      if (!pending.has(record.mesh)) {
        const visible = record.mesh.visible
        record.mesh.visible = true
        pending.set(record.mesh, renderer.compileAsync(record.mesh, camera, scene).then(() => { compiled.add(record.mesh); record.bundle.needsUpdate = true }).finally(() => { record.mesh.visible = visible; pending.delete(record.mesh) }))
      }
      await pending.get(record.mesh)
    }))
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
    if (view < 0 || view > 2) throw new Error('Cluster submission supports one view and two shadow cascades')
    const mask = this.masks[view === 0 ? 0 : 1]!
    this.coverage.query(frustum, world, this.queried)
    let changed = false
    for (let word = 0; word < mask.length; word++) {
      if (mask[word] !== this.queried[word]) { mask[word] = this.queried[word]!; changed = true }
    }
    if (!changed) return
    for (const record of this.records) {
      if ((record.pass === this.shadow) !== (view !== 0)) continue
      let visible = false
      for (let material = record.first; material < record.first + record.count; material++) if (mask[material >>> 5]! & (1 << (material & 31))) { visible = true; break }
      record.bundle.visible = visible
    }
  }
}
