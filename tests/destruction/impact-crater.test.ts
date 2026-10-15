import { describe, expect, it } from 'vitest';
import {
  FragmentState,
  MAX_SECONDARY_DEFINITION_BYTES,
  type FragmentDef,
  type SimulationFrame,
  type Vec3,
} from '../../packages/destruction-domain/src/index';
import { encodeSnapshot } from '../../packages/destruction-network/src/index';
import {
  crossSectionArea,
  fractureFragmentAtImpact,
  MIN_IMPACT_VOLUME,
  MIN_IMPACT_WIDTH,
} from '../../packages/destruction-physics/src/fracture';

type Partition = NonNullable<ReturnType<typeof fractureFragmentAtImpact>>;

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
const mean = (points: Array<Vec3>): Vec3 => scale(points.reduce(add, [0, 0, 0]), 1 / points.length);

const AKM_RADIUS = (0.499 * 0.22) / Math.sqrt(1.2);
const AKM_DEPTH = (0.499 * 0.2) / Math.sqrt(1.2);
const box: FragmentDef = {
  aggregate: 0,
  anchored: true,
  id: 4,
  mass: 2350,
  material: 0,
  position: [3, 1, -2],
  region: 1,
  size: [1, 1, 1],
};
const cell: FragmentDef = {
  aggregate: 0,
  anchored: true,
  id: 3,
  mass: 2350 * 0.75 * 0.75 * 0.5,
  material: 0,
  position: [-7.625, 0.375, 2.25],
  region: 0,
  size: [0.75, 0.75, 0.5],
};

function rotate(vector: Vec3, axis: Vec3, angle: number): Vec3 {
  const k = unit(axis);
  return add(
    add(scale(vector, Math.cos(angle)), scale(cross(k, vector), Math.sin(angle))),
    scale(k, dot(k, vector) * (1 - Math.cos(angle))),
  );
}

function facePoints(fragment: FragmentDef, face: { vertices: Array<number> }): Array<Vec3> {
  return face.vertices.map((index) => add(fragment.position, fragment.shape!.vertices[index]!));
}

function faceNormal(points: Array<Vec3>): Vec3 {
  let area: Vec3 = [0, 0, 0];
  for (let i = 1; i + 1 < points.length; i++) {
    area = add(area, cross(sub(points[i]!, points[0]!), sub(points[i + 1]!, points[0]!)));
  }
  return unit(area);
}

function boxHull(fragment: FragmentDef): FragmentDef {
  if (fragment.shape) {
    return fragment;
  }
  const [x, y, z] = fragment.size.map((value) => value / 2) as Vec3;
  const vertices: Array<Vec3> = [
    [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
    [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],
  ];
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]];
  return {
    ...fragment,
    position: [0, 0, 0],
    shape: {
      faces: faces.map((indices) => ({ surface: 'exterior', vertices: indices })),
      inertia: [1, 1, 1, 0, 0, 0],
      vertices,
      volume: fragment.size[0] * fragment.size[1] * fragment.size[2],
    },
  };
}

function signedDistance(fragment: FragmentDef, point: Vec3): number {
  return Math.max(
    ...fragment.shape!.faces.map((face) => {
      const points = facePoints(fragment, face);
      return dot(faceNormal(points), sub(point, points[0]!));
    }),
  );
}

function strictlyInside(fragment: FragmentDef, point: Vec3, margin = 1e-7): boolean {
  return signedDistance(fragment, point) < -margin;
}

function widths(fragment: FragmentDef): Array<number> {
  const vertices = fragment.shape!.vertices;
  return fragment.shape!.faces.map((face) => {
    const normal = faceNormal(face.vertices.map((index) => vertices[index]!));
    const projections = vertices.map((vertex) => dot(normal, vertex));
    return Math.max(...projections) - Math.min(...projections);
  });
}

function networkHullCheck(fragment: FragmentDef): void {
  const shape = fragment.shape!;
  const tolerance = 1e-6 * Math.max(1, ...fragment.size);
  const edges = new Map<string, number>();
  for (const face of shape.faces) {
    expect(new Set(face.vertices).size).toBe(face.vertices.length);
    const points = face.vertices.map((index) => shape.vertices[index]!);
    let area: Vec3 = [0, 0, 0];
    for (let i = 1; i + 1 < points.length; i++) {
      area = add(area, cross(sub(points[i]!, points[0]!), sub(points[i + 1]!, points[0]!)));
    }
    expect(Math.hypot(...area)).toBeGreaterThan(1e-12);
    const normal = unit(area);
    for (const vertex of shape.vertices) {
      expect(dot(normal, sub(vertex, points[0]!))).toBeLessThanOrEqual(tolerance);
    }
    face.vertices.forEach((a, i) => {
      const b = face.vertices[(i + 1) % face.vertices.length]!;
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      edges.set(key, (edges.get(key) ?? 0) + (a < b ? 1 : -1) * 1000 + 1);
    });
  }
  for (const value of edges.values()) {
    expect(value).toBe(2);
  }
}

