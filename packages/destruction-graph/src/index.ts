import { DirectStructuralSolver, type DirectSolveResult } from './direct';
export { DirectStructuralSolver, type DirectSolveResult } from './direct';
import { chunkDamageFalloff, generateDamageProgram, materialOf } from './shaders';
import { inheritChildBonds } from './hierarchy';
export { radialGraphShader, capsuleGraphShader, shearGraphShader, impactSpreadGraphShader, blastGraphShader, generateDamageProgram, damageFalloff, type GraphShaderContext } from './shaders';
import { EquilibriumSolver, getBondSection, type BondSection } from './equilibrium';
import type { CutBondEquilibrium } from './cut-loads';
import { buildStructuralLoads, type StructuralLoads, type StructuralLoadSnapshot } from './loads';
export type { StructuralLoadSnapshot, StructuralLoadBody } from './loads';
import { bondUtilization, materialStrengths, type Strengths } from './stress';
import {
  SUPPORT_PATH_POLICY,
  SupportPathModel,
  type SupportPathStats,
} from './support-path';
export { SUPPORT_PATH_POLICY, type SupportPathStats } from './support-path';
import {
  BondState,
  FIXED_DT,
  TRANSFORM_STRIDE,
  validateCommand,
  blastReach,
  type DestructibleManifest,
  type DestructionCommand,
  type DamageProgramDescriptor,
  type FractureCommandBuffer,
  type FractureApplyResult,
  type ChunkDemotion,
  type DestructionActor,
  type BondDef,
  type Vec3,
  type Quat,
} from '../../destruction-domain/src/index';

export const STRUCTURAL_WORK_POLICY = Object.freeze({
  coldIterations: 2048,
  /** Seconds between full re-solves of a large structure (4 ticks at 60 Hz). */
  intervalSeconds: 4 / 60,
  maxIterations: 64,
  smallWork: 4000,
  workUnitsPerSolve: 60_000,
});

export interface GraphResult {
  compliant?: Array<number>;
  actors?: Array<DestructionActor>;
  broken: Array<number>;
  checksum: string;
  cracked: Array<number>;
  islands: Array<Array<number>>;
}

