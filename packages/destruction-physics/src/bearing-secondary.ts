import {
  BondState,
  type BondDef,
  type DestructibleManifest,
  type FragmentDef,
  type MaterialDef,
  type Quat,
  type Vec3,
} from '../../destruction-domain/src/index';
import { DirectStructuralSolver } from '../../destruction-graph/src/direct';
import type { StructuralLoads } from '../../destruction-graph/src/loads';

export interface SecondaryBearingReaction {
  /** Current reaction on the piece, in asset axes, applied at the aggregate section centroid. */
  force: Vec3;
  /** Current couple at that centroid, in asset axes (the COM lever arm is not included). */
  moment: Vec3;
}
export interface SecondaryBearingResult {
  complete: boolean;
  elapsedMs: number;
  workUsed: number;
  workRemaining: number;
  workDeferred: number;
  /** A failed family stays failed until explicitly removed. */
  failed: number[];
  /** Only families whose current load has a completed, unbroken solve may be baked. */
  ready: Set<number>;
  reactions: Map<number, SecondaryBearingReaction>;
}
interface Family {
  fragment: FragmentDef;
  bond: BondDef;
  rotation: Quat;
  definitionKey: string;
  failed: boolean;
  solver?: DirectStructuralSolver;
  /** Freshness marker for diagnostics; skipped families keep their previous result. */
  lastSolveTick?: number;
  deferredWork?: number;
  pendingForces: Array<{ position: Vec3; impulse: Vec3 }>;
  pendingSamples: Array<{ dt: number; ambient: Float64Array; forces: Array<{ position: Vec3; impulse: Vec3 }> }>;
  states: Uint8Array;
  damage: Float32Array;
  active: Uint8Array;
  loads: StructuralLoads;
}

function inverseRotate(v: Vec3, q: Quat): Vec3 {
  const x = -q[0], y = -q[1], z = -q[2], w = q[3];
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty,
    v[1] + w * ty + z * tx - x * tz,
    v[2] + w * tz + x * ty - y * tx];
}

/**
 * Stand-alone pieces have their own one-node structural family. The registered
 * contact section is the sole world connection; no retired authored root participates.
 * Registration queues construction so even initial factorization shares the step budget.
 */
export class SecondaryBearingSolver {
  private readonly families = new Map<number, Family>();
  private readonly materials: MaterialDef[];
  private readonly materialIds: Set<number>;
  private cursor = 0;
  private tick = 0;
  private readonly missingFamilies = new Set<string>();

  private reportMissingFamily(context: string, id: number): void {
    const key = `${context}:${id}`;
    if (this.missingFamilies.has(key)) return;
    if (this.missingFamilies.size >= 256) this.missingFamilies.delete(this.missingFamilies.values().next().value!);
    this.missingFamilies.add(key);
    console.warn('[Cascade bearing] Skipping removed secondary family', { context, id });
  }

  constructor(materials: ReadonlyArray<MaterialDef>) {
    this.materials = [...materials];
    this.materialIds = new Set(materials.map(material => material.id));
  }