function encodePieces(parent: FragmentDef, pieces: Array<FragmentDef>): ArrayBuffer {
  const fragments = pieces.map((piece, index) => ({
    ...piece,
    generation: 1,
    id: 1000 + index,
    parentId: 7,
    position: add(parent.position, piece.position),
    rootId: 7,
  }));
  const transforms = new Float32Array(fragments.length * 8);
  fragments.forEach((fragment, index) => {
    transforms.set([...fragment.position, 0, 0, 0, 1, 0], index * 8);
  });
  const frame: SimulationFrame = {
    bondStates: new Uint8Array(0),
    events: [],
    secondary: {
      fragments,
      revision: 1,
      states: new Uint8Array(fragments.length).fill(FragmentState.Dynamic),
      transforms,
    },
    states: new Uint8Array(0),
    stats: { checksum: '00000000' } as SimulationFrame['stats'],
    tick: 1,
    transforms: new Float32Array(0),
    type: 'frame',
  };
  return encodeSnapshot(frame);
}

function expectPartition(parent: FragmentDef, result: Partition): void {
  const pieces = [...result.retained, ...result.detached];
  const volume = parent.shape?.volume ?? parent.size[0] * parent.size[1] * parent.size[2];
  expect(pieces.reduce((sum, piece) => sum + piece.shape!.volume, 0)).toBeCloseTo(volume, 12);
  expect(pieces.reduce((sum, piece) => sum + piece.mass, 0)).toBeCloseTo(parent.mass, 8);
  const moment = pieces.reduce((sum, piece) => add(sum, scale(piece.position, piece.mass)), [0, 0, 0] as Vec3);
  moment.forEach((value) => expect(value / parent.mass).toBeCloseTo(0, 9));
  const inertia = [0, 0, 0, 0, 0, 0];
  for (const piece of pieces) {
    const [x, y, z] = piece.position;
    const m = piece.mass;
    const parallel = [m * (y * y + z * z), m * (x * x + z * z), m * (x * x + y * y), -m * x * y, -m * x * z, -m * y * z];
    inertia.forEach((value, axis) => {
      inertia[axis] = value + piece.shape!.inertia[axis]! + parallel[axis]!;
    });
  }
  const [sx, sy, sz] = parent.size;
  const m = parent.mass;
  const expected = parent.shape?.inertia ?? [m * (sy * sy + sz * sz) / 12, m * (sx * sx + sz * sz) / 12, m * (sx * sx + sy * sy) / 12, 0, 0, 0];
  inertia.forEach((value, axis) => expect(value).toBeCloseTo(expected[axis]!, 8));
  for (const piece of pieces) {
    expect(piece.anchored).toBe(false);
    expect(piece.material).toBe(parent.material);
    expect(piece.region).toBe(parent.region);
    expect(piece.shape!.volume).toBeGreaterThanOrEqual(MIN_IMPACT_VOLUME);
    expect(Math.min(...widths(piece))).toBeGreaterThanOrEqual(MIN_IMPACT_WIDTH - 1e-12);
    expect(piece.shape!.vertices.length).toBeLessThanOrEqual(64);
    expect(piece.shape!.faces.length).toBeLessThanOrEqual(128);
    networkHullCheck(piece);
  }
  expect(pieces.map((piece) => piece.id)).toEqual(pieces.map((_, index) => index));
  for (const piece of pieces) {
    const definition = { ...piece, generation: 8, id: 16_777_216, parentId: 16_777_215, position: add(parent.position, piece.position), rootId: 65_535 };
    expect(new TextEncoder().encode(JSON.stringify(definition)).byteLength).toBeLessThanOrEqual(MAX_SECONDARY_DEFINITION_BYTES);
  }
  expect(() => encodePieces(parent, pieces)).not.toThrow();
  expect(Math.hypot(...result.axis)).toBeCloseTo(1, 12);
}

function floorOwners(result: Partition, floorPoint: Vec3): Array<FragmentDef> {
  const axis = result.axis;
  return result.retained.filter((piece) =>
    piece.shape!.faces.some((face) => {
      const world = facePoints(piece, face);
      if (!world.every((point) => Math.abs(dot(axis, sub(point, floorPoint))) < 1e-9)) {
        return false;
      }
      const normal = faceNormal(world);
      return world.every((point, index) => {
        const next = world[(index + 1) % world.length]!;
        return dot(normal, cross(sub(next, point), sub(floorPoint, point))) >= -1e-12;
      });
    }),
  );
}

function frustumVolume(half: number, depth: number, reach: number): number {
  const apex = depth * 3;
  return (4 * half * half * apex * (1 - (1 - reach / apex) ** 3)) / 3;
}

function canExit(chip: FragmentDef, axis: Vec3, obstacles: Array<FragmentDef>, travel: number): boolean {
  const center = chip.position;
  const samples = [
    center,
    ...chip.shape!.vertices.map((vertex) => add(center, scale(vertex, 0.98))),
  ];
  for (let step = 0; step <= 40; step++) {
    const shift = scale(axis, (-travel * step) / 40);
    for (const sample of samples) {
      if (obstacles.some((obstacle) => strictlyInside(obstacle, add(sample, shift), 1e-6))) {
        return false;
      }
    }
  }
  return true;
}

function rayEntry(fragment: FragmentDef, origin: Vec3, direction: Vec3): number | undefined {
  let enter = -Infinity;
  let leave = Infinity;
  for (const face of fragment.shape!.faces) {
    const points = facePoints(fragment, face);
    const normal = faceNormal(points);
    const approach = dot(normal, direction);
    const distance = dot(normal, sub(origin, points[0]!));
    if (Math.abs(approach) < 1e-12) {
      if (distance > -1e-9) {
        return undefined;
      }
    } else if (approach < 0) {
      enter = Math.max(enter, -distance / approach);
    } else {
      leave = Math.min(leave, -distance / approach);
    }
  }
  return leave - enter > 1e-7 ? enter : undefined;
}

