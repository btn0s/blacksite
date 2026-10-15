import { describe, expect, it } from 'vitest';
import type { TacticalMap, Vec3 } from '@blacksite/ai-schema';
import { SCENARIOS, createScenario } from '@blacksite/ai-scenarios';
import { distance, insideObstacle, lineClear } from '@blacksite/sim-core';
import { findPath } from '@blacksite/ai-nav';

const eye = (position: Vec3): Vec3 => ({ ...position, y: 1.5 });
const maps = SCENARIOS.map(scenario => createScenario(scenario.id, 8).map);
const visibleDistances = (map: TacticalMap): number[] => {
  const distances: number[] = [];
  for (let i = 0; i < map.nodes.length; i++) for (let j = i + 1; j < map.nodes.length; j++) {
    const a = map.nodes[i].position, b = map.nodes[j].position;
    if (lineClear(map, eye(a), eye(b))) distances.push(distance(a, b));
  }
  return distances.sort((a, b) => a - b);
};

describe('authored tactical layouts', () => {
  it.each(maps)('$id conceals both squads and the objective from every spawn', map => {
    for (const alpha of map.spawns.alpha) for (const bravo of map.spawns.bravo) expect(lineClear(map, eye(alpha), eye(bravo))).toBe(false);
    for (const spawn of [...map.spawns.alpha, ...map.spawns.bravo]) {
      expect(insideObstacle(map, spawn, .4)).toBe(false);
      expect(lineClear(map, eye(spawn), eye(map.objectives[0].position))).toBe(false);
    }
  });

  it.each(maps)('$id has capsule-safe routes from all 16 spawns, valid region centers, and explicit door/objective annotations', map => {
    const objective = map.objectives[0];
    expect(map.nodes.find(node => node.kind === 'objective')?.position).toEqual(objective.position);
    const portals = map.nodes.filter(node => node.id.startsWith('anchor:') && node.kind === 'entry');
    expect(portals.length).toBeGreaterThanOrEqual(4);
    for (const portal of portals) expect(portal.neighbors.length).toBeGreaterThanOrEqual(2);
    for (const region of map.regions) expect(insideObstacle(map, region.center, .4)).toBe(false);
    for (const spawn of [...map.spawns.alpha, ...map.spawns.bravo]) {
      const path = findPath(map, spawn, objective.position);
      expect(path.length).toBeGreaterThan(1);
      expect(path.at(-1)).toEqual(objective.position);
      let previous = spawn;
      for (const waypoint of path) {
        expect(insideObstacle(map, waypoint, .4)).toBe(false);
        expect(lineClear(map, previous, waypoint, .4)).toBe(true);
        previous = waypoint;
      }
    }
  });

  it.each(maps)('$id limits typical visibility to local rooms and approaches while retaining overwatch', map => {
    const distances = visibleDistances(map);
    // These are tactical-floor-node pairs at standing eye height, not the camera or tracer range.
    expect(distances[Math.floor(distances.length * .9)]).toBeLessThanOrEqual(19);
    expect(distances.at(-1)).toBeLessThan(35);
    expect(distances.some(value => value >= 12 && value <= 18)).toBe(true);
  });

  it('the arenas differ substantially in occupied floor geometry, not just map names or one obstacle', () => {
    const fingerprints = maps.map(map => {
      const occupied: boolean[] = [];
      for (let x = -22; x <= 22; x += 2) for (let z = -16; z <= 16; z += 2) occupied.push(insideObstacle(map, { x, y: 0, z }, .4));
      return occupied;
    });
    for (let i = 0; i < fingerprints.length; i++) for (let j = i + 1; j < fingerprints.length; j++) {
      const difference = fingerprints[i].filter((value, index) => value !== fingerprints[j][index]).length / fingerprints[i].length;
      expect(difference).toBeGreaterThan(.25);
    }
    expect(new Set(maps.map(map => `${map.objectives[0].position.x}:${map.objectives[0].position.z}`)).size).toBe(6);
  });

  it('a blocked single-file portal leaves a longer, physically distinct service route', () => {
    const map = createScenario('deadlock', 8).map;
    const original = findPath(map, map.spawns.alpha[0], map.objectives[0].position);
    const blocked = { ...map, version: `${map.version}/portal-closed`, obstacles: [...map.obstacles, { id: 'closed-portal', x: -14, z: 0, width: 2.4, depth: 1.5, height: 3.3 }] };
    const alternative = findPath(blocked, blocked.spawns.alpha[0], blocked.objectives[0].position);
    expect(original.length).toBeGreaterThan(0);
    expect(alternative.length).toBeGreaterThan(0);
    expect(alternative.some(point => Math.abs(point.z) > 13)).toBe(true);
    const length = (path: Vec3[]) => path.reduce((total, point, index) => total + distance(index === 0 ? map.spawns.alpha[0] : path[index - 1], point), 0);
    expect(length(alternative)).toBeGreaterThan(length(original) + 8);
  });
});
