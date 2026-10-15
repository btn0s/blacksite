import {
  BondState,
  type BondDef,
  type DestructibleManifest,
  type FractureCommandBuffer,
  type MaterialDef,
  type Vec3,
} from '../../destruction-domain/src/index';
import { getBondSection, type BondActions, type BondSection } from './equilibrium';
import type { StructuralLoads } from './loads';
import { materialStrengths } from './stress';

export interface DirectSolverOptions {
  /** Legacy nominal-time scale, converted to fixed phase-weighted work units. */
  budgetMs?: number;
  /** Weighted integer work quota. Creation and the initial gravity factorization are unbudgeted. */
  workLimit?: number;
  masses?: ArrayLike<number>;
  /** Resolve deferred impulses after their source chunk is demoted or removed. */
  resolveForceNode?(chunk: number, position: Vec3): number;
  /** Runtime-created supports start unloaded; their first loaded solve must not become a baseline. */
  initialBaselineRates?: ReadonlyMap<number, number>;
  /** Runtime families share the caller's next solve budget instead of factoring in the constructor. */
  deferInitialization?: boolean;
  /** Runtime bearing owners need ambient reactions separately from impact samples. */
  captureStaticReactions?: boolean;
}

export interface DirectSolveResult extends BondActions {
  fractures: FractureCommandBuffer;
  elasticBonds: Array<number>;
  /** Native joint samples remain valid even if unrelated factor work exceeded budget. */
  measuredBonds: Array<number>;
  /** Combined connection impulse, gravity baseline and remaining offset, all in N s. */
  combinedImpulse: Float64Array;
  baselineImpulse: Float64Array;
  breakOffset: Float64Array;
  utilization: Float64Array;
  displacement: Float64Array;
  /** The final force/moment RHS, including queued impulses and free-body balancing. */
  rhs: Float64Array;
  overBudget: boolean;
  complete: boolean;
  elapsedMs: number;
  /** Quota and consumption in weighted integer units, not raw operation counts. */
  workLimit: number;
  /** Numeric operations cost one unit; symbolic operations use the fixed measured conversion. */
  workUsed: number;
  workRemaining: number;
  /** Minimum remaining bond-action work for unfinished components or retained impacts. */
  workDeferred: number;
  factorizedColumns: number;
  reusedComponents: number;
  /** Completed component solutions restored after an exact balanced-RHS match. */
  cachedComponents: number;
  /** Components whose current RHS required a triangular solve and new bond actions. */
  solvedComponents: number;
  /** Connections with a completed direct solution, independent of other components' budgets. */
  solvedBonds: Uint8Array;
  /** Current world-connection reactions with addForce pulses excluded; validated by solvedBonds. */
  staticActions: BondActions;
  /** Nodes of components receiving an addForce sample in this solve, even after it is consumed. */
  currentImpulseNodes: Uint8Array;
  /** Components carrying an impulse still awaiting its direct solve must not consume it in the fallback. */
  deferredImpulseNodes: Uint8Array;
  deferredImpulseSamples: number;
  currentImpulseSampleId: number | null;
  /** Individual impact evaluations; later samples never inherit an earlier event's attribution. */
  impulseEvaluations: Array<{
    sampleId: number; dt: number; component: number; historical: boolean; loadedNodes: number[];
    bondCount: number; maxUtilization: number; fractureBonds: number[];
  }>;
}

type DirectMaterial = MaterialDef & {
  tensionElasticLimit?: number;
  tensionFatalLimit?: number;
  compressionElasticLimit?: number;
  compressionFatalLimit?: number;
  shearElasticLimit?: number;
  shearFatalLimit?: number;
  tensionMultiplier?: number;
  compressionMultiplier?: number;
  shearMultiplier?: number;
  bendingMultiplier?: number;
  /** Pressure in Pa in the score's reference channel, before area and dt. */
  breakOffset?: number;
};

interface Limits {
  tensionElastic: number;
  compressionElastic: number;
  shearElastic: number;
  bendingElastic: number;
  tensionFatal: number;
  compressionFatal: number;
  shearFatal: number;
  bendingFatal: number;
}

interface Channel {
  dofs: Array<number>;
  coefficients: Array<number>;
  direction: Vec3;
  stiffness: number;
}

interface Connection {
  index: number;
  a: number;
  b: number;
  definition: BondDef;
  section: BondSection;
  channels: Array<Channel>;
  limits: Limits;
  multipliers: [number, number, number, number];
  offsetPressure: number;
  actionWork: number;
}

interface Component {
  key: string;
  nodes: Array<number>;
  connections: Array<Connection>;
  fixed: Set<number>;
  grounded: boolean;
}

interface ComponentSolution {
  /** All six coordinates per node, including fixed nodes omitted from the factor. */
  rhs: Float64Array;
  displacement: Float64Array;
  connections: Int32Array;
  actions: Float64Array;
}

type ConnectionActions = { force: Vec3; moment: Vec3 };

interface InterfaceTreeNode {
  node: number;
  parent: number;
  parentSlot: number;
  edge: Connection;
  sign: number;
  arm: Vec3;
  parentArm: Vec3;
  dual: [Vec3, Vec3, Vec3];
}

interface MeasuredImpulse {
  linear: Vec3;
  angular: Vec3;
  sampleDt: number;
}
interface AppliedForce { chunk: number; position: Vec3; impulse: Vec3 }
interface ImpulseSample {
  id: number;
  dt: number;
  /** Ambient RHS at the event's time, before this sample's applied impulses. */
  ambientNodes: Int32Array;
  ambient: Float64Array;
  forces: AppliedForce[];
}

const COMPLIANT = BondState.Compliant;
const now = () => performance.now();
// The timed SIMD near-face replay measured 192,212 numeric operations/ms and
// 36,923 symbolic operations/ms. Round down separately instead of assigning
// cheap numeric arithmetic and graph/matrix preparation the same cost.
export const DIRECT_WORK_UNITS_PER_BUDGET_MS = 190_000;
export const SYMBOLIC_OPS_PER_NOMINAL_MS = 36_000;

