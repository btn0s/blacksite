/** Benchmark-only energy accounting. Never recomputes mass or changes physical state. */
import { performance } from 'node:perf_hooks';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { DestructionSimulation } from '../packages/destruction-physics/src/index';
import type { SimulationFrame } from '../packages/destruction-domain/src/index';
import { observeContactSnapshots, type ContactManifold } from '../packages/destruction-physics/src/contact-snapshot';

type V = { x: number; y: number; z: number };
type Q = V & { w: number };
type Stage = 'rest' | 'placement' | 'detonation' | 'collapse';
type Body = RAPIER.RigidBody;
interface Ownership {
  kind: 'actor' | 'secondary' | 'cannonball' | 'unowned';
  members: number[];
  secondaryIds: number[];
  roots: number[];
  expectedMass: number | null;
  baked: boolean;
}
interface BodySample extends Ownership {
  id: number;
  handle: number;
  type: 'dynamic' | 'fixed' | 'kinematic';
  sleeping: boolean;
  ccdEnabled: boolean;
  mass: number;
  gravityScale: number;
  com: V;
  velocity: V;
  angularVelocity: V;
  principalInertia: V;
  speed: number;
  linearKE: number;
  angularKE: number;
  kineticEnergy: number;
  potentialEnergy: number;
  colliders: { handle: number; contactSkin: number; fragment?: number; secondaryId?: number; definitionId?: number; position: V; rotation: Q }[];
}
interface Snapshot {
  bodies: Map<number, BodySample>;
  dynamicBodies: number;
  sleepingBodies: number;
  mass: number;
  linearKE: number;
  angularKE: number;
  kineticEnergy: number;
  potentialEnergy: number;
  above10mps: number;
  above8mpsWithoutCCD: number;
  peakSpeed: number;
}
type ContactPhase = 'beforeRapier' | 'rapier' | 'afterRapier';
interface ContactSample {
  kind: 'manifold' | 'forceEvent';
  phase: ContactPhase;
  /** Global observation order within this audited step. */
  order: number;
  rapierStep: number;
  colliders: [number, number];
  query?: number;
  manifold?: number;
  normal?: V;
  flipped?: boolean;
  point?: V;
  normalImpulse?: number;
  deepestPenetration?: number;
  contacts?: number;
  solverContacts?: number;
  force?: number;
  forceDirection?: V;
}
interface Contact {
  colliders: [number, number];
  bodies?: [number | null, number | null];
  normal?: V;
  flipped?: boolean;
  contactSkins?: [number | null, number | null];
  point?: V;
  normalImpulse?: number;
  deepestPenetration?: number;
  force?: number;
  forceDirection?: V;
  visits: number;
  /** Ordered native observations; pre-step manifold impulses may be previous-step writeback. */
  samples: ContactSample[];
  /** Legacy geometry fields select one complete post-step sample, never cross-phase maxima. */
  geometrySampleOrder?: number;
  geometryQuery?: number;
}
interface JointSample {
  id: number;
  bodies: [number, number];
  appliedImpulses: number[];
  motorImpulses: number[];
  limitImpulses: number[];
  sampleDt: number;
}
interface MassMismatch {
  phase: string;
  body: number;
  handle: number;
  kind: string;
  mass: number;
  expectedMass: number;
  relativeError: number;
  members: number[];
  secondaryIds: number[];
}
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: V, b: V): V => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const mul = (a: Q, b: Q): Q => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
const rotate = (q: Q, v: V): V => {
  const t = cross(q, v), u = cross(q, t);
  return { x: v.x + 2 * (q.w * t.x + u.x), y: v.y + 2 * (q.w * t.y + u.y), z: v.z + 2 * (q.w * t.z + u.z) };
};
const totals = (s: Snapshot) => ({
  dynamicBodies: s.dynamicBodies, sleepingBodies: s.sleepingBodies, mass: s.mass,
  linearKE: s.linearKE, angularKE: s.angularKE, kineticEnergy: s.kineticEnergy,
  potentialEnergy: s.potentialEnergy, above10mps: s.above10mps, above8mpsWithoutCCD: s.above8mpsWithoutCCD, peakSpeed: s.peakSpeed,
});
const closeMass = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6, Math.max(Math.abs(a), Math.abs(b)) * 1e-6);

