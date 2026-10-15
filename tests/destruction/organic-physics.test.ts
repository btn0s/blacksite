import type { RigidBody } from "@dimforge/rapier3d-compat";
import { describe, expect, it } from "vitest";
import { type DestructibleManifest, type FragmentDef, type Vec3 } from "../../packages/destruction-domain/src/index";
import { getBondSection } from "../../packages/destruction-graph/src/equilibrium";
import { StructuralGraph } from "../../packages/destruction-graph/src/index";
import { buildStructuralLoads } from "../../packages/destruction-graph/src/loads";
import { DestructionSimulation } from "../../packages/destruction-physics/src/index";

/** Tetrahedron with intercepts (2,1,3), volume 1, integrated analytically.
 * Its centroid is (.5,.25,.75), so all three off-diagonal moments are nonzero. */
function tetra(id = 1, position: Vec3 = [0, 8, 0], mass = 12): FragmentDef {
  return {
    id, position, size: [3, 1.5, 4.5], mass, material: 0, region: 0, anchored: false, aggregate: 0,
    shape: {
      vertices: [[-.5, -.25, -.75], [1.5, -.25, -.75], [-.5, .75, -.75], [-.5, -.25, 2.25]],
      faces: [
        { vertices: [0, 2, 1], surface: "exterior" },
        { vertices: [0, 1, 3], surface: "exterior" },
        { vertices: [0, 3, 2], surface: "exterior" },
        { vertices: [1, 2, 3], surface: "fracture" },
      ],
      volume: 1,
      inertia: [mass * .375, mass * .4875, mass * .1875, mass * .025, mass * .075, mass * .0375],
    },
  };
}
function fixture(fragments = [tetra()]): DestructibleManifest {
  return {
    schemaVersion: 1, assetHash: "organic-mechanics-v1", name: "Analytic convex cells", scenario: "wall", coordinateSystem: "Y_UP_RH",
    fragments, bonds: [], regions: [],
    materials: [{ id: 0, name: "Concrete", color: "#aaa", density: 12, strength: 100, brittleness: .7, friction: .8 }],
  };
}
function bodies(sim: DestructionSimulation): RigidBody[] {
  const result: RigidBody[] = [];
  sim.world.forEachRigidBody((body) => result.push(body));
  return result;
}
function tensor(body: RigidBody): number[] {
  const j = body.effectiveAngularInertia();
  return [j.m11, j.m22, j.m33, j.m12, j.m13, j.m23];
}
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const times = (j: readonly number[], v: Vec3): Vec3 => [j[0] * v[0] + j[3] * v[1] + j[4] * v[2], j[3] * v[0] + j[1] * v[1] + j[5] * v[2], j[4] * v[0] + j[5] * v[1] + j[2] * v[2]];

