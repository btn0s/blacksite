/**
 * Scale test: how large a cast-concrete frame can the engine bring down smoothly?
 *
 * Builds plain column-and-slab frames with a stair core at increasing sizes, lets each stand,
 * charges every ground-floor column, fires, and times every physics step (headless, no render).
 * Usage: corepack pnpm benchmark:cascade:scale -- small medium large [--assert] [--rest-only]
 */
import { performance } from 'node:perf_hooks';
import { CascadeEnergyAudit } from './cascade-energy-audit';
import { CascadeLandingAudit } from './cascade-landing-audit';
import { flavour, loadRapier } from '../packages/destruction-physics/src/engine';
import {
  createDestructibleBoxes,
  DestructionSimulation,
  FragmentState,
  MAX_EXPLOSIVES,
  type DestructibleBox,
  type DestructionCommand,
  type FragmentDef,
  type SimulationFrame,
  type Vec3,
  TRANSFORM_STRIDE,
} from '../packages/cascade/src/index';
import {
  SCALE_BAY as BAY,
  SCALE_CELL,
  SCALE_FRAMES as FRAMES,
  SCALE_STOREY as STOREY,
  scaleFrameBoxes as frameBoxes,
  type ScaleFrame as Frame,
} from '../packages/destruction-testkit/src/scale-frame';
import { closeSync, openSync, writeSync } from 'node:fs';
import { auditMaximumCharge } from './cascade-charge-audit';

const chargeProtocol = process.argv.includes('--charges=maximum') ? 'maximum' : process.argv.includes('--charges=column') ? 'column' : 'knee';

/** Emit the complete trace without constructing a report-sized JavaScript string. */
function writeJsonReport(path: string, report: unknown): void {
  const fd = openSync(path, 'w');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let buffered = 0;
  const flush = () => {
    let written = 0;
    while (written < buffered) {
      const count = writeSync(fd, buffer, written, buffered - written);
      if (count <= 0) throw new Error('Unable to write benchmark report');
      written += count;
    }
    buffered = 0;
  };
  const append = (text: string) => {
    const bytes = Buffer.from(text);
    let offset = 0;
    while (offset < bytes.length) {
      const count = Math.min(buffer.length - buffered, bytes.length - offset);
      bytes.copy(buffer, buffered, offset, offset + count);
      buffered += count; offset += count;
      if (buffered === buffer.length) flush();
    }
  };
  const omitted = (value: unknown) => value === undefined || typeof value === 'function' || typeof value === 'symbol';
  const ancestors = new Set<object>();
  const valueForJson = (value: any, key: string): unknown =>
    value !== null && typeof value === 'object' && typeof value.toJSON === 'function' ? value.toJSON(key) : value;
  const emit = (value: unknown, depth: number): void => {
    if (value === null || typeof value !== 'object') {
      append(JSON.stringify(value) ?? 'null');
      return;
    }
    if (ancestors.has(value)) throw new TypeError('Circular benchmark report');
    ancestors.add(value);
    const indent = '  '.repeat(depth), childIndent = `${indent}  `;
    if (Array.isArray(value)) {
      append('[');
      for (let index = 0; index < value.length; index++) {
        append(`${index ? ',' : ''}\n${childIndent}`);
        emit(valueForJson(value[index], String(index)), depth + 1);
      }
      if (value.length) append(`\n${indent}`);
      append(']');
    } else {
      append('{');
      let count = 0;
      for (const key of Object.keys(value)) {
        const child = valueForJson((value as Record<string, unknown>)[key], key);
        if (omitted(child)) continue;
        append(`${count++ ? ',' : ''}\n${childIndent}${JSON.stringify(key)}: `);
        emit(child, depth + 1);
      }
      if (count) append(`\n${indent}`);
      append('}');
    }
    ancestors.delete(value);
  };
  try {
    emit(valueForJson(report, ''), 0);
    append('\n');
    flush();
  } finally {
    closeSync(fd);
  }
}

/**
 * What the player sees. Detached mass says a body let go of its footings, not that it came
 * down, so this uses displacement: the mass-weighted centroid of everything that still exists,
 * and the fraction of mass whose centre is below one storey. Live primaries and secondary pieces
 * use their pose. Dust (retired primaries) is reported separately and gets no credit in the
 * below-storey gate (`belowStoreyLive`), so pulverising cannot hide in it; `belowStorey` keeps
 * the old definition (dust counted as on the ground) as information. The centroid is the
 * live-mass centroid, which is what a viewer sees; dust sits at ground level and does not drag it.
 */
