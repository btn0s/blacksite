import { describe, expect, it } from 'vitest';
import { AGENT_RADIUS, Buttons, DEFAULT_CONFIG, type AgentCommand, type RuntimeConfig, type TacticalMap } from '@blacksite/ai-schema';
import { AuthoritativeSimulation, distance, insideObstacle, lineClear, neutralCommand, normalizeCommand } from '@blacksite/sim-core';
import { findPath, isWalkable, navigationClearance, tacticalPathCosts } from '@blacksite/ai-nav';
import { TacticalRuntime, verifyReplay } from '@blacksite/ai-runtime';
import { createScenario, SCENARIOS } from '@blacksite/ai-scenarios';
import { commandStreamDigest } from '@blacksite/ai-telemetry';
import { pruneEvidenceLedger } from '../packages/ai-runtime/src/evidence';

const config = (overrides: Partial<RuntimeConfig> = {}): RuntimeConfig => ({ ...DEFAULT_CONFIG, maxTicks: 150, agentsPerTeam: 2, ...overrides });
function arena(): TacticalMap {
  const map = createScenario('crossfire', 1).map;
  return { ...map, obstacles: [], spawns: { alpha: [{ x: -5, y: 0, z: 0 }], bravo: [{ x: 5, y: 0, z: 0 }] }, objectives: [{ id: 'relay', position: { x: 0, y: 0, z: 12 }, regionId: 'south' }] };
}

