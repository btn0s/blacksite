import { mkdir, writeFile } from 'node:fs/promises';
import { TacticalRuntime } from '@blacksite/ai-runtime';
import { DEFAULT_CONFIG } from '@blacksite/ai-schema';

const runtime = new TacticalRuntime({ ...DEFAULT_CONFIG, agentsPerTeam: 8, maxTicks: 3600 });
try {
  const costs: number[] = [];
  let snapshot = runtime.snapshot();
  for (let i = 0; i < 900 && snapshot.status !== 'complete'; i++) {
    const start = performance.now(); snapshot = runtime.step();
    if (i >= 30) costs.push(performance.now() - start);
  }
  costs.sort((a, b) => a - b);
  const percentile = (p: number) => costs[Math.min(costs.length - 1, Math.floor(costs.length * p))] ?? 0;
  const report = { runtime: process.version, platform: process.platform, architecture: process.arch, initialAgents: 16, measuredTicks: costs.length, includesSnapshotAndTelemetry: true, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), worstMs: costs.at(-1), targetHardwareValidated: false, metrics: snapshot.metrics };
  await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/benchmark.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { runtime.dispose(); }
