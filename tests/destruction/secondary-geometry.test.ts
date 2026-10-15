import { describe, expect, it } from "vitest";
import type {
  FragmentDef,
  Vec3,
} from "../../packages/destruction-domain/src/index";
import { fractureFragment } from "../../packages/destruction-physics/src/fracture";

const dot = (a: number[], b: number[]) =>
  a.reduce((sum, value, i) => sum + value * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((value, i) => value - b[i]);
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const box: FragmentDef = {
  id: 42,
  position: [11, 30, -7],
  size: [0.8, 0.5, 0.6],
  mass: 576,
  material: 3,
  region: 2,
  aggregate: 5,
  anchored: true,
};

/** Asymmetric convex shard with analytically known tetrahedron mass properties. */
function tetrahedron(): FragmentDef {
  const corners: Vec3[] = [
    [0, 0, 0],
    [0.8, 0, 0],
    [0.1, 0.55, 0],
    [0.12, 0.08, 0.64],
  ];
  const center = [0, 1, 2].map(
    (axis) => corners.reduce((sum, point) => sum + point[axis], 0) / 4,
  );
  const vertices = corners.map((point) => sub(point, center) as Vec3);
  const volume = (0.8 * 0.55 * 0.64) / 6,
    mass = volume * 2400;
  const c = (a: number, b: number) =>
    (mass * vertices.reduce((sum, point) => sum + point[a] * point[b], 0)) / 20;
  return {
    ...box,
    mass,
    size: [0.8, 0.55, 0.64],
    shape: {
      vertices,
      faces: [
        { vertices: [0, 2, 1], surface: "fracture" },
        { vertices: [0, 1, 3], surface: "exterior" },
        { vertices: [0, 3, 2], surface: "exterior" },
        { vertices: [1, 2, 3], surface: "exterior" },
      ],
      volume,
      inertia: [
        c(1, 1) + c(2, 2),
        c(0, 0) + c(2, 2),
        c(0, 0) + c(1, 1),
        -c(0, 1),
        -c(0, 2),
        -c(1, 2),
      ],
    },
  };
}

function contains(fragment: FragmentDef, point: number[]): boolean {
  const local = sub(point, fragment.position),
    shape = fragment.shape!;
  return shape.faces.every((face) => {
    const points = face.vertices.map((index) => shape.vertices[index]);
    let normal = [0, 0, 0];
    for (let i = 1; i + 1 < points.length; i++) {
      const area = cross(
        sub(points[i], points[0]),
        sub(points[i + 1], points[0]),
      );
      normal = normal.map((value, axis) => value + area[axis]);
    }
    return dot(normal, sub(local, points[0])) <= 1e-11;
  });
}

function expectConservation(
  parent: FragmentDef,
  children: FragmentDef[],
): void {
  const volume = parent.shape?.volume ?? parent.size.reduce((a, b) => a * b);
  expect(
    children.reduce((sum, child) => sum + child.shape!.volume, 0),
  ).toBeCloseTo(volume, 12);
  expect(children.reduce((sum, child) => sum + child.mass, 0)).toBeCloseTo(
    parent.mass,
    9,
  );
  for (let axis = 0; axis < 3; axis++)
    expect(
      children.reduce(
        (sum, child) => sum + child.mass * child.position[axis],
        0,
      ),
    ).toBeCloseTo(0, 9);
  const inertia = [0, 0, 0, 0, 0, 0];
  for (const child of children) {
    const [x, y, z] = child.position,
      m = child.mass;
    const parallel = [
      m * (y * y + z * z),
      m * (x * x + z * z),
      m * (x * x + y * y),
      -m * x * y,
      -m * x * z,
      -m * y * z,
    ];
    inertia.forEach((value, axis) => {
      inertia[axis] = value + child.shape!.inertia[axis] + parallel[axis];
    });
  }
  const [x, y, z] = parent.size,
    m = parent.mass;
  const expected = parent.shape?.inertia ?? [
    (m * (y * y + z * z)) / 12,
    (m * (x * x + z * z)) / 12,
    (m * (x * x + y * y)) / 12,
    0,
    0,
    0,
  ];
  inertia.forEach((value, axis) =>
    expect(value).toBeCloseTo(expected[axis], 9),
  );
}

function expectClosedConvex(fragment: FragmentDef): void {
  const shape = fragment.shape!;
  const edges = new Map<string, [number, number][]>();
  let signedVolume = 0;
  const first = [0, 0, 0];
  for (const face of shape.faces) {
    expect(new Set(face.vertices).size).toBe(face.vertices.length);
    expect(face.vertices.length).toBeGreaterThanOrEqual(3);
    const points = face.vertices.map((index) => shape.vertices[index]);
    let area = [0, 0, 0];
    for (let i = 1; i + 1 < points.length; i++) {
      const triangle = cross(
        sub(points[i], points[0]),
        sub(points[i + 1], points[0]),
      );
      area = area.map((value, axis) => value + triangle[axis]);
      const volume = dot(points[0], cross(points[i], points[i + 1])) / 6;
      signedVolume += volume;
      first.forEach((value, axis) => {
        first[axis] =
          value +
          (volume * (points[0][axis] + points[i][axis] + points[i + 1][axis])) /
            4;
      });
    }
    expect(Math.hypot(...area)).toBeGreaterThan(1e-10);
    expect(dot(area, points[0])).toBeGreaterThan(0);
    for (const point of shape.vertices)
      expect(dot(area, sub(point, points[0]))).toBeLessThanOrEqual(1e-10);
    for (let i = 0; i < face.vertices.length; i++) {
      const a = face.vertices[i],
        b = face.vertices[(i + 1) % face.vertices.length];
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      const occurrences = edges.get(key) ?? [];
      occurrences.push([a, b]);
      edges.set(key, occurrences);
    }
  }
  for (const occurrences of edges.values()) {
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0]).toEqual(occurrences[1].slice().reverse());
  }
  expect(signedVolume).toBeCloseTo(shape.volume, 12);
  first.forEach((value) => expect(value / signedVolume).toBeCloseTo(0, 11));
  const [xx, yy, zz, xy, xz, yz] = shape.inertia;
  expect(xx).toBeGreaterThan(0);
  expect(xx * yy - xy * xy).toBeGreaterThan(0);
  expect(
    xx * (yy * zz - yz * yz) -
      xy * (xy * zz - xz * yz) +
      xz * (xy * yz - xz * yy),
  ).toBeGreaterThan(0);
}

