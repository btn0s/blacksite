/** Large-frame command replay, streaming physics fingerprints and energy attribution. */
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createDestructibleBoxes } from '../packages/destruction-authoring/src/boxes';
import { DestructionSimulation } from '../packages/destruction-physics/src/index';
import { flavour, flavourSuffix } from '../packages/destruction-physics/src/engine';
import { FIXED_DT, SIMULATION_VERSION, type DestructionCommand, type ReplayLog, type Vec3 } from '../packages/destruction-domain/src/index';
import { SCALE_FRAMES, SCALE_STOREY, scaleFrameBoxes } from '../packages/destruction-testkit/src/scale-frame';
import { CascadeEnergyAudit } from './cascade-energy-audit';
import { CascadeLandingAudit } from './cascade-landing-audit';

const argument = process.argv[2];
if (!argument) throw new Error('Usage: pnpm exec tsx scripts/replay-cascade-audit.ts replay.json | --airstrike');
const dt = Number(process.env.CASCADE_TIMESTEP ?? FIXED_DT);
const frameDefinition = SCALE_FRAMES.find(frame => frame.name === 'large')!;
const { manifest } = createDestructibleBoxes(scaleFrameBoxes(frameDefinition), { id: 'large', cellSize: 1, maxFragments: 10000 });
const vector = (text: string): Vec3 => {
  const values = text.split(',').map(Number);
  if (values.length !== 3 || !values.every(Number.isFinite)) throw new Error('Invalid position/direction');
  return values as Vec3;
};
const log: ReplayLog = argument === '--airstrike' ? {
  version: 1, assetHash: manifest.assetHash, scenario: 'building', endTick: Math.round(1 / dt) + Number(process.env.TICKS ?? 480),
  commands: [{ type: 'explosion', id: 1, source: 1, tick: Math.round(1 / dt) + 1,
    position: vector(process.env.POS ?? '0.5,9.5,-8.9'), direction: vector(process.env.DIR ?? '0.3,-0.9,0.3'),
    charge: Number(process.env.CHARGE ?? 200) }],
} : JSON.parse(readFileSync(argument, 'utf8'));
if (log.assetHash !== manifest.assetHash) throw new Error(`Replay asset mismatch: ${log.assetHash} / ${manifest.assetHash}`);
if (log.physicsOperations?.length) throw new Error('This command-only acceptance runner does not accept external physics operations');
if (!process.env.CASCADE_RAPIER && log.simulationVersion?.endsWith('-simd')) process.env.CASCADE_RAPIER = 'simd';
const sim = await DestructionSimulation.create(manifest, { timestep: dt });
const target = sim as any;
const audit = new CascadeEnergyAudit(sim);
const landing = process.env.CASCADE_REPLAY_LANDINGS === '1'
  ? new CascadeLandingAudit(sim, audit, SCALE_STOREY, () => null)
  : undefined;
