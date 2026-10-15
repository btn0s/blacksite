import { expect, test } from 'vitest';
import { DEFAULT_SKILL, Buttons, type BeliefTrack, type DecisionSnapshot, type MotorGoal, type Plan, type SelfState, type TacticalMap, type WatchSector } from '@blacksite/ai-schema';
import { SkillExecutor } from '@blacksite/ai-execution';
import { MotorController } from '@blacksite/ai-motor';
import { planIndividual } from '@blacksite/ai-planning';
import { ReservationTable } from '@blacksite/ai-tactics';

const map: TacticalMap = { id: 'watch', version: '1', name: 'Watch', width: 40, depth: 40, obstacles: [], nodes: [], regions: [], spawns: { alpha: [], bravo: [] }, objectives: [] };
const self: SelfState = { id: 'alpha-1', team: 'alpha', position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, health: 100, ammo: 24, reserveAmmo: 60, reloadingUntil: 0, suppression: 0, alive: true, stance: 'stand', lastShotAt: -100, skill: { ...DEFAULT_SKILL } };
const casualty = { ...self, id: 'alpha-3', alive: false, health: 0, position: { x: -10, y: 0, z: 4 } };
const watch: WatchSector = { id: 'lost-flank', casualtyId: casualty.id, lookAt: { x: -10, y: 1.5, z: 5 }, issuedAt: 90, expiresAt: 330, source: 'team-status', observationProvenance: [] };
const destination = { x: 0, y: 0, z: 6 };
const state = (patch: Partial<DecisionSnapshot> = {}): DecisionSnapshot => ({ tick: 100, version: 1, self, friends: [casualty], beliefs: [], sharedBeliefs: [], candidates: [], map, random: .5, danger: 0, assignment: { agentId: self.id, role: 'flank', slotId: 'watch-slot', position: destination, score: 1, ready: false, watchSector: watch }, ...patch });
const plan: Plan = { id: 'move', agentId: self.id, goal: 'fulfill-role', requestedAtTick: 100, snapshotVersion: 1, expiresAtTick: 500, score: 7, actions: [{ id: 'MoveToSlot:0', skill: 'move', destination, durationTicks: 200, resourceId: 'watch-slot' }] };
const track = (patch: Partial<BeliefTrack> = {}): BeliefTrack => ({ id: 'known', subjectId: 'bravo-1', classification: 'enemy', meanPosition: { x: 10, y: 1.5, z: 5 }, meanVelocity: { x: 0, y: 0, z: 0 }, covariance: [1, 0, 0, 1, 0, 1], confidence: .8, uncertaintyRadius: 1, firstObservedAt: 50, lastObservedAt: 75, lastUpdatedAt: 100, receivedAt: 75, expiresAt: 200, source: 'vision', provenanceId: 'sight', provenance: ['sight'], possibleRegions: [], ...patch });
const idle: MotorGoal = { fire: false, reload: false, stance: 'stand', speed: 0, targetConfidence: 0 };

test('a live casualty watch reaches idle, movement and completion without inventing a target or firing', () => {
  const reservations = new ReservationTable(), executor = new SkillExecutor(self.id, reservations), motor = new MotorController(self.id, reservations);
  const snapshot = state();
  try {
    const waiting = executor.tick(snapshot).goal;
    expect(waiting.watchSector).toEqual(watch);
    executor.commit(plan, 100);
    const moving = executor.tick(snapshot).goal;
    const output = motor.step(snapshot, moving, [destination]);
    expect(output.attention).toEqual(watch.lookAt);
    expect(moving.targetTrackId).toBeUndefined();
    expect(output.command.buttons & Buttons.fire).toBe(0);
    expect(Math.hypot(output.command.move.x, output.command.move.y)).toBeGreaterThan(0);
    expect(Math.abs(output.command.lookDelta.yaw)).toBeLessThanOrEqual(.24);
    expect(snapshot.beliefs).toEqual([]);
    const arrived = state({ tick: 101, self: { ...self, position: destination } });
    expect(executor.tick(arrived).goal.watchSector).toEqual(watch);
    const replacement = { ...watch, id: 'updated-sector', lookAt: { x: -8, y: 1.5, z: 8 } };
    const changed = state({ tick: 102, assignment: { ...snapshot.assignment!, watchSector: replacement } });
    expect(executor.tick(changed).goal.watchSector).toEqual(replacement);
  } finally { executor.dispose(); motor.dispose(); }
});

test('a watch beats stale action and incidental memory; a fresh proven active threat still wins', () => {
  const motor = new MotorController(self.id);
  try {
    const old = track(), snapshot = state({ beliefs: [old] });
    const goal = { ...idle, watchSector: watch, targetTrackId: old.id, targetConfidence: .8, lookAt: old.meanPosition, fire: true };
    expect(motor.step(snapshot, goal).attention).toEqual(watch.lookAt);
    expect(motor.step(snapshot, goal).command.buttons & Buttons.fire).toBe(0);
    const fresh = track({ lastObservedAt: 100, receivedAt: 100 });
    expect(motor.step(state({ beliefs: [fresh] }), goal).attention).toEqual(fresh.meanPosition);
    const expired = track({ lastObservedAt: 100, expiresAt: 100 });
    expect(motor.step(state({ beliefs: [expired] }), goal).attention).toEqual(watch.lookAt);
    expect(motor.step(state({ beliefs: [expired] }), goal).command.buttons & Buttons.fire).toBe(0);
    expect(motor.step(snapshot, { ...idle, watchSector: watch }).attention).toEqual(watch.lookAt);
  } finally { motor.dispose(); }
});

