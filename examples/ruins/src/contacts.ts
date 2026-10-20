import { Triangle, Vector3 } from 'three'
import type { RapierContext } from '@react-three/rapier'

type Vec = { x: number; y: number; z: number }
type ChunkFiles = { file: string; source?: string }
type Classified = { chunk: number } | { guard: true } | null
type CastHit = { collider: { handle: number }; time_of_impact: number; normal1: Vec; witness1: Vec }

export type ContactBody = { numColliders(): number; collider(index: number): { halfHeight(): number; radius(): number; translation(): Vec; rotation(): Vec & { w: number } } }
export type ContactDescriber = (placement: number, slot: number) => Record<string, unknown>
export type ContactOwner = { placement: number; slot: number; distance: number; triangles: number; normal: number[]; point: number[]; surface: Record<string, unknown> }
export type Contact = {
  kind: 'baked-mesh' | 'residency-guard'
  chunk: string | null
  directions: string[]
  distance: number
  normal: number[]
  witness: number[]
  blocking: boolean
  player: number[]
  at: number
  frames: number
  owners: ContactOwner[] | null
  note: string | null
}

const reach = 0.15
const recentLimit = 48
const cacheLimit = 24
const directions: [string, number, number, number][] = [
  ['-z', 0, 0, -1], ['-z+x', Math.SQRT1_2, 0, -Math.SQRT1_2], ['+x', 1, 0, 0], ['+x+z', Math.SQRT1_2, 0, Math.SQRT1_2],
  ['+z', 0, 0, 1], ['+z-x', -Math.SQRT1_2, 0, Math.SQRT1_2], ['-x', -1, 0, 0], ['-x-z', -Math.SQRT1_2, 0, -Math.SQRT1_2], ['down', 0, -1, 0],
]
const round = (value: number) => Math.round(value * 1000) / 1000
const array = (vector: Vec) => [round(vector.x), round(vector.y), round(vector.z)]

export class ContactProbe {
  describe: ContactDescriber = () => ({})
  current: Contact[] = []
  private readonly recent = new Map<string, Contact>()
  private readonly triangles = new Map<number, Promise<{ vertices: Float32Array; indices: Uint32Array } | null>>()
  private readonly sources = new Map<number, Promise<Uint32Array | null>>()

  constructor(private readonly chunks: readonly ChunkFiles[], private readonly root: string) {}

  update(body: ContactBody | null, time: number, world: RapierContext['world'], rapier: RapierContext['rapier'], classify: (handle: number) => Classified) {
    this.current = []
    if (!body || body.numColliders() === 0) return
    const own = body.collider(0), halfHeight = own.halfHeight(), radius = own.radius(), position = own.translation(), rotation = own.rotation()
    const capsule = new rapier.Capsule(halfHeight, radius)
    const found = new Map<number, { kind: Classified; labels: string[]; hit: CastHit }>()
    for (const [label, x, y, z] of directions) {
      let hit: CastHit | null = null
      try { hit = world.castShape(position, rotation, { x, y, z }, capsule, 0, reach, true, undefined, undefined, undefined, body as never) as unknown as CastHit | null } catch { continue }
      if (!hit) continue
      const known = found.get(hit.collider.handle)
      if (known) { known.labels.push(label); if (hit.time_of_impact < known.hit.time_of_impact) known.hit = hit; continue }
      const kind = classify(hit.collider.handle)
      if (kind) found.set(hit.collider.handle, { kind, labels: [label], hit })
    }
    const player = array(position)
    for (const { kind, labels, hit } of found.values()) {
      const normal = array(hit.normal1)
      const contact: Contact = {
        kind: kind && 'guard' in kind ? 'residency-guard' : 'baked-mesh', chunk: kind && 'chunk' in kind ? this.chunks[kind.chunk]!.file : null,
        directions: labels, distance: round(hit.time_of_impact), normal, witness: array(hit.witness1),
        blocking: Math.abs(normal[1]!) < 0.7, player, at: round(time), frames: 1, owners: null, note: null,
      }
      this.current.push(contact)
      const key = `${contact.chunk ?? 'guard'}:${normal.join(',')}:${Math.round(position.x * 4)},${Math.round(position.y * 4)},${Math.round(position.z * 4)}`
      const known = this.recent.get(key)
      if (known) { known.at = contact.at; known.frames++; known.directions = contact.directions; known.distance = contact.distance; known.blocking ||= contact.blocking; Object.assign(contact, { owners: known.owners, note: known.note }); continue }
      this.recent.set(key, contact)
      if (this.recent.size > recentLimit) this.recent.delete(this.recent.keys().next().value!)
      if (kind && 'guard' in kind) contact.note = 'residency guard: a cuboid face closing the edge of the loaded collision neighbourhood, not level geometry'
      else if (kind) void this.resolve(contact, kind.chunk, position, halfHeight, radius)
    }
  }

