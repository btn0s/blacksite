import { describe, expect, test } from 'vitest';
import { BeliefStore, RadioNetwork } from '@blacksite/ai-belief';
import { findPath, hasLineOfSight, isWalkable } from '@blacksite/ai-nav';
import { ReservationTable, scorePositions } from '@blacksite/ai-tactics';
import { allocateRoles, SquadCoordinator } from '@blacksite/ai-squad';
import { planIndividual } from '@blacksite/ai-planning';
import { SkillExecutor } from '@blacksite/ai-execution';
import { friendlyFireBlocked, MotorController } from '@blacksite/ai-motor';
import { gatePolicy } from '@blacksite/ai-policy';
import { Buttons, DEFAULT_SKILL } from '@blacksite/ai-schema';
import type { DecisionSnapshot, Observation, Plan, SelfState, SquadMessage, TacticalMap } from '@blacksite/ai-schema';

const map: TacticalMap = {
  id: 'test', version: '1', name: 'Test map', width: 40, depth: 40,
  obstacles: [{ id: 'wall', x: 0, z: 0, width: 2, depth: 8, height: 3 }],
  regions: [{ id: 'room', name: 'Room', center: { x: 0, y: 0, z: 10 }, neighbors: [] }],
  nodes: [
    { id: 'west', position: { x: -5, y: 0, z: 0 }, regionId: 'room', kind: 'cover', cover: .8, exposure: .2, capacity: 1, neighbors: ['north'] },
    { id: 'north', position: { x: 0, y: 0, z: 7 }, regionId: 'room', kind: 'entry', cover: .4, exposure: .5, capacity: 1, neighbors: ['west', 'east'] },
    { id: 'east', position: { x: 5, y: 0, z: 0 }, regionId: 'room', kind: 'overwatch', cover: .7, exposure: .3, capacity: 1, neighbors: ['north'] },
  ],
  spawns: { alpha: [{ x: -10, y: 0, z: 0 }], bravo: [{ x: 10, y: 0, z: 0 }] },
  objectives: [{ id: 'a', position: { x: 0, y: 0, z: 7 }, regionId: 'room' }],
};
const self = (id = 'a'): SelfState => ({ id, team: 'alpha', position: { x: -10, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, health: 100, ammo: 20, reserveAmmo: 60, reloadingUntil: 0, suppression: 0, alive: true, stance: 'stand', lastShotAt: -100, skill: { ...DEFAULT_SKILL } });
const observation = (patch: Partial<Observation> = {}): Observation => ({ id: 'sight-1', observerId: 'a', subjectId: 'enemy', classification: 'enemy', position: { x: -10, y: 1.5, z: 10 }, velocity: { x: .4, y: 0, z: 0 }, confidence: .8, uncertainty: .2, source: 'vision', observedAt: 0, receivedAt: 0, expiresAt: 300, regionId: 'room', ...patch });
const snapshot = (patch: Partial<DecisionSnapshot> = {}): DecisionSnapshot => ({ tick: 0, version: 1, self: self(), friends: [], beliefs: [], sharedBeliefs: [], candidates: [], map, random: .5, danger: 0, ...patch });

function policyContext() { return { tick: 5, requestedAtTick: 0, expiresAtTick: 10, snapshotVersion: 2, resultSnapshotVersion: 2, modelVersion: 'test-1', featureSchemaVersion: 'belief-1', legal: (a: { x: number }) => Math.abs(a.x) <= 1, fallback: () => ({ x: 0 }) }; }

describe('evidence and communication', () => {
  test('confidence only decays and uncertainty widens without new evidence', () => {
    const beliefs = new BeliefStore('a'); beliefs.integrate([observation()], 0);
    let prior = beliefs.snapshot()[0];
    for (let tick = 1; tick < 300; tick++) {
      beliefs.advance(tick); const next = beliefs.snapshot()[0];
      expect(next.confidence).toBeLessThanOrEqual(prior.confidence);
      expect(next.uncertaintyRadius).toBeGreaterThanOrEqual(prior.uncertaintyRadius);
      expect(next.provenance).toContain('sight-1'); prior = next;
    }
    beliefs.advance(300); expect(beliefs.snapshot()).toHaveLength(0);
  });
  test('rejects future, cross-agent, malformed evidence and prevents radio echo amplification', () => {
    const beliefs = new BeliefStore('a');
    beliefs.integrate([observation({ observerId: 'b' }), observation({ receivedAt: 5 }), observation({ receivedAt: NaN }), observation({ position: { x: NaN, y: 0, z: 0 } })], 0);
    expect(beliefs.snapshot()).toHaveLength(0);
    beliefs.integrate([observation()], 0);
    const before = beliefs.snapshot()[0].confidence;
    beliefs.integrate([observation({ id: 'radio-echo', parentId: 'sight-1', source: 'radio', confidence: 1 })], 0);
    expect(beliefs.snapshot()[0].confidence).toBe(before);
  });
  test('radio obeys latency, bandwidth, loss and expiry independently of requested delivery', () => {
    const radio = new RadioNetwork({ latencyTicks: 8, lossRate: .2, bandwidthTicks: 3 });
    const msg: SquadMessage = { id: 'message', senderId: 'a', team: 'alpha', sentAt: 0, deliverAt: 0, expiresAt: 100, urgency: 1, type: 'CONTACT', observation: observation() };
    expect(radio.send(msg, 10, .5)).toBe(true);
    expect(radio.send({ ...msg, id: 'lost' }, 10, .1)).toBe(false);
    expect(radio.send({ ...msg, id: 'second' }, 10, .5)).toBe(true);
    expect(radio.deliver(17)).toEqual([]);
    expect(radio.deliver(18).map(m => m.id)).toEqual(['message']);
    expect(radio.deliver(20)).toEqual([]);
    expect(radio.deliver(21).map(m => m.id)).toEqual(['second']);
    expect(radio.pendingCount).toBe(0);
  });
});

describe('tactical navigation and commitments', () => {
  test('paths route around geometry and every emitted segment is capsule-safe', () => {
    const start = { x: -8, y: 0, z: 0 }, goal = { x: 8, y: 0, z: 0 };
    expect(hasLineOfSight(map, start, goal)).toBe(false);
    const path = findPath(map, start, goal);
    expect(path.length).toBeGreaterThan(1);
    let from = start;
    for (const waypoint of path) { expect(isWalkable(map, waypoint)).toBe(true); expect(hasLineOfSight(map, from, waypoint, .4)).toBe(true); from = waypoint; }
    expect(path.at(-1)).toEqual(goal);
    expect(findPath(map, start, { x: 0, y: 0, z: 0 })).toEqual([]);
  });
  test('exclusive leases reject duplicates, renew, release and expire', () => {
    const leases = new ReservationTable();
    expect(leases.claim('door', 'a', 0, 10, 'portal')).toBe(true);
    expect(leases.claim('door', 'b', 1, 10, 'portal')).toBe(false);
    expect(leases.claim('door', 'a', 5, 10, 'portal')).toBe(true);
    expect(leases.claim('door', 'b', 14, 10, 'portal')).toBe(false);
    expect(leases.claim('door', 'b', 15, 10, 'portal')).toBe(true);
    leases.release('door', 'a'); expect(leases.snapshot()).toHaveLength(1);
    leases.releaseOwner('b'); expect(leases.snapshot()).toHaveLength(0);
  });
  test('role and position ownership is unique and stable across updates', () => {
    const members = [self('a'), self('b'), self('c')]; members[1].position.z = 2; members[2].position.z = -2;
    const roles = allocateRoles(members); expect(new Set(roles.values()).size).toBe(3);
    const coordinator = new SquadCoordinator('alpha'), leases = new ReservationTable();
    const first = coordinator.update(0, members, [], map, undefined, leases);
    const second = coordinator.update(6, members, [], map, undefined, leases);
    expect(new Set(first.assignments.map(a => a.slotId)).size).toBe(first.assignments.length);
    expect(second.assignments.map(a => [a.agentId, a.role, a.slotId])).toEqual(first.assignments.map(a => [a.agentId, a.role, a.slotId]));
    expect(() => coordinator.update(7, [{ ...self(), team: 'bravo' }], [], map, undefined, leases)).toThrow();
  });
  test('unsupported bounding expires into a repaired crossfire commitment', () => {
    const beliefs = new BeliefStore('a'); beliefs.integrate([observation()], 0);
    const members = [self('a'), self('b'), self('c')]; members[1].position.z = 2; members[2].position.z = -2;
    const coordinator = new SquadCoordinator('alpha'), leases = new ReservationTable();
    expect(coordinator.update(0, members, beliefs.snapshot(), map, undefined, leases).kind).toBe('bound');
    const repaired = coordinator.update(91, members, beliefs.snapshot(), map, undefined, leases);
    expect(repaired.kind).toBe('crossfire');
    expect(repaired.constraints).toContain('support-timeout:repaired-to-crossfire');
  });
  test('occupied slots are excluded with a inspectable rejection reason', () => {
    const leases = new ReservationTable(); leases.claim('west', 'b', 0, 50);
    expect(scorePositions(snapshot(), leases).find(c => c.nodeId === 'west')).toMatchObject({ applicable: false, rejectReason: 'reserved' });
  });
});

describe('bounded planning and skill lifecycle', () => {
  test('planner produces reproducible utility traces and legal deadline fallback', () => {
    const beliefs = new BeliefStore('a'); beliefs.integrate([observation()], 0);
    const state = snapshot({ beliefs: beliefs.snapshot() });
    expect(planIndividual(state)).toEqual(planIndividual(structuredClone(state)));
    const result = planIndividual(state); expect(result.plan.goal).toBe('engage'); expect(result.trace.observationProvenance).toContain('sight-1');
    const limited = planIndividual(state, { maxExpansions: 0 });
    expect(limited.plan.actions[0].skill).toBe('hold'); expect(limited.trace.deadline).toBe('expansion-limit');
  });
  test('fulfill-role uses only its assigned slot even when another candidate scores higher', () => {
    const assignment = { agentId: 'a', role: 'point' as const, slotId: 'west', position: { x: -5, y: 0, z: 0 }, score: 1, ready: false };
    const candidates = [
      { id: 'slot:east', nodeId: 'east', position: { x: 5, y: 0, z: 0 }, applicable: true, score: 20 },
      { id: 'slot:west', nodeId: 'west', position: assignment.position, applicable: true, score: 5 },
    ];
    const state = snapshot({ assignment, candidates });
    const result = planIndividual(state);
    expect(result.plan.goal).toBe('fulfill-role');
    expect(result.plan.actions[0]).toMatchObject({ resourceId: 'west', destination: assignment.position });
    const executor = new SkillExecutor('a', new ReservationTable());
    executor.commit(result.plan, 0); expect(executor.tick(state).view.state).toBe('running'); executor.dispose();
    const blocked = planIndividual(snapshot({ assignment, candidates: candidates.map(c => c.nodeId === 'west' ? { ...c, applicable: false, rejectReason: 'friendly-occupied' } : c) }));
    expect(blocked.plan.goal).toBe('hold');
    expect(blocked.trace.candidates.find(c => c.id === 'fulfill-role')).toMatchObject({ applicable: false, rejectReason: 'assigned-slot-unavailable' });
  });
  test.each(['interrupt', 'dispose', 'complete', 'failure'] as const)('skill releases claim on %s', terminal => {
    const leases = new ReservationTable(), executor = new SkillExecutor('a', leases);
    const plan: Plan = { id: 'plan', agentId: 'a', goal: 'move', requestedAtTick: 0, snapshotVersion: 1, expiresAtTick: 100, score: 1, actions: [{ id: 'move', skill: 'move', destination: { x: -5, y: 0, z: 0 }, resourceId: 'west', durationTicks: 10 }] };
    executor.commit(plan, 0); executor.tick(snapshot()); expect(leases.snapshot()).toHaveLength(1);
    if (terminal === 'interrupt') executor.interrupt('GRENADE_DANGER', 1);
    if (terminal === 'dispose') executor.dispose();
    if (terminal === 'complete') executor.tick(snapshot({ tick: 1, self: { ...self(), position: { x: -5, y: 0, z: 0 } } }));
    if (terminal === 'failure') executor.tick(snapshot({ tick: 11 }));
    expect(leases.snapshot()).toHaveLength(0); executor.dispose();
  });
  test('delayed plan entry revalidates current evidence, geometry and commitments', () => {
    const leases = new ReservationTable(), executor = new SkillExecutor('a', leases);
    const base: Plan = { id: 'stale', agentId: 'a', goal: 'engage', requestedAtTick: 0, snapshotVersion: 1, expiresAtTick: 100, score: 1, actions: [{ id: 'engage', skill: 'engage', targetTrackId: 'lost-track', durationTicks: 30 }] };
    executor.commit(base, 20);
    expect(executor.tick(snapshot({ tick: 20, version: 5 })).view.failure).toBe('observation-invalidated');
    executor.commit({ ...base, id: 'blocked', goal: 'fulfill-role', actions: [{ id: 'move', skill: 'move', destination: { x: 0, y: 0, z: 0 }, resourceId: 'west', durationTicks: 30 }] }, 20);
    expect(executor.tick(snapshot({ tick: 20, version: 5 })).view.failure).toBe('destination-unreachable');
    expect(leases.snapshot()).toHaveLength(0); executor.dispose();
  });
  test('entry revalidates claims instead of stealing another owner’s reservation', () => {
    const leases = new ReservationTable(), executor = new SkillExecutor('a', leases);
    leases.claim('west', 'b', 0, 100);
    executor.commit({ id: 'p', agentId: 'a', goal: 'move', requestedAtTick: 0, snapshotVersion: 1, expiresAtTick: 100, score: 1, actions: [{ id: 'move', skill: 'move', destination: { x: -5, y: 0, z: 0 }, resourceId: 'west', durationTicks: 10 }] }, 0);
    expect(executor.tick(snapshot()).view.failure).toBe('resource-blocked');
    expect(leases.snapshot()[0].ownerId).toBe('b'); executor.dispose();
  });
});

describe('motor and learned-policy safety', () => {
  test('swept friendly capsule blocks a currently clear shot when teammate is entering it', () => {
    const friendly = { ...self('b'), position: { x: 1, y: 0, z: 5 }, velocity: { x: -6, y: 0, z: 0 } };
    expect(friendlyFireBlocked({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: 1 }, 20, [friendly], 'a')).toBe(true);
  });
  test('empty or stale paths do not steer directly through walls', () => {
    const motor = new MotorController('a');
    const goal = { destination: { x: 10, y: 0, z: 0 }, fire: false, reload: false, stance: 'stand' as const, speed: 1, targetConfidence: 0 };
    const result = motor.step(snapshot(), goal, []);
    expect(result.command.move).toEqual({ x: 0, y: 0 });
    const stale = motor.step(snapshot({ tick: 1 }), goal, [goal.destination]);
    expect(stale.command.move).toEqual({ x: 0, y: 0 });
  });
  test('path following clears tight corners instead of prematurely skipping and stopping', () => {
    const motor = new MotorController('a'), current = self(); current.position = { x: -8, y: 0, z: 0 };
    const destination = { x: 8, y: 0, z: 0 };
    const goal = { destination, fire: false, reload: false, stance: 'stand' as const, speed: 1, targetConfidence: 0 };
    let path = findPath(map, current.position, destination);
    for (let tick = 0; tick < 400; tick++) {
      if (tick % 15 === 0) path = findPath(map, current.position, destination);
      const { command } = motor.step(snapshot({ tick, self: current }), goal, path);
      const next = { x: current.position.x + command.move.x * 3.5 / 30, y: 0, z: current.position.z + command.move.y * 3.5 / 30 };
      expect(hasLineOfSight(map, current.position, next, .38)).toBe(true);
      current.position = next; current.yaw += command.lookDelta.yaw; current.pitch += command.lookDelta.pitch;
    }
    expect(Math.hypot(current.position.x - destination.x, current.position.z - destination.z)).toBeLessThan(.7);
  });
  test('reaction, bounded angular acceleration and trigger gating precede fire', () => {
    const beliefs = new BeliefStore('a'); beliefs.integrate([observation()], 0);
    const motor = new MotorController('a'), current = self();
    const goal = { fire: true, reload: false, stance: 'stand' as const, speed: 0, targetConfidence: .8, targetTrackId: beliefs.snapshot()[0].id, lookAt: { x: -10, y: 1.5, z: 10 } };
    const first = motor.step(snapshot({ beliefs: beliefs.snapshot(), self: current }), goal);
    expect(first.command.buttons & Buttons.fire).toBe(0); expect(first.fireGate).toBe('acquisition-latency');
    for (let tick = 1; tick < 10; tick++) {
      const result = motor.step(snapshot({ tick, beliefs: beliefs.snapshot(), self: current }), goal);
      expect(Math.abs(result.command.lookDelta.yaw)).toBeLessThanOrEqual(.24);
      expect(Math.hypot(result.command.move.x, result.command.move.y)).toBeLessThanOrEqual(1.01);
      current.yaw += result.command.lookDelta.yaw; current.pitch += result.command.lookDelta.pitch;
    }
  });
  test('NaN, uncertainty, OOD, expired/stale results and unsafe actions select a legal fallback', () => {
    const result = { action: { x: .3 }, confidence: .9, epistemicUncertainty: .1, modelVersion: 'test-1', featureSchemaVersion: 'belief-1' };
    expect(gatePolicy(result, policyContext()).accepted).toBe(true);
    const invalid = [
      gatePolicy({ ...result, action: { x: NaN } }, policyContext()),
      gatePolicy({ ...result, action: { x: 2 } }, policyContext()),
      gatePolicy({ ...result, epistemicUncertainty: .9 }, policyContext()),
      gatePolicy(result, { ...policyContext(), outOfDistribution: true }),
      gatePolicy(result, { ...policyContext(), tick: 10 }),
      gatePolicy(result, { ...policyContext(), resultSnapshotVersion: 1 }),
      gatePolicy(result, { ...policyContext(), modelVersion: 'other' }),
    ];
    for (const gated of invalid) expect(gated).toMatchObject({ accepted: false, action: { x: 0 } });
    expect(() => gatePolicy(undefined, { ...policyContext(), fallback: () => ({ x: Infinity }) })).toThrow('Unsafe symbolic fallback');
  });
});