function measureCollapse(fragments: FragmentDef[], frame: SimulationFrame, totalMass: number) {
  let initial = 0,
    final = 0,
    below = 0,
    crushed = 0,
    finalMass = 0;
  fragments.forEach((frag, i) => {
    if (frag.support !== false && (frag.depth === undefined || frag.depth === 1)) {
      initial += frag.mass * frag.position[1];
    }
    if (frame.states[i] === FragmentState.Retired || frame.states[i] === FragmentState.Hidden) {
      return; // crushed, or refined into secondary pieces counted below
    }
    const y = frame.transforms[i * TRANSFORM_STRIDE + 1]!;
    final += frag.mass * y;
    finalMass += frag.mass;
    if (y < STOREY) below += frag.mass;
  });
  frame.secondary?.fragments.forEach((piece, i) => {
    if (frame.secondary!.states[i] === FragmentState.Retired) return;
    const y = frame.secondary!.transforms[i * TRANSFORM_STRIDE + 1]!;
    final += piece.mass * y;
    finalMass += piece.mass;
    if (y < STOREY) below += piece.mass;
  });
  // Mass that is neither a live primary nor a live secondary piece was pulverised (or evicted).
  crushed = Math.max(0, totalMass - finalMass);
  const initialCentroidY = initial / totalMass;
  const finalCentroidY = finalMass > 0 ? final / finalMass : 0;
  return {
    initialCentroidY,
    finalCentroidY,
    centroidDrop: 1 - finalCentroidY / initialCentroidY,
    belowStorey: (below + crushed) / totalMass,
    belowStoreyLive: below / totalMass,
    crushedMass: crushed / totalMass,
  };
}

const pct = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
};
const ms = (n: number) => n.toFixed(1).padStart(6);

/** Benchmark-only hooks; child intervals are subtracted before a parent is charged. */
const TIMED_PHASES = [
  'structuralSolve', 'structuralFallback', 'structuralGraph', 'bearingTopology', 'structuralConnectivity', 'structuralLoads', 'bearingAdmission', 'fracture',
  'rapier', 'contacts', 'debrisBaking', 'actorRebuild', 'joints', 'forces', 'geometry', 'frame',
] as const;
type TimedPhase = typeof TIMED_PHASES[number];
type Phase = TimedPhase | 'unattributed';
type PhaseTimes = Record<Phase, number>;
type StepStage = 'rest' | 'placement' | 'detonation' | 'collapse';
interface TimedStep {
  tick: number;
  stage: StepStage;
  wave?: number;
  collapseTick?: number;
  ms: number;
  rawWallMs: number;
  excludedAuditMs: number;
  phases: PhaseTimes;
  bearing?: ReturnType<CascadeLandingAudit['bearingPerformance']>;
  counts: {
    bondsBefore: number;
    bondsAfter: number;
    bodiesBefore: number;
    bodiesAfter: number;
    actorsBefore: number;
    actorsAfter: number;
    activeBodies: number;
    sleepingBodies: number;
    settledBodies: number;
    brokenBonds: number;
    cachedStructuralComponents: number;
    solvedStructuralComponents: number;
  };
}
const PHASES: readonly Phase[] = [...TIMED_PHASES, 'unattributed'];
const emptyPhaseTimes = (): PhaseTimes => Object.fromEntries(PHASES.map((phase) => [phase, 0])) as PhaseTimes;

