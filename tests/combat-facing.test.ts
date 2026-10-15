import { expect, test } from 'vitest';
import { MotorController, wrapAngle } from '@blacksite/ai-motor';
import { SkillExecutor } from '@blacksite/ai-execution';
import { ReservationTable } from '@blacksite/ai-tactics';
import { createScenario } from '@blacksite/ai-scenarios';
import { findPath } from '@blacksite/ai-nav';
import { Buttons, DEFAULT_CONFIG, DEFAULT_SKILL, type BeliefTrack, type DecisionSnapshot, type MotorGoal, type SelfState } from '@blacksite/ai-schema';
import { TacticalRuntime } from '@blacksite/ai-runtime';

const { map } = createScenario('crossfire', 5);
// Reduced from the uploaded seed2048 replay at tick507: Bravo3 repositions northeast
// with ammunition while remembering a western contact observed25 ticks earlier.
const self: SelfState = { id: 'bravo-3', team: 'bravo', position: { x: 1.148242, y: 0, z: 4.261225 }, velocity: { x: 0, y: 0, z: 0 }, yaw: .485981, pitch: 0, health: 48, ammo: 18, reserveAmmo: 60, reloadingUntil: 0, suppression: 0, alive: true, stance: 'stand', lastShotAt: 218, skill: { ...DEFAULT_SKILL } };
const contact: BeliefTrack = { id: 'subject:alpha-5', subjectId: 'alpha-5', classification: 'enemy', meanPosition: { x: -8, y: 1.3, z: 9 }, meanVelocity: { x: 0, y: 0, z: 0 }, covariance: [1, 0, 0, 1, 0, 1], confidence: .52, uncertaintyRadius: 2, firstObservedAt: 400, lastObservedAt: 482, lastUpdatedAt: 507, receivedAt: 494, expiresAt: 700, source: 'radio', provenanceId: 'received-contact', provenance: ['received-contact'], possibleRegions: [] };
const snapshot = (tick = 507): DecisionSnapshot => ({ tick, version: 1, self, beliefs: [contact], sharedBeliefs: [], friends: [], candidates: [], map, random: .5, danger: 0 });
const destination = { x: 11, y: 0, z: 14 };

test.each(['move', 'fallback'] as const)('%s keeps attention on a recent local contact after its firing evidence expires', skill => {
  const leases = new ReservationTable(), executor = new SkillExecutor(self.id, leases), motor = new MotorController(self.id, leases);
  executor.commit({ id: 'reposition', agentId: self.id, goal: skill === 'fallback' ? 'survive' : 'fulfill-role', actions: [{ id: 'Reposition:0', skill, destination, durationTicks: 218 }], requestedAtTick: 507, snapshotVersion: 1, expiresAtTick: 800, score: 7 }, 507);
  try {
    const state = snapshot(), { goal } = executor.tick(state);
    const output = motor.step(state, goal, findPath(map, self.position, destination));
    expect(output.attention.x).toBe(contact.meanPosition.x);
    expect(output.attention.z).toBe(contact.meanPosition.z);
    expect(Math.hypot(output.command.move.x, output.command.move.y)).toBeGreaterThan(0);
    expect(output.command.buttons & Buttons.fire).toBe(0);
    expect(Math.abs(output.command.lookDelta.yaw)).toBeLessThanOrEqual(.24);
  } finally { executor.dispose(); motor.dispose(); }
});

test('an active firing target takes priority over a remembered sector', () => {
  const motor = new MotorController(self.id), active = { ...contact, id: 'other-target', meanPosition: { x: 3, y: 1.3, z: 8 }, confidence: .9, lastObservedAt: 507 };
  const state = { ...snapshot(), beliefs: [contact, active] };
  const goal: MotorGoal = { fire: true, reload: false, stance: 'stand', speed: 0, targetConfidence: .9, targetTrackId: active.id, lookAt: active.meanPosition };
  expect(motor.step(state, goal).attention).toEqual(active.meanPosition);
  motor.dispose();
});

test('memory-facing expires and never uses an expired or unproven contact', () => {
  const goal: MotorGoal = { destination, fire: false, reload: false, stance: 'stand', speed: .8, targetConfidence: 0 };
  const path = findPath(map, self.position, destination);
  for (const state of [snapshot(600), { ...snapshot(), beliefs: [{ ...contact, expiresAt: 507 }] }, { ...snapshot(), beliefs: [{ ...contact, provenance: [] }] }]) {
    const motor = new MotorController(self.id);
    expect(motor.step(state, goal, path).attention.x).not.toBe(contact.meanPosition.x);
    motor.dispose();
  }
});

test('Crossfire2048 keeps a credible enemy sector in attention while armed agents reposition', () => {
  const runtime = new TacticalRuntime({ ...DEFAULT_CONFIG, scenarioId: 'crossfire', seed: 2048 });
  let checked = 0;
  try {
    let state = runtime.snapshot();
    while (state.status === 'running' && state.tick < 900) {
      state = runtime.step();
      for (const agent of state.agents.filter(a => a.team === 'bravo' && a.alive && a.ammo > 0 && a.health >= 25 && a.destination)) {
        const known = agent.beliefs.filter(track => track.classification === 'enemy' && track.confidence >= .4 && track.provenance.length && track.expiresAt > state.tick && state.tick - track.lastObservedAt <= 60);
        if (!known.length) continue;
        checked++;
        const attentionYaw = Math.atan2(agent.attention.x - agent.position.x, agent.attention.z - agent.position.z);
        const closest = Math.min(...known.map(track => Math.abs(wrapAngle(Math.atan2(track.meanPosition.x - agent.position.x, track.meanPosition.z - agent.position.z) - attentionYaw))));
        expect(closest, `${agent.id} abandons all recent contact sectors while moving at tick${state.tick}`).toBeLessThan(Math.PI / 2);
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(state.metrics.fairnessViolations).toBe(0);
  } finally { runtime.dispose(); }
});
