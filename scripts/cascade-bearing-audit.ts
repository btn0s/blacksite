/** Benchmark-only bearing lifecycle records. All inspection runs outside solver deadlines. */
import { BondState, TRANSFORM_STRIDE, type SimulationFrame } from '../packages/destruction-domain/src/index';
import type { CascadeEnergyAudit } from './cascade-energy-audit';

type FactorKind = 'mainReanchored' | 'mainOther' | 'secondaryReanchored';
const factorCounts = () => ({ cacheAttempts: 0, cacheHits: 0, coldMisses: 0, unfinishedMisses: 0,
  changedRhsMisses: 0, newFactors: 0, refactorCalls: 0, refactorsWithColumns: 0, factorizedColumns: 0, incompleteRefactors: 0 });
const performanceCounts = () => ({ mainReanchored: factorCounts(), mainOther: factorCounts(), secondaryReanchored: factorCounts(),
  fixedToDynamic: 0, dynamicToFixed: 0, wakeCalls: 0, sleepingToAwake: 0, failedWakeCalls: 0,
  captures: 0, bakes: 0, failures: 0, bakedFailures: 0, contactInvalidations: 0, releases: 0 });
// Scope is synchronous and diagnostic only. Prototype hooks see brand-new factors,
// including standalone families created and first solved within a single call.
let factorScope: { audit: CascadeBearingAudit; secondary: boolean } | undefined;
const hookedFactorPrototypes = new WeakSet<object>();

export class CascadeBearingAudit {
  private readonly identities = new WeakMap<object, number>();
  private readonly registered = new WeakMap<object, string>();
  private readonly supports: any[] = [];
  private readonly records: any[] = [];
  private readonly fragmentIndex = new Map<number, number>();
  private readonly originalStorey: number[];
  private readonly initialMass = new Map<number, number>();
  private readonly mainScores = new WeakMap<object, string>();
  private readonly secondaryScores = new Map<number, string>();
  private providerSnapshot = '';
  private stepStart = 0;
  private mainSolveTick = -1;
  private performance = performanceCounts();
  private readonly observedFactors = new WeakSet<object>();

  performanceSnapshot() { return structuredClone(this.performance); }

  private withFactors<T>(secondary: boolean, work: () => T): T {
    const previous = factorScope;
    factorScope = { audit: this, secondary };
    try { return work(); } finally { factorScope = previous; }
  }
  private countFactor(factor: any, secondary: boolean, event: string, value?: any) {
    this.measure(() => {
      const kind: FactorKind = secondary ? 'secondaryReanchored'
        : [...factor.liveConnections].some((bond: any) => this.sim.graph.isBearingWorldBond(bond)) ? 'mainReanchored' : 'mainOther';
      const row = this.performance[kind];
      if (!this.observedFactors.has(factor)) { this.observedFactors.add(factor); row.newFactors++; }
      if (event === 'cache') {
        row.cacheAttempts++;
        if (value.hit) row.cacheHits++;
        else if (value.unfinished) row.unfinishedMisses++;
        else if (value.cold) row.coldMisses++;
        else row.changedRhsMisses++;
      } else {
        row.refactorCalls++; row.factorizedColumns += value.columns;
        if (value.columns > 0) row.refactorsWithColumns++;
        if (!value.complete) row.incompleteRefactors++;
      }
    });
  }
  private installFactorCounters() {
    const factors = [...this.sim.graph.directSolver.factors.values()] as any[];
    for (const factor of factors) this.observedFactors.add(factor);
    const prototype = factors.length ? Object.getPrototypeOf(factors[0]) : undefined;
    if (!prototype) throw new Error('Bearing performance audit requires an initialized main factor');
    if (hookedFactorPrototypes.has(prototype)) return;
    hookedFactorPrototypes.add(prototype);
    const restore = prototype.restoreSolution;
    prototype.restoreSolution = function (this: any, ...args: any[]) {
      const cold = !this.solved, unfinished = !!(this.preparation || this.refactoring);
      const hit = restore.apply(this, args);
      factorScope?.audit.countFactor(this, factorScope.secondary, 'cache', { hit, cold, unfinished });
      return hit;
    };
    const refactor = prototype.refactor;
    prototype.refactor = function (this: any, ...args: any[]) {
      const result = refactor.apply(this, args);
      factorScope?.audit.countFactor(this, factorScope.secondary, 'refactor', result);
      return result;
    };
  }

