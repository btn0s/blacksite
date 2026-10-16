import { BufferGeometry, Float32BufferAttribute, Group, Vector3, type Material } from 'three';
import { FragmentState, type BondDef, type DestructibleManifest, type FragmentDef, type SimulationFrame, type Vec3 } from '../../destruction-domain/src/index';
import { GPUTransformPool, PooledBatchedMesh } from './gpu-pool';

/** Small fractured bevels along polygon boundaries, in chunk-local coordinates. */
export function damagedEdgeGeometry(points: ReadonlyArray<Vec3>, normal: Vec3, seed: number, width = 0.025): BufferGeometry | null {
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
    const count = Math.max(1, Math.min(48, Math.ceil(length / 0.1)));
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

interface EdgeFace { key: string; shape: number; bond: BondDef; chunk: number; side: number }
interface EdgeBatch { mesh: PooledBatchedMesh; material: Material; instances: number; vertices: number; capacity: number }
interface EdgeEntry { shape: number; chunk: number; batch: EdgeBatch; geometry: number; instance: number; vertices: number }

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
  private batches: EdgeBatch[] = [];
  private readonly entries = new Map<string, EdgeEntry>();
  private poolRevision = -1;
  private backlog = false;
  private grownVertices = 0;
  private grownInstances = 0;

  constructor(private readonly manifest: DestructibleManifest, private readonly pool: GPUTransformPool, private readonly materialFor: (fragment: FragmentDef) => Material, private readonly profile = false, private readonly facesPerUpdate = Number.POSITIVE_INFINITY) {
    this.group.name = 'cascade-exposed-fracture-edges';
    this.byId = new Map(manifest.fragments.map((fragment, index) => [fragment.id, index]));
  }

  resetUpdateStats(): void {
    this.timings.scanMs = this.timings.removalMs = this.timings.geometryMs = this.timings.insertionMs = this.timings.compactionMs = 0;
    this.stats.edgeRebuiltThisUpdate = false;
    this.stats.edgeFacesAddedThisUpdate = this.stats.edgeFacesRemovedThisUpdate = 0;
  }

  update(frame?: SimulationFrame | null): void {
    this.resetUpdateStats();
    if (!frame) { this.clear(); return; }
    if (!this.backlog && this.lastTick === frame.tick && this.lastBondRevision === (frame.bondRevision ?? 0) && this.poolRevision === this.pool.revision) return;
    this.lastTick = frame.tick; this.lastBondRevision = frame.bondRevision ?? 0;
    let phaseAt = this.profile ? performance.now() : 0;
    const visible = new Map<number, number>();
    const actor = new Map<number, number>();
    for (const owner of frame.actors ?? []) for (const chunk of owner.visibleChunks) actor.set(chunk, owner.id);
    const visibleAncestor = (index: number): number => {
      const cached = visible.get(index); if (cached !== undefined) return cached;
      let current: number | undefined = index;
      while (current !== undefined) {
        if (frame.states[current] !== FragmentState.Hidden && frame.states[current] !== FragmentState.Retired) { visible.set(index, current); return current; }
        current = this.byId.get(this.manifest.fragments[current]!.parent ?? -1);
      }
      visible.set(index, -1); return -1;
    };
    const faces = new Map<string, EdgeFace>();
    const bonds = frame.bonds ?? this.manifest.bonds;
    for (let i = 0; i < bonds.length; i++) {
      // Broken and compliant are separate enum branches: compliant is numerically after broken.
      if (frame.bondStates[i] !== 3 && frame.bondStates[i] !== 4) continue;
      const bond = bonds[i]!, a = this.byId.get(bond.a), b = this.byId.get(bond.b);
      const va = a === undefined ? -1 : visibleAncestor(a), vb = b === undefined ? -1 : visibleAncestor(b);
      if (va === vb || (va >= 0 && vb >= 0 && actor.has(va) && actor.get(va) === actor.get(vb))) continue;
      // IDs survive geometry changes in runtime sections. Compare the geometry inputs,
      // not object identity (worker snapshots clone bond definitions).
      const section = bond.section;
      const shape = section
        ? signature(bond.area, bond.normal, section.point, section.tangent1, section.tangent2, section.inertia1, section.inertia2)
        : signature(bond.area, bond.normal, bond.centroid);
      if (va >= 0) { const key = `${bond.id}:a:${va}`; faces.set(key, { key, shape, bond, chunk: va, side: 1 }); }
      if (vb >= 0) { const key = `${bond.id}:b:${vb}`; faces.set(key, { key, shape, bond, chunk: vb, side: -1 }); }
    }
    if (this.profile) { const now = performance.now(); this.timings.scanMs = now - phaseAt; phaseAt = now; }
    // Retain every unchanged face. A single exposure change must not recreate the
    // thousands of unrelated bevels, batched buffers and GPU uploads around it.
    for (const [key, entry] of this.entries) {
      if (faces.get(key)?.shape === entry.shape) continue;
      entry.batch.mesh.deleteInstance(entry.instance);
      entry.batch.mesh.deleteGeometry(entry.geometry);
      entry.batch.instances--; entry.batch.vertices -= entry.vertices;
      this.entries.delete(key);
      this.stats.edgeFacesRemovedThisUpdate++;
    }
    if (this.profile) { const now = performance.now(); this.timings.removalMs = now - phaseAt; phaseAt = now; }
    const pending = new Map<Material, Array<{ face: EdgeFace; geometry: BufferGeometry; vertices: number }>>();
    let budget = this.facesPerUpdate;
    this.backlog = false;
    for (const face of faces.values()) {
      if (this.entries.has(face.key)) continue;
      if (budget-- <= 0) { this.backlog = true; break; }
      const fragment = this.manifest.fragments[face.chunk]!;
      const { point, tangent1, tangent2, half1, half2 } = connectionRectangle(face.bond, fragment);
      const points: Vec3[] = [[-1,-1], [1,-1], [1,1], [-1,1]].map(([u, v]) => [
        point[0] + tangent1[0] * u! * half1 + tangent2[0] * v! * half2 - fragment.position[0],
        point[1] + tangent1[1] * u! * half1 + tangent2[1] * v! * half2 - fragment.position[1],
        point[2] + tangent1[2] * u! * half1 + tangent2[2] * v! * half2 - fragment.position[2],
      ]);
      const normal = face.bond.normal.map(value => value * face.side) as Vec3;
      const geometry = damagedEdgeGeometry(points, normal, face.bond.id, Math.min(0.025, half1 * 0.15, half2 * 0.15));
      if (!geometry) continue;
      const material = this.materialFor(fragment), group = pending.get(material) ?? [];
      group.push({ face, geometry, vertices: geometry.getAttribute('position').count });
      pending.set(material, group);
    }
    if (this.profile) { const now = performance.now(); this.timings.geometryMs = now - phaseAt; phaseAt = now; }
    for (const [material, additions] of pending) {
      let remainingVertices = additions.reduce((sum, item) => sum + item.vertices, 0);
      for (let i = 0; i < additions.length; i++) {
        const { face, geometry, vertices } = additions[i]!;
        let batch = this.batches.find(batch => batch.material === material &&
          batch.instances < batch.mesh.maxInstanceCount && batch.vertices + vertices <= batch.capacity);
        if (!batch) batch = this.createBatch(material, additions.length - i, remainingVertices);
        // Deleted spans remain holes until compacted; reuse them before allocating
        // another batch. Geometries and instance IDs survive this compaction.
        if (batch.mesh.unusedVertexCount < vertices) {
          const started = this.profile ? performance.now() : 0;
          batch.mesh.optimize();
          if (this.profile) this.timings.compactionMs += performance.now() - started;
        }
        const geometryId = batch.mesh.addGeometry(geometry);
        const instance = batch.mesh.addInstance(geometryId);
        geometry.dispose();
        batch.mesh.bind(instance, this.pool.slots.get(`primary:${face.chunk}`) ?? 0);
        batch.instances++; batch.vertices += vertices;
        this.entries.set(face.key, { shape: face.shape, chunk: face.chunk, batch, geometry: geometryId, instance, vertices });
        this.stats.edgeGeometryBuilds++; this.stats.edgeFacesAddedThisUpdate++;
        remainingVertices -= vertices;
      }
    }
    if (this.profile) this.timings.insertionMs = performance.now() - phaseAt;
    if (this.poolRevision !== this.pool.revision) {
      for (const entry of this.entries.values()) entry.batch.mesh.bind(entry.instance, this.pool.slots.get(`primary:${entry.chunk}`) ?? 0);
      this.poolRevision = this.pool.revision;
    }
    this.batches = this.batches.filter(batch => {
      if (batch.instances) return true;
      this.group.remove(batch.mesh); batch.mesh.dispose(); return false;
    });
    this.stats.edgeFaces = this.entries.size;
    this.stats.edgeBatches = this.batches.length;
  }

  private createBatch(material: Material, instances: number, vertices: number): EdgeBatch {
    const capacity = Math.max(4096, Math.ceil(vertices * 1.5), this.grownVertices * 2);
    const instanceCapacity = Math.max(32, Math.ceil(instances * 1.5), this.grownInstances * 2);
    this.grownVertices = capacity; this.grownInstances = instanceCapacity;
    const mesh = new PooledBatchedMesh(this.pool, instanceCapacity, capacity, material);
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
    this.backlog = false; this.grownVertices = this.grownInstances = 0;
    this.stats.edgeFaces = this.stats.edgeBatches = 0;
    this.lastTick = -Infinity; this.lastBondRevision = this.poolRevision = -1;
  }
  dispose(): void { this.clear(); }
}

function connectionRectangle(bond: BondDef, fragment: FragmentDef): { point: Vec3; tangent1: Vec3; tangent2: Vec3; half1: number; half2: number } {
  if (bond.section) return { ...bond.section, half1: Math.sqrt(12 * bond.section.inertia2 / Math.max(bond.area, 1e-9)) / 2, half2: Math.sqrt(12 * bond.section.inertia1 / Math.max(bond.area, 1e-9)) / 2 };
  const n = new Vector3(...bond.normal).normalize();
  const u = new Vector3(Math.abs(n.x) < 0.8 ? 1 : 0, Math.abs(n.x) < 0.8 ? 0 : 1, 0).cross(n).normalize();
  const v = n.clone().cross(u);
  return { point: bond.centroid ?? fragment.position, tangent1: u.toArray() as Vec3, tangent2: v.toArray() as Vec3, half1: Math.sqrt(bond.area) / 2, half2: Math.sqrt(bond.area) / 2 };
}