export class CascadeEnergyAudit {
  // These hooks intentionally live only in the benchmark. Private JS members remain observable.
  private readonly target: any;
  private readonly world: RAPIER.World;
  private readonly ids = new WeakMap<Body, number>();
  private nextId = 1;
  private excluded = 0;
  private preparing = false;
  private preparePhysicsStamp = 0;
  private prepareAudit = 0;
  private before!: Snapshot;
  private preRapier?: Snapshot;
  private postRapier?: Snapshot;
  private contacts = new Map<string, Contact>();
  private contactPhase: ContactPhase = 'beforeRapier';
  private contactSampleOrder = 0;
  private contactQueryOrder = 0;
  private rapierStep = 0;
  private joints: JointSample[] = [];
  private mismatches: MassMismatch[] = [];
  private demotions: { parent: number; children: number[] }[] = [];
  private operations: Record<string, number> = {};
  private pressure: { body: number; kineticEnergyBefore: number; kineticEnergyAfter: number; deltaKE: number; loads: unknown[] }[] = [];
  private creationOperations = new Map<number, string>();
  private operationStack: string[] = [];
  private auditStart = 0;
  private stage: Stage = 'rest';
  private loggingMs = 0;
  private printedSteps = 0;
  private printedMass = new Set<string>();
  private geometry = new Map<number, object>();
  private readonly cleanup: Array<() => void> = [];
  readonly steps: any[] = [];
  readonly initial: ReturnType<typeof totals>;
  readonly initialMassMismatches: MassMismatch[];

  constructor(simulation: DestructionSimulation) {
    this.target = simulation;
    this.world = this.target.world;
    const initial = this.exclude(() => this.snapshot('initial'));
    this.initial = totals(initial);
    this.initialMassMismatches = this.mismatches.splice(0);
    this.installHooks();
  }

  /** Shared benchmark diagnostics use the same exclusion/budget compensation clock. */
  sampleDiagnostic<T>(work: () => T): T { return this.exclude(work); }
  bodyIdentity(body: Body): number { return this.identity(body); }

  /** Release observers and restore hooks when this audit or its simulation is disposed. */
  dispose(): void {
    for (const cleanup of this.cleanup.splice(0).reverse()) cleanup();
  }

  get excludedMs() { return this.excluded; }
  clock = () => performance.now() - this.excluded;

  /** Remove audit cost from both the benchmark and the engine's step-budget observations. */
  private exclude<T>(read: () => T): T {
    const started = performance.now();
    try { return read(); }
    finally {
      const elapsed = performance.now() - started;
      this.excluded += elapsed;
      if (this.target.stepping) {
        this.target.stepStarted += elapsed;
        if (this.preparing && this.target.physicsStarted === this.preparePhysicsStamp) this.prepareAudit += elapsed;
        else this.target.physicsStarted += elapsed;
      }
    }
  }

  private identity(body: Body): number {
    let id = this.ids.get(body);
    if (id === undefined) { id = this.nextId++; this.ids.set(body, id); }
    return id;
  }

  private ownership(): Map<Body, Ownership> {
    const owners = new Map<Body, Ownership>();
    for (const actor of [...this.target.islands.values(), ...this.target.supportedActors.values()] as any[]) {
      owners.set(actor.body, {
        kind: 'actor', members: actor.members.slice(), secondaryIds: [], roots: actor.members.slice(),
        expectedMass: actor.members.reduce((sum: number, node: number) => sum + this.target.graph.fragmentMass[node], 0),
        baked: !!actor.baked,
      });
    }
    for (const child of this.target.secondary as any[]) {
      let owner = owners.get(child.body);
      if (!owner) {
        owner = { kind: 'secondary', members: [], secondaryIds: [], roots: [], expectedMass: 0, baked: !!child.baked };
        owners.set(child.body, owner);
      }
      owner.secondaryIds.push(child.fragment.id);
      if (child.fragment.rootId !== undefined) owner.roots.push(child.fragment.rootId);
      // Attached secondary geometry is already represented by the actor's remaining graph mass.
      if (owner.kind === 'secondary') owner.expectedMass! += child.fragment.mass;
    }
    for (const ball of this.target.cannonballs as any[]) {
      owners.set(ball.body, { kind: 'cannonball', members: [], secondaryIds: [], roots: [], expectedMass: null, baked: false });
    }
    return owners;
  }