  constructor(private readonly sim: any, private readonly energy: CascadeEnergyAudit, private readonly storeyHeight: number) {
    const fragments = sim.manifest.fragments as any[];
    fragments.forEach((fragment, index) => this.fragmentIndex.set(fragment.id, index));
    this.originalStorey = fragments.map((_, index) => {
      let ancestor = index;
      while (fragments[ancestor].depth > 1 && sim.graph.parents[ancestor] >= 0) ancestor = sim.graph.parents[ancestor];
      return this.storey(fragments[ancestor].position[1]);
    });
    fragments.forEach((fragment, index) => {
      if (fragment.support !== false && (fragment.depth === undefined || fragment.depth === 1)) {
        const storey = this.originalStorey[index]!;
        this.initialMass.set(storey, (this.initialMass.get(storey) ?? 0) + fragment.mass);
      }
    });
    this.install();
  }
  private measure<T>(work: () => T): T { return this.energy.sampleDiagnostic(work); }
  private storey(height: number) { return Math.max(0, Math.floor(height / this.storeyHeight)); }
  private wrap(owner: any, name: string, run: (original: (...args: any[]) => any, args: any[]) => any) {
    const original = owner?.[name];
    if (typeof original === 'function') owner[name] = (...args: any[]) => run(original.bind(owner), args);
  }
  private record(type: string, values: any) {
    const row = { id: this.records.length + 1, tick: this.sim.tick, type, ...values };
    this.records.push(row);
    if (type === 'capture') this.performance.captures++;
    if (type === 'bake') this.performance.bakes++;
    if (type === 'failure') { this.performance.failures++; if (values.valid && !values.dynamic && !values.pending) this.performance.bakedFailures++; }
    if (type === 'invalidateContact') this.performance.contactInvalidations++;
    if (type === 'release') this.performance.releases++;
    return row;
  }
  private bodyId(body: any) { return body ? this.energy.bodyIdentity(body) : null; }
  private secondaryStorey(fragment: any) {
    const root = this.fragmentIndex.get(fragment.rootId);
    return root === undefined ? this.storey(fragment.position[1]) : this.originalStorey[root]!;
  }
  private supportId(support: any): number {
    const existing = this.identities.get(support); if (existing) return existing;
    const id = this.supports.length + 1;
    this.identities.set(support, id);
    const original = new Map<number, number>();
    for (const node of support.nodes) {
      const storey = this.originalStorey[node]!;
      original.set(storey, (original.get(storey) ?? 0) + this.sim.graph.fragmentMass[node]);
    }
    if (support.child) original.set(this.secondaryStorey(support.child.fragment), support.child.fragment.mass);
    this.supports.push({ id, body: this.bodyId(support.body), createdTick: this.sim.tick,
      family: support.child ? 'secondary' : 'main', secondaryId: support.child?.fragment.id ?? null,
      nodes: [...support.nodes], originalStoreys: [...original].map(([storey, mass]) => ({ storey, mass })),
      mass: support.body.mass(), anchors: support.anchors.map((anchor: any, index: number) => ({ index, chunk: anchor.chunk,
        area: anchor.definition.area, centroidAsset: anchor.definition.centroid, normalAsset: anchor.definition.normal,
        section: anchor.definition.section, providers: anchor.providers.map((provider: any) => ({
          body: this.bodyId(provider.body), receiverCollider: provider.receiver.handle, collider: provider.collider.handle,
          chunk: provider.chunk ?? null, secondaryId: provider.child?.fragment.id ?? null,
          contactPointWorld: [...provider.point], contactHeightStorey: this.storey(provider.point[1]), area: provider.area,
          originalStorey: provider.child ? this.secondaryStorey(provider.child.fragment)
            : provider.chunk === undefined ? null : this.originalStorey[provider.chunk],
        })) })) });
    return id;
  }
  private pose(support: any) {
    if (!support.body.isValid()) return { valid: false };
    return { valid: true, y: support.body.worldCom().y, mass: support.body.mass(),
      dynamic: support.body.isDynamic(), pending: support.pending, releasing: !!support.releasing };
  }
  private scores(result: any, bonds: number[], definitions: any[] = this.sim.graph.manifest.bonds) {
    return bonds.map(bond => ({ bond, bondId: definitions[bond]?.id ?? null, solved: !!result?.solvedBonds[bond],
      utilization: result?.solvedBonds[bond] ? result.utilization[bond] : null,
      combinedImpulseNs: result?.solvedBonds[bond] ? result.combinedImpulse[bond] : null,
      baselineImpulseNs: result?.baselineImpulse[bond] ?? null, offsetImpulseNs: result?.breakOffset[bond] ?? null,
      proposedBreak: !!result?.fractures.bonds.some((command: any) => command.bond === bond && command.health > 0),
      staticReactionAsset: result?.solvedBonds[bond] && result.staticActions ? {
        force: [result.staticActions.forceX[bond], result.staticActions.forceY[bond], result.staticActions.forceZ[bond]],
        moment: [result.staticActions.momentX[bond], result.staticActions.momentY[bond], result.staticActions.momentZ[bond]],
      } : null }));
  }
  private install() {
    this.installFactorCounters();
    this.wrap(this.sim, 'changeBodyType', (original, args) => {
      const body = args[0];
      const before = this.measure(() => body?.isValid() ? { fixed: body.isFixed(), dynamic: body.isDynamic() } : null);
      const result = original(...args);
      this.measure(() => {
        if (before && body.isValid()) {
          if (before.fixed && body.isDynamic()) this.performance.fixedToDynamic++;
          if (before.dynamic && body.isFixed()) this.performance.dynamicToFixed++;
        }
      });
      return result;
    });
    for (const name of ['wakeIsland', 'wakeChild']) this.wrap(this.sim, name, (original, args) => {
      const body = args[0]?.body;
      const sleeping = this.measure(() => body?.isValid() && body.isSleeping());
      const result = original(...args);
      this.measure(() => {
        this.performance.wakeCalls++;
        if (result === false) this.performance.failedWakeCalls++;
        if (sleeping && body.isValid() && !body.isSleeping()) this.performance.sleepingToAwake++;
      });
      return result;
    });
    this.wrap(this.sim.graph.directSolver, 'solve', (original, args) => {
      const result = this.withFactors(false, () => original(...args)); this.measure(() => { this.mainSolveTick = this.sim.tick; }); return result;
    });
    this.wrap(this.sim, 'requestBearingSupport', (original, args) => {
      const body = (args[0].island ?? args[0].child).body;
      const before = this.sim.bearingSupports.get(body);
      const result = original(...args);
      this.measure(() => {
        const support = this.sim.bearingSupports.get(body);
        if (support && support !== before) this.record('capture', { support: this.supportId(support), ...this.pose(support) });
      });
      return result;
    });
    this.wrap(this.sim, 'submitBearingSupports', (original, args) => {
      const result = original(...args);
      this.measure(() => {
        for (const support of this.sim.bearingSupports.values()) {
          const bonds = support.anchors.map((anchor: any) => anchor.bond ?? null);
          const bondIds = support.anchors.map((anchor: any) => anchor.bondId ?? null);
          const key = JSON.stringify([bonds, bondIds]);
          if (!support.child && bonds.some((bond: number | null) => bond !== null) && this.registered.get(support) !== key) {
            this.registered.set(support, key); this.record('registerWorldBonds', { support: this.supportId(support), bonds, bondIds });
          }
        }
      });
      return result;
    });
    this.wrap(this.sim.secondaryBearingSolver, 'register', (original, args) => {
      const result = original(...args);
      this.measure(() => {
        const support = [...this.sim.bearingSupports.values()].find((value: any) => value.child?.fragment.id === args[0]);
        this.record('registerSecondaryFamily', { support: support ? this.supportId(support) : null, secondaryId: args[0] });
      });
      return result;
    });
    this.wrap(this.sim.secondaryBearingSolver, 'solve', (original, args) => {
      const result = this.withFactors(true, () => original(...args));
      this.measure(() => {
        const helper = this.sim.secondaryBearingSolver;
        const families = [...helper.families].map(([id, family]: any) => ({ secondaryId: id,
          initialized: !!family.solver, failed: family.failed, freshSolve: family.lastSolveTick === helper.tick,
          pendingBatches: family.pendingSamples?.length ?? family.pendingBatches?.length ?? 0,
          deferredSamples: family.solver?.pendingImpulseSamples.length ?? 0,
          ready: result.ready.has(id), reactionAsset: result.reactions.get(id) ?? null,
          scores: family.lastSolveTick === helper.tick ? this.scores(family.solver.result, [0], [family.bond]) : [] }));
        const changedFamilies = families.filter(row => {
          const key = JSON.stringify(row);
          if (this.secondaryScores.get(row.secondaryId) === key) return false;
          this.secondaryScores.set(row.secondaryId, key); return true;
        });
        if (changedFamilies.length || result.failed.length) this.record('secondarySolve', {
          budgetMs: args[1], elapsedMs: result.elapsedMs, complete: result.complete,
          familyCount: families.length, readyCount: result.ready.size, failed: [...result.failed], changedFamilies });
      });
      return result;
    });
    this.wrap(this.sim, 'solveBearingSupports', (original, args) => {
      const result = original(...args);
      this.measure(() => {
        for (const support of this.sim.bearingSupports.values()) {
          if (support.child || support.releasing) continue;
          const bonds = support.anchors.flatMap((anchor: any) => anchor.bond === undefined ? [] : [anchor.bond]);
          const row = { support: this.supportId(support), freshSolve: this.mainSolveTick === this.sim.tick,
            ...this.pose(support), scores: this.mainSolveTick === this.sim.tick ? this.scores(this.sim.graph.directResult, bonds) : [],
            reactionsWorld: support.anchors.map((anchor: any, index: number) => ({ anchor: index, bond: anchor.bond, bondId: anchor.bondId,
              broken: anchor.bond === undefined ? false : this.sim.graph.states[anchor.bond] === BondState.Broken,
              reaction: anchor.reaction ? { force: [...anchor.reaction.force], moment: [...anchor.reaction.moment] } : null })) };
          const key = JSON.stringify(row);
          if (this.mainScores.get(support) !== key) { this.mainScores.set(support, key); this.record('mainSolve', row); }
        }
      });
      return result;
    });
    this.wrap(this.sim, 'bake', (original, args) => {
      const support = this.sim.bearingSupports.get(args[0]);
      const result = original(...args);
      if (support) this.measure(() => this.record('bake', { support: this.supportId(support), ...this.pose(support) }));
      return result;
    });
    this.wrap(this.sim, 'unbakeBearingSupport', (original, args) => {
      const support = args[0], failed = args[1];
      this.measure(() => {
        const bonds = support.anchors.flatMap((anchor: any) => anchor.bond === undefined ? [] : [anchor.bond]);
        this.record(failed ? 'failure' : 'invalidateContact', { support: this.supportId(support), ...this.pose(support),
          scores: support.child ? [] : this.scores(this.sim.graph.directResult, bonds),
          brokenBonds: bonds.filter((bond: number) => this.sim.graph.states[bond] === BondState.Broken) });
      });
      const result = original(...args);
      this.measure(() => this.record('unbakeAttempt', { support: this.supportId(support), ...this.pose(support) }));
      return result;
    });
    this.wrap(this.sim, 'releaseBearingSupport', (original, args) => {
      const support = this.sim.bearingSupports.get(args[0]);
      const result = original(...args);
      if (support) this.measure(() => this.record('release', { support: this.supportId(support), failed: !!args[1] }));
      return result;
    });
    this.wrap(this.sim, 'updateBearingLoadSnapshot', (original, args) => {
      const result = original(...args);
      this.measure(() => {
        const main: any[] = [], secondary: any[] = [];
        for (let node = 0; node < this.sim.graph.activeChunks.length; node++) {
          const wrench = this.sim.bearingLoads.subarray(node * 6, node * 6 + 6);
          if (wrench.some((value: number) => value !== 0)) main.push({ node, originalStorey: this.originalStorey[node],
            currentY: this.sim.position(node).y, worldWrench: Array.from(wrench) });
        }
        for (const [id, wrench] of this.sim.secondaryBearingLoads) if (wrench.some((value: number) => value !== 0)) {
          secondary.push({ secondaryId: id, assetWrench: Array.from(wrench) });
        }
        const reactions = [...this.sim.bearingSupports.values()].flatMap((support: any) => support.releasing ? [] :
          support.anchors.flatMap((anchor: any, index: number) => anchor.reaction ? [{ support: this.supportId(support), anchor: index,
            forceWorld: [...anchor.reaction.force], momentWorld: [...anchor.reaction.moment] }] : []));
        const row = { main, secondary, reactions, mainDownwardForceN: main.reduce((sum, row) => sum + Math.max(0, -row.worldWrench[1]), 0) };
        const key = JSON.stringify(row);
        if (key !== this.providerSnapshot && (this.providerSnapshot || main.length || secondary.length || reactions.length)) {
          this.providerSnapshot = key; this.record('providerLoadSnapshot', row);
        }
      });
      return result;
    });
  }

