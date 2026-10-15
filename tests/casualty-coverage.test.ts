import { expect, test } from 'vitest';
import { DEFAULT_CONFIG, DEFAULT_SKILL, type BeliefTrack, type SelfState } from '@blacksite/ai-schema';
import { createScenario } from '@blacksite/ai-scenarios';
import { SquadCoordinator } from '@blacksite/ai-squad';
import { ReservationTable } from '@blacksite/ai-tactics';
import { distance, findPath, hasLineOfSight } from '@blacksite/ai-nav';
import { TacticalRuntime } from '@blacksite/ai-runtime';

// Reduced from the legal team HUD/common picture immediately before replay tick169.
const member = (id: string, x: number, z: number): SelfState => ({ id, team: 'alpha', position: { x, y: 0, z }, velocity: { x: 0, y: 0, z: 0 }, yaw: 1, pitch: 0, health: 100, ammo: 24, reserveAmmo: 96, reloadingUntil: 0, suppression: 0, alive: true, stance: 'stand', lastShotAt: -100, skill: { ...DEFAULT_SKILL } });
const radio: BeliefTrack = { id: 'track:bravo-3', subjectId: 'bravo-3', classification: 'enemy', meanPosition: { x: 14, y: 1.3, z: 9 }, meanVelocity: { x: 0, y: 0, z: 0 }, covariance: [4, 0, 0, 4, 0, 4], confidence: .557, uncertaintyRadius: 4.7, firstObservedAt: 134, lastObservedAt: 134, lastUpdatedAt: 169, receivedAt: 147, expiresAt: 225, source: 'radio', provenanceId: 'vision:134:alpha-3:bravo-3', provenance: ['vision:134:alpha-3:bravo-3'], possibleRegions: ['east-switch'] };
function fixture(shared: BeliefTrack[] = [radio]) {
  const { map } = createScenario('casualty', 5), squad = new SquadCoordinator('alpha'), reservations = new ReservationTable();
  squad.update(0, map.spawns.alpha.map((p, i) => member(`alpha-${i + 1}`, p.x, p.z)), [], map, undefined, reservations);
  const before = [member('alpha-1', -13.11, -7.68), member('alpha-2', -8.42, -6.67), member('alpha-3', -9.95, 10.45), member('alpha-4', -15.67, -7.15), member('alpha-5', -15.09, -7.5)];
  before[0].health = 28;
  squad.update(168, before, shared, map, undefined, reservations);
  const after = before.map(agent => agent.id === 'alpha-3' ? { ...agent, alive: false, health: 0 } : agent);
  return { map, squad, reservations, before, after, shared };
}

test('losing the known flank creates one reachable covered watch commitment without abandoning the objective', () => {
  const { map, squad, reservations, after, shared } = fixture();
  const plan = squad.update(169, after, shared, map, undefined, reservations);
  const watchers = plan.assignments.filter(a => a.watchSector);
  expect(watchers, 'role replacement alone left the lost flank completely unobserved').toHaveLength(1);
  const watcher = watchers[0], duty = watcher.watchSector!;
  expect(duty.casualtyId).toBe('alpha-3');
  expect(duty.source).toBe('radio');
  expect(duty.lookAt).toEqual(radio.meanPosition);
  expect(duty.observationProvenance).toEqual(radio.provenance);
  expect(duty.expiresAt - duty.issuedAt).toBeLessThanOrEqual(240);
  expect(hasLineOfSight(map, { ...watcher.position, y: 1.4 }, duty.lookAt)).toBe(true);
  expect(distance(watcher.position, after[2].position)).toBeGreaterThan(2);
  expect(findPath(map, after.find(a => a.id === watcher.agentId)!.position, watcher.position).length).toBeGreaterThan(0);
  expect(plan.assignments.some(a => a.role === 'point' && !a.watchSector)).toBe(true);
  const repeated = squad.update(180, after, shared, map, undefined, reservations);
  expect(repeated.assignments.find(a => a.watchSector)?.agentId).toBe(watcher.agentId);
  const remembered = squad.update(240, after, [], map, undefined, reservations).assignments.find(a => a.watchSector)!;
  expect(remembered.watchSector).toEqual(duty);
});

