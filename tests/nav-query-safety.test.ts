import { expect, test } from 'vitest';
import { findPath, hasLineOfSight, tacticalPathCosts } from '@blacksite/ai-nav';
import type { TacticalMap, Vec3 } from '@blacksite/ai-schema';

const start = { x: -4, y: 0, z: 0 }, goal = { x: 4, y: 0, z: 0 };
const fixture = (): TacticalMap => ({ id: 'routing', version: '1', name: 'Routing', width: 20, depth: 20,
  obstacles: [{ id: 'wall', x: 0, z: 0, width: 1, depth: 4, height: 3 }],
  nodes: [{ id: 'goal', position: goal, regionId: 'room', kind: 'objective', cover: 0, exposure: 0, capacity: 1, neighbors: [] }],
  regions: [], spawns: { alpha: [start], bravo: [goal] }, objectives: [] });
const safe = (map: TacticalMap, from: Vec3, path: Vec3[], clearance: number) => path.every((p, i) => hasLineOfSight(map, i ? path[i - 1] : from, p, clearance));

test('repeated mixed navigation queries stay exact and returned values cannot corrupt later routes', () => {
  const map = fixture(), expected = findPath(map, start, goal), cost = tacticalPathCosts(map, start).get('goal');
  expect(expected.length).toBeGreaterThan(1);
  expect(safe(map, start, expected, .4)).toBe(true);
  const path = findPath(map, start, goal), costs = tacticalPathCosts(map, start);
  path[0].x = 999; costs.set('goal', 0);
  // Exercise many intervening exact start positions, including beyond a bounded working set.
  for (let i = 0; i < 96; i++) tacticalPathCosts(map, { ...start, z: -3 + i / 16 });
  expect(findPath(map, start, goal)).toEqual(expected);
  expect(tacticalPathCosts(map, start).get('goal')).toBe(cost);
});

test('micrometre-separated starts on opposite sides of body legality never share a result', () => {
  const map = fixture(), legal = { x: .840002, y: 0, z: 0 }, blocked = { x: .839998, y: 0, z: 0 };
  expect(Number.isFinite(tacticalPathCosts(map, legal).get('goal'))).toBe(true);
  expect(tacticalPathCosts(map, blocked).get('goal')).toBe(Infinity);
  expect(findPath(map, blocked, goal)).toEqual([]);
  expect(findPath(map, legal, goal).length).toBeGreaterThan(0);
});

test('clearance, map identity and a changed geometry version isolate navigation results', () => {
  const map = fixture(), original = findPath(map, start, goal);
  tacticalPathCosts(map, start, .4);
  const wide = findPath(map, start, goal, 1.1);
  expect(safe(map, start, wide, 1.1)).toBe(true);
  expect(wide).not.toEqual(original);
  const sealed = fixture(); sealed.obstacles[0].depth = 20;
  expect(tacticalPathCosts(sealed, start).get('goal')).toBe(Infinity);
  expect(findPath(sealed, start, goal)).toEqual([]);
  map.obstacles[0].depth = 20; map.version = '2';
  expect(tacticalPathCosts(map, start).get('goal')).toBe(Infinity);
  expect(findPath(map, start, goal)).toEqual([]);
});