/** Physics admission uses fixed weighted integer work; elapsed time is telemetry only. */
class WorkQuota {
  used = 0;
  constructor(readonly limit: number) {}
  get available(): boolean { return this.used < this.limit; }
  get remaining(): number { return Math.max(0, this.limit - this.used); }
  charge(units: number): void { this.used += units; }
  chargeSymbolic(operations: number): void {
    this.used += Math.ceil(operations * DIRECT_WORK_UNITS_PER_BUDGET_MS / SYMBOLIC_OPS_PER_NOMINAL_MS);
  }
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const positive = (value: number | undefined, fallback: number) =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
const multiplier = (value: number | undefined, fallback: number) =>
  value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;

function materialLimits(material: DirectMaterial): Limits {
  const strengths = materialStrengths(material);
  return {
    tensionElastic: positive(material.tensionElasticLimit, strengths.tension / 2),
    compressionElastic: positive(material.compressionElasticLimit, strengths.compression / 2),
    shearElastic: positive(material.shearElasticLimit, strengths.shear / 2),
    bendingElastic: strengths.bending / 2,
    tensionFatal: positive(material.tensionFatalLimit, strengths.tension * 2),
    compressionFatal: positive(material.compressionFatalLimit, strengths.compression * 2),
    shearFatal: positive(material.shearFatalLimit, strengths.shear * 2),
    bendingFatal: strengths.bending * 2,
  };
}

function connectionFor(
  manifest: DestructibleManifest,
  index: number,
  indices: Map<number, number>,
  materials: Map<number, DirectMaterial>,
): Connection {
  const definition = manifest.bonds[index]!;
  const a = indices.get(definition.a), b = definition.b === -1 ? -1 : indices.get(definition.b);
  if (a === undefined || b === undefined) throw new Error(`Invalid direct-solver bond ${definition.id}`);
  const first = manifest.fragments[a]!, second = b < 0 ? first : manifest.fragments[b]!;
  const materialA = materials.get(first.material)!, materialB = materials.get(second.material)!;
  if (!materialA || !materialB) throw new Error(`Missing material for bond ${definition.id}`);
  const section = getBondSection(manifest, definition, indices);
  const youngA = positive(materialA.youngModulus, 12e9), youngB = positive(materialB.youngModulus, 12e9);
  const poissonA = materialA.poissonRatio ?? 0.2, poissonB = materialB.poissonRatio ?? 0.2;
  if (!(poissonA > -1 && poissonA < 0.5 && poissonB > -1 && poissonB < 0.5)) {
    throw new Error('Invalid elastic material Poisson ratio');
  }
  const young = 2 / (1 / youngA + 1 / youngB);
  const shear = 2 / (2 * (1 + poissonA) / youngA + 2 * (1 + poissonB) / youngB);
  const basis = [section.normal, section.tangent1, section.tangent2];
  const stiffnesses = [
    young * section.area / section.length,
    shear * section.area / section.length,
    shear * section.area / section.length,
    shear * section.polarInertia / section.length,
    young * section.inertia1 / section.length,
    young * section.inertia2 / section.length,
  ];
  // Six rank-one channels assemble exactly K_e = B_e^T D_e B_e. B includes
  // the interface arms, so translation and rotation couple through bending.
  const channels = stiffnesses.map((stiffness, channel): Channel => {
    const direction = basis[channel % 3]!;
    const dofs: Array<number> = [], coefficients: Array<number> = [];
    for (const [node, sign, arm] of [[a, -1, section.armA], [b, 1, section.armB]] as const) {
      if (node < 0) continue;
      const rotational = channel < 3 ? cross(arm, direction) : direction;
      for (let axis = 0; axis < 6; axis++) {
        const value = axis < 3 ? (channel < 3 ? direction[axis]! : 0) : rotational[axis - 3]!;
        if (value !== 0) { dofs.push(node * 6 + axis); coefficients.push(sign * value); }
      }
    }
    return { dofs, coefficients, stiffness, direction };
  });
  const la = materialLimits(materialA), lb = materialLimits(materialB);
  const limits = Object.fromEntries(Object.keys(la).map((key) =>
    [key, Math.min(la[key as keyof Limits], lb[key as keyof Limits])])) as unknown as Limits;
  const reference = limits.tensionFatal;
  const multipliers: Connection['multipliers'] = [
    Math.max(multiplier(materialA.tensionMultiplier, reference / la.tensionFatal), multiplier(materialB.tensionMultiplier, reference / lb.tensionFatal)),
    Math.max(multiplier(materialA.compressionMultiplier, reference / la.compressionFatal), multiplier(materialB.compressionMultiplier, reference / lb.compressionFatal)),
    Math.max(multiplier(materialA.shearMultiplier, reference / la.shearFatal), multiplier(materialB.shearMultiplier, reference / lb.shearFatal)),
    Math.max(multiplier(materialA.bendingMultiplier, reference / la.bendingFatal), multiplier(materialB.bendingMultiplier, reference / lb.bendingFatal)),
  ];
  return {
    index, a, b, definition, section, channels, limits, multipliers,
    offsetPressure: Math.min(positive(materialA.breakOffset, reference), positive(materialB.breakOffset, reference)),
    actionWork: channels.reduce((sum, channel) => sum + channel.dofs.length + 3, 0),
  };
}

/** A connected tree with one world edge has one independent six-axis interface per node. */
function hasInterfaceCoordinates(component: Component): boolean {
  return component.fixed.size === 0 && component.connections.length === component.nodes.length &&
    component.connections.filter(edge => edge.b < 0).length === 1;
}

function interfaceTree(component: Component): InterfaceTreeNode[] {
  const incident = new Map<number, Connection[]>();
  for (const node of component.nodes) incident.set(node, []);
  const world = component.connections.find(edge => edge.b < 0)!;
  for (const edge of component.connections) if (edge.b >= 0) {
    incident.get(edge.a)!.push(edge); incident.get(edge.b)!.push(edge);
  }
  const entry = (edge: Connection, node: number, parent: number, parentSlot: number): InterfaceTreeNode => {
    const [normal, tangent1, tangent2] = edge.channels.slice(0, 3).map(channel => channel.direction);
    const dual = [cross(tangent1!, tangent2!), cross(tangent2!, normal!), cross(normal!, tangent1!)];
    const determinant = dot(normal!, dual[0]!);
    return { node, parent, parentSlot, edge, sign: node === edge.a ? -1 : 1,
      arm: node === edge.a ? edge.section.armA : edge.section.armB,
      parentArm: node === edge.a ? edge.section.armB : edge.section.armA,
      // Preserve the exact accepted frame, including slight nonorthogonality.
      dual: dual.map(direction => direction.map(value => value / determinant) as Vec3) as [Vec3, Vec3, Vec3] };
  };
  const tree = [entry(world, world.a, -1, -1)], visited = new Set([world.a]);
  for (let slot = 0; slot < tree.length; slot++) {
    const parent = tree[slot]!.node;
    for (const edge of incident.get(parent)!) {
      const node = edge.a === parent ? edge.b : edge.a;
      if (visited.has(node)) continue;
      visited.add(node); tree.push(entry(edge, node, parent, slot));
    }
  }
  if (tree.length !== component.nodes.length) throw new Error('Disconnected interface coordinate tree');
  return tree;
}

type InterfaceRow = Array<[coordinate: number, coefficient: number]>;

/** Only a finite nonpositive pivot may select another basis for the same K. */
class NonPositiveStructuralPivot extends Error {
  constructor(coordinate: number, readonly unchargedWork: number) {
    super(`Structural Cholesky lost positive definiteness at coordinate ${coordinate}`);
  }
}

/** Sparse lower-triangular Cholesky with a fixed symbolic superpattern. */
class SparseComponentFactor {
  readonly originalConnections: Set<number>;
  readonly liveConnections: Set<number>;
  permutation = new Int32Array(0);
  private readonly inverse = new Map<number, number>();
  private matrix: Array<Map<number, number>> = [];
  private rows: Array<Int32Array> = [];
  private values: Array<Float64Array> = [];
  private predecessors: Array<Array<{ column: number; offset: number }>> = [];
  private scale = new Float64Array(0);
  private dirty = new Uint8Array(0);
  private scratch = new Float64Array(0);
  private solution = new Float64Array(0);
  private columnValues = new Float64Array(0);
  private refactoring: Generator<number, number, void> | null = null;
  private completedColumns = 0;
  private solved?: ComponentSolution;
  private readonly definitions: Map<number, Connection>;
  private preparation: Generator<number, number, void> | null;
  private preparationRevision = 0;
  private triangularWork = 0;
  /** Exact q=B*u coordinates for a statically determinate world-rooted tree. */
  private interfaces?: InterfaceTreeNode[];
  /** Exceptional exact congruence; ordinary successful factors never enter it. */
  private stableInterfaceFactor = false;
  private stableFactorReady = false;
  private interfaceRows?: Map<number, InterfaceRow[]>;
  private interfaceWrenches = new Float64Array(0);
  private readonly interfaceSolutions = new WeakMap<Float64Array, Map<number, ConnectionActions>>();

  constructor(readonly component: Component) {
    this.originalConnections = new Set(component.connections.map((edge) => edge.index));
    this.liveConnections = new Set(this.originalConnections);
    this.definitions = new Map(component.connections.map((edge) => [edge.index, edge]));
    if (hasInterfaceCoordinates(component)) this.interfaces = interfaceTree(component);
    this.preparation = this.prepare();
  }

  /** Runtime symbolic work resumes across ticks just like numeric refactoring. */
  private *prepare(): Generator<number, number, void> {
    const component = this.component;
    if (this.interfaces) {
      // The same K=B^T D B is diagonal D in interface displacement coordinates.
      // At a narrow bearing, COM lever arms can overwhelm its weak bending mode
      // when forming K; this congruence retains every positive stiffness exactly.
      const channels = this.interfaces.flatMap(entry => entry.edge.channels), count = channels.length;
      this.permutation = Int32Array.from(this.interfaces.flatMap(entry => Array.from({ length: 6 }, (_, axis) => entry.node * 6 + axis)));
      this.matrix = channels.map((channel, axis) => new Map([[axis, channel.stiffness]]));
      this.rows = channels.map((_, axis) => new Int32Array([axis]));
      this.values = channels.map(() => new Float64Array(1));
      this.predecessors = channels.map(() => []);
      this.dirty = new Uint8Array(count).fill(1);
      this.scale = Float64Array.from(channels, channel => 1 / Math.sqrt(channel.stiffness));
      this.scratch = new Float64Array(count); this.solution = new Float64Array(count);
      this.columnValues = new Float64Array(count); this.interfaceWrenches = new Float64Array(count);
      this.triangularWork = count * 4;
      // Include traversal, reciprocal frames and diagonal symbolic storage.
      return count * 24;
    }
    const remaining = new Set(component.nodes.filter((node) => !component.fixed.has(node)));
    const adjacency = new Map<number, Set<number>>();
    for (const node of remaining) adjacency.set(node, new Set());
    let work = remaining.size, accounted = 0;
    for (const edge of component.connections) {
      if (remaining.has(edge.a) && remaining.has(edge.b)) {
        adjacency.get(edge.a)!.add(edge.b); adjacency.get(edge.b)!.add(edge.a);
      }
      if ((++work & 127) === 0) { yield work - accounted; accounted = work; }
    }
    // Block minimum degree: preserve each rigid chunk's six coordinates, and
    // discover fill once during creation. This never allocates a dense K or L.
    const order: Array<number> = [];
    const fill = new Map<number, Array<number>>();
    while (remaining.size) {
      let selected = -1, degree = Infinity;
      for (const node of remaining) {
        const count = adjacency.get(node)!.size;
        if (count < degree || (count === degree && node < selected)) { selected = node; degree = count; }
        if ((++work & 255) === 0) { yield work - accounted; accounted = work; }
      }
      const neighbours = [...adjacency.get(selected)!];
      fill.set(selected, neighbours); order.push(selected); remaining.delete(selected);
      for (const neighbour of neighbours) {
        const incident = adjacency.get(neighbour)!;
        incident.delete(selected);
        for (const other of neighbours) {
          if (other !== neighbour) incident.add(other);
          if ((++work & 255) === 0) { yield work - accounted; accounted = work; }
        }
      }
    }
    this.permutation = Int32Array.from(order.flatMap((node) => Array.from({ length: 6 }, (_, axis) => node * 6 + axis)));
    this.permutation.forEach((dof, local) => this.inverse.set(dof, local));
    const count = this.permutation.length;
    this.matrix = Array.from({ length: count }, () => new Map<number, number>());
    this.rows = new Array(count); this.values = new Array(count);
    this.predecessors = Array.from({ length: count }, () => []);
    this.dirty = new Uint8Array(count).fill(1);
    this.scale = new Float64Array(count); this.scratch = new Float64Array(count); this.solution = new Float64Array(count);
    this.columnValues = new Float64Array(count);
    work += count * 8;
    yield work - accounted; accounted = work;
    const rank = new Map(order.map((node, i) => [node, i]));
    for (let block = 0; block < order.length; block++) {
      const later = fill.get(order[block]!)!.map((node) => rank.get(node)!).sort((a, b) => a - b);
      for (let axis = 0; axis < 6; axis++) {
        const column = block * 6 + axis;
        const rows = Array.from({ length: 6 - axis }, (_, j) => column + j);
        for (const neighbour of later) for (let j = 0; j < 6; j++) rows.push(neighbour * 6 + j);
        this.rows[column] = Int32Array.from(rows);
        this.values[column] = new Float64Array(rows.length);
        for (let offset = 1; offset < rows.length; offset++) this.predecessors[rows[offset]!]!.push({ column, offset });
        this.triangularWork += rows.length * 2 + 2;
        work += rows.length * 3;
        yield work - accounted; accounted = work;
      }
    }
    for (const edge of component.connections) {
      work += this.changeConnection(edge, 1);
      yield work - accounted; accounted = work;
    }
    // Removals may arrive between yields. Reconcile until a whole pass agrees
    // with the live set, including removals behind the previous cursor.
    const assembled = new Set(this.originalConnections);
    for (;;) {
      let changed = false;
      const revision = this.preparationRevision;
      for (const edge of component.connections) {
        const present = assembled.has(edge.index), wanted = this.liveConnections.has(edge.index);
        if (present !== wanted) {
          work += this.changeConnection(edge, wanted ? 1 : -1);
          if (wanted) assembled.add(edge.index); else assembled.delete(edge.index);
          changed = true;
        }
        if ((++work & 127) === 0) { yield work - accounted; accounted = work; }
      }
      if (!changed && revision === this.preparationRevision) break;
    }
    for (let column = 0; column < count; column++) {
      const diagonal = this.matrix[column]!.get(column) ?? 0;
      if (!(diagonal > 0)) throw new Error(`Unconstrained structural coordinate ${this.permutation[column]}`);
      this.scale[column] = 1 / Math.sqrt(diagonal);
      // Keep scaling atomic with the reconciled matrix: topology changes at a
      // later yield would otherwise need another assembly reconciliation.
      work++;
    }
    return work - accounted;
  }