export function topologyChecksum(
  manifest: DestructibleManifest,
  bondStates: Uint8Array,
  supported: Uint8Array,
): string {
  if (
    bondStates.length !== manifest.bonds.length ||
    supported.length !== manifest.fragments.length
  ) {
    throw new Error('Invalid topology checksum buffer length');
  }
  let hash = 2_166_136_261;
  const mix = (value: number) => {
    hash = Math.imul(hash ^ value, 16_777_619);
  };
  for (const i of manifest.bonds
    .map((_, i) => i)
    .sort((a, b) => manifest.bonds[a]!.id - manifest.bonds[b]!.id)) {
    mix(manifest.bonds[i]!.id);
    mix(bondStates[i]!);
  }
  for (const i of manifest.fragments
    .map((_, i) => i)
    .sort((a, b) => manifest.fragments[a]!.id - manifest.fragments[b]!.id)) {
    mix(manifest.fragments[i]!.id);
    mix(supported[i]!);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export class StructuralGraph {
  damageRevision = 0;
  readonly directSolver: DirectStructuralSolver;
  directResult: DirectSolveResult | null = null;
  elasticBonds: Array<number> = [];
  /** Legacy nominal quota scale, converted to calibrated deterministic work units. */
  directBudgetMs = 6;
  /** Explicit deterministic quota, when supplied by the step-budget ladder. */
  directWorkLimit?: number;
  structuralSolver: 'direct' | 'support-path' = 'direct';
  hierarchyRevision = 0;
  bondRevision = 0;
  lastDemotions: Array<ChunkDemotion> = [];
  private readonly fractureBroken: Array<number> = [];
  private readonly fractureCracked: Array<number> = [];
  private readonly fractureCompliant: Array<number> = [];
  readonly activeChunks: Uint8Array;
  readonly chunkHealth: Float32Array;
  readonly children: Array<Array<number>>;
  readonly parents: Int32Array;
  readonly worldSupported: Uint8Array;
  private readonly initialChunkHealth: Float32Array;
  /** Free actors retain their complete geometric cover until descendants actually split. */
  private readonly freeDemotedChunks: Uint8Array;
  private cachedChecksum: string | null = null;
  solverStats = {
    converged: true,
    deferred: false,
    iterations: 0,
    maxUtilization: 0,
    residual: 0,
    workUnits: 0,
  };
  readonly damage: Float32Array;
  readonly states: Uint8Array;
  /** Rigid path to world: these chunks belong to fixed physics actors. */
  readonly supported: Uint8Array;
  /** Any live path to world, including compliant seams. */
  readonly structurallySupported: Uint8Array;
  readonly utilization: Float32Array;
  readonly rowOffsets: Uint32Array;
  readonly bondIndices: Uint32Array;
  readonly endpointsA: Uint32Array;
  readonly endpointsB: Uint32Array;
  readonly fragmentMass: Float64Array;
  private massRevision = 0;
  private readonly pending: Float64Array;
  private readonly removed: Uint8Array;
  private readonly sectionFraction: Float64Array;
  private readonly queue: Uint32Array;
  private readonly distance: Int32Array;
  readonly fragmentUtilization: Float32Array;
  readonly fragmentStressKnown: Uint8Array;
  private externalLoads: StructuralLoadSnapshot | null = null;
  private latestLoads: StructuralLoads | null = null;
  private loadsTopologyDirty = true;
  private displayEquilibrium?: EquilibriumSolver;
  readonly sections: Array<BondSection>;
  /** Legacy diagnostic, allocated only when a caller explicitly requests elastic display. */
  get equilibrium(): EquilibriumSolver { return this.displayEquilibrium ??= new EquilibriumSolver(this.manifest); }
  readonly cutEquilibrium: CutBondEquilibrium | null;
  private readonly strengths: Array<Strengths>;
  private stressDirty = true;
  private loadsChanged = true;
  private readonly invalidated: Uint8Array;
  private readonly fragmentOrder: Array<number>;
  private readonly bondOrder: Array<number>;
  private readonly fragmentIndex: Map<number, number>;
  private readonly seenCommands = new Set<string>();
  /** Runtime contacts are owned by their physics support provider, not authored foundations. */
  private readonly bearingWorldBondIds = new Set<number>();
  /** Released runtime slots only; authored and inherited graph indices never move. */
  private readonly releasedBearingSlots = new Set<number>();
  private islands: Array<Array<number>> = [];
  private supportedComponents: Array<Array<number>> = [];
  private readonly visibleChunkCache = new Map<number, {
    revision: number; nodes: number[]; visible: number[];
  }>();
  private topologyDirty = true;
  private readonly supportPath: SupportPathModel;
  private readonly restPositions: Float64Array;
  private supportPathDirty = true;
  private supportCandidates: Array<number> = [];
  private gravityLoads: Float64Array | null = null;
  supportPathStats: SupportPathStats = { components: 0, maxUtilization: 0, overloadedBonds: 0 };
  /**
   * Bonds that may break in the next step. A break splits at most one body in two, so a host
   * with N free body slots sets N: further overloaded bonds stay at damage 0.99 and are retried
   * next step instead of creating bodies the host cannot afford. Reset by the host each tick.
   */
  breakBudget = Number.POSITIVE_INFINITY;
  deferredBreaks = 0;

  readonly manifest: DestructibleManifest;

  constructor(manifest: DestructibleManifest, familyOwned = false, directSolver?: DirectStructuralSolver) {
    this.manifest = familyOwned ? manifest : { ...manifest, bonds: [...manifest.bonds] };
    manifest = this.manifest;
    const n = manifest.fragments.length,
      m = manifest.bonds.length;
    const chunkIndex = new Map(manifest.fragments.map((fragment, index) => [fragment.id, index]));
    this.parents = Int32Array.from(manifest.fragments, (fragment) => chunkIndex.get(fragment.parent ?? -1) ?? -1);
    this.children = Array.from({ length: n }, () => []);
    this.parents.forEach((parent, index) => { if (parent >= 0) this.children[parent]!.push(index); });
    this.activeChunks = Uint8Array.from(manifest.fragments, (fragment) => fragment.support === false ? 0 : 1);
    this.chunkHealth = Float32Array.from(manifest.fragments, (fragment) => fragment.initialHealth ?? 1);
    this.initialChunkHealth = this.chunkHealth.slice();
    this.freeDemotedChunks = new Uint8Array(n);
    this.worldSupported = new Uint8Array(n);
    this.damage = new Float32Array(m);
    this.states = new Uint8Array(m);
    this.supported = new Uint8Array(n);
    this.structurallySupported = new Uint8Array(n);
    this.utilization = new Float32Array(m);
    this.pending = new Float64Array(m);
    this.fragmentMass = Float64Array.from(manifest.fragments, (fragment, index) => this.activeChunks[index] ? fragment.mass : 0);
    this.removed = Uint8Array.from(this.activeChunks, (active) => active ? 0 : 1);
    this.sectionFraction = new Float64Array(m).fill(1);
    this.rowOffsets = new Uint32Array(n + 1);
    this.bondIndices = new Uint32Array(m * 2);
    this.endpointsA = new Uint32Array(m);
    this.endpointsB = new Uint32Array(m);
    this.queue = new Uint32Array(n);
    this.distance = new Int32Array(n);
    this.fragmentUtilization = new Float32Array(n);
    this.fragmentStressKnown = new Uint8Array(n);
    this.sections = manifest.bonds.map((bond) => getBondSection(manifest, bond, chunkIndex));
    this.invalidated = new Uint8Array(n);
    const materialsById = new Map(manifest.materials.map((material) => [material.id, material]));
    const fragmentsById = new Map(manifest.fragments.map((fragment) => [fragment.id, fragment]));
    this.strengths = manifest.bonds.map((bond) => {
      const ma = materialsById.get(fragmentsById.get(bond.a)!.material)!;
      const mb = materialsById.get(fragmentsById.get(bond.b === -1 ? bond.a : bond.b)!.material)!;
      const sa = materialStrengths(ma),
        sb = materialStrengths(mb);
      const authoredScale = bond.strength / Math.min(ma.strength, mb.strength);
      return {
        bending: Math.min(sa.bending, sb.bending) * authoredScale,
        compression: Math.min(sa.compression, sb.compression) * authoredScale,
        shear: Math.min(sa.shear, sb.shear) * authoredScale,
        tension: Math.min(sa.tension, sb.tension) * authoredScale,
      };
    });
    this.fragmentOrder = manifest.fragments
      .map((_, i) => i)
      .sort((a, b) => manifest.fragments[a]!.id - manifest.fragments[b]!.id);
    this.bondOrder = manifest.bonds
      .map((_, i) => i)
      .sort((a, b) => manifest.bonds[a]!.id - manifest.bonds[b]!.id);
    const index = new Map(manifest.fragments.map((f, i) => [f.id, i]));
    this.fragmentIndex = index;
    if (index.size !== n) {
      throw new Error('Fragment IDs must be unique');
    }
    for (let i = 0; i < m; i++) {
      const a = index.get(manifest.bonds[i]!.a),
        b = manifest.bonds[i]!.b === -1 ? a : index.get(manifest.bonds[i]!.b);
      if (a === undefined || b === undefined || (a === b && manifest.bonds[i]!.b !== -1)) {
        throw new Error(`Invalid endpoints for bond ${manifest.bonds[i]!.id}`);
      }
      this.endpointsA[i] = a;
      this.endpointsB[i] = b;
      this.rowOffsets[a + 1]!++;
      if (a !== b) this.rowOffsets[b + 1]!++;
    }
    for (let i = 1; i <= n; i++) {
      this.rowOffsets[i]! += this.rowOffsets[i - 1]!;
    }
    const cursor = this.rowOffsets.slice();
    for (const i of this.bondOrder) {
      this.bondIndices[cursor[this.endpointsA[i]!]!++] = i;
      if (this.endpointsB[i] !== this.endpointsA[i]) this.bondIndices[cursor[this.endpointsB[i]!]!++] = i;
    }
    this.cutEquilibrium = null;
    const positions = this.restPositions = new Float64Array(n * 3);
    const anchored = this.worldSupported;
    manifest.fragments.forEach((fragment, i) => {
      positions.set(fragment.position, i * 3);
      anchored[i] = fragment.anchored && this.activeChunks[i] ? 1 : 0;
    });
    this.supportPath = new SupportPathModel(
      {
        anchored,
        bondIndices: this.bondIndices,
        damage: this.damage,
        endpointsA: this.endpointsA,
        endpointsB: this.endpointsB,
        positions,
        rowOffsets: this.rowOffsets,
        sections: this.sections,
        states: this.states,
        strengths: this.strengths,
      },
      n,
      m,
    );
    this.rebuildConnectivity();
    this.directSolver = directSolver ?? new DirectStructuralSolver(this.manifest, { budgetMs: this.directBudgetMs });
  }

  initializeStress(): void {
    this.evaluateLoad(0, [], [], true);
  }

  /** Register observed bearing interfaces, recycling only released runtime contact slots. */
  addBearingWorldBonds(definitions: ReadonlyArray<Omit<BondDef, 'id'>>): number[] {
    if (!definitions.length) return [];
    let id = this.manifest.bonds.reduce((maximum, bond) => Math.max(maximum, bond.id), 0) + 1;
    const sections: BondSection[] = [];
    const bonds = definitions.map(definition => {
      const node = this.fragmentIndex.get(definition.a);
      if (definition.b !== -1 || definition.parentBond !== undefined || node === undefined ||
          !this.activeChunks[node] || !(definition.area > 0) || !Number.isFinite(definition.area) ||
          !(definition.strength > 0) || !Number.isFinite(definition.strength) ||
          !definition.normal.every(Number.isFinite) ||
          (definition.centroid && !definition.centroid.every(Number.isFinite))) {
        throw new Error('Invalid runtime bearing world bond');
      }
      const bond: BondDef = { ...definition, id: id++, b: -1, joint: false,
        normal: [...definition.normal],
        ...(definition.centroid ? { centroid: [...definition.centroid] as Vec3 } : {}),
        ...(definition.section ? { section: { ...definition.section,
          point: [...definition.section.point], tangent1: [...definition.section.tangent1],
          tangent2: [...definition.section.tangent2] } } : {}),
      };
      sections.push(getBondSection(this.manifest, bond, this.fragmentIndex));
      return bond;
    });
    // A fracture event still names its old slot until graph.step drains it.
    // Reuse only after those notifications have been consumed, and give every
    // physical contact a fresh ID so a delayed owner cannot release its successor.
    const referenced = new Set([...this.fractureBroken, ...this.fractureCracked, ...this.fractureCompliant]);
    const available = [...this.releasedBearingSlots].filter(index => !referenced.has(index)).sort((a, b) => a - b);
    const replacements: Array<{ index: number; previousId: number }> = [];
    const indices: number[] = [];
    const appendedIds: number[] = [];
    for (const [offset, bond] of bonds.entries()) {
      const index = available[offset];
      if (index === undefined) {
        indices.push(this.manifest.bonds.length);
        appendedIds.push(bond.id);
        this.manifest.bonds.push(bond);
      } else {
        const previousId = this.manifest.bonds[index]!.id;
        replacements.push({ index, previousId });
        this.bearingWorldBondIds.delete(previousId);
        this.releasedBearingSlots.delete(index);
        this.manifest.bonds[index] = bond;
        indices.push(index);
      }
    }
    // Capture unloaded birth BEFORE gravity/provider loads. Existing authored
    // baselines are untouched, while retired contact baselines are forgotten.
    this.directSolver.registerUnloadedBonds(appendedIds);
    this.directSolver.replaceUnloadedBonds(replacements);
    this.refreshBearingStorage(indices, sections);
    for (const bond of bonds) this.bearingWorldBondIds.add(bond.id);
    this.bondRevision++;
    this.directResult = null;
    this.elasticBonds = [];
    this.displayEquilibrium = undefined;
    // Connectivity changes the load grouping even when the snapshot is the same.
    // Retain the previous snapshot/storage; evaluateLoad rebuilds its RHS before solving.
    this.rebuildConnectivity();
    return indices;
  }

  /** Update only contact slots; hierarchy, chunk state and component factors retain their owners. */
  private refreshBearingStorage(indices: ReadonlyArray<number>, sections: ReadonlyArray<BondSection>): void {
    const n = this.manifest.fragments.length, m = this.manifest.bonds.length;
    const grew = this.states.length !== m;
    if (grew) {
      const states = new Uint8Array(m), damage = new Float32Array(m), utilization = new Float32Array(m);
      const pending = new Float64Array(m), sectionFraction = new Float64Array(m).fill(1);
      const endpointsA = new Uint32Array(m), endpointsB = new Uint32Array(m);
      states.set(this.states); damage.set(this.damage); utilization.set(this.utilization);
      pending.set(this.pending); sectionFraction.set(this.sectionFraction);
      endpointsA.set(this.endpointsA); endpointsB.set(this.endpointsB);
      Object.assign(this, { states, damage, utilization, pending, sectionFraction,
        endpointsA, endpointsB, bondIndices: new Uint32Array(m * 2) });
    }
    const materials = new Map(this.manifest.materials.map(material => [material.id, material]));
    const changed = new Set(indices);
    for (const [offset, index] of indices.entries()) {
      const bond = this.manifest.bonds[index]!, node = this.fragmentIndex.get(bond.a)!;
      const material = materials.get(this.manifest.fragments[node]!.material)!;
      const strength = materialStrengths(material), scale = bond.strength / material.strength;
      this.sections[index] = sections[offset]!;
      this.strengths[index] = { bending: strength.bending * scale, compression: strength.compression * scale,
        shear: strength.shear * scale, tension: strength.tension * scale };
      this.endpointsA[index] = node; this.endpointsB[index] = node;
      this.states[index] = BondState.Intact; this.damage[index] = 0; this.pending[index] = 0;
      this.sectionFraction[index] = 1; this.utilization[index] = 0;
    }
    // New generation IDs are greater than every retained ID, including when a
    // low array slot is recycled. Keep the same authored-ID traversal/tie order.
    const retained = this.bondOrder.filter(index => !changed.has(index));
    this.bondOrder.length = 0;
    this.bondOrder.push(...retained, ...indices);
    this.rowOffsets.fill(0);
    for (let index = 0; index < m; index++) {
      const a = this.endpointsA[index]!, b = this.endpointsB[index]!;
      this.rowOffsets[a + 1]!++;
      if (a !== b) this.rowOffsets[b + 1]!++;
    }
    for (let node = 1; node <= n; node++) this.rowOffsets[node]! += this.rowOffsets[node - 1]!;
    const cursor = this.rowOffsets.slice();
    for (const index of this.bondOrder) {
      this.bondIndices[cursor[this.endpointsA[index]!]!++] = index;
      if (this.endpointsB[index] !== this.endpointsA[index]) this.bondIndices[cursor[this.endpointsB[index]!]!++] = index;
    }
    if (grew) Object.assign(this, { supportPath: new SupportPathModel({
      anchored: this.worldSupported, bondIndices: this.bondIndices, damage: this.damage,
      endpointsA: this.endpointsA, endpointsB: this.endpointsB, positions: this.restPositions,
      rowOffsets: this.rowOffsets, sections: this.sections, states: this.states, strengths: this.strengths,
    }, n, m) });
    else this.supportPath.clear();
  }

  isBearingWorldBond(index: number): boolean {
    const bond = this.manifest.bonds[index];
    return bond !== undefined && this.bearingWorldBondIds.has(bond.id);
  }

  /** A lost contact/provider removes its constraint immediately, independently of body-cap fracture deferral. */
  removeBearingWorldBonds(indices: ReadonlyArray<number>, generations?: ReadonlyArray<number>): void {
    if (!indices.length) return;
    if (generations && generations.length !== indices.length) throw new Error('Invalid bearing bond generations');
    for (const index of indices) if (!this.isBearingWorldBond(index)) throw new Error('Invalid runtime bearing bond index');
    const budget = this.breakBudget;
    this.breakBudget = Infinity;
    try {
      for (const [offset, index] of indices.entries()) {
        if (generations && this.manifest.bonds[index]!.id !== generations[offset]) continue;
        this.pending[index] = 0;
        this.commitDamage(index, 1, this.fractureBroken, this.fractureCracked);
        this.releasedBearingSlots.add(index);
      }
    } finally { this.breakBudget = budget; }
    this.directResult = null;
    if (this.topologyDirty) this.rebuildConnectivity();
  }

  /** Asset-frame impulse, N·s, at an asset-frame position on a receiving chunk. */
  addForce(chunk: number, position: Vec3, impulse: Vec3): boolean {
    if (![...position, ...impulse].every(Number.isFinite)) throw new Error('Invalid structural impulse');
    const node = this.resolveSupportChunk(chunk, position);
    if (node < 0) return false;
    this.directSolver.addForce(node, position, impulse);
    this.stressDirty = true;
    return true;
  }

  /** Rapier joint feedback in asset coordinates, sampled over sampleDt seconds. */
  setMeasuredImpulse(bond: number, linear: Vec3, angular: Vec3, sampleDt: number): void {
    this.directSolver.setMeasuredImpulse(bond, linear, angular, sampleDt);
    this.stressDirty = true;
  }

  setExternalLoads(snapshot: StructuralLoadSnapshot): void {
    this.externalLoads = snapshot;
    const next = buildStructuralLoads(
      this.manifest,
      this.supported,
      snapshot,
      this.islands,
      this.supportedComponents,
      this.fragmentMass,
      this.worldSupported,
    );
    const previous = this.latestLoads;
    this.loadsChanged =
      this.loadsChanged ||
      !previous ||
      next.rhs.some((value, i) => value !== previous.rhs[i]) ||
      next.clamped.some((value, i) => value !== previous.clamped[i]) ||
      next.solverGroups.some((value, i) => value !== previous.solverGroups[i]);
    this.latestLoads = next;
    // This snapshot already rebuilt the RHS for the current connectivity and
    // masses. Only an outstanding topology rebuild needs to do that work again.
    this.loadsTopologyDirty = this.topologyDirty;
    if (this.loadsChanged) {
      this.supportPathDirty = true;
    }
  }

  private invalidateStressComponent(first: number, _preserveDisplay = false): void {
    if (this.invalidated[first]) return;
    this.invalidated[first] = 1;
    const stack = [first];
    while (stack.length) {
      const node = stack.pop()!;
      this.fragmentStressKnown[node] = 0;
      for (let row = this.rowOffsets[node]!; row < this.rowOffsets[node + 1]!; row++) {
        const bond = this.bondIndices[row]!;
        if (this.states[bond] === BondState.Broken) continue;
        const other = this.endpointsA[bond] === node ? this.endpointsB[bond]! : this.endpointsA[bond]!;
        if (!this.invalidated[other]) { this.invalidated[other] = 1; stack.push(other); }
      }
    }
  }

  private validFragment(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.manifest.fragments.length) {
      throw new Error('Invalid fragment index');
    }
  }

  getCompliantBonds(): Array<number> {
    return this.bondOrder.filter((bond) => this.states[bond] === BondState.Compliant);
  }

  /** Past the elastic limit, a jointed member interface leaves rigid connectivity. */
  enterCompliant(bonds: ReadonlyArray<number>): Array<number> {
    const changed: Array<number> = [];
    for (const bond of bonds) {
      const definition = this.manifest.bonds[bond];
      if (!definition || !definition.joint || this.states[bond] === BondState.Broken || this.states[bond] === BondState.Compliant) continue;
      const a = this.manifest.fragments[this.endpointsA[bond]!]!, b = this.manifest.fragments[this.endpointsB[bond]!]!;
      // Dormant cell seams within one member do not become Dynamism joints. Inherited
      // portions of an original member interface retain that interface's joint flag.
      if (definition.parentBond === undefined && (a.depth !== 1 || (definition.b !== -1 && b.depth !== 1))) continue;
      this.states[bond] = BondState.Compliant;
      this.damageRevision++; this.hierarchyRevision++;
      this.topologyDirty = true; this.supportPathDirty = true; this.loadsTopologyDirty = true;
      this.stressDirty = true; this.cachedChecksum = null;
      this.invalidateStressComponent(this.endpointsA[bond]!);
      this.invalidateStressComponent(this.endpointsB[bond]!);
      changed.push(bond);
    }
    this.fractureCompliant.push(...changed);
    return changed;
  }

  isWorldSupported(index: number): boolean {
    this.validFragment(index);
    return this.worldSupported[index] === 1;
  }

  /** Map a collider/render chunk to a currently live support node. */
  resolveSupportChunk(index: number, position?: Vec3): number {
    this.validFragment(index);
    let ancestor = index;
    while (ancestor >= 0) {
      if (this.activeChunks[ancestor] && !this.removed[ancestor]) return ancestor;
      ancestor = this.parents[ancestor]!;
    }
    let best = -1, distance = Infinity;
    const stack = [...this.children[index]!];
    while (stack.length) {
      const node = stack.pop()!;
      if (this.activeChunks[node] && !this.removed[node]) {
        const fragment = this.manifest.fragments[node]!;
        const d = position ? position.reduce((sum, value, axis) => sum + Math.max(0, Math.abs(value - fragment.position[axis]!) - fragment.size[axis]! / 2) ** 2, 0) : node;
        if (d < distance || (d === distance && node < best)) { best = node; distance = d; }
      } else stack.push(...this.children[node]!);
    }
    return best;
  }

  getActors(): Array<DestructionActor> {
    return [
      ...this.supportedComponents.map((nodes) => ({ id: this.manifest.fragments[nodes[0]!]!.id, nodes: [...nodes], supported: true, visibleChunks: this.getVisibleChunks(nodes) })),
      ...this.islands.map((nodes) => ({ id: this.manifest.fragments[nodes[0]!]!.id, nodes: [...nodes], supported: false, visibleChunks: this.getVisibleChunks(nodes) })),
    ];
  }

  getVisibleChunks(nodes?: ReadonlyArray<number>): Array<number> {
    if (!nodes) return this.getActors().flatMap((actor) => actor.visibleChunks).sort((a, b) => a - b);
    if (!nodes.length) return [];
    // Bearing topology rebuilds component arrays even when their membership is
    // unchanged. Visibility depends on that exact membership and chunk state,
    // not on the generation of the bearing bonds or the component array.
    const key = nodes[0]!, cached = this.visibleChunkCache.get(key);
    if (cached && cached.revision === this.hierarchyRevision &&
        cached.nodes.length === nodes.length && cached.nodes.every((node, i) => node === nodes[i])) {
      return [...cached.visible];
    }
    const owned = new Set(nodes);
    const intact = new Map<number, boolean>();
    let geometry: Map<number, boolean> | undefined;
    const completeGeometry = (index: number): boolean => {
      geometry ??= new Map<number, boolean>();
      if (geometry.has(index)) return geometry.get(index)!;
      const value = this.activeChunks[index]
        ? owned.has(index) && !this.removed[index] && this.fragmentMass[index]! >= this.manifest.fragments[index]!.mass * (1 - 1e-8)
        : this.children[index]!.length > 0 && this.children[index]!.every(completeGeometry);
      geometry.set(index, value);
      return value;
    };
    const complete = (index: number): boolean => {
      if (intact.has(index)) return intact.get(index)!;
      let value: boolean;
      if (this.freeDemotedChunks[index]) value = completeGeometry(index);
      else {
        value = this.chunkHealth[index]! >= this.initialChunkHealth[index]! - 1e-6;
        if (this.activeChunks[index]) value &&= owned.has(index) && !this.removed[index] && this.fragmentMass[index]! >= this.manifest.fragments[index]!.mass * (1 - 1e-8);
        else value &&= this.children[index]!.length > 0 && this.children[index]!.every(complete);
      }
      intact.set(index, value);
      return value;
    };
    const visible = new Set<number>();
    for (const node of nodes) {
      if (this.removed[node]) continue;
      let chunk = node, parent = this.parents[chunk]!;
      while (parent >= 0 && complete(parent)) { chunk = parent; parent = this.parents[chunk]!; }
      visible.add(chunk);
    }
    const result = [...visible].sort((a, b) => a - b);
    this.visibleChunkCache.set(key, { revision: this.hierarchyRevision, nodes: [...nodes], visible: result });
    return [...result];
  }

  /** Damage filter shared by chunk and bond fracture programs, following NvBlastExtMaterial. */
  normalizedDamage(index: number, damage: number): number {
    this.validFragment(index);
    const material = this.manifest.materials.find((entry) => entry.id === this.manifest.fragments[index]!.material);
    const normalized = Math.max(0, damage) / (material?.health ?? 1);
    return normalized <= (material?.minDamageThreshold ?? 0.02) ? 0 : Math.min(normalized, material?.maxDamageThreshold ?? 1);
  }

  /** Applies health without splitting. The A6 apply/split stages consume exhausted chunks. */
  damageChunk(index: number, damage: number): number {
    this.validFragment(index);
    const amount = this.normalizedDamage(index, damage);
    if (!(amount > 0)) return 0;
    const previous = this.chunkHealth[index]!;
    this.chunkHealth[index] = Math.max(0, previous - amount);
    if (previous !== this.chunkHealth[index]) { this.hierarchyRevision++; this.damageRevision++; }
    return Math.max(0, amount - previous);
  }

  isRemoved(index: number): boolean {
    this.validFragment(index);
    return this.removed[index] === 1;
  }

  shockIsland(
    members: ReadonlyArray<number>,
    contacts: ReadonlyArray<{ x: number; y: number; z: number }>,
    severity: number,
    reach: number,
    positions: Float32Array,
  ): void {
    if (
      !Number.isFinite(severity) ||
      !Number.isFinite(reach) ||
      severity <= 0 ||
      reach <= 0 ||
      members.length < 2 ||
      !contacts.length
    ) {
      return;
    }
    if (positions.length !== this.manifest.fragments.length * TRANSFORM_STRIDE) {
      throw new Error('Invalid transform buffer length');
    }
    const included = new Set(members);
    const materials = new Map(this.manifest.materials.map((material) => [material.id, material]));
    for (const index of included) {
      this.validFragment(index);
      for (let slot = this.rowOffsets[index]!; slot < this.rowOffsets[index + 1]!; slot++) {
        const bi = this.bondIndices[slot]!;
        const ai = this.endpointsA[bi]!,
          bj = this.endpointsB[bi]!;
        if (
          this.states[bi] === BondState.Broken ||
          index !== Math.min(ai, bj) ||
          !included.has(ai) ||
          !included.has(bj) ||
          this.removed[ai] ||
          this.removed[bj]
        ) {
          continue;
        }
        const pa = ai * TRANSFORM_STRIDE,
          pb = bj * TRANSFORM_STRIDE;
        const x = (positions[pa]! + positions[pb]!) * 0.5;
        const y = (positions[pa + 1]! + positions[pb + 1]!) * 0.5;
        const z = (positions[pa + 2]! + positions[pb + 2]!) * 0.5;
        let nearest = Infinity;
        for (const contact of contacts) {
          const distance = Math.hypot(x - contact.x, y - contact.y, z - contact.z);
          if (Number.isFinite(distance)) {
            nearest = Math.min(nearest, distance);
          }
        }
        const falloff = 1 - nearest / reach;
        if (!(falloff > 0)) {
          continue;
        }
        const a = this.manifest.fragments[ai]!,
          b = this.manifest.fragments[bj]!;
        const bond = this.manifest.bonds[bi]!;
        const brittleness =
          ((materials.get(a.material)?.brittleness ?? 0.7) +
            (materials.get(b.material)?.brittleness ?? 0.7)) /
          2;
        const resistance = Math.max(0.15, bond.strength) * (0.5 + Math.sqrt(bond.area) * 0.5);
        const amount = (severity * falloff * (0.65 + 0.5 * brittleness)) / resistance;
        if (Number.isFinite(amount)) {
          this.pending[bi]! += amount;
        }
      }
    }
  }

  crushFragment(index: number): void {
    this.validFragment(index);
    this.removeFragment(index);
  }

  incidentBonds(index: number): ReadonlyArray<number> {
    this.validFragment(index);
    return Array.from(
      this.bondIndices.subarray(this.rowOffsets[index]!, this.rowOffsets[index + 1]!),
    ).sort((a, b) => a - b);
  }

  /**
   * Force a fragment's intact incident bonds can still transmit: shear strength × area, scaled
   * by remaining section and damage. Shear is the weakest mode, so this bounds a reaction
   * entering the fragment from any direction. Broken bonds and removed fragments contribute 0.
   */
  incidentBondCapacity(index: number): number {
    this.validFragment(index);
    let capacity = 0;
    for (let slot = this.rowOffsets[index]!; slot < this.rowOffsets[index + 1]!; slot++) {
      const bond = this.bondIndices[slot]!;
      if (this.states[bond]! === BondState.Broken) {
        continue;
      }
      capacity +=
        this.strengths[bond]!.shear *
        this.manifest.bonds[bond]!.area *
        this.sectionFraction[bond]! *
        (1 - this.damage[bond]! * 0.6);
    }
    return capacity;
  }

  /** Fail every intact incident bond of a fragment on the next step. Returns how many. */
  failIncidentBonds(index: number): number {
    this.validFragment(index);
    let count = 0;
    for (let slot = this.rowOffsets[index]!; slot < this.rowOffsets[index + 1]!; slot++) {
      const bond = this.bondIndices[slot]!;
      if (this.states[bond]! !== BondState.Broken) {
        this.pending[bond]! += 1;
        count++;
      }
    }
    return count;
  }

  setFragmentMass(index: number, mass: number): void {
    this.validFragment(index);
    const authored = this.manifest.fragments[index]!.mass;
    if (!Number.isFinite(mass) || !(mass > 0) || mass > authored * (1 + 1e-9)) {
      throw new Error('Invalid fragment mass');
    }
    const next = Math.min(mass, authored);
    if (this.removed[index]! || next === this.fragmentMass[index]!) {
      return;
    }
    this.fragmentMass[index] = next;
    this.hierarchyRevision++;
    this.massRevision++;
    this.loadsTopologyDirty = true;
    this.supportPathDirty = true;
    this.stressDirty = true;
    this.solverStats.converged = false;
    this.invalidateStressComponent(index, true);
  }

  setBondSectionFraction(bond: number, fraction: number): void {
    if (!Number.isInteger(bond) || bond < 0 || bond >= this.manifest.bonds.length) {
      throw new Error('Invalid bond index');
    }
    if (!Number.isFinite(fraction)) {
      throw new Error('Invalid bond section fraction');
    }
    const next = Math.min(1, Math.max(0, fraction)),
      previous = this.sectionFraction[bond]!;
    if (next >= previous || this.states[bond]! === BondState.Broken) {
      return;
    }
    this.sectionFraction[bond] = next;
    if (next <= 0.4) {
      this.pending[bond]! += 1;
      return;
    }
    const damage = Math.min(1, this.damage[bond]! + this.pending[bond]!);
    this.pending[bond]! += ((1 - damage * 0.6) * (1 - next / previous)) / 0.6;
  }

  removeFragment(index: number): void {
    this.removeFragments([index]);
  }

  removeFragments(indices: ReadonlyArray<number>): void {
    for (const index of indices) {
      this.validFragment(index);
    }
    for (const index of indices) {
      this.removeFragmentState(index);
    }
    if (this.topologyDirty) {
      this.rebuildConnectivity();
    }
  }

  private removeFragmentState(index: number): void {
    if (this.removed[index]!) {
      return;
    }
    this.removed[index] = 1;
    this.activeChunks[index] = 0;
    this.fragmentMass[index] = 0;
    this.hierarchyRevision++;
    this.damageRevision++;
    this.cachedChecksum = null;
    for (let slot = this.rowOffsets[index]!; slot < this.rowOffsets[index + 1]!; slot++) {
      const bond = this.bondIndices[slot]!;
      this.pending[bond] = 0;
      if (this.states[bond]! === BondState.Broken) {
        continue;
      }
      this.damage[bond] = 1;
      this.states[bond] = BondState.Broken;
      this.utilization[bond] = 0;
      this.invalidateStressComponent(this.endpointsA[bond]!);
      this.invalidateStressComponent(this.endpointsB[bond]!);
    }
    this.fragmentUtilization[index] = 0;
    this.fragmentStressKnown[index] = 0;
    this.solverStats.converged = false;
    this.topologyDirty = true;
  }

  generateFracture(
    input: DamageProgramDescriptor | ReadonlyArray<DamageProgramDescriptor> | ReadonlyArray<DestructionCommand>,
    positions?: Float32Array,
  ): FractureCommandBuffer {
    if (positions && positions.length !== this.manifest.fragments.length * TRANSFORM_STRIDE) throw new Error('Invalid transform buffer length');
    const entries = Array.isArray(input) ? input : [input];
    const programs: Array<DamageProgramDescriptor> = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      if ('tick' in entry) {
        const command = entry as DestructionCommand;
        if (!validateCommand(command) || !['pointImpact', 'explosion', 'cut'].includes(command.type)) continue;
        const commandKey = `${command.source}:${command.id}`;
        if (seen.has(commandKey) || this.seenCommands.has(commandKey)) continue;
        seen.add(commandKey);
        const hit = command.fragmentId === undefined ? undefined : this.fragmentIndex.get(command.fragmentId);
        let hitPosition = command.position;
        if (hit !== undefined && positions) {
          const offset = hit * TRANSFORM_STRIDE;
          const x = command.position[0] - positions[offset]!, y = command.position[1] - positions[offset + 1]!, z = command.position[2] - positions[offset + 2]!;
          const qx = -positions[offset + 3]!, qy = -positions[offset + 4]!, qz = -positions[offset + 5]!, qw = positions[offset + 6]!;
          const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
          const origin = this.manifest.fragments[hit]!.position;
          hitPosition = [origin[0] + x + qw * tx + qy * tz - qz * ty, origin[1] + y + qw * ty + qz * tx - qx * tz, origin[2] + z + qw * tz + qx * ty - qy * tx];
        }
        const chunk = hit === undefined ? -1 : this.resolveSupportChunk(hit, hitPosition);
        const shared = { position: [...command.position] as Vec3, normal: [...command.direction] as Vec3, ...(chunk >= 0 ? { chunk } : {}), commandKey };
        if (command.type === 'explosion') {
          programs.push({ type: 'blast', charge: command.charge, maxRadius: blastReach(command.charge, this.manifest.materials), ...shared });
        } else if (command.type === 'pointImpact' || command.type === 'cut') {
          programs.push({
            type: command.damageProgram ?? (command.end ? 'capsule' : command.type === 'cut' ? 'shear' : 'impactSpread'),
            damage: command.strength,
            minRadius: command.minRadius ?? 0,
            maxRadius: command.radius,
            ...(command.end ? { end: [...command.end] as Vec3 } : {}),
            ...shared,
          });
        }
      } else {
        const descriptor = entry as DamageProgramDescriptor;
        if (descriptor.commandKey && (seen.has(descriptor.commandKey) || this.seenCommands.has(descriptor.commandKey))) continue;
        if (descriptor.commandKey) seen.add(descriptor.commandKey);
        programs.push(descriptor);
      }
    }
    const result: FractureCommandBuffer = { bonds: [], chunks: [], programs: [] };
    const context = {
      manifest: this.manifest, activeChunks: this.activeChunks, chunkHealth: this.chunkHealth,
      states: this.states, damage: this.damage, endpointsA: this.endpointsA, endpointsB: this.endpointsB,
      rowOffsets: this.rowOffsets, bondIndices: this.bondIndices, positions,
    };
    for (const program of programs) {
      const generated = generateDamageProgram(context, program), offset = result.programs.length;
      result.programs.push(...generated.programs);
      result.bonds.push(...generated.bonds.map((command) => ({ ...command, program: offset + (command.program ?? 0) })));
      result.chunks.push(...generated.chunks.map((command) => ({ ...command, program: offset + (command.program ?? 0) })));
    }
    return result;
  }

  applyFracture(buffer: FractureCommandBuffer, positions?: Float32Array): FractureApplyResult {
    if (positions && positions.length !== this.manifest.fragments.length * TRANSFORM_STRIDE) throw new Error('Invalid transform buffer length');
    const broken: Array<number> = [], cracked: Array<number> = [];
    const accepted = buffer.programs.map((program) => !program.commandKey || !this.seenCommands.has(program.commandKey));
    const eligible = (program: number | undefined): boolean => program === undefined || accepted[program] === true;
    const bondDoses = buffer.programs.map(() => new Map<number, number>());
    const chunkDoses = buffer.programs.map(() => new Map<number, number>());
    for (const command of buffer.bonds) {
      if (!eligible(command.program)) continue;
      if (!Number.isInteger(command.bond) || command.bond < 0 || command.bond >= this.states.length || !Number.isFinite(command.health) || command.health < 0) throw new Error('Invalid bond fracture command');
      const previous = this.damage[command.bond]!;
      this.commitDamage(command.bond, command.health, broken, cracked);
      if (command.program !== undefined) {
        const doses = bondDoses[command.program]!, id = this.manifest.bonds[command.bond]!.id;
        doses.set(id, (doses.get(id) ?? 0) + this.damage[command.bond]! - previous);
      }
    }
    const demote = new Set<number>(), exhaustedLeaves = new Set<number>();
    const demotions: Array<ChunkDemotion> = [];
    // Capture actors before the event: breaking world bonds in this same program
    // must not turn an in-place supported demotion into a retained free cover.
    const freeActors = this.islands;
    let freeChunks: Set<number> | undefined;
    let fracturePositions = positions;
    const worldPosition = (chunk: number, source: number): Vec3 => {
      const fragment = this.manifest.fragments[chunk]!;
      if (!fracturePositions) return fragment.position;
      const parent = this.manifest.fragments[source]!, o = source * TRANSFORM_STRIDE;
      const [x, y, z] = fragment.position.map((value, axis) => value - parent.position[axis]!) as Vec3;
      const qx = fracturePositions[o + 3]!, qy = fracturePositions[o + 4]!, qz = fracturePositions[o + 5]!, qw = fracturePositions[o + 6]!;
      const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
      return [fracturePositions[o]! + x + qw * tx + qy * tz - qz * ty, fracturePositions[o + 1]! + y + qw * ty + qz * tx - qx * tz, fracturePositions[o + 2]! + z + qw * tz + qx * ty - qy * tx];
    };
    const applyChunk = (chunk: number, amount: number, descriptor: DamageProgramDescriptor | undefined, source: number, program?: number): void => {
      const previous = this.chunkHealth[chunk]!;
      if (!(amount > 0)) return;
      this.chunkHealth[chunk] = Math.max(0, previous - amount);
      if (program !== undefined) {
        const doses = chunkDoses[program]!;
        doses.set(chunk, (doses.get(chunk) ?? 0) + previous - this.chunkHealth[chunk]!);
      }
      if (previous !== this.chunkHealth[chunk]) { this.hierarchyRevision++; this.damageRevision++; }
      if (this.chunkHealth[chunk]! > 0) return;
      const children = this.children[chunk]!;
      if (!children.length) { exhaustedLeaves.add(chunk); return; }
      demote.add(chunk);
      // Only damage left after exhausting the parent reaches its children. An
      // exactly exhausted parent first exposes intact children and inherited bonds;
      // same-event shader replay then evaluates those new chunks independently.
      const excess = Math.max(0, amount - previous);
      if (!(excess > 0)) return;
      const o = source * TRANSFORM_STRIDE;
      const rotation: Quat | undefined = fracturePositions ? [fracturePositions[o + 3]!, fracturePositions[o + 4]!, fracturePositions[o + 5]!, fracturePositions[o + 6]!] : undefined;
      for (const child of children) {
        const falloff = descriptor ? chunkDamageFalloff(descriptor, this.manifest.fragments[child]!, materialOf(this.manifest, child), worldPosition(child, source), rotation) : 1;
        // Health passed beyond the failed chunk keeps the event's spatial footprint. A
        // child outside the original event receives no damage, even when its parent died.
        applyChunk(child, excess * falloff, descriptor, source, program);
      }
    };
    for (const command of buffer.chunks) {
      if (!eligible(command.program)) continue;
      this.validFragment(command.chunk);
      if (!Number.isFinite(command.health) || command.health < 0) throw new Error('Invalid chunk fracture command');
      if (!this.activeChunks[command.chunk] || this.removed[command.chunk]) continue;
      applyChunk(command.chunk, command.health, command.program === undefined ? undefined : buffer.programs[command.program], command.chunk, command.program);
    }
    while (demote.size || exhaustedLeaves.size) {
      const firstBond = this.manifest.bonds.length;
      if (demote.size) freeChunks ??= new Set(freeActors.flat());
      const changes = this.demoteChunks([...demote], broken, freeChunks);
      demote.clear();
      demotions.push(...changes);
      const newChunks = new Set(changes.flatMap((change) => change.children));
      if (changes.length && fracturePositions) {
        // Physics consumes all demotions only after this call. Shader replay needs
        // the new children's inherited world poses now, without mutating its buffer.
        if (fracturePositions === positions) fracturePositions = fracturePositions.slice();
        for (const { parent, children } of changes) for (const child of children) {
          const o = parent * TRANSFORM_STRIDE;
          fracturePositions.set([...worldPosition(child, parent), ...fracturePositions.subarray(o + 3, o + 7)], child * TRANSFORM_STRIDE);
        }
      }
      // An exhausted support leaf no longer connects its neighbours. Wait until
      // demotion has installed its adjacency, including inherited interface bonds.
      for (const leaf of exhaustedLeaves) {
        if (!this.activeChunks[leaf] || this.removed[leaf]) continue;
        for (const bond of this.incidentBonds(leaf)) this.commitDamage(bond, 1, broken, cracked);
      }
      exhaustedLeaves.clear();
      if (!changes.length) break;
      for (let program = 0; program < buffer.programs.length; program++) {
        if (!accepted[program]) continue;
        const descriptor = buffer.programs[program]!, doses = bondDoses[program]!, healthDoses = chunkDoses[program]!;
        // A subdivided old interface already carries this event's normalized dose.
        // Internal child bonds have no parent interface and receive their first dose.
        for (let bond = firstBond; bond < this.manifest.bonds.length; bond++) {
          const definition = this.manifest.bonds[bond]!;
          doses.set(definition.id, definition.parentBond === undefined ? 0 : doses.get(definition.parentBond) ?? 0);
        }
        const generated = generateDamageProgram({
          manifest: this.manifest, activeChunks: this.activeChunks, chunkHealth: this.chunkHealth,
          states: this.states, damage: this.damage, endpointsA: this.endpointsA, endpointsB: this.endpointsB,
          rowOffsets: this.rowOffsets, bondIndices: this.bondIndices, positions: fracturePositions,
        }, descriptor);
        for (const command of generated.bonds) {
          if (command.bond < firstBond) continue;
          const id = this.manifest.bonds[command.bond]!.id, inherited = doses.get(id) ?? 0;
          const previous = this.damage[command.bond]!;
          this.commitDamage(command.bond, Math.max(0, command.health - inherited), broken, cracked);
          doses.set(id, inherited + this.damage[command.bond]! - previous);
        }
        for (const command of generated.chunks) {
          if (!newChunks.has(command.chunk)) continue;
          // A newly exposed chunk is a new shader target. Credit only health
          // already spent on that same chunk by excess continuation, never the
          // damage paid by its parent. The core gate stays in the graph shader.
          const remaining = Math.max(0, command.health - (healthDoses.get(command.chunk) ?? 0));
          applyChunk(command.chunk, remaining, descriptor, command.chunk, program);
        }
      }
    }
    this.lastDemotions = demotions;
    for (let i = 0; i < buffer.programs.length; i++) {
      const key = buffer.programs[i]!.commandKey;
      if (accepted[i] && key) this.seenCommands.add(key);
    }
    this.fractureBroken.push(...broken);
    this.fractureCracked.push(...cracked);
    return { broken: [...new Set(broken)], cracked: [...new Set(cracked)], demoted: this.lastDemotions };
  }

  /** Separate topology stage; generating/applying fracture never creates a physics actor. */
  split(): GraphResult {
    if (this.topologyDirty) this.rebuildConnectivity();
    return { broken: [...new Set(this.fractureBroken)], cracked: [...new Set(this.fractureCracked)], compliant: [...new Set(this.fractureCompliant)],
      islands: this.islands, actors: this.getActors(), checksum: this.checksum() };
  }

  applyCommands(commands: Array<DestructionCommand>, positions?: Float32Array): void {
    this.applyFracture(this.generateFracture(commands, positions), positions);
  }

  /** Explicit C1 in-place replacement; returns activated child indices. */
  demoteChunk(index: number): Array<number> {
    this.validFragment(index);
    if (!this.activeChunks[index] || !this.children[index]!.length) return [];
    this.chunkHealth[index] = 0;
    const broken: Array<number> = [];
    this.lastDemotions = this.demoteChunks([index], broken);
    this.fractureBroken.push(...broken);
    return this.lastDemotions.flatMap((change) => change.children);
  }

  private demoteChunks(indices: ReadonlyArray<number>, broken: Array<number>, freeChunks?: ReadonlySet<number>): Array<ChunkDemotion> {
    if (!indices.length) return [];
    const before = this.activeChunks.slice(), active = before.slice(), removed = this.removed.slice();
    const masses = this.fragmentMass.slice();
    const freeDemoted = this.freeDemotedChunks.slice();
    freeChunks ??= new Set(this.islands.flat());
    const changes: Array<ChunkDemotion> = [];
    for (const parent of [...indices].sort((a, b) => (this.manifest.fragments[a]!.depth ?? 0) - (this.manifest.fragments[b]!.depth ?? 0))) {
      if (!active[parent] || !this.children[parent]!.length) continue;
      const children = this.children[parent]!;
      const fraction = masses[parent]! / this.manifest.fragments[parent]!.mass;
      let ancestor = parent;
      while (ancestor >= 0 && !freeDemoted[ancestor] && !freeChunks.has(ancestor)) ancestor = this.parents[ancestor]!;
      if (ancestor >= 0) freeDemoted[parent] = 1;
      active[parent] = 0; removed[parent] = 1; masses[parent] = 0;
      for (const child of children) {
        active[child] = 1; removed[child] = 0; masses[child] = this.manifest.fragments[child]!.mass * fraction;
      }
      changes.push({ parent, children: [...children] });
    }
    if (!changes.length) return [];
    const inherited = inheritChildBonds(this.manifest, this.parents, before, active, this.damage, this.states)
      // Authored subsupport patches cannot stand in for a newly observed contact
      // after its chunk disappears; physics must measure the child bearing again.
      .filter(entry => entry.bond.parentBond === undefined || !this.bearingWorldBondIds.has(entry.bond.parentBond));
    const oldCount = this.manifest.bonds.length;
    const oldStates = this.states.slice(), oldDamage = this.damage.slice();
    for (const change of changes) {
      for (const bond of this.incidentBonds(change.parent)) {
        if (oldStates[bond] !== BondState.Broken) broken.push(bond);
        oldStates[bond] = BondState.Broken; oldDamage[bond] = 1;
      }
    }
    this.manifest.bonds.push(...inherited.map((entry) => entry.bond));
    // Typed arrays, CSR adjacency and structural factorization all have a single owner.
    // Rebuild that owner on the rare demotion boundary, preserving family/graph identity
    // and every existing bond index so command buffers remain inspectable and replayable.
    const next = new StructuralGraph(this.manifest, true, this.directSolver);
    next.states.set(oldStates); next.damage.set(oldDamage); next.pending.set(this.pending);
    next.sectionFraction.set(this.sectionFraction);
    next.activeChunks.set(active); next.removed.set(removed); next.fragmentMass.set(masses);
    next.chunkHealth.set(this.chunkHealth);
    next.freeDemotedChunks.set(freeDemoted);
    next.damageRevision = this.damageRevision + 1;
    next.hierarchyRevision = this.hierarchyRevision + 1;
    next.bondRevision = this.bondRevision + 1;
    next.massRevision = this.massRevision + 1;
    next.breakBudget = this.breakBudget; next.deferredBreaks = this.deferredBreaks;
    next.directBudgetMs = this.directBudgetMs; next.directWorkLimit = this.directWorkLimit; next.structuralSolver = this.structuralSolver;
    next.externalLoads = this.externalLoads;
    next.fractureBroken.push(...this.fractureBroken); next.fractureCracked.push(...this.fractureCracked);
    next.fractureCompliant.push(...this.fractureCompliant);
    for (const key of this.seenCommands) next.seenCommands.add(key);
    for (const id of this.bearingWorldBondIds) next.bearingWorldBondIds.add(id);
    for (const index of this.releasedBearingSlots) next.releasedBearingSlots.add(index);
    inherited.forEach((entry, offset) => { next.states[oldCount + offset] = entry.state; next.damage[oldCount + offset] = entry.damage; });
    next.rebuildConnectivity();
    Object.assign(this, next);
    return changes;
  }

  step(dt = FIXED_DT): GraphResult {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.25) {
      throw new Error('Structural dt must be in (0, 0.25]');
    }
    const broken = this.fractureBroken.splice(0),
      cracked = this.fractureCracked.splice(0);
    for (const i of this.bondOrder) {
      if (this.pending[i]!) {
        this.commitDamage(i, this.pending[i], broken, cracked);
        this.pending[i] = 0;
      }
    }
    if (this.topologyDirty) {
      this.rebuildConnectivity();
    }
    this.invalidated.fill(0);
    this.evaluateLoad(dt, broken, cracked);
    if (this.topologyDirty) {
      this.rebuildConnectivity();
    }
    broken.sort((a, b) => this.manifest.bonds[a]!.id - this.manifest.bonds[b]!.id);
    cracked.sort((a, b) => this.manifest.bonds[a]!.id - this.manifest.bonds[b]!.id);
    this.invalidated.fill(0);
    this.solverStats.deferred = this.stressDirty;
    return {
      broken,
      checksum: this.checksum(),
      cracked,
      islands: this.islands,
      actors: this.getActors(),
      compliant: this.fractureCompliant.splice(0),
    };
  }

  checksum(): string {
    if (this.cachedChecksum !== null) {
      return this.cachedChecksum;
    }
    let hash = 2_166_136_261;
    const mix = (value: number) => {
      hash = Math.imul(hash ^ value, 16_777_619);
    };
    for (const i of this.bondOrder) {
      mix(this.manifest.bonds[i]!.id);
      mix(this.states[i]!);
    }
    for (const i of this.fragmentOrder) {
      mix(this.manifest.fragments[i]!.id);
      mix(this.supported[i]!);
    }
    this.cachedChecksum = (hash >>> 0).toString(16).padStart(8, '0');
    return this.cachedChecksum;
  }

  getUnsupportedIslands(): ReadonlyArray<Array<number>> {
    return this.islands;
  }

  private commitDamage(
    i: number,
    amount: number,
    broken: Array<number>,
    cracked: Array<number>,
  ): void {
    if (this.states[i]! === BondState.Broken) {
      return;
    }
    const previous = this.states[i]!;
    const oldDamage = this.damage[i]!;
    this.damage[i] = Math.min(1, oldDamage + amount);
    if (this.damage[i]! >= 1) {
      if (this.breakBudget < 1) {
        this.damage[i] = 0.99;
        this.deferredBreaks++;
      } else {
        this.breakBudget--;
      }
    }
    this.damageRevision++;
    this.utilization[i]! *= (1 - oldDamage * 0.6) / (1 - this.damage[i]! * 0.6);
    const a = this.endpointsA[i]!,
      b = this.endpointsB[i]!;
    this.fragmentUtilization[a] = Math.max(this.fragmentUtilization[a]!, this.utilization[i]!);
    this.fragmentUtilization[b] = Math.max(this.fragmentUtilization[b]!, this.utilization[i]!);
    const state =
      this.damage[i] >= 1
        ? BondState.Broken
        : previous === BondState.Compliant
          ? BondState.Compliant
          : this.damage[i] >= 0.65
          ? BondState.Yielding
          : this.damage[i] >= 0.2
            ? BondState.Cracked
            : BondState.Intact;
    this.states[i] = state;
    if (state !== previous) {
      this.cachedChecksum = null;
      this.supportPathDirty = true;
      this.stressDirty = true;
      this.solverStats.converged = false;
      this.invalidateStressComponent(this.endpointsA[i]!, state !== BondState.Broken);
      this.invalidateStressComponent(this.endpointsB[i]!, state !== BondState.Broken);
    }
    if (previous === BondState.Intact && state >= BondState.Cracked) {
      cracked.push(i);
    }
    if (state === BondState.Broken) {
      broken.push(i);
      this.topologyDirty = true;
    }
  }

  private rebuildConnectivity(): void {
    this.loadsChanged = true;
    this.invalidated.fill(0);
    this.cachedChecksum = null;
    this.supported.fill(0); this.structurallySupported.fill(0); this.worldSupported.fill(0);
    const structuralAnchors = new Uint8Array(this.activeChunks.length);
    for (const node of this.fragmentOrder) {
      if (this.manifest.fragments[node]!.anchored && !this.removed[node]) this.worldSupported[node] = structuralAnchors[node] = 1;
    }
    for (const bond of this.bondOrder) {
      const a = this.endpointsA[bond]!;
      if (this.manifest.bonds[bond]!.b !== -1 || this.states[bond] === BondState.Broken || this.removed[a]) continue;
      structuralAnchors[a] = 1;
      if (this.states[bond] !== BondState.Compliant) this.worldSupported[a] = 1;
    }
    const reach = (anchors: Uint8Array, reached: Uint8Array, rigid: boolean): void => {
      let head = 0, tail = 0;
      for (const node of this.fragmentOrder) if (anchors[node] && !this.removed[node]) {
        reached[node] = 1; this.queue[tail++] = node;
      }
      while (head < tail) {
        const node = this.queue[head++]!;
        for (let row = this.rowOffsets[node]!; row < this.rowOffsets[node + 1]!; row++) {
          const bond = this.bondIndices[row]!;
          if (this.states[bond] === BondState.Broken || (rigid && this.states[bond] === BondState.Compliant)) continue;
          const other = this.endpointsA[bond] === node ? this.endpointsB[bond]! : this.endpointsA[bond]!;
          if (!reached[other] && !this.removed[other]) { reached[other] = 1; this.queue[tail++] = other; }
        }
      }
    };
    reach(this.worldSupported, this.supported, true);
    reach(structuralAnchors, this.structurallySupported, false);
    const visited = this.removed.slice();
    this.islands = []; this.supportedComponents = [];
    for (const first of this.fragmentOrder) {
      if (visited[first]) continue;
      const nodes = [first]; visited[first] = 1;
      for (let cursor = 0; cursor < nodes.length; cursor++) {
        const node = nodes[cursor]!;
        for (let row = this.rowOffsets[node]!; row < this.rowOffsets[node + 1]!; row++) {
          const bond = this.bondIndices[row]!;
          if (this.states[bond] === BondState.Broken || this.states[bond] === BondState.Compliant) continue;
          const other = this.endpointsA[bond] === node ? this.endpointsB[bond]! : this.endpointsA[bond]!;
          if (!visited[other]) { visited[other] = 1; nodes.push(other); }
        }
      }
      nodes.sort((a, b) => this.manifest.fragments[a]!.id - this.manifest.fragments[b]!.id);
      (this.supported[first] ? this.supportedComponents : this.islands).push(nodes);
    }
    this.topologyDirty = false; this.supportPathDirty = true;
    this.stressDirty = true; this.loadsTopologyDirty = true;
    this.solverStats.converged = false;
  }

  /** Weight-only loads for a graph with no physics feeding it contact loads. */
  private weightLoads(): Float64Array {
    const rhs = (this.gravityLoads ??= new Float64Array(this.manifest.fragments.length * 6));
    rhs.fill(0);
    for (let i = 0; i < this.supported.length; i++) {
      if (this.supported[i]!) {
        rhs[i * 6 + 1] = -this.fragmentMass[i]! * 9.81;
      }
    }
    return rhs;
  }

  /**
   * Failure driver. Each supported component and each detached multi-piece body is solved by the
   * support-path model (see support-path.ts) when its loads, mass, topology or bond states
   * changed; the cached per-bond demand is re-checked every tick against the current damage, so
   * a sustained overload keeps accumulating damage without a new solve.
   */
  private applySupportPaths(dt: number): void {
    if (this.supportPathDirty) {
      this.supportPathDirty = false;
      this.solveSupportPaths();
    }
    let overloaded = 0,
      peak = 0;
    for (const bond of this.supportCandidates) {
      if (this.states[bond]! === BondState.Broken) {
        continue;
      }
      const u = this.supportPath.demand[bond]! / (1 - this.damage[bond]! * 0.6);
      peak = Math.max(peak, u);
      if (u > 1) {
        overloaded++;
        this.pending[bond] = Math.max(
          this.pending[bond]!,
          Math.min(1, SUPPORT_PATH_POLICY.damagePerSecond * dt * (u - 1)),
        );
      }
    }
    this.supportPathStats.maxUtilization = peak;
    this.supportPathStats.overloadedBonds = overloaded;
  }

  private solveSupportPaths(rhsOverride?: Float64Array, direct?: DirectSolveResult): void {
    const model = this.supportPath;
    model.clear();
    const loads = this.latestLoads;
    const rhs = rhsOverride ?? loads?.rhs ?? this.weightLoads();
    const wrenches = this.externalLoads?.wrenches;
    const handled = (members: ReadonlyArray<number>) => direct && members.some(node =>
      direct.deferredImpulseNodes[node] || this.incidentBonds(node).some(bond => direct.solvedBonds[bond]));
    let components = 0;
    for (const members of this.supportedComponents) {
      if (handled(members)) continue;
      const supports = members.filter((i) => this.worldSupported[i]);
      if (model.solve(members, supports, rhs)) {
        components++;
      }
    }
    if (loads && wrenches) {
      for (const members of this.islands) {
        if (handled(members)) continue;
        if (members.length < 2 || !loads.participating[members[0]!]!) {
          continue;
        }
        // Supports of a free body are the contacts pushing up with a meaningful share of weight.
        let supports = members.filter(
          (i) =>
            wrenches[i * 6 + 1]! >
            SUPPORT_PATH_POLICY.supportWeightShare * this.fragmentMass[i]! * 9.81,
        );
        if (!supports.length) {
          let best = -1,
            peak = 1e-6;
          for (const i of members) {
            if (wrenches[i * 6 + 1]! > peak) {
              peak = wrenches[i * 6 + 1]!;
              best = i;
            }
          }
          supports = best < 0 ? [] : [best];
        }
        if (model.solve(members, supports, rhs)) {
          components++;
        }
      }
    }
    this.supportCandidates = [];
    for (const bond of this.bondOrder) {
      if (model.demand[bond]! >= SUPPORT_PATH_POLICY.candidateUtilization) {
        this.supportCandidates.push(bond);
      }
    }
    this.supportPathStats.components = components;
  }

  /** Raw support-path utilization of a bond from the last solve (diagnostic). */
  supportPathUtilization(bond: number): number {
    if (!Number.isInteger(bond) || bond < 0 || bond >= this.manifest.bonds.length) {
      throw new Error('Invalid bond index');
    }
    return this.supportPath.demand[bond]!;
  }

  private evaluateLoad(
    dt: number,
    broken: Array<number>,
    cracked: Array<number>,
    initializing = false,
  ): void {
    if (this.externalLoads && (this.loadsTopologyDirty || !this.latestLoads)) {
      this.latestLoads = buildStructuralLoads(this.manifest, this.supported, this.externalLoads,
        this.islands, this.supportedComponents, this.fragmentMass, this.worldSupported);
    }
    this.loadsTopologyDirty = false;
    const result = this.directSolver.solve(this.states, this.damage, this.activeChunks,
      this.latestLoads, dt > 0 ? dt : FIXED_DT,
      { budgetMs: initializing ? Infinity : this.directBudgetMs,
        workLimit: initializing ? Infinity : this.directWorkLimit, masses: this.fragmentMass,
        captureStaticReactions: this.bearingWorldBondIds.size > 0,
        resolveForceNode: (chunk, position) => this.resolveSupportChunk(chunk, position) });
    this.directResult = result;
    this.elasticBonds = result.elasticBonds;
    this.structuralSolver = result.overBudget ? 'support-path' : 'direct';
    this.utilization.set(result.utilization);
    this.fragmentUtilization.fill(0);
    this.fragmentStressKnown.fill(0);
    this.solverStats = { converged: result.complete && !result.overBudget,
      deferred: result.overBudget || !result.complete,
      iterations: result.factorizedColumns > 0 ? 1 : 0,
      maxUtilization: 0, residual: result.complete ? 0 : 1, workUnits: result.workUsed };
    if (result.overBudget) {
      // The fallback sees exactly the same balanced gravity/contact/impact RHS. It does
      // not run in parallel with the direct failure driver or accumulate hidden fatigue.
      this.solveSupportPaths(result.rhs, result);
      this.supportPathDirty = false;
      if (dt > 0) this.applySupportPaths(dt);
      for (const bond of this.bondOrder) if (this.states[bond] !== BondState.Compliant && !result.solvedBonds[bond]) this.utilization[bond] = this.supportPath.demand[bond]! / (1 - this.damage[bond]! * 0.6);
      const fractures: FractureCommandBuffer = { bonds: [], chunks: [], programs: [] };
      for (const bond of this.bondOrder) {
        if (this.pending[bond]! > 0) fractures.bonds.push({ bond, health: this.pending[bond]! });
        this.pending[bond] = 0;
      }
      fractures.bonds.push(...result.fractures.bonds);
      if (dt > 0) {
        this.applyFracture(fractures);
        this.enterCompliant(result.elasticBonds);
      }
    } else if (dt > 0) {
      this.applyFracture(result.fractures);
      this.enterCompliant(result.elasticBonds);
    }
    for (const bond of this.bondOrder) {
      if (this.states[bond] === BondState.Broken) { this.utilization[bond] = 0; continue; }
      const a = this.endpointsA[bond]!, b = this.endpointsB[bond]!, value = this.utilization[bond]!;
      this.fragmentUtilization[a] = Math.max(this.fragmentUtilization[a]!, value);
      this.fragmentUtilization[b] = Math.max(this.fragmentUtilization[b]!, value);
      if (!this.topologyDirty && (result.complete || result.overBudget)) {
        this.fragmentStressKnown[a] = this.activeChunks[a]!;
        this.fragmentStressKnown[b] = this.activeChunks[b]!;
      }
      this.solverStats.maxUtilization = Math.max(this.solverStats.maxUtilization, value);
    }
    broken.push(...this.fractureBroken.splice(0));
    cracked.push(...this.fractureCracked.splice(0));
    this.stressDirty = !result.complete || result.overBudget;
    this.loadsChanged = false;
  }
}
