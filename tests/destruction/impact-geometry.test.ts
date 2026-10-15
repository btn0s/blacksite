import { describe, expect, it } from 'vitest';
import type { FragmentDef, Vec3 } from '../../packages/destruction-domain/src/index';
import { fractureFragmentAtImpact } from '../../packages/destruction-physics/src/fracture';

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, n: number): Vec3 => [a[0] * n, a[1] * n, a[2] * n];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a));
const wall: FragmentDef = {
  id: 12,
  position: [4, 5, -7],
  size: [2, 2, 0.2],
  mass: 1920,
  material: 3,
  region: 2,
  aggregate: 1,
  anchored: true,
};

function faceNormal(points: Array<Vec3>): Vec3 {
  let area: Vec3 = [0, 0, 0];
  for (let i = 1; i + 1 < points.length; i++) {
    area = add(area, cross(sub(points[i]!, points[0]!), sub(points[i + 1]!, points[0]!)));
  }
  return unit(area);
}

function contains(fragment: FragmentDef, point: Vec3): boolean {
  const local = sub(point, fragment.position);
  return fragment.shape!.faces.every((face) => {
    const points = face.vertices.map((index) => fragment.shape!.vertices[index]!);
    return dot(faceNormal(points), sub(local, points[0]!)) <= 1e-8;
  });
}

function expectSolid(fragment: FragmentDef): void {
  const shape = fragment.shape!;
  expect(shape.vertices.length).toBeLessThanOrEqual(64);
  expect(shape.faces.length).toBeLessThanOrEqual(128);
  const edges = new Map<string, Array<[number, number]>>();
  let volume = 0;
  let moment: Vec3 = [0, 0, 0];
  for (const face of shape.faces) {
    const points = face.vertices.map((index) => shape.vertices[index]!);
    const normal = faceNormal(points);
    expect(normal.every(Number.isFinite)).toBe(true);
    expect(dot(normal, points[0]!)).toBeGreaterThan(0);
    for (const point of shape.vertices) {
      expect(dot(normal, sub(point, points[0]!))).toBeLessThanOrEqual(1e-8);
    }
    for (let i = 1; i + 1 < points.length; i++) {
      const v = dot(points[0]!, cross(points[i]!, points[i + 1]!)) / 6;
      volume += v;
      moment = add(moment, scale(add(add(points[0]!, points[i]!), points[i + 1]!), v / 4));
    }
    for (let i = 0; i < face.vertices.length; i++) {
      const a = face.vertices[i]!;
      const b = face.vertices[(i + 1) % face.vertices.length]!;
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      edges.set(key, [...(edges.get(key) ?? []), [a, b]]);
    }
  }
  for (const occurrences of edges.values()) {
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0]).toEqual(occurrences[1]!.slice().reverse());
  }
  expect(volume).toBeCloseTo(shape.volume, 12);
  for (const value of moment) {
    expect(value / volume).toBeCloseTo(0, 8);
  }
  const [xx, yy, zz, xy, xz, yz] = shape.inertia;
  expect(xx).toBeGreaterThan(0);
  expect(xx * yy - xy * xy).toBeGreaterThan(0);
  expect(xx * (yy * zz - yz * yz) - xy * (xy * zz - xz * yz) + xz * (xy * yz - xz * yy)).toBeGreaterThan(0);
}

function expectConservation(parent: FragmentDef, children: Array<FragmentDef>): void {
  const volume = parent.shape?.volume ?? parent.size[0] * parent.size[1] * parent.size[2];
  expect(children.reduce((sum, child) => sum + child.shape!.volume, 0)).toBeCloseTo(volume, 12);
  expect(children.reduce((sum, child) => sum + child.mass, 0)).toBeCloseTo(parent.mass, 8);
  const moment = children.reduce((sum, child) => add(sum, scale(child.position, child.mass)), [0, 0, 0] as Vec3);
  moment.forEach((value) => expect(value).toBeCloseTo(0, 8));
  const inertia = [0, 0, 0, 0, 0, 0];
  for (const child of children) {
    const [x, y, z] = child.position;
    const m = child.mass;
    const parallel = [m * (y * y + z * z), m * (x * x + z * z), m * (x * x + y * y), -m * x * y, -m * x * z, -m * y * z];
    inertia.forEach((value, axis) => { inertia[axis] = value + child.shape!.inertia[axis]! + parallel[axis]!; });
  }
  const [x, y, z] = parent.size;
  const m = parent.mass;
  const expected = parent.shape?.inertia ?? [m * (y * y + z * z) / 12, m * (x * x + z * z) / 12, m * (x * x + y * y) / 12, 0, 0, 0];
  inertia.forEach((value, axis) => expect(value).toBeCloseTo(expected[axis]!, 8));
  children.forEach(expectSolid);
}