  canReuse(component: Component): boolean {
    if (this.stableInterfaceFactor) return component.connections.every(edge => this.definitions.get(edge.index) === edge);
    if (hasInterfaceCoordinates(component) !== !!this.interfaces) return false;
    if (this.interfaces && component.connections.length !== this.interfaces.length) return false;
    return component.connections.every((edge) => this.definitions.get(edge.index) === edge);
  }

  ownsConnection(index: number): boolean { return this.originalConnections.has(index); }

  updateConnections(component: Component, quota: WorkQuota): void {
    if (component.connections.length === this.liveConnections.size &&
        component.connections.every((edge) => this.liveConnections.has(edge.index))) return;
    const next = new Set(component.connections.map((edge) => edge.index));
    if (this.stableInterfaceFactor) {
      this.liveConnections.clear();
      for (const index of next) this.liveConnections.add(index);
      // Never downdate a weak interface pivot. Rebuild this changed component
      // from positive tree channels under the same deterministic work quota.
      this.startStableInterfaceFactor();
      return;
    }
    this.invalidateSolution();
    // A partially accumulated numeric column belongs to the old matrix. Its
    // uncommitted work can be discarded while the clean columns remain reusable.
    this.refactoring = null;
    if (this.preparation) {
      this.preparationRevision++;
      this.liveConnections.clear();
      for (const index of next) this.liveConnections.add(index);
      return;
    }
    for (const index of this.liveConnections) {
      if (!next.has(index)) { quota.chargeSymbolic(this.changeConnection(this.definitions.get(index)!, -1)); this.liveConnections.delete(index); }
    }
    for (const edge of component.connections) {
      if (!this.liveConnections.has(edge.index)) { quota.chargeSymbolic(this.changeConnection(edge, 1)); this.liveConnections.add(edge.index); }
    }
    // A changed column can affect only its later symbolic dependents. Closure
    // in elimination order preserves all other previously factored columns.
    for (let column = 0; column < this.dirty.length; column++) {
      if (!this.dirty[column]) continue;
      const rows = this.rows[column]!;
      for (let offset = 1; offset < rows.length; offset++) this.dirty[rows[offset]!] = 1;
      quota.chargeSymbolic(rows.length);
    }
  }

  private changeConnection(edge: Connection, sign: number): number {
    let work = 0;
    for (const channel of edge.channels) {
      for (let i = 0; i < channel.dofs.length; i++) {
        const first = this.inverse.get(channel.dofs[i]!);
        if (first === undefined) continue;
        for (let j = i; j < channel.dofs.length; j++) {
          const second = this.inverse.get(channel.dofs[j]!);
          if (second === undefined) continue;
          const column = Math.min(first, second), row = Math.max(first, second);
          const value = sign * channel.stiffness * channel.coefficients[i]! * channel.coefficients[j]!;
          const matrix = this.matrix[column]!;
          matrix.set(row, (matrix.get(row) ?? 0) + value);
          this.dirty[column] = 1;
          work++;
        }
      }
    }
    return work;
  }

  invalidateSolution(): void { this.solved = undefined; }

  /** Compare after impulses and free-body balancing, including their disappearance. */
  restoreSolution(rhs: Float64Array, result: DirectSolveResult): boolean {
    const cached = this.solved;
    if (!cached || this.preparation || this.refactoring) return false;
    for (let i = 0; i < this.component.nodes.length; i++) {
      const offset = this.component.nodes[i]! * 6;
      for (let axis = 0; axis < 6; axis++) if (cached.rhs[i * 6 + axis] !== rhs[offset + axis]) return false;
    }
    for (let i = 0; i < this.component.nodes.length; i++) {
      const offset = this.component.nodes[i]! * 6;
      for (let axis = 0; axis < 6; axis++) result.displacement[offset + axis] = cached.displacement[i * 6 + axis]!;
    }
    for (let i = 0; i < cached.connections.length; i++) {
      const index = cached.connections[i]!, offset = i * 6;
      result.forceX[index] = cached.actions[offset]!;
      result.forceY[index] = cached.actions[offset + 1]!;
      result.forceZ[index] = cached.actions[offset + 2]!;
      result.momentX[index] = cached.actions[offset + 3]!;
      result.momentY[index] = cached.actions[offset + 4]!;
      result.momentZ[index] = cached.actions[offset + 5]!;
    }
    if (this.interfaces) this.interfaceSolutions.set(result.displacement, new Map(Array.from(cached.connections, (index, local) => {
      const offset = local * 6;
      return [index, { force: [cached.actions[offset]!, cached.actions[offset + 1]!, cached.actions[offset + 2]!] as Vec3,
        moment: [cached.actions[offset + 3]!, cached.actions[offset + 4]!, cached.actions[offset + 5]!] as Vec3 }];
    })));
    return true;
  }

  interfaceActions(edge: Connection, displacement: Float64Array): ConnectionActions | undefined {
    if (!this.interfaces) return;
    const actions = this.interfaceSolutions.get(displacement)?.get(edge.index);
    if (!actions) throw new Error('Missing solved interface coordinates');
    return actions;
  }

  storeSolution(component: Component, result: DirectSolveResult): void {
    const cached = this.solved ?? {
      rhs: new Float64Array(component.nodes.length * 6),
      displacement: new Float64Array(component.nodes.length * 6),
      connections: Int32Array.from(component.connections, (edge) => edge.index),
      actions: new Float64Array(component.connections.length * 6),
    };
    for (let i = 0; i < component.nodes.length; i++) {
      const offset = component.nodes[i]! * 6;
      for (let axis = 0; axis < 6; axis++) {
        cached.rhs[i * 6 + axis] = result.rhs[offset + axis]!;
        cached.displacement[i * 6 + axis] = result.displacement[offset + axis]!;
      }
    }
    for (let i = 0; i < cached.connections.length; i++) {
      const index = cached.connections[i]!, offset = i * 6;
      cached.actions[offset] = result.forceX[index]!;
      cached.actions[offset + 1] = result.forceY[index]!;
      cached.actions[offset + 2] = result.forceZ[index]!;
      cached.actions[offset + 3] = result.momentX[index]!;
      cached.actions[offset + 4] = result.momentY[index]!;
      cached.actions[offset + 5] = result.momentZ[index]!;
    }
    this.solved = cached;
  }

  /** Yield inside long sparse products; resume at the exact unfinished operation. */
  private *refactorColumns(): Generator<number, number, void> {
    let work = 0, accounted = 0;
    for (let column = 0; column < this.dirty.length; column++) {
      if (!this.dirty[column]) continue;
      const rows = this.rows[column]!, values = this.values[column]!, scale = this.scale[column]!;
      for (const row of rows) {
        this.scratch[row] = (this.matrix[column]!.get(row) ?? 0) * scale * this.scale[row]!;
        if ((++work & 511) === 0) { yield work - accounted; accounted = work; }
      }
      for (const previous of this.predecessors[column]!) {
        const priorValues = this.values[previous.column]!, priorRows = this.rows[previous.column]!;
        const multiplier = priorValues[previous.offset]!;
        if (multiplier !== 0) {
          for (let offset = previous.offset; offset < priorRows.length; offset++) {
            this.scratch[priorRows[offset]!]! -= multiplier * priorValues[offset]!;
            if ((++work & 511) === 0) { yield work - accounted; accounted = work; }
          }
        }
        if ((++work & 511) === 0) { yield work - accounted; accounted = work; }
      }
      const diagonal = this.scratch[column]!;
      if (!(diagonal > 0) || !Number.isFinite(diagonal)) {
        if (Number.isFinite(diagonal)) throw new NonPositiveStructuralPivot(this.permutation[column]!, work - accounted);
        throw new Error(`Structural Cholesky lost positive definiteness at coordinate ${this.permutation[column]}`);
      }
      const root = Math.sqrt(diagonal);
      this.columnValues[0] = root;
      for (let offset = 1; offset < rows.length; offset++) {
        this.columnValues[offset] = this.scratch[rows[offset]!]! / root;
        if ((++work & 511) === 0) { yield work - accounted; accounted = work; }
      }
      // Commit only the complete column. A topology update between yields must
      // never expose a mixture of old and new entries as a clean factor column.
      values.set(this.columnValues.subarray(0, rows.length));
      this.dirty[column] = 0; this.completedColumns++;
      work += rows.length + 2;
      yield work - accounted; accounted = work;
    }
    return work - accounted;
  }

  /** Exact partial refactor; symbolic and numeric work survive deterministic quota boundaries. */
  refactor(quota: WorkQuota): { complete: boolean; columns: number } {
    const before = this.completedColumns;
    for (;;) {
      while (this.preparation) {
        if (!quota.available) return { complete: false, columns: this.completedColumns - before };
        const part = this.preparation.next();
        quota.chargeSymbolic(part.value);
        if (part.done) this.preparation = null;
      }
      this.refactoring ??= this.stableInterfaceFactor
        ? (this.stableFactorReady ? null : this.factorStableInterfaces()) : this.refactorColumns();
      while (this.refactoring) {
        if (!quota.available) return { complete: false, columns: this.completedColumns - before };
        try {
          const part = this.refactoring.next();
          quota.charge(part.value);
          if (part.done) this.refactoring = null;
        } catch (error) {
          if (!(error instanceof NonPositiveStructuralPivot) || this.stableInterfaceFactor) throw error;
          quota.charge(error.unchargedWork);
          this.startStableInterfaceFactor();
          break;
        }
      }
      if (!this.preparation) return { complete: true, columns: this.completedColumns - before };
    }
  }

