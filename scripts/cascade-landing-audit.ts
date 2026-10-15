/** Benchmark-only landing/load-path trace, sharing the energy audit's excluded clock. */
import type { DestructionSimulation } from '../packages/destruction-physics/src/index';
import type { SimulationFrame } from '../packages/destruction-domain/src/index';
import { BondState } from '../packages/destruction-domain/src/index';
import { CascadeEnergyAudit } from './cascade-energy-audit';
import { CascadeBearingAudit } from './cascade-bearing-audit';

type Actor = { body: number; mass: number; members: number[]; y: number; vy: number; free: boolean; structurallySupported: boolean;
  dynamic: boolean; sleeping: boolean; baked: boolean };
type Load = { id: number; tick: number; sourceBody: number | null; receiverBody: number | null; chunk: number;
  height: number; worldImpulseY: number; worldImpulse: number[]; impulse: number[]; magnitudeNs: number; deliveredTick?: number; accepted?: boolean;
  resolvedNode?: number; consumedTick?: number; discardedTick?: number; solveSpans: number[]; evaluations: number[] };
type Episode = { body: number; firstTouch: any; history: any[]; terminal: any | null; actorLoads: Load[]; receiverLoads: Load[] };
type InputDefinition = Readonly<{ id: number; load: number | null; sampleId: number | null; dt: number;
  impulseNs: readonly number[] }>;
type InputObservation = Readonly<{ id: number; input: number; node: number; historical: boolean; retained: boolean }>;
type InputSolveSpan = { id: number; input: number; component: number; firstSolveIndex: number; lastSolveIndex: number };
type InputCache = { definition: InputDefinition; observations: Map<string, InputObservation> };
type ComponentInputs = { solveIds: number[]; members: Map<number, { observation: InputObservation; span: InputSolveSpan }> };
const magnitude = (v: ArrayLike<number>) => Math.hypot(v[0]!, v[1]!, v[2]!);
const plus = (a: number[], b: ArrayLike<number>) => { for (let i = 0; i < 3; i++) a[i]! += b[i]!; };
const compactActor = ({ members, ...actor }: Actor) => ({ ...actor, memberCount: members.length });
const sameMembers = (a: Actor, b: Actor) => a.members.length === b.members.length && a.members.every((node, i) => node === b.members[i]);

export class CascadeLandingAudit {
  private readonly target: any;
  private readonly bearing?: CascadeBearingAudit;
  private collecting = false;
  private contact?: { first: number; second: number };
  private colliders = new Map<number, { actor: Actor | null }>();
  private actors = new Map<number, Actor>();
  private afterRapier = new Map<number, Actor>();
  private native = new Map<number, { scalarNs: number; vectorNs: number[]; contacts: any[] }>();
  private loadIdentity = new WeakMap<object, Load>();
  private forceIdentity = new WeakMap<object, Load>();
  private unresolved = new Map<number, Load[]>();
  private loads: Load[] = [];
  private deliveries: Load[] = [];
  private solves: any[] = [];
  private evaluations: any[] = [];
  private allLoads: Load[] = [];
  private allSolves: any[] = [];
  private allEvaluations: any[] = [];
  private readonly inputCache = new WeakMap<object, InputCache>();
  private readonly inputDefinitions: InputDefinition[] = [];
  private readonly inputObservations: InputObservation[] = [];
  private readonly inputSolveSpans: InputSolveSpan[] = [];
  private readonly componentInputs = new Map<number, ComponentInputs>();
  private fractures: number[] = [];
  private solveBonds = new WeakMap<object, Set<number>>();
  private demotions = 0;
  private nextLoad = 1;
  private episodes = new Map<number, Episode>();
  private largestFree: (Actor & { firstSeenTick: number }) | null = null;
  private previousBaked = 0;
  private stage = '';
  readonly steps: any[] = [];