test('invalid or no-longer-assigned watches cannot redirect attention', () => {
  const invalid: WatchSector[] = [
    { ...watch, expiresAt: 100 }, { ...watch, issuedAt: 101 }, { ...watch, expiresAt: Infinity },
    { ...watch, lookAt: { x: NaN, y: 1.5, z: 5 } }, { ...watch, source: 'radio', observationProvenance: [] },
    { ...watch, casualtyId: 'unseen-enemy' },
  ];
  for (const candidate of invalid) {
    const snapshot = state(); snapshot.assignment = { ...snapshot.assignment!, watchSector: candidate };
    const executor = new SkillExecutor(self.id, new ReservationTable()), motor = new MotorController(self.id);
    const goal = executor.tick(snapshot).goal;
    expect(goal.watchSector).toBeUndefined();
    expect(motor.step(snapshot, { ...idle, watchSector: candidate }).attention).toEqual({ x: 0, y: 1.5, z: 8 });
    executor.dispose(); motor.dispose();
  }
  const motor = new MotorController(self.id);
  expect(motor.step(state({ assignment: undefined }), { ...idle, watchSector: watch }).attention.x).toBe(0);
  motor.dispose();
});

test('coverage holds its assigned slot instead of searching and records only its supplied evidence', () => {
  const radio = { ...watch, source: 'radio' as const, observationProvenance: ['shared-contact'] };
  const snapshot = state({ self: { ...self, position: destination }, beliefs: [track()], sharedBeliefs: [track({ provenanceId: 'shared-contact', provenance: ['shared-contact'] })], candidates: [{ id: 'elsewhere', nodeId: 'elsewhere', position: { x: 5, y: 0, z: 0 }, applicable: true, score: 9 }] });
  snapshot.assignment = { ...snapshot.assignment!, watchSector: radio };
  const { plan, trace } = planIndividual(snapshot);
  expect(plan.goal).toBe('cover-sector');
  expect(plan.actions[0].skill).toBe('hold');
  expect(plan.actions[0].targetTrackId).toBeUndefined();
  expect(trace.candidates.find(c => c.id === 'cover-sector')?.terms?.commitment).toBeGreaterThan(0);
  expect(trace.observationProvenance).toContain('shared-contact');
  const expired = state({ ...snapshot, tick: 330 });
  expect(planIndividual(expired).plan.goal).toBe('search');
});

test('only establishing an assigned coverage slot may move before bound support is ready', () => {
  const snapshot = state();
  snapshot.candidates = [{ id: 'watch-slot', nodeId: 'watch-slot', position: destination, applicable: true, score: 7 }];
  snapshot.maneuver = { id: 'bound', team: self.team, kind: 'bound', phase: 'prepare', order: { id: 'order', team: self.team, posture: 'seize', objectiveId: 'objective', objective: destination, issuedAt: 90, risk: .5, tempo: .7 }, assignments: [snapshot.assignment!], createdAt: 90, expiresAt: 300, supportReady: false, constraints: ['support-ready-before-exposure'] };
  expect(planIndividual(snapshot).plan.goal).toBe('fulfill-role');
  const ordinary = { ...snapshot, assignment: { ...snapshot.assignment!, watchSector: undefined } };
  expect(planIndividual(ordinary).plan.goal).toBe('hold');
  for (const [current, target, allowed] of [[snapshot, destination, true], [snapshot, { x: 7, y: 0, z: 0 }, false], [ordinary, destination, false]] as const) {
    const motor = new MotorController(self.id);
    const output = motor.step(current, { ...idle, destination: target, speed: .8, watchSector: watch }, [target]);
    expect(Math.hypot(output.command.move.x, output.command.move.y) > 0).toBe(allowed);
    motor.dispose();
  }
});

test('reassigned or withdrawn coverage releases its old hold claim immediately', () => {
  const snapshot = state({ self: { ...self, position: destination } });
  const leases = new ReservationTable(), executor = new SkillExecutor(self.id, leases);
  executor.commit(planIndividual(snapshot).plan, snapshot.tick);
  expect(executor.tick(snapshot).view.skill).toBe('hold');
  expect(leases.snapshot().some(r => r.resourceId === 'watch-slot')).toBe(true);
  const changed = state({ tick: 101, assignment: { ...snapshot.assignment!, slotId: 'another-slot' } });
  expect(executor.tick(changed).view.failure).toBe('commitment-changed');
  expect(leases.snapshot()).toEqual([]);
  executor.commit({ ...planIndividual(snapshot).plan, id: 'second' }, 102);
  executor.tick({ ...snapshot, tick: 102 });
  expect(executor.tick({ ...snapshot, tick: 103, assignment: { ...snapshot.assignment!, watchSector: undefined } }).view.failure).toBe('watch-ended');
  expect(leases.snapshot()).toEqual([]);
  executor.dispose();
});
