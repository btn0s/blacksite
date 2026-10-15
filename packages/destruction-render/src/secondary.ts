import {
  Color,
  Group,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import {
  FragmentState,
  MAX_SECONDARY_FRAGMENTS,
  TRANSFORM_STRIDE,
  type SecondaryFractureFrame,
  type SecondaryFragmentDef,
} from '../../destruction-domain/src/index';
import { fragmentEdgeGeometry, fragmentSurfaceGeometry, type FragmentSurface } from './surfaces';
import { GPUTransformPool, PooledBatchedMesh } from './gpu-pool';

const SURFACES: ReadonlyArray<FragmentSurface> = ['exterior', 'fracture'];
const CAPACITY_HEADROOM = 2;
const MIN_INSTANCE_CAPACITY = 16;
const MIN_VERTEX_CAPACITY = 1024;

interface SecondaryBatch {
  fragmentIds: Array<number>;
  liveInstances: number;
  liveVertices: number;
  material: Material;
  mesh: PooledBatchedMesh;
  vertexCapacity: number;
}

interface SecondaryPart {
  batch: SecondaryBatch;
  geometry: number;
  instance: number;
  vertices: number;
}

interface SecondaryEntry {
  moving: boolean;
  lastSlot: number;
  poolSlot: number;
  poolGeneration: number;
  visible: boolean;
  color?: Color;
  generation: number;
  mass: number;
  parentId: number;
  parts: Array<SecondaryPart>;
  rootId: number;
}

interface PendingSurface {
  key: string;
  geometry: BufferGeometry;
  material: Material;
  vertices: number;
}

function samePose(a: Float32Array, i: number, b: Float32Array, j: number): boolean {
  for (let k = 0; k < TRANSFORM_STRIDE; k++) {
    if (a[i + k] !== b[j + k]) {
      return false;
    }
  }
  return true;
}

export class SecondaryFragmentRenderer {
  readonly group = new Group();
  readonly stats = { secondaryBatchGrowths: 0, secondaryRebuilds: 0, secondaryGeometryBuilds: 0,
    secondaryGrowthsThisUpdate: 0, secondarySurfacesAddedThisUpdate: 0 };
  readonly timings = { geometryMs: 0, growthMs: 0, compactionMs: 0 };
  resetUpdateStats(): void {
    this.stats.secondaryGrowthsThisUpdate = this.stats.secondarySurfacesAddedThisUpdate = 0;
    this.timings.geometryMs = this.timings.growthMs = this.timings.compactionMs = 0;
  }
  shadowRevision = 0;
  private revision = -1;
  private count = -1;
  private batches = new Map<string, SecondaryBatch>();
  private entries = new Map<number, SecondaryEntry>();
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly target = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly oldRotation = new Quaternion();
  private readonly scale = new Vector3(1, 1, 1);
  private poolRevision = -1;
  private poseFrame?: SecondaryFractureFrame;
  private posePrevious?: SecondaryFractureFrame;
  private diagnostic?: Material;
  private readonly updateSlots: number[] = [];
  private readonly previousSlots: number[] = [];
  private readonly ownsPool: boolean;
  private readonly pool: GPUTransformPool;
  private readonly white = new Color('white');
  private readonly unknownStress = new Color('#6f7a82');

  constructor(
    private readonly materialFor: (
      fragment: SecondaryFragmentDef,
      surface: FragmentSurface,
    ) => Material,
    pool?: GPUTransformPool,
    private readonly profile = false,
  ) {
    this.ownsPool = !pool;
    this.pool = pool ?? new GPUTransformPool(MAX_SECONDARY_FRAGMENTS + 1);
    this.group.name = 'secondary-fragments';
  }

  update(
    frame: SecondaryFractureFrame | undefined,
    previous: SecondaryFractureFrame | undefined,
    blend: number,
    diagnostic?: Material,
    _tick = -1,
  ): void {
    this.resetUpdateStats();
    if (!frame) {
      if (this.count !== -1 || this.batches.size) {
        this.clear();
      }
      this.poseFrame = this.posePrevious = undefined;
      this.updateSlots.length = 0;
      if (this.ownsPool) { this.pool.synchronize(new Map()); this.pool.flush(); }
      return;
    }
    const fragments = frame.fragments;
    if (this.ownsPool && frame !== this.poseFrame) this.pool.synchronize(new Map(fragments
      .filter((_, index) => frame.states[index] !== FragmentState.Retired)
      .map(fragment => [`secondary:${fragment.id}`, [`secondary:${fragment.id}`]])));
    const rebound = this.poolRevision !== this.pool.revision;
    this.poolRevision = this.pool.revision;
    if (
      frame.transforms.length < fragments.length * TRANSFORM_STRIDE ||
      frame.states.length < fragments.length
    ) {
      throw new Error('Secondary destruction frame is incomplete');
    }
    if (frame.revision !== this.revision || fragments.length !== this.count) {
      this.synchronize(frame);
    }
    const old =
      previous &&
      previous.transforms.length >= previous.fragments.length * TRANSFORM_STRIDE &&
      previous.states.length >= previous.fragments.length
        ? previous
        : undefined;
    const color = diagnostic ? this.unknownStress : this.white;
    if (frame !== this.poseFrame || old !== this.posePrevious || rebound || diagnostic !== this.diagnostic) {
      for (const batch of this.batches.values()) batch.mesh.material = diagnostic ?? batch.material;
      this.updateSlots.length = 0;
      let cursor = 0;
      for (let slot = 0; slot < fragments.length; slot++) {
        const id = fragments[slot]!.id;
        const entry = this.entries.get(id);
        if (!entry) continue;
        const visible = frame.states[slot] !== FragmentState.Retired;
        if (entry.visible !== visible) this.shadowRevision++;
        entry.visible = visible;
        const poolSlot = visible ? this.pool.slots.get(`secondary:${id}`) ?? 0 : 0;
        const generation = this.pool.generationBySlot[poolSlot]!;
        const rebind = entry.poolSlot !== poolSlot || entry.poolGeneration !== generation;
        let before = -1;
        if (old) {
          while (cursor < old.fragments.length && old.fragments[cursor]!.id < id) cursor++;
          if (old.fragments[cursor]?.id === id) before = cursor;
        }
        this.previousSlots[slot] = before;
        const offset = slot * TRANSFORM_STRIDE;
        const moving = before >= 0 && old !== undefined && old.states[before] !== FragmentState.Retired &&
          !samePose(frame.transforms, offset, old.transforms, before * TRANSFORM_STRIDE);
        const dirty = rebind || entry.moving || moving || entry.lastSlot < 0 || !this.poseFrame ||
          !samePose(frame.transforms, offset, this.poseFrame.transforms, entry.lastSlot * TRANSFORM_STRIDE);
        const recolor = rebind || entry.color !== color;
        for (const part of entry.parts) {
          if (rebind) part.batch.mesh.bind(part.instance, poolSlot);
          part.batch.mesh.setVisibleAt(part.instance, visible);
          if (visible && recolor) part.batch.mesh.setColorAt(part.instance, color);
        }
        entry.poolSlot = poolSlot;
        entry.poolGeneration = generation;
        entry.color = color;
        entry.lastSlot = slot;
        entry.moving = visible && moving;
        if (visible && dirty) this.updateSlots.push(slot);
      }
      this.poseFrame = frame;
      this.posePrevious = old;
      this.diagnostic = diagnostic;
    }
    let movingCount = 0;
    for (let cursor = 0; cursor < this.updateSlots.length; cursor++) {
      const slot = this.updateSlots[cursor]!;
      const entry = this.entries.get(fragments[slot]!.id)!;
      const offset = slot * TRANSFORM_STRIDE;
      this.position.fromArray(frame.transforms, offset);
      this.rotation.fromArray(frame.transforms, offset + 3);
      let uniformScale = frame.transforms[offset + 7] ?? 1;
      if (entry.moving && old) {
        const before = this.previousSlots[slot]! * TRANSFORM_STRIDE;
        this.target.copy(this.position);
        this.position.fromArray(old.transforms, before).lerp(this.target, blend);
        this.oldRotation.fromArray(old.transforms, before + 3).slerp(this.rotation, blend);
        this.rotation.copy(this.oldRotation);
        const oldScale = old.transforms[before + 7] ?? 1;
        uniformScale = oldScale + (uniformScale - oldScale) * blend;
      }
      this.scale.setScalar(uniformScale);
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.pool.write(entry.poolSlot, this.matrix);
      if (entry.moving) this.updateSlots[movingCount++] = slot;
    }
    this.updateSlots.length = movingCount;
    if (this.ownsPool) this.pool.flush();
  }

  private synchronize(frame: SecondaryFractureFrame): void {
    this.shadowRevision++;
    if (frame.revision < this.revision) {
      this.rebuild(frame);
      return;
    }
    const current = new Map<number, SecondaryFragmentDef>();
    for (const fragment of frame.fragments) {
      current.set(fragment.id, fragment);
    }
    for (const [id, entry] of this.entries) {
      const fragment = current.get(id);
      if (!fragment || !sameDefinition(entry, fragment)) {
        this.remove(id, entry);
      }
    }
    const added: Array<{ fragment: SecondaryFragmentDef; surfaces: Array<PendingSurface> }> = [];
    const demand = new Map<string, { instances: number; vertices: number }>();
    for (const fragment of current.values()) {
      if (this.entries.has(fragment.id)) {
        continue;
      }
      const surfaces = this.surfaces(fragment);
      for (const surface of surfaces) {
        const need = demand.get(surface.key) ?? { instances: 0, vertices: 0 };
        need.instances++;
        need.vertices += surface.vertices;
        demand.set(surface.key, need);
      }
      added.push({ fragment, surfaces });
    }
    for (const [key, need] of demand) {
      const batch = this.batches.get(key);
      if (!batch) {
        continue;
      }
      const instances = batch.liveInstances + need.instances;
      const vertices = batch.liveVertices + need.vertices;
      if (instances > batch.mesh.maxInstanceCount || vertices > batch.vertexCapacity) {
        const started = this.profile ? performance.now() : 0;
        if (instances > batch.mesh.maxInstanceCount) batch.mesh.setInstanceCount(Math.ceil(instances * CAPACITY_HEADROOM));
        if (vertices > batch.vertexCapacity) {
          batch.vertexCapacity = Math.ceil(vertices * CAPACITY_HEADROOM);
          batch.mesh.setGeometrySize(batch.vertexCapacity, 0);
        }
        this.stats.secondaryBatchGrowths++; this.stats.secondaryGrowthsThisUpdate++;
        if (this.profile) this.timings.growthMs += performance.now() - started;
      }
      if (need.vertices > batch.mesh.unusedVertexCount) {
        const started = this.profile ? performance.now() : 0;
        batch.mesh.optimize();
        if (this.profile) this.timings.compactionMs += performance.now() - started;
      }
    }
    for (const { fragment, surfaces } of added) {
      this.insert(fragment, surfaces, demand);
    }
    this.revision = frame.revision;
    this.count = frame.fragments.length;
  }

  private surfaces(fragment: SecondaryFragmentDef): Array<PendingSurface> {
    const started = this.profile ? performance.now() : 0;
    const result: Array<PendingSurface> = [];
    for (const surface of SURFACES) {
      const geometry = fragmentSurfaceGeometry(fragment, surface);
      if (!geometry) {
        continue;
      }
      const material = this.materialFor(fragment, surface);
      result.push({
        key: `surface:${material.uuid}`,
        geometry,
        material,
        vertices: geometry.getAttribute('position').count,
      });
    }
    const edge = fragmentEdgeGeometry(fragment);
    if (edge) {
      const material = this.materialFor(fragment, 'fracture');
      result.push({ key: `edge:${material.uuid}`, geometry: edge, material, vertices: edge.getAttribute('position').count });
    }
    this.stats.secondaryGeometryBuilds += result.length;
    this.stats.secondarySurfacesAddedThisUpdate += result.length;
    if (this.profile) this.timings.geometryMs += performance.now() - started;
    return result;
  }

  private insert(
    fragment: SecondaryFragmentDef,
    surfaces: Array<PendingSurface>,
    demand: Map<string, { instances: number; vertices: number }>,
  ): void {
    const parts: Array<SecondaryPart> = [];
    for (const surface of surfaces) {
      const batch =
        this.batches.get(surface.key) ??
        this.createBatch(surface.key, surface.material, demand.get(surface.key)!);
      const geometry = batch.mesh.addGeometry(surface.geometry);
      const instance = batch.mesh.addInstance(geometry);
      batch.mesh.bind(instance, this.pool.slots.get(`secondary:${fragment.id}`) ?? 0);
      surface.geometry.dispose();
      batch.fragmentIds[instance] = fragment.id;
      batch.liveInstances++;
      batch.liveVertices += surface.vertices;
      parts.push({ batch, geometry, instance, vertices: surface.vertices });
    }
    this.entries.set(fragment.id, {
      moving: false,
      lastSlot: -1,
      poolSlot: 0,
      poolGeneration: -1,
      visible: true,
      generation: fragment.generation,
      mass: fragment.mass,
      parentId: fragment.parentId,
      parts,
      rootId: fragment.rootId,
    });
  }

  private remove(id: number, entry: SecondaryEntry): void {
    for (const part of entry.parts) {
      const { batch } = part;
      batch.mesh.deleteInstance(part.instance);
      batch.mesh.deleteGeometry(part.geometry);
      batch.fragmentIds[part.instance] = -1;
      batch.liveInstances--;
      batch.liveVertices -= part.vertices;
    }
    this.entries.delete(id);
  }

  private createBatch(
    key: string,
    material: Material,
    need: { instances: number; vertices: number },
  ): SecondaryBatch {
    const vertexCapacity = Math.max(
      MIN_VERTEX_CAPACITY,
      Math.ceil(need.vertices * CAPACITY_HEADROOM),
    );
    const mesh = new PooledBatchedMesh(
      this.pool,
      Math.max(MIN_INSTANCE_CAPACITY, Math.ceil(need.instances * CAPACITY_HEADROOM)),
      vertexCapacity,
      material,
    );
    mesh.name = key.startsWith('edge:') ? 'secondary-damaged-edges' : 'secondary-concrete';
    mesh.castShadow = !material.transparent;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.perObjectFrustumCulled = false;
    mesh.sortObjects = material.transparent;
    const fragmentIds: Array<number> = [];
    mesh.userData.fragmentIds = fragmentIds;
    const batch: SecondaryBatch = {
      fragmentIds,
      liveInstances: 0,
      liveVertices: 0,
      material,
      mesh,
      vertexCapacity,
    };
    this.batches.set(key, batch);
    this.group.add(mesh);
    return batch;
  }

  private rebuild(frame: SecondaryFractureFrame): void {
    this.stats.secondaryRebuilds++;
    this.clear();
    const unique = new Map<number, SecondaryFragmentDef>();
    for (const fragment of frame.fragments) {
      unique.set(fragment.id, fragment);
    }
    const pending = [...unique.values()].map((fragment) => ({
      fragment,
      surfaces: this.surfaces(fragment),
    }));
    const demand = new Map<string, { instances: number; vertices: number }>();
    for (const { surfaces } of pending) {
      for (const surface of surfaces) {
        const need = demand.get(surface.key) ?? { instances: 0, vertices: 0 };
        need.instances++;
        need.vertices += surface.vertices;
        demand.set(surface.key, need);
      }
    }
    for (const { fragment, surfaces } of pending) {
      this.insert(fragment, surfaces, demand);
    }
    this.revision = frame.revision;
    this.count = frame.fragments.length;
  }

  private clear(): void {
    if (this.batches.size) this.shadowRevision++;
    for (const { mesh } of this.batches.values()) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    this.batches.clear();
    this.entries.clear();
    this.revision = this.count = -1;
  }

  dispose(): void {
    this.clear();
    if (this.ownsPool) this.pool.dispose();
  }
}

function sameDefinition(entry: SecondaryEntry, fragment: SecondaryFragmentDef): boolean {
  return (
    entry.generation === fragment.generation &&
    entry.mass === fragment.mass &&
    entry.parentId === fragment.parentId &&
    entry.rootId === fragment.rootId
  );
}
