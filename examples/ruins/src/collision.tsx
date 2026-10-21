import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CuboidCollider, HeightfieldCollider, RigidBody, useRapier, type HeightfieldArgs, type RapierContext } from '@react-three/rapier'
import { BufferAttribute, BufferGeometry, Box3, DoubleSide, Group, Mesh, Vector3 } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { cameraPosition, positionLocal, uniform } from 'three/tsl'
import { ResidencyLedger } from '@blacksite/geometry'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import type { CharacterHandle } from '@blacksite/subject'
import { ContactProbe, type ContactBody, type ContactDescriber } from './contacts'
import type { LandscapeAsset } from './landscape-asset'

type Chunk = { file: string; source?: string; bytes: number; triangles: number; sha256: string; bounds: { min: number[]; max: number[] } }
export type CollisionDirectory = { version: number; cellSize: number; chunks: Chunk[]; cells: Record<string, number[]>; bounds: { min: number[]; max: number[] } }
type Collider = ReturnType<RapierContext['world']['createCollider']>
type Entry = { id: number; charge: object; state: 'loading' | 'ready' | 'resident'; used: number; collider: Collider | null; buffer: ArrayBuffer | null }
const intersects = (chunk: Chunk, box: Box3) => chunk.bounds.min.every((value, axis) => value <= box.max.getComponent(axis) && chunk.bounds.max[axis]! >= box.min.getComponent(axis))
const tileSize = 8
const residentCost = (chunk: Chunk) => chunk.triangles * 128 + 8192
const stagingCost = (chunk: Chunk) => chunk.bytes * 2 + residentCost(chunk)
const overlayColors = { floor: [0.25, 0.9, 0.4], wall: [0.95, 0.25, 0.2], ceiling: [0.3, 0.45, 0.95] }