function instrumentSteps(sim: DestructionSimulation, audit: CascadeEnergyAudit, landing: CascadeLandingAudit) {
  // TypeScript private methods remain ordinary methods at runtime. Keep these hooks
  // out of engine source and instrument coarse passes, never per-contact/per-body loops.
  const target = sim as unknown as {
    world: { bodies: { len(): number } };
    eventsQueue?: object;
    compliantConnections?: object;
    islands: Map<number, unknown>;
    supportedActors: Map<number, unknown>;
    bearingSupports: Map<unknown, unknown>;
  };
  let current: PhaseTimes | undefined;
  const stack: { phase: TimedPhase; childMs: number }[] = [];
  const methods: Record<string, string[]> = {};
  const wrap = (owner: object | undefined, names: readonly string[], phase: TimedPhase, label: string) => {
    if (!owner) return;
    const properties = owner as Record<string, unknown>;
    for (const name of names) {
      const original = properties[name];
      if (typeof original !== 'function') throw new Error(`Timing hook ${label}.${name} is unavailable`);
      (methods[phase] ??= []).push(`${label}.${name}`);
      properties[name] = function (this: unknown, ...args: unknown[]) {
        if (!current) return original.apply(this, args);
        const entry = { phase, childMs: 0 };
        stack.push(entry);
        const started = audit.clock();
        try {
          return original.apply(this, args);
        } finally {
          const elapsed = audit.clock() - started;
          stack.pop();
          current[phase] += elapsed - entry.childMs;
          const parent = stack[stack.length - 1];
          if (parent) parent.childMs += elapsed;
        }
      };
    }
  };
  wrap(sim.graph.directSolver, ['solve'], 'structuralSolve', 'directSolver');
  wrap(sim, ['solveBearingSupports'], 'structuralSolve', 'simulation');
  wrap(sim, ['submitBearingSupports'], 'bearingAdmission', 'simulation');
  wrap(sim, ['updateBearingLoadSnapshot'], 'contacts', 'simulation');
  wrap(sim, ['requestBearingSupport'], 'debrisBaking', 'simulation');
  wrap(sim.graph, ['solveSupportPaths', 'applySupportPaths'], 'structuralFallback', 'graph');
  wrap(sim.graph, ['step', 'split'], 'structuralGraph', 'graph');
  wrap(sim.graph, ['setExternalLoads'], 'structuralLoads', 'graph');
  wrap(sim.graph, ['addBearingWorldBonds', 'removeBearingWorldBonds'], 'bearingTopology', 'graph');
  wrap(Object.getPrototypeOf(sim.graph), ['rebuildConnectivity'], 'structuralConnectivity', 'graph');
  wrap(sim.graph, ['generateFracture', 'applyFracture'], 'fracture', 'graph');
  wrap(sim, ['fractureImpacts', 'secondaryCandidates', 'fractureSecondary', 'crushFragments', 'pulverise'], 'fracture', 'simulation');
  wrap(target.world, ['step'], 'rapier', 'world');
  wrap(target.eventsQueue, ['drainContactForceEvents'], 'contacts', 'eventsQueue');
  wrap(sim, ['collectStructuralLoads', 'collectCascades'], 'contacts', 'simulation');
  wrap(sim, ['updateTransformsAndSettlement', 'ageDebris', 'applyBudget', 'wakeDependents', 'cullOutOfBounds', 'expireOrdnance'], 'debrisBaking', 'simulation');
  wrap(sim, ['rebuildIslands', 'initializeDemotedPoses', 'remountHierarchyCharges'], 'actorRebuild', 'simulation');
  wrap(target.compliantConnections, ['sync', 'collect'], 'joints', 'compliantConnections');
  wrap(sim, ['collectBlastPressure', 'applyBlastPressure', 'applyImpulses'], 'forces', 'simulation');
  wrap(sim, ['refreshGeometryVersion'], 'geometry', 'simulation');
  wrap(sim, ['frame'], 'frame', 'simulation');
  const steps: TimedStep[] = [];
  return {
    methods,
    steps,
    step(stage: StepStage, detail: { wave?: number; collapseTick?: number } = {}) {
      const bondsBefore = sim.graph.manifest.bonds.length;
      const bodiesBefore = target.world.bodies.len();
      const actorsBefore = target.islands.size + target.supportedActors.size;
      audit.begin(stage);
      landing.begin(stage);
      const phases = emptyPhaseTimes();
      current = phases;
      const excludedBefore = audit.excludedMs;
      const rawStarted = performance.now();
      const started = audit.clock();
      let result: SimulationFrame;
      let elapsed: number;
      let rawWallMs: number;
      try {
        result = sim.step();
      } finally {
        elapsed = audit.clock() - started;
        rawWallMs = performance.now() - rawStarted;
        current = undefined;
      }
      // Residual includes unwrapped orchestration and timing-hook overhead. Counting,
      // records, percentile calculations and collapse sampling are outside sim.step.
      phases.unattributed = elapsed - TIMED_PHASES.reduce((sum, phase) => sum + phases[phase], 0);
      const record: TimedStep = {
        tick: result.tick, stage, ...detail, ms: elapsed, rawWallMs, excludedAuditMs: audit.excludedMs - excludedBefore, phases,
        counts: {
          bondsBefore, bondsAfter: result.bondStates.length,
          bodiesBefore, bodiesAfter: target.world.bodies.len(),
          actorsBefore, actorsAfter: target.islands.size + target.supportedActors.size,
          activeBodies: result.stats.activeBodies,
          sleepingBodies: result.stats.sleepingBodies,
          settledBodies: result.stats.settledBodies,
          brokenBonds: result.stats.brokenBonds,
          cachedStructuralComponents: sim.graph.directResult?.cachedComponents ?? 0,
          solvedStructuralComponents: sim.graph.directResult?.solvedComponents ?? 0,
        },
      };
      steps.push(record);
      landing.end(result);
      record.bearing = landing.bearingPerformance();
      audit.end(result);
      if (process.env.CASCADE_SCALE_PROGRESS === '1' && result.tick % 60 === 0) {
        audit.sampleDiagnostic(() => process.stderr.write(`${JSON.stringify({
          tick: result.tick, heapUsedMB: process.memoryUsage().heapUsed / 1024 ** 2,
          bonds: sim.graph.manifest.bonds.length,
          deferredSamples: sim.graph.directResult?.deferredImpulseSamples ?? 0,
          bearingSupports: target.bearingSupports.size,
        })}\n`));
      }
      return { frame: result, record };
    },
  };
}
function summarizePhases(steps: readonly TimedStep[]) {
  const totalMs = steps.reduce((sum, step) => sum + step.ms, 0);
  const slowest = [...steps].sort((a, b) => b.ms - a.ms);
  const tail = slowest.slice(0, Math.ceil(steps.length * 0.05));
  const tailMs = tail.reduce((sum, step) => sum + step.ms, 0);
  return {
    count: steps.length, totalMs,
    tail: { definition: 'slowest 5% of measured steps', count: tail.length, totalMs: tailMs, ticks: tail.map((step) => step.tick) },
    worst: slowest[0] ?? null,
    phases: Object.fromEntries(PHASES.map((phase) => {
      const values = steps.map((step) => step.phases[phase]);
      const phaseTotal = values.reduce((sum, value) => sum + value, 0);
      const phaseTail = tail.reduce((sum, step) => sum + step.phases[phase], 0);
      return [phase, {
        p50: pct(values, 50), p95: pct(values, 95), max: values.length ? Math.max(...values) : 0,
        totalMs: phaseTotal, share: totalMs ? phaseTotal / totalMs : 0,
        tailMs: phaseTail, tailShare: tailMs ? phaseTail / tailMs : 0,
      }];
    })),
  };
}