const recordWork = process.env.CASCADE_REPLAY_WORK === '1';
const output = process.env.CASCADE_REPLAY_REPORT ?? '/tmp/cascade-replay-audit';
for (const suffix of ['.physics.jsonl', '.energy.jsonl', '.retirement.jsonl']) writeFileSync(output + suffix, '');
if (recordWork) writeFileSync(output + '.work.jsonl', '');
const write = (suffix: string, value: unknown) => appendFileSync(output + suffix, JSON.stringify(value) + '\n');
// The landing audit already normalizes load/solve/episode references. Stream its
// top-level tables so long replays do not require one enormous JSON string.
const writeReport = (suffix: string, report: Record<string, unknown>) => {
  writeFileSync(output + suffix, '{');
  let first = true;
  for (const [key, value] of Object.entries(report)) {
    appendFileSync(output + suffix, `${first ? '' : ','}\n${JSON.stringify(key)}:`);
    first = false;
    if (Array.isArray(value)) {
      appendFileSync(output + suffix, '[');
      for (let index = 0; index < value.length; index++) {
        appendFileSync(output + suffix, `${index ? ',' : ''}\n${JSON.stringify(value[index])}`);
      }
      appendFileSync(output + suffix, ']');
    } else appendFileSync(output + suffix, JSON.stringify(value) ?? 'null');
  }
  appendFileSync(output + suffix, '\n}\n');
};
type DirectWork = {
  elapsedMs: number; observedMs: number; budgetMs: number | null;
  workUsed: number; workLimit: number; workDeferred: number;
  complete: boolean; overBudget: boolean; factorizedColumns: number;
  reusedComponents: number; cachedComponents: number; solvedComponents: number;
  measuredBonds: number; solvedBonds: number; directFractureCount: number;
  impulseEvaluations: number; evaluatedImpulseBonds: number;
  historicalImpulseEvaluations: number; deferredImpulseSamples: number;
};
let directWorkThisStep: DirectWork[] = [];
if (recordWork) {
  const solve = sim.graph.directSolver.solve.bind(sim.graph.directSolver);
  sim.graph.directSolver.solve = (...args) => {
    const started = audit.clock();
    const result = solve(...args);
    const observedMs = audit.clock() - started;
    // Read only after the cooperative solve has stopped its own deadline clock.
    audit.sampleDiagnostic(() => directWorkThisStep.push({
      elapsedMs: result.elapsedMs, observedMs, budgetMs: args[5]?.budgetMs ?? null,
      workUsed: result.workUsed, workLimit: result.workLimit, workDeferred: result.workDeferred,
      complete: result.complete, overBudget: result.overBudget,
      factorizedColumns: result.factorizedColumns, reusedComponents: result.reusedComponents,
      cachedComponents: result.cachedComponents, solvedComponents: result.solvedComponents,
      measuredBonds: result.measuredBonds.length,
      solvedBonds: result.solvedBonds.reduce((count, solved) => count + Number(!!solved), 0),
      directFractureCount: result.fractures.bonds.length,
      impulseEvaluations: result.impulseEvaluations.length,
      evaluatedImpulseBonds: result.impulseEvaluations.reduce((count, evaluation) => count + evaluation.bondCount, 0),
      historicalImpulseEvaluations: result.impulseEvaluations.filter(evaluation => evaluation.historical).length,
      deferredImpulseSamples: result.deferredImpulseSamples,
    }));
    return result;
  };
}
const workTotals = {
  steps: 0, solveCalls: 0, completeSteps: 0, overBudgetSteps: 0,
  factorizedColumns: 0, reusedComponents: 0, cachedComponents: 0, solvedComponents: 0,
  measuredBonds: 0, solvedBonds: 0, directFractureCount: 0,
  impulseEvaluations: 0, evaluatedImpulseBonds: 0, historicalImpulseEvaluations: 0,
};
const workPeaks = { factorizedColumns: 0, cachedComponents: 0, solvedComponents: 0,
  measuredBonds: 0, solvedBonds: 0, directFractureCount: 0, impulseEvaluations: 0, deferredImpulseSamples: 0 };