  begin() { this.stepStart = this.records.length; this.performance = performanceCounts(); }
  end(frame: SimulationFrame, fractures: number[]) {
    const bins = new Map<number, any>();
    const bin = (storey: number) => {
      let row = bins.get(storey);
      if (!row) { row = { originalStorey: storey, initialMass: this.initialMass.get(storey) ?? 0,
        liveMass: 0, weightedY: 0, liveMassBelowFirstStorey: 0, runtimeBearingMass: 0, bakedMass: 0,
        fractures: 0, liveAuthoredWorldBonds: 0, liveRuntimeWorldBonds: 0, liveSecondaryWorldBonds: 0 }; bins.set(storey, row); }
      return row;
    };
    for (const storey of this.initialMass.keys()) bin(storey);
    const add = (storey: number, mass: number, y: number, support: any) => {
      const row = bin(storey); row.liveMass += mass; row.weightedY += mass * y;
      if (y < this.storeyHeight) row.liveMassBelowFirstStorey += mass;
      if (support && !support.releasing) { row.runtimeBearingMass += mass; if (!support.pending) row.bakedMass += mass; }
    };
    for (let node = 0; node < this.sim.graph.activeChunks.length; node++) {
      const mass = this.sim.graph.fragmentMass[node];
      if (!this.sim.graph.activeChunks[node] || !(mass > 0)) continue;
      const y = this.sim.refined.has(node) ? this.sim.attachedCenter(node).center.y : frame.transforms[node * TRANSFORM_STRIDE + 1];
      add(this.originalStorey[node]!, mass, y, this.sim.bearingNodes.get(node));
    }
    for (const child of this.sim.secondary) if (child.attachedRoot === undefined && child.body.isValid()) {
      add(this.secondaryStorey(child.fragment), child.fragment.mass, child.collider.translation().y, this.sim.bearingSupports.get(child.body));
    }
    const runtimeBonds = new Set<number>();
    for (const support of this.sim.bearingSupports.values()) for (const anchor of support.anchors) if (anchor.bond !== undefined) runtimeBonds.add(anchor.bond);
    for (const support of this.sim.bearingSupports.values()) if (support.child && !support.releasing && !this.sim.secondaryBearingSolver.families.get(support.child.fragment.id)?.failed) {
      bin(this.secondaryStorey(support.child.fragment)).liveSecondaryWorldBonds++;
    }
    const graph = this.sim.graph;
    for (const bond of fractures) { const node = graph.endpointsA[bond]; if (node !== undefined) bin(this.originalStorey[node]!).fractures++; }
    for (let bond = 0; bond < graph.manifest.bonds.length; bond++) if (graph.manifest.bonds[bond].b === -1 && graph.states[bond] !== BondState.Broken) {
      const row = bin(this.originalStorey[graph.endpointsA[bond]]!);
      row[runtimeBonds.has(bond) ? 'liveRuntimeWorldBonds' : 'liveAuthoredWorldBonds']++;
    }
    return { performance: this.performanceSnapshot(), recordIds: this.records.slice(this.stepStart).map(record => record.id),
      supports: this.sim.bearingSupports.size,
      secondaryFamilies: this.sim.secondaryBearingSolver?.families.size ?? 0,
      originalStoreys: [...bins.values()].sort((a, b) => a.originalStorey - b.originalStorey).map(({ weightedY, ...row }) => ({ ...row,
        centroidY: row.liveMass > 0 ? weightedY / row.liveMass : null,
        liveBelowFirstStoreyFraction: row.liveMass > 0 ? row.liveMassBelowFirstStorey / row.liveMass : null })) };
  }
  report() {
    return { accounting: {
      performance: 'Per-step mainReanchored factors contain at least one live runtime bearing world bond; mainOther excludes them; secondaryReanchored counts all standalone bearing factors. Cache misses distinguish unfinished factor work, absent/invalidated solution, and changed RHS. refactorCalls includes no-op load-only solves; refactorsWithColumns/factorizedColumns count actual numeric work. fixedToDynamic/dynamicToFixed count real body-type transitions; wakeCalls includes already-awake requests; sleepingToAwake counts native sleep changes; bakedFailures excludes pending admission failures. All diagnostics are excluded from phase timings.',
      references: 'Support geometry/providers are recorded once. Lifecycle and load snapshots are top-level records referenced by each step.',
      bondIdentity: 'Runtime bond slots may be recycled. registerWorldBonds pairs bonds with bondIds; scores and reactionsWorld include each generation ID beside its slot. Secondary scores use that standalone family’s bond ID, separate from the main graph.',
      loads: 'Provider snapshots read actual main bearingLoads in world coordinates and secondaryBearingLoads in asset coordinates after transfer. Secondary loads also include other steady contacts. Static reactions exclude every addForce pulse; unserved secondary results are never labeled fresh.',
      storeys: 'originalStoreys follows each authored depth-1 ancestor, including runtime descendants by rootId. Current contact height remains separate. Live primary mass uses graph.fragmentMass; attached geometry is counted there and standalone secondary pieces separately.',
    }, supports: this.supports, records: this.records };
  }
}
