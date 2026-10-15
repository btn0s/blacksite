import { expect, test } from 'vitest';
import { createScenario } from '@blacksite/ai-scenarios';
import { DEFAULT_SKILL, type DecisionSnapshot, type MotorGoal, type SelfState, type SquadPlan } from '@blacksite/ai-schema';
import { findPath } from '@blacksite/ai-nav';
import { MotorController } from '@blacksite/ai-motor';
import { ReservationTable } from '@blacksite/ai-tactics';

const { map } = createScenario('deadlock', 5);
const destination = { x: -9, y: 0, z: 0 };
const member = (id: string, x: number, z: number): SelfState => ({ id, team: 'alpha', position: { x, y: 0, z }, velocity: { x: 0, y: 0, z: 0 }, yaw: Math.PI / 2, pitch: 0, health: 100, ammo: 24, reserveAmmo: 60, reloadingUntil: 0, suppression: 0, alive: true, stance: 'stand', lastShotAt: -100, skill: { ...DEFAULT_SKILL } });
const first = member('alpha-1', -16.5, 0), second = member('alpha-2', -18.5, 1);
const maneuver: SquadPlan = { id: 'queue', team: 'alpha', kind: 'move', phase: 'execute', createdAt: 0, expiresAt: 1000, supportReady: false, constraints: ['exclusive-portals'], order: { id: 'order', team: 'alpha', posture: 'probe', objectiveId: 'relay', objective: map.objectives[0].position, issuedAt: 0, risk: .5, tempo: .7 }, assignments: [first, second].map((m, i) => ({ agentId: m.id, role: i === 0 ? 'point' : 'support', slotId: `destination:${m.id}`, position: destination, score: 1, ready: false })) };
const state = (self: SelfState, tick: number): DecisionSnapshot => ({ self, tick, version: 0, map, friends: self.id === first.id ? [second] : [first], beliefs: [], sharedBeliefs: [], candidates: [], maneuver, assignment: maneuver.assignments.find(a => a.agentId === self.id), random: .5, danger: 0 });
const moving: MotorGoal = { destination, fire: false, reload: false, stance: 'stand', speed: .8, targetConfidence: 0 };
const portal = 'portal:anchor:narrow-portal';

test('portal lease is exclusive and released on passage, stop and disposal', () => {
  const leases = new ReservationTable(), a = new MotorController(first.id, leases), b = new MotorController(second.id, leases);
  a.step(state(first, 0), moving, findPath(map, first.position, destination));
  b.step(state(second, 0), moving, findPath(map, second.position, destination));
  expect(leases.snapshot().filter(l => l.kind === 'portal')).toEqual([{ resourceId: portal, ownerId: first.id, expiresAt: 8, kind: 'portal' }]);
  a.step(state({ ...first, position: { x: -12.2, y: 0, z: 0 } }, 1), moving, [destination]);
  expect(leases.snapshot()).toHaveLength(0);
  a.step(state(first, 2), moving, findPath(map, first.position, destination));
  a.step(state(first, 3), { ...moving, destination: undefined, speed: 0 }, []);
  expect(leases.snapshot()).toHaveLength(0);
  a.step(state(first, 4), moving, findPath(map, first.position, destination));
  a.dispose(); b.dispose(); expect(leases.snapshot()).toHaveLength(0);
});

test('ignored motor commands cannot renew a portal forever or starve the next waiter', () => {
  const leases = new ReservationTable(), a = new MotorController(first.id, leases), b = new MotorController(second.id, leases);
  const path = findPath(map, first.position, destination);
  // The authoritative position stays fixed, as when human input replaces AI suggestions.
  for (let tick = 0; tick <= 46; tick++) a.step(state(first, tick), moving, path);
  expect(leases.eligible(portal, first.id, 46)).toBe(false);
  expect(leases.snapshot().some(l => l.ownerId === first.id)).toBe(false);
  b.step(state(second, 46), moving, findPath(map, second.position, destination));
  expect(leases.snapshot().find(l => l.resourceId === portal)?.ownerId).toBe(second.id);
  a.dispose(); b.dispose();
});

test('a skill transition inside the throat retains its lease, with a bounded stationary timeout', () => {
  const leases = new ReservationTable(), a = new MotorController(first.id, leases);
  a.step(state(first, 0), moving, findPath(map, first.position, destination));
  const inside = { ...first, position: { x: -14.2, y: 0, z: 0 } };
  const stopped = { ...moving, destination: undefined, speed: 0 };
  a.step(state(inside, 1), stopped, []);
  expect(leases.snapshot().find(l => l.resourceId === portal)?.ownerId).toBe(first.id);
  for (let tick = 2; tick <= 47; tick++) a.step(state(inside, tick), stopped, []);
  expect(leases.snapshot().some(l => l.ownerId === first.id)).toBe(false);
  expect(leases.eligible(portal, first.id, 47)).toBe(false);
  a.dispose();
});

test('a stationary support skill remains in its cover despite nearby teammates', () => {
  const held = member('support', -20, 3), nearby = member('passing', -19, 3);
  const motor = new MotorController(held.id);
  const snapshot = { ...state(held, 0), friends: [nearby] };
  for (let tick = 0; tick < 60; tick++) {
    expect(motor.step({ ...snapshot, tick }, { ...moving, destination: undefined, speed: 0 }, []).command.move).toEqual({ x: 0, y: 0 });
  }
  motor.dispose();
});