  private startStableInterfaceFactor(): void {
    this.stableInterfaceFactor = true;
    this.stableFactorReady = false;
    this.interfaces = undefined;
    this.interfaceRows = undefined;
    this.invalidateSolution();
    this.refactoring = null;
    this.preparation = this.prepareStableInterfaces();
  }

  /** K = B_tree^T (D_tree + sum k*c*c^T) B_tree, with no stiffness changes. */
  private *prepareStableInterfaces(): Generator<number, number, void> {
    let work = 0, accounted = 0;
    const component = this.component, edges: Connection[] = [];
    const incident = new Map<number, Connection[]>();
    for (const node of component.nodes) {
      incident.set(node, []);
      if ((++work & 127) === 0) { yield work - accounted; accounted = work; }
    }
    let world: Connection | undefined;
    for (const edge of component.connections) {
      if ((++work & 127) === 0) { yield work - accounted; accounted = work; }
      if (!this.liveConnections.has(edge.index)) continue;
      edges.push(edge);
      if (edge.b < 0) world ??= edge;
      else { incident.get(edge.a)!.push(edge); incident.get(edge.b)!.push(edge); }
    }
    const tree: InterfaceTreeNode[] = [], slots = new Map<number, number>();
    const treeEdges = new Map<number, number>(), visited = new Set<number>(), queue: number[] = [];
    const add = (edge: Connection, node: number, parent: number, parentSlot: number): void => {
      const [normal, tangent1, tangent2] = edge.channels.slice(0, 3).map(channel => channel.direction);
      const dual = [cross(tangent1!, tangent2!), cross(tangent2!, normal!), cross(normal!, tangent1!)];
      const determinant = dot(normal!, dual[0]!);
      if (determinant === 0 || !Number.isFinite(determinant)) throw new Error('Singular structural interface frame');
      const slot = tree.length;
      tree.push({ node, parent, parentSlot, edge, sign: node === edge.a ? -1 : 1,
        arm: node === edge.a ? edge.section.armA : edge.section.armB,
        parentArm: node === edge.a ? edge.section.armB : edge.section.armA,
        dual: dual.map(direction => direction.map(value => value / determinant) as Vec3) as [Vec3, Vec3, Vec3] });
      slots.set(node, slot); treeEdges.set(edge.index, slot); visited.add(node); queue.push(node);
      work += 96;
    };
    // Free actors retain their existing fixed-node gauge. Legacy fixed supports
    // form a zero-motion root forest; explicit world edges remain finite springs.
    for (const node of component.nodes) {
      if (component.fixed.has(node)) { visited.add(node); queue.push(node); }
      if ((++work & 127) === 0) { yield work - accounted; accounted = work; }
    }
    if (!queue.length) {
      if (!world) throw new Error('Structural interface component has no world edge or fixed gauge');
      add(world, world.a, -1, -1);
    }
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const parent = queue[cursor]!;
      for (const edge of incident.get(parent)!) {
        const node = edge.a === parent ? edge.b : edge.a;
        if (!visited.has(node)) add(edge, node, parent, slots.get(parent) ?? -1);
        if (work - accounted >= 128) { yield work - accounted; accounted = work; }
        work++;
      }
    }
    if (visited.size !== component.nodes.length) throw new Error('Disconnected structural interface tree');
    const count = tree.length * 6;
    this.interfaces = tree;
    this.permutation = new Int32Array(count);
    this.rows = new Array(count); this.values = new Array(count);
    this.scale = new Float64Array(count).fill(1);
    this.solution = new Float64Array(count); this.interfaceWrenches = new Float64Array(count);
    this.interfaceRows = new Map();
    for (let slot = 0; slot < tree.length; slot++) {
      for (let axis = 0; axis < 6; axis++) {
        const coordinate = slot * 6 + axis, stiffness = tree[slot]!.edge.channels[axis]!.stiffness;
        if (!(stiffness > 0) || !Number.isFinite(stiffness)) throw new Error('Nonpositive structural interface stiffness');
        this.permutation[coordinate] = tree[slot]!.node * 6 + axis;
        this.rows[coordinate] = new Int32Array([coordinate]);
        this.values[coordinate] = new Float64Array([Math.sqrt(stiffness)]);
      }
      work += 72;
      if (work - accounted >= 128) { yield work - accounted; accounted = work; }
    }
    for (const edge of edges) {
      const treeSlot = treeEdges.get(edge.index);
      if (treeSlot !== undefined) {
        this.interfaceRows.set(edge.index, edge.channels.map((_, channel) => [[treeSlot * 6 + channel, 1]]));
        work += 6;
      } else {
        const paths: number[][] = [];
        for (const node of [edge.a, edge.b]) {
          const path: number[] = [];
          for (let slot = slots.get(node) ?? -1; slot >= 0; slot = tree[slot]!.parentSlot) {
            path.push(slot);
            if ((++work & 127) === 0) { yield work - accounted; accounted = work; }
          }
          paths.push(path);
        }
        const [a, b] = paths as [number[], number[]];
        while (a.length && b.length && a[a.length - 1] === b[b.length - 1]) {
          a.pop(); b.pop();
          if ((++work & 127) === 0) { yield work - accounted; accounted = work; }
        }
        // Every common ancestor moves both endpoints as one rigid body. Its
        // coefficient is identically zero, never the difference of huge COM
        // motions. Merge root-to-leaf paths to keep sparse rows sorted without
        // an unbounded sort or dense coordinate scan.
        const rows: InterfaceRow[] = edge.channels.map(() => []);
        let ai = a.length - 1, bi = b.length - 1;
        while (ai >= 0 || bi >= 0) {
          const fromA = (a[ai] ?? Infinity) < (b[bi] ?? Infinity);
          const slot = fromA ? a[ai--]! : b[bi--]!, entry = tree[slot]!;
          const sign = (fromA ? -1 : 1) * entry.sign;
          const lever: Vec3 = [edge.section.point[0] - entry.edge.section.point[0],
            edge.section.point[1] - entry.edge.section.point[1], edge.section.point[2] - entry.edge.section.point[2]];
          for (let channel = 0; channel < 6; channel++) {
            const direction = edge.channels[channel]!.direction;
            for (let axis = 0; axis < 6; axis++) {
              const coefficient = channel < 3
                ? (axis < 3 ? dot(direction, entry.dual[axis]!) : dot(direction, cross(entry.dual[axis - 3]!, lever)))
                : (axis < 3 ? 0 : dot(direction, entry.dual[axis - 3]!));
              if (coefficient !== 0) rows[channel]!.push([slot * 6 + axis, sign * coefficient]);
              work += 15;
              if (work - accounted >= 128) { yield work - accounted; accounted = work; }
            }
          }
        }
        this.interfaceRows.set(edge.index, rows);
      }
      if (work - accounted >= 128) { yield work - accounted; accounted = work; }
    }
    return work - accounted;
  }

  /** Orthogonal positive rank updates: hypot replaces cancellation-prone pivots. */
  private *factorStableInterfaces(): Generator<number, number, void> {
    let work = 0, accounted = 0;
    const columns: InterfaceRow[] = [];
    const treeEdges = new Set<number>();
    for (const entry of this.interfaces!) {
      treeEdges.add(entry.edge.index);
      for (const channel of entry.edge.channels) {
        columns.push([[columns.length, Math.sqrt(channel.stiffness)]]);
        if ((++work & 511) === 0) { yield work - accounted; accounted = work; }
      }
    }
    for (const edge of this.component.connections) {
      if (++work - accounted >= 512) { yield work - accounted; accounted = work; }
      if (!this.liveConnections.has(edge.index) || treeEdges.has(edge.index)) continue;
      for (let channel = 0; channel < 6; channel++) {
        const root = Math.sqrt(edge.channels[channel]!.stiffness);
        if (!(root > 0) || !Number.isFinite(root)) throw new Error('Nonpositive structural interface stiffness');
        let residual: InterfaceRow = [];
        for (const [coordinate, coefficient] of this.interfaceRows!.get(edge.index)![channel]!) {
          residual.push([coordinate, coefficient * root]);
          if ((++work & 511) === 0) { yield work - accounted; accounted = work; }
        }
        while (residual.length) {
          const [column, x] = residual[0]!, previous = columns[column]!, diagonal = previous[0]![1];
          const radius = Math.hypot(diagonal, x), cosine = diagonal / radius, sine = x / radius;
          if (!(radius > 0) || !Number.isFinite(radius)) throw new Error('Nonfinite structural interface factor');
          const next: InterfaceRow = [[column, radius]], remainder: InterfaceRow = [];
          let i = 1, j = 1;
          while (i < previous.length || j < residual.length) {
            const row = Math.min(previous[i]?.[0] ?? Infinity, residual[j]?.[0] ?? Infinity);
            const oldL = previous[i]?.[0] === row ? previous[i++]![1] : 0;
            const oldX = residual[j]?.[0] === row ? residual[j++]![1] : 0;
            const newL = cosine * oldL + sine * oldX, newX = cosine * oldX - sine * oldL;
            if (newL !== 0) next.push([row, newL]);
            if (newX !== 0) remainder.push([row, newX]);
            work += 12;
            if (work - accounted >= 512) { yield work - accounted; accounted = work; }
          }
          columns[column] = next; residual = remainder; work += 6;
          if (work - accounted >= 512) { yield work - accounted; accounted = work; }
        }
      }
    }
    this.triangularWork = 0;
    for (let column = 0; column < columns.length; column++) {
      const entries = columns[column]!, rows = new Int32Array(entries.length), values = new Float64Array(entries.length);
      for (let offset = 0; offset < entries.length; offset++) {
        rows[offset] = entries[offset]![0]; values[offset] = entries[offset]![1];
        if ((++work & 511) === 0) { yield work - accounted; accounted = work; }
      }
      this.rows[column] = rows; this.values[column] = values;
      this.triangularWork += rows.length * 2 + 2;
      this.completedColumns++;
    }
    this.stableFactorReady = true;
    return work - accounted;
  }

