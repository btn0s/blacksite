import { describe, expect, it } from "vitest";
import type {
  FragmentDef,
  Vec3,
} from "../../packages/destruction-domain/src/index";
import { validateManifest } from "../../packages/destruction-authoring/src/index";
import {
  createOrganicScenario,
  createScenario,
  hashManifest,
} from "../../packages/destruction-testkit/src/index";
import {
  hashOrganicManifest,
  isResolvedBondSection,
} from "../../packages/destruction-testkit/src/organic";

const organic = createOrganicScenario("building");
const dot = (a: number[], b: number[]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a: number[], b: number[]) =>
  a.map((value, axis) => value - b[axis]);
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function contains(fragment: FragmentDef, worldPoint: Vec3): boolean {
  const shape = fragment.shape!;
  const point = subtract(worldPoint, fragment.position);
  return shape.faces.every((face) => {
    const points = face.vertices.map((index) => shape.vertices[index]);
    let normal = [0, 0, 0];
    for (let index = 1; index + 1 < points.length; index++) {
      const triangle = cross(
        subtract(points[index], points[0]),
        subtract(points[index + 1], points[0]),
      );
      normal = normal.map((value, axis) => value + triangle[axis]);
    }
    return dot(normal, subtract(point, points[0])) <= 1e-9;
  });
}