  /** Bond geometry and the fragment's COM are in its asset frame; rotation maps that frame to world. */
  register(id: number, fragment: FragmentDef, rotation: Quat, bonds: ReadonlyArray<Omit<BondDef, 'id'>>): void {
    if (!Number.isSafeInteger(id) || !(fragment.mass > 0) || !Number.isFinite(fragment.mass) ||
      !this.materialIds.has(fragment.material) || rotation.length !== 4 || !rotation.every(Number.isFinite) ||
      Math.abs(Math.hypot(...rotation) - 1) > 1e-4) throw new Error('Invalid standalone bearing family');
    if (bonds.length !== 1 || bonds[0]!.a !== fragment.id || bonds[0]!.b !== -1) {
      throw new Error('Standalone bearing requires one aggregate world bond on the runtime piece');
    }
    const source = bonds[0]!;
    // The new physical contact has no authored baseline or inherited root connection.
    const bond: BondDef = { ...source, id: 0, joint: false, parentBond: undefined, areaFraction: undefined,
      normal: [...source.normal], centroid: source.centroid ? [...source.centroid] : undefined,
      section: source.section ? { ...source.section, point: [...source.section.point],
        tangent1: [...source.section.tangent1], tangent2: [...source.section.tangent2] } : undefined };
    const definitionKey = JSON.stringify([fragment.id, fragment.mass, fragment.material, fragment.position,
      fragment.size, fragment.shape?.inertia, bond]);
    const previous = this.families.get(id);
    if (previous && previous.definitionKey === definitionKey) {
      previous.rotation = [...rotation];
      return;
    }
    this.families.set(id, {
      // Authoring ancestry does not belong to this independent runtime family.
      fragment: { ...fragment, parent: -1, support: true, anchored: false,
        position: [...fragment.position], size: [...fragment.size] },
      bond, rotation: [...rotation], definitionKey, failed: previous?.failed ?? false,
      pendingForces: previous?.pendingForces ?? [],
      pendingSamples: previous?.pendingSamples ?? [],
      states: new Uint8Array([previous?.failed ? BondState.Broken : BondState.Intact]),
      damage: new Float32Array(1), active: new Uint8Array([1]),
      loads: { clamped: new Uint8Array(1), groupOf: new Int32Array(1), groups: [[0]],
        participating: new Uint8Array([1]), rhs: new Float64Array(6), solverGroups: new Int32Array(1), tick: 0 },
    });
  }

  remove(id: number): void { this.families.delete(id); }

  /** Gravity and externally supplied asset-frame wrenches use the body's current pose. */
  setRotation(id: number, rotation: Quat): void {
    if (!rotation.every(Number.isFinite) || Math.abs(Math.hypot(...rotation) - 1) > 1e-4) {
      throw new Error('Invalid standalone bearing rotation');
    }
    const family = this.families.get(id);
    if (!family) {
      this.reportMissingFamily('rotation', id);
      return;
    }
    family.rotation = [...rotation];
  }

  /** Native transient contact impulse in the registered piece's asset frame. */
  addForce(id: number, position: Vec3, impulse: Vec3): void {
    const family = this.families.get(id);
    if (!family) {
      this.reportMissingFamily('impulse', id);
      return;
    }
    if (family.failed) return;
    if (!position.every(Number.isFinite) || !impulse.every(Number.isFinite)) throw new Error('Invalid standalone bearing impulse');
    family.pendingForces.push({ position: [...position], impulse: [...impulse] });
  }

