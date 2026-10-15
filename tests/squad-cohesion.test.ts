import { expect, test } from 'vitest';
import { DEFAULT_CONFIG, DEFAULT_SKILL, type SelfState } from '@blacksite/ai-schema';
import { createScenario } from '@blacksite/ai-scenarios';
import { SquadCoordinator } from '@blacksite/ai-squad';
import { ReservationTable } from '@blacksite/ai-tactics';
import { distance, findPath, hasLineOfSight } from '@blacksite/ai-nav';
import { TacticalRuntime } from '@blacksite/ai-runtime';

const member = (id: string, x: number, z: number): SelfState => ({ id, team: 'alpha', position: { x, y: 0, z }, velocity: { x: 0, y: 0, z: 0 }, yaw: Math.PI / 2, pitch: 0, health: 100, ammo: 24, reserveAmmo: 96, reloadingUntil: 0, suppression: 0, alive: true, stance: 'stand', lastShotAt: -100, skill: { ...DEFAULT_SKILL } });

test('a lead stages before a blind second entry and commits only once a nearby buddy is ready', () => {
  const { map } = createScenario('deadlock', 5), squad = new SquadCoordinator('alpha'), reservations = new ReservationTable();
  const initial = map.spawns.alpha.map((p, i) => member(`alpha-${i + 1}`, p.x, p.z));
  squad.update(0, initial, [], map, undefined, reservations);
  const approach = [member('alpha-1', -13, .1), member('alpha-2', -17, .1), member('alpha-3', -17, -.6), member('alpha-4', -18, 1), member('alpha-5', -8, .1)];
  squad.update(100, approach, [], map, undefined, reservations);
  const isolated = [member('alpha-1', -10.9, .17), member('alpha-2', -17, .18), member('alpha-3', -16.8, -.59), member('alpha-4', -17.8, .98), member('alpha-5', -3.37, .38)];
  const plan = squad.update(150, isolated, [], map, undefined, reservations);
  expect(plan.constraints.some(value => value.startsWith('regroup:alpha-5:waiting:'))).toBe(true);
  const staging = plan.assignments.find(a => a.agentId === 'alpha-5')!;
  expect(staging.position.x).toBeLessThan(-1);
  expect(staging.position.z).toBeLessThan(1);
  expect(map.nodes.find(node => node.id === staging.slotId)?.kind).not.toBe('entry');
  const buddyId = plan.constraints.find(value => value.startsWith('entry-buddy:'))!.slice('entry-buddy:'.length);
  const regrouped = isolated.map(agent => agent.id === 'alpha-5' ? { ...agent, position: { ...staging.position } } : agent.id === buddyId ? { ...agent, position: { x: staging.position.x - 2.5, y: 0, z: staging.position.z } } : agent);
  const ready = squad.update(180, regrouped, [], map, undefined, reservations);
  expect(ready.constraints).toContain(`regroup:alpha-5:ready:${buddyId}`);
  expect(ready.kind).toBe('clear');
  expect(ready.phase).toBe('execute');
});

test.each([1, 42, 2048])('seed %i pairs entry into the next blind bend after draining the initial portal', seed => {
  const runtime = new TacticalRuntime({ ...DEFAULT_CONFIG, scenarioId: 'deadlock', seed });
  const crossed = new Set<string>(), commits: { tick: number; nearestSupportPath: number; visibleSupport: number }[] = [];
  let prior = runtime.snapshot();
  try {
    for (let tick = 1; tick <= 650 && prior.status === 'running'; tick++) {
      const next = runtime.step();
      const alpha = next.agents.filter(a => a.team === 'alpha' && a.alive);
      for (const agent of alpha) {
        if (next.tick <= 225 && agent.position.x > -12.5) crossed.add(agent.id);
        const previous = prior.agents.find(a => a.id === agent.id)!;
        if (previous.position.z <= 1.25 && agent.position.z > 1.25 && agent.position.x > .5 && agent.position.x < 2) {
          const buddies = alpha.filter(friend => friend.id !== agent.id && friend.ammo >= 3 && friend.reloadingUntil <= next.tick);
          const support = buddies.map(friend => {
            const path = findPath(runtime.map, friend.position, agent.position);
            if (!path.length) return Infinity;
            return path.reduce((total, point, index) => total + distance(index ? path[index - 1] : friend.position, point), 0);
          });
          const visibleSupport = buddies.filter(friend => hasLineOfSight(runtime.map, { ...agent.position, y: 1.4 }, { ...friend.position, y: 1.4 }))
            .reduce((closest, friend) => Math.min(closest, distance(agent.position, friend.position)), Infinity);
          commits.push({ tick, nearestSupportPath: Math.min(...support), visibleSupport });
        }
      }
      prior = next;
    }
    expect(crossed.size).toBe(5);
    expect(commits.length).toBeGreaterThan(0);
    expect(commits[0].nearestSupportPath, 'first agent crossed an occluded bend beyond immediate teammate support').toBeLessThanOrEqual(5.5);
    expect(commits[0].visibleSupport, 'a nearby buddy behind a wall cannot support the blind commitment').toBeLessThanOrEqual(4.5);
    expect(prior.metrics.fairnessViolations).toBe(0);
  } finally { runtime.dispose(); }
});

test('a blocked buddy triggers bounded regroup repair at a safe node rather than an indefinite hold', () => {
  const { map } = createScenario('deadlock', 5), squad = new SquadCoordinator('alpha'), reservations = new ReservationTable();
  squad.update(0, map.spawns.alpha.map((p, i) => member(`alpha-${i + 1}`, p.x, p.z)), [], map, undefined, reservations);
  const approach = [member('alpha-1', -13, .1), member('alpha-2', -17, .1), member('alpha-3', -17, -.6), member('alpha-4', -18, 1), member('alpha-5', -8, .1)];
  squad.update(100, approach, [], map, undefined, reservations);
  const isolated = [member('alpha-1', -10.9, .17), member('alpha-2', -17, .18), member('alpha-3', -16.8, -.59), member('alpha-4', -17.8, .98), member('alpha-5', -3.37, .38)];
  const waiting = squad.update(150, isolated, [], map, undefined, reservations);
  expect(waiting.constraints).toContain('regroup:alpha-5:waiting:alpha-1');
  const repair = squad.update(270, isolated, [], map, undefined, reservations);
  expect(repair.kind).toBe('fallback');
  expect(repair.constraints).toContain('regroup:alpha-5:replan:timeout');
  const returning = repair.assignments.find(a => a.agentId === 'alpha-5')!;
  expect(returning.position.x).toBeLessThan(isolated[4].position.x);
  expect(map.nodes.find(node => node.id === returning.slotId)?.kind).not.toBe('entry');
  const expired = squad.update(390, isolated, [], map, undefined, reservations);
  expect(expired.constraints).toContain('regroup:alpha-5:replan:partner-unreachable');
  expect(expired.constraints.some(value => value.startsWith('regroup:alpha-5:waiting'))).toBe(false);
});

test('a surviving point completes the objective commitment instead of holding the last approach slot forever', () => {
  const { map } = createScenario('casualty', 5), squad = new SquadCoordinator('alpha'), reservations = new ReservationTable();
  const survivors = [member('alpha-4', -8.4, -6.3), member('alpha-5', -3.7, -5.3)];
  squad.update(0, survivors, [], map, undefined, reservations);
  const plan = squad.update(100, survivors, [], map, undefined, reservations);
  const point = plan.assignments.find(assignment => assignment.role === 'point')!;
  expect(distance(point.position, map.objectives[0].position)).toBeLessThan(1);
});
