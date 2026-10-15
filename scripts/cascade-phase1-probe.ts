/**
 * Cheap headless probe for the Phase 1 real-time work: the large frame at 30 Hz, the same Demolish
 * charge waves as cascade-worker.html, then 25 s of collapse. Prints ms per step p50/p95, awake body
 * count and loose piece count at 5 s intervals, and the budget fields when the engine reports them.
 * Usage: tsx scripts/cascade-phase1-probe.ts [--cell=2] [--seconds=25]
 */
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import {
  createDestructibleBoxes,
  DestructionSimulation,
  MAX_EXPLOSIVES,
  type DestructionCommand,
  type Vec3,
} from '../packages/cascade/src/index';
import {
  SCALE_BAY as BAY,
  SCALE_CELL,
  SCALE_FRAMES,
  scaleFrameBoxes,
} from '../packages/destruction-testkit/src/scale-frame';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const cell = Number(arg('cell') ?? SCALE_CELL);
const seconds = Number(arg('seconds') ?? 25);
const frame = SCALE_FRAMES.find((f) => f.name === 'large')!;
const { manifest } = createDestructibleBoxes(scaleFrameBoxes(frame), {
  id: frame.name,
  cellSize: cell,
  maxFragments: 10_000,
});
const sim = await DestructionSimulation.create(manifest, { timestep: 1 / 30 });
const pct = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
};
if (process.argv.includes('--nobudget')) sim.budgetEnabled = false;
if (arg('iters')) sim.world.integrationParameters.numSolverIterations = Number(arg('iters'));
if (arg('pgs')) sim.world.integrationParameters.numInternalPgsIterations = Number(arg('pgs'));
if (process.argv.includes('--noccd')) {
  const t = sim as any;
  const create = t.createRigidBody.bind(t);
  t.createRigidBody = (desc: any) => create(desc.setCcdEnabled(false));
  for (const b of t.ownedBodies.values()) b.enableCcd(false);
}
let f = sim.frame();
for (let i = 0; i < 90; i++) f = sim.step();
let id = 1;
const command = (type: DestructionCommand['type'], position: Vec3, radius: number, strength: number): DestructionCommand => ({
  type, id: id++, tick: f.tick + 1, source: 1, position, direction: [0, 0, 1], radius, strength,
});
const x0 = (-frame.baysX * BAY) / 2, z0 = (-frame.baysZ * BAY) / 2;
const charges: Vec3[] = [];
for (let ix = 0; ix <= frame.baysX; ix++)
  for (let iz = 0; iz <= frame.baysZ; iz++) charges.push([x0 + ix * BAY, 1, z0 + iz * BAY]);
for (let t = 0.75; t < BAY; t += 1.5)
  charges.push([x0 + t, 1, z0], [x0 + t, 1, z0 + BAY], [x0, 1, z0 + t], [x0 + BAY, 1, z0 + t]);