  solve(rhs: Float64Array, displacement: Float64Array, quota: WorkQuota): void {
    quota.charge(this.triangularWork);
    const x = this.solution;
    const tree = this.interfaces;
    if (tree) {
      const loads = this.interfaceWrenches;
      tree.forEach((entry, slot) => loads.set(rhs.subarray(entry.node * 6, entry.node * 6 + 6), slot * 6));
      // B^-T f: each interface carries its complete subtree wrench. Transfer
      // moments between COMs before expressing each wrench at its own patch.
      for (let slot = tree.length - 1; slot >= 0; slot--) {
        const entry = tree[slot]!, offset = slot * 6;
        const force: Vec3 = [loads[offset]!, loads[offset + 1]!, loads[offset + 2]!];
        const armMoment = cross(entry.arm, force);
        const moment: Vec3 = [loads[offset + 3]! - armMoment[0], loads[offset + 4]! - armMoment[1], loads[offset + 5]! - armMoment[2]];
        for (let axis = 0; axis < 6; axis++) {
          x[offset + axis] = entry.sign * dot(entry.dual[axis % 3]!, axis < 3 ? force : moment) * this.scale[offset + axis]!;
        }
        quota.charge(60);
        if (entry.parentSlot >= 0) {
          const parent = entry.parentSlot * 6;
          const lever: Vec3 = [entry.parentArm[0] - entry.arm[0], entry.parentArm[1] - entry.arm[1], entry.parentArm[2] - entry.arm[2]];
          const transferred = cross(lever, force);
          for (let axis = 0; axis < 3; axis++) {
            loads[parent + axis]! += force[axis]!;
            loads[parent + axis + 3]! += loads[offset + axis + 3]! + transferred[axis]!;
          }
          quota.charge(21);
        }
      }
    } else {
      for (let column = 0; column < x.length; column++) x[column] = rhs[this.permutation[column]!]! * this.scale[column]!;
    }
    for (let column = 0; column < x.length; column++) {
      const values = this.values[column]!, rows = this.rows[column]!;
      x[column]! /= values[0]!;
      for (let offset = 1; offset < rows.length; offset++) x[rows[offset]!]! -= values[offset]! * x[column]!;
    }
    for (let column = x.length - 1; column >= 0; column--) {
      const values = this.values[column]!, rows = this.rows[column]!;
      for (let offset = 1; offset < rows.length; offset++) x[column]! -= values[offset]! * x[rows[offset]!]!;
      x[column]! /= values[0]!;
      if (!tree) displacement[this.permutation[column]!] = x[column]! * this.scale[column]!;
    }
    if (tree) {
      const actions = new Map<number, ConnectionActions>();
      // B^-1 q: parent-to-child motion reconstruction, with world motion zero.
      for (const [slot, entry] of tree.entries()) {
        const atPatch: Vec3 = [0, 0, 0], rotation: Vec3 = [0, 0, 0];
        const force: Vec3 = [0, 0, 0], moment: Vec3 = [0, 0, 0];
        for (let channel = 0; channel < 6; channel++) {
          const coordinate = slot * 6 + channel, definition = entry.edge.channels[channel]!;
          const extension = x[coordinate]! * this.scale[coordinate]!, signed = entry.sign * extension;
          const action = extension * definition.stiffness;
          const motion = channel < 3 ? atPatch : rotation, output = channel < 3 ? force : moment;
          for (let axis = 0; axis < 3; axis++) {
            motion[axis]! += signed * entry.dual[channel % 3]![axis]!;
            output[axis]! += action * definition.direction[axis]!;
          }
        }
        if (entry.parent >= 0) {
          const parent = entry.parent * 6;
          const parentRotation: Vec3 = [displacement[parent + 3]!, displacement[parent + 4]!, displacement[parent + 5]!];
          const parentLever = cross(parentRotation, entry.parentArm);
          for (let axis = 0; axis < 3; axis++) {
            atPatch[axis]! += displacement[parent + axis]! + parentLever[axis]!;
            rotation[axis]! += parentRotation[axis]!;
          }
          quota.charge(18);
        }
        const lever = cross(rotation, entry.arm), offset = entry.node * 6;
        for (let axis = 0; axis < 3; axis++) {
          displacement[offset + axis] = atPatch[axis]! - lever[axis]!;
          displacement[offset + axis + 3] = rotation[axis]!;
        }
        // Recover every connection action from D*q. The global COM motions
        // may lose tiny relative deflections while sharing a large weak mode.
        actions.set(entry.edge.index, { force, moment });
        quota.charge(108);
      }
      if (this.interfaceRows) {
        // Non-tree actions must also come from q. Reconstructed COM motion can
        // be enormous along a real weak bearing mode, losing relative strain.
        for (const edge of this.component.connections) {
          quota.charge(1);
          if (!this.liveConnections.has(edge.index) || actions.has(edge.index)) continue;
          const force: Vec3 = [0, 0, 0], moment: Vec3 = [0, 0, 0];
          for (let channel = 0; channel < 6; channel++) {
            const definition = edge.channels[channel]!, row = this.interfaceRows.get(edge.index)![channel]!;
            let extension = 0;
            for (const [coordinate, coefficient] of row) extension += coefficient * x[coordinate]!;
            const action = definition.stiffness * extension, output = channel < 3 ? force : moment;
            for (let axis = 0; axis < 3; axis++) output[axis]! += action * definition.direction[axis]!;
            quota.charge(row.length * 2 + 7);
          }
          actions.set(edge.index, { force, moment });
        }
      }
      this.interfaceSolutions.set(displacement, actions);
    }
  }
}

function inertiaTimes(inertia: ArrayLike<number>, vector: Vec3): Vec3 {
  return [
    inertia[0]! * vector[0] + inertia[3]! * vector[1] + inertia[4]! * vector[2],
    inertia[3]! * vector[0] + inertia[1]! * vector[1] + inertia[5]! * vector[2],
    inertia[4]! * vector[0] + inertia[5]! * vector[1] + inertia[2]! * vector[2],
  ];
}

function inverseInertiaTimes(inertia: Float64Array, vector: Vec3): Vec3 {
  const [a, d, f, b, c, e] = inertia as unknown as [number, number, number, number, number, number];
  const aa = d * f - e * e, ab = c * e - b * f, ac = b * e - c * d;
  const dd = a * f - c * c, de = b * c - a * e, ff = a * d - b * b;
  const determinant = a * aa + b * ab + c * ac;
  if (!(determinant > 0)) throw new Error('Direct structural actor has singular inertia');
  return [
    (aa * vector[0] + ab * vector[1] + ac * vector[2]) / determinant,
    (ab * vector[0] + dd * vector[1] + de * vector[2]) / determinant,
    (ac * vector[0] + de * vector[1] + ff * vector[2]) / determinant,
  ];
}

/** Member-level direct structural analysis; graph ownership stays with the caller. */
export class DirectStructuralSolver {
  private readonly options: DirectSolverOptions;
  private readonly connections: Array<Connection> = [];
  private readonly factors = new Map<string, SparseComponentFactor>();
  private readonly baselineRates = new Map<number, number>();
  private readonly forceQueue = new Map<number, Float64Array>();
  private readonly forceRecords: AppliedForce[] = [];
  private pendingImpulseSamples: ImpulseSample[] = [];
  private nextImpulseSampleId = 1;
  private readonly measured = new Map<number, MeasuredImpulse>();
  private result: DirectSolveResult;
  private gravityRhs: Float64Array;
  private gravityDisplacement: Float64Array;
  private componentTopology?: {
    states: Uint8Array;
    active: Uint8Array;
    anchored?: Uint8Array;
    components: Array<Component>;
  };

  constructor(readonly manifest: DestructibleManifest, options: DirectSolverOptions = {}) {
    this.options = options;
    this.result = this.emptyResult();
    this.gravityRhs = new Float64Array(manifest.fragments.length * 6);
    this.gravityDisplacement = new Float64Array(this.gravityRhs.length);
    if (options.initialBaselineRates) this.importBaselines(options.initialBaselineRates);
    const active = Uint8Array.from(manifest.fragments, (fragment) => fragment.support === false ? 0 : 1);
    // Blast's creation-time preparation: factor the authored graph and capture
    // its gravity-only baseline before any damage or external load arrives.
    if (!options.deferInitialization) this.solve(new Uint8Array(manifest.bonds.length), new Float32Array(manifest.bonds.length), active, null, 1, { ...options, budgetMs: Infinity, workLimit: Infinity });
  }

  private emptyResult(): DirectSolveResult {
    const bonds = this.manifest.bonds.length, dofs = this.manifest.fragments.length * 6;
    return {
      forceX: new Float64Array(bonds), forceY: new Float64Array(bonds), forceZ: new Float64Array(bonds),
      momentX: new Float64Array(bonds), momentY: new Float64Array(bonds), momentZ: new Float64Array(bonds),
      staticActions: { forceX: new Float64Array(bonds), forceY: new Float64Array(bonds), forceZ: new Float64Array(bonds),
        momentX: new Float64Array(bonds), momentY: new Float64Array(bonds), momentZ: new Float64Array(bonds) },
      currentImpulseNodes: new Uint8Array(this.manifest.fragments.length),
      combinedImpulse: new Float64Array(bonds), baselineImpulse: new Float64Array(bonds),
      breakOffset: new Float64Array(bonds), utilization: new Float64Array(bonds),
      displacement: new Float64Array(dofs), rhs: new Float64Array(dofs),
      fractures: { bonds: [], chunks: [], programs: [] }, elasticBonds: [], measuredBonds: [],
      overBudget: false, complete: true, elapsedMs: 0, workLimit: 0, workUsed: 0, workRemaining: 0, workDeferred: 0, factorizedColumns: 0, reusedComponents: 0, cachedComponents: 0, solvedComponents: 0,
      solvedBonds: new Uint8Array(bonds), deferredImpulseNodes: new Uint8Array(this.manifest.fragments.length), deferredImpulseSamples: 0,
      impulseEvaluations: [],
      currentImpulseSampleId: null,
    };
  }

  exportBaselines(): Map<number, number> { return new Map(this.baselineRates); }