  private snapshot(phase: string): Snapshot {
    const owners = this.ownership();
    const list: Body[] = [];
    // Only retain JS object references inside the native collection callback. Read afterwards.
    this.world.bodies.forEach((body) => { list.push(body); });
    const result: Snapshot = { bodies: new Map(), dynamicBodies: 0, sleepingBodies: 0, mass: 0, linearKE: 0, angularKE: 0, kineticEnergy: 0, potentialEnergy: 0, above10mps: 0, above8mpsWithoutCCD: 0, peakSpeed: 0 };
    for (const body of list) {
      const id = this.identity(body);
      const owner = owners.get(body) ?? { kind: 'unowned' as const, members: [], secondaryIds: [], roots: [], expectedMass: null, baked: false };
      const dynamic = body.isDynamic();
      const velocity = body.linvel(), angularVelocity = body.angvel();
      const inertia = body.principalInertia();
      const principalWorld = mul(body.rotation(), body.principalInertiaLocalFrame());
      const omega = rotate({ x: -principalWorld.x, y: -principalWorld.y, z: -principalWorld.z, w: principalWorld.w }, angularVelocity);
      const mass = body.mass(), com = body.worldCom(), gravityScale = body.gravityScale();
      const linearKE = dynamic ? 0.5 * mass * dot(velocity, velocity) : 0;
      const angularKE = dynamic ? 0.5 * (inertia.x * omega.x ** 2 + inertia.y * omega.y ** 2 + inertia.z * omega.z ** 2) : 0;
      const colliders: BodySample['colliders'] = [];
      for (let i = 0; i < body.numColliders(); i++) {
        const collider = body.collider(i);
        const primary = this.target.colliderFragments.get(collider.handle);
        const secondary = this.target.secondaryColliders.get(collider.handle)?.fragment;
        const definition = secondary ?? (primary === undefined ? undefined : this.target.manifest.fragments[primary]);
        if (definition && !this.geometry.has(definition.id)) this.geometry.set(definition.id, {
          id: definition.id, index: primary, position: definition.position, size: definition.size,
          parent: definition.parent, depth: definition.depth, mass: definition.mass,
          vertices: definition.shape?.vertices, faces: definition.shape?.faces,
        });
        colliders.push({ handle: collider.handle, contactSkin: collider.contactSkin(),
          fragment: primary, secondaryId: secondary?.id, definitionId: definition?.id,
          position: collider.translation(), rotation: collider.rotation() });
      }
      const sample: BodySample = {
        ...owner, id, handle: body.handle, type: dynamic ? 'dynamic' : body.isFixed() ? 'fixed' : 'kinematic',
        sleeping: body.isSleeping(), ccdEnabled: body.isCcdEnabled(), mass, gravityScale, com, velocity, angularVelocity,
        principalInertia: inertia, speed: Math.sqrt(dot(velocity, velocity)), linearKE, angularKE,
        kineticEnergy: linearKE + angularKE,
        potentialEnergy: dynamic ? -mass * gravityScale * dot(this.world.gravity, com) : 0,
        colliders,
      };
      result.bodies.set(id, sample);
      if (!dynamic) continue;
      result.dynamicBodies++;
      if (sample.sleeping) result.sleepingBodies++;
      result.mass += mass;
      result.linearKE += linearKE;
      result.angularKE += angularKE;
      result.kineticEnergy += sample.kineticEnergy;
      result.potentialEnergy += sample.potentialEnergy;
      if (sample.speed > 10) result.above10mps++;
      if (sample.speed > 8 && !sample.ccdEnabled) result.above8mpsWithoutCCD++;
      result.peakSpeed = Math.max(result.peakSpeed, sample.speed);
      if (owner.expectedMass !== null && Math.abs(mass - owner.expectedMass) / Math.max(owner.expectedMass, 1e-12) > 0.05) {
        this.mismatches.push({ phase, body: id, handle: body.handle, kind: owner.kind, mass, expectedMass: owner.expectedMass,
          relativeError: (mass - owner.expectedMass) / Math.max(owner.expectedMass, 1e-12), members: owner.members, secondaryIds: owner.secondaryIds });
      }
    }
    return result;
  }