describe("secondary convex fracture geometry", () => {
  it("partitions cuboids into four closed skew shards conserving mass, COM, volume and inertia", () => {
    const children = fractureFragment(box, 0x12345678);
    expect(children).toHaveLength(4);
    expectConservation(box, children);
    children.forEach(expectClosedConvex);
    for (let x = 0; x < 7; x++)
      for (let y = 0; y < 7; y++)
        for (let z = 0; z < 7; z++) {
          const point = [
            (x / 7 - 0.491) * 0.8,
            (y / 7 - 0.487) * 0.5,
            (z / 7 - 0.483) * 0.6,
          ];
          expect(
            children.filter((child) => contains(child, point)),
          ).toHaveLength(1);
        }
    for (const child of children) {
      expect(child).toMatchObject({
        material: 3,
        region: 2,
        aggregate: 5,
        anchored: false,
      });
      expect(
        child.shape!.faces.some((face) => face.surface === "fracture"),
      ).toBe(true);
    }
  });

  it("clips an asymmetric pre-fractured hull without replacing it with its bounding box", () => {
    const parent = tetrahedron(),
      children = fractureFragment(parent, 117);
    expect(children).toHaveLength(4);
    expectConservation(parent, children);
    children.forEach(expectClosedConvex);
    const localParent = { ...parent, position: [0, 0, 0] as Vec3 };
    for (const child of children)
      for (const vertex of child.shape!.vertices) {
        expect(
          contains(
            localParent,
            vertex.map((value, axis) => value + child.position[axis]),
          ),
        ).toBe(true);
      }
    for (let i = 1; i < 100; i++) {
      const weights = [
        1 + ((i * 13) % 47),
        1 + ((i * 29) % 43),
        1 + ((i * 37) % 41),
        1 + ((i * 11) % 53),
      ];
      const total = weights.reduce((a, b) => a + b);
      const point = [0, 1, 2].map((axis) =>
        parent.shape!.vertices.reduce(
          (sum, vertex, j) => sum + (vertex[axis] * weights[j]) / total,
          0,
        ),
      );
      expect(children.filter((child) => contains(child, point))).toHaveLength(
        1,
      );
    }
    // The authored base is a fracture face. It must never acquire an exterior tag.
    const baseY = parent.shape!.vertices[0][2];
    for (const child of children)
      for (const face of child.shape!.faces) {
        if (
          face.vertices.every(
            (index) =>
              Math.abs(
                child.shape!.vertices[index][2] + child.position[2] - baseY,
              ) < 1e-10,
          )
        )
          expect(face.surface).toBe("fracture");
      }
  });

  it("is deterministic and seed-dependent without mutating source geometry or using world position", () => {
    const parent = tetrahedron(),
      before = structuredClone(parent);
    const first = fractureFragment(parent, 34);
    expect(fractureFragment(parent, 34)).toEqual(first);
    expect(fractureFragment(parent, 35)).not.toEqual(first);
    expect(
      fractureFragment({ ...parent, position: [1234, -876, 923] }, 34),
    ).toEqual(first);
    expect(parent).toEqual(before);
  });

  it("rejects dust-size cells and thin slivers and resolves small rubble as two pieces", () => {
    expect(fractureFragment({ ...box, size: [0.01, 0.01, 0.01] }, 2)).toEqual(
      [],
    );
    expect(fractureFragment({ ...box, size: [1, 1, 0.01] }, 2)).toEqual([]);
    const small = { ...box, size: [0.12, 0.12, 0.12] as Vec3, mass: 4.1472 };
    const children = fractureFragment(small, 2);
    expect(children).toHaveLength(2);
    expectConservation(small, children);
  });

  it("keeps all generated geometry within the wire format bounds and refuses oversized source hulls", () => {
    for (let seed = 0; seed < 20; seed++) {
      const children = fractureFragment(tetrahedron(), seed);
      expect(children.length).toBeGreaterThanOrEqual(2);
      for (const child of children) {
        expect(child.shape!.vertices.length).toBeLessThanOrEqual(64);
        expect(child.shape!.faces.length).toBeLessThanOrEqual(128);
        expectClosedConvex(child);
      }
    }
    const parent = tetrahedron();
    parent.shape!.vertices.push(
      ...Array.from({ length: 65 }, () => [0, 0, 0] as Vec3),
    );
    expect(fractureFragment(parent, 0)).toEqual([]);
  });
});