const workTimes = { stepMs: [] as number[], directElapsedMs: [] as number[], directObservedMs: [] as number[] };
const sumWork = (key: keyof DirectWork) => directWorkThisStep.reduce((sum, solve) => sum + Number(solve[key]), 0);
const summarizeTime = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  const percentile = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
  return { total: values.reduce((sum, value) => sum + value, 0), p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) ?? 0 };
};
const pending = [...log.commands].sort((a, b) => a.tick - b.tick || a.source - b.source || a.id - b.id);
const end = Number(process.env.END ?? log.endTick);
const lastBlast = Math.max(0, ...log.commands.filter(command => command.type === 'explosion').map(command => command.tick));
const acceptanceAfter = Number(process.env.AFTER ?? (argument === '--airstrike' ? lastBlast + 3 : 396));
const checkpoints = new Map([0.5, 1, 1.25, 2, 4].map(seconds => [lastBlast + Math.round(seconds / dt) - 1, seconds]));
const retiredHandles = new Map<number, { tick: number; body: number }>();
const retirementViolations: any[] = [];
const retirementCounts = { pieces: 0, collidersRemoved: 0, bodiesRemoved: 0, laterContactEvents: 0 };
let retirementsThisStep: any[] = [];
for (const name of ['startSink', 'startIslandSink']) {
  const original = target[name].bind(target);
  target[name] = (piece: any) => {
    const body = piece.body;
    const before = audit.sampleDiagnostic(() => ({ body: audit.bodyIdentity(body), handle: body.handle,
      position: body.translation(), velocity: body.linvel(), ccd: body.isCcdEnabled(),
      colliders: Array.from({ length: body.numColliders() }, (_, i) => body.collider(i).handle) }));
    const result = original(piece);
    audit.sampleDiagnostic(() => {
      const removed = before.colliders.filter(handle => !sim.world.getCollider(handle));
      const bodyRemoved = !sim.world.getRigidBody(before.handle);
      // A caller may decide that this piece is not eligible for retirement.
      if (!bodyRemoved && !piece.sink) return;
      retirementCounts.pieces++; retirementCounts.collidersRemoved += removed.length;
      retirementCounts.bodiesRemoved += Number(bodyRemoved);
      for (const handle of before.colliders) retiredHandles.set(handle, { tick: target.tick, body: before.body });
      const after = bodyRemoved ? null : { type: body.bodyType(), mass: body.mass(), velocity: body.linvel(), colliders: body.numColliders() };
      const row = { tick: target.tick, operation: name, ...before, removedColliders: removed, bodyRemoved, after };
      if (removed.length !== before.colliders.length || !bodyRemoved) retirementViolations.push(row);
      retirementsThisStep.push(row);
    });
    return result;
  };
}
// Observe native queue output before the engine filters stale events. Events from
// earlier in the same step as removal are real earlier contacts, not violations.
const drain = target.eventsQueue.drainContactForceEvents.bind(target.eventsQueue);
target.eventsQueue.drainContactForceEvents = (callback: (event: any) => void) => drain((event: any) => {
  audit.sampleDiagnostic(() => {
    const handles = [event.collider1(), event.collider2()];
    if (handles.some(handle => retiredHandles.has(handle) && retiredHandles.get(handle)!.tick < target.tick)) {
      retirementCounts.laterContactEvents++;
      const row = { tick: target.tick, retiredContact: handles, force: event.totalForceMagnitude() };
      retirementViolations.push(row); retirementsThisStep.push(row);
    }
  });
  callback(event);
});

const summary: any = { assetHash: manifest.assetHash, sourceSimulationVersion: log.simulationVersion ?? null,
  simulationVersion: SIMULATION_VERSION + flavourSuffix(), rapier: flavour, dt, endTick: end, acceptanceAfter,
  peakKEAfterLastBlast: { tick: 0, joules: 0 }, peakSpeedAfterAcceptance: { tick: 0, speed: 0, phase: '' },
  speedViolations: [], rawEnergyGainSteps: 0, positiveGravityAdjustedSteps: 0,
  maxPositiveGravityAdjustedJ: 0, massMismatchSamples: 0, checkpoints: [], retirementCounts, retirementViolations,
  fingerprint: 'SHA-256 of exact graph state, frame transforms and native per-body pose/velocity/mass; excludes measured wall time.',
};
const contactParticipants = (body: any) => [...new Set<number>(body.contacts.flatMap((contact: any) => contact.bodies ?? []))]
  .filter(id => id !== null).map(id => ({ body: id, phases: Object.fromEntries(
    ['before', 'preRapier', 'postRapier'].map(phase => {
      const sample = (audit as any)[phase]?.bodies.get(id);
      return [phase, sample ? { type: sample.type, mass: sample.mass, com: sample.com, velocity: sample.velocity,
        angularVelocity: sample.angularVelocity, kineticEnergy: sample.kineticEnergy, ccd: sample.ccdEnabled,
        members: sample.members, secondaryIds: sample.secondaryIds, baked: sample.baked,
        colliders: sample.colliders.map((collider: any) => ({ handle: collider.handle, fragment: collider.fragment, secondaryId: collider.secondaryId })) } : null];
    })) }));
const compactGain = (body: any) => ({ body: body.body, deltaKE: body.deltaKE, mass: body.after.mass,
  velocity: body.after.velocity, angularVelocity: body.after.angularVelocity, newBody: body.newBody,
  contacts: body.contacts, contactParticipants: contactParticipants(body), joints: body.joints,
  blastPressure: body.blastPressure, inheritedFrom: body.inheritedFrom });