// CASCADE_SCALE_CELL=2 authors the coarse structural level (the hierarchical mode).
const CELL = process.env.CASCADE_SCALE_CELL ? Number(process.env.CASCADE_SCALE_CELL) : SCALE_CELL;
const reports: unknown[] = [];
const failures: string[] = [];
async function run(frame: Frame) {
  const t0 = performance.now();
  const boxes = frameBoxes(frame);
  const { manifest } = createDestructibleBoxes(boxes, {
    id: frame.name,
    cellSize: CELL,
    maxFragments: 10_000,
  });
  const authorMs = performance.now() - t0;
  if (process.argv.includes('--manifest-only')) {
    console.log(
      JSON.stringify({
        frame: frame.name,
        hash: manifest.assetHash,
        fragments: manifest.fragments.length,
        bonds: manifest.bonds.length,
      }),
    );
    return;
  }
  const t1 = performance.now();
  const sim = await DestructionSimulation.create(manifest, {
    timestep: process.env.CASCADE_TIMESTEP ? Number(process.env.CASCADE_TIMESTEP) : undefined,
    experimentalBearingReanchor: process.env.CASCADE_BEARING_REANCHOR === undefined
      ? undefined : process.env.CASCADE_BEARING_REANCHOR === '1',
  });
  if (process.env.CASCADE_CONTACT_PASS) sim.contactPass = process.env.CASCADE_CONTACT_PASS as 'events' | 'walk';
  const createMs = performance.now() - t1;
  const mass = manifest.fragments.reduce((sum, f, i) => sum + (sim.graph.activeChunks[i] ? f.mass : 0), 0);
  const audit = new CascadeEnergyAudit(sim);
  const landing = new CascadeLandingAudit(sim, audit, STOREY, (frame) => measureCollapse(manifest.fragments, frame, mass));
  const timing = instrumentSteps(sim, audit, landing);
  let failed = false;
  try {
    // Stand for 3 s: anything cracking or re-solving at rest shows up here.
    const rest: number[] = [];
    let f = sim.frame();
    for (let i = 0; i < Math.round(3 / sim.dt); i++) {
      const measured = timing.step('rest');
      f = measured.frame;
      rest.push(measured.record.ms);
    }
    const restIterations = f.stats.solverIterations;
    const restBroken = f.stats.brokenBonds,
      restConverged = f.stats.solverConverged;
    if (process.argv.includes('--rest-only')) {
      audit.flushLogs();
      landing.flushLogs();
      console.log(
        JSON.stringify({
          frame: frame.name,
          authorMs,
          createMs,
          restP50: pct(rest, 50),
          restMax: Math.max(...rest),
          broken: restBroken,
          converged: restConverged,
          iterations: f.stats.solverIterations,
          energy: audit.report(),
          landings: landing.report(),
          timings: { summary: summarizePhases(timing.steps), steps: timing.steps, methods: timing.methods },
        }),
      );
      if (process.argv.includes('--assert') && pct(rest.slice(-60), 50) >= 2)
        throw new Error('Rest-step p50 exceeds 2 ms');
      return;
    }
    // Charge every ground-floor column at knee height, then fire.
    let id = 1;
    const x0 = (-frame.baysX * BAY) / 2,
      z0 = (-frame.baysZ * BAY) / 2;
    const command = (
      type: DestructionCommand['type'],
      position: Vec3,
      radius: number,
      strength: number,
    ): DestructionCommand => ({
      type,
      id: id++,
      tick: f.tick + 1,
      source: 1,
      position,
      direction: [0, 0, 1],
      radius,
      strength,
    });
    // 'knee' (the original protocol) notches each ground-floor column at 1 m; 'column' also
    // charges the upper half of the ground storey so every ground-floor column is taken out.
    const chargeHeights = chargeProtocol === 'column' ? [1, 2.4] : [1];
    // Millimetre shifts of the charge row, to measure how chaotic the collapse is (CASCADE_SCALE_JITTER).
    const jitter = Number(process.env.CASCADE_SCALE_JITTER ?? 0);
    const charges: Vec3[] = [];
    for (const height of chargeHeights) {
      for (let ix = 0; ix <= frame.baysX; ix++) {
        for (let iz = 0; iz <= frame.baysZ; iz++) {
          charges.push([x0 + ix * BAY + jitter, height, z0 + iz * BAY]);
        }
      }
    }
    // Match Monolith's reversed ordering: core first, then columns, in capacity-sized waves.
    for (let t = 0.75; t < BAY; t += 1.5) {
      for (const p of [
        [x0 + t, z0],
        [x0 + t, z0 + BAY],
        [x0, z0 + t],
        [x0 + BAY, z0 + t],
      ] as const) {
        for (const height of chargeHeights) charges.push([p[0], height, p[1]]);
      }
    }
    charges.reverse();
    let maximumTarget: FragmentDef | undefined;
    let chargeAudit: (() => object | undefined) | undefined;
    if (chargeProtocol === 'maximum') {
      maximumTarget = manifest.fragments.filter((fragment, index) => sim.graph.activeChunks[index] &&
        fragment.element === 'column' && fragment.position[1] < STOREY)
        .sort((a, b) => b.position[0] - a.position[0] || a.position[2] - b.position[2])[0]!;
      const [x, , z] = maximumTarget.position;
      charges.splice(0, charges.length, [x + maximumTarget.size[0] / 2 + 0.01, 1, z]);
      // Placement offsets 6.5 cm along its supplied incoming direction.
      const position: Vec3 = [charges[0]![0] - 0.065, 1, z];
      chargeAudit = auditMaximumCharge(sim, { type: 'radial', damage: 10, minRadius: 4, maxRadius: 9,
        position, normal: [-1, 0, 0] });
    }
    const waveSteps: {
      phase: string;
      wave: number;
      ms: number;
      physicsMs: number;
      structuralMs: number;
    }[] = [];
    let placed = 0;
    const stepWave = (phase: 'placement' | 'detonation', wave: number) => {
      const measured = timing.step(phase, { wave });
      f = measured.frame;
      waveSteps.push({
        phase,
        wave,
        ms: measured.record.ms,
        physicsMs: f.stats.physicsMs,
        structuralMs: f.stats.structuralMs,
      });
    };
    for (let offset = 0; offset < charges.length; offset += MAX_EXPLOSIVES) {
      const wave = offset / MAX_EXPLOSIVES;
      const ids: number[] = [];
      for (const position of charges.slice(offset, offset + MAX_EXPLOSIVES)) {
        const queued = maximumTarget
          ? { ...command('placeExplosive', position, 9, 10), minRadius: 4, direction: [-1, 0, 0] as Vec3, fragmentId: maximumTarget.id }
          : command('placeExplosive', position, 1.5, 2);
        if (!sim.enqueue(queued)) {
          throw new Error(`${frame.name} rejected charge ${queued.id}`);
        }
        ids.push(queued.id);
      }
      stepWave('placement', wave);
      const actual = (f.ordnance ?? []).filter((item) => item.type === 'explosive');
      if (actual.length !== ids.length || actual.some((item) => !ids.includes(item.id))) {
        throw new Error(`${frame.name} wave ${wave} failed to place all ${ids.length} charges`);
      }
      placed += actual.length;
      if (!sim.enqueue(command('detonate', [0, 0, 0], 1, 1))) {
        throw new Error(`${frame.name} rejected detonation for wave ${wave}`);
      }
      stepWave('detonation', wave);
      if ((f.ordnance ?? []).some((item) => item.type === 'explosive')) {
        throw new Error(`${frame.name} wave ${wave} left undetonated charges`);
      }
    }
    // 25 s of collapse.
    const fall: number[] = [],
      physics: number[] = [],
      structural: number[] = [];
    let worst = { ms: 0, tick: 0, physics: 0, structural: 0 };
    // Seconds after the last detonation at which the live-mass centroid first drops below one
    // storey, and a once-per-second trajectory of it. Sampling time is outside the step timing.
    if (process.env.CASCADE_SCALE_TRACE === 'fine') {
      const graph = sim.graph as any;
      const original = graph.solveSupportPaths.bind(graph);
      graph.solveSupportPaths = () => {
        original();
        const rhs: Float64Array | undefined = graph.latestLoads?.rhs;
        const wr: Float64Array | undefined = graph.externalLoads?.wrenches;
        const rows: string[] = [];
        for (const members of graph.islands as number[][]) {
          if (members.length < 50 || !rhs || !wr) continue;
          let net = 0, fy = 0, up = 0, sup = 0, m = 0;
          for (const k of members) { net += rhs[k * 6 + 1]!; fy += wr[k * 6 + 1]!; m += graph.fragmentMass[k]; if (wr[k * 6 + 1]! > 0.1 * graph.fragmentMass[k] * 9.81) { sup++; up += wr[k * 6 + 1]!; } }
          let peak = 0;
          for (const k of members) { for (let r = graph.rowOffsets[k]; r < graph.rowOffsets[k + 1]; r++) peak = Math.max(peak, graph.supportPath.demand[graph.bondIndices[r]]); }
          rows.push(`island ${members.length} frags ${(m / 1000).toFixed(0)} t sinks ${sup} contactUp ${(up / 1e6).toFixed(1)}MN netRhsY ${(net / 1e6).toFixed(2)}MN maxU ${peak.toFixed(1)}`);
        }
        if (rows.length) console.log('  solve:', rows.join(' | '));
      };
    }
    const prof = emptyPhaseTimes();
    let centroidBelowAt: number | null = null;
    const centroidTrack: { t: number; y: number; belowStorey: number }[] = [];
    const hz = Math.round(1 / sim.dt);
    const half = hz / 2;
    const collapseTicks = Number(process.env.CASCADE_SCALE_TICKS ?? 25 * hz);
    for (let i = 0; i < collapseTicks; i++) {
      const measured = timing.step('collapse', { collapseTick: i });
      f = measured.frame;
      const took = measured.record.ms;
      for (const phase of PHASES) prof[phase] += measured.record.phases[phase];
      if (process.env.CASCADE_SCALE_TRACE === 'fine' && i < 1.5 * hz) {
        const sp = sim.graph.supportPathStats;
        let up = 0;
        for (let k = 0; k < manifest.fragments.length; k++) up += Math.max(0, sim.contactWrenches[k * 6 + 1]!);
        console.log(`  contact up ${(up / 1e6).toFixed(1)} MN = ${(up / (mass * 9.81)).toFixed(1)} weights`);
        console.log(
          `  tick ${i} broken ${f.stats.brokenBonds} active ${f.stats.activeBodies} supported ${f.stats.supportedFragments} dust ${f.stats.crushedFragments} pathU ${sp.maxUtilization.toFixed(2)} over ${sp.overloadedBonds} comps ${sp.components} step ${took.toFixed(1)}`,
        );
      }
      if (i % half === half - 1 || (centroidBelowAt === null && i % (hz / 10) === hz / 10 - 1)) {
        const sample = measureCollapse(manifest.fragments, f, mass);
        if (centroidBelowAt === null && sample.finalCentroidY < STOREY) {
          centroidBelowAt = (i + 1) * sim.dt;
        }
        if (i % (hz * 2.5) === hz * 2.5 - 1 && process.env.CASCADE_SCALE_PROFILE) {
          console.log('  exclusive profile (ms/step over last 2.5s):', Object.entries(prof).map(([k, v]) => `${k} ${(v / (hz * 2.5)).toFixed(1)}`).join(' '), 'bodies', f.stats.activeBodies);
          for (const phase of PHASES) prof[phase] = 0;
        }
        if (i % half === half - 1 && process.env.CASCADE_SCALE_TRACE) {
          const sp = sim.graph.supportPathStats;
          console.log(
            `  t=${((i + 1) * sim.dt).toFixed(1)}s centroid ${sample.finalCentroidY.toFixed(1)} live<storey ${(sample.belowStoreyLive * 100).toFixed(0)}% broken ${f.stats.brokenBonds} active ${f.stats.activeBodies} sleeping ${f.stats.sleepingBodies} settled ${f.stats.settledBodies} supported ${f.stats.supportedFragments} dust ${(sample.crushedMass * 100).toFixed(1)}% pathU ${sp.maxUtilization.toFixed(2)} over ${sp.overloadedBonds} step ${took.toFixed(1)}ms`,
          );
        }
        if (i % half === half - 1) {
          centroidTrack.push({
            t: (i + 1) * sim.dt,
            y: sample.finalCentroidY,
            belowStorey: sample.belowStoreyLive,
          });
        }
      }
      fall.push(took);
      physics.push(f.stats.physicsMs);
      structural.push(f.stats.structuralMs);
      if (took > worst.ms)
        worst = { ms: took, tick: i, physics: f.stats.physicsMs, structural: f.stats.structuralMs };
    }
    if (process.env.CASCADE_SCALE_TRACE) {
      const sim2 = sim as any;
      const bodies = [...sim2.islands.values()].map((i: any) => i.members as number[]).filter((m: number[]) => m.length > 20).sort((a: number[], b: number[]) => b.length - a.length).slice(0, 4);
      for (const members of bodies) {
        let lo = Infinity, hi = -Infinity, m = 0, loInit = Infinity, hiInit = -Infinity;
        for (const k of members) { const y = f.transforms[k * TRANSFORM_STRIDE + 1]!; lo = Math.min(lo, y); hi = Math.max(hi, y); loInit = Math.min(loInit, manifest.fragments[k]!.position[1]); hiInit = Math.max(hiInit, manifest.fragments[k]!.position[1]); m += manifest.fragments[k]!.mass; }
        console.log(`  body ${members.length} frags ${(m / 1000).toFixed(0)} t y ${lo.toFixed(1)}..${hi.toFixed(1)} (initially ${loInit.toFixed(1)}..${hiInit.toFixed(1)}) state ${f.states[members[0]!]}`);
      }
      const bins = new Array(Math.ceil(manifest.fragments.reduce((m, fr) => Math.max(m, fr.position[1]), 0)) + 2).fill(0);
      const initBins = bins.slice();
      manifest.fragments.forEach((fr, k) => {
        if (fr.depth === undefined || fr.support) initBins[Math.floor(fr.position[1])] += fr.mass;
        if (f.states[k] !== FragmentState.Retired && f.states[k] !== FragmentState.Hidden) bins[Math.min(bins.length - 1, Math.max(0, Math.floor(f.transforms[k * TRANSFORM_STRIDE + 1]!)))] += fr.mass;
      });
      {
        const awake = [...sim2.islands.values()].filter((i: any) => !i.body.isSleeping() && !i.body.isFixed());
        const speeds = awake.map((i: any) => { const v = i.body.linvel(), w = i.body.angvel(); return [Math.hypot(v.x, v.y, v.z), Math.hypot(w.x, w.y, w.z), i.stableTicks, i.members.length]; });
        const pc = (a: number[], q: number) => [...a].sort((x, y) => x - y)[Math.floor(q * (a.length - 1))]?.toFixed(3);
        console.log(`  awake ${awake.length}: linvel p50/p90/max ${pc(speeds.map((v) => v[0]!), 0.5)}/${pc(speeds.map((v) => v[0]!), 0.9)}/${pc(speeds.map((v) => v[0]!), 1)} angvel p50/p90 ${pc(speeds.map((v) => v[1]!), 0.5)}/${pc(speeds.map((v) => v[1]!), 0.9)} stableTicks p50 ${pc(speeds.map((v) => v[2]!), 0.5)} members p50/max ${pc(speeds.map((v) => v[3]!), 0.5)}/${pc(speeds.map((v) => v[3]!), 1)} awakeSleepMs`);
      }
      console.log('  mass by metre (t) initial:', initBins.map((v) => Math.round(v / 1000)).join(' '));
      console.log('  mass by metre (t) final:  ', bins.map((v) => Math.round(v / 1000)).join(' '));
      console.log(`  capacityEvents ${f.stats.capacityEvents} bodies active ${f.stats.activeBodies} sleeping ${f.stats.sleepingBodies} settled ${f.stats.settledBodies} fixedSettled ${[...sim2.islands.values()].filter((i: any) => i.body.isFixed()).length}`);
      const ground = manifest.fragments.map((fr, k) => ({ fr, k })).filter(({ fr }) => !fr.anchored && fr.position[1] < 3.2 && fr.mass > 0);
      const count = (pred: (k: number) => boolean) => ground.filter(({ k }) => pred(k)).length;
      console.log(`  ground-storey non-anchored cells ${ground.length}: retired ${count((k) => f.states[k] === FragmentState.Retired)} supported ${count((k) => f.states[k] === FragmentState.Supported)} other ${count((k) => f.states[k] !== FragmentState.Retired && f.states[k] !== FragmentState.Supported)}`);
    }
    const detached =
      manifest.fragments.reduce(
        (sum, frag, i) => sum + (f.states[i] === FragmentState.Supported || f.states[i] === FragmentState.Hidden || f.states[i] === FragmentState.Retired ? 0 : frag.mass),
        0,
      ) / mass + (f.secondary?.fragments.reduce((sum, piece) => sum + piece.mass, 0) ?? 0) / mass;
    const collapse = measureCollapse(manifest.fragments, f, mass);
    audit.flushLogs();
    landing.flushLogs();
    const phaseSummary = {
      all: summarizePhases(timing.steps),
      rest: summarizePhases(timing.steps.filter((step) => step.stage === 'rest')),
      waves: summarizePhases(timing.steps.filter((step) => step.stage === 'placement' || step.stage === 'detonation')),
      collapse: summarizePhases(timing.steps.filter((step) => step.stage === 'collapse')),
    };
    const report = {
      ...(chargeAudit ? { chargeAudit: chargeAudit() } : {}),
      energy: audit.report(),
      landings: landing.report(),
      activeBodyTrace: [5, 10, 15, 20, 25].flatMap(seconds => {
        const step = timing.steps.find(value => value.stage === 'collapse' && value.collapseTick === Math.round(seconds / sim.dt) - 1);
        return step ? [{ secondsAfterLastDetonation: seconds, tick: step.tick, active: step.counts.activeBodies,
          sleeping: step.counts.sleepingBodies, settled: step.counts.settledBodies, bearing: step.bearing }] : [];
      }),
      timings: { accounting: 'exclusive; nested phases subtracted from parents; audit sampling excluded (rawWallMs and excludedAuditMs retained); unattributed includes remaining instrumentation overhead', methods: timing.methods, summary: phaseSummary, steps: timing.steps },
      frame: frame.name,
      simulationVersion: sim.recordReplay().simulationVersion,
      rapierVersion: `${(await loadRapier()).version()} ${flavour}`,
      assetHash: manifest.assetHash,
      fragments: manifest.fragments.length,
      authoredBonds: manifest.bonds.length,
      bonds: f.bondStates.length,
      supportChunks: manifest.fragments.filter((fragment) => fragment.support ?? fragment.depth === undefined).length,
      visibleChunks: f.visibleChunks?.length ?? f.states.filter((state) => state !== FragmentState.Retired && state !== FragmentState.Hidden).length,
      mass,
      authorMs,
      createMs,
      charges: {
        protocol: `core-first-waves-${chargeProtocol}`,
        waveSize: MAX_EXPLOSIVES,
        requested: charges.length,
        placed,
        steps: waveSteps,
      },
      rest: {
        p50: pct(rest, 50),
        p95: pct(rest, 95),
        max: Math.max(...rest),
        brokenBonds: restBroken,
        converged: restConverged,
        iterations: restIterations,
      },
      collapse: {
        p50: pct(fall, 50),
        p95: pct(fall, 95),
        max: worst.ms,
        worstTick: worst.tick,
        worstPhysicsMs: worst.physics,
        worstStructuralMs: worst.structural,
        over16_7: fall.filter((t) => t > 16.7).length,
        over33: fall.filter((t) => t > 33).length,
        physicsP50: pct(physics, 50),
        structuralP50: pct(structural, 50),
        last300P50: pct(fall.slice(-300), 50),
      },
      final: {
        activeBodies: f.stats.activeBodies,
        sleepingBodies: f.stats.sleepingBodies,
        settledBodies: f.stats.settledBodies,
        solverConverged: f.stats.solverConverged,
        structuralDeferred: f.stats.structuralDeferred,
        crushedFragments: f.stats.crushedFragments,
        detachedMassFraction: detached,
        centroidDropFraction: collapse.centroidDrop,
        centroidBelowStoreyAtS: centroidBelowAt,
        centroidTrack,
        belowStoreyLiveFraction: collapse.belowStoreyLive,
        supportPath: sim.graph.supportPathStats,
        initialCentroidY: collapse.initialCentroidY,
        finalCentroidY: collapse.finalCentroidY,
        belowStoreyFraction: collapse.belowStorey,
        crushedMassFraction: collapse.crushedMass,
      },
    };
    reports.push(report);
    if (report.chargeAudit) {
      const { members, children, coreBonds, exteriorBonds, demotions, ...summary } = report.chargeAudit as Record<string, unknown>;
      console.log('  maximum-charge A6:', JSON.stringify(summary));
    }
    const over = (limit: number) => fall.filter((t) => t > limit).length;
    console.log(
      `${frame.name.padEnd(7)} ${String(frame.baysX * BAY)}x${frame.baysZ * BAY}m x${frame.storeys} | ` +
        `${String(manifest.fragments.length).padStart(5)} frags ${String(manifest.bonds.length).padStart(6)} bonds ${(mass / 1000).toFixed(0).padStart(5)} t | ` +
        `author ${ms(authorMs)} create ${ms(createMs)} ms | ` +
        `charges ${placed}/${charges.length} wave max ${ms(Math.max(...waveSteps.map((step) => step.ms)))} ms | ` +
        `rest p50 ${ms(pct(rest, 50))} max ${ms(Math.max(...rest))} broken ${restBroken} conv ${restConverged} | ` +
        `fall p50 ${ms(pct(fall, 50))} p95 ${ms(pct(fall, 95))} max ${ms(worst.ms)} @${worst.tick} (phys ${worst.physics.toFixed(1)} struct ${worst.structural.toFixed(1)}) ` +
        `>16.7 ${over(16.7)} >33 ${over(33)} | p50 phys ${pct(physics, 50).toFixed(1)} struct ${pct(structural, 50).toFixed(1)} | last 5s p50 ${ms(pct(fall.slice(-300), 50))} | drop ${(collapse.centroidDrop * 100).toFixed(0)}% centroid<storey @${centroidBelowAt === null ? 'never' : centroidBelowAt.toFixed(1) + 's'} live<storey ${(collapse.belowStoreyLive * 100).toFixed(0)}% (+dust ${(collapse.belowStorey * 100).toFixed(0)}%) dust ${(collapse.crushedMass * 100).toFixed(1)}% detached ${(detached * 100).toFixed(0)}% active ${f.stats.activeBodies} crushed ${f.stats.crushedFragments}`,
    );
    console.log(`  exclusive phases: collapse p50/p95/max ms; contribution to slowest ${phaseSummary.collapse.tail.count} collapse steps (${phaseSummary.collapse.tail.totalMs.toFixed(1)} ms total)`);
    for (const phase of PHASES) {
      const values = phaseSummary.collapse.phases[phase]!;
      console.log(`    ${phase.padEnd(19)} ${ms(values.p50)}/${ms(values.p95)}/${ms(values.max)} | tail ${values.tailMs.toFixed(1).padStart(8)} ms ${(values.tailShare * 100).toFixed(1).padStart(5)}%`);
    }
    console.log('  active bodies at5/10/15/20/25s:', report.activeBodyTrace.map(row => row.active).join('/'));
    const worstStep = phaseSummary.all.worst;
    if (worstStep) console.log(`  worst measured tick ${worstStep.tick} (${worstStep.stage}) ${worstStep.ms.toFixed(1)} ms | bonds ${worstStep.counts.bondsBefore}->${worstStep.counts.bondsAfter} bodies ${worstStep.counts.bodiesBefore}->${worstStep.counts.bodiesAfter} actors ${worstStep.counts.actorsBefore}->${worstStep.counts.actorsAfter} | ` + PHASES.map((phase) => `${phase} ${worstStep.phases[phase].toFixed(1)}`).join(' '));
    if (process.argv.includes('--assert')) {
      if (
        pct(rest, 50) >= 2 ||
        pct(fall, 95) >= 16 ||
        worst.ms >= 50 ||
        waveSteps.some((step) => step.ms >= 50) ||
        pct(fall.slice(-300), 50) >= 2
      ) {
        failures.push(
          `${frame.name} exceeds the rest/late 2 ms, collapse p95 16 ms or any collapse/wave step 50 ms budgets`,
        );
      }
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try { sim.dispose(); }
    catch (error) {
      if (!failed) throw error;
      console.error('Cleanup after the benchmark failure also failed:', error);
    }
  }
}

const wanted = process.argv.slice(2);
if (wanted.some((arg) => !arg.startsWith('--') && !FRAMES.some((frame) => frame.name === arg))) {
  throw new Error('Unknown frame; choose small, medium, large or xl');
}
const names = wanted.filter((arg) => !arg.startsWith('--'));
try {
  for (const frame of FRAMES.filter((f) =>
    names.length ? names.includes(f.name) : ['small', 'medium', 'large'].includes(f.name),
  )) {
    await run(frame);
  }
} finally {
  if (process.env.CASCADE_SCALE_REPORT) {
    writeJsonReport(process.env.CASCADE_SCALE_REPORT, reports);
  }
}
if (failures.length) {
  throw new Error(failures.join('\n'));
}