function translated(fragment: FragmentDef, offset: Vec3): FragmentDef {
  return { ...fragment, position: add(fragment.position, offset) };
}

describe('crater impact fracture', { timeout: 60_000 }, () => {
  it('partitions mass, volume, centre of mass and inertia exactly with a local frustum crater', () => {
    const wall: FragmentDef = { ...box, mass: 1920, size: [2, 2, 0.2] };
    const point: Vec3 = [0.13, 0.2, 0.1];
    const radius = 0.07;
    const depth = 0.05;
    const result = fractureFragmentAtImpact(wall, point, [0, 0, -1], radius, depth, 2048)!;
    expect(result).toBeDefined();
    expectPartition(wall, result);
    expect(result.axis).toEqual([0, 0, -1]);
    expect(result.retained).toHaveLength(5);
    expect(result.detached).toHaveLength(4);
    const half = radius / Math.SQRT2;
    const nominal = frustumVolume(half, depth, depth);
    const removed = result.detached.reduce((sum, chip) => sum + chip.shape!.volume, 0);
    expect(removed).toBeCloseTo(nominal, 12);
    for (const chip of result.detached) {
      for (const vertex of chip.shape!.vertices) {
        const local = sub(add(chip.position, vertex), point);
        const sink = -local[2];
        expect(sink).toBeGreaterThanOrEqual(-1e-9);
        expect(sink).toBeLessThanOrEqual(depth + 1e-9);
        expect(Math.hypot(local[0], local[1])).toBeLessThanOrEqual(radius * (1 - sink / (3 * depth)) + 1e-9);
      }
    }
    for (let i = 0; i < 400; i++) {
      const sample: Vec3 = [
        (((i * 13) % 401) / 401) * 1.98 - 0.99,
        (((i * 37) % 409) / 409) * 1.98 - 0.99,
        (((i * 47) % 419) / 419) * 0.198 - 0.099,
      ];
      const owners = [...result.retained, ...result.detached].filter((piece) => strictlyInside(piece, sample, 1e-9));
      expect(owners.length).toBeLessThanOrEqual(1);
      if (Math.hypot(sample[0] - point[0], sample[1] - point[1]) > radius || sample[2] < point[2] - depth) {
        expect(result.detached.some((chip) => strictlyInside(chip, sample, 0))).toBe(false);
        expect(owners).toHaveLength(1);
      }
    }
  });

  it('keeps exterior craters surface-normal, scales depth by incidence and succeeds for every tilt on a box and a concrete cell', () => {
    const tilts = [0, 1e-9, 1e-7, 1e-6, 1e-4, 1e-2, 0.3];
    for (const parent of [box, cell]) {
      const top = parent.size[2] / 2;
      for (const tilt of tilts) {
        for (const [index, surface] of ([[0, 0, top], [0.17, -0.21, top], [-0.2, 0.09, top]] as Array<Vec3>).entries()) {
          const direction = rotate([0, 0, -1], [Math.cos(index + tilt), Math.sin(index + tilt), 0], tilt);
          for (const seed of [1, 77, 4096]) {
            const result = fractureFragmentAtImpact(parent, surface, direction, AKM_RADIUS, AKM_DEPTH, seed);
            expect(result, `${parent.size} tilt ${tilt} point ${surface} seed ${seed}`).toBeDefined();
            expectPartition(parent, result!);
            expect(result!.axis[2]).toBe(-1);
            const sink = AKM_DEPTH * Math.max(Math.cos(tilt), 0.35);
            expect(floorOwners(result!, add(surface, [0, 0, -sink]))).toHaveLength(1);
          }
        }
      }
    }
  });

  it('fractures a body whose local frame carries rotation rounding', () => {
    const error = 3e-6;
    const spin: Vec3 = [0.3, 0.8, 0.52];
    for (const parent of [box, cell]) {
      const top = parent.size[2] / 2;
      for (const surface of [[0, 0, top], [0.11, 0.07, top]] as Array<Vec3>) {
        for (const seed of [3, 19, 2024]) {
          const point = rotate(surface, spin, error);
          const direction = rotate([0, 0, -1], spin, error);
          expect(Math.hypot(...sub(point, surface))).toBeGreaterThan(1e-7);
          expect(Math.hypot(direction[0], direction[1])).toBeGreaterThan(1e-6);
          const result = fractureFragmentAtImpact(parent, point, direction, AKM_RADIUS, AKM_DEPTH, seed)!;
          expect(result).toBeDefined();
          expectPartition(parent, result);
          expect(result.axis).toEqual([0, 0, -1]);
          expect(floorOwners(result, [point[0], point[1], top - AKM_DEPTH])).toHaveLength(1);
        }
      }
    }
  });

  it('ties repeat-hit depth to the narrowing opening so same-point fire never opens a line of sight through the cell', () => {
    const surface: Vec3 = [0.05, -0.08, 0.25];
    let parent: FragmentDef = cell;
    let offset: Vec3 = [0, 0, 0];
    let entry = surface[2];
    let generation = 0;
    let state: Array<FragmentDef> = [boxHull(cell)];
    const sinks: Array<number> = [];
    const clamped = { contained: 0, minimum: 0 };
    let consumed = false;
    while (generation < 20) {
      const local = sub(surface, offset);
      const result = fractureFragmentAtImpact(parent, local, [0, 0, -1], AKM_RADIUS, AKM_DEPTH, 900 + generation);
      if (!result) {
        consumed = true;
        expect(entry + 0.25).toBeLessThan(1.25 * 1.25 * 0.015);
        break;
      }
      expectPartition(parent, result);
      generation++;
      expect(Math.hypot(...sub(result.axis, [0, 0, -1]))).toBeLessThan(1e-12);
      for (const chip of result.detached) {
        expect(Math.max(...chip.size) / Math.min(...chip.size)).toBeLessThanOrEqual(4);
      }
      const owner = result.retained
        .map((piece) => ({ piece, top: rayEntry(piece, [local[0], local[1], 1], [0, 0, -1]) }))
        .filter((candidate) => candidate.top !== undefined)
        .reduce<{ piece: FragmentDef; top: number } | undefined>(
          (best, candidate) => (!best || candidate.top! < best.top ? (candidate as { piece: FragmentDef; top: number }) : best),
          undefined,
        );
      expect(owner, `generation ${generation} opened a through-hole`).toBeDefined();
      const floor = 1 - owner!.top;
      const sink = entry - offset[2] - floor;
      expect(floorOwners(result, [local[0], local[1], floor])).toEqual([owner!.piece]);
      expect(sink).toBeGreaterThan(0);
      expect(sink).toBeLessThanOrEqual(AKM_DEPTH + 1e-9);
      const opening = Math.max(
        ...result.detached.flatMap((chip) =>
          chip.shape!.vertices.map((vertex) => {
            const p = add(chip.position, vertex);
            return Math.hypot(p[0] - local[0], p[1] - local[1]);
          }),
        ),
      );
      if (generation === 1) {
        expect(sink).toBeCloseTo(AKM_DEPTH, 9);
      } else {
        expect(sink).toBeLessThan(AKM_DEPTH);
        expect(sink).toBeLessThanOrEqual(sinks[sinks.length - 1]! + 1e-9);
      }
      sinks.push(sink);
      const entered = parent.shape
        ? parent.shape.faces
            .map((face) => face.vertices.map((index) => parent.shape!.vertices[index]!))
            .find((points) => points.every((p) => Math.abs(p[2] - (entry - offset[2])) < 1e-9))!
        : undefined;
      if (entered) {
        const inscribed = Math.min(
          ...entered.map((point, index) => {
            const next = entered[(index + 1) % entered.length]!;
            const edge = sub(next, point);
            return Math.abs(cross(edge, sub(local, point))[2]) / Math.hypot(...edge);
          }),
        );
        if ((0.9 * inscribed) / Math.SQRT2 >= 0.015) {
          clamped.contained++;
          expect(sink).toBeCloseTo(Math.min(AKM_DEPTH, (1.25 * opening) / Math.SQRT2), 9);
        } else {
          clamped.minimum++;
          expect(sink).toBeCloseTo(Math.min(AKM_DEPTH, 1.25 * 0.015), 9);
        }
        for (const chip of result.detached) {
          for (const vertex of chip.shape!.vertices) {
            const p = add(chip.position, vertex);
            if ((0.9 * inscribed) / Math.SQRT2 >= 0.015) {
              entered.forEach((point, index) => {
                const next = entered[(index + 1) % entered.length]!;
                expect(cross(sub(next, point), sub(p, point))[2]).toBeGreaterThanOrEqual(-1e-12);
              });
            } else {
              expect(Math.hypot(p[0] - local[0], p[1] - local[1])).toBeLessThanOrEqual(Math.max(inscribed, 0.015) * Math.SQRT2 + 1e-9);
            }
          }
        }
      }
      state = [
        ...state.slice(0, -1),
        ...result.retained.filter((piece) => piece !== owner!.piece).map((piece) => translated(piece, offset)),
        translated(owner!.piece, offset),
      ];
      const travel = 0.25 - (entry - sink) + 0.05;
      for (const chip of result.detached) {
        expect(canExit(translated(chip, offset), result.axis, state, travel)).toBe(true);
      }
      expect(state.some((piece) => rayEntry(piece, [surface[0], surface[1], 1], [0, 0, -1]) !== undefined)).toBe(true);
      offset = add(offset, owner!.piece.position);
      parent = owner!.piece;
      entry -= sink;
    }
    expect(generation).toBeGreaterThanOrEqual(12);
    expect(generation === 20 || consumed).toBe(true);
    expect(sinks.slice(1).reduce((sum, value) => sum + value, 0)).toBeLessThan(0.5 - AKM_DEPTH);
    expect(clamped.contained).toBeGreaterThan(0);
    expect(clamped.minimum).toBeGreaterThan(0);
    expect(state.some((piece) => rayEntry(piece, [surface[0], surface[1], 1], [0, 0, -1]) !== undefined)).toBe(true);
    expect(state.reduce((sum, piece) => sum + piece.shape!.volume, 0)).toBeLessThan(0.28125);
  });

  it('digs crater-wall hits along the bisector of the wall normal and the ray so chips leave through the open bullet path', () => {
    const ray: Vec3 = [0, 0, -1];
    let bisected = 0;
    for (const seed of [2, 3, 4, 5, 6, 7]) {
      const first = fractureFragmentAtImpact(cell, [0.02, -0.03, 0.25], ray, AKM_RADIUS, AKM_DEPTH, seed)!;
      expect(first).toBeDefined();
      for (const [dx, dy] of [[0.065, 0], [0, 0.064], [-0.064, 0], [0, -0.065]] as Array<[number, number]>) {
        const origin: Vec3 = [0.02 + dx, -0.03 + dy, 1];
        const hits = first.retained
          .map((piece) => ({ distance: rayEntry(piece, origin, ray), piece }))
          .filter((hit) => hit.distance !== undefined)
          .sort((a, b) => a.distance! - b.distance!);
        const target = hits[0]!.piece;
        const struck = add(origin, scale(ray, hits[0]!.distance!));
        const wall = target.shape!.faces
          .map((face) => ({ face, points: facePoints(target, face) }))
          .find(({ points }) => Math.abs(dot(faceNormal(points), sub(struck, points[0]!))) < 1e-9 && dot(faceNormal(points), ray) < 0)!;
        expect(wall.face.surface).toBe('fracture');
        const inward = scale(faceNormal(wall.points), -1);
        if (dot(inward, ray) >= 0.9) {
          continue;
        }
        const result = fractureFragmentAtImpact(target, sub(struck, target.position), ray, AKM_RADIUS, AKM_DEPTH, seed * 31)!;
        expect(result, `seed ${seed} offset ${dx},${dy}`).toBeDefined();
        expectPartition(target, result);
        bisected++;
        const bisector = unit(add(inward, ray));
        expect(Math.hypot(...sub(result.axis, bisector))).toBeLessThan(1e-9);
        expect(dot(result.axis, ray)).toBeGreaterThan(dot(inward, ray) + 0.3);
        const neighbours = [
          ...first.retained.filter((piece) => piece !== target),
          ...result.retained.map((piece) => translated(piece, target.position)),
        ];
        for (const chip of result.detached) {
          expect(canExit(translated(chip, target.position), result.axis, neighbours, 0.3)).toBe(true);
          expect(canExit(chip, result.axis, result.retained, 0.3)).toBe(true);
        }
      }
    }
    expect(bisected).toBeGreaterThanOrEqual(20);
  });

  it('removes a shallow, narrow gouge for grazing hits instead of a full-depth crater', () => {
    const removed = (result: Partition | undefined): number =>
      result!.detached.reduce((sum, chip) => sum + chip.shape!.volume, 0);
    for (const point of [[0, 0.375, 0.05], [0.2, 0.375, -0.1], [-0.1, 0.375, 0.15]] as Array<Vec3>) {
      for (const seed of [3, 41]) {
        const head = fractureFragmentAtImpact(cell, point, [0, -1, 0], AKM_RADIUS, AKM_DEPTH, seed)!;
        expectPartition(cell, head);
        let previous = 0;
        for (const degrees of [2, 30, 60, 80]) {
          const angle = (degrees * Math.PI) / 180;
          const direction: Vec3 = [0, -Math.sin(angle), -Math.cos(angle)];
          const result = fractureFragmentAtImpact(cell, point, direction, AKM_RADIUS, AKM_DEPTH, seed)!;
          expect(result, `${point} ${degrees}`).toBeDefined();
          expectPartition(cell, result);
          expect(result.axis).toEqual([0, -1, 0]);
          const ratio = removed(result) / removed(head);
          if (degrees === 2) {
            expect(ratio).toBeLessThanOrEqual(0.15);
            const lowest = Math.min(...result.detached.flatMap((chip) => chip.shape!.vertices.map((vertex) => chip.position[1] + vertex[1])));
            expect(0.375 - lowest).toBeCloseTo(AKM_DEPTH * 0.35, 9);
          }
          expect(ratio).toBeGreaterThanOrEqual(previous);
          expect(ratio).toBeLessThanOrEqual(1 + 1e-9);
          previous = ratio;
        }
      }
    }
  });

  it('keeps every definition under the network byte bound through a 700-hit fire and rubble chain', () => {
    let state = 0x1357_9bdf;
    const random = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 4_294_967_296;
    };
    type Live = { generation: number; id: number; piece: FragmentDef };
    let nextId = 5000;
    let attached: Array<Live> = [{ generation: 0, id: cell.id, piece: { ...boxHull(cell), position: cell.position } }];
    let rubble: Array<Live> = [];
    let largest = 0;
    let fractured = 0;
    let deepest = 0;
    for (let hit = 0; hit < 700; hit++) {
      let target: Live | undefined;
      let point: Vec3;
      let direction: Vec3;
      if (hit % 5 === 4 && rubble.length) {
        target = rubble[Math.floor(random() * rubble.length)]!;
        const face = target.piece.shape!.faces[Math.floor(random() * target.piece.shape!.faces.length)]!;
        const points = facePoints(target.piece, face);
        point = mean(points);
        direction = unit(add(scale(faceNormal(points), -1), [random() - 0.5, random() - 0.5, random() - 0.5]));
        point = sub(point, scale(direction, 0.01));
      } else {
        const spread = hit % 3 === 0 ? 0.01 : 0.12;
        point = add(cell.position, [(random() - 0.5) * spread, (random() - 0.5) * spread, 1]);
        direction = unit([(random() - 0.5) * 0.3, (random() - 0.5) * 0.3, -1]);
        const hits = attached
          .map((live) => ({ distance: rayEntry(live.piece, point, direction), live }))
          .filter((candidate) => candidate.distance !== undefined)
          .sort((a, b) => a.distance! - b.distance!);
        target = hits[0]?.live;
      }
      if (!target || target.generation >= 8) {
        continue;
      }
      const parent = target.piece;
      const result = fractureFragmentAtImpact(parent, sub(point, parent.position), direction, AKM_RADIUS, AKM_DEPTH, hit * 7919);
      if (!result) {
        continue;
      }
      fractured++;
      const generation = target.generation + 1;
      deepest = Math.max(deepest, generation);
      const wrap = (piece: FragmentDef): Live => {
        const definition = {
          ...piece,
          generation,
          id: nextId++,
          parentId: target.id,
          position: add(parent.position, piece.position),
          rootId: cell.id,
        };
        const bytes = new TextEncoder().encode(JSON.stringify(definition)).byteLength;
        expect(bytes).toBeLessThanOrEqual(MAX_SECONDARY_DEFINITION_BYTES);
        largest = Math.max(largest, bytes);
        return { generation, id: definition.id, piece: definition };
      };
      const retained = result.retained.map(wrap);
      const detached = result.detached.map(wrap);
      if (attached.includes(target)) {
        attached = [...attached.filter((live) => live !== target), ...retained];
        rubble = [...rubble, ...detached].slice(-200);
      } else {
        rubble = [...rubble.filter((live) => live !== target), ...retained, ...detached].slice(-200);
      }
    }
    expect(fractured).toBeGreaterThan(400);
    expect(deepest).toBe(8);
    expect(largest).toBeGreaterThan(1000);
  });

  it('rejects pieces whose encoded definition would exceed the per-definition byte bound', () => {
    const sides = 30;
    const vertices: Array<Vec3> = [];
    for (const z of [-0.2, 0.2]) {
      for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2 + 0.1;
        vertices.push([0.3 * Math.cos(angle), 0.3 * Math.sin(angle), z]);
      }
    }
    const volume = 0.5 * sides * 0.09 * Math.sin((2 * Math.PI) / sides) * 0.4;
    const prism: FragmentDef = {
      ...box,
      mass: volume * 2350,
      position: [1.234_567_890_123_456_7, 2.345_678_901_234_567, -3.456_789_012_345_678],
      shape: {
        faces: [
          { surface: 'exterior', vertices: Array.from({ length: sides }, (_, i) => sides - 1 - i) },
          { surface: 'exterior', vertices: Array.from({ length: sides }, (_, i) => sides + i) },
          ...Array.from({ length: sides }, (_, i) => ({
            surface: 'exterior' as const,
            vertices: [i, (i + 1) % sides, sides + ((i + 1) % sides), sides + i],
          })),
        ],
        inertia: [1, 1, 1, 0, 0, 0],
        vertices,
        volume,
      },
      size: [0.6, 0.6, 0.4],
    };
    expect(JSON.stringify(prism).length).toBeGreaterThan(MAX_SECONDARY_DEFINITION_BYTES);
    let defined = 0;
    for (let i = 0; i < 12; i++) {
      const angle = 0.1 + ((i + 0.5) / sides) * Math.PI * 2;
      const side: Vec3 = [0.299 * Math.cos(angle), 0.299 * Math.sin(angle), 0.05 * ((i % 3) - 1)];
      for (const [point, direction] of [[side, [-Math.cos(angle), -Math.sin(angle) - 0.2, 0]], [[0.04 * (i % 4), -0.03, 0.2], [0, 0, -1]]] as Array<[Vec3, Vec3]>) {
        const result = fractureFragmentAtImpact(prism, point, direction, AKM_RADIUS, AKM_DEPTH, i + 1);
        if (!result) {
          continue;
        }
        defined++;
        for (const piece of [...result.retained, ...result.detached]) {
          const bytes = JSON.stringify({ ...piece, generation: 1, id: 1_000_000, parentId: 4, position: add(prism.position, piece.position), rootId: 4 }).length;
          expect(bytes).toBeLessThanOrEqual(MAX_SECONDARY_DEFINITION_BYTES);
        }
      }
    }
    expect(defined).toBeGreaterThan(0);
  });

  it('lets every chip leave along the reversed axis without crossing retained material', () => {
    for (const [parent, point] of [[box, [0.31, -0.12, 0.5]], [cell, [-0.3, 0.3, 0.25]], [cell, [0.2, 0.36, 0.25]]] as Array<[FragmentDef, Vec3]>) {
      for (const seed of [5, 6, 7, 8]) {
        const result = fractureFragmentAtImpact(parent, point, [0.2, -0.1, -1], AKM_RADIUS, AKM_DEPTH, seed)!;
        expect(result).toBeDefined();
        expectPartition(parent, result);
        for (const chip of result.detached) {
          expect(canExit(chip, result.axis, result.retained, AKM_DEPTH * 2)).toBe(true);
        }
      }
    }
  });

  it('turns a thin piece into a through-hole whose chips reach the back face', () => {
    const thin: FragmentDef = { ...box, mass: 70.5, size: [1, 1, 0.03] };
    const point: Vec3 = [0.12, -0.07, 0.015];
    for (const seed of [1, 2, 3, 4, 5]) {
      const result = fractureFragmentAtImpact(thin, point, [0, 0, -1], AKM_RADIUS, AKM_DEPTH, seed)!;
      expect(result).toBeDefined();
      expectPartition(thin, result);
      expect(result.retained).toHaveLength(4);
      expect(result.detached).toHaveLength(4);
      const half = AKM_RADIUS / Math.SQRT2;
      const removed = result.detached.reduce((sum, chip) => sum + chip.shape!.volume, 0);
      expect(removed).toBeCloseTo(frustumVolume(half, AKM_DEPTH, 0.03), 12);
      expect(result.detached.some((chip) =>
        chip.shape!.vertices.some((vertex) => Math.abs(chip.position[2] + vertex[2] + 0.015) < 1e-12))).toBe(true);
      for (let step = 1; step < 30; step++) {
        const sample: Vec3 = [point[0], point[1], 0.015 - step * 0.001];
        expect(result.retained.every((piece) => signedDistance(piece, sample) >= -1e-9)).toBe(true);
        expect(result.detached.some((chip) => signedDistance(chip, sample) <= 1e-9)).toBe(true);
        expect(floorOwners(result, sample)).toHaveLength(0);
      }
      const back = result.retained.reduce((sum, piece) => sum + crossSectionArea(piece, [0, 0, 1], -0.015 - piece.position[2]), 0);
      const exit = 2 * half * (1 - 0.03 / (3 * AKM_DEPTH));
      expect(back).toBeCloseTo(1 - exit * exit, 9);
    }
  });

  it('cuts oblique thin walls with a surface-normal crater that stays inside the opening cylinder', () => {
    for (const thickness of [0.012, 0.03, 0.08]) {
      const wall: FragmentDef = { ...box, mass: 2350 * thickness, size: [1, 1, thickness] };
      for (const tilt of [0.4, 0.8, 1.1]) {
        for (const seed of [11, 12, 13]) {
          const direction = rotate([0, 0, -1], [0.6, 0.8, 0], tilt);
          const point: Vec3 = [0.1, 0.1, thickness / 2];
          const result = fractureFragmentAtImpact(wall, point, direction, 0.05, 0.04, seed)!;
          expect(result, `${thickness} ${tilt} ${seed}`).toBeDefined();
          expectPartition(wall, result);
          expect(result.axis).toEqual([0, 0, -1]);
          const grazing = Math.max(Math.cos(tilt), 0.35);
          for (const chip of result.detached) {
            for (const vertex of chip.shape!.vertices) {
              const p = add(chip.position, vertex);
              expect(Math.hypot(p[0] - point[0], p[1] - point[1])).toBeLessThanOrEqual(0.05 * Math.sqrt(grazing) + 1e-9);
            }
          }
          const sink = 0.04 * grazing;
          const through = thickness < 1.25 * sink;
          expect(floorOwners(result, [0.1, 0.1, thickness / 2 - sink])).toHaveLength(through ? 0 : 1);
        }
      }
    }
  });

  it('respects the minimum chip width and volume and stays network-valid across a fuzzed hit set', () => {
    let state = 0x2468_ace1;
    const random = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 4_294_967_296;
    };
    let interior = 0;
    let edge = 0;
    for (let trial = 0; trial < 160; trial++) {
      const parent = trial % 2 ? box : cell;
      const axis = Math.floor(random() * 3);
      const sign = random() < 0.5 ? -1 : 1;
      const near = trial % 4 === 0;
      const point: Vec3 = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const halfSize = parent.size[k]! / 2;
        point[k] = k === axis ? sign * halfSize : near ? (random() < 0.5 ? -1 : 1) * (halfSize - 0.001 - random() * 0.02) : (random() * 2 - 1) * (halfSize - 0.2);
      }
      const inward: Vec3 = [0, 0, 0];
      inward[axis] = -sign;
      const direction = rotate(inward, [random() - 0.5, random() - 0.5, random() - 0.5], random() * 1.1);
      const radius = 0.035 + random() * 0.1;
      const depth = 0.025 + random() * 0.1;
      const result = fractureFragmentAtImpact(parent, point, direction, radius, depth, trial);
      if (near) {
        if (result) {
          edge++;
          expectPartition(parent, result);
        }
        continue;
      }
      expect(result, `trial ${trial}`).toBeDefined();
      interior++;
      expectPartition(parent, result!);
      expect(result!.axis).toEqual(inward.map((value) => value || 0));
    }
    expect(interior).toBe(120);
    expect(edge).toBeGreaterThan(0);
  });

  it('re-fractures crater walls and fallen chips with clamped, valid geometry', () => {
    const first = fractureFragmentAtImpact(cell, [0, 0, 0.25], [0, 0, -1], AKM_RADIUS, AKM_DEPTH, 31)!;
    let walls = 0;
    for (const side of first.retained.slice(0, -1)) {
      for (const face of side.shape!.faces) {
        if (face.surface !== 'fracture') {
          continue;
        }
        const points = face.vertices.map((index) => side.shape!.vertices[index]!);
        const normal = faceNormal(points);
        if (normal[2] < 0.2) {
          continue;
        }
        const result = fractureFragmentAtImpact(side, mean(points), scale(normal, -1), AKM_RADIUS, AKM_DEPTH, 64);
        if (result) {
          walls++;
          expectPartition(side, result);
          for (const chip of result.detached) {
            for (const vertex of chip.shape!.vertices) {
              const p = add(chip.position, vertex);
              expect(Math.abs(dot(normal, sub(p, mean(points))))).toBeLessThanOrEqual(AKM_DEPTH + 1e-9);
            }
          }
        }
      }
    }
    expect(walls).toBeGreaterThan(0);
    const chip = first.detached[0]!;
    const faces = chip.shape!.faces.map((face) => face.vertices.map((index) => chip.shape!.vertices[index]!));
    const hits = faces.map((points) =>
      fractureFragmentAtImpact(chip, mean(points), scale(faceNormal(points), -1), 0.012, 0.01, 5));
    expect(hits.some(Boolean)).toBe(true);
    hits.forEach((result) => result && expectPartition(chip, result));
  });

  it('is deterministic per seed and independent of the parent placement', () => {
    const first = fractureFragmentAtImpact(cell, [0.1, 0.05, 0.25], [0.1, 0, -1], AKM_RADIUS, AKM_DEPTH, 17);
    expect(first).toBeDefined();
    expect(fractureFragmentAtImpact(cell, [0.1, 0.05, 0.25], [0.1, 0, -1], AKM_RADIUS, AKM_DEPTH, 17)).toEqual(first);
    expect(fractureFragmentAtImpact({ ...cell, position: [40, -3, 9] }, [0.1, 0.05, 0.25], [0.1, 0, -1], AKM_RADIUS, AKM_DEPTH, 17)).toEqual(first);
    expect(fractureFragmentAtImpact(cell, [0.1, 0.05, 0.25], [0.1, 0, -1], AKM_RADIUS, AKM_DEPTH, 18)).not.toEqual(first);
  });

  it('feeds hulls through the network secondary validator, which rejects degenerate faces', () => {
    const result = fractureFragmentAtImpact(cell, [0, 0, 0.25], [0, 0, -1], AKM_RADIUS, AKM_DEPTH, 3)!;
    const pieces = [...result.retained, ...result.detached];
    expect(() => encodePieces(cell, pieces)).not.toThrow();
    const broken = structuredClone(pieces[0]!);
    const face = broken.shape!.faces[0]!;
    face.vertices = [face.vertices[0]!, face.vertices[0]!, face.vertices[1]!];
    expect(() => encodePieces(cell, [broken])).toThrow();
    const flat = structuredClone(pieces[1]!);
    flat.shape!.vertices[flat.shape!.faces[0]!.vertices[1]!] = [...flat.shape!.vertices[flat.shape!.faces[0]!.vertices[0]!]!];
    expect(() => encodePieces(cell, [flat])).toThrow();
  });
});