describe('deterministic authority and command parity', () => {
  it('same seed reproduces AI command streams and simulation hashes', () => {
    const a = new TacticalRuntime(config({ maxTicks: 900 })), b = new TacticalRuntime(config({ maxTicks: 900 }));
    try {
      for (let tick = 0; tick < 600; tick++) expect(a.step().checksum).toBe(b.step().checksum);
      const replayA = a.exportReplay(), replayB = b.exportReplay();
      expect(commandStreamDigest(replayA.commands)).toBe(commandStreamDigest(replayB.commands));
      expect(verifyReplay(replayA)).toEqual({ valid: true, checkedTicks: a.snapshot().tick });
      expect(a.snapshot().metrics.fairnessViolations).toBe(0);
      expect(a.snapshot().metrics.shots).toBeGreaterThan(0);
      for (const agent of a.snapshot().agents.filter(agent => !agent.alive)) {
        expect(agent.execution.state).toBe('incapacitated');
        expect(a.snapshot().reservations.some(claim => claim.ownerId === agent.id)).toBe(false);
      }
    } finally { a.dispose(); b.dispose(); }
  });

  it('uses identical weapons and movement for human and AI commands', () => {
    const a = new AuthoritativeSimulation({ map: arena(), config: config() });
    const b = new AuthoritativeSimulation({ map: arena(), config: config() });
    try {
      for (let tick = 1; tick <= 14; tick++) {
        const command = { ...neutralCommand(tick, 'alpha-1'), buttons: Buttons.fire };
        expect(a.step([command]).checksum).toBe(b.step([{ ...command, source: 'human' }]).checksum);
      }
      expect(a.states.find(state => state.id === 'bravo-1')?.health).toBe(0);
      expect(a.states.find(state => state.id === 'alpha-1')?.ammo).toBe(20);
    } finally { a.dispose(); b.dispose(); }
  });

  it('enforces collision, finite input, reload duration and fixed fire cadence', () => {
    const map = arena(); map.obstacles.push({ id: 'wall', x: -2, z: 0, width: 1, depth: 6, height: 3 });
    const sim = new AuthoritativeSimulation({ map, config: config(), initialAmmo: 1 });
    try {
      const malformed: AgentCommand = { ...neutralCommand(1, 'alpha-1'), move: { x: NaN, y: Infinity }, buttons: Buttons.fire };
      expect(normalizeCommand(malformed, 1).buttons).toBe(0);
      sim.step([malformed]);
      for (let tick = 2; tick <= 60; tick++) {
        const result = sim.step([{ ...neutralCommand(tick, 'alpha-1'), move: { x: 10, y: 0 }, buttons: tick === 2 ? Buttons.fire : Buttons.reload }]);
        expect(result.commands[0].move.x).toBeLessThanOrEqual(1);
        expect(insideObstacle(map, sim.states[0].position)).toBe(false);
      }
      expect(sim.states[0].position.x).toBeLessThanOrEqual(-2.84);
      expect(sim.states[0].ammo).toBe(0);
      for (let tick = 61; tick <= 66; tick++) sim.step([]);
      expect(sim.states[0].ammo).toBe(24);
      expect(sim.states[0].reserveAmmo).toBe(72);
    } finally { sim.dispose(); }
  });

  it('rejects a replay when an authoritative command is modified', () => {
    const runtime = new TacticalRuntime(config({ agentsPerTeam: 1, maxTicks: 12 }));
    try {
      for (let tick = 0; tick < 12; tick++) runtime.step();
      const replay = runtime.exportReplay();
      replay.commands[0].lookDelta.yaw += .2;
      const result = verifyReplay(replay);
      expect(result.valid).toBe(false);
      expect(result.mismatchTick).toBe(1);
    } finally { runtime.dispose(); }
  });

  it('recovers the replay’s physics-legal doorway margin through ordinary human and AI commands', () => {
    const map = createScenario('deadlock', 1).map;
    // Exact Alpha1 position at tick291 of the reported seed2048 doorway deadlock.
    const start = { x: -15.387849, y: 0, z: -.250774 };
    const destination = { x: -14, y: 0, z: 0 };
    map.spawns.alpha = [start];
    expect(insideObstacle(map, start, AGENT_RADIUS)).toBe(false);
    expect(isWalkable(map, start, .4)).toBe(false);
    const path = findPath(map, start, destination);
    expect(path.length).toBeGreaterThan(0);
    expect(isWalkable(map, path[0], .4)).toBe(true);
    expect(distance(start, path[0])).toBeLessThan(.2);
    expect(Number.isFinite(tacticalPathCosts(map, start).get('anchor:narrow-portal'))).toBe(true);
    const insideWall = { x: -14, y: 0, z: -.6 };
    expect(navigationClearance(map, insideWall)).toBe(.4);
    expect(findPath(map, insideWall, destination)).toEqual([]);
    let previous = start;
    for (const waypoint of path) {
      expect(lineClear(map, previous, waypoint, AGENT_RADIUS)).toBe(true);
      previous = waypoint;
    }
    const human = new AuthoritativeSimulation({ map, config: config() });
    const ai = new AuthoritativeSimulation({ map, config: config() });
    try {
      let waypointIndex = 0;
      for (let tick = 1; tick <= 90; tick++) {
        const self = human.states[0];
        while (waypointIndex < path.length - 1 && distance(self.position, path[waypointIndex]) < .08) waypointIndex++;
        const waypoint = path[waypointIndex], remaining = distance(self.position, waypoint);
        if (waypointIndex === path.length - 1 && remaining < .1) break;
        const speed = Math.min(.8, remaining * 3);
        const command = { ...neutralCommand(tick, self.id, 'human'), move: { x: (waypoint.x - self.position.x) / remaining * speed, y: (waypoint.z - self.position.z) / remaining * speed } };
        expect(human.step([command]).checksum).toBe(ai.step([{ ...command, source: 'ai' }]).checksum);
        expect(insideObstacle(map, human.states[0].position, AGENT_RADIUS)).toBe(false);
        expect(distance(human.states[0].position, human.states[1].position)).toBeGreaterThan(AGENT_RADIUS * 2);
      }
      expect(distance(human.states[0].position, destination)).toBeLessThan(.15);
      expect(isWalkable(map, human.states[0].position, .4)).toBe(true);
    } finally { human.dispose(); ai.dispose(); }
  });
});

