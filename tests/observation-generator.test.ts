import { describe, expect, it } from 'vitest';
import { DEFAULT_SKILL, type SelfState, type TacticalMap } from '@blacksite/ai-schema';
import { ObservationGenerator, type ObservationLineOfSightContext } from '@blacksite/sim-core';

const map: TacticalMap = {
  id: 'sensor-test', name: 'Sensor test', version: '1', width: 40, depth: 40, obstacles: [], nodes: [],
  regions: [{ id: 'room', name: 'Room', center: { x: 0, y: 0, z: 0 }, neighbors: [] }],
  spawns: { alpha: [], bravo: [] }, objectives: [],
};
function agents(): SelfState[] {
  return ['alpha', 'bravo'].map((team, index) => ({
    id: `${team}-1`, team: team as SelfState['team'], position: { x: 0, y: 4 + index * 4, z: index * 10 }, velocity: { x: 0, y: index, z: 0 },
    yaw: 0, pitch: 0, health: 100, ammo: 24, reserveAmmo: 96, reloadingUntil: 0, suppression: 0, alive: true,
    stance: 'stand', lastShotAt: -100, skill: DEFAULT_SKILL,
  }));
}

describe('authority-owned reusable observations', () => {
  it('accumulates recognition across sensing ticks, uses physical eye height and keeps provenance immutable', () => {
    const queries: { fromY: number; toY: number; context: ObservationLineOfSightContext }[] = [];
    const generator = new ObservationGenerator({ map, seed: 2048, lineOfSight: (from, to, context) => {
      queries.push({ fromY: from.y, toY: to.y, context }); return true;
    } });
    const states = agents();
    try {
      expect(generator.generate(0, states).get('alpha-1')).toEqual([]);
      expect(generator.generate(0, states).get('alpha-1')).toEqual([]);
      expect(queries).toHaveLength(1);
      expect(queries[0]).toEqual({ fromY: 5.5, toY: 9.5, context: { observerId: 'alpha-1', subjectId: 'bravo-1', kind: 'vision' } });
      generator.generate(2, states);
      const batch = generator.generate(4, states);
      const contact = batch.get('alpha-1')![0];
      expect(contact).toMatchObject({ subjectId: 'bravo-1', source: 'vision', classification: 'enemy', position: { y: 9.5 }, velocity: { y: 1 }, observedAt: 4 });
      expect(contact.uncertainty).toBeGreaterThan(0);
      const root = generator.observation(contact.id)!;
      contact.position.x = 999;
      root.confidence = 0;
      expect(generator.observation(contact.id)!.position.x).not.toBe(999);
      expect(generator.observation(contact.id)!.confidence).toBeGreaterThan(.63);
      expect(generator.generate(4, states).get('alpha-1')![0].position.x).not.toBe(999);
    } finally { generator.dispose(); }
  });

  it('cannot perceive through host geometry, behind attention or outside vertical FOV', () => {
    let clear = false;
    const generator = new ObservationGenerator({ map, seed: 1, lineOfSight: () => clear });
    const states = agents();
    try {
      for (let tick = 0; tick < 8; tick++) expect(generator.generate(tick, states).get('alpha-1')).toEqual([]);
      clear = true; states[0].yaw = Math.PI;
      for (let tick = 8; tick < 16; tick++) expect(generator.generate(tick, states).get('alpha-1')).toEqual([]);
      states[0].yaw = 0; states[0].pitch = -1.35;
      for (let tick = 16; tick < 24; tick++) expect(generator.generate(tick, states).get('alpha-1')).toEqual([]);
    } finally { generator.dispose(); }
  });

  it('ingests uncertain sound/damage without identity, defers future events and consumes evidence once', () => {
    const generator = new ObservationGenerator({ map, seed: 4, lineOfSight: () => false });
    const states = agents();
    try {
      generator.recordShot({ id: 'shot-1', tick: 2, agentId: 'bravo-1' }, states[1].position);
      generator.recordDamage('alpha-1', states[1].position, 2);
      expect(generator.generate(0, states).get('alpha-1')).toEqual([]);
      const evidence = generator.generate(2, states).get('alpha-1')!;
      expect(evidence.map(item => item.source)).toEqual(['sound', 'damage']);
      expect(evidence.every(item => item.classification === 'unknown' && item.subjectId === undefined && item.uncertainty >= 5)).toBe(true);
      expect(evidence[0].position.y).toBe(5.3);
      expect(evidence[1].position.y).toBe(5.4);
      expect(generator.generate(2, states).get('alpha-1')).toEqual(evidence);
      expect(generator.generate(4, states).get('alpha-1')).toEqual([]);
      expect(generator.observation(evidence[0].id)).toEqual(evidence[0]);
      generator.generate(400, states);
      expect(generator.observation(evidence[0].id)).toBeUndefined();
      expect(() => generator.generate(2, states)).toThrow('monotonic');
    } finally { generator.dispose(); }
  });
});