  importBaselines(snapshot: ReadonlyMap<number, number>): void {
    for (const [id, value] of snapshot) {
      if (!Number.isFinite(value) || value < 0) throw new Error('Invalid structural baseline');
      this.baselineRates.set(id, value);
    }
    this.inheritBaselines();
  }

  /** A newly observed bearing has no pre-existing static load to grandfather. */
  registerUnloadedBonds(ids: ReadonlyArray<number>): void {
    if (new Set(ids).size !== ids.length || ids.some(id => this.baselineRates.has(id))) {
      throw new Error('Structural baseline already exists');
    }
    for (const id of ids) this.baselineRates.set(id, 0);
  }

  /** Reuse released runtime slots without inheriting the old contact's matrix or baseline. */
  replaceUnloadedBonds(replacements: ReadonlyArray<{ index: number; previousId: number }>): void {
    if (!replacements.length) return;
    this.componentTopology = undefined;
    const indices = new Map(this.manifest.fragments.map((fragment, index) => [fragment.id, index]));
    const materials = new Map(this.manifest.materials.map((material) => [material.id, material]));
    for (const { index, previousId } of replacements) {
      const bond = this.manifest.bonds[index]!;
      if (!bond || bond.b !== -1 || bond.id === previousId || this.baselineRates.has(bond.id) ||
          (this.connections[index] && this.connections[index]!.definition.id !== previousId)) {
        throw new Error('Invalid replacement bearing connection');
      }
      this.baselineRates.delete(previousId);
      this.baselineRates.set(bond.id, 0);
      this.measured.delete(index);
      // A slot released before its first solve has no Connection yet. Normal
      // append synchronization will create it from the replacement definition.
      if (index < this.connections.length) {
        this.connections[index] = connectionFor(this.manifest, index, indices, materials);
      }
    }
    for (const [key, factor] of this.factors) {
      if (replacements.some(({ index }) => factor.ownsConnection(index))) this.factors.delete(key);
    }
    // Public result arrays/proposals from the previous contact cannot describe
    // its new generation. Queued force samples refer to chunks and remain intact.
    this.result = this.emptyResult();
  }

  /** Position and impulse are in asset coordinates; impulse has units N s. */
  addForce(chunk: number, position: Vec3, impulse: Vec3): void {
    const fragment = this.manifest.fragments[chunk];
    if (!fragment || ![...position, ...impulse].every(Number.isFinite)) throw new Error('Invalid structural force');
    const pending = this.forceQueue.get(chunk) ?? new Float64Array(6);
    const arm = position.map((value, axis) => value - fragment.position[axis]!) as Vec3;
    const moment = cross(arm, impulse);
    for (let axis = 0; axis < 3; axis++) { pending[axis]! += impulse[axis]!; pending[axis + 3]! += moment[axis]!; }
    this.forceQueue.set(chunk, pending);
    this.forceRecords.push({ chunk, position: [...position], impulse: [...impulse] });
  }

  /**
   * Queue an already sealed physics-step sample without requiring a factor or
   * solve. Small runtime families can miss service under the shared budget;
   * their individual impulses must still retain their original ambient RHS/dt.
   */
  enqueueImpulseSample(
    dt: number,
    ambientNodes: ArrayLike<number>,
    ambient: ArrayLike<number>,
    forces: ReadonlyArray<{ chunk: number; position: Vec3; impulse: Vec3 }>,
  ): void {
    const nodes = Array.from(ambientNodes), values = Array.from(ambient);
    if (!(dt > 0) || !Number.isFinite(dt) || values.length !== nodes.length * 6 ||
        new Set(nodes).size !== nodes.length || !values.every(Number.isFinite) ||
        nodes.some(node => !Number.isInteger(node) || !this.manifest.fragments[node]) ||
        forces.some(force => !Number.isInteger(force.chunk) || !this.manifest.fragments[force.chunk] ||
          ![...force.position, ...force.impulse].every(Number.isFinite))) {
      throw new Error('Invalid sealed structural impulse sample');
    }
    if (!forces.length) return;
    this.pendingImpulseSamples.push({ id: this.nextImpulseSampleId++, dt,
      ambientNodes: Int32Array.from(nodes), ambient: Float64Array.from(values),
      forces: forces.map(force => ({ chunk: force.chunk, position: [...force.position], impulse: [...force.impulse] })),
    });
  }

  /** Actual joint writeback, transformed into asset axes, and its solver-substep dt. */
  setMeasuredImpulse(bond: number, linear: Vec3, angular: Vec3, sampleDt: number): void {
    if (!this.manifest.bonds[bond] || !(sampleDt > 0) || !Number.isFinite(sampleDt) || ![...linear, ...angular].every(Number.isFinite)) {
      throw new Error('Invalid measured structural impulse');
    }
    this.measured.set(bond, { linear: [...linear], angular: [...angular], sampleDt });
  }

  clearForces(): void { this.forceQueue.clear(); this.forceRecords.length = 0; this.pendingImpulseSamples = []; this.measured.clear(); }

  private synchronizeDefinitions(): void {
    if (this.connections.length === this.manifest.bonds.length &&
        this.result.rhs.length === this.manifest.fragments.length * 6) return;
    this.componentTopology = undefined;
    const indices = new Map(this.manifest.fragments.map((fragment, index) => [fragment.id, index]));
    const materials = new Map(this.manifest.materials.map((material) => [material.id, material]));
    for (let index = this.connections.length; index < this.manifest.bonds.length; index++) {
      this.connections.push(connectionFor(this.manifest, index, indices, materials));
    }
    if (this.result.forceX.length !== this.manifest.bonds.length || this.result.rhs.length !== this.manifest.fragments.length * 6) {
      this.result = this.emptyResult();
      this.gravityRhs = new Float64Array(this.result.rhs.length);
      this.gravityDisplacement = new Float64Array(this.result.rhs.length);
    }
    this.inheritBaselines();
  }

  private inheritBaselines(): void {
    for (const edge of this.connections) {
      const { id, parentBond, areaFraction } = edge.definition;
      if (parentBond === undefined || this.baselineRates.has(id)) continue;
      const baseline = this.baselineRates.get(parentBond);
      if (baseline !== undefined) this.baselineRates.set(id, baseline * (areaFraction ?? 1));
    }
  }

  private components(states: Uint8Array, active: Uint8Array): Array<Component> {
    const cached = this.componentTopology;
    if (cached && cached.states.length === states.length && cached.active.length === active.length &&
        states.every((state, index) => state === cached.states[index]) &&
        active.every((value, index) => value === cached.active[index]) &&
        (!cached.anchored || this.manifest.fragments.every((fragment, index) =>
          Number(!!fragment.anchored) === cached.anchored![index]))) {
      // Impulse service sorts this outer array each step. Keep the canonical
      // component order intact so equal-priority components retain their order.
      return cached.components.slice();
    }
    // Physics publishes its body snapshot after stepping. A split/demotion may
    // create a free graph actor before the next snapshot; it still owns live
    // connections and must receive an impulse in this solve.
    const parents = Int32Array.from(active, (value, index) => value ? index : -1);
    const root = (node: number): number => {
      let found = node;
      while (parents[found] !== found) found = parents[found]!;
      while (node !== found) { const next = parents[node]!; parents[node] = found; node = next; }
      return found;
    };
    const alive = this.connections.filter((edge) => states[edge.index] !== BondState.Broken && states[edge.index] !== COMPLIANT && parents[edge.a]! >= 0 && (edge.b < 0 || parents[edge.b]! >= 0));
    for (const edge of alive) {
      if (edge.b < 0) continue;
      const a = root(edge.a), b = root(edge.b);
      if (a !== b) parents[Math.max(a, b)] = Math.min(a, b);
    }
    const groups = new Map<number, Component>();
    for (let node = 0; node < parents.length; node++) {
      if (parents[node]! < 0) continue;
      const key = root(node);
      let group = groups.get(key);
      if (!group) { group = { key: '', nodes: [], connections: [], fixed: new Set(), grounded: false }; groups.set(key, group); }
      group.nodes.push(node);
    }
    const explicitWorld = this.connections.some((edge) => edge.b < 0);
    for (const edge of alive) {
      const group = groups.get(root(edge.a))!;
      group.connections.push(edge);
      if (edge.b < 0) group.grounded = true;
    }
    for (const group of groups.values()) {
      if (!explicitWorld) {
        for (const node of group.nodes) {
          if (this.manifest.fragments[node]!.anchored) { group.fixed.add(node); group.grounded = true; }
        }
      }
      // A free actor has six rigid null modes. Its RHS is balanced below; the
      // fixed node removes only this gauge, never acts as a fictitious support.
      if (!group.grounded) group.fixed.add(group.nodes[0]!);
      group.key = `${group.nodes.join(',')}/${[...group.fixed].join(',')}`;
    }
    const components = [...groups.values()].filter(group => group.connections.length > 0);
    // Component nodes, connections and fixed sets are read-only to consumers;
    // numeric factors keep their own live-edge sets and mutable matrix state.
    this.componentTopology = { states: states.slice(), active: active.slice(), components,
      ...(!explicitWorld ? { anchored: Uint8Array.from(this.manifest.fragments, fragment => Number(!!fragment.anchored)) } : {}),
    };
    return components.slice();
  }

  private nodeInertia(node: number, mass: number): [number, number, number, number, number, number] {
    const fragment = this.manifest.fragments[node]!;
    if (fragment.shape) {
      const ratio = fragment.mass > 0 ? mass / fragment.mass : 0;
      return fragment.shape.inertia.map((value) => value * ratio) as [number, number, number, number, number, number];
    }
    const [x, y, z] = fragment.size;
    return [mass * (y * y + z * z) / 12, mass * (x * x + z * z) / 12, mass * (x * x + y * y) / 12, 0, 0, 0];
  }