  private wrap(owner: any, name: string, wrapper: (original: (...args: any[]) => any, args: any[]) => any) {
    const original = owner?.[name];
    if (typeof original !== 'function') return;
    const replacement = (...args: any[]) => wrapper(original.bind(owner), args);
    owner[name] = replacement;
    this.cleanup.push(() => { if (owner[name] === replacement) owner[name] = original; });
  }

  private observeContactPair<M extends ContactManifold>(
    first: RAPIER.Collider,
    second: RAPIER.Collider,
    callback: (manifold: M, flipped: boolean) => void,
  ): (manifold: M, flipped: boolean) => void {
    const phase = this.contactPhase, query = ++this.contactQueryOrder, rapierStep = this.rapierStep;
    let manifoldIndex = 0;
    return (manifold, flipped) => {
      // Copy data during the engine's existing visit; never read body/collider state here.
      this.exclude(() => {
        const a = first.handle, b = second.handle;
        const row = this.contact(a, b);
        row.visits++;
        let impulse = 0, penetration = 0;
        const count = manifold.numContacts(), solverCount = manifold.numSolverContacts();
        for (let i = 0; i < count; i++) {
          impulse += manifold.contactImpulse(i);
          penetration = Math.max(penetration, -manifold.contactDist(i));
        }
        const sample: ContactSample = {
          kind: 'manifold', phase, order: ++this.contactSampleOrder, rapierStep,
          colliders: [a, b], query, manifold: manifoldIndex++,
          normal: { ...manifold.normal() }, flipped,
          normalImpulse: impulse, deepestPenetration: penetration,
          contacts: count, solverContacts: solverCount,
          ...(solverCount ? { point: { ...manifold.solverContactPoint(0) } } : {}),
        };
        row.samples.push(sample);
        // Keep legacy summary fields source-compatible, but only publish post-step data.
        // Select the dominant manifold from the latest query as one coherent sample.
        if (phase === 'afterRapier' && (row.geometryQuery === undefined || query > row.geometryQuery ||
            (query === row.geometryQuery && impulse >= (row.normalImpulse ?? 0)))) {
          row.geometrySampleOrder = sample.order;
          row.geometryQuery = query;
          row.normal = sample.normal;
          row.flipped = flipped;
          row.point = sample.point;
          row.normalImpulse = impulse;
          row.deepestPenetration = penetration;
        }
      });
      return callback(manifold, flipped);
    };
  }