  /** Extra loads are asset-frame force/moment at the piece COM, excluding its own bearing reaction. */
  solve(dt: number, workLimit: number, loads: ReadonlyMap<number, ReadonlyArray<number>>): SecondaryBearingResult {
    const started = performance.now();
    if (!(dt > 0) || !Number.isFinite(dt) || (workLimit !== Infinity && (!Number.isSafeInteger(workLimit) || workLimit < 0))) {
      throw new Error('Invalid standalone bearing solve quota');
    }
    const result: SecondaryBearingResult = { complete: true, elapsedMs: 0, workUsed: 0,
      workRemaining: workLimit, workDeferred: 0, failed: [], ready: new Set(), reactions: new Map() };
    const ids = [...this.families.keys()];
    const start = ids.length ? this.cursor % ids.length : 0;
    let visited = 0;
    this.tick++;
    const currentImpulseFamilies = new Set<number>();
    // Seal EVERY family's input at every physics step, before checking the
    // service budget. Skipped families keep separate original-duration samples
    // instead of adding several steps' impulses into one later RHS.
    for (const [id, family] of this.families) {
      if (family.failed) continue;
      const extra = loads.get(id);
      if (extra && (extra.length !== 6 || !Array.from(extra).every(Number.isFinite))) {
        throw new Error('Invalid standalone bearing wrench');
      }
      const gravity = inverseRotate([0, -family.fragment.mass * 9.81, 0], family.rotation);
      family.loads.rhs.fill(0);
      if (extra) family.loads.rhs.set(extra);
      for (let axis = 0; axis < 3; axis++) family.loads.rhs[axis]! += gravity[axis]!;
      family.loads.tick = this.tick;
      if (family.pendingForces.length) {
        currentImpulseFamilies.add(id);
        const sample = { dt, ambient: family.loads.rhs.slice(), forces: family.pendingForces.splice(0) };
        if (family.solver) family.solver.enqueueImpulseSample(sample.dt, [0], sample.ambient,
          sample.forces.map(force => ({ chunk: 0, ...force })));
        else family.pendingSamples.push(sample);
      }
    }
    for (; visited < ids.length; visited++) {
      const id = ids[(start + visited) % ids.length]!;
      const family = this.families.get(id);
      if (!family) {
        this.reportMissingFamily('solve', id);
        continue;
      }
      if (family.failed) { result.failed.push(id); continue; }
      if (result.workRemaining <= 0) { result.complete = false; break; }
      if (!family.solver) {
        const manifest: DestructibleManifest = {
          schemaVersion: 1, coordinateSystem: 'Y_UP_RH', name: `secondary-bearing-${id}`,
          assetHash: `secondary-bearing-${id}`, scenario: 'building',
          fragments: [family.fragment], bonds: [family.bond], materials: this.materials, regions: [],
        };
        family.solver = new DirectStructuralSolver(manifest, {
          deferInitialization: true,
          captureStaticReactions: true,
          // Seed BEFORE any gravity/contact load is applied, including the first solve.
          initialBaselineRates: new Map([[family.bond.id, 0]]),
        });
        for (const sample of family.pendingSamples) family.solver.enqueueImpulseSample(sample.dt, [0], sample.ambient,
          sample.forces.map(force => ({ chunk: 0, ...force })));
        family.pendingSamples.length = 0;
      }
      family.lastSolveTick = this.tick;
      const solved = family.solver.solve(family.states, family.damage, family.active, family.loads, dt, { workLimit: result.workRemaining });
      family.deferredWork = solved.workDeferred;
      result.workUsed += solved.workUsed;
      result.workRemaining = Math.max(0, workLimit - result.workUsed);
      result.workDeferred += solved.workDeferred;
      if (solved.fractures.bonds.some(command => command.bond === 0 && command.health > 0)) {
        family.states[0] = BondState.Broken;
        family.failed = true;
        result.failed.push(id);
        continue;
      }
      if (!solved.complete || !solved.solvedBonds[0] || solved.deferredImpulseNodes[0] || currentImpulseFamilies.has(id)) { result.complete = false; continue; }
      result.ready.add(id);
      // Only steady load-bearing reactions transfer to a provider. Neither a
      // current transient contact pulse nor a historical impulse is repeated.
      const actions = solved.staticActions;
      result.reactions.set(id, {
        force: [actions.forceX[0]!, actions.forceY[0]!, actions.forceZ[0]!],
        moment: [actions.momentX[0]!, actions.momentY[0]!, actions.momentZ[0]!],
      });
    }
    // Rotate service after an exhausted budget; pending families cannot be starved by stable ones.
    if (ids.length) this.cursor = (start + Math.max(1, visited)) % ids.length;
    if (visited < ids.length) for (let index = visited; index < ids.length; index++) {
      const id = ids[(start + index) % ids.length]!;
      const family = this.families.get(id);
      if (!family) {
        this.reportMissingFamily('deferred work', id);
        continue;
      }
      if (family.failed) result.failed.push(id);
      else result.workDeferred += family.deferredWork || 6;
    }
    result.elapsedMs = performance.now() - started;
    return result;
  }
}
