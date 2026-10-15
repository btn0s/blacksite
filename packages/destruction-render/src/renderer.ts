import {
  Color,
  Group,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { BufferGeometry, Material, Camera } from 'three';
import { FragmentState, TRANSFORM_STRIDE, MAX_SECONDARY_FRAGMENTS } from '../../destruction-domain/src/index';
import type {
  DestructibleManifest,
  FragmentDef,
  SimulationFrame,
} from '../../destruction-domain/src/index';
import { SecondaryFragmentRenderer } from './secondary';
import { fragmentEdgeGeometry, fragmentSurfaceGeometry } from './surfaces';
import type { FragmentSurface } from './surfaces';
import { GPUTransformPool, PooledBatchedMesh } from './gpu-pool';
import { DestructionEffects } from './effects';
import { ExposedFractureEdges } from './edges';
import { ConnectionOverlay } from './connections';

export type RenderPhase = 'bonds' | 'poolSync' | 'primary' | 'secondary' | 'edges' | 'connections' | 'effects' | 'poolFlush';
export type RenderTimings = Record<RenderPhase, number>;

export interface DestructionRendererOptions {
  /** Opt-in CPU phase timings; the object is reused on each update. */
  profile?: boolean;
  camera?: Camera;
  cameraShake?: number;
  showConnections?: boolean;
  effects?: boolean;
  particleCapacity?: number;
  transformCapacity?: number;
  reducedMotion?: boolean;
  materialFor?: (fragment: FragmentDef, surface: FragmentSurface) => Material | undefined;
}

function samePose(a: Float32Array, i: number, b: Float32Array, j: number): boolean {
  for (let k = 0; k < 7; k++) {
    if (a[i + k] !== b[j + k]) {
      return false;
    }
  }
  return true;
}

type SurfaceEntry = { fragment: number; geometry: BufferGeometry; interior: boolean };
type FragmentSlot = { interior: boolean; mesh: PooledBatchedMesh; slot: number };

export class DestructionRenderer {
  readonly group = new Group();
  readonly timings: RenderTimings = { bonds: 0, poolSync: 0, primary: 0, secondary: 0, edges: 0, connections: 0, effects: 0, poolFlush: 0 };
  private phaseAt = 0;
  private markPhase(phase: RenderPhase): void {
    if (!this.options.profile) return;
    const now = performance.now();
    this.timings[phase] = now - this.phaseAt;
    this.phaseAt = now;
  }
  readonly transformPool: GPUTransformPool;
  private readonly meshes: Array<PooledBatchedMesh> = [];
  private readonly effects: DestructionEffects;
  private readonly edges: ExposedFractureEdges;
  private readonly connections: ConnectionOverlay;
  private readonly options: DestructionRendererOptions;
  private readonly motionQuery?: MediaQueryList;
  private readonly motionListener = () => { this.reducedMotion = this.motionQuery?.matches ?? false; };
  private reducedMotion = false;
  private time = 0;
  private lastTime = 0;
  private lastLayoutTick = -Infinity;
  private layoutRevision = -1;
  private secondaryRevision = -1;
  private readonly neighbours: Array<Array<number>>;
  private readonly slots: Array<Array<FragmentSlot>>;
  private poseFrame?: SimulationFrame | null;
  private posePrevious?: SimulationFrame;
  private readonly updateIndices: Uint32Array;
  private updateCount = 0;
  private readonly moving: Uint8Array;
  private readonly boundSlots: Uint32Array;
  private readonly boundGenerations: Uint32Array;
  private readonly materials = new Map<string, Material>();
  private readonly secondary: SecondaryFragmentRenderer;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly target = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly oldRotation = new Quaternion();
  private readonly scale = new Vector3(1, 1, 1);
  private disposed = false;
  private bondRevision = -1;
  private shadowVisibilityRevision = 0;
  private lastSnapshotTick = -Infinity;
  private connectionsDirty = false;

  get secondaryStats() { return this.secondary.stats; }
  get secondaryTimings() { return this.secondary.timings; }

  get edgeTimings() { return this.edges.timings; }
  get edgeStats() { return this.edges.stats; }

  /** Changes only when shared caster transforms, geometry or visibility change. */
  get shadowRevision(): number {
    return this.transformPool.matrices.version + this.shadowVisibilityRevision + this.secondary.shadowRevision;
  }

  constructor(
    readonly manifest: DestructibleManifest,
    options: DestructionRendererOptions = {},
  ) {
    this.options = options;
    this.group.name = 'cascade-destruction';
    this.transformPool = new GPUTransformPool(options.transformCapacity ?? manifest.fragments.length + MAX_SECONDARY_FRAGMENTS + 1);
    this.effects = new DestructionEffects(options.particleCapacity);
    this.effects.group.visible = options.effects !== false;
    this.effects.shake.setCamera(options.camera);
    this.transformPool.onCamera = camera => this.effects.shake.discover(camera);
    if (options.reducedMotion === undefined && typeof matchMedia === 'function') {
      this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
      this.motionQuery.addEventListener('change', this.motionListener);
    }
    this.reducedMotion = options.reducedMotion ?? this.motionQuery?.matches ?? false;
    this.slots = manifest.fragments.map(() => []);
    this.updateIndices = new Uint32Array(manifest.fragments.length);
    this.moving = new Uint8Array(manifest.fragments.length);
    this.boundSlots = new Uint32Array(manifest.fragments.length);
    this.boundGenerations = new Uint32Array(manifest.fragments.length);
    this.neighbours = manifest.fragments.map(() => []);
    const materialFor = (fragment: FragmentDef, surface: FragmentSurface): Material =>
      options.materialFor?.(fragment, surface) ?? this.defaultMaterial(fragment, surface);
    this.secondary = new SecondaryFragmentRenderer(materialFor, this.transformPool, options.profile);
    this.edges = new ExposedFractureEdges(manifest, this.transformPool, fragment => materialFor(fragment, 'fracture'), options.profile);
    this.connections = new ConnectionOverlay(manifest, this.transformPool);
    this.connections.object.visible = options.showConnections ?? false;
    const surfaceGroups = new Map<Material, Array<SurfaceEntry>>();
    const edgeGroups = new Map<Material, Array<SurfaceEntry>>();
    for (const [index, fragment] of manifest.fragments.entries()) {
      for (const surface of ['exterior', 'fracture'] as const) {
        const geometry = fragmentSurfaceGeometry(fragment, surface);
        if (!geometry) {
          continue;
        }
        const material = materialFor(fragment, surface);
        const entries = surfaceGroups.get(material) ?? [];
        entries.push({ fragment: index, geometry, interior: surface === 'fracture' });
        surfaceGroups.set(material, entries);
      }
      const edge = fragmentEdgeGeometry(fragment);
      if (edge) {
        const material = materialFor(fragment, 'fracture');
        const entries = edgeGroups.get(material) ?? [];
        entries.push({ fragment: index, geometry: edge, interior: true });
        edgeGroups.set(material, entries);
      }
    }
    const white = new Color('white');
    for (const [channel, groups] of [['surface', surfaceGroups], ['edge', edgeGroups]] as const) for (const [material, entries] of groups) {
      const mesh = new PooledBatchedMesh(
        this.transformPool,
        entries.length,
        entries.reduce((total, entry) => total + entry.geometry.getAttribute('position').count, 0),
        material,
      );
      mesh.name = channel === 'surface' ? 'cascade-fragments' : 'cascade-damaged-edges';
      mesh.castShadow = !material.transparent;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.perObjectFrustumCulled = false;
      mesh.sortObjects = material.transparent;
      const fragmentIds: Array<number> = [];
      for (const { fragment, geometry, interior } of entries) {
        const slot = mesh.addInstance(mesh.addGeometry(geometry));
        this.slots[fragment]!.push({ interior, mesh, slot });
        fragmentIds[slot] = manifest.fragments[fragment]!.id;
        mesh.setColorAt(slot, white);
        geometry.dispose();
      }
      mesh.userData.fragmentIds = fragmentIds;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    const indices = new Map(manifest.fragments.map((fragment, index) => [fragment.id, index]));
    const interior = this.slots.map((slots) => slots.some((slot) => slot.interior));
    for (const bond of manifest.bonds) {
      const a = indices.get(bond.a);
      const b = indices.get(bond.b);
      if (a === undefined || b === undefined || a === b) {
        continue;
      }
      if (interior[a]) {
        this.neighbours[a]!.push(b);
      }
      if (interior[b]) {
        this.neighbours[b]!.push(a);
      }
    }
    this.group.add(this.secondary.group, this.edges.group, this.effects.group, this.connections.object);
    this.update();
  }

  update(frame?: SimulationFrame | null, previous?: SimulationFrame | null, blend = 1): void {
    if (this.disposed) {
      throw new Error('Destruction renderer has been disposed');
    }
    if (this.options.profile) this.phaseAt = performance.now();
    const count = this.manifest.fragments.length;
    if (
      frame &&
      (frame.transforms.length < count * TRANSFORM_STRIDE || frame.states.length < count)
    ) {
      throw new Error('Destruction frame does not match the renderer manifest');
    }
    if (frame?.bonds && this.bondRevision !== frame.bondRevision) {
      const indices = new Map(this.manifest.fragments.map((fragment, index) => [fragment.id, index]));
      for (const neighbours of this.neighbours) neighbours.length = 0;
      for (const bond of frame.bonds) {
        const a = indices.get(bond.a), b = indices.get(bond.b);
        if (a === undefined || b === undefined || a === b) continue;
        this.neighbours[a]!.push(b);
        this.neighbours[b]!.push(a);
      }
      this.bondRevision = frame.bondRevision ?? 0;
    }
    this.markPhase('bonds');
    const now = performance.now() / 1000;
    if (this.lastTime && !frame?.paused) this.time += Math.min(0.1, Math.max(0, now - this.lastTime));
    this.lastTime = now;
    const layoutChanged = this.synchronizeTransforms(frame);
    this.markPhase('poolSync');
    const alpha = Number.isFinite(blend) ? Math.max(0, Math.min(1, blend)) : 1;
    const old =
      previous &&
      frame &&
      previous.tick <= frame.tick &&
      previous.transforms.length >= count * TRANSFORM_STRIDE &&
      previous.states.length >= count
        ? previous
        : undefined;
    // Inspect the manifest only on snapshot arrival. Display-rate work visits the compact
    // moving/changed list; stationary slots retain their matrices across snapshots.
    if (frame !== this.poseFrame || old !== this.posePrevious || layoutChanged) {
      this.updateCount = 0;
      for (let index = 0; index < count; index++) {
        const fragment = this.manifest.fragments[index]!;
        const offset = index * TRANSFORM_STRIDE;
        const active = frame
          ? frame.states[index] !== FragmentState.Retired && frame.states[index] !== FragmentState.Hidden
          : fragment.parent === undefined || fragment.parent === -1;
        const poolSlot = active ? this.transformPool.slots.get(`primary:${index}`) ?? 0 : 0;
        const generation = this.transformPool.generationBySlot[poolSlot]!;
        const rebound = poolSlot !== this.boundSlots[index] || generation !== this.boundGenerations[index];
        this.boundSlots[index] = poolSlot;
        this.boundGenerations[index] = generation;
        let exposed = false;
        if (active && frame) {
          exposed = (frame.transforms[offset + 7] ?? 0) >= 1 || frame.states[index] !== FragmentState.Supported;
          if (!exposed) {
            for (const neighbour of this.neighbours[index]!) {
              if (frame.states[neighbour] === FragmentState.Retired) { exposed = true; break; }
            }
          }
        }
        for (const binding of this.slots[index]!) {
          if (rebound) binding.mesh.bind(binding.slot, poolSlot);
          const visible = active && (!binding.interior || exposed);
          if (binding.mesh.castShadow && binding.mesh.getVisibleAt(binding.slot) !== visible) this.shadowVisibilityRevision++;
          binding.mesh.setVisibleAt(binding.slot, visible);
        }
        const wasMoving = this.moving[index] !== 0;
        const interpolates = !!(active && frame && old &&
          frame.states[index] !== FragmentState.Supported &&
          old.states[index] !== FragmentState.Retired && old.states[index] !== FragmentState.Hidden &&
          !samePose(frame.transforms, offset, old.transforms, offset));
        this.moving[index] = interpolates ? 1 : 0;
        if (active && (rebound || wasMoving || interpolates || !frame || !this.poseFrame ||
          frame.states[index] !== this.poseFrame.states[index] ||
          !samePose(frame.transforms, offset, this.poseFrame.transforms, offset))) {
          this.updateIndices[this.updateCount++] = index;
        }
      }
      this.poseFrame = frame;
      this.posePrevious = old;
    }
    let movingCount = 0;
    for (let cursor = 0; cursor < this.updateCount; cursor++) {
      const index = this.updateIndices[cursor]!;
      const offset = index * TRANSFORM_STRIDE;
      if (frame) {
        this.position.fromArray(frame.transforms, offset);
        this.rotation.fromArray(frame.transforms, offset + 3);
        if (old && this.moving[index]) {
          this.target.copy(this.position);
          this.position.fromArray(old.transforms, offset).lerp(this.target, alpha);
          this.oldRotation.fromArray(old.transforms, offset + 3).slerp(this.rotation, alpha);
          this.rotation.copy(this.oldRotation);
        }
      } else {
        this.position.fromArray(this.manifest.fragments[index]!.position);
        this.rotation.identity();
      }
      this.matrix.compose(this.position, this.rotation, this.scale);
      // Exterior, interior and damaged edges share this slot: write its matrix just once.
      this.transformPool.write(this.boundSlots[index]!, this.matrix);
      if (this.moving[index]) this.updateIndices[movingCount++] = index;
    }
    this.updateCount = movingCount;
    this.markPhase('primary');
    this.secondary.update(frame?.secondary, old?.secondary, alpha, undefined, frame?.tick);
    this.markPhase('secondary');
    const snapshotTick = frame?.tick ?? -1;
    const snapshotChanged = snapshotTick !== this.lastSnapshotTick;
    if (snapshotChanged || layoutChanged) this.edges.update(frame);
    else this.edges.resetUpdateStats();
    this.markPhase('edges');
    if (snapshotChanged || layoutChanged || this.connectionsDirty) {
      this.connections.update(frame);
      this.connectionsDirty = false;
    }
    this.markPhase('connections');
    if (snapshotChanged) this.effects.update(frame, this.time, this.reducedMotion);
    else this.effects.advance(this.time, this.reducedMotion);
    this.lastSnapshotTick = snapshotTick;
    this.effects.shake.update(this.time, this.reducedMotion, this.options.cameraShake ?? 1);
    this.markPhase('effects');
    this.transformPool.flush();
    this.markPhase('poolFlush');
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    this.meshes.length = 0;
    for (const slots of this.slots) {
      slots.length = 0;
    }
    this.secondary.dispose();
    this.edges.dispose(); this.effects.dispose(); this.connections.dispose();
    this.transformPool.dispose();
    this.motionQuery?.removeEventListener('change', this.motionListener);
    this.group.remove(this.secondary.group, this.edges.group, this.effects.group, this.connections.object);
    for (const material of this.materials.values()) {
      material.dispose();
    }
    this.materials.clear();
  }

  setCamera(camera?: Camera): void { this.effects.shake.setCamera(camera); }
  /** Hosts that write their camera after update() can apply the current shake once afterward. */
  applyCameraShake(camera?: Camera): void {
    if (camera) this.setCamera(camera);
    this.effects.shake.update(this.time, this.reducedMotion, this.options.cameraShake ?? 1);
  }
  setShowConnections(visible: boolean): void {
    if (this.connections.object.visible === visible) return;
    this.connections.object.visible = visible;
    this.connectionsDirty = true;
  }
  get showConnections(): boolean { return this.connections.object.visible; }
  setReducedMotion(reduced: boolean): void { this.reducedMotion = reduced; }

  private synchronizeTransforms(frame?: SimulationFrame | null): boolean {
    const tick = frame?.tick ?? -1;
    if (this.lastLayoutTick === tick && this.layoutRevision === (frame?.hierarchyRevision ?? -1) && this.secondaryRevision === (frame?.secondary?.revision ?? -1)) return false;
    this.lastLayoutTick = tick;
    this.layoutRevision = frame?.hierarchyRevision ?? -1;
    this.secondaryRevision = frame?.secondary?.revision ?? -1;
    const owners = new Map<string, string[]>();
    const claimed = new Set<number>();
    for (const actor of frame?.actors ?? []) {
      const members = actor.visibleChunks.filter(index => frame!.states[index] !== FragmentState.Retired && frame!.states[index] !== FragmentState.Hidden);
      owners.set(`actor:${actor.id}`, members.map(index => `primary:${index}`));
      for (const index of members) claimed.add(index);
    }
    const unclaimed: string[] = [];
    for (let index = 0; index < this.manifest.fragments.length; index++) {
      const fragment = this.manifest.fragments[index]!;
      const visible = frame ? frame.states[index] !== FragmentState.Retired && frame.states[index] !== FragmentState.Hidden : fragment.parent === undefined || fragment.parent === -1;
      if (visible && !claimed.has(index)) unclaimed.push(`primary:${index}`);
    }
    if (unclaimed.length) owners.set('unassigned', unclaimed);
    for (const [index, fragment] of (frame?.secondary?.fragments ?? []).entries()) {
      if (frame!.secondary!.states[index] !== FragmentState.Retired) owners.set(`secondary:${fragment.id}`, [`secondary:${fragment.id}`]);
    }
    return this.transformPool.synchronize(owners);
  }

  private defaultMaterial(fragment: FragmentDef, surface: FragmentSurface): Material {
    const key = `${fragment.material}:${surface}`;
    const known = this.materials.get(key);
    if (known) {
      return known;
    }
    const definition = this.manifest.materials.find(
      (material) => material.id === fragment.material,
    );
    const glass = /glass|glazing/i.test(definition?.name ?? '');
    const steel = /steel|metal/i.test(definition?.name ?? '');
    const color = new Color(definition?.color ?? '#a29d91');
    if (surface === 'fracture' && !glass) {
      color.lerp(new Color('#c9c2b4'), 0.2);
    }
    const material = new MeshStandardMaterial({
      color,
      depthWrite: !glass,
      metalness: steel ? 0.55 : 0,
      opacity: glass ? 0.4 : 1,
      roughness: glass ? 0.18 : steel ? 0.48 : 0.92,
      transparent: glass,
    });
    material.name = `cascade-${definition?.name ?? fragment.material}-${surface}`;
    this.materials.set(key, material);
    return material;
  }
}