  private balanceFree(component: Component, rhs: Float64Array, masses: ArrayLike<number>): void {
    if (component.grounded) return;
    let mass = 0;
    const center: Vec3 = [0, 0, 0], force: Vec3 = [0, 0, 0], torque: Vec3 = [0, 0, 0];
    const inertia = new Float64Array(6);
    for (const node of component.nodes) {
      const m = masses[node]!; mass += m;
      for (let axis = 0; axis < 3; axis++) center[axis]! += this.manifest.fragments[node]!.position[axis]! * m;
    }
    if (!(mass > 0)) {
      for (const node of component.nodes) rhs.fill(0, node * 6, node * 6 + 6);
      return;
    }
    for (let axis = 0; axis < 3; axis++) center[axis]! /= mass;
    for (const node of component.nodes) {
      const m = masses[node]!, offset = node * 6;
      const r = this.manifest.fragments[node]!.position.map((value, axis) => value - center[axis]!) as Vec3;
      const intrinsic = this.nodeInertia(node, m);
      const f: Vec3 = [rhs[offset]!, rhs[offset + 1]!, rhs[offset + 2]!], lever = cross(r, f);
      for (let axis = 0; axis < 3; axis++) { force[axis]! += f[axis]!; torque[axis]! += rhs[offset + axis + 3]! + lever[axis]!; }
      inertia[0]! += intrinsic[0] + m * (r[1] ** 2 + r[2] ** 2);
      inertia[1]! += intrinsic[1] + m * (r[0] ** 2 + r[2] ** 2);
      inertia[2]! += intrinsic[2] + m * (r[0] ** 2 + r[1] ** 2);
      inertia[3]! += intrinsic[3] - m * r[0] * r[1];
      inertia[4]! += intrinsic[4] - m * r[0] * r[2];
      inertia[5]! += intrinsic[5] - m * r[1] * r[2];
    }
    const acceleration = force.map((value) => value / mass) as Vec3;
    const alpha = inverseInertiaTimes(inertia, torque);
    for (const node of component.nodes) {
      const m = masses[node]!, offset = node * 6;
      const r = this.manifest.fragments[node]!.position.map((value, axis) => value - center[axis]!) as Vec3;
      const angular = cross(alpha, r), moment = inertiaTimes(this.nodeInertia(node, m), alpha);
      for (let axis = 0; axis < 3; axis++) {
        rhs[offset + axis]! -= m * (acceleration[axis]! + angular[axis]!);
        rhs[offset + axis + 3]! -= moment[axis]!;
      }
    }
  }

  private actions(edge: Connection, displacement: Float64Array, quota: WorkQuota, factor?: SparseComponentFactor): ConnectionActions {
    const transformed = factor?.interfaceActions(edge, displacement);
    if (transformed) { quota.charge(6); return transformed; }
    quota.charge(edge.actionWork);
    const force: Vec3 = [0, 0, 0], moment: Vec3 = [0, 0, 0];
    edge.channels.forEach((channel, index) => {
      let extension = 0;
      for (let i = 0; i < channel.dofs.length; i++) extension += channel.coefficients[i]! * displacement[channel.dofs[i]!]!;
      const magnitude = extension * channel.stiffness, target = index < 3 ? force : moment;
      for (let axis = 0; axis < 3; axis++) target[axis]! += magnitude * channel.direction[axis]!;
    });
    return { force, moment };
  }

  private score(edge: Connection, force: Vec3, moment: Vec3): { combined: number; elastic: number } {
    const section = edge.section, limits = edge.limits;
    const axial = dot(force, section.normal);
    const shear = Math.hypot(dot(force, section.tangent1), dot(force, section.tangent2));
    const bending = Math.hypot(dot(moment, section.tangent1) / section.sectionModulus1,
      dot(moment, section.tangent2) / section.sectionModulus2, dot(moment, section.normal) / section.torsionModulus);
    // Finals' three magnitudes. Section A/Z is the dimensional conversion C
    // from angular impulse to equivalent linear impulse on the interface.
    const combined = Math.abs(axial) * edge.multipliers[axial >= 0 ? 0 : 1]
      + shear * edge.multipliers[2] + bending * section.area * edge.multipliers[3];
    const elastic = Math.max(
      Math.abs(axial) / section.area / (axial >= 0 ? limits.tensionElastic : limits.compressionElastic),
      shear / section.area / limits.shearElastic,
      bending / limits.bendingElastic,
    );
    return { combined, elastic };
  }