  private installHooks() {
    this.wrap(this.target, 'prepareStep', (original, args) => {
      this.preparing = true;
      this.preparePhysicsStamp = this.target.physicsStarted;
      this.prepareAudit = 0;
      try { return original(...args); }
      finally {
        this.target.structuralMs = Math.max(0, this.target.structuralMs - this.prepareAudit);
        this.preparing = false;
      }
    });
    this.wrap(this.world, 'step', (original, args) => {
      this.preRapier = this.exclude(() => this.snapshot('beforeRapier'));
      this.contactPhase = 'rapier';
      this.rapierStep++;
      let result: unknown;
      try { result = original(...args); }
      finally { this.contactPhase = 'afterRapier'; }
      this.postRapier = this.exclude(() => this.snapshot('afterRapier'));
      this.exclude(() => this.captureJoints());
      return result;
    });
    this.wrap(this.world, 'contactPair', (original, args) => {
      const [first, second, callback] = args;
      return original(first, second, this.observeContactPair<RAPIER.TempContactManifold>(first, second, callback));
    });
    this.cleanup.push(observeContactSnapshots(this.world, (first, second, callback) =>
      this.observeContactPair(first, second, callback)));
    this.wrap(this.target, 'dispose', (original, args) => {
      try { return original(...args); }
      finally { this.dispose(); }
    });
    this.wrap(this.target, 'recordContactForce', (original, args) => {
      this.exclude(() => {
        const event = args[0], a = event.collider1(), b = event.collider2();
        const row = this.contact(a, b);
        const sample: ContactSample = {
          kind: 'forceEvent', phase: this.contactPhase, order: ++this.contactSampleOrder,
          rapierStep: this.rapierStep, colliders: [a, b],
          force: event.totalForceMagnitude(), forceDirection: { ...event.maxForceDirection() },
        };
        row.samples.push(sample);
        if (sample.phase === 'afterRapier' && (sample.force ?? 0) >= (row.force ?? 0)) {
          row.force = sample.force;
          row.forceDirection = sample.forceDirection;
        }
      });
      return original(...args);
    });
    this.wrap(this.target, 'initializeDemotedPoses', (original, args) => {
      this.exclude(() => { this.demotions.push(...args[0].map((entry: any) => ({ parent: entry.parent, children: entry.children.slice() }))); });
      return original(...args);
    });
    for (const name of ['rebuildIslands', 'fractureImpacts', 'fractureSecondary', 'releaseChild', 'bake', 'wakeIsland', 'wakeChild', 'ageDebris']) {
      this.wrap(this.target, name, (original, args) => {
        this.operationStack.push(name);
        this.operations[name] = (this.operations[name] ?? 0) + 1;
        try { return original(...args); } finally { this.operationStack.pop(); }
      });
    }
    this.wrap(this.world, 'createRigidBody', (original, args) => {
      const body = original(...args) as Body;
      this.exclude(() => this.creationOperations.set(this.identity(body), this.operationStack.join('/') || 'simulation'));
      return body;
    });
    this.wrap(this.target, 'applyBlastPressure', (original, args) => {
      const loads = args[0] as any[];
      if (!loads.length) return original(...args);
      const before = this.exclude(() => this.snapshot('beforeBlastPressure'));
      const tagged = this.exclude(() => loads.map((load) => {
        const chunk = load.chunk >= 0 ? this.target.graph.resolveSupportChunk(load.chunk, load.point) : -1;
        const body = load.child?.attachedRoot === undefined && load.child
          ? load.child.body : chunk >= 0 ? this.target.actorForFragment(chunk)?.body : undefined;
        return { body: body ? this.identity(body) : null, chunk: load.chunk, child: load.child?.fragment.id,
          point: Array.from(load.point), impulse: Array.from(load.impulse), worldPoint: { ...load.worldPoint }, worldImpulse: { ...load.worldImpulse } };
      }));
      const result = original(...args);
      this.exclude(() => {
        const after = this.snapshot('afterBlastPressure');
        for (const [id, sample] of after.bodies) {
          const inputs = tagged.filter((load) => load.body === id);
          if (!inputs.length) continue;
          const prior = before.bodies.get(id)?.kineticEnergy ?? 0;
          this.pressure.push({ body: id, kineticEnergyBefore: prior, kineticEnergyAfter: sample.kineticEnergy, deltaKE: sample.kineticEnergy - prior, loads: inputs });
        }
      });
      return result;
    });
  }

  private contact(a: number, b: number): Contact {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    let row = this.contacts.get(key);
    if (!row) {
      row = { colliders: [a, b], visits: 0, samples: [] };
      this.contacts.set(key, row);
    }
    return row;
  }

  private captureJoints() {
    const list: RAPIER.ImpulseJoint[] = [];
    this.world.impulseJoints.forEach((joint) => { list.push(joint); });
    this.joints = list.map((joint) => {
      const first = joint.body1(), second = joint.body2();
      const extra = Math.max(first.additionalSolverIterations(), second.additionalSolverIterations());
      return { id: joint.handle, bodies: [this.identity(first), this.identity(second)],
        appliedImpulses: Array.from(joint.appliedImpulses()), motorImpulses: Array.from(joint.motorImpulses()), limitImpulses: Array.from(joint.limitImpulses()),
        sampleDt: this.world.timestep / (this.world.integrationParameters.numSolverIterations + extra) };
    });
  }

  begin(stage: Stage) {
    this.auditStart = this.excluded;
    this.stage = stage;
    this.contacts.clear(); this.mismatches = []; this.demotions = []; this.operations = {};
    this.contactPhase = 'beforeRapier'; this.contactSampleOrder = 0; this.contactQueryOrder = 0; this.rapierStep = 0;
    this.pressure = []; this.joints = []; this.creationOperations.clear();
    this.preRapier = undefined; this.postRapier = undefined;
    this.before = this.exclude(() => this.snapshot('beforeStep'));
  }

