import { describe, expect, it } from 'vitest';
import { TacticalRuntime } from '@blacksite/ai-runtime';
import { Buttons, DEFAULT_CONFIG } from '@blacksite/ai-schema';

const config = { ...DEFAULT_CONFIG, agentsPerTeam: 4, maxTicks: 900, scenarioId: 'crossfire' as const, seed: 11 };

describe('attack tokens and intent callouts', () => {
  it('never lets more AI agents per team fire in a tick than there are tokens', () => {
    const runtime = new TacticalRuntime(config, undefined, { attackTokens: { count: 1, holdTicks: 45, cooldownTicks: 20 } });
    let gated = 0;
    let firing = 0;
    try {
      for (let tick = 0; tick < 900; tick++) {
        const snapshot = runtime.step();
        for (const team of ['alpha', 'bravo'] as const) {
          const shooters = snapshot.agents.filter(agent => agent.team === team && ((agent.command?.buttons ?? 0) & Buttons.fire) !== 0);
          expect(shooters.length).toBeLessThanOrEqual(1);
          expect(runtime.attackTokenHolders(team).length).toBeLessThanOrEqual(1);
          firing += shooters.length;
        }
        gated += snapshot.agents.filter(agent => agent.fireGate === 'attack-token').length;
        if (snapshot.status === 'complete') break;
      }
    } finally { runtime.dispose(); }
    expect(firing).toBeGreaterThan(0);
    expect(gated).toBeGreaterThan(0);
  });

  it('announces intent changes and holds a new advance or flank for the lead time', () => {
    const lead = 12;
    const runtime = new TacticalRuntime(config, undefined, { intents: { leadTicks: lead } });
    const announced = new Map<string, number>();
    const seen = new Set<string>();
    try {
      for (let tick = 0; tick < 300; tick++) {
        const snapshot = runtime.step();
        for (const event of snapshot.events) {
          if (event.type !== 'intent' || seen.has(event.id)) continue;
          seen.add(event.id);
          if (event.text === 'advance' || event.text === 'flank') announced.set(event.agentId!, event.tick);
        }
        for (const agent of snapshot.agents) {
          const at = announced.get(agent.id);
          if (at !== undefined && snapshot.tick - at < lead) expect(agent.command?.move).toEqual({ x: 0, y: 0 });
        }
      }
    } finally { runtime.dispose(); }
    expect([...seen].length).toBeGreaterThan(0);
    expect(announced.size).toBeGreaterThan(0);
  });

  it('rejects invalid rules', () => {
    expect(() => new TacticalRuntime(config, undefined, { attackTokens: { count: -1, holdTicks: 1, cooldownTicks: 1 } })).toThrow('attack token');
    expect(() => new TacticalRuntime(config, undefined, { intents: { leadTicks: 1.5 } })).toThrow('intent');
  });
});
