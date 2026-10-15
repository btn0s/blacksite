import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { TacticalRuntime } from '@blacksite/ai-runtime';
import { runCounterfactual } from '@blacksite/ai-tools';
import { DEFAULT_CONFIG, type DecisionSnapshot } from '@blacksite/ai-schema';

let snapshot: DecisionSnapshot;
if (process.argv[2]) snapshot = JSON.parse(await readFile(process.argv[2], 'utf8'));
else {
  const runtime = new TacticalRuntime(DEFAULT_CONFIG);
  try { for (let tick = 0; tick < 12; tick++) runtime.step(); snapshot = runtime.decisionSnapshot(runtime.snapshot().agents[0].id)!; }
  finally { runtime.dispose(); }
}
const comparison = runCounterfactual(snapshot, { danger: 1 });
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/decision-snapshot.json', JSON.stringify(snapshot, null, 2));
await writeFile('artifacts/counterfactual.json', JSON.stringify(comparison, null, 2));
console.log(`Recorded: ${comparison.baseline.trace.selected}; danger=1: ${comparison.alternative.trace.selected}. Same random draw: ${comparison.randomDraw}.`);