  report() { return { current: this.current, recent: [...this.recent.values()].sort((a, b) => b.at - a.at) } }

  private load<T>(cache: Map<number, Promise<T>>, id: number, read: () => Promise<T>) {
    let pending = cache.get(id)
    if (!pending) {
      pending = read()
      cache.set(id, pending)
      if (cache.size > cacheLimit) cache.delete(cache.keys().next().value!)
    }
    return pending
  }

  private async resolve(contact: Contact, id: number, position: Vec, halfHeight: number, radius: number) {
    const chunk = this.chunks[id]!
    const [mesh, source] = await Promise.all([
      this.load(this.triangles, id, () => fetch(new URL(chunk.file, this.root)).then(async response => {
        if (!response.ok) return null
        const buffer = await response.arrayBuffer(), words = new Uint32Array(buffer, 0, 8)
        return { vertices: new Float32Array(buffer, 32, words[2]), indices: new Uint32Array(buffer, 32 + words[2]! * 4, words[3]) }
      }).catch(() => null)),
      this.load(this.sources, id, () => chunk.source ? fetch(new URL(chunk.source, this.root)).then(response => response.ok ? response.arrayBuffer().then(buffer => new Uint32Array(buffer)) : null).catch(() => null) : Promise.resolve(null)),
    ])
    if (!mesh || !source) { contact.note = 'no provenance: this collision build does not record which placement each triangle came from'; return }
    const samples = Array.from({ length: 9 }, (_, step) => new Vector3(position.x, position.y - halfHeight + 2 * halfHeight * step / 8, position.z))
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), closest = new Vector3(), triangle = new Triangle(), normal = new Vector3(), edge = new Vector3()
    const owners = new Map<number, { distance: number; triangles: number; normal: number[]; point: number[] }>()
    const threshold = radius + 0.15
    for (let corner = 0; corner < mesh.indices.length; corner += 3) {
      a.fromArray(mesh.vertices, mesh.indices[corner]! * 3); b.fromArray(mesh.vertices, mesh.indices[corner + 1]! * 3); c.fromArray(mesh.vertices, mesh.indices[corner + 2]! * 3)
      triangle.set(a, b, c)
      let nearest = Infinity
      const best = new Vector3()
      for (const sample of samples) { triangle.closestPointToPoint(sample, closest); const distance = closest.distanceTo(sample); if (distance < nearest) { nearest = distance; best.copy(closest) } }
      if (nearest > threshold) continue
      const owner = source[corner / 3]!
      const known = owners.get(owner)
      if (known) known.triangles++
      if (known && known.distance <= nearest) continue
      triangle.getNormal(normal); edge.copy(best)
      owners.set(owner, { distance: nearest, triangles: (known?.triangles ?? 0) + 1, normal: array(normal), point: array(edge) })
    }
    contact.owners = [...owners].sort((x, y) => x[1].distance - y[1].distance).slice(0, 6).map(([owner, value]) => {
      const placement = Math.floor(owner / 256), slot = owner % 256
      return { placement, slot, distance: round(value.distance), triangles: value.triangles, normal: value.normal, point: value.point, surface: this.describe(placement, slot) }
    })
    if (!contact.owners.length) contact.note = 'the capsule is clear of every triangle in this chunk at this position'
  }
}