test('a casualty watch transfers when its owner cannot fight and expires without refreshing itself', () => {
  const { map, squad, reservations, after, shared } = fixture();
  const plan = squad.update(169, after, shared, map, undefined, reservations);
  const original = plan.assignments.find(a => a.watchSector)!;
  expect(original).toBeDefined();
  const reloading = after.map(a => a.id === original.agentId ? { ...a, ammo: 0, reloadingUntil: 300 } : a);
  const transfer = squad.update(180, reloading, shared, map, undefined, reservations);
  const replacement = transfer.assignments.find(a => a.watchSector)!;
  expect(replacement).toBeDefined();
  expect(replacement.agentId).not.toBe(original.agentId);
  expect(replacement.watchSector!.expiresAt).toBe(original.watchSector!.expiresAt);
  const expired = squad.update(original.watchSector!.expiresAt, after, [], map, undefined, reservations);
  expect(expired.assignments.some(a => a.watchSector)).toBe(false);
});

test('without communicated enemies, the watch contains only own-team casualty location and withdraws on retreat', () => {
  const { map, squad, reservations, after } = fixture([]);
  const plan = squad.update(169, after, [], map, undefined, reservations);
  const watch = plan.assignments.find(a => a.watchSector)!.watchSector!;
  expect(watch.source).toBe('team-status');
  expect(watch.observationProvenance).toEqual([]);
  expect(watch.lookAt.x).toBe(after[2].position.x);
  expect(watch.lookAt.z).toBe(after[2].position.z);
  const retreat = squad.update(180, after, [], map, { ...plan.order, posture: 'retreat', issuedAt: 180 }, reservations);
  expect(retreat.assignments.some(a => a.watchSector)).toBe(false);
});

test('Casualty2048 physically establishes the lost-flank watch before its bounded duty expires', () => {
  const runtime = new TacticalRuntime({ ...DEFAULT_CONFIG, scenarioId: 'casualty', seed: 2048 });
  let assignedAt = Infinity, movedAt = Infinity, arrivedAt = Infinity, attentionAt = Infinity, heldAfterContactExpired = false;
  try {
    let snapshot = runtime.snapshot();
    while (snapshot.tick < 430 && snapshot.status === 'running') {
      snapshot = runtime.step();
      const assignment = snapshot.squads.find(squad => squad.team === 'alpha')!.assignments.find(a => a.watchSector?.casualtyId === 'alpha-3');
      if (!assignment) continue;
      const watch = assignment.watchSector!, owner = snapshot.agents.find(a => a.id === assignment.agentId)!;
      assignedAt = Math.min(assignedAt, snapshot.tick);
      if (Math.hypot(owner.velocity.x, owner.velocity.z) > .5) movedAt = Math.min(movedAt, snapshot.tick);
      if (distance(owner.attention, watch.lookAt) < .01) attentionAt = Math.min(attentionAt, snapshot.tick);
      if (distance(owner.position, assignment.position) < 1.1 && hasLineOfSight(runtime.map, { ...owner.position, y: 1.4 }, watch.lookAt)) arrivedAt = Math.min(arrivedAt, snapshot.tick);
      if (snapshot.tick > 225 && !snapshot.sharedBeliefs.alpha.some(track => track.subjectId === 'bravo-3')) {
        heldAfterContactExpired = true;
        if (watch.source === 'radio' && snapshot.tick > watch.issuedAt + 6) expect(owner.trace?.observationProvenance).toEqual(expect.arrayContaining(watch.observationProvenance));
      }
      expect(snapshot.metrics.fairnessViolations).toBe(0);
    }
    expect(assignedAt).toBe(169);
    expect(attentionAt, 'the new responsibility must affect view control promptly').toBeLessThanOrEqual(171);
    expect(movedAt, 'establishing support cannot wait for its own bound support gate').toBeLessThanOrEqual(180);
    expect(arrivedAt, 'a watch label is insufficient: an armed agent must reach a real covering position').toBeLessThan(409);
    expect(heldAfterContactExpired).toBe(true);
  } finally { runtime.dispose(); }
});