  constructor(simulation: DestructionSimulation, private readonly energy: CascadeEnergyAudit,
    private readonly storeyHeight: number, private readonly collapse: (frame: SimulationFrame) => any) {
    this.target = simulation;
    this.install();
    if (this.target.experimentalBearingReanchor) this.bearing = new CascadeBearingAudit(this.target, this.energy, this.storeyHeight);
  }
  private measure<T>(work: () => T): T { return this.energy.sampleDiagnostic(work); }
  private wrap(owner: any, name: string, run: (original: (...args: any[]) => any, args: any[]) => any) {
    const original = owner?.[name];
    if (typeof original === 'function') owner[name] = (...args: any[]) => run(original.bind(owner), args);
  }
  bearingPerformance() { return this.bearing?.performanceSnapshot(); }
  begin(stage: string) {
    this.stage = stage; this.loads = []; this.deliveries = []; this.solves = []; this.evaluations = []; this.fractures = []; this.demotions = 0;
    this.native.clear(); this.afterRapier.clear();
    this.bearing?.begin();
  }
  private snapshot(actor: any): Actor {
    const body = actor.body;
    return { body: this.energy.bodyIdentity(body), mass: body.mass(), members: actor.members.slice(),
      y: body.worldCom().y, vy: body.linvel().y,
      free: body.isDynamic() && actor.members.every((node: number) => !this.target.graph.supported[node]),
      structurallySupported: actor.members.some((node: number) => !!this.target.graph.supported[node]),
      dynamic: body.isDynamic(), sleeping: body.isSleeping(), baked: !!actor.baked };
  }
  private currentActors(): Map<number, Actor> {
    const result = new Map<number, Actor>();
    for (const actor of [...this.target.islands.values(), ...this.target.supportedActors.values()]) {
      const info = this.snapshot(actor); result.set(info.body, info);
    }
    return result;
  }
  private beforeRapier() {
    this.colliders.clear(); this.actors.clear();
    for (const actor of [...this.target.islands.values(), ...this.target.supportedActors.values()] as any[]) {
      const info = this.snapshot(actor);
      this.actors.set(info.body, info);
      for (const collider of actor.colliders) this.colliders.set(collider.handle, { actor: info });
      if (info.free && (!this.largestFree || info.mass > this.largestFree.mass)) this.largestFree = { ...info, firstSeenTick: this.target.tick };
    }
    for (const child of this.target.secondary as any[]) if (!this.colliders.has(child.collider.handle)) this.colliders.set(child.collider.handle, { actor: null });
  }
  private install() {
    this.wrap(this.target.world, 'step', (original, args) => {
      this.measure(() => this.beforeRapier());
      const result = original(...args);
      // No body access occurs inside the native manifold callback/borrow.
      this.measure(() => { this.afterRapier = this.currentActors(); });
      return result;
    });
    this.wrap(this.target, 'collectStructuralLoads', (original, args) => {
      this.collecting = true;
      try { return original(...args); } finally { this.collecting = false; }
    });
    this.wrap(this.target.world, 'contactPair', (original, args) => {
      if (!this.collecting) return original(...args);
      const [a, b, callback] = args;
      return original(a, b, (manifold: any, flipped: boolean) => {
        const first = flipped ? b.handle : a.handle, second = flipped ? a.handle : b.handle;
        this.measure(() => {
          const normal = manifold.normal();
          let scalar = 0, eligible = 0;
          for (let i = 0; i < manifold.numContacts(); i++) {
            const value = manifold.contactImpulse(i);
            if (Number.isFinite(value) && value > 0) {
              scalar += value;
              eligible += value; // Positive native impulses include predictive contacts.
            }
          }
          const y = manifold.numSolverContacts() ? manifold.solverContactPoint(0)?.y : undefined;
          for (const [handle, other, sign] of [[first, second, -1], [second, first, 1]]) {
            const actor = this.colliders.get(handle!)?.actor;
            if (!actor) continue;
            const row = this.native.get(actor.body) ?? { scalarNs: 0, vectorNs: [0, 0, 0], contacts: [] };
            row.scalarNs += scalar;
            const vector = [normal.x * eligible * sign!, normal.y * eligible * sign!, normal.z * eligible * sign!];
            plus(row.vectorNs, vector);
            row.contacts.push({ otherBody: this.colliders.get(other!)?.actor?.body ?? null, colliders: [handle, other],
              nativeNormalImpulseNs: scalar, eligibleNativeImpulseNs: eligible, impulseOnActorNs: vector, height: y ?? actor.y });
            this.native.set(actor.body, row);
          }
        });
        const previous = this.contact;
        this.contact = { first, second };
        try { return callback(manifold, flipped); } finally { this.contact = previous; }
      });
    });
    this.wrap(this.target, 'addContactWrench', (original, args) => {
      const before = this.target.landingImpulses.length;
      const result = original(...args);
      this.measure(() => {
        const handle = args[0].handle as number;
        const other = this.contact ? (this.contact.first === handle ? this.contact.second : this.contact.first) : undefined;
        for (const queued of this.target.landingImpulses.slice(before) as any[]) {
          const load: Load = { id: this.nextLoad++, tick: this.target.tick,
            sourceBody: other === undefined ? null : this.colliders.get(other)?.actor?.body ?? null,
            receiverBody: this.colliders.get(handle)?.actor?.body ?? null,
            chunk: queued.chunk, height: args[1].y, worldImpulseY: args[2].y * this.target.dt,
            worldImpulse: [args[2].x * this.target.dt, args[2].y * this.target.dt, args[2].z * this.target.dt],
            impulse: Array.from(queued.impulse), magnitudeNs: magnitude(queued.impulse), solveSpans: [], evaluations: [] };
          this.loadIdentity.set(queued.impulse, load); this.loads.push(load); this.allLoads.push(load);
        }
      });
      return result;
    });
    this.wrap(this.target.graph, 'addForce', (original, args) => {
      const recordsBefore = this.target.graph.directSolver.forceRecords?.length ?? 0;
      const accepted = original(...args);
      this.measure(() => {
        const load = this.loadIdentity.get(args[2]);
        if (!load) return; // A separately tagged blast impulse is not a landing.
        load.deliveredTick = this.target.tick; load.accepted = accepted;
        load.resolvedNode = this.target.graph.resolveSupportChunk(args[0], args[1]);
        this.deliveries.push(load);
        for (const record of this.target.graph.directSolver.forceRecords?.slice(recordsBefore) ?? []) this.forceIdentity.set(record, load);
        if (accepted) {
          const pending = this.unresolved.get(load.resolvedNode!) ?? [];
          pending.push(load); this.unresolved.set(load.resolvedNode!, pending);
        }
      });
      return accepted;
    });
    this.wrap(this.target.graph.directSolver, 'solve', (original, args) => {
      // This copy happens BEFORE the direct solver starts its deadline clock.
      const pending = this.measure(() => {
        const solver = this.target.graph.directSolver;
        if (solver.forceRecords) return {
          trackedRecords: true, participating: args[3]?.participating,
          inputs: [
            ...solver.forceRecords.map((record: any) => ({ record, historical: false, sampleId: solver.nextImpulseSampleId, dt: args[4], load: this.forceIdentity.get(record) })),
            ...solver.pendingImpulseSamples.flatMap((sample: any) => sample.forces.map((record: any) => ({ record, historical: true, sampleId: sample.id ?? null, dt: sample.dt, load: this.forceIdentity.get(record) }))),
          ],
        };
        return { trackedRecords: false, participating: args[3]?.participating, inputs: [...solver.forceQueue].map(([node, values]: [number, ArrayLike<number>]) => ({
          record: { chunk: node, impulse: Array.from(values).slice(0, 3) }, historical: false, dt: args[4],
        })) };
      });
      const result = original(...args);
      // Inspect AFTER the solve, never inside its cooperative deadline region.
      this.measure(() => this.recordSolve(result, pending));
      return result;
    });
    this.wrap(this.target.graph, 'step', (original, args) => {
      const result = original(...args);
      this.measure(() => {
        this.fractures.push(...result.broken);
        for (const solve of this.solves) {
          const bonds = this.solveBonds.get(solve);
          solve.actualBreaks.push(...result.broken.filter((bond: number) => bonds?.has(bond)));
          this.solveBonds.delete(solve);
        }
        for (const evaluation of this.evaluations) {
          const proposed = new Set<number>(evaluation.fractureBonds);
          evaluation.actualBreaks.push(...result.broken.filter((bond: number) => proposed.has(bond)));
        }
      });
      return result;
    });
    this.wrap(this.target, 'initializeDemotedPoses', (original, args) => {
      this.measure(() => { this.demotions += args[0].length; });
      return original(...args);
    });
  }
  /** Immutable input/observation records are shared across every deferred visit. */
  private inputObservation(input: any, retained: boolean): InputObservation {
    let cache = this.inputCache.get(input.record);
    if (!cache) {
      const definition: InputDefinition = Object.freeze({ id: this.inputDefinitions.length + 1,
        load: input.load?.id ?? null, sampleId: input.sampleId ?? null, dt: input.dt,
        impulseNs: Object.freeze(Array.from(input.record.impulse as ArrayLike<number>)) });
      this.inputDefinitions.push(definition);
      cache = { definition, observations: new Map() };
      this.inputCache.set(input.record, cache);
    }
    const key = `${input.record.chunk}:${Number(input.historical)}:${Number(retained)}`;
    let observation = cache.observations.get(key);
    if (!observation) {
      observation = Object.freeze({ id: this.inputObservations.length + 1, input: cache.definition.id,
        node: input.record.chunk, historical: !!input.historical, retained });
      this.inputObservations.push(observation);
      cache.observations.set(key, observation);
    }
    return observation;
  }
  /** A growing backlog adds one delta, not another full pending-input list, each tick. */
  private inputDelta(component: number, solveId: number, inputs: any[], retained: Set<any>) {
    let previous = this.componentInputs.get(component);
    if (!previous) {
      previous = { solveIds: [], members: new Map() };
      this.componentInputs.set(component, previous);
    }
    const previousSolveId = previous.solveIds.at(-1) ?? null;
    const solveIndex = previous.solveIds.length;
    const upsertObservationIds: number[] = [], present = new Set<number>();
    for (const input of inputs) {
      const observation = this.inputObservation(input, retained.has(input));
      present.add(observation.input);
      const member = previous.members.get(observation.input);
      if (!member) {
        const span: InputSolveSpan = { id: this.inputSolveSpans.length + 1, input: observation.input,
          component, firstSolveIndex: solveIndex, lastSolveIndex: solveIndex };
        this.inputSolveSpans.push(span);
        previous.members.set(observation.input, { observation, span });
        upsertObservationIds.push(observation.id);
        const loads: Load[] = input.load ? [input.load] : this.unresolved.get(input.record.chunk) ?? [];
        for (const load of loads) load.solveSpans.push(span.id);
      } else {
        member.span.lastSolveIndex = solveIndex;
        if (member.observation !== observation) {
          member.observation = observation;
          upsertObservationIds.push(observation.id);
        }
      }
    }
    const removedInputIds: number[] = [];
    for (const id of previous.members.keys()) if (!present.has(id)) {
      previous.members.delete(id);
      removedInputIds.push(id);
    }
    previous.solveIds.push(solveId);
    return { previousSolveId, upsertObservationIds, removedInputIds };
  }
  private recordSolve(result: any, pending: { trackedRecords: boolean; participating?: ArrayLike<number>; inputs: any[] }) {
    if (!pending.inputs.length) return;
    for (const input of pending.inputs) if (!input.historical && result.currentImpulseSampleId != null) input.sampleId = result.currentImpulseSampleId;
    // Copy each individual sample score before the solver reuses its result buffers.
    // A component's later aggregate peak must never become this input's score.
    const evaluations = (result.impulseEvaluations ?? []).map((evaluation: any) => {
      const matching = pending.inputs.filter(input => input.sampleId === evaluation.sampleId && evaluation.loadedNodes.includes(input.record.chunk));
      const row = { id: this.allEvaluations.length + 1, ...evaluation, tick: this.target.tick, loadedNodes: [...evaluation.loadedNodes],
        fractureBonds: [...evaluation.fractureBonds], actualBreaks: [] as number[],
        loadIds: [...new Set(matching.flatMap(input => input.load ? [input.load.id] : []))],
        inputImpulseNs: matching.reduce((sum, input) => sum + magnitude(input.record.impulse), 0) };
      this.evaluations.push(row); this.allEvaluations.push(row);
      for (const input of matching) if (input.load && !input.load.evaluations.includes(row.id)) input.load.evaluations.push(row.id);
      return row;
    });
    const graph = this.target.graph;
    // Actor membership only: avoid visibility/hierarchy work in a diagnostic pass.
    const actors = [
      ...graph.supportedComponents.map((nodes: number[]) => ({ id: graph.manifest.fragments[nodes[0]!]!.id, nodes, supported: true })),
      ...graph.islands.map((nodes: number[]) => ({ id: graph.manifest.fragments[nodes[0]!]!.id, nodes, supported: false })),
    ] as { id: number; nodes: number[]; supported: boolean }[];
    const actorByNode = new Map<number, typeof actors[number]>();
    for (const actor of actors) for (const node of actor.nodes) actorByNode.set(node, actor);
    const touched = new Map<number, { actor: typeof actors[number]; nodes: number[] }>();
    for (const node of new Set<number>(pending.inputs.map(input => input.record.chunk))) {
      const actor = actorByNode.get(node);
      if (!actor) continue;
      const entry = touched.get(actor.id) ?? { actor, nodes: [] };
      entry.nodes.push(node); touched.set(actor.id, entry);
    }
    const solver = this.target.graph.directSolver;
    const retained = new Set<object>((solver.pendingImpulseSamples ?? []).flatMap((sample: any) => sample.forces));
    for (const input of pending.inputs) {
      const node = input.record.chunk;
      if (input.load) input.load.resolvedNode = node;
      if (input.load && !retained.has(input.record)) {
        const evaluated = evaluations.some((evaluation: any) => evaluation.sampleId === input.sampleId && evaluation.loadedNodes.includes(node));
        if (evaluated) input.load.consumedTick = this.target.tick;
        else input.load.discardedTick = this.target.tick;
        this.unresolved.delete(node);
      }
    }
    for (const entry of touched.values()) {
      const nodes = new Set(entry.actor.nodes), bonds: number[] = [], solved: number[] = [], failed: number[] = [];
      let maxUtilization = 0, balancedRhsL1 = 0;
      for (const node of nodes) for (let axis = 0; axis < 6; axis++) balancedRhsL1 += Math.abs(result.rhs[node * 6 + axis] ?? 0);
      for (let bond = 0; bond < graph.manifest.bonds.length; bond++) {
        if (graph.states[bond] === BondState.Broken || graph.states[bond] === BondState.Compliant) continue;
        const a = graph.endpointsA[bond], b = graph.endpointsB[bond];
        if (!nodes.has(a) || (graph.manifest.bonds[bond].b !== -1 && !nodes.has(b))) continue;
        bonds.push(bond);
        if (result.solvedBonds ? result.solvedBonds[bond] : result.complete) {
          solved.push(bond); maxUtilization = Math.max(maxUtilization, result.utilization[bond] ?? 0);
        }
      }
      for (const command of result.fractures.bonds) if (bonds.includes(command.bond)) failed.push(command.bond);
      const inputs = pending.inputs.filter(input => nodes.has(input.record.chunk));
      const retainedInputs = inputs.filter(input => pending.trackedRecords ? retained.has(input.record) : solver.forceQueue.has(input.record.chunk));
      const retainedNodes = [...new Set<number>(retainedInputs.map(input => input.record.chunk))];
      const historicalInputs = inputs.filter(input => input.historical);
      const row = { id: this.allSolves.length + 1, tick: this.target.tick, component: entry.actor.id, nodes: entry.actor.nodes.length, supported: entry.actor.supported,
        loadedNodes: entry.nodes, inputImpulseNs: inputs.reduce((sum, input) => sum + magnitude(input.record.impulse), 0),
        inputDelta: this.inputDelta(entry.actor.id, this.allSolves.length + 1, inputs, new Set(retainedInputs)),
        historicalInputCount: historicalInputs.length, deferredImpulseSamples: result.deferredImpulseSamples ?? 0,
        balancedRhsL1, balancedCurrentReceiverWrenches: entry.nodes.map(node => ({ node, wrench: Array.from(result.rhs.slice(node * 6, node * 6 + 6)) })),
        bondsInBalancedComponent: bonds.length, solvedBonds: solved.length,
        aggregateMaxUtilization: maxUtilization, aggregateProposedBreaks: failed, actualBreaks: [] as number[],
        evaluationIds: evaluations.filter((evaluation: any) => evaluation.component === entry.actor.id).map((evaluation: any) => evaluation.id),
        complete: result.complete, overBudget: result.overBudget, cachedComponents: result.cachedComponents, solvedComponents: result.solvedComponents,
        inputsRemovedWithoutEvaluation: inputs.filter(input => !retainedInputs.includes(input) && !evaluations.some((evaluation: any) =>
          evaluation.sampleId === input.sampleId && evaluation.loadedNodes.includes(input.record.chunk))).map(input => input.load?.id ?? null),
        retainedNodes, retainedImpulseNs: retainedInputs.reduce((sum, input) => sum + magnitude(input.record.impulse), 0) };
      this.solves.push(row); this.allSolves.push(row); this.solveBonds.set(row, new Set(bonds));
      for (const input of inputs) {
        if (!retainedInputs.includes(input)) this.unresolved.delete(input.record.chunk);
      }
    }
  }
  private actorRows(frame: SimulationFrame) {
    const after = this.currentActors();
    const byBody = new Map<number, { queuedToActor: Load[]; queuedToReceivers: Load[]; deliveredToActor: Load[]; deliveredToReceivers: Load[] }>();
    const bin = (body: number) => {
      let entry = byBody.get(body);
      if (!entry) { entry = { queuedToActor: [], queuedToReceivers: [], deliveredToActor: [], deliveredToReceivers: [] }; byBody.set(body, entry); }
      return entry;
    };
    for (const load of this.loads) {
      if (load.receiverBody != null) bin(load.receiverBody).queuedToActor.push(load);
      if (load.sourceBody != null) bin(load.sourceBody).queuedToReceivers.push(load);
    }
    for (const load of this.deliveries) if (load.accepted) {
      if (load.receiverBody != null) bin(load.receiverBody).deliveredToActor.push(load);
      if (load.sourceBody != null) bin(load.sourceBody).deliveredToReceivers.push(load);
    }
    const totals = (loads: Load[]) => {
      const vector = [0, 0, 0]; for (const load of loads) plus(vector, load.worldImpulse);
      return { scalarNs: loads.reduce((sum, load) => sum + load.magnitudeNs, 0), worldVectorNs: vector,
        loads: loads.map(load => ({ id: load.id, queuedTick: load.tick })) };
    };
    const largest = [...this.actors.values()].filter(actor => actor.free).sort((a, b) => b.mass - a.mass)[0];
    const bodies = new Set([
      ...[...this.native].filter(([, native]) => native.scalarNs > 0).map(([body]) => body),
      ...byBody.keys(), ...[...this.episodes.values()].filter(episode => !episode.terminal).map(episode => episode.body),
      ...(largest ? [largest.body] : []),
    ]);
    const rows = [...bodies].map(body => {
      const before = this.actors.get(body), post = this.afterRapier.get(body), end = after.get(body), native = this.native.get(body);
      const loads = bin(body);
      return { tick: frame.tick, body, preRapier: before ? compactActor(before) : null,
        postRapier: post ? compactActor(post) : null, end: end ? compactActor(end) : null,
        rapierDeltaVy: before && post ? post.vy - before.vy : null,
        nativeNormalImpulseNs: native?.scalarNs ?? 0, nativeImpulseOnActorNs: native?.vectorNs ?? [0, 0, 0],
        contactCount: native?.contacts.length ?? 0,
        queuedToActor: totals(loads.queuedToActor), queuedToReceivers: totals(loads.queuedToReceivers),
        deliveredToActor: totals(loads.deliveredToActor), deliveredToReceivers: totals(loads.deliveredToReceivers) };
    });
    for (const row of rows) {
      const actor = this.actors.get(row.body), native = this.native.get(row.body), loads = bin(row.body);
      let episode = this.episodes.get(row.body);
      // A first touch is a kinematic event, not an arbitrarily strong impulse.
      if (!episode && actor?.free && actor.vy < 0 && native && native.scalarNs > 0) {
        const firstTouch = { tick: frame.tick, actor: { ...actor }, nativeNormalImpulseNs: native.scalarNs,
          nativeImpulseOnActorNs: [...native.vectorNs], contacts: native.contacts,
          actorLoads: [...loads.queuedToActor], receiverLoads: [...loads.queuedToReceivers] };
        episode = { body: row.body, firstTouch, history: [], terminal: null, actorLoads: [], receiverLoads: [] };
        this.episodes.set(row.body, episode);
      }
      if (!episode || episode.terminal) continue;
      const end = after.get(row.body), atTouch = episode.firstTouch.actor as Actor;
      const changedBefore = actor && !sameMembers(actor, atTouch);
      episode.history.push(row);
      if (!changedBefore) { episode.actorLoads.push(...loads.queuedToActor); episode.receiverLoads.push(...loads.queuedToReceivers); }
      const reason = !actor || !end ? 'bodyRemovedOrReplaced'
        : changedBefore || !sameMembers(end, atTouch) ? 'membershipChanged'
        : end.baked ? 'baked' : !end.dynamic ? 'fixed' : end.sleeping ? 'sleeping' : null;
      if (reason) episode.terminal = { tick: frame.tick, reason };
    }
    return rows;
  }
  end(frame: SimulationFrame) {
    this.measure(() => {
      const actors = this.actorRows(frame);
      const storeys = new Map<number, any>();
      const bin = (height: number) => {
        const storey = Math.max(0, Math.floor(height / this.storeyHeight));
        let entry = storeys.get(storey);
        if (!entry) { entry = { storey, minHeight: Infinity, maxHeight: -Infinity, contactImpulseNs: 0, queuedImpulseNs: 0, deliveredImpulseNs: 0, downwardReceiverImpulseNs: 0,
          receiverBodies: new Set<number>(), bakedActors: 0, dynamicActors: 0 }; storeys.set(storey, entry); }
        entry.minHeight = Math.min(entry.minHeight, height); entry.maxHeight = Math.max(entry.maxHeight, height);
        return entry;
      };
      for (const [body, native] of this.native) for (const contact of native.contacts) {
        const entry = bin(contact.height); entry.contactImpulseNs += contact.eligibleNativeImpulseNs;
        entry.receiverBodies.add(body);
      }
      for (const load of this.loads) {
        const entry = bin(load.height); entry.queuedImpulseNs += load.magnitudeNs;
        entry.downwardReceiverImpulseNs += Math.max(0, -load.worldImpulseY);
      }
      for (const load of this.deliveries) if (load.accepted) bin(load.height).deliveredImpulseNs += load.magnitudeNs;
      let baked = 0;
      for (const actor of this.target.islands.values() as Iterable<any>) {
        const entry = bin(actor.body.worldCom().y);
        if (actor.baked) { entry.bakedActors++; baked++; }
        else if (actor.body.isDynamic()) entry.dynamicActors++;
      }
      const row = { tick: frame.tick, stage: this.stage,
        largestFreeActor: [...this.actors.values()].filter(actor => actor.free).sort((a, b) => b.mass - a.mass).map(compactActor)[0] ?? null,
        actors,
        nativeNormalImpulseNs: [...this.native.values()].reduce((sum, entry) => sum + entry.scalarNs, 0),
        queuedImpulseNs: this.loads.reduce((sum, load) => sum + load.magnitudeNs, 0),
        deliveredImpulseNs: this.deliveries.filter(load => load.accepted).reduce((sum, load) => sum + load.magnitudeNs, 0),
        rejectedLoads: this.deliveries.filter(load => !load.accepted).length,
        queuedLoads: this.loads.length, deliveredLoads: this.deliveries.length,
        solveIds: this.solves.map(solve => solve.id), evaluationIds: this.evaluations.map(evaluation => evaluation.id),
        fractures: this.fractures, demotions: this.demotions, bakedActors: baked, bakedActorDelta: baked - this.previousBaked,
        structuralDeferred: frame.stats.structuralDeferred,
        contactHeightStoreys: [...storeys.values()].sort((a, b) => a.storey - b.storey).map(entry => ({ ...entry, receiverBodies: entry.receiverBodies.size })),
        bearing: this.bearing?.end(frame, this.fractures),
        centroid: this.collapse(frame) };
      this.previousBaked = baked; this.steps.push(row);
    });
  }
  report() {
    const traceLoads = (loads: Load[]) => {
      const aggregates = new Map<string, any>(), evaluations = new Map<string, any>();
      for (const load of loads) {
        for (const id of load.solveSpans) {
          const span = this.inputSolveSpans[id - 1]!, sequence = this.componentInputs.get(span.component)!.solveIds;
          for (let index = span.firstSolveIndex; index <= span.lastSolveIndex; index++) {
            const solve = this.allSolves[sequence[index]! - 1]!;
            aggregates.set(`${solve.tick}:${solve.component}`, solve);
          }
        }
        for (const id of load.evaluations) { const evaluation = this.allEvaluations[id - 1]!; evaluations.set(`${evaluation.tick}:${evaluation.sampleId}:${evaluation.component}`, evaluation); }
      }
      const sampleEvaluations = [...evaluations.values()];
      const vector = [0, 0, 0], delivered = [0, 0, 0];
      for (const load of loads) { plus(vector, load.worldImpulse); if (load.accepted) plus(delivered, load.worldImpulse); }
      return {
        queuedImpulseNs: loads.reduce((sum, load) => sum + load.magnitudeNs, 0), queuedWorldVectorNs: vector,
        deliveredImpulseNs: loads.filter(load => load.accepted).reduce((sum, load) => sum + load.magnitudeNs, 0), deliveredWorldVectorNs: delivered,
        consumedImpulseNs: loads.filter(load => load.consumedTick != null).reduce((sum, load) => sum + load.magnitudeNs, 0),
        pendingImpulseNs: loads.filter(load => load.accepted && load.consumedTick == null && load.discardedTick == null).reduce((sum, load) => sum + load.magnitudeNs, 0),
        evaluationIds: sampleEvaluations.map(evaluation => evaluation.id), maxUtilization: sampleEvaluations.length ? sampleEvaluations.reduce((maximum, evaluation) => Math.max(maximum, evaluation.maxUtilization), 0) : null,
        actualBondBreaks: [...new Set<number>(sampleEvaluations.flatMap(evaluation => evaluation.actualBreaks))],
        aggregateSolveIds: [...aggregates.values()].map(solve => solve.id), loadIds: loads.map(load => load.id),
      };
    };
    const touch = (episode: Episode | undefined) => {
      if (!episode) return null;
      const value = episode.firstTouch;
      return { tick: value.tick, actor: compactActor(value.actor), nativeNormalImpulseNs: value.nativeNormalImpulseNs,
        nativeImpulseOnActorNs: value.nativeImpulseOnActorNs, contacts: value.contacts,
        impactingActor: traceLoads(value.actorLoads), receivers: traceLoads(value.receiverLoads) };
    };
    const summarize = (episode: Episode | undefined) => {
      if (!episode) return null;
      const peak = episode.history.reduce((best, row) => !best || row.nativeNormalImpulseNs > best.nativeNormalImpulseNs ? row : best, null);
      const deceleration = episode.history.filter(row => row.preRapier?.vy < 0 && row.rapierDeltaVy != null && row.rapierDeltaVy > 0)
        .reduce((best, row) => !best || row.rapierDeltaVy > best.rapierDeltaVy ? row : best, null);
      const marker = (row: any) => row ? { tick: row.tick, mass: row.preRapier?.mass ?? null, y: row.preRapier?.y ?? null,
        preVy: row.preRapier?.vy ?? null, postVy: row.postRapier?.vy ?? null, deltaVy: row.rapierDeltaVy,
        nativeNormalImpulseNs: row.nativeNormalImpulseNs, nativeImpulseOnActorNs: row.nativeImpulseOnActorNs } : null;
      return { body: episode.body, firstTouch: touch(episode), terminal: episode.terminal,
        peakNativeContactImpulse: marker(peak), maximumUpwardVelocityChangeWhileDescending: marker(deceleration),
        firstUpwardReversalTick: episode.history.find(row => row.preRapier?.vy < 0 && row.postRapier?.vy >= 0)?.tick ?? null,
        impactingActor: traceLoads(episode.actorLoads), receivers: traceLoads(episode.receiverLoads),
        history: episode.history.map(row => ({ tick: row.tick, body: row.body })) };
    };
    const largestEpisode = [...this.episodes.values()].sort((a, b) => b.firstTouch.actor.mass - a.firstTouch.actor.mass || a.firstTouch.tick - b.firstTouch.tick)[0];
    const largestSeenEpisode = this.largestFree ? this.episodes.get(this.largestFree.body) : undefined;
    return { accounting: {
      selection: 'First touch is the first observed positive native normal impulse on a descending free actor (vy < 0). It is not called the main strike. The landing episode follows every tick through first sleep, bake/fixed transition, body removal, or membership change. Peak contact impulse and maximum upward velocity change while descending are data-derived markers, with no force-strength cutoff.',
      nativeImpulse: 'Exact native normal contact-impulse writeback from the engine existing structural manifold pass, including predictive contacts. No force-event reconstruction or full-world contact scan. Aggregate actor-side totals count both sides when both are actors.',
      delivery: 'Queued impulse arrays matched by identity through graph.addForce; impacting actor and receiver sides remain separate. Delivered rows retain original queued tick/body identity. AppliedForce identities track deferred samples. Only an explicit matching sample evaluation marks consumption; queue clearing alone does not.',
      solve: 'Sample evaluations match sample ID and remapped loaded node and contain only that actual sample/component solve. A sample includes its ambient load plus all impulses from that event step, so its score is not a marginal score for an individual contact. Actual breaks are that sample fracture proposal intersected with graph.step broken bonds; multiple sufficient samples may share a break. Aggregate component peaks include other current/historical samples and are labeled separately. Current balanced RHS is not a historical RHS. No audit callback runs inside the solve deadline.',
      episode: 'Each first-touch and episode load list remains linked after the episode ends, so later deferred consumption is reported at its actual evaluation tick. Per-actor pre/post Rapier snapshots distinguish collision deceleration from subsequent baking and topology changes.',
      records: 'Loads, component solves, and sample evaluations are emitted once in top-level ID tables. Episode history references steps[].actors by tick and body. Each step includes actors with positive native contact, queued/delivered loads, an open first-landing episode, or the largest currently free mass; unrelated quiet actors are omitted.',
      inputReferences: 'inputs stores immutable force/sample metadata; inputObservations stores node, historical and retained state. Each solves[].inputDelta inherits the input-to-observation map from previousSolveId (empty for null), removes removedInputIds, then upserts upsertObservationIds by inputObservations[].input. Joining those observations with inputs reconstructs the former inputSamples without copying a deferred backlog every tick. IDs are one-based table indices; input membership is unordered.',
      loadSolveReferences: 'loads[].solveSpanIds replaces repeated solveIds. Each inputSolveSpans entry selects the inclusive zero-based firstSolveIndex..lastSolveIndex range in the componentSolves entry whose component matches. The union of those solveIds ranges is the exact former load solveIds; episode aggregateSolveIds and all sample evaluations remain unchanged.',
      storeys: 'contactHeightStoreys bins contact/actor world heights. bearing.originalStoreys independently follows authored depth-1 ancestry for mass, fractures, and world bonds. Overall centroid remains the benchmark live-mass metric.',
      overhead: 'Shared energy audit exclusion clock; no protocol/physics changes. Detailed printing happens after simulation; optional CASCADE_SCALE_PROGRESS writes completed-step counters through the exclusion clock.' },
      largestFreeActorSeen: this.largestFree ? { ...compactActor(this.largestFree), firstSeenTick: this.largestFree.firstSeenTick } : null,
      firstTouchOfLargestFreeActor: touch(largestSeenEpisode),
      firstLandingEpisodeOfLargestFreeActor: summarize(largestSeenEpisode),
      largestActorObservedLandingEpisode: largestEpisode === largestSeenEpisode ? null : summarize(largestEpisode),
      loads: this.allLoads.map(({ solveSpans, evaluations, ...load }) => ({ ...load, solveSpanIds: solveSpans, evaluationIds: evaluations })),
      inputs: this.inputDefinitions, inputObservations: this.inputObservations, inputSolveSpans: this.inputSolveSpans,
      componentSolves: [...this.componentInputs].map(([component, value]) => ({ component, solveIds: value.solveIds })),
      solves: this.allSolves, impulseEvaluations: this.allEvaluations, bearings: this.bearing?.report(), steps: this.steps };
  }
  flushLogs() {
    const report = this.report();
    const episode = report.firstLandingEpisodeOfLargestFreeActor ?? report.largestActorObservedLandingEpisode;
    if (!episode) {
      console.log(`  largest free actor landing ${JSON.stringify({ largestFreeActorSeen: report.largestFreeActorSeen, episode: null })}`);
      return;
    }
    const evaluations = (account: any) => account.evaluationIds.map((id: number) => this.allEvaluations[id - 1]!).map((evaluation: any) => ({ tick: evaluation.tick,
      sampleId: evaluation.sampleId, component: evaluation.component, historical: evaluation.historical, loadedNodes: evaluation.loadedNodes,
      bondCount: evaluation.bondCount, maxUtilization: evaluation.maxUtilization, proposedBreakCount: evaluation.fractureBonds.length,
      actualBreakCount: evaluation.actualBreaks.length }));
    const account = (value: any) => ({ queuedImpulseNs: value.queuedImpulseNs, deliveredImpulseNs: value.deliveredImpulseNs,
      consumedImpulseNs: value.consumedImpulseNs, pendingImpulseNs: value.pendingImpulseNs,
      maxSampleUtilization: value.maxUtilization, actualSampleSupportedBreakCount: value.actualBondBreaks.length,
      sampleEvaluations: evaluations(value) });
    console.log(`  largest free actor first touch ${JSON.stringify({ selection: report.firstLandingEpisodeOfLargestFreeActor ? 'largest free actor seen' : 'largest actor observed touching',
      tick: episode.firstTouch!.tick, actor: episode.firstTouch!.actor,
      nativeNormalImpulseNs: episode.firstTouch!.nativeNormalImpulseNs, nativeImpulseOnActorNs: episode.firstTouch!.nativeImpulseOnActorNs,
      impactingActor: account(episode.firstTouch!.impactingActor), receivers: account(episode.firstTouch!.receivers) })}`);
    console.log(`  largest free actor landing episode ${JSON.stringify({ body: episode.body, startTick: episode.firstTouch!.tick, terminal: episode.terminal,
      peakNativeContactImpulse: episode.peakNativeContactImpulse, maximumUpwardVelocityChangeWhileDescending: episode.maximumUpwardVelocityChangeWhileDescending,
      firstUpwardReversalTick: episode.firstUpwardReversalTick,
      impactingActor: account(episode.impactingActor), receivers: account(episode.receivers) })}`);
    for (const row of this.episodes.get(episode.body)!.history) console.log(`  largest free actor landing tick ${JSON.stringify({ tick: row.tick, body: row.body,
      mass: row.preRapier?.mass ?? null, y: row.preRapier?.y ?? null, preVy: row.preRapier?.vy ?? null, postVy: row.postRapier?.vy ?? null,
      deltaVy: row.rapierDeltaVy, nativeNormalImpulseNs: row.nativeNormalImpulseNs, nativeImpulseOnActorNs: row.nativeImpulseOnActorNs,
      queuedToActorNs: row.queuedToActor.scalarNs, queuedToReceiversNs: row.queuedToReceivers.scalarNs,
      deliveredToActorNs: row.deliveredToActor.scalarNs, deliveredToReceiversNs: row.deliveredToReceivers.scalarNs,
      endSleeping: row.end?.sleeping ?? null, endBaked: row.end?.baked ?? null, endDynamic: row.end?.dynamic ?? null })}`);
  }
}
