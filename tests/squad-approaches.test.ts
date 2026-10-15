import { describe, expect, test } from 'vitest';
import { createScenario } from '@blacksite/ai-scenarios';
import { selectApproachRoutes, SquadCoordinator } from '@blacksite/ai-squad';
import { ReservationTable } from '@blacksite/ai-tactics';
import { BeliefStore } from '@blacksite/ai-belief';
import { findPath } from '@blacksite/ai-nav';
import { DEFAULT_SKILL, type ScenarioId, type SelfState, type TacticalMap, type TeamId } from '@blacksite/ai-schema';

function squad(map: TacticalMap, team: TeamId): SelfState[] {
  return map.spawns[team].map((position, i) => ({ id: `${team}-${i}`, team, position: { ...position }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, health: 100, ammo: 24, reserveAmmo: 60, reloadingUntil: 0, suppression: 0, alive: true, stance: 'stand', lastShotAt: -100, skill: { ...DEFAULT_SKILL } }));
}

const scenarios: ScenarioId[] = ['crossfire', 'breach', 'search', 'casualty', 'low-ammo', 'deadlock'];
describe('authored map approaches', () => {
  test.each(scenarios)('%s approaches follow public region links and reserve reachable slots', scenario => {
    const { map } = createScenario(scenario, 5);
    for (const team of ['alpha', 'bravo'] as const) {
      const routes = selectApproachRoutes(map, team, map.objectives[0].position);
      expect(routes.primary.length).toBeGreaterThan(0);
      for (const route of [routes.primary, routes.flank]) for (let i = 1; i < route.length; i++) {
        expect(map.regions.find(r => r.id === route[i - 1])?.neighbors).toContain(route[i]);
      }
      const members = squad(map, team), coordinator = new SquadCoordinator(team), leases = new ReservationTable();
      const plan = coordinator.update(0, members, [], map, undefined, leases);
      expect(plan.assignments).toHaveLength(members.length);
      expect(new Set(plan.assignments.map(a => a.slotId)).size).toBe(members.length);
      for (const assignment of plan.assignments) {
        const member = members.find(m => m.id === assignment.agentId)!;
        expect(findPath(map, member.position, assignment.position).length).toBeGreaterThan(0);
      }
    }
  });

  test('courtyard point and flank use different approaches before consolidating', () => {
    const { map } = createScenario('crossfire', 5);
    for (const team of ['alpha', 'bravo'] as const) {
      const routes = selectApproachRoutes(map, team, map.objectives[0].position);
      expect(routes.flank).not.toEqual(routes.primary);
      const members = squad(map, team), coordinator = new SquadCoordinator(team), leases = new ReservationTable();
      let diverged = false;
      // Advance only to assigned slots: this tests phase progress, not movement physics.
      for (let phase = 0; phase < Math.max(routes.primary.length, routes.flank.length); phase++) {
        const plan = coordinator.update(phase * 15, members, [], map, undefined, leases);
        const point = plan.assignments.find(a => a.role === 'point')!, flank = plan.assignments.find(a => a.role === 'flank')!;
        const pointRegion = map.nodes.find(n => n.id === point.slotId)?.regionId;
        const flankRegion = map.nodes.find(n => n.id === flank.slotId)?.regionId;
        if (pointRegion !== flankRegion) diverged = true;
        for (const assignment of plan.assignments) members.find(m => m.id === assignment.agentId)!.position = { ...assignment.position };
      }
      expect(diverged).toBe(true);
    }
  });

  test('unavailable support repairs a breach approach instead of freezing movers indefinitely', () => {
    const { map } = createScenario('breach', 5), members = squad(map, 'alpha');
    for (const member of members) member.ammo = 4;
    const beliefs = new BeliefStore('shared:alpha');
    beliefs.integrate([{ id: 'communicated-contact', observerId: 'shared:alpha', subjectId: 'observed-enemy', classification: 'enemy', position: { ...map.objectives[0].position, y: 1.4 }, confidence: .9, uncertainty: 1, source: 'radio', observedAt: 0, receivedAt: 0, expiresAt: 300, regionId: map.objectives[0].regionId }], 0);
    const coordinator = new SquadCoordinator('alpha'), leases = new ReservationTable();
    expect(coordinator.update(0, members, beliefs.snapshot(), map, undefined, leases)).toMatchObject({ kind: 'bound', phase: 'prepare', supportReady: false });
    const repaired = coordinator.update(91, members, beliefs.snapshot(), map, undefined, leases);
    expect(repaired.kind).toBe('crossfire');
    expect(repaired.phase).not.toBe('prepare');
    expect(repaired.constraints).toContain('support-timeout:repaired-to-crossfire');
    expect(coordinator.update(150, members, beliefs.snapshot(), map, undefined, leases).kind).toBe('crossfire');
  });
});
