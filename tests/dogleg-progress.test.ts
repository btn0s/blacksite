import { expect, test } from 'vitest';
import { TacticalRuntime } from '@blacksite/ai-runtime';
import { DEFAULT_CONFIG, type AgentView } from '@blacksite/ai-schema';

test.each([1, 42, 2048])('Dogleg seed %i drains the Alpha entrance instead of renewing blocked movement', seed => {
  const runtime = new TacticalRuntime({ ...DEFAULT_CONFIG, seed, scenarioId: 'deadlock', agentsPerTeam: 5 });
  const crossed = new Map<string, number>(), history = new Map<string, AgentView[]>();
  let pointId = '', pointCrossedBy = Infinity;
  try {
    pointId = runtime.snapshot().squads.find(s => s.team === 'alpha')!.assignments.find(a => a.role === 'point')!.agentId;
    for (let tick = 1; tick <= 300; tick++) {
      const snapshot = runtime.step();
      for (const agent of snapshot.agents.filter(a => a.team === 'alpha')) {
        if (agent.position.x > -12.5) { if (!crossed.has(agent.id)) crossed.set(agent.id, tick); if (agent.id === pointId) pointCrossedBy = Math.min(pointCrossedBy, tick); }
        const frames = history.get(agent.id) ?? []; frames.push(agent); if (frames.length > 120) frames.shift(); history.set(agent.id, frames);
      }
      if (snapshot.status === 'complete') break;
    }
    expect(pointCrossedBy, `${pointId} never cleared the entrance by tick240`).toBeLessThanOrEqual(240);
    expect(crossed.size, 'Every Alpha agent must pass; round completion alone is not progress').toBe(5);
    const crossingTicks = [...crossed.values()];
    expect(Math.max(...crossingTicks), 'Followers should advance behind the owner instead of restarting the approach').toBeLessThanOrEqual(225);
    expect(Math.max(...crossingTicks) - Math.min(...crossingTicks), 'The uploaded slow-queue replay spread crossing over 211 ticks').toBeLessThanOrEqual(150);
    for (const [id, frames] of history) {
      const active = frames.filter(a => a.alive && a.execution.skill === 'move' && a.destination && a.destination.x > -14 && a.fireGate === 'no-fire-intent');
      if (active.length < 90) continue; // Holding/engaging/supporting is not a blocked movement failure.
      const xs = active.map(a => a.position.x), zs = active.map(a => a.position.z);
      const span = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
      expect(span, `${id} kept trying to move but stayed inside0.4m for90+ ticks`).toBeGreaterThan(.4);
    }
  } finally { runtime.dispose(); }
});
