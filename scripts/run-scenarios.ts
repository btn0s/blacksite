import { mkdir, writeFile } from 'node:fs/promises';
import { TacticalRuntime } from '@blacksite/ai-runtime';
import { DEFAULT_CONFIG } from '@blacksite/ai-schema';
import { SCENARIO_IDS } from '@blacksite/ai-worker';

const rows = [];
for (const scenarioId of SCENARIO_IDS) for (const seed of [1, 42, 2048]) {
  const runtime = new TacticalRuntime({ ...DEFAULT_CONFIG, scenarioId, seed, maxTicks: 1800 });
  try {
    let snapshot = runtime.snapshot();
    while (snapshot.status !== 'complete' && snapshot.tick < 1800) {
      snapshot = runtime.step();
      const occupied = new Set<string>();
      for (const claim of snapshot.reservations.filter(r => r.expiresAt > snapshot.tick)) {
        if (occupied.has(claim.resourceId)) throw new Error(`Duplicate reservation: ${claim.resourceId}`);
        occupied.add(claim.resourceId);
      }
      if (snapshot.metrics.fairnessViolations) throw new Error('Observation provenance invariant failed');
      for (const agent of snapshot.agents) {
        if (![agent.position.x, agent.position.z, agent.yaw, agent.health].every(Number.isFinite)) throw new Error('Non-finite authoritative state');
        if (agent.trace && agent.trace.observationProvenance.some(id => !id)) throw new Error('Missing provenance ID');
      }
    }
    rows.push({ scenario: scenarioId, seed, ticks: snapshot.tick, winner: snapshot.winner ?? 'in-progress', checksum: snapshot.checksum, decisions: snapshot.metrics.decisions, shots: snapshot.metrics.shots, p99Ms: Number(snapshot.metrics.p99.toFixed(3)), fairnessViolations: snapshot.metrics.fairnessViolations });
  } finally { runtime.dispose(); }
}
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/scenarios.json', JSON.stringify({ measuredAt: new Date().toISOString(), rows }, null, 2));
console.table(rows);