function overlayGeometry(vertices: Float32Array, indices: Uint32Array) {
  const positions = new Float32Array(indices.length * 3), colors = new Float32Array(indices.length * 3)
  for (let corner = 0; corner < indices.length; corner += 3) {
    const corners = [indices[corner]! * 3, indices[corner + 1]! * 3, indices[corner + 2]! * 3]
    const [a, b, c] = corners as [number, number, number]
    const ux = vertices[b]! - vertices[a]!, uz = vertices[b + 2]! - vertices[a + 2]!, vx = vertices[c]! - vertices[a]!, vz = vertices[c + 2]! - vertices[a + 2]!
    const nx = (vertices[b + 1]! - vertices[a + 1]!) * (vertices[c + 2]! - vertices[a + 2]!) - (vertices[b + 2]! - vertices[a + 2]!) * (vertices[c + 1]! - vertices[a + 1]!)
    const ny = uz * vx - ux * vz
    const nz = (vertices[b]! - vertices[a]!) * (vertices[c + 1]! - vertices[a + 1]!) - (vertices[b + 1]! - vertices[a + 1]!) * (vertices[c]! - vertices[a]!)
    const length = Math.hypot(nx, ny, nz) || 1, up = ny / length, shade = 0.7 + 0.3 * Math.abs((nx * 0.35 + ny * 0.8 + nz * 0.5) / length)
    const color = up > 0.64 ? overlayColors.floor : up < -0.64 ? overlayColors.ceiling : overlayColors.wall
    for (let slot = 0; slot < 3; slot++) for (let axis = 0; axis < 3; axis++) {
      positions[(corner + slot) * 3 + axis] = vertices[corners[slot]! + axis]!
      colors[(corner + slot) * 3 + axis] = color[axis]! * shade
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

export class RegionalCollision {
  readonly ledger = new ResidencyLedger(128 * 1048576, {})
  private readonly entries = new Map<number, Entry>()
  private readonly ready: Entry[] = []
  private readonly workers = Array.from({ length: 4 }, () => ({ worker: new Worker(new URL('./collision-worker.mjs', import.meta.url), { type: 'module' }), entry: null as Entry | null }))
  private queue: number[] = []
  private critical = new Set<number>()
  private required = new Set<number>()
  private wanted = new Set<number>()
  private readonly guards: Collider[] = []
  private readonly chunkOf = new Map<number, number>()
  private readonly contactProbe: ContactProbe
  readonly overlay = new Group()
  private readonly overlayMeshes = new Map<number, Mesh>()
  private readonly overlayClearance = uniform(0)
  private readonly overlayMaterial = new MeshBasicNodeMaterial({ vertexColors: true, side: DoubleSide })
  private guardCells: { cell: number[]; chunks: Set<number>; distance: number }[] = []
  private guardTile = ''
  private guardSignature = ''
  private tile = ''
  private readonly center = new Vector3()
  private readonly player = new Vector3()
  private destination: { position: Vector3; resolve(): void; reject(error: unknown): void } | null = null
  private failure: unknown
  private disposed = false
  private dirty = true
  private frame = 0
  private readonly idle: Collider[] = []
  private readonly idleGuards: Collider[] = []
  private resident = 0
  private residentTriangles = 0
  private peakResidentTriangles = 0
  private insertions = 0
  private removals = 0
  private peakInsertionMs = 0
  private insertionMs = 0
  private wireBytes = 0
  private peakSchedulingMs = 0

  constructor(readonly directory: CollisionDirectory, private readonly root: string, private readonly context: Pick<RapierContext, 'world' | 'rapier'>) {
    if (directory.version !== 1 || directory.cellSize !== 32) throw new Error('Regional collision directory is incompatible')
    this.ledger.reserve(this, 'native', 2 * 1048576)
    this.contactProbe = new ContactProbe(directory.chunks, root)
    this.overlay.visible = false
    this.overlayMaterial.positionNode = positionLocal.add(positionLocal.sub(cameraPosition).normalize().mul(this.overlayClearance))
    for (const slot of this.workers) {
      slot.worker.onmessage = ({ data }) => {
        const entry = slot.entry
        slot.entry = null
        if (!entry || this.disposed) return
        if (data.error) {
          this.entries.delete(entry.id); this.ledger.release(entry.charge)
          if (!data.cancelled) this.failure = new Error(data.error)
          return
        }
        entry.buffer = data.buffer; entry.state = 'ready'; this.ready.push(entry)
        this.wireBytes += data.buffer.byteLength
      }
      slot.worker.onerror = event => { this.failure = new Error(event.message) }
    }
  }

  private area(center: Vector3, radius: number) { return new Box3(center.clone().addScalar(-radius), center.clone().addScalar(radius)) }

  private select(box: Box3) {
    const ids = new Set<number>(), size = this.directory.cellSize
    for (let x = Math.floor(box.min.x / size); x <= Math.floor(box.max.x / size); x++) {
      for (let z = Math.floor(box.min.z / size); z <= Math.floor(box.max.z / size); z++) {
        for (const id of this.directory.cells[`${x},${z}`] ?? []) if (intersects(this.directory.chunks[id]!, box)) ids.add(id)
      }
    }
    return ids
  }

  private loaded(ids: Set<number>) { for (const id of ids) if (this.entries.get(id)?.state !== 'resident') return false; return true }

  private distance(id: number) { return this.directory.chunks[id]!.bounds.min.reduce((sum, value, axis) => sum + ((value + this.directory.chunks[id]!.bounds.max[axis]!) * 0.5 - this.center.getComponent(axis)) ** 2, 0) }

  prepare(position: Readonly<Vector3>) {
    if (this.destination) throw new Error('A collision destination is already pending')
    return new Promise<void>((resolve, reject) => { this.destination = { position: new Vector3().copy(position).add(new Vector3(0, 1, 0)), resolve, reject }; this.tile = '' })
  }

  update(position: Readonly<Vector3>) {
    if (this.failure) throw this.failure
    this.frame++
    this.player.copy(position).y += 1
    const focus = this.destination?.position ?? this.player
    const coordinate = focus.clone().divideScalar(tileSize).floor(), tile = coordinate.toArray().join(',')
    const playerTile = this.player.clone().divideScalar(tileSize).floor().toArray().join(',')
    if (this.tile === tile && this.guardTile === playerTile && this.frame % 30) return
    const start = performance.now()
    this.tile = tile
    this.center.copy(coordinate).addScalar(0.5).multiplyScalar(tileSize)
    this.critical = this.select(this.area(this.center, 5))
    if (this.destination) for (const id of this.select(this.area(this.player.clone().divideScalar(tileSize).floor().addScalar(0.5).multiplyScalar(tileSize), 5))) this.critical.add(id)
    let criticalBytes = 2 * 1048576
    for (const id of this.critical) criticalBytes += residentCost(this.directory.chunks[id]!)
    if (criticalBytes > this.ledger.capacity) throw new Error('The movement neighborhood exceeds the collision CPU budget')
    if (this.guardTile !== playerTile) {
      this.guardTile = playerTile
      const origin = this.player.clone().divideScalar(tileSize).floor()
      this.guardCells = []
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
        const cell = origin.clone().add(new Vector3(x, y, z)), center = cell.clone().addScalar(0.5).multiplyScalar(tileSize)
        this.guardCells.push({ cell: cell.toArray(), chunks: this.select(this.area(center, 5)), distance: center.distanceTo(this.player) })
      }
      this.guardCells.sort((a, b) => a.distance - b.distance)
    }
    this.required = new Set(this.critical)
    if (!this.destination) {
      let bytes = criticalBytes
      for (const { chunks } of this.guardCells) {
        let cost = 0
        for (const id of chunks) if (!this.required.has(id)) cost += residentCost(this.directory.chunks[id]!)
        if (bytes + cost > this.ledger.capacity) continue
        bytes += cost
        for (const id of chunks) this.required.add(id)
      }
    }
    this.wanted = this.select(this.area(this.center, 24))
    for (const id of this.required) this.wanted.add(id)
    for (const entry of this.entries.values()) if (this.wanted.has(entry.id)) entry.used = this.frame
    this.queue = [...this.wanted].filter(id => !this.entries.has(id)).sort((a, b) => Number(this.critical.has(b)) - Number(this.critical.has(a)) || Number(this.required.has(b)) - Number(this.required.has(a)) || this.distance(a) - this.distance(b))
    const keep = this.area(this.center, 40)
    for (const entry of this.entries.values()) if (!this.required.has(entry.id) && !intersects(this.directory.chunks[entry.id]!, keep)) this.remove(entry)
    this.dirty = true
    this.peakSchedulingMs = Math.max(this.peakSchedulingMs, performance.now() - start)
  }

  private remove(entry: Entry) {
    const slot = this.workers.find(slot => slot.entry === entry)
    if (slot) { slot.worker.postMessage({ cancel: true }); return }
    this.hideOverlay(entry.id)
    if (entry.collider) { this.chunkOf.delete(entry.collider.handle); this.park(entry.collider); this.resident--; this.residentTriangles -= this.directory.chunks[entry.id]!.triangles; this.removals++ }
    const index = this.ready.indexOf(entry)
    if (index >= 0) this.ready.splice(index, 1)
    this.entries.delete(entry.id); this.ledger.release(entry.charge); entry.buffer = null; this.dirty = true
  }

  private park(collider: Collider) {
    collider.setEnabled(false)
    collider.setShape(new this.context.rapier.Ball(0.01))
    collider.clearShapeCache()
    this.idle.push(collider)
  }

  private acquire(vertices: Float32Array, indices: Uint32Array) {
    const { world, rapier } = this.context
    const collider = this.idle.pop()
    if (!collider) return world.createCollider(rapier.ColliderDesc.trimesh(vertices, indices, rapier.TriMeshFlags.FIX_INTERNAL_EDGES))
    collider.setShape(new rapier.TriMesh(vertices, indices, rapier.TriMeshFlags.FIX_INTERNAL_EDGES))
    collider.setEnabled(true)
    return collider
  }

  step() {
    if (this.failure) throw this.failure
    const { world, rapier } = this.context
    this.insertionMs = 0
    const insertionDeadline = performance.now() + 0.5
    while (this.ready.length && performance.now() < insertionDeadline) {
      const urgent = this.ready.findIndex(entry => this.critical.has(entry.id)), priority = urgent >= 0 ? urgent : this.ready.findIndex(entry => this.required.has(entry.id))
      const entry = this.ready.splice(priority < 0 ? 0 : priority, 1)[0]!, words = new Uint32Array(entry.buffer!, 0, 8)
      const vertices = new Float32Array(entry.buffer!, 32, words[2]), indices = new Uint32Array(entry.buffer!, 32 + words[2]! * 4, words[3])
      const start = performance.now()
      entry.collider = this.acquire(vertices, indices)
      entry.collider.clearShapeCache()
      this.chunkOf.set(entry.collider.handle, entry.id)
      this.insertionMs += performance.now() - start; this.peakInsertionMs = Math.max(this.peakInsertionMs, this.insertionMs)
      entry.buffer!.transfer(0); entry.buffer = null; entry.state = 'resident'
      this.ledger.release(entry.charge)
      this.ledger.reserve(entry.charge, 'native', residentCost(this.directory.chunks[entry.id]!))
      this.showOverlay(entry)
      this.resident++; this.residentTriangles += this.directory.chunks[entry.id]!.triangles
      this.peakResidentTriangles = Math.max(this.peakResidentTriangles, this.residentTriangles)
      this.insertions++; this.dirty = true
    }
    const deadline = performance.now() + 0.5
    for (const slot of this.workers) {
      if (slot.entry || performance.now() >= deadline) continue
      const id = this.queue[0]
      if (id === undefined) continue
      const chunk = this.directory.chunks[id]!, charge = {}, bytes = stagingCost(chunk)
      if (!this.ledger.reserve(charge, 'native-and-staging', bytes)) {
        let victim: Entry | undefined, priority = -Infinity
        for (const entry of this.entries.values()) {
          if (entry.state !== 'resident' || this.required.has(entry.id)) continue
          const distance = this.distance(entry.id), outside = !this.wanted.has(entry.id)
          if (!this.required.has(id) && !outside && distance <= this.distance(id)) continue
          const score = outside ? 1e12 + this.frame - entry.used : distance
          if (score > priority) { victim = entry; priority = score }
        }
        if (victim) this.remove(victim)
        break
      }
      this.queue.shift()
      const entry: Entry = { id, charge, state: 'loading', used: this.frame, collider: null, buffer: null }
      this.entries.set(id, entry); slot.entry = entry
      slot.worker.postMessage({ url: new URL(chunk.file, this.root).href, sha256: chunk.sha256, bytes: chunk.bytes })
    }
    if (this.dirty) { this.rebuildGuards(); this.dirty = false }
    if (this.destination && this.loaded(this.critical)) { this.destination.resolve(); this.destination = null; this.tile = '' }
  }

  describeContacts(describe: ContactDescriber) { this.contactProbe.describe = describe }

  probeContacts(body: ContactBody | null, time: number) {
    const { world, rapier } = this.context
    this.contactProbe.update(body, time, world, rapier, handle => {
      const id = this.chunkOf.get(handle)
      if (id !== undefined) return { chunk: id }
      return this.guards.some(guard => guard.handle === handle) ? { guard: true } : null
    })
  }

  contacts() { return this.contactProbe.current }

  contactReport() { return this.contactProbe.report() }

  setOverlay(clearance: number | null) {
    const enabled = clearance !== null
    this.overlay.visible = enabled
    this.overlayClearance.value = clearance ?? 0
    if (enabled) for (const entry of this.entries.values()) this.showOverlay(entry)
    else for (const id of [...this.overlayMeshes.keys()]) this.hideOverlay(id)
  }

  private showOverlay(entry: Entry) {
    if (!this.overlay.visible || !entry.collider || this.overlayMeshes.has(entry.id)) return
    const shape = entry.collider.shape as unknown as { vertices: Float32Array; indices: Uint32Array }
    const mesh = new Mesh(overlayGeometry(shape.vertices, shape.indices), this.overlayMaterial)
    mesh.frustumCulled = false
    entry.collider.clearShapeCache()
    this.overlay.add(mesh); this.overlayMeshes.set(entry.id, mesh)
  }

  private hideOverlay(id: number) {
    const mesh = this.overlayMeshes.get(id)
    if (!mesh) return
    this.overlay.remove(mesh); mesh.geometry.dispose(); this.overlayMeshes.delete(id)
  }

  private rebuildGuards() {
    const available = new Set(this.guardCells.filter(cell => this.loaded(cell.chunks)).map(cell => cell.cell.join(',')))
    const signature = [...available].join(';')
    if (signature === this.guardSignature) return
    this.guardSignature = signature
    const { world, rapier } = this.context
    for (const collider of this.guards) { collider.setEnabled(false); this.idleGuards.push(collider) }
    this.guards.length = 0
    for (const id of available) {
      const cell = id.split(',').map(Number), center = new Vector3(...cell).addScalar(0.5).multiplyScalar(tileSize)
      for (let axis = 0; axis < 3; axis++) for (const direction of [-1, 1]) {
        const next = [...cell]; next[axis] = next[axis]! + direction
        if (available.has(next.join(','))) continue
        const size = [4, 4, 4]; size[axis] = 0.1
        const position = center.clone().setComponent(axis, center.getComponent(axis) + direction * 4)
        const guard = this.idleGuards.pop() ?? world.createCollider(rapier.ColliderDesc.cuboid(size[0]!, size[1]!, size[2]!))
        guard.setHalfExtents({ x: size[0]!, y: size[1]!, z: size[2]! })
        guard.setTranslation(position)
        guard.setEnabled(true)
        this.guards.push(guard)
      }
    }
  }

  stats() { return { residentChunks: this.resident, residentTriangles: this.residentTriangles, peakResidentTriangles: this.peakResidentTriangles, queued: this.queue.length, ready: this.ready.length, insertions: this.insertions, removals: this.removals, insertionMs: this.insertionMs, peakInsertionMs: this.peakInsertionMs, peakSchedulingMs: this.peakSchedulingMs, boundaryFaces: this.guards.length, wireBytes: this.wireBytes, cpu: this.ledger.snapshot() } }

  dispose() {
    this.disposed = true; this.destination?.reject(new Error('Collision residency disposed'))
    for (const slot of this.workers) slot.worker.terminate()
    for (const entry of this.entries.values()) {
      if (entry.collider) this.context.world.removeCollider(entry.collider, false)
      entry.buffer?.transfer(0)
      this.ledger.release(entry.charge)
    }
    for (const collider of [...this.guards, ...this.idle, ...this.idleGuards]) this.context.world.removeCollider(collider, false)
    for (const id of [...this.overlayMeshes.keys()]) this.hideOverlay(id)
    this.overlayMaterial.dispose()
    this.ledger.release(this); this.entries.clear(); this.ready.length = 0
  }
}

export function RuinsCollision({ directory, root, describe, walker, onReady, onError, handle }: {
  directory: CollisionDirectory; root: string; describe: ContactDescriber; walker: CharacterHandle; onReady(): void; onError(error: unknown): void; handle: { current: RegionalCollision | null }
}) {
  const { world, rapier } = useRapier()
  const scene = useThree(state => state.scene)
  const residency = useMemo(() => new RegionalCollision(directory, root, { world, rapier }), [directory, rapier, root, world])
  useEffect(() => {
    handle.current = residency
    residency.describeContacts(describe)
    scene.add(residency.overlay)
    void residency.prepare(walker.position).then(onReady).catch(onError)
    return () => { handle.current = null; scene.remove(residency.overlay); residency.dispose() }
  }, [describe, handle, onError, onReady, residency, scene, walker])
  useFrame(() => { residency.update(walker.position); residency.step() }, ALS_FRAME_PRIORITY.Physics - 0.1)
  useFrame(({ clock }) => { residency.probeContacts(walker.als.pose.current.ownerRigidBody as ContactBody | null, clock.elapsedTime) }, ALS_FRAME_PRIORITY.MeshBase)
  return null
}

const boundaryInset = 6
const boundaryHeight = 400

export function TerrainCollision({ asset }: { asset: LandscapeAsset }) {
  const field = asset.sources.near
  const { size, extent, heights } = field
  const args = useMemo<HeightfieldArgs>(() => {
    const columns = new Float32Array(size * size)
    for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) columns[column * size + row] = heights[row * size + column]!
    return [size - 1, size - 1, columns as unknown as number[], { x: extent, y: 1, z: extent }]
  }, [size, extent, heights])
  const half = extent / 2
  const wallY = (field.max + field.min) / 2, wallHalf = (field.max - field.min) / 2 + boundaryHeight
  return <RigidBody type="fixed" colliders={false} position={[field.origin[0] + half, 0, field.origin[1] + half]}>
    <HeightfieldCollider args={args} />
    <CuboidCollider args={[half, wallHalf, 1]} position={[0, wallY, -half + boundaryInset]} />
    <CuboidCollider args={[half, wallHalf, 1]} position={[0, wallY, half - boundaryInset]} />
    <CuboidCollider args={[1, wallHalf, half]} position={[-half + boundaryInset, wallY, 0]} />
    <CuboidCollider args={[1, wallHalf, half]} position={[half - boundaryInset, wallY, 0]} />
  </RigidBody>
}
