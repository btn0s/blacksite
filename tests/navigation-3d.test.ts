import { describe, expect, it } from 'vitest';
import { buildNavigationMesh } from '../packages/ai-nav/src/navigation';
import type { NavigationGeometry, NavigationPoint } from '../packages/ai-nav/src/navigation';
import { createNavigationCrowd } from '../packages/ai-nav/src/crowd';
import type { NavigationCrowdAgent } from '../packages/ai-nav/src/crowd';

function geometry(upper = true, ramp = true): NavigationGeometry {
  const positions: Array<number> = [];
  const indices: Array<number> = [];
  const quad = (a: NavigationPoint, b: NavigationPoint, c: NavigationPoint, d: NavigationPoint) => {
    const index = positions.length / 3;
    positions.push(...a, ...b, ...c, ...d);
    indices.push(index, index + 1, index + 2, index, index + 2, index + 3);
  };
  quad([-12, 0, -12], [-12, 0, 12], [12, 0, 12], [12, 0, -12]);
  if (upper) {
    quad([2, 3, -3], [2, 3, 3], [8, 3, 3], [8, 3, -3]);
  }
  if (ramp) {
    quad([-6, 0, -2], [-6, 0, 2], [2, 3, 2], [2, 3, -2]);
  }
  return { indices, positions };
}

const from: NavigationPoint = [-9, 0, 0];
const upper: NavigationPoint = [5, 3, 0];
const lower: NavigationPoint = [5, 0, 0];

function agent(id: string, position: NavigationPoint, preferredVelocity: NavigationPoint, controlled = false): NavigationCrowdAgent {
  return { controlled, id, maxSpeed: 3, position, preferredVelocity, velocity: [0, 0, 0] };
}

describe('standalone Warden navigation', () => {
  it('builds both floors and routes through the authored ramp without flattening height', () => {
    const navigation = buildNavigationMesh(geometry());
    expect(navigation.project(upper)?.position[1]).toBeCloseTo(3, 0);
    expect(navigation.project(lower)?.position[1]).toBeCloseTo(0, 0);
    const route = navigation.path(from, upper);
    expect(route.length).toBeGreaterThan(1);
    expect(route.at(-1)?.[1]).toBeCloseTo(3, 0);
    expect(navigation.project(from)?.island).toBe(navigation.project(upper)?.island);
    expect(navigation.canTraverse(lower, upper)).toBe(false);
    expect(navigation.canTraverse([3, 3, 0], [7, 3, 0])).toBe(true);
    expect(navigation.samplePoints().some(sample => sample.point[1] > 2.8)).toBe(true);
    expect(navigation.samplePoints().some(sample => sample.point[1] < 0.3)).toBe(true);
    navigation.dispose();
  });

  it('keeps disconnected floors unreachable even with matching horizontal coordinates', () => {
    const navigation = buildNavigationMesh(geometry(true, false));
    expect(navigation.project(lower)?.island).not.toBe(navigation.project(upper)?.island);
    expect(navigation.path(lower, upper)).toEqual([]);
    expect(navigation.canTraverse(lower, upper)).toBe(false);
    expect(navigation.path([3, 3, 0], upper).length).toBeGreaterThan(0);
    navigation.dispose();
  });

  it('uses collision triangles for sight across and below decks', () => {
    const navigation = buildNavigationMesh(geometry(true, false));
    expect(navigation.hasLineOfSight([5, 1.4, 0], [5, 4.4, 0])).toBe(false);
    expect(navigation.hasLineOfSight([3, 1.4, 0], [7, 1.4, 0])).toBe(true);
    expect(navigation.hasLineOfSight([3, 4.4, 0], [7, 4.4, 0])).toBe(true);
    navigation.dispose();
  });

  it('rebuilds queries, samples, islands and sight together on geometry changes', () => {
    const navigation = buildNavigationMesh(geometry(true, false));
    expect(navigation.hasLineOfSight([5, 1.4, 0], [5, 4.4, 0])).toBe(false);
    const previous = navigation.navMesh;
    navigation.rebuild(geometry(false, false));
    expect(navigation.revision).toBe(1);
    expect(navigation.navMesh).not.toBe(previous);
    expect(navigation.samplePoints().every(sample => sample.point[1] < 0.3)).toBe(true);
    expect(navigation.hasLineOfSight([5, 1.4, 0], [5, 4.4, 0])).toBe(true);
    expect(navigation.project(upper)).toBeNull();
    navigation.dispose();
    expect(() => navigation.path(from, lower)).toThrow('disposed');
  });

  it('uses a supplied repeatable random stream and rejects invalid geometry', () => {
    const navigation = buildNavigationMesh(geometry(false, false));
    const random = () => 0.375;
    const point = navigation.randomPoint(random);
    expect(point).not.toBeNull();
    expect(navigation.randomPoint(random)).toEqual(point);
    expect(() => navigation.randomPoint(() => Number.NaN)).toThrow('random');
    expect(() => buildNavigationMesh({ indices: [0, 1, 4], positions: [0, 0, 0, 0, 0, 1, 1, 0, 1] })).toThrow('indices');
    expect(() => buildNavigationMesh({ indices: [0, 1, 2], positions: [0, 0, 0, 0, Number.NaN, 1, 1, 0, 1] })).toThrow('finite');
    navigation.dispose();
  });
});

describe('standalone Warden crowd', () => {
  it('returns deterministic bounded avoidance velocities and leaves stationary commitments fixed', () => {
    const navigation = buildNavigationMesh(geometry(false, false));
    const one = createNavigationCrowd(navigation);
    const two = createNavigationCrowd(navigation);
    const inputs = [agent('first', [-0.5, 0, 0], [3, 0, 0]), agent('second', [0.5, 0, 0], [-3, 0, 0]), agent('hold', [0, 0, 1], [0, 0, 0])];
    const initial = JSON.stringify(inputs);
    for (let tick = 0; tick < 12; tick++) {
      const a = one.update(inputs, 1 / 60);
      const b = two.update(inputs, 1 / 60);
      expect([...a]).toEqual([...b]);
      for (const velocity of a.values()) {
        expect(velocity.every(Number.isFinite)).toBe(true);
        expect(Math.hypot(...velocity)).toBeLessThanOrEqual(3.000001);
      }
      expect(a.get('hold')).toEqual([0, 0, 0]);
      expect(a.get('first')).not.toEqual([3, 0, 0]);
    }
    expect(JSON.stringify(inputs)).toBe(initial);
    one.dispose();
    two.dispose();
    navigation.dispose();
  });

  it('preserves human commands, removes missing members, and survives navigation rebuilds', () => {
    const navigation = buildNavigationMesh(geometry(false, false));
    const simulation = createNavigationCrowd(navigation);
    const human = agent('human', [-1, 0, 0], [3, 0, 0], true);
    const bot = agent('bot', [1, 0, 0], [-3, 0, 0]);
    expect(simulation.update([human, bot], 1 / 60).get('human')).toEqual([3, 0, 0]);
    const solo = simulation.update([bot], 1 / 60);
    expect([...solo.keys()]).toEqual(['bot']);
    expect(Math.hypot(...solo.get('bot')!)).toBeGreaterThan(1);
    navigation.rebuild(geometry(false, false));
    expect(simulation.update([bot], 1 / 60).get('bot')?.every(Number.isFinite)).toBe(true);
    simulation.dispose();
    expect(() => simulation.update([bot], 1 / 60)).toThrow('disposed');
    navigation.dispose();
  });
});