let frame = sim.frame();
try {
  while (frame.tick < end) {
    let detonation = false;
    while (pending.length && pending[0]!.tick <= frame.tick + 1) {
      const command = pending.shift()!;
      if (!sim.enqueue({ ...command, tick: frame.tick + 1 })) throw new Error(`Rejected command ${command.id} at ${frame.tick + 1}`);
      detonation ||= command.type === 'explosion';
    }
    retirementsThisStep = [];
    const stage = detonation ? 'detonation' : frame.tick < lastBlast ? 'rest' : 'collapse';
    audit.begin(stage);
    landing?.begin(stage);
    directWorkThisStep = [];
    const stepStarted = recordWork ? audit.clock() : 0;
    frame = sim.step();
    const stepMs = recordWork ? audit.clock() - stepStarted : 0;
    landing?.end(frame);
    const energy = audit.end(frame);
    if (recordWork) {
      const work = {
        tick: frame.tick, stage, stepMs, directElapsedMs: sumWork('elapsedMs'), directObservedMs: sumWork('observedMs'),
        workUsed: sumWork('workUsed'), workLimit: sumWork('workLimit'), workDeferred: sumWork('workDeferred'),
        nativeStepWork: { ...target.stepWork },
        complete: directWorkThisStep.length ? directWorkThisStep.every(solve => solve.complete) : null,
        overBudget: directWorkThisStep.some(solve => solve.overBudget),
        factorizedColumns: sumWork('factorizedColumns'), reusedComponents: sumWork('reusedComponents'),
        cachedComponents: sumWork('cachedComponents'), solvedComponents: sumWork('solvedComponents'),
        measuredBonds: sumWork('measuredBonds'), solvedBonds: sumWork('solvedBonds'),
        directFractureCount: sumWork('directFractureCount'), impulseEvaluations: sumWork('impulseEvaluations'),
        evaluatedImpulseBonds: sumWork('evaluatedImpulseBonds'), historicalImpulseEvaluations: sumWork('historicalImpulseEvaluations'),
        deferredImpulseSamples: directWorkThisStep.at(-1)?.deferredImpulseSamples ?? null,
        budgetRung: target.budget.rung, bonds: frame.bondStates.length, brokenBonds: frame.stats.brokenBonds,
        activeBodies: frame.stats.activeBodies, solves: directWorkThisStep,
      };
      write('.work.jsonl', work);
      workTotals.steps++; workTotals.solveCalls += directWorkThisStep.length;
      workTotals.completeSteps += Number(work.complete === true); workTotals.overBudgetSteps += Number(work.overBudget);
      for (const key of ['factorizedColumns', 'reusedComponents', 'cachedComponents', 'solvedComponents',
        'measuredBonds', 'solvedBonds', 'directFractureCount', 'impulseEvaluations',
        'evaluatedImpulseBonds', 'historicalImpulseEvaluations'] as const) workTotals[key] += work[key];
      for (const key of Object.keys(workPeaks) as (keyof typeof workPeaks)[]) workPeaks[key] = Math.max(workPeaks[key], work[key] ?? 0);
      for (const key of Object.keys(workTimes) as (keyof typeof workTimes)[]) workTimes[key].push(work[key]);
    }
    const bodies: any[] = [];
    const native: any[] = [];
    sim.world.bodies.forEach(body => { native.push(body); });
    let fast = 0, dynamic = 0, linearKE = 0, fastest = { speed: 0, mass: 0, body: 0 };
    for (const body of native) {
      const velocity = body.linvel(), speed = Math.hypot(velocity.x, velocity.y, velocity.z), mass = body.mass();
      const id = audit.bodyIdentity(body);
      bodies.push([id, body.bodyType(), mass, body.translation(), body.rotation(), velocity, body.angvel(), body.isSleeping(), body.isCcdEnabled()]);
      if (!body.isDynamic()) continue;
      dynamic++; fast += Number(speed > 8); linearKE += 0.5 * mass * speed * speed;
      if (speed > fastest.speed) fastest = { speed, mass, body: id };
    }
    bodies.sort((a, b) => a[0] - b[0]);
    const hash = createHash('sha256').update(JSON.stringify(bodies));
    for (const array of [target.graph.states, target.graph.damage, target.graph.chunkHealth, frame.transforms, frame.states,
      ...Object.values(frame.secondary ?? {}).filter(ArrayBuffer.isView)]) {
      if (ArrayBuffer.isView(array)) hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
    }
    const row = { tick: frame.tick, broken: frame.stats.brokenBonds, active: frame.stats.activeBodies,
      dynamic, fastAbove8: fast, fastest, linearKE, totalKE: energy.after.kineticEnergy,
      budgetRung: target.budget.rung, checksum: hash.digest('hex') };
    write('.physics.jsonl', row);
    for (const retirement of retirementsThisStep) write('.retirement.jsonl', retirement);
    if (frame.tick >= lastBlast && energy.afterRapier.kineticEnergy > summary.peakKEAfterLastBlast.joules)
      summary.peakKEAfterLastBlast = { tick: frame.tick, joules: energy.afterRapier.kineticEnergy };
    if (frame.tick > acceptanceAfter) {
      for (const phase of ['beforeRapier', 'afterRapier', 'after'] as const) {
        const speed = energy[phase].peakSpeed;
        if (speed > summary.peakSpeedAfterAcceptance.speed) summary.peakSpeedAfterAcceptance = { tick: frame.tick, phase, speed };
        if (speed > 20) summary.speedViolations.push({ tick: frame.tick, phase, speed });
      }
      if (energy.nonDetonationKEIncrease) summary.rawEnergyGainSteps++;
      if (energy.nonDetonationGravityAdjustedIncrease) summary.positiveGravityAdjustedSteps++;
      summary.maxPositiveGravityAdjustedJ = Math.max(summary.maxPositiveGravityAdjustedJ, energy.stableGravityAdjustedDelta);
    }
    summary.massMismatchSamples += energy.massMismatches.length;
    if (energy.nonDetonationKEIncrease || energy.stableGravityAdjustedDelta > 0 || detonation) write('.energy.jsonl', {
      tick: frame.tick, detonation, kineticEnergy: energy.after.kineticEnergy, rawDeltaKE: energy.rawDeltaKE,
      gravityConversion: energy.gravityConversion, gravityAdjustedDelta: energy.stableGravityAdjustedDelta,
      gravityIntegrationScale: energy.gravityIntegrationScale, topologyDeltaKE: energy.topologyAndStateDeltaKE,
      segments: energy.segments, top3: energy.topBodyGains.map(compactGain), massMismatches: energy.massMismatches,
    });
    if (checkpoints.has(frame.tick)) summary.checkpoints.push({ secondsAfterHit: checkpoints.get(frame.tick), ...row });
    // The full native snapshots are needed for attribution only in this step.
    // Stream compact records rather than retaining every scene snapshot in RAM.
    audit.steps.length = 0;
  }
  summary.final = { tick: frame.tick, broken: frame.stats.brokenBonds, active: frame.stats.activeBodies };
} finally {
  if (landing) {
    writeReport('.landings.json', landing.report());
    summary.landings = { path: output + '.landings.json', storeyHeight: SCALE_STOREY,
      centroid: 'Not sampled by this command replay; landing/contact/load records cover every completed replay step.' };
  }
  if (recordWork) {
    summary.work = {
      path: output + '.work.jsonl', totals: workTotals, perStepPeaks: workPeaks,
      timingMs: Object.fromEntries(Object.entries(workTimes).map(([key, values]) => [key, summarizeTime(values)])),
      accounting: 'Per-call direct results copied after solve, including exact factor/cache/solve and impact-evaluation work. Counts are observations, not unique bonds across steps. Timings exclude shared energy/landing audit reads. No work quota or physics changes.',
    };
  }
  writeFileSync(output + '.summary.json', JSON.stringify(summary, null, 2) + '\n');
  sim.dispose();
}
console.log(JSON.stringify(summary, null, 2));
