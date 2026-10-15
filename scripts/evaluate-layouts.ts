import { mkdir, writeFile } from 'node:fs/promises';
import { TacticalRuntime } from '@blacksite/ai-runtime';
import { DEFAULT_CONFIG, type Vec3 } from '@blacksite/ai-schema';
import { SCENARIO_IDS } from '@blacksite/ai-worker';
import { hasLineOfSight, distance } from '@blacksite/ai-nav';

const label = process.argv[2] ?? 'current';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Use a simple report label');
const percentile = (values: number[], p: number) => { const sorted = [...values].sort((a,b) => a-b); return sorted[Math.min(sorted.length-1, Math.floor(sorted.length*p))] ?? 0; };
const rows = [];
for (const scenarioId of SCENARIO_IDS) {
  const runtime = new TacticalRuntime({ ...DEFAULT_CONFIG, scenarioId, maxTicks: 1800 });
  try {
    const { map } = runtime;
    const visibility: number[] = [];
    const eye = (point: Vec3) => ({ ...point, y: 1.5 });
    for (let i = 0; i < map.nodes.length; i++) for (let j = i+1; j < map.nodes.length; j++) {
      if (hasLineOfSight(map, eye(map.nodes[i].position), eye(map.nodes[j].position))) visibility.push(distance(map.nodes[i].position, map.nodes[j].position));
    }
    const seenEvents = new Set<string>(), shotDistances: number[] = [], engagementDistances: number[] = [];
    const longEngagements: { tick: number; agent: string; distance: number; from: Vec3; target: Vec3 }[] = [];
    let firstContactTick: number | null = null, firstShotTick: number | null = null, kills = 0;
    let diagonalLongShots = 0;
    let snapshot = runtime.snapshot();
    while (snapshot.status !== 'complete') {
      snapshot = runtime.step();
      if (firstContactTick === null && snapshot.agents.some(agent => agent.beliefs.some(track => track.classification === 'enemy' && track.confidence > .55))) firstContactTick = snapshot.tick;
      for (const event of snapshot.events) {
        if (seenEvents.has(event.id)) continue; seenEvents.add(event.id);
        if (event.type === 'kill') kills++;
        if (event.type === 'shot' && event.position && event.endPosition) {
          firstShotTick ??= event.tick;
          const length = distance(event.position, event.endPosition); shotDistances.push(length);
          const shooter = snapshot.agents.find(agent => agent.id === event.agentId);
          if (shooter) {
            const length = distance(shooter.position, shooter.attention); engagementDistances.push(length);
            if (length > 18) longEngagements.push({ tick: snapshot.tick, agent: shooter.id, distance: length, from: { ...shooter.position }, target: { ...shooter.attention } });
          }
          const angle = Math.atan2(Math.abs(event.position.z - event.endPosition.z), Math.abs(event.position.x - event.endPosition.x));
          if (length > 18 && Math.abs(angle - Math.PI / 4) < Math.PI / 9) diagonalLongShots++;
        }
      }
    }
    rows.push({ scenario: scenarioId, mapVersion: map.version, nodes: map.nodes.length, obstacles: map.obstacles.length,
      visiblePairFraction: visibility.length / Math.max(1, map.nodes.length * (map.nodes.length - 1) / 2),
      visibilityP90: percentile(visibility, .9), visibilityMax: Math.max(0, ...visibility),
      firstContactTick, firstShotTick, roundTicks: snapshot.tick, winner: snapshot.winner,
      shots: shotDistances.length, shotDistanceMedian: percentile(shotDistances, .5), shotDistanceP90: percentile(shotDistances, .9),
      engagementDistanceMedian: percentile(engagementDistances, .5), engagementDistanceP90: percentile(engagementDistances, .9), engagementsOver18m: engagementDistances.filter(value => value > 18).length,
      longestEngagementSamples: longEngagements.sort((a,b) => b.distance-a.distance).slice(0, 6),
      shotsOver18m: shotDistances.filter(value => value > 18).length, diagonalLongShots, kills });
  } finally { runtime.dispose(); }
}
await mkdir('artifacts', { recursive: true });
await writeFile(`artifacts/layouts-${label}.json`, JSON.stringify({ seed: DEFAULT_CONFIG.seed, maxTicks: 1800, notes: 'Engagement distance uses the shooter’s motor attention point when firing; tracer travel is recorded separately. One seed for layout diagnosis, not human-likeness evidence.', rows }, null, 2));
console.table(rows.map(({scenario, firstContactTick, firstShotTick, roundTicks, engagementDistanceMedian, engagementDistanceP90, engagementsOver18m, visibilityP90}) => ({ scenario, firstContactTick, firstShotTick, roundTicks, medianEngagementM: +engagementDistanceMedian.toFixed(1), p90EngagementM: +engagementDistanceP90.toFixed(1), engagementsOver18m, p90VisibleM: +visibilityP90.toFixed(1) })));