describe('observation authority', () => {
  it('retains previously authorized roots while live beliefs reference them, without authorizing invented IDs', () => {
    const evidence = new Map([['vision:40:alpha-6:bravo-1', 490], ['unreferenced', 490]]);
    pruneEvidenceLedger(evidence, 701, ['vision:40:alpha-6:bravo-1', 'invented']);
    expect(evidence.has('vision:40:alpha-6:bravo-1')).toBe(true);
    expect(evidence.has('unreferenced')).toBe(false);
    expect(evidence.has('invented')).toBe(false);
    pruneEvidenceLedger(evidence, 702, []);
    expect(evidence.size).toBe(0);
  });

  it('keeps provenance valid through 1200 ticks with 16 agents and aging combat memories', () => {
    const runtime = new TacticalRuntime(config({ agentsPerTeam: 8, seed: 2048, maxTicks: 1200 }));
    try {
      let snapshot = runtime.snapshot();
      // Establish real vision, sound and radio evidence, then hold positions with
      // ordinary player inputs so the match exercises retention beyond 600 ticks.
      while (snapshot.metrics.shots === 0 && snapshot.tick < 600 && snapshot.status === 'running') snapshot = runtime.step();
      expect(snapshot.metrics.shots).toBeGreaterThan(0);
      expect(snapshot.agents.some(agent => agent.beliefs.length > 0)).toBe(true);
      while (snapshot.status === 'running') {
        snapshot = runtime.step(snapshot.agents.map(agent => ({ ...neutralCommand(snapshot.tick + 1, agent.id, 'human'), stance: agent.stance })));
      }
      expect(snapshot.tick).toBe(1200);
      expect(snapshot.metrics.fairnessViolations).toBe(0);
      expect(verifyReplay(runtime.exportReplay())).toEqual({ valid: true, checkedTicks: 1200 });
    } finally { runtime.dispose(); }
  }, 30_000);

  it('does not reveal occluded agents, recognizes over time, and is idempotent per tick', () => {
    const hidden = arena(); hidden.obstacles.push({ id: 'screen', x: 0, z: 0, width: 1, depth: 8, height: 3 });
    const blocked = new AuthoritativeSimulation({ map: hidden, config: config() });
    const clear = new AuthoritativeSimulation({ map: arena(), config: config() });
    try {
      expect(blocked.generateObservations().get('alpha-1')).toEqual([]);
      const first = clear.generateObservations();
      expect(first.get('alpha-1')).toEqual([]);
      expect(clear.generateObservations()).toEqual(first);
      for (let tick = 1; tick <= 6; tick++) { blocked.step([]); clear.step([]); blocked.generateObservations(); clear.generateObservations(); }
      expect(blocked.generateObservations().get('alpha-1')).toEqual([]);
      const contact = clear.generateObservations().get('alpha-1')?.find(observation => observation.classification === 'enemy');
      expect(contact?.subjectId).toBe('bravo-1');
      expect(contact?.confidence).toBeGreaterThan(.63);
      expect(contact?.uncertainty).toBeGreaterThan(0);
      expect(contact?.position).not.toEqual(clear.states[1].position);
    } finally { blocked.dispose(); clear.dispose(); }
  });

  it('sound gives uncertain direction without leaking hidden identity or exact position', () => {
    const map = arena(); map.obstacles.push({ id: 'screen', x: 0, z: 0, width: 1, depth: 8, height: 3 });
    const sim = new AuthoritativeSimulation({ map, config: config() });
    try {
      sim.step([{ ...neutralCommand(1, 'bravo-1'), buttons: Buttons.fire }]);
      const sound = sim.generateObservations().get('alpha-1')?.find(observation => observation.source === 'sound');
      expect(sound).toBeDefined();
      expect(sound?.subjectId).toBeUndefined();
      expect(sound?.classification).toBe('unknown');
      expect(sound?.uncertainty).toBeGreaterThan(2);
      expect(sound?.position).not.toEqual(sim.states[1].position);
    } finally { sim.dispose(); }
  });

  it('exports immutable decision snapshots without enemy authoritative components', () => {
    const runtime = new TacticalRuntime(config());
    try {
      runtime.step();
      const snapshot = runtime.decisionSnapshot('alpha-1')!;
      expect(snapshot.friends.every(friend => friend.team === 'alpha')).toBe(true);
      expect(snapshot.beliefs).toEqual([]);
      snapshot.self.position.x = 999;
      expect(runtime.decisionSnapshot('alpha-1')?.self.position.x).not.toBe(999);
      const clone = structuredClone(runtime.snapshot());
      expect(clone.checksum).toBe(runtime.snapshot().checksum);
    } finally { runtime.dispose(); }
    expect(() => runtime.step()).toThrow('disposed');
  });
});

describe('scenario geometry', () => {
  it.each(SCENARIOS)('$id has legal spawns, connected objective, and unique node IDs', scenario => {
    const { map } = createScenario(scenario.id, 8);
    for (const spawn of [...map.spawns.alpha, ...map.spawns.bravo]) expect(insideObstacle(map, spawn)).toBe(false);
    expect(new Set(map.nodes.map(node => node.id)).size).toBe(map.nodes.length);
    const objective = map.nodes.find(node => node.kind === 'objective');
    expect(objective).toBeDefined();
    expect(objective!.neighbors.length).toBeGreaterThan(0);
    const ids = new Set(map.nodes.map(node => node.id));
    for (const node of map.nodes) expect(node.neighbors.every(id => ids.has(id))).toBe(true);
  });
});