describe('crossSectionArea', () => {
  it('measures box sections on axis and diagonal planes', () => {
    const slab: FragmentDef = { ...box, size: [2, 1, 0.5] };
    expect(crossSectionArea(slab, [1, 0, 0], 0)).toBeCloseTo(0.5, 12);
    expect(crossSectionArea(slab, [1, 0, 0], 0.9)).toBeCloseTo(0.5, 12);
    expect(crossSectionArea(slab, [0, 1, 0], 0.2)).toBeCloseTo(1, 12);
    expect(crossSectionArea(slab, [0, 0, -1], 0.1)).toBeCloseTo(2, 12);
    expect(crossSectionArea(slab, [2, 0, 0], 0.4)).toBeCloseTo(0.5, 12);
    expect(crossSectionArea(slab, [1, 0, 0], 1.5)).toBe(0);
    expect(crossSectionArea(slab, [0, 0, 0], 0)).toBe(0);
    expect(crossSectionArea(slab, [Number.NaN, 0, 1], 0)).toBe(0);
    expect(crossSectionArea(box, [1, 1, 0], 0)).toBeCloseTo(Math.SQRT2, 12);
    expect(crossSectionArea(box, [1, 1, 1], 0)).toBeCloseTo((3 * Math.sqrt(3)) / 4, 12);
    expect(crossSectionArea(boxHull(slab), [0, 1, 0], -0.3)).toBeCloseTo(1, 12);
  });

  it('sums crater-cut pieces to the parent section minus the hole', () => {
    const wall: FragmentDef = { ...box, mass: 940, size: [2, 2, 0.2] };
    const point: Vec3 = [0.3, -0.4, 0.1];
    const depth = 0.08;
    const result = fractureFragmentAtImpact(wall, point, [0, 0, -1], 0.1, depth, 77)!;
    const half = 0.1 / Math.SQRT2;
    const section = (pieces: Array<FragmentDef>, normal: Vec3, offset: number) =>
      pieces.reduce((sum, piece) => sum + crossSectionArea(piece, normal, offset - dot(normal, piece.position)), 0);
    for (const sink of [0.01, depth / 2, depth - 0.001]) {
      const z = point[2] - sink;
      const hole = (2 * half * (1 - sink / (3 * depth))) ** 2;
      expect(section(result.retained, [0, 0, 1], z)).toBeCloseTo(4 - hole, 10);
      expect(section(result.detached, [0, 0, 1], z)).toBeCloseTo(hole, 10);
    }
    expect(section(result.retained, [0, 0, 1], point[2] - depth - 0.01)).toBeCloseTo(4, 10);
    const vertical = section([...result.retained, ...result.detached], unit([1, 2, 0]), dot(unit([1, 2, 0]), point));
    expect(vertical).toBeCloseTo(crossSectionArea(wall, unit([1, 2, 0]), dot(unit([1, 2, 0]), point)), 10);
    expect(section(result.retained, unit([1, 2, 0]), dot(unit([1, 2, 0]), point))).toBeLessThan(vertical - 1e-3);
  });
});