  solve(
    states: Uint8Array,
    damage: Float32Array,
    activeChunks: Uint8Array,
    loads: StructuralLoads | null,
    dt: number,
    options: DirectSolverOptions = {},
  ): DirectSolveResult {
    const start = now();
    if (!(dt > 0) || !Number.isFinite(dt)) throw new Error('Invalid direct structural timestep');
    if (states.length !== this.manifest.bonds.length || damage.length !== states.length || activeChunks.length !== this.manifest.fragments.length || (loads && loads.rhs.length !== activeChunks.length * 6)) {
      throw new Error('Invalid direct structural buffers');
    }
    const budget = options.budgetMs ?? this.options.budgetMs ?? 6;
    if (!(budget > 0)) throw new Error('Invalid direct structural budget');
    const workLimit = options.workLimit ?? this.options.workLimit ??
      Math.floor(budget * DIRECT_WORK_UNITS_PER_BUDGET_MS);
    if (workLimit !== Infinity && (!Number.isSafeInteger(workLimit) || workLimit < 0)) throw new Error('Invalid structural work quota');
    const work = new WorkQuota(workLimit);
    this.synchronizeDefinitions();
    const result = this.result;
    for (const values of [result.forceX, result.forceY, result.forceZ, result.momentX, result.momentY, result.momentZ,
      result.combinedImpulse, result.baselineImpulse, result.breakOffset, result.utilization, result.displacement, result.rhs]) values.fill(0);
    for (const values of Object.values(result.staticActions)) values.fill(0);
    result.currentImpulseNodes.fill(0);
    result.fractures = { bonds: [], chunks: [], programs: [] }; result.elasticBonds = [];
    result.measuredBonds = [...this.measured.keys()];
    const measuredBonds = new Set(result.measuredBonds);
    result.complete = true; result.overBudget = false; result.factorizedColumns = 0; result.reusedComponents = 0;
    result.cachedComponents = 0; result.solvedComponents = 0;
    result.solvedBonds.fill(0); result.deferredImpulseNodes.fill(0); result.deferredImpulseSamples = 0;
    result.impulseEvaluations = [];
    result.currentImpulseSampleId = null;
    const masses = options.masses ?? this.options.masses ?? this.manifest.fragments.map((fragment) => fragment.mass);
    if (masses.length !== activeChunks.length) throw new Error('Invalid direct structural masses');
    const components = this.components(states, activeChunks);
    if (loads) result.rhs.set(loads.rhs);
    else for (let node = 0; node < activeChunks.length; node++) if (activeChunks[node]) result.rhs[node * 6 + 1] = -masses[node]! * 9.81;
    // A seam reaction also loads the rigid connections inside its two actors.
    // The measured convention is force/moment on A; B receives the opposite.
    for (const [index, measured] of this.measured) {
      const edge = this.connections[index]!;
      if (states[index] !== COMPLIANT) continue;
      for (const [node, sign, arm] of [[edge.a, 1, edge.section.armA], [edge.b, -1, edge.section.armB]] as const) {
        if (node < 0 || !activeChunks[node]) continue;
        const lever = cross(arm, measured.linear);
        for (let axis = 0; axis < 3; axis++) {
          result.rhs[node * 6 + axis]! += sign * measured.linear[axis]! / measured.sampleDt;
          result.rhs[node * 6 + axis + 3]! += sign * (measured.angular[axis]! + lever[axis]!) / measured.sampleDt;
        }
      }
    }
    const resolve = options.resolveForceNode ?? ((chunk: number) => activeChunks[chunk] ? chunk : -1);
    const loadedNodes = new Set(this.forceRecords.map(force => resolve(force.chunk, force.position)));
    const ambientNodes = this.forceRecords.length ? Int32Array.from(components
      .filter(component => component.nodes.some(node => loadedNodes.has(node))).flatMap(component => component.nodes)) : new Int32Array(0);
    const ambient = new Float64Array(ambientNodes.length * 6);
    ambientNodes.forEach((node, local) => ambient.set(result.rhs.subarray(node * 6, node * 6 + 6), local * 6));
    const currentSample: ImpulseSample | undefined = this.forceRecords.length ? {
      id: this.nextImpulseSampleId++, dt, ambientNodes, ambient, forces: this.forceRecords.splice(0),
    } : undefined;
    result.currentImpulseSampleId = currentSample?.id ?? null;
    this.forceQueue.clear();
    if (currentSample) this.pendingImpulseSamples.push(currentSample);
    const connectedNodes = new Set(components.flatMap(component => component.nodes));
    for (const sample of this.pendingImpulseSamples) {
      sample.forces = sample.forces.filter(force => {
        force.chunk = resolve(force.chunk, force.position);
        return force.chunk >= 0 && connectedNodes.has(force.chunk);
      });
    }
    // Continue the oldest pending event first. Repeated topology changes in
    // unrelated components cannot starve an already-landed free actor.
    const oldestImpulse = new Map<number, number>();
    for (const sample of this.pendingImpulseSamples) for (const force of sample.forces) {
      if (!oldestImpulse.has(force.chunk)) oldestImpulse.set(force.chunk, sample.id);
    }
    const priority = new Map(components.map(component => [component, component.nodes.reduce(
      (oldest, node) => Math.min(oldest, oldestImpulse.get(node) ?? Infinity), Infinity)]));
    components.sort((a, b) => priority.get(a)! - priority.get(b)!);
    const applySample = (sample: ImpulseSample, rhs: Float64Array) => {
      for (const force of sample.forces) {
        const node = force.chunk, fragment = this.manifest.fragments[node]!;
        const arm = force.position.map((value, axis) => value - fragment.position[axis]!) as Vec3;
        const moment = cross(arm, force.impulse);
        for (let axis = 0; axis < 3; axis++) {
          rhs[node * 6 + axis]! += force.impulse[axis]! / sample.dt;
          rhs[node * 6 + axis + 3]! += moment[axis]! / sample.dt;
        }
      }
    };
    if (currentSample) applySample(currentSample, result.rhs);
    const currentImpulseNodes = new Set(currentSample?.forces.map(force => force.chunk));
    for (const component of components) if (component.nodes.some(node => currentImpulseNodes.has(node))) {
      for (const node of component.nodes) result.currentImpulseNodes[node] = 1;
    }
    for (const component of components) this.balanceFree(component, result.rhs, masses);
    const retained = new Set(components.map((component) => component.key));
    for (const key of this.factors.keys()) if (!retained.has(key)) this.factors.delete(key);

    this.gravityRhs.fill(0); this.gravityDisplacement.fill(0);
    const peakElastic = new Float64Array(states.length);
    const peakCombined = new Float64Array(states.length);
    const evaluation = (sample: ImpulseSample, component: Component, nodes: Set<number>) => ({
      sampleId: sample.id, dt: sample.dt, component: this.manifest.fragments[component.nodes[0]!]!.id,
      historical: sample !== currentSample,
      loadedNodes: [...new Set(sample.forces.filter(force => nodes.has(force.chunk)).map(force => force.chunk))],
      bondCount: component.connections.length, maxUtilization: 0, fractureBonds: [] as number[],
    });
    const recordScore = (entry: ReturnType<typeof evaluation>, edge: Connection, combined: number) => {
      const capacity = (this.baselineRates.get(edge.definition.id) ?? 0) +
        edge.offsetPressure * edge.section.area * Math.max(0, 1 - damage[edge.index]!);
      entry.maxUtilization = Math.max(entry.maxUtilization, combined / Math.max(Number.MIN_VALUE, capacity));
      if (combined > capacity) entry.fractureBonds.push(edge.index);
    };
    let historicalRhs: Float64Array | undefined, historicalDisplacement: Float64Array | undefined;
    for (const component of components) {
      const startedWithinBudget = work.available;
      let factor = this.factors.get(component.key);
      if (!factor || !factor.canReuse(component)) {
        factor = new SparseComponentFactor(component); this.factors.set(component.key, factor);
      } else {
        factor.updateConnections(component, work); result.reusedComponents++;
      }
      const missingBaseline = component.connections.some((edge) => !this.baselineRates.has(edge.definition.id));
      if (missingBaseline) factor.invalidateSolution();
      if (factor.restoreSolution(result.rhs, result)) {
        result.cachedComponents++;
      } else {
        if (!startedWithinBudget) { result.complete = false; continue; }
        const factored = factor.refactor(work);
        result.factorizedColumns += factored.columns;
        if (!factored.complete) { result.complete = false; continue; }
        if (missingBaseline) {
          for (const node of component.nodes) this.gravityRhs[node * 6 + 1] = -masses[node]! * 9.81;
          this.balanceFree(component, this.gravityRhs, masses);
          factor.solve(this.gravityRhs, this.gravityDisplacement, work);
          for (const edge of component.connections) {
            if (this.baselineRates.has(edge.definition.id)) continue;
            const actions = this.actions(edge, this.gravityDisplacement, work, factor);
            this.baselineRates.set(edge.definition.id, this.score(edge, actions.force, actions.moment).combined);
          }
        }
        factor.solve(result.rhs, result.displacement, work);
        for (const edge of component.connections) {
          const { force, moment } = this.actions(edge, result.displacement, work, factor), index = edge.index;
          result.forceX[index] = force[0]; result.forceY[index] = force[1]; result.forceZ[index] = force[2];
          result.momentX[index] = moment[0]; result.momentY[index] = moment[1]; result.momentZ[index] = moment[2];
        }
        factor.storeSolution(component, result);
        result.solvedComponents++;
      }
      const nodes = new Set(component.nodes);
      const currentEvaluation = currentSample?.forces.some(force => nodes.has(force.chunk))
        ? evaluation(currentSample, component, nodes) : undefined;
      for (const edge of component.connections) {
        result.solvedBonds[edge.index] = 1;
        const index = edge.index;
        const score = this.score(edge,
          [result.forceX[index]!, result.forceY[index]!, result.forceZ[index]!],
          [result.momentX[index]!, result.momentY[index]!, result.momentZ[index]!]);
        peakElastic[index] = score.elastic; peakCombined[index] = score.combined;
        if (currentEvaluation) recordScore(currentEvaluation, edge, score.combined);
      }
      if (currentEvaluation) result.impulseEvaluations.push(currentEvaluation);
      const worldConnections = (options.captureStaticReactions ?? this.options.captureStaticReactions)
        ? component.connections.filter(edge => edge.b < 0) : [];
      if (worldConnections.length) {
        let staticDisplacement = result.displacement;
        if (currentSample && result.currentImpulseNodes[component.nodes[0]!]) {
          // Persistent support reactions exclude landing pulses. Reuse this
          // completed factor for the ambient RHS; no extra factorization.
          historicalRhs ??= new Float64Array(result.rhs.length);
          historicalDisplacement ??= new Float64Array(result.rhs.length);
          historicalRhs.fill(0); historicalDisplacement.fill(0);
          currentSample.ambientNodes.forEach((node, local) => historicalRhs!.set(
            currentSample.ambient.subarray(local * 6, local * 6 + 6), node * 6));
          factor.solve(historicalRhs, historicalDisplacement, work);
          staticDisplacement = historicalDisplacement;
        }
        const output = result.staticActions;
        for (const edge of worldConnections) {
          const index = edge.index, { force, moment } = this.actions(edge, staticDisplacement, work, factor);
          output.forceX[index] = force[0]; output.forceY[index] = force[1]; output.forceZ[index] = force[2];
          output.momentX[index] = moment[0]; output.momentY[index] = moment[1]; output.momentZ[index] = moment[2];
        }
      }
      if (currentSample) currentSample.forces = currentSample.forces.filter(force => !nodes.has(force.chunk));
      let historicalSamplesSolved = 0;
      for (const sample of this.pendingImpulseSamples) {
        if (sample === currentSample || !sample.forces.some(force => nodes.has(force.chunk))) continue;
        // A triangular solve is indivisible. Reserve the first pending event
        // with this component's current solve so a changing current RHS cannot
        // indefinitely consume every budget just before the old impact.
        if (!work.available && (!startedWithinBudget || historicalSamplesSolved > 0)) { result.complete = false; break; }
        historicalRhs ??= new Float64Array(result.rhs.length);
        historicalDisplacement ??= new Float64Array(result.rhs.length);
        historicalRhs.fill(0);
        sample.ambientNodes.forEach((node, local) => historicalRhs!.set(sample.ambient.subarray(local * 6, local * 6 + 6), node * 6));
        historicalDisplacement.fill(0);
        applySample(sample, historicalRhs);
        this.balanceFree(component, historicalRhs, masses);
        factor.solve(historicalRhs, historicalDisplacement, work);
        const historicalEvaluation = evaluation(sample, component, nodes);
        for (const edge of component.connections) {
          const index = edge.index, action = this.actions(edge, historicalDisplacement, work, factor);
          const score = this.score(edge, action.force, action.moment);
          recordScore(historicalEvaluation, edge, score.combined);
          peakElastic[index] = Math.max(peakElastic[index]!, score.elastic);
          // Each historical sample retains its own dt. Keep the largest separate
          // connection score; never sum impulses from different physics steps.
          // Current action buffers stay current, including reactions later sent
          // to a runtime support provider; old impacts are never replayed there.
          peakCombined[index] = Math.max(peakCombined[index]!, score.combined);
        }
        result.impulseEvaluations.push(historicalEvaluation);
        sample.forces = sample.forces.filter(force => !nodes.has(force.chunk));
        historicalSamplesSolved++;
      }
    }
    this.pendingImpulseSamples = this.pendingImpulseSamples.filter(sample => sample.forces.length > 0);
    result.deferredImpulseSamples = this.pendingImpulseSamples.length;
    const pendingNodes = new Set(this.pendingImpulseSamples.flatMap(sample => sample.forces.map(force => force.chunk)));
    for (const component of components) if (component.nodes.some(node => pendingNodes.has(node))) {
      for (const node of component.nodes) result.deferredImpulseNodes[node] = 1;
    }

    // A compliant seam is outside the rigid stiffness system. Its measured
    // Rapier reaction uses exactly the same material score and stored baseline.
    for (const [index, measured] of this.measured) {
      result.forceX[index] = measured.linear[0] / measured.sampleDt;
      result.forceY[index] = measured.linear[1] / measured.sampleDt;
      result.forceZ[index] = measured.linear[2] / measured.sampleDt;
      result.momentX[index] = measured.angular[0] / measured.sampleDt;
      result.momentY[index] = measured.angular[1] / measured.sampleDt;
      result.momentZ[index] = measured.angular[2] / measured.sampleDt;
    }
    this.measured.clear();
    {
      for (const edge of this.connections) {
        const index = edge.index;
        if (states[index] === BondState.Broken || !activeChunks[edge.a] || (edge.b >= 0 && !activeChunks[edge.b])) continue;
        const force: Vec3 = [result.forceX[index]!, result.forceY[index]!, result.forceZ[index]!];
        const moment: Vec3 = [result.momentX[index]!, result.momentY[index]!, result.momentZ[index]!];
        const score = this.score(edge, force, moment);
        const baseline = (this.baselineRates.get(edge.definition.id) ?? 0) * dt;
        const remaining = Math.max(0, 1 - damage[index]!);
        const offset = edge.offsetPressure * edge.section.area * remaining * dt;
        const impulse = Math.max(score.combined, peakCombined[index]!) * dt;
        result.combinedImpulse[index] = impulse; result.baselineImpulse[index] = baseline; result.breakOffset[index] = offset;
        result.utilization[index] = impulse / Math.max(Number.MIN_VALUE, baseline + offset);
        if ((result.solvedBonds[index] || measuredBonds.has(index)) && impulse > baseline + offset) result.fractures.bonds.push({ bond: index, health: 1 });
        else if (result.solvedBonds[index] && Math.max(score.elastic, peakElastic[index]!) > 1) result.elasticBonds.push(index);
      }
    }
    result.workLimit = work.limit; result.workUsed = work.used; result.workRemaining = work.remaining;
    result.workDeferred = 0;
    for (const component of components) {
      if (component.connections.some(edge => !result.solvedBonds[edge.index]) ||
          component.nodes.some(node => result.deferredImpulseNodes[node])) {
        for (const edge of component.connections) result.workDeferred += edge.actionWork;
      }
    }
    result.overBudget = !result.complete || work.used > work.limit;
    result.elapsedMs = now() - start;
    return result;
  }
}