  private segment(before: Snapshot, after: Snapshot) {
    let stableDeltaKE = 0, gravityConversion = 0;
    const transport: { body: number; reason: string; beforeKE: number; afterKE: number; deltaKE: number }[] = [];
    for (const id of new Set([...before.bodies.keys(), ...after.bodies.keys()])) {
      const a = before.bodies.get(id), b = after.bodies.get(id);
      if (a?.type === 'dynamic' && b?.type === 'dynamic' && closeMass(a.mass, b.mass) && a.gravityScale === b.gravityScale) {
        stableDeltaKE += b.kineticEnergy - a.kineticEnergy;
        gravityConversion += a.potentialEnergy - b.potentialEnergy;
      } else {
        const deltaKE = (b?.kineticEnergy ?? 0) - (a?.kineticEnergy ?? 0);
        if (deltaKE || (a?.type === 'dynamic') !== (b?.type === 'dynamic') || (a && b && !closeMass(a.mass, b.mass))) {
          transport.push({ body: id, reason: !a ? 'created' : !b ? 'removed' : a.type !== b.type ? `${a.type}->${b.type}` : 'mass/gravity-scale changed',
            beforeKE: a?.kineticEnergy ?? 0, afterKE: b?.kineticEnergy ?? 0, deltaKE });
        }
      }
    }
    return { rawDeltaKE: after.kineticEnergy - before.kineticEnergy, stableDeltaKE, gravityConversion,
      stableGravityAdjustedDelta: stableDeltaKE - gravityConversion,
      topologyAndStateDeltaKE: transport.reduce((sum, change) => sum + change.deltaKE, 0), transport };
  }

  private topGains(after: Snapshot) {
    const owners = new Map<number, BodySample>();
    const secondaryOwners = new Map<number, BodySample>();
    for (const sample of this.before.bodies.values()) {
      for (const member of sample.members) owners.set(member, sample);
      for (const secondary of sample.secondaryIds) secondaryOwners.set(secondary, sample);
    }
    const colliderOwners = new Map<number, number>();
    const colliderSkins = new Map<number, number>();
    for (const snapshot of [this.before, this.preRapier, this.postRapier, after]) {
      if (!snapshot) continue;
      for (const sample of snapshot.bodies.values()) for (const collider of sample.colliders) {
        colliderOwners.set(collider.handle, sample.id); colliderSkins.set(collider.handle, collider.contactSkin);
      }
    }
    for (const contact of this.contacts.values()) {
      contact.bodies = [colliderOwners.get(contact.colliders[0]) ?? null, colliderOwners.get(contact.colliders[1]) ?? null];
      contact.contactSkins = [colliderSkins.get(contact.colliders[0]) ?? null, colliderSkins.get(contact.colliders[1]) ?? null];
    }
    return [...after.bodies.values()].filter((sample) => sample.type === 'dynamic')
      .map((sample) => ({ sample, before: this.before.bodies.get(sample.id), deltaKE: sample.kineticEnergy - (this.before.bodies.get(sample.id)?.kineticEnergy ?? 0) }))
      .filter((entry) => entry.deltaKE > 0).sort((a, b) => b.deltaKE - a.deltaKE).slice(0, 3)
      .map(({ sample, before, deltaKE }) => {
        const lineage = new Map<number, BodySample>();
        for (const id of sample.secondaryIds) {
          const source = secondaryOwners.get(id);
          if (source) lineage.set(source.id, source);
        }
        for (let node of [...sample.members, ...sample.roots]) {
          while (node >= 0) {
            const source = owners.get(node);
            if (source) { lineage.set(source.id, source); break; }
            node = this.target.graph.parents[node] ?? -1;
          }
        }
        const sources = [...lineage.values()].map((source) => {
          const spin = cross(source.angularVelocity, sub(sample.com, source.com));
          return { body: source.id, type: source.type, mass: source.mass, kineticEnergy: source.kineticEnergy,
            priorSourceVelocityAtSampleCOM: { x: source.velocity.x + spin.x, y: source.velocity.y + spin.y, z: source.velocity.z + spin.z },
            inheritedAngularVelocity: source.angularVelocity };
        });
        return {
          body: sample.id, handle: sample.handle, kind: sample.kind, deltaKE,
          newBody: !before, creationOperation: this.creationOperations.get(sample.id),
          before: before ? { type: before.type, mass: before.mass, kineticEnergy: before.kineticEnergy, velocity: before.velocity, angularVelocity: before.angularVelocity } : null,
          after: sample, inheritedFrom: sources,
          preRapier: this.preRapier?.bodies.get(sample.id) ?? null,
          postRapier: this.postRapier?.bodies.get(sample.id) ?? null,
          contacts: [...this.contacts.values()].filter((contact) => contact.bodies?.includes(sample.id)),
          joints: this.joints.filter((joint) => joint.bodies.includes(sample.id)),
          blastPressure: this.pressure.filter((pressure) => pressure.body === sample.id),
        };
      });
  }

