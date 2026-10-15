import { mkdir, writeFile } from 'node:fs/promises';
import { createScenario } from '@blacksite/ai-scenarios';
import { hasLineOfSight, distance } from '@blacksite/ai-nav';
import type { ScenarioId } from '@blacksite/ai-schema';
import { SCENARIO_IDS } from '@blacksite/ai-worker';

const scenario = (process.argv[2] ?? 'crossfire') as ScenarioId;
if (!SCENARIO_IDS.includes(scenario)) throw new Error(`Unknown scenario: ${scenario}`);
const { map } = createScenario(scenario);
const annotated = {
  map,
  bakerVersion: 'tactical-visibility-1',
  annotations: map.nodes.map(node => ({
    nodeId: node.id,
    visibleNodes: map.nodes.filter(other => other.id !== node.id && hasLineOfSight(map, node.position, other.position)).map(other => other.id),
    edges: node.neighbors.map(id => { const other = map.nodes.find(n => n.id === id)!; return { to: id, distance: distance(node.position, other.position), travelTicks: Math.ceil(distance(node.position, other.position) / 3 * 30) }; }),
    objectiveDistances: Object.fromEntries(map.objectives.map(objective => [objective.id, distance(node.position, objective.position)])),
    confidence: 1,
  })),
  designerOverrides: [],
  limitations: ['Planar authored obstacle graph; not a general polygon navmesh or acoustic portal baker.'],
};
await mkdir('artifacts', { recursive: true });
await writeFile(`artifacts/${scenario}.map.json`, JSON.stringify(annotated, null, 2));
console.log(`Baked ${map.nodes.length} tactical nodes to artifacts/${scenario}.map.json`);
