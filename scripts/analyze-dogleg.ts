import { readFile } from 'node:fs/promises';
import { type AgentCommand, type ReplayFile, type SelfState, TICK_RATE } from '@blacksite/ai-schema';
import { createScenario } from '@blacksite/ai-scenarios';
import { verifyReplay } from '@blacksite/ai-runtime';
import { AuthoritativeSimulation, distance, lineClear } from '@blacksite/sim-core';

const file = process.argv[2];
if (!file) throw new Error('Usage: corepack pnpm dogleg:report -- path/to/replay.json');
const replay: ReplayFile = JSON.parse(await readFile(file, 'utf8'));
if (replay.config.scenarioId !== 'deadlock') throw new Error('This diagnostic uses Dogleg’s authored entrance and bend landmarks.');
const verification = verifyReplay(replay);
if (!verification.valid) throw new Error(`Replay failed verification: ${JSON.stringify(verification)}`);
const scenario = createScenario('deadlock', replay.config.agentsPerTeam);
const simulation = new AuthoritativeSimulation({ ...scenario, config: replay.config });
const commands = new Map<number, AgentCommand[]>();
for (const command of replay.commands) {
  const batch = commands.get(command.tick) ?? [];
  batch.push(command); commands.set(command.tick, batch);
}
const crossings = new Map<string, number>();
const deaths: { tick: number; agent: string; buddy?: string; distanceMetres: number | null; visible: boolean }[] = [];
let firstBlindEntry: { tick: number; agent: string; buddy?: string; distanceMetres: number | null; visible: boolean } | undefined;
const support = (agent: SelfState, states: SelfState[]) => {
  const buddies = states.filter(friend => friend.id !== agent.id && friend.team === agent.team && friend.alive && friend.ammo > 0)
    .sort((a, b) => distance(a.position, agent.position) - distance(b.position, agent.position));
  const buddy = buddies[0];
  return { buddy: buddy?.id, distanceMetres: buddy ? distance(buddy.position, agent.position) : null,
    visible: !!buddy && lineClear(scenario.map, { ...buddy.position, y: 1.5 }, { ...agent.position, y: 1.5 }) };
};
try {
  for (const frame of replay.checksums) {
    const previous = new Map(simulation.states.map(agent => [agent.id, agent]));
    simulation.step(commands.get(frame.tick) ?? []);
    const states = simulation.states;
    for (const agent of states.filter(agent => agent.team === 'alpha')) {
      if (!crossings.has(agent.id) && agent.position.x > -12.5) crossings.set(agent.id, frame.tick);
      const before = previous.get(agent.id)!;
      if (!firstBlindEntry && agent.alive && before.position.z <= 1.25 && agent.position.z > 1.25 && agent.position.x > .5 && agent.position.x < 2) {
        firstBlindEntry = { tick: frame.tick, agent: agent.id, ...support(agent, states) };
      }
      if (before.alive && !agent.alive) deaths.push({ tick: frame.tick, agent: agent.id, ...support(agent, states) });
    }
  }
  const ticks = [...crossings.values()];
  console.log(JSON.stringify({ versions: replay.versions, seed: replay.config.seed, verifiedTicks: verification.checkedTicks,
    finalChecksum: replay.checksums.at(-1)?.hash, alphaCrossingTicks: Object.fromEntries(crossings),
    firstToLastCrossingSeconds: ticks.length ? (Math.max(...ticks) - Math.min(...ticks)) / TICK_RATE : null,
    firstBlindEntry, alphaDeaths: deaths,
    method: 'Diagnostic debug-truth measurements from recorded commands; standing-eye buddy LOS, not a guarantee of survival or a human-likeness score.' }, null, 2));
} finally { simulation.dispose(); }