  end(frame: SimulationFrame) {
    const row = this.exclude(() => {
      const after = this.snapshot('afterStep');
      const pre = this.preRapier ?? this.before, post = this.postRapier ?? pre;
      const preparation = this.segment(this.before, pre), rapier = this.segment(pre, post), bookkeeping = this.segment(post, after);
      const total = this.segment(this.before, after);
      const gravityConversion = preparation.gravityConversion + rapier.gravityConversion + bookkeeping.gravityConversion;
      const stableGravityAdjustedDelta = preparation.stableGravityAdjustedDelta + rapier.stableGravityAdjustedDelta + bookkeeping.stableGravityAdjustedDelta;
      const topologyAndStateDeltaKE = preparation.topologyAndStateDeltaKE + rapier.topologyAndStateDeltaKE + bookkeeping.topologyAndStateDeltaKE;
      const detonation = this.stage === 'detonation' || frame.events.some((event) => event.type === 'explosiveDetonated');
      return {
        tick: frame.tick, stage: this.stage, detonation, dt: this.world.timestep,
        before: totals(this.before), beforeRapier: totals(pre), afterRapier: totals(post), after: totals(after),
        rawDeltaKE: total.rawDeltaKE, gravityConversion, stableGravityAdjustedDelta, topologyAndStateDeltaKE,
        // Symplectic gravity integration can change discrete KE+PE; report its scale, not a made-up correction.
        gravityIntegrationScale: 0.5 * pre.mass * dot(this.world.gravity, this.world.gravity) * this.world.timestep ** 2,
        nonDetonationKEIncrease: !detonation && total.rawDeltaKE > 0,
        nonDetonationGravityAdjustedIncrease: !detonation && stableGravityAdjustedDelta > 0,
        segments: { preparation, rapier, bookkeeping },
        topBodyGains: this.topGains(after),
        demotions: this.demotions, operations: this.operations, blastPressure: this.pressure,
        observedContactPairs: this.contacts.size,
        deepestObservedPenetration: [...this.contacts.values()].reduce((deepest, contact) =>
          contact.samples.reduce((value, sample) => sample.kind === 'manifold' && sample.phase === 'afterRapier'
            ? Math.max(value, sample.deepestPenetration ?? 0) : value, deepest), 0),
        jointCount: this.joints.length,
        motorStability: this.target.compliantConnections?.motorStability ? { ...this.target.compliantConnections.motorStability } : null,
        massMismatches: this.mismatches,
        events: frame.events.map((event) => ({ type: event.type, mass: event.mass, impulse: event.impulse })),
        auditMs: 0,
      };
    });
    row.auditMs = this.excluded - this.auditStart;
    this.steps.push(row);
    return row;
  }

  /** Print after simulation so stdout backpressure cannot perturb structural deadlines. */
  flushLogs() {
    const started = performance.now();
    const printMass = (sample: MassMismatch, tick: number) => {
      const key = `${sample.body}:${sample.mass}:${sample.expectedMass}`;
      if (this.printedMass.has(key)) return;
      this.printedMass.add(key);
      console.log(`  mass-mismatch ${JSON.stringify({ tick, ...sample })}`);
    };
    for (const sample of this.initialMassMismatches) printMass(sample, 0);
    for (const row of this.steps.slice(this.printedSteps)) {
      for (const sample of row.massMismatches) printMass(sample, row.tick);
      if (!row.nonDetonationKEIncrease) continue;
      console.log(`  energy ${JSON.stringify({ tick: row.tick, stage: row.stage, kineticEnergy: row.after.kineticEnergy,
        rawGain: row.rawDeltaKE, gravityConversion: row.gravityConversion, stableGravityAdjustedDelta: row.stableGravityAdjustedDelta,
        topologyAndStateDeltaKE: row.topologyAndStateDeltaKE, above10mps: row.after.above10mps, peakSpeed: row.after.peakSpeed,
        preRapierAbove8mpsWithoutCCD: row.beforeRapier.above8mpsWithoutCCD,
        top3: row.topBodyGains.map((body: any) => ({ body: body.body, deltaKE: body.deltaKE, newBody: body.newBody,
          contacts: body.contacts, joints: body.joints, pressureDeltaKE: body.blastPressure.reduce((sum: number, load: any) => sum + load.deltaKE, 0),
          inheritedFrom: body.inheritedFrom.map((source: any) => source.body), creationOperation: body.creationOperation })), demotions: row.demotions })}`);
    }
    this.printedSteps = this.steps.length;
    this.loggingMs += performance.now() - started;
  }

