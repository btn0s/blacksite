import { describe, expect, it } from 'vitest';
import { TacticalRuntime, verifyReplay, type TacticalAuthority } from '@blacksite/ai-runtime';
import { Buttons, DEFAULT_CONFIG, type AgentCommand, type SelfState } from '@blacksite/ai-schema';
import { createScenario } from '@blacksite/ai-scenarios';
import { AuthoritativeSimulation, hashValue, neutralCommand, normalizeCommand, ObservationGenerator } from '@blacksite/sim-core';

const config = { ...DEFAULT_CONFIG, agentsPerTeam: 2, maxTicks: 120 };
const world = { map: createScenario('crossfire', 2).map };

/** An external engine whose motion/weapons deliberately do nothing. If runtime
 * secretly applies its reference simulation, the assertions below detect it. */
class TestAuthority implements TacticalAuthority {
  tick = 0;
  status = 'running' as const;
  objective = { progress: 0, position: { ...world.map.objectives[0].position } };
  states: SelfState[];
  commands: AgentCommand[] = [];
  stepCalls = 0;
  disposeCalls = 0;
  readonly senses = new ObservationGenerator({ map: world.map, seed: config.seed, lineOfSight: () => false });
  constructor() {
    const initial = new AuthoritativeSimulation({ map: world.map, config });
    this.states = initial.states;
    initial.dispose();
  }
  generateObservations() { return this.senses.generate(this.tick, this.states); }
  observation(id: string) { return this.senses.observation(id); }
  step(input: readonly AgentCommand[]) {
    this.tick++; this.stepCalls++;
    this.commands = input.map(command => normalizeCommand(command, this.tick));
    return { commands: structuredClone(this.commands), events: [], checksum: this.checksum() };
  }
  kills() { return 0; }
  checksum() { return hashValue({ tick: this.tick, states: this.states }); }
  dispose() { this.disposeCalls++; this.senses.dispose(); }
}

describe('host engine authority boundary', () => {
  it('uses only host physics/combat, keeps human slots neutral without input and preserves bot deliberation', () => {
    const authority = new TestAuthority();
    const runtime = new TacticalRuntime(config, world, { authority, controlledAgentIds: ['alpha-1'] });
    const initial = structuredClone(authority.states);
    try {
      for (let tick = 1; tick <= 7; tick++) {
        const input = tick === 1 ? [{ ...neutralCommand(tick, 'alpha-1', 'human'), move: { x: 9, y: 0 }, buttons: Buttons.fire }] : [];
        const result = runtime.step(input);
        const human = result.agents.find(agent => agent.id === 'alpha-1')!;
        expect(human.execution.state).toBe('controlled');
        expect(human.plan).toBeUndefined();
        expect(human.trace).toBeUndefined();
        expect(runtime.decisionSnapshot('alpha-1')).toBeUndefined();
        expect(human.command).toMatchObject({ source: 'human', move: { x: tick === 1 ? 1 : 0, y: 0 }, buttons: tick === 1 ? Buttons.fire : 0 });
        expect(result.agents.find(agent => agent.id === 'bravo-1')!.plan).toBeDefined();
        expect(result.agents.every(agent => agent.beliefs.length === 0)).toBe(true);
      }
      expect(authority.stepCalls).toBe(7);
      expect(authority.states).toEqual(initial);
      expect(Object.isFrozen(authority.states[0])).toBe(false);
      authority.states[0].health = 0; authority.states[0].alive = false;
      const killed = runtime.step().agents.find(agent => agent.id === 'alpha-1')!;
      expect(killed.execution).toMatchObject({ state: 'incapacitated', interrupt: 'DIED' });
      expect(killed.command).toMatchObject({ source: 'human', buttons: 0 });
    } finally { runtime.dispose(); runtime.dispose(); }
    expect(authority.disposeCalls).toBe(1);
  });

  it('cannot take over a human slot using AI, stale or invalid input', () => {
    const authority = new TestAuthority();
    authority.states[0].stance = 'crouch';
    const runtime = new TacticalRuntime(config, world, { authority, controlledAgentIds: ['alpha-1'] });
    try {
      const ai = { ...neutralCommand(1, 'alpha-1'), move: { x: 1, y: 0 }, buttons: Buttons.fire };
      runtime.step([ai]);
      expect(authority.commands[0]).toMatchObject({ source: 'human', stance: 'crouch', move: { x: 0, y: 0 }, buttons: 0 });
      runtime.step([{ ...ai, source: 'human' }]); // stale tick 1
      expect(authority.commands[0]).toMatchObject({ source: 'human', buttons: 0 });
      runtime.step([{ ...ai, tick: 3, source: 'human', lookDelta: { yaw: NaN, pitch: 0 } }]);
      expect(authority.commands[0]).toMatchObject({ source: 'human', buttons: 0, lookDelta: { yaw: 0, pitch: 0 } });
    } finally { runtime.dispose(); }
  });

  it('rejects external replay export and non-reference simulation verification', () => {
    const authority = new TestAuthority();
    const runtime = new TacticalRuntime(config, world, { authority });
    try { expect(() => runtime.exportReplay()).toThrow('External authority'); } finally { runtime.dispose(); }
    const reference = new TacticalRuntime(config, world);
    try {
      reference.step();
      const replay = reference.exportReplay();
      expect(verifyReplay(replay)).toMatchObject({ valid: true, checkedTicks: 1 });
      replay.versions.simulation = 'rapier-shooter-1';
      expect(verifyReplay(replay)).toMatchObject({ valid: false, checkedTicks: 0, reason: expect.stringContaining('host engine verifier') });
    } finally { reference.dispose(); }
  });

  it('rejects unknown human slots before starting cognition', () => {
    const authority = new TestAuthority();
    try { expect(() => new TacticalRuntime(config, world, { authority, controlledAgentIds: ['absent'] })).toThrow('Unknown controlled agent'); }
    finally { authority.dispose(); }
  });
});