charges.reverse();
const all: number[] = [];
const rungTicks: number[] = [];
const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const cpuAll: number[] = [];
const step = () => {
  const s = performance.now();
  const c = cpuMs();
  f = sim.step();
  const took = performance.now() - s;
  cpuAll.push(cpuMs() - c);
  all.push(took);
  sim.noteStepCost(took);
  const rung = (f.stats as any).budgetRung ?? 0;
  rungTicks[rung] = (rungTicks[rung] ?? 0) + 1;
  return took;
};
// The demo waits 250 ms (real time) between placement and detonation; 8 ticks at 30 Hz.
for (let offset = 0; offset < charges.length; offset += MAX_EXPLOSIVES) {
  for (const p of charges.slice(offset, offset + MAX_EXPLOSIVES)) sim.enqueue(command('placeExplosive', p, 1.5, 2));
  for (let i = 0; i < 8; i++) step();
  sim.enqueue(command('detonate', [0, 0, 0], 1, 1));
  for (let i = 0; i < 8; i++) step();
}
const hz = 30;
const prof: Record<string, number> = {};
if (process.argv.includes('--profile')) {
  const target = sim as any;
  for (const name of ['prepareStep', 'frame', 'updateTransformsAndSettlement', 'collectStructuralLoads', 'collectCascades', 'refreshGeometryVersion', 'secondaryFrame']) {
    const original = target[name].bind(target);
    target[name] = (...args: unknown[]) => { const t = performance.now(); const r = original(...args); prof[name] = (prof[name] ?? 0) + performance.now() - t; return r; };
  }
  const step = target.world.step.bind(target.world);
  target.world.step = (...args: unknown[]) => { const t = performance.now(); const r = step(...args); prof.worldStep = (prof.worldStep ?? 0) + performance.now() - t; return r; };
}
const wakes: Record<string, number> = {};
if (process.argv.includes('--wake')) {
  const target = sim as any;
  for (const name of ['wakeIsland', 'wakeChild', 'bakeBody', 'wakeSupportContacts', 'releaseDependents', 'checkSupport']) {
    const original = target[name].bind(target);
    target[name] = (...args: unknown[]) => { wakes[name] = (wakes[name] ?? 0) + 1; return original(...args); };
  }
  const rel = target.releaseDependents.bind(target);
  target.releaseDependents = (...args: unknown[]) => { const caller = new Error().stack!.split('\n')[2]!.trim().split(' ')[1]!; wakes['rel:' + caller] = (wakes['rel:' + caller] ?? 0) + 1; return rel(...args); };
  const apply = target.applyImpulses.bind(target);
  target.applyImpulses = (...args: unknown[]) => { wakes.applyImpulses = (wakes.applyImpulses ?? 0) + 1; return apply(...args); };
}
const lastWake = new Map<number, { tick: number; caller: string }>();
if (process.argv.includes('--fast')) {
  const target = sim as any;
  for (const name of ['wakeIsland', 'wakeChild']) {
    const original = target[name].bind(target);
    target[name] = (item: any) => {
      const caller = new Error().stack!.split('\n')[2]!.trim().split(' ')[1]!;
      if (item.baked) lastWake.set(item.body.handle, { tick: sim.tick, caller });
      return original(item);
    };
  }
}
if (process.argv.includes('--exposed')) {
  const target = sim as any;
  const original = target.isExposed.bind(target);
  let yes = 0, no = 0;
  target.isExposed = (index: number) => { const r = original(index); if (r) yes++; else no++; return r; };
  const fs = target.fractureSecondary.bind(target);
  target.fractureSecondary = (c: any[]) => { const before = target.secondary.length; fs(c); if (c.length) console.log(`   tick ${sim.tick} rung ${target.budget.rung} candidates ${c.length} -> pieces ${before}->${target.secondary.length} exposed yes/no ${yes}/${no} deferred ${target.budgetDeferred}`); };
}
const quant = (a: number[], q: number) => [...a].sort((x, y) => x - y)[Math.floor(q * (a.length - 1))]?.toFixed(3);
function diagnose() {
  const s = sim as any;
  if (process.argv.includes('--fast')) {
    const bodies = [...s.islands.values(), ...s.secondary.filter((c: any) => c.attachedRoot === undefined)].filter((i: any) => !i.baked && !i.body.isSleeping() && !i.body.isFixed());
    const fast = bodies.filter((i: any) => { const v = i.body.linvel(); return Math.hypot(v.x, v.y, v.z) > 5; });
    const by: Record<string, number> = {};
    for (const b of fast) { const w = lastWake.get(b.body.handle); const key = w ? `${w.caller} ${sim.tick - w.tick < 10 ? 'recent' : 'old'}` : 'never-woken'; by[key] = (by[key] ?? 0) + 1; }
    console.log(`    fast(>5 m/s) ${fast.length}/${bodies.length}:`, JSON.stringify(by));
  }
  const awakeIslands = [...s.islands.values()].filter((i: any) => !i.baked && !i.body.isFixed() && !i.body.isSleeping());
  const awakeLoose = (s.secondary as any[]).filter((c) => c.attachedRoot === undefined && !c.baked && !c.body.isSleeping());
  const speed = (b: any) => { const v = b.body.linvel(); return Math.hypot(v.x, v.y, v.z); };
  const spin = (b: any) => { const v = b.body.angvel(); return Math.hypot(v.x, v.y, v.z); };
  const row = (name: string, bodies: any[]) =>
    console.log(`    ${name}: ${bodies.length} awake; lin p50/p90/max ${quant(bodies.map(speed), 0.5)}/${quant(bodies.map(speed), 0.9)}/${quant(bodies.map(speed), 1)} ang p50/p90 ${quant(bodies.map(spin), 0.5)}/${quant(bodies.map(spin), 0.9)} stable p50/p90 ${quant(bodies.map((b: any) => b.stableTicks ?? 0), 0.5)}/${quant(bodies.map((b: any) => b.stableTicks ?? 0), 0.9)} y p10/p50/p90 ${quant(bodies.map((b: any) => b.body.translation().y), 0.1)}/${quant(bodies.map((b: any) => b.body.translation().y), 0.5)}/${quant(bodies.map((b: any) => b.body.translation().y), 0.9)}`);
  row(`islands (members p50 ${quant(awakeIslands.map((i: any) => i.members.length), 0.5)} max ${quant(awakeIslands.map((i: any) => i.members.length), 1)})`, awakeIslands);
  row('loose', awakeLoose);
  console.log(`    total islands ${s.islands.size} baked ${[...s.islands.values()].filter((i: any) => i.baked).length}; secondary ${s.secondary.length} baked ${s.secondary.filter((c: any) => c.baked).length}; dynamic ${s.dynamicBodyCount()}`);
}
const rows: string[] = [];
let window: number[] = [];
const startAt = all.length;
for (let i = 1; i <= seconds * hz; i++) {
  window.push(step());
  if (process.argv.includes('--fine') && i <= 12 * hz && i % hz === 0) {
    const st = f.stats as any;
    console.log(`  ${i / hz}s step ${window.slice(-hz).reduce((a, b) => a + b, 0) / hz | 0} ms avg | awake ${st.activeBodies} settled ${st.settledBodies} rung ${st.budgetRung} baked/tick ${st.budgetBaked} pieces ${st.secondaryFragments} mean-y ${(() => { let m = 0, n = 0; for (let k = 0; k < manifest.fragments.length; k++) if (f.states[k] !== 4) { m += f.transforms[k * 8 + 1]!; n++; } return (m / n).toFixed(1); })()}`);
  }
  if (i % (5 * hz) === 0) {
    const st = f.stats as unknown as Record<string, number | string | undefined>;
    const pieces = f.secondary?.fragments.length ?? 0;
    rows.push(
      `t=${String(i / hz).padStart(2)}s step p50 ${pct(window, 50).toFixed(1)} p95 ${pct(window, 95).toFixed(1)} max ${Math.max(...window).toFixed(1)} | awake ${st.activeBodies} asleep ${st.sleepingBodies} settled ${st.settledBodies} | pieces ${pieces} | rung ${st.budgetRung} cost ${Number(st.budgetStepMs).toFixed(0)} baked ${st.budgetBakedTotal} deferred ${st.budgetDeferred} | debris ${st.debrisLive}/${st.debrisCap} sunk ${st.debrisSunk}`,
    );
    window = [];
    if (process.argv.includes('--diag')) diagnose();
    if (process.argv.includes('--debris')) {
      const loose = ((sim as any).secondary as any[]).filter((c) => c.attachedRoot === undefined);
      const vol = (c: any) => c.fragment.shape?.volume ?? c.fragment.size[0] * c.fragment.size[1] * c.fragment.size[2];
      const bins = [0.005, 0.02, 0.05, 0.1, 0.3, 1.01];
      const hist = bins.map((b, i) => loose.filter((c) => vol(c) < b && vol(c) >= (bins[i - 1] ?? 0)).length);
      console.log(`    loose ${loose.length} by volume <${bins.join(' <')}: ${hist.join(' ')} sinking ${loose.filter((c) => c.sink).length} sunk ${(f.stats as any).debrisSunk}`);
    }
    if (process.argv.includes('--wake')) { console.log('    calls:', JSON.stringify(wakes)); for (const k of Object.keys(wakes)) wakes[k] = 0; }
    if (process.argv.includes('--profile')) {
      console.log('    profile ms/step:', Object.entries(prof).map(([k, v]) => `${k} ${(v / (5 * hz)).toFixed(1)}`).join(' '));
      for (const k of Object.keys(prof)) prof[k] = 0;
    }
  }
}
console.log('ticks at rung 0..4 (collapse phase, 30 ticks = 1 s):', [0, 1, 2, 3, 4].map((r) => ((rungTicks[r] ?? 0) / hz).toFixed(1) + 's').join(' '));
const collapse = all.slice(startAt, startAt + 15 * hz);
console.log(rows.join('\n'));
const cpuCollapse = cpuAll.slice(startAt, startAt + 15 * hz);
console.log(
  `cell ${cell} collapse(first 15s) cpu p50 ${pct(cpuCollapse, 50).toFixed(1)} p95 ${pct(cpuCollapse, 95).toFixed(1)} | wall p50 ${pct(collapse, 50).toFixed(1)} p95 ${pct(collapse, 95).toFixed(1)} ms/step | load ${os.loadavg().map((v) => v.toFixed(1)).join(' ')}`,
);
{
  const s = sim as any;
  const floating: number[] = [];
  let total = 0;
  for (const island of s.islands.values()) {
    if (!island.baked || island.members.length > 8) continue;
    total++;
    if (!s.grounded(island.body, island.colliders)) floating.push(island.body.translation().y);
  }
  for (const child of s.secondary) {
    if (child.attachedRoot !== undefined || !child.baked || child.sink) continue;
    total++;
    if (!s.grounded(child.body, [child.collider])) floating.push(child.body.translation().y);
  }
  let mass = 0, my = 0, below = 0;
  manifest.fragments.forEach((fr, i) => {
    if (f.states[i] === 4) return;
    const y = f.transforms[i * 8 + 1]!;
    mass += fr.mass; my += fr.mass * y; if (y < 3.5) below += fr.mass;
  });
  console.log(`end: baked rubble ${total}, not resting ${floating.length} (heights p50 ${quant(floating, 0.5)} max ${quant(floating, 1)}); live primary mass centroid ${(my / mass).toFixed(1)} m, ${(100 * below / mass).toFixed(0)}% below 3.5 m`);
}
sim.dispose();
