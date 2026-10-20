import { Box3, BundleGroup, Frustum, Group, Matrix4, StorageBufferAttribute, Vector2, Vector3 } from 'three/webgpu'
import type { Camera, Mesh, Object3D } from 'three/webgpu'

export type GeometryPass = 'lit' | 'depth' | 'shadow'

export interface GeometryCompilePass {
  readonly camera: Camera
  readonly pass: GeometryPass
  compile(object: Object3D): Promise<void>
}

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
  private warmup: Promise<void> | null = null
  private failure: unknown
  private disposed = false
  private compiled = 0
  private total = 0
  private required = 0

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

  compile(passes: readonly GeometryCompilePass[], world: Matrix4) {
    if (this.warmup) return this.warmup
    const frustum = new Frustum(), projection = new Matrix4(), mask = new Uint32Array(this.coverage.words)
    const jobs = passes.flatMap(pass => {
      const camera = pass.camera
      camera.updateMatrixWorld()
      frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem)
      this.coverage.query(frustum, world, mask)
      return this.records.filter(record => record.pass === this[pass.pass]).map(record => {
        let required = false
        for (let material = record.first; material < record.first + record.count; material++) {
          if (mask[material >>> 5]! & (1 << (material & 31))) { required = true; break }
        }
        return { pass, record, required }
      })
    }).sort((a, b) => Number(b.required) - Number(a.required))
    this.total = jobs.length
    this.required = jobs.filter(job => job.required).length
    this.warmup = new Promise<void>((resolve, reject) => {
      const compile = async (job: typeof jobs[number]) => {
        const bundle = job.record.bundle
        const wasVisible = bundle.visible
        let pending: Promise<void>
        bundle.visible = true
        try { pending = job.pass.compile(bundle) }
        finally { bundle.visible = wasVisible }
        await pending
        this.compiled++
        bundle.needsUpdate = true
        if (job.required) this.required--
      }
      const run = async () => {
        if (!this.disposed) await Promise.all(jobs.splice(0, this.required).map(compile))
        resolve()
        while (jobs.length && !this.disposed) {
          await new Promise<void>(next => requestAnimationFrame(() => next()))
          if (this.disposed) break
          const visible = jobs.findIndex(job => job.record.bundle.visible)
          const job = jobs.splice(visible < 0 ? 0 : visible, 1)[0]!
          await compile(job)
        }
        if (!this.disposed) performance.mark('geometry-materials-complete')
      }
      void run().catch(error => { this.failure = error; reject(error) })
    })
    return this.warmup
  }

  updateBindings(versions: ReadonlyMap<object, number> | undefined, viewport: Readonly<Vector2>) {
    if (this.failure) throw this.failure
    const resized = !this.viewport.equals(viewport)
    this.viewport.copy(viewport)
    for (const record of this.records) {
      const version = record.material ? versions?.get(record.material) ?? 0 : 0
      if (resized || record.bindingVersion !== version) record.bundle.needsUpdate = true
      record.bindingVersion = version
    }
  }

  disposeGeometry(pass: GeometryPass) {
    this.disposed = true
    for (const record of this.records) if (record.pass === this[pass]) record.mesh.geometry.dispose()
  }

  warmupStats() { return { compiled: this.compiled, total: this.total, required: this.required } }

  update(frustum: Frustum, world: Matrix4, view: number) {
    if (view < 0 || !Number.isInteger(view)) throw new Error('Cluster submission needs a view index of zero or a shadow cascade index plus one')
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