describe("authored convex fragment mechanics", () => {
  it("collides with the actual hull and uses its COM and full inertia, not its bounding box", async () => {
    const manifest = fixture(), sim = await DestructionSimulation.create(manifest);
    try {
      const [body] = bodies(sim), collider = body.collider(0);
      expect(body.mass()).toBeCloseTo(12, 5);
      expect(body.localCom()).toEqual({ x: 0, y: 0, z: 0 });
      expect(body.worldCom()).toEqual({ x: 0, y: 8, z: 0 });
      for (const [axis, value] of tensor(body).entries()) expect(value).toBeCloseTo(manifest.fragments[0].shape!.inertia[axis], 4);
      expect(collider.containsPoint({ x: -.1, y: 7.9, z: 0 })).toBe(true);
      // This is inside the bounding box but past the tetrahedron's sloping face.
      expect(collider.containsPoint({ x: 1, y: 8.4, z: 0 })).toBe(false);
      const projection = collider.projectPoint({ x: 1, y: 8.4, z: 0 }, true)!;
      expect(Math.hypot(projection.point.x - 1, projection.point.y - 8.4, projection.point.z)).toBeGreaterThan(.1);
    } finally { sim.dispose(); }
  });

  it("lands on its actual hull and bakes at a finite resting pose", async () => {
    const manifest = fixture([tetra(1, [0, .3, 0])]), sim = await DestructionSimulation.create(manifest);
    try {
      for (let tick = 0; tick < 420; tick++) sim.step();
      const [body] = bodies(sim);
      expect(body.isFixed()).toBe(true);
      expect(sim.frame().transforms[1]).toBeGreaterThan(.23);
      expect(sim.frame().transforms[1]).toBeLessThan(.28);
      expect(sim.graph.fragmentMass[0]).toBe(12);
      expect(sim.frame().transforms.every(Number.isFinite)).toBe(true);
    } finally { sim.dispose(); }
  });

  it("does not apply a blast impulse merely because the hull's broad-phase box overlaps", async () => {
    const sim = await DestructionSimulation.create(fixture());
    try {
      sim.enqueue({ id: 1, source: 0, tick: 1, type: "explosion", position: [1, 8.4, 0], direction: [1, 0, 0], radius: .05, strength: 2 });
      sim.step();
      const [body] = bodies(sim);
      expect(body.linvel().x).toBe(0);
      expect(body.linvel().z).toBe(0);
      expect(body.angvel()).toEqual({ x: 0, y: 0, z: 0 });
    } finally { sim.dispose(); }
  });

  it("rejects malformed hulls and non-positive inertia instead of using cuboid fallback", async () => {
    const missingVertices = fixture();
    missingVertices.fragments[0].shape!.vertices.length = 3;
    await expect(DestructionSimulation.create(missingVertices)).rejects.toThrow("convex fragment geometry");
    const negativeInertia = fixture();
    negativeInertia.fragments[0].shape!.inertia = [1, 1, 1, 2, 0, 0];
    await expect(DestructionSimulation.create(negativeInertia)).rejects.toThrow("positive definite");
    const badFace = fixture();
    badFace.fragments[0].shape!.faces[0].vertices[0] = 999;
    await expect(DestructionSimulation.create(badFace)).rejects.toThrow("convex fragment geometry");
  });

  it("combines unequal cell masses about their true centers and retains off-axis compound inertia", async () => {
    const manifest = fixture([tetra(1, [-2, 8, 0]), tetra(2, [1, 8, 0], 24)]);
    manifest.bonds = [{ id: 1, a: 1, b: 2, area: .2, normal: [1, 0, 0], strength: 100 }];
    const sim = await DestructionSimulation.create(manifest);
    try {
      const list = bodies(sim);
      expect(list).toHaveLength(1);
      const body = list[0];
      expect(body.mass()).toBeCloseTo(36, 5);
      expect(body.worldCom().x).toBeCloseTo(0, 6);
      const expected = [13.5, 89.55, 78.75, .9, 2.7, 1.35];
      // Rapier re-diagonalizes compounded moments in f32; reconstruction loses
      // a few thousandths here while preserving the materially different hull.
      for (const [axis, value] of tensor(body).entries()) expect(Math.abs(value - expected[axis])).toBeLessThan(.005);
    } finally { sim.dispose(); }
  });

  it("uses the polygon centroid and principal section properties for load transfer", () => {
    const manifest = fixture([tetra(1, [-2, 8, 0]), tetra(2, [1, 8, 0], 24)]);
    const section = { point: [-.25, 8.2, .1] as Vec3, tangent1: [0, 1, 0] as Vec3, tangent2: [0, 0, 1] as Vec3,
      inertia1: .017, inertia2: .023, polarInertia: .04, sectionModulus1: .043, sectionModulus2: .052, torsionModulus: .08 };
    const bond = { id: 1, a: 1, b: 2, area: .2, normal: [1, 0, 0] as Vec3, strength: 100, section };
    const actual = getBondSection(manifest, bond);
    expect(actual.point).toEqual(section.point);
    expect(actual.inertia1).toBe(section.inertia1);
    expect(actual.inertia2).toBe(section.inertia2);
    expect(actual.sectionModulus1).toBe(section.sectionModulus1);
    expect(actual.sectionModulus2).toBe(section.sectionModulus2);
    expect(actual.armA[0]).toBeCloseTo(1.75);
    expect(actual.armB[0]).toBeCloseTo(-1.25);
  });

  it("relieves a rotating asymmetric compound using full Euler moments and balances all six modes", () => {
    const manifest = fixture([tetra(1, [-2, 8, 0]), tetra(2, [1, 8, 0], 24)]);
    const alpha: Vec3 = [.7, -.2, .5], omega: Vec3 = [1.2, -.4, .8];
    const compound = [13.5, 89.55, 78.75, .9, 2.7, 1.35];
    const ia = times(compound, alpha), gyro = cross(omega, times(compound, omega));
    const appliedTorque = ia.map((value, axis) => value + gyro[axis]) as Vec3;
    const wrenches = new Float64Array([0, 12 * 9.81, 0, ...appliedTorque, 0, 24 * 9.81, 0, 0, 0, 0]);
    const loads = buildStructuralLoads(manifest, new Uint8Array(2), { tick: 1, wrenches, bodies: [{ members: [0, 1], rotation: [0, 0, 0, 1], angularVelocity: omega }] });
    const total = new Float64Array(6);
    for (let i = 0; i < 2; i++) {
      const fragment = manifest.fragments[i], j = fragment.shape!.inertia;
      const intrinsic = times(j, alpha), spin = cross(omega, times(j, omega));
      const r: Vec3 = [fragment.position[0], 0, 0];
      const angular = cross(alpha, r), centrifugal = cross(omega, cross(omega, r));
      for (let axis = 0; axis < 3; axis++) {
        expect(loads.rhs[i * 6 + axis]).toBeCloseTo(-fragment.mass * (angular[axis] + centrifugal[axis]), 9);
        expect(loads.rhs[i * 6 + axis + 3]).toBeCloseTo((i === 0 ? appliedTorque[axis] : 0) - intrinsic[axis] - spin[axis], 9);
        total[axis] += loads.rhs[i * 6 + axis];
      }
      const lever = cross(r, Array.from(loads.rhs.subarray(i * 6, i * 6 + 3)) as Vec3);
      for (let axis = 0; axis < 3; axis++) total[axis + 3] += loads.rhs[i * 6 + axis + 3] + lever[axis];
    }
    for (const value of total) expect(value).toBeCloseTo(0, 8);
  });

  it("targets the actual shared face after a compound rotates, rather than the midpoint of unequal cells", () => {
    const manifest = fixture([tetra(1, [-2, 8, 0]), tetra(2, [1, 8, 0], 24)]);
    manifest.bonds = [{ id: 1, a: 1, b: 2, area: .2, normal: [1, 0, 0], strength: 1,
      section: { point: [-.25, 8.2, .1], tangent1: [0, 1, 0], tangent2: [0, 0, 1], inertia1: .017, inertia2: .023, polarInertia: .04, sectionModulus1: .043, sectionModulus2: .052, torsionModulus: .08 } }];
    const graph = new StructuralGraph(manifest), half = Math.sqrt(.5);
    const poses = new Float32Array([-8, -2, 0, 0, 0, half, half, 0, -8, 1, 0, 0, 0, half, half, 0]);
    const targeted = { id: 1, type: "cut" as const, source: 0, tick: 1, position: [-8.2, -.25, .1] as Vec3, direction: [1, 0, 0] as Vec3, radius: .05, strength: 8 };
    expect(graph.generateFracture([targeted], poses).bonds.some(command => command.bond === 0 && command.health > 0)).toBe(true);
    const midpoint = new StructuralGraph(manifest);
    expect(midpoint.generateFracture([{ ...targeted, position: [-8, -.5, 0] }], poses).bonds).toHaveLength(0);
  });
});