  report() {
    const lastDetonationTick = this.steps.filter((step) => step.detonation).at(-1)?.tick ?? null;
    const afterLast = this.steps.filter((step) => lastDetonationTick !== null && step.tick >= lastDetonationTick);
    const peak = (steps: any[], field: string) => steps.reduce((best: any, step: any) => {
      for (const phase of ['beforeRapier', 'afterRapier', 'after']) {
        if (!best || step[phase][field] > best.value) best = { tick: step.tick, phase, value: step[phase][field] };
      }
      return best;
    }, null);
    return {
      accounting: {
        units: 'joules, kilograms, metres, seconds',
        kineticEnergy: 'All dynamic bodies, sleeping included; angular KE uses body rotation times local principal-inertia frame.',
        identity: 'WeakMap identity of the JS RigidBody object, independent of reusable native handles.',
        gravity: 'PE=-mass*gravityScale*dot(gravity,worldCOM). Gravity conversion is compared only for persistent dynamic bodies with unchanged mass/gravity scale in each sampled segment. Topology/state KE transport is reported separately.',
        residual: 'stableGravityAdjustedDelta is KE change minus measured gravitational PE conversion, not proof of unexplained energy: contact correction, stored joint energy, damping, external work and numerical integration are not subtracted.',
        contactSamples: 'Ordered by observation within each step and labeled beforeRapier/rapier/afterRapier; pre-step manifold impulse writeback may belong to the previous step. Legacy geometry fields select one complete manifold from the latest afterRapier query; force fields use only afterRapier events.',
        timings: 'Audit snapshots/contact copies/attribution are excluded from benchmark intervals and engine worker/physics/structural budget timers; their actual wall cost remains in auditMs. No hooks run inside the direct structural solve.',
        contacts: 'Only contact manifolds and force events already visited by the engine; every sample retains its phase, query/manifold index and order. Repeated queries are observations, not additional impulses. deepestObservedPenetration uses post-step samples only.',
        joints: 'Actual native applied/motor/limit impulses in local constraint axes from final solver-substep writeback. sampleDt includes endpoint additional iterations; owned benchmark bodies use zero additional iterations.',
        mass: 'Expected actor mass is sum of owned graph.fragmentMass; stand-alone secondary bodies use actual secondary fragment mass. No mass-property recomputation. Unknown external/cannonball masses are not compared.',
      },
      initial: this.initial, initialMassMismatches: this.initialMassMismatches,
      summary: {
        steps: this.steps.length, lastDetonationTick,
        peakKineticEnergy: peak(this.steps, 'kineticEnergy'), peakKineticEnergyAfterLastDetonation: peak(afterLast, 'kineticEnergy'),
        peakSpeed: peak(this.steps, 'peakSpeed'), peakBodiesAbove10mps: peak(this.steps, 'above10mps'),
        preRapierUnprotectedFastBodyTicks: this.steps.filter((step) => step.beforeRapier.above8mpsWithoutCCD > 0).map((step) => ({ tick: step.tick, count: step.beforeRapier.above8mpsWithoutCCD })),
        nonDetonationKEIncreaseTicks: this.steps.filter((step) => step.nonDetonationKEIncrease).map((step) => step.tick),
        nonDetonationGravityAdjustedIncreaseTicks: this.steps.filter((step) => step.nonDetonationGravityAdjustedIncrease).map((step) => step.tick),
        massMismatchSamples: this.initialMassMismatches.length + this.steps.reduce((sum, step) => sum + step.massMismatches.length, 0),
        massMismatchBodies: [...new Set([...this.initialMassMismatches, ...this.steps.flatMap((step) => step.massMismatches)].map((sample) => sample.body))],
        auditMs: this.excluded, loggingMs: this.loggingMs,
      },
      geometry: Object.fromEntries(this.geometry),
      steps: this.steps,
    };
  }
}