function hitFace(parent: FragmentDef, radius: number, depth: number, seed: number) {
  for (const face of parent.shape!.faces) {
    const points = face.vertices.map((index) => parent.shape!.vertices[index]!);
    const point = scale(points.reduce(add, [0, 0, 0]), 1 / points.length);
    const result = fractureFragmentAtImpact(parent, point, scale(faceNormal(points), -1), radius, depth, seed);
    if (result) {
      return result;
    }
  }
  return undefined;
}

describe('localized impact fracture geometry', () => {
  it('removes centimeter-scale chips at the hit while conserving the complete wall solid', () => {
    const point: Vec3 = [0.13, 0.2, 0.1];
    const result = fractureFragmentAtImpact(wall, point, [0, 0, -1], 0.07, 0.09, 2048)!;
    expect(result).toBeDefined();
    expect(result.retained.length).toBeLessThanOrEqual(5);
    expect(result.detached).toHaveLength(4);
    const children = [...result.retained, ...result.detached];
    expectConservation(wall, children);
    expect(result.detached.reduce((sum, chip) => sum + chip.mass, 0)).toBeLessThan(wall.mass * 0.001);
    for (const chip of result.detached) {
      for (const vertex of chip.shape!.vertices) {
        const relative = sub(add(vertex, chip.position), point);
        expect(Math.hypot(relative[0], relative[1])).toBeLessThanOrEqual(0.07 + 1e-8);
        expect(-relative[2]).toBeGreaterThanOrEqual(-1e-8);
        expect(-relative[2]).toBeLessThanOrEqual(0.09 + 1e-8);
      }
    }
    const cavity: Vec3 = [point[0], point[1], point[2] - 0.02];
    expect(result.retained.some((fragment) => contains(fragment, cavity))).toBe(false);
    expect(result.detached.some((fragment) => contains(fragment, cavity))).toBe(true);
    for (let i = 1; i < 300; i++) {
      const sample: Vec3 = [((i * 13) % 307) / 307 * 1.98 - 0.989, ((i * 37) % 311) / 311 * 1.98 - 0.987, ((i * 47) % 313) / 313 * 0.198 - 0.0987];
      expect(children.filter((fragment) => contains(fragment, sample))).toHaveLength(1);
    }
    for (const child of children) {
      for (const face of child.shape!.faces) {
        if (face.surface === 'exterior') {
          expect([0, 1, 2].some((axis) => [-1, 1].some((sign) => face.vertices.every((index) => Math.abs(child.shape!.vertices[index]![axis]! + child.position[axis]! - sign * wall.size[axis]! / 2) < 1e-8)))).toBe(true);
        }
      }
    }
  });

  it('supports repeated strikes on the remaining hull and tertiary strikes on fallen chips', () => {
    const initial = fractureFragmentAtImpact(wall, [0, 0, 0.1], [0, 0, -1], 0.1, 0.12, 12)!;
    const remaining = initial.retained.reduce((a, b) => a.mass > b.mass ? a : b);
    const next = hitFace(remaining, 0.025, 0.04, 32)!;
    expect(next).toBeDefined();
    expectConservation(remaining, [...next.retained, ...next.detached]);
    for (const child of [...next.retained, ...next.detached]) {
      for (const vertex of child.shape!.vertices) {
        expect(contains({ ...remaining, position: [0, 0, 0] }, add(vertex, child.position))).toBe(true);
      }
    }
    let rubble = initial.detached.reduce((a, b) => a.mass > b.mass ? a : b);
    for (let generation = 0; generation < 3; generation++) {
      const split = hitFace(rubble, 0.012 / (generation + 1), 0.018 / (generation + 1), generation + 8)!;
      expect(split).toBeDefined();
      expectConservation(rubble, [...split.retained, ...split.detached]);
      rubble = split.retained.reduce((a, b) => a.mass > b.mass ? a : b);
    }
  });

  it('handles oblique impacts through a thin wall with bounded, closed geometry', () => {
    const thin: FragmentDef = { ...wall, size: [1, 1, 0.012], mass: 28.8 };
    const direction = unit([0.5, 0.3, -1]);
    const point: Vec3 = [0.1, 0.1, 0.006];
    for (let seed = 1; seed <= 12; seed++) {
      const result = fractureFragmentAtImpact(thin, point, direction, 0.025, 0.07, seed)!;
      expect(result).toBeDefined();
      expectConservation(thin, [...result.retained, ...result.detached]);
      expect(result.axis).toEqual([0, 0, -1]);
      expect(result.retained).toHaveLength(4);
      expect(result.detached).toHaveLength(4);
      for (const chip of result.detached) {
        for (const vertex of chip.shape!.vertices) {
          const relative = sub(add(vertex, chip.position), point);
          const distance = dot(relative, result.axis);
          expect(distance).toBeGreaterThanOrEqual(-1e-9);
          expect(distance).toBeLessThanOrEqual(0.012 + 1e-9);
          expect(Math.hypot(...sub(relative, scale(result.axis, distance)))).toBeLessThanOrEqual(0.025 * Math.sqrt(-direction[2]) + 1e-8);
        }
      }
    }
  });

  it('is seeded, deterministic, translation-independent, and leaves authored source untouched', () => {
    const before = structuredClone(wall);
    const first = fractureFragmentAtImpact(wall, [0, 0, 0.1], [0, 0, -1], 0.07, 0.09, 4);
    expect(fractureFragmentAtImpact(wall, [0, 0, 0.1], [0, 0, -1], 0.07, 0.09, 4)).toEqual(first);
    expect(fractureFragmentAtImpact(wall, [0, 0, 0.1], [0, 0, -1], 0.07, 0.09, 5)).not.toEqual(first);
    expect(fractureFragmentAtImpact({ ...wall, position: [100, -20, 65] }, [0, 0, 0.1], [0, 0, -1], 0.07, 0.09, 4)).toEqual(first);
    expect(wall).toEqual(before);
  });

  it('tolerates ray-collider rounding just inside or outside the struck surface', () => {
    for (const offset of [-1e-5, -1e-7, 1e-7, 1e-5]) {
      const result = fractureFragmentAtImpact(wall, [0, 0, 0.1 + offset], [0, 0, -1], 0.07, 0.09, 4)!;
      expect(result).toBeDefined();
      expectConservation(wall, [...result.retained, ...result.detached]);
    }
  });

  it('preserves authored fracture-face labels on recut geometry', () => {
    const initial = fractureFragmentAtImpact(wall, [0, 0, 0.1], [0, 0, -1], 0.1, 0.12, 9)!;
    const parent = structuredClone(initial.retained[0]!);
    for (const face of parent.shape!.faces) {
      face.surface = 'fracture';
    }
    const result = hitFace(parent, 0.02, 0.03, 40)!;
    expect(result).toBeDefined();
    for (const fragment of [...result.retained, ...result.detached]) {
      expect(fragment.shape!.faces.every((face) => face.surface === 'fracture')).toBe(true);
    }
  });

  it('rejects missed surfaces, reversed rays, numerical dust and invalid input', () => {
    expect(fractureFragmentAtImpact(wall, [20, 20, 20], [0, 0, -1], 0.07, 0.09, 1)).toBeUndefined();
    expect(fractureFragmentAtImpact(wall, [0, 0, 0.1], [0, 0, 1], 0.07, 0.09, 1)).toBeUndefined();
    expect(fractureFragmentAtImpact(wall, [0, 0, 0.1], [0, 0, 0], 0.07, 0.09, 1)).toBeUndefined();
    expect(fractureFragmentAtImpact(wall, [0, 0, 0.1], [0, 0, -1], 1e-7, 1e-7, 1)).toBeUndefined();
    expect(fractureFragmentAtImpact(wall, [NaN, 0, 0.1], [0, 0, -1], 0.07, 0.09, 1)).toBeUndefined();
    expect(fractureFragmentAtImpact({ ...wall, mass: 0 }, [0, 0, 0.1], [0, 0, -1], 0.07, 0.09, 1)).toBeUndefined();
  });
});
