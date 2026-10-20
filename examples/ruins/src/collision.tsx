import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useRapier, type RapierContext } from '@react-three/rapier'
import { Box3, Vector3 } from 'three'
import { ResidencyLedger } from '@blacksite/geometry'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import type { CharacterHandle } from '@blacksite/subject'

type Chunk = { file: string; bytes: number; triangles: number; sha256: string; bounds: { min: number[]; max: number[] } }
export type CollisionDirectory = { version: number; cellSize: number; chunks: Chunk[]; cells: Record<string, number[]>; bounds: { min: number[]; max: number[] } }
type Collider = ReturnType<RapierContext['world']['createCollider']>
type Entry = { id: number; charge: object; state: 'loading' | 'ready' | 'resident'; used: number; collider: Collider | null; buffer: ArrayBuffer | null }
const intersects = (chunk: Chunk, box: Box3) => chunk.bounds.min.every((value, axis) => value <= box.max.getComponent(axis) && chunk.bounds.max[axis]! >= box.min.getComponent(axis))
const tileSize = 8

export class RegionalCollision {
  readonly ledger = new ResidencyLedger(128 * 1048576, {})
  private readonly entries = new Map<number, Entry>()
  private readonly ready: Entry[] = []
  private readonly workers = Array.from({ length: 4 }, () => ({ worker: new Worker(new URL('./collision-worker.mjs', import.meta.url), { type: 'module' }), entry: null as Entry | null }))
  private queue: number[] = []
  private critical = new Set<number>()
  private wanted = new Set<number>()
  private readonly guards: Collider[] = []
  private guardCells: { cell: number[]; chunks: Set<number> }[] = []
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
    this.wanted = this.select(this.area(this.center, 24))
    for (const id of this.critical) this.wanted.add(id)
    let criticalBytes = 2 * 1048576
    for (const id of this.critical) { const chunk = this.directory.chunks[id]!; criticalBytes += chunk.bytes * 2 + chunk.triangles * 256 + 8192 }
    if (criticalBytes > this.ledger.capacity) throw new Error('The movement neighborhood exceeds the collision CPU budget')
    for (const entry of this.entries.values()) if (this.wanted.has(entry.id)) entry.used = this.frame
    this.queue = [...this.wanted].filter(id => !this.entries.has(id)).sort((a, b) => Number(this.critical.has(b)) - Number(this.critical.has(a)) || this.distance(a) - this.distance(b))
    const keep = this.area(this.center, 40)
    for (const entry of this.entries.values()) if (!this.critical.has(entry.id) && !intersects(this.directory.chunks[entry.id]!, keep)) this.remove(entry)
    if (this.guardTile !== playerTile) {
      this.guardTile = playerTile
      const origin = this.player.clone().divideScalar(tileSize).floor()
      this.guardCells = []
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
        const cell = origin.clone().add(new Vector3(x, y, z)), center = cell.clone().addScalar(0.5).multiplyScalar(tileSize)
        this.guardCells.push({ cell: cell.toArray(), chunks: this.select(this.area(center, 5)) })
      }
    }
    this.dirty = true
    this.peakSchedulingMs = Math.max(this.peakSchedulingMs, performance.now() - start)
  }

  private remove(entry: Entry) {
    const slot = this.workers.find(slot => slot.entry === entry)
    if (slot) { slot.worker.postMessage({ cancel: true }); return }
    if (entry.collider) { this.context.world.removeCollider(entry.collider, false); this.resident--; this.residentTriangles -= this.directory.chunks[entry.id]!.triangles; this.removals++ }
    const index = this.ready.indexOf(entry)
    if (index >= 0) this.ready.splice(index, 1)
    this.entries.delete(entry.id); this.ledger.release(entry.charge); entry.buffer = null; this.dirty = true
  }

  step() {
    if (this.failure) throw this.failure
    const { world, rapier } = this.context
    this.insertionMs = 0
    const insertionDeadline = performance.now() + 0.5
    while (this.ready.length && performance.now() < insertionDeadline) {
      const priority = this.ready.findIndex(entry => this.critical.has(entry.id))
      const entry = this.ready.splice(priority < 0 ? 0 : priority, 1)[0]!, words = new Uint32Array(entry.buffer!, 0, 8)
      const vertices = new Float32Array(entry.buffer!, 32, words[2]), indices = new Uint32Array(entry.buffer!, 32 + words[2]! * 4, words[3])
      const start = performance.now()
      entry.collider = world.createCollider(rapier.ColliderDesc.trimesh(vertices, indices, rapier.TriMeshFlags.FIX_INTERNAL_EDGES))
      entry.collider.clearShapeCache()
      this.insertionMs += performance.now() - start; this.peakInsertionMs = Math.max(this.peakInsertionMs, this.insertionMs)
      entry.buffer!.transfer(0); entry.buffer = null; entry.state = 'resident'
      this.resident++; this.residentTriangles += this.directory.chunks[entry.id]!.triangles
      this.peakResidentTriangles = Math.max(this.peakResidentTriangles, this.residentTriangles)
      this.insertions++; this.dirty = true
    }
    const deadline = performance.now() + 0.5
    for (const slot of this.workers) {
      if (slot.entry || performance.now() >= deadline) continue
      const id = this.queue[0]
      if (id === undefined) continue
      const chunk = this.directory.chunks[id]!, charge = {}, bytes = chunk.bytes * 2 + chunk.triangles * 256 + 8192
      if (!this.ledger.reserve(charge, 'native-and-staging', bytes)) {
        let victim: Entry | undefined, priority = -Infinity
        for (const entry of this.entries.values()) {
          if (entry.state !== 'resident' || this.critical.has(entry.id)) continue
          const distance = this.distance(entry.id), outside = !this.wanted.has(entry.id)
          if (!this.critical.has(id) && !outside && distance <= this.distance(id)) continue
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

  private rebuildGuards() {
    const available = new Set(this.guardCells.filter(cell => this.loaded(cell.chunks)).map(cell => cell.cell.join(',')))
    const signature = [...available].join(';')
    if (signature === this.guardSignature) return
    this.guardSignature = signature
    const { world, rapier } = this.context
    for (const collider of this.guards) world.removeCollider(collider, false)
    this.guards.length = 0
    for (const id of available) {
      const cell = id.split(',').map(Number), center = new Vector3(...cell).addScalar(0.5).multiplyScalar(tileSize)
      for (let axis = 0; axis < 3; axis++) for (const direction of [-1, 1]) {
        const next = [...cell]; next[axis] = next[axis]! + direction
        if (available.has(next.join(','))) continue
        const size = [4, 4, 4]; size[axis] = 0.1
        const position = center.clone().setComponent(axis, center.getComponent(axis) + direction * 4)
        this.guards.push(world.createCollider(rapier.ColliderDesc.cuboid(size[0]!, size[1]!, size[2]!).setTranslation(position.x, position.y, position.z)))
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
    for (const collider of this.guards) this.context.world.removeCollider(collider, false)
    this.ledger.release(this); this.entries.clear(); this.ready.length = 0
  }
}

export function RuinsCollision({ directory, root, walker, onReady, onError, handle }: {
  directory: CollisionDirectory; root: string; walker: CharacterHandle; onReady(): void; onError(error: unknown): void; handle: { current: RegionalCollision | null }
}) {
  const { world, rapier } = useRapier()
  const residency = useMemo(() => new RegionalCollision(directory, root, { world, rapier }), [directory, rapier, root, world])
  useEffect(() => {
    handle.current = residency
    void residency.prepare(walker.position).then(onReady).catch(onError)
    return () => { handle.current = null; residency.dispose() }
  }, [handle, onError, onReady, residency, walker])
  useFrame(() => { residency.update(walker.position); residency.step() }, ALS_FRAME_PRIORITY.Physics - 0.1)
  return null
}