describe("organic concrete authoring", () => {
  it("retains stable fragment IDs and legacy hashes while generating deterministic closed supported hulls", () => {
    const legacy = createScenario("building");
    expect(legacy.assetHash).toBe("cascade-v1-c5905694");
    expect(organic.assetHash).not.toBe(legacy.assetHash);
    expect(createOrganicScenario("building")).toEqual(organic);
    expect(
      organic.fragments.map(({ id, material, anchored, aggregate }) => ({
        id,
        material,
        anchored,
        aggregate,
      })),
    ).toEqual(
      legacy.fragments.map(({ id, material, anchored, aggregate }) => ({
        id,
        material,
        anchored,
        aggregate,
      })),
    );
    expect(organic.fragments).toHaveLength(982);
    expect(organic.fragments.every((fragment) => fragment.shape)).toBe(true);
    expect(validateManifest(organic).errors).toEqual([]);
    expect(createOrganicScenario("bridge")).toEqual(createScenario("bridge"));
  });

  it("partitions each entire slab with no gaps or overlaps and conserves mass, COM, and the full inertia tensor", () => {
    for (let floor = 0; floor < 4; floor++) {
      const fragments = organic.fragments.slice(floor * 100, (floor + 1) * 100);
      const center: Vec3 = [0, floor * 3 + 0.16, 0];
      const mass = 10 * 0.24 * 10 * 2280;
      expect(
        fragments.reduce(
          (total, fragment) => total + fragment.shape!.volume,
          0,
        ),
      ).toBeCloseTo(24, 10);
      expect(
        fragments.reduce((total, fragment) => total + fragment.mass, 0),
      ).toBeCloseTo(mass, 7);
      for (let axis = 0; axis < 3; axis++)
        expect(
          fragments.reduce(
            (total, fragment) =>
              total + fragment.mass * fragment.position[axis],
            0,
          ) / mass,
        ).toBeCloseTo(center[axis], 10);
      const inertia = [0, 0, 0, 0, 0, 0];
      for (const fragment of fragments) {
        const [x, y, z] = subtract(fragment.position, center),
          m = fragment.mass;
        const parallel = [
          m * (y * y + z * z),
          m * (x * x + z * z),
          m * (x * x + y * y),
          -m * x * y,
          -m * x * z,
          -m * y * z,
        ];
        for (let axis = 0; axis < 6; axis++)
          inertia[axis] += fragment.shape!.inertia[axis] + parallel[axis];
      }
      const expected = [
        (mass * (100 + 0.24 ** 2)) / 12,
        (mass * 200) / 12,
        (mass * (100 + 0.24 ** 2)) / 12,
        0,
        0,
        0,
      ];
      inertia.forEach((value, axis) =>
        expect(value).toBeCloseTo(expected[axis], 6),
      );
      for (let sample = 0; sample < 113; sample++) {
        const point: Vec3 = [
          -4.999 + ((sample * 0.6180339887) % 1) * 9.998,
          floor * 3 + 0.041 + ((sample * 0.4142135623) % 1) * 0.238,
          -4.997 + ((sample * 0.7320508075) % 1) * 9.994,
        ];
        expect(
          fragments.filter((fragment) => contains(fragment, point)),
        ).toHaveLength(1);
      }
    }
    const sizes = organic.fragments
      .slice(0, 100)
      .map((fragment) => fragment.shape!.volume);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(2);
  });

  it("authors actual shared fracture sections and slab-column support polygons", () => {
    const byId = new Map(
      organic.fragments.map((fragment) => [fragment.id, fragment]),
    );
    const floorBonds = organic.bonds.filter(
      (bond) => bond.a <= 100 && bond.b <= 100,
    );
    expect(floorBonds.length).toBeGreaterThan(200);
    let diagonalCuts = 0;
    for (const bond of floorBonds) {
      const section = bond.section!;
      if (
        bond.normal.filter((component) => Math.abs(component) > 0.1).length >= 2
      )
        diagonalCuts++;
      expect(contains(byId.get(bond.a)!, section.point)).toBe(true);
      expect(contains(byId.get(bond.b)!, section.point)).toBe(true);
      expect(dot(section.tangent1, bond.normal)).toBeCloseTo(0, 10);
      expect(dot(section.tangent2, bond.normal)).toBeCloseTo(0, 10);
      expect(dot(section.tangent1, section.tangent2)).toBeCloseTo(0, 10);
      expect(section.polarInertia).toBeCloseTo(
        section.inertia1 + section.inertia2,
        10,
      );
      expect(section.sectionModulus1).toBeGreaterThan(0);
      expect(section.sectionModulus2).toBeGreaterThan(0);
      for (const id of [bond.a, bond.b]) {
        const fragment = byId.get(id)!,
          shape = fragment.shape!;
        const matching = shape.faces.filter(
          (face) =>
            face.surface === "fracture" &&
            face.vertices.every((vertex) => {
              const world = shape.vertices[vertex].map(
                (value, axis) => value + fragment.position[axis],
              );
              return (
                Math.abs(dot(subtract(world, section.point), bond.normal)) <
                1e-7
              );
            }),
        );
        expect(matching).toHaveLength(1);
        const points = matching[0].vertices.map(
          (vertex) => shape.vertices[vertex],
        );
        let area = 0;
        for (let index = 1; index + 1 < points.length; index++)
          area +=
            Math.hypot(
              ...cross(
                subtract(points[index], points[0]),
                subtract(points[index + 1], points[0]),
              ),
            ) / 2;
        expect(area).toBeCloseTo(bond.area, 8);
      }
    }
    expect(diagonalCuts).toBeGreaterThan(floorBonds.length * 0.7);
    // Both ends of every column story retain substantial bearing area after
    // unresolved, narrow edge welds are excluded from the structural graph.
    const columns = new Set(
      organic.fragments
        .filter((fragment) => fragment.material === 3)
        .map((fragment) => fragment.aggregate),
    );
    for (const column of columns) {
      const pieces = organic.fragments.filter(
        (fragment) => fragment.aggregate === column && fragment.material === 3,
      );
      for (const sign of [-1, 1]) {
        const contacts = organic.bonds.filter((bond) => {
          const a = byId.get(bond.a)!,
            b = byId.get(bond.b)!;
          return (
            a.material === 1 &&
            pieces.includes(b) &&
            Math.abs(bond.normal[1] - sign) < 1e-7
          );
        });
        const bearingArea = contacts.reduce((sum, bond) => sum + bond.area, 0);
        expect(bearingArea).toBeGreaterThan(0.9 * 0.46 ** 2);
        expect(bearingArea).toBeLessThanOrEqual(0.46 ** 2 + 1e-8);
      }
    }
  });

  it("omits unresolved needle-like welds without altering exact hulls, mass or initial support", () => {
    // This geometry-only digest predates the structural feature cutoff. Collision
    // hulls, mass, COM and inertia remain identical; only cohesive topology changes.
    const { assetHash: _, ...content } = organic;
    expect(hashManifest({ ...content, bonds: [] })).toBe("cascade-v1-e73cd3f0");
    expect(organic.bonds).toHaveLength(2210);
    expect(
      organic.bonds.every((bond) =>
        isResolvedBondSection(bond.area, bond.section!),
      ),
    ).toBe(true);
    expect(validateManifest(organic).errors).toEqual([]);
    expect(
      Math.min(
        ...organic.bonds.map((bond) =>
          Math.min(bond.section!.inertia1, bond.section!.inertia2),
        ),
      ),
    ).toBeGreaterThan(1e-7);

    const rectangle = (width: number, length: number) => {
      const area = width * length;
      return {
        area,
        section: {
          inertia1: (area * width ** 2) / 12,
          inertia2: (area * length ** 2) / 12,
        },
      };
    };
    const needle = rectangle(0.01, 1);
    expect(needle.area).toBeGreaterThan(0.045 ** 2);
    expect(isResolvedBondSection(needle.area, needle.section)).toBe(false);
    const resolved = rectangle(0.05, 0.1);
    expect(isResolvedBondSection(resolved.area, resolved.section)).toBe(true);
  });

  it("canonicalizes engine-level trigonometric roundoff only for asset identity", () => {
    const { assetHash: _, ...content } = structuredClone(organic);
    const before = JSON.stringify(content);
    expect(hashOrganicManifest(content)).toBe(organic.assetHash);
    expect(JSON.stringify(content)).toBe(before);

    // Actual Node/Chromium results from the same principal-axis calculation.
    // Relative significant digits alone fail here because of cancellation.
    const node = structuredClone(content),
      browser = structuredClone(content);
    node.bonds[0].section!.tangent2[1] = 0.00000738851888255;
    browser.bonds[0].section!.tangent2[1] = 0.00000738851888249;
    expect(hashOrganicManifest(node)).toBe(hashOrganicManifest(browser));
    browser.fragments[0].position[0] += 0.001;
    expect(hashOrganicManifest(node)).not.toBe(hashOrganicManifest(browser));
    expect(createScenario("building").assetHash).toBe("cascade-v1-c5905694");
  });

  it("rejects malformed or physically inconsistent optional shape and section data", () => {
    for (const mutate of [
      (fragment: FragmentDef) => {
        fragment.shape!.inertia[3] = 1e12;
      },
      (fragment: FragmentDef) => {
        fragment.shape!.volume *= 2;
      },
      (fragment: FragmentDef) => {
        fragment.shape!.faces[0].vertices.reverse();
      },
      (fragment: FragmentDef) => {
        fragment.shape!.faces.pop();
      },
      (fragment: FragmentDef) => {
        fragment.shape!.vertices[0][0] = Infinity;
      },
      (fragment: FragmentDef) => {
        fragment.shape!.vertices.forEach((vertex) => {
          vertex[0] += 0.1;
        });
      },
    ]) {
      const malformed = structuredClone(organic);
      mutate(malformed.fragments[0]);
      expect(validateManifest(malformed).valid).toBe(false);
    }
    const malformed = structuredClone(organic);
    malformed.bonds[0].section!.tangent2 = malformed.bonds[0].section!.tangent1;
    expect(
      validateManifest(malformed).errors.some(
        (error) => error.path === "bonds[0].section",
      ),
    ).toBe(true);
  });
});
