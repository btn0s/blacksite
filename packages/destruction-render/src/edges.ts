import { BufferGeometry, Float32BufferAttribute, Group, Vector3, type Material } from 'three';
import { FragmentState, type BondDef, type DestructibleManifest, type FragmentDef, type SimulationFrame, type Vec3 } from '../../destruction-domain/src/index';
import { GPUTransformPool, PooledBatchedMesh } from './gpu-pool';

/** Small fractured bevels along polygon boundaries, in chunk-local coordinates. */
export function damagedEdgeGeometry(points: ReadonlyArray<Vec3>, normal: Vec3, seed: number, width = 0.025, segmentLength = 0.1): BufferGeometry | null {
  if (points.length < 3) return null;
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
  const center = new Vector3();
  for (const point of points) center.add(new Vector3(...point));
  center.multiplyScalar(1 / points.length);
  const n = new Vector3(...normal).normalize();
  const a = new Vector3(), b = new Vector3(), inward = new Vector3();
  const crossA = new Vector3(), crossB = new Vector3(), faceNormal = new Vector3();
  const triangle = (p: Vector3, q: Vector3, r: Vector3) => {
    faceNormal.crossVectors(crossA.subVectors(q, p), crossB.subVectors(r, p)).normalize();
    if (faceNormal.dot(n) < 0) { const t = q; q = r; r = t; faceNormal.negate(); }
    for (const v of [p, q, r]) { positions.push(v.x, v.y, v.z); normals.push(faceNormal.x, faceNormal.y, faceNormal.z); uvs.push(v.x + v.z, v.y + v.z); }
  };
  const jitter = (value: number) => { const x = Math.sin(value * 127.1 + seed * 31.7) * 43758.5453; return x - Math.floor(x); };
  for (let edge = 0; edge < points.length; edge++) {
    a.fromArray(points[edge]!); b.fromArray(points[(edge + 1) % points.length]!);
    const length = a.distanceTo(b);
    const count = Math.max(1, Math.min(48, Math.ceil(length / segmentLength)));
    inward.copy(center).sub(a).addScaledVector(n, -center.clone().sub(a).dot(n)).normalize();
    let outer = a.clone().addScaledVector(n, width * (jitter(edge * 97) - 0.2));
    let inner = a.clone().addScaledVector(inward, width * (0.65 + jitter(edge * 53))).addScaledVector(n, width * 0.7);
    for (let i = 1; i <= count; i++) {
      const p = a.clone().lerp(b, i / count);
      const outerNext = p.clone().addScaledVector(n, width * (jitter(edge * 97 + i) - 0.2));
      const innerNext = p.clone().addScaledVector(inward, width * (0.65 + jitter(edge * 53 + i))).addScaledVector(n, width * 0.7);
      triangle(outer, outerNext, inner); triangle(outerNext, innerNext, inner);
      outer = outerNext; inner = innerNext;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  return geometry;
}

interface EdgeBatch { mesh: PooledBatchedMesh; material: Material; instances: number; vertices: number; capacity: number }
interface EdgeEntry { shape: number; faces: number; chunk: number; batch: EdgeBatch; geometry: number; instance: number; vertices: number }

/** Authored box cuts have no mesh face metadata, so exposed connection sections supply the edges. */
function signature(...parts: Array<number | ReadonlyArray<number> | undefined>): number {
  let hash = 0, weight = 1;
  for (const part of parts) {
    if (part === undefined) { weight = weight * 1.618 + 0.37; continue; }
    if (typeof part === 'number') { hash += part * weight; weight = weight * 1.618 + 0.37; continue; }
    for (let i = 0; i < part.length; i++) { hash += part[i]! * weight; weight = weight * 1.618 + 0.37; }
  }
  return hash;
}

export class ExposedFractureEdges {
  readonly group = new Group();
  readonly stats = { edgeFaces: 0, edgeBatches: 0, edgeRebuilds: 0, edgeRebuiltThisUpdate: false,
    edgeGeometryBuilds: 0, edgeFacesAddedThisUpdate: 0, edgeFacesRemovedThisUpdate: 0 };
  readonly timings = { scanMs: 0, removalMs: 0, geometryMs: 0, insertionMs: 0, compactionMs: 0 };
  private readonly byId: Map<number, number>;
  private lastTick = -Infinity;
  private lastBondRevision = -1;
  private lastBondStates?: Uint8Array;
  private batches: EdgeBatch[] = [];
  private readonly entries = new Map<number, EdgeEntry>();
  private poolRevision = -1;
  private backlog = false;
  private readonly touched: number[] = [];
  private readonly signatures = new Map<number, number>();
  private faceCount = 0;
  private bonds = new WeakMap<BondDef, { a: number; b: number; shape: number }>();
  private stamp = 0;
  private readonly parentOf: Int32Array;
  private readonly visibleOf: Int32Array;
  private readonly visibleStamp: Int32Array;
  private readonly actorOf: Int32Array;
  private readonly actorStamp: Int32Array;
  private readonly chunkStamp: Int32Array;
  private readonly head: Int32Array;
  private readonly sumA: Float64Array;
  private readonly sumB: Float64Array;
  private readonly faceCountOf: Int32Array;
  private faceNext = new Int32Array(0);
  private faceBond = new Int32Array(0);
  private faceSide = new Int8Array(0);

  private bondInfo(bond: BondDef): { a: number; b: number; shape: number } {
    const known = this.bonds.get(bond);
    if (known) return known;
    const section = bond.section;
    const info = {
      a: this.byId.get(bond.a) ?? -1, b: this.byId.get(bond.b) ?? -1,
      shape: section
        ? signature(bond.area, bond.normal, section.point, section.tangent1, section.tangent2, section.inertia1, section.inertia2)
        : signature(bond.area, bond.normal, bond.centroid),
    };
    this.bonds.set(bond, info);
    return info;
  }

  constructor(private readonly manifest: DestructibleManifest, private readonly pool: GPUTransformPool, private readonly materialFor: (fragment: FragmentDef) => Material, private readonly profile = false, private readonly segmentLength = 0.1) {
    this.group.name = 'cascade-exposed-fracture-edges';
    this.byId = new Map(manifest.fragments.map((fragment, index) => [fragment.id, index]));
    const count = manifest.fragments.length;
    this.parentOf = Int32Array.from(manifest.fragments, fragment => this.byId.get(fragment.parent ?? -1) ?? -1);
    this.visibleOf = new Int32Array(count); this.visibleStamp = new Int32Array(count);
    this.actorOf = new Int32Array(count); this.actorStamp = new Int32Array(count);
    this.chunkStamp = new Int32Array(count); this.head = new Int32Array(count);
    this.sumA = new Float64Array(count); this.sumB = new Float64Array(count); this.faceCountOf = new Int32Array(count);
  }

  resetUpdateStats(): void {
    this.timings.scanMs = this.timings.removalMs = this.timings.geometryMs = this.timings.insertionMs = this.timings.compactionMs = 0;
    this.stats.edgeRebuiltThisUpdate = false;
    this.stats.edgeFacesAddedThisUpdate = this.stats.edgeFacesRemovedThisUpdate = 0;
  }

  get backlogged(): boolean { return this.backlog; }

  update(frame?: SimulationFrame | null, until = Number.POSITIVE_INFINITY): void {
    this.resetUpdateStats();
    if (!frame) { this.clear(); return; }
    if (!this.backlog && this.lastBondRevision === (frame.bondRevision ?? 0) && this.poolRevision === this.pool.revision &&
      (this.lastTick === frame.tick || sameBytes(this.lastBondStates, frame.bondStates))) { this.lastTick = frame.tick; return; }
    let phaseAt = this.profile ? performance.now() : 0;
    const bonds = frame.bonds ?? this.manifest.bonds;
    if (!this.backlog || this.lastTick !== frame.tick || this.lastBondRevision !== (frame.bondRevision ?? 0)) phaseAt = this.scan(frame, bonds, phaseAt);
    let built = 0;
    this.backlog = false;
    for (const chunk of this.touched) {
      if (this.entries.has(chunk)) continue;
      if (built > 0 && performance.now() >= until) { this.backlog = true; break; }
      built++;
      const faceCount = this.faceCountOf[chunk]!;
      const fragment = this.manifest.fragments[chunk]!;
      const parts: BufferGeometry[] = [];
      for (let slot = this.head[chunk]!; slot >= 0; slot = this.faceNext[slot]!) {
        const face = { bond: bonds[this.faceBond[slot]!]!, side: this.faceSide[slot]! };
        const { point, tangent1, tangent2, half1, half2 } = connectionRectangle(face.bond, fragment);
        const points: Vec3[] = [[-1,-1], [1,-1], [1,1], [-1,1]].map(([u, v]) => [
          point[0] + tangent1[0] * u! * half1 + tangent2[0] * v! * half2 - fragment.position[0],
          point[1] + tangent1[1] * u! * half1 + tangent2[1] * v! * half2 - fragment.position[1],
          point[2] + tangent1[2] * u! * half1 + tangent2[2] * v! * half2 - fragment.position[2],
        ]);
        const normal = face.bond.normal.map(value => value * face.side) as Vec3;
        const geometry = damagedEdgeGeometry(points, normal, face.bond.id, Math.min(0.025, half1 * 0.15, half2 * 0.15), this.segmentLength);
        if (geometry) parts.push(geometry);
      }
      const geometry = mergeEdges(parts);
      if (this.profile) { const now = performance.now(); this.timings.geometryMs += now - phaseAt; phaseAt = now; }
      if (!geometry) continue;
      this.insert(chunk, this.signatures.get(chunk)!, faceCount, geometry, this.materialFor(fragment));
      if (this.profile) { const now = performance.now(); this.timings.insertionMs += now - phaseAt; phaseAt = now; }
    }
    if (this.poolRevision !== this.pool.revision) {
      for (const entry of this.entries.values()) entry.batch.mesh.bind(entry.instance, this.pool.slots.get(`primary:${entry.chunk}`) ?? 0);
      this.poolRevision = this.pool.revision;
    }
    this.batches = this.batches.filter(batch => {
      if (batch.instances) return true;
      this.group.remove(batch.mesh); batch.mesh.dispose(); return false;
    });
    this.stats.edgeFaces = this.faceCount;
    this.stats.edgeBatches = this.batches.length;
  }

  private scan(frame: SimulationFrame, bonds: ReadonlyArray<BondDef>, phaseAt: number): number {
    this.lastTick = frame.tick; this.lastBondRevision = frame.bondRevision ?? 0;
    if (this.lastBondStates?.length === frame.bondStates.length) this.lastBondStates.set(frame.bondStates);
    else this.lastBondStates = frame.bondStates.slice();
    const stamp = ++this.stamp;
    for (const owner of frame.actors ?? []) for (const chunk of owner.visibleChunks) { this.actorOf[chunk] = owner.id; this.actorStamp[chunk] = stamp; }
    const visibleAncestor = (index: number): number => {
      if (this.visibleStamp[index] === stamp) return this.visibleOf[index]!;
      let current = index;
      while (current >= 0 && (frame.states[current] === FragmentState.Hidden || frame.states[current] === FragmentState.Retired)) current = this.parentOf[current]!;
      this.visibleOf[index] = current; this.visibleStamp[index] = stamp;
      return current;
    };
    const actorOf = (chunk: number) => this.actorStamp[chunk] === stamp ? this.actorOf[chunk]! : -1;
    if (this.faceNext.length < bonds.length * 2) {
      this.faceNext = new Int32Array(bonds.length * 4); this.faceBond = new Int32Array(bonds.length * 4); this.faceSide = new Int8Array(bonds.length * 4);
    }
    const touched = this.touched;
    touched.length = 0;
    let faces = 0;
    const add = (chunk: number, bond: number, side: number, key: number, shape: number) => {
      if (this.chunkStamp[chunk] !== stamp) { this.chunkStamp[chunk] = stamp; this.head[chunk] = -1; this.sumA[chunk] = 0; this.sumB[chunk] = 0; this.faceCountOf[chunk] = 0; touched.push(chunk); }
      this.faceBond[faces] = bond; this.faceSide[faces] = side; this.faceNext[faces] = this.head[chunk]!; this.head[chunk] = faces++;
      this.sumA[chunk] += mix(key, shape, 12.9898); this.sumB[chunk] += mix(key, shape, 39.3468); this.faceCountOf[chunk]++;
    };
    for (let i = 0; i < bonds.length; i++) {
      // Broken and compliant are separate enum branches: compliant is numerically after broken.
      if (frame.bondStates[i] !== 3 && frame.bondStates[i] !== 4) continue;
      const bond = bonds[i]!, known = this.bondInfo(bond);
      const va = known.a < 0 ? -1 : visibleAncestor(known.a), vb = known.b < 0 ? -1 : visibleAncestor(known.b);
      if (va === vb || (va >= 0 && vb >= 0 && actorOf(va) >= 0 && actorOf(va) === actorOf(vb))) continue;
      // IDs survive geometry changes in runtime sections. Compare the geometry inputs,
      // not object identity (worker snapshots clone bond definitions).
      if (va >= 0) add(va, i, 1, bond.id * 2, known.shape);
      if (vb >= 0) add(vb, i, -1, bond.id * 2 + 1, known.shape);
    }
    const signatures = this.signatures;
    signatures.clear();
    for (const chunk of touched) signatures.set(chunk, this.sumA[chunk]! + this.sumB[chunk]! * 1e-7 + this.faceCountOf[chunk]! * 1e3);
    if (this.profile) { const now = performance.now(); this.timings.scanMs = now - phaseAt; phaseAt = now; }
    // Retain every unchanged chunk. A single exposure change must not recreate the
    // thousands of unrelated bevels, batched buffers and GPU uploads around it.
    for (const [chunk, entry] of this.entries) {
      if (signatures.get(chunk) === entry.shape) continue;
      entry.batch.mesh.deleteInstance(entry.instance);
      entry.batch.mesh.deleteGeometry(entry.geometry);
      entry.batch.instances--; entry.batch.vertices -= entry.vertices;
      this.entries.delete(chunk);
      this.faceCount -= entry.faces;
      this.stats.edgeFacesRemovedThisUpdate += entry.faces;
    }
    if (this.profile) { const now = performance.now(); this.timings.removalMs = now - phaseAt; phaseAt = now; }
    return phaseAt;
  }

  private insert(chunk: number, shape: number, faces: number, geometry: BufferGeometry, material: Material): void {
    const vertices = geometry.getAttribute('position').count;
    const batch = this.batches.find(batch => batch.material === material) ?? this.createBatch(material, vertices);
    if (batch.instances + 1 > batch.mesh.maxInstanceCount) batch.mesh.setInstanceCount((batch.instances + 1) * 2);
    if (batch.vertices + vertices > batch.capacity) {
      batch.capacity = (batch.vertices + vertices) * 2;
      batch.mesh.setGeometrySize(batch.capacity, 0);
    }
    if (batch.mesh.unusedVertexCount < vertices) {
      const started = this.profile ? performance.now() : 0;
      batch.mesh.optimize();
      if (this.profile) this.timings.compactionMs += performance.now() - started;
    }
    const geometryId = batch.mesh.addGeometry(geometry);
    const instance = batch.mesh.addInstance(geometryId);
    geometry.dispose();
    batch.mesh.bind(instance, this.pool.slots.get(`primary:${chunk}`) ?? 0);
    batch.instances++; batch.vertices += vertices;
    this.entries.set(chunk, { shape, faces, chunk, batch, geometry: geometryId, instance, vertices });
    this.faceCount += faces;
    this.stats.edgeGeometryBuilds += faces; this.stats.edgeFacesAddedThisUpdate += faces;
  }

  private createBatch(material: Material, vertices: number): EdgeBatch {
    const capacity = Math.max(4096, vertices * 2);
    const mesh = new PooledBatchedMesh(this.pool, 32, capacity, material);
    mesh.name = 'cascade-damaged-edges'; mesh.frustumCulled = false; mesh.perObjectFrustumCulled = false; mesh.sortObjects = false;
    mesh.castShadow = false; mesh.receiveShadow = true;
    const batch = { mesh, material, instances: 0, vertices: 0, capacity };
    this.batches.push(batch); this.group.add(mesh);
    this.stats.edgeRebuilds++; this.stats.edgeRebuiltThisUpdate = true;
    return batch;
  }

  private clear(): void {
    for (const { mesh } of this.batches) { this.group.remove(mesh); mesh.dispose(); }
    this.batches = []; this.entries.clear();
    this.backlog = false; this.faceCount = 0;
    this.stats.edgeFaces = this.stats.edgeBatches = 0;
    this.lastTick = -Infinity; this.lastBondRevision = this.poolRevision = -1; this.lastBondStates = undefined;
  }
  dispose(): void { this.clear(); }
}

function mix(key: number, shape: number, salt: number): number {
  const x = Math.sin(key * salt + shape * 78.233 + salt) * 43758.5453;
  return x - Math.floor(x);
}

function mergeEdges(parts: ReadonlyArray<BufferGeometry>): BufferGeometry | null {
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0]!;
  const merged = new BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]] as const) {
    const total = parts.reduce((sum, part) => sum + part.getAttribute(name).array.length, 0);
    const array = new Float32Array(total);
    let offset = 0;
    for (const part of parts) { const source = part.getAttribute(name).array as Float32Array; array.set(source, offset); offset += source.length; }
    merged.setAttribute(name, new Float32BufferAttribute(array, size));
  }
  for (const part of parts) part.dispose();
  return merged;
}

function sameBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function connectionRectangle(bond: BondDef, fragment: FragmentDef): { point: Vec3; tangent1: Vec3; tangent2: Vec3; half1: number; half2: number } {
  if (bond.section) return { ...bond.section, half1: Math.sqrt(12 * bond.section.inertia2 / Math.max(bond.area, 1e-9)) / 2, half2: Math.sqrt(12 * bond.section.inertia1 / Math.max(bond.area, 1e-9)) / 2 };
  const n = new Vector3(...bond.normal).normalize();
  const u = new Vector3(Math.abs(n.x) < 0.8 ? 1 : 0, Math.abs(n.x) < 0.8 ? 0 : 1, 0).cross(n).normalize();
  const v = n.clone().cross(u);
  return { point: bond.centroid ?? fragment.position, tangent1: u.toArray() as Vec3, tangent2: v.toArray() as Vec3, half1: Math.sqrt(bond.area) / 2, half2: Math.sqrt(bond.area) / 2 };
}
