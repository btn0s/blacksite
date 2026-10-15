import { describe, expect, it } from "vitest";
import {
  BondState,
  type DestructibleManifest,
  type Vec3,
} from "../../packages/destruction-domain/src/index";
import {
  EquilibriumSolver,
  getBondSection,
  type EquilibriumResult,
} from "../../packages/destruction-graph/src/equilibrium";
import {
  MATERIALS,
  createScenario,
} from "../../packages/destruction-testkit/src/index";

function beam(count: number, bothEnds = false): DestructibleManifest {
  return {
    schemaVersion: 1,
    assetHash: "elastic-beam",
    name: "Elastic beam",
    scenario: "cantilever",
    coordinateSystem: "Y_UP_RH",
    materials: MATERIALS,
    regions: [{ id: 0, name: "Beam", min: [-1, -1, -1], max: [count, 1, 1] }],
    fragments: Array.from({ length: count }, (_, i) => ({
      id: 100 - i,
      position: [i, 0, 0],
      size: [1, 0.5, 0.8],
      mass: 10,
      material: 0,
      region: 0,
      anchored: i === 0 || (bothEnds && i === count - 1),
      aggregate: 0,
    })),
    bonds: Array.from({ length: count - 1 }, (_, i) => ({
      id: 200 - i,
      a: 100 - i,
      b: 99 - i,
      area: 0.4,
      strength: 1,
      normal: [1, 0, 0],
    })),
  };
}

function solve(manifest: DestructibleManifest) {
  const solver = new EquilibriumSolver(manifest);
  const states = new Uint8Array(manifest.bonds.length),
    damage = new Float32Array(states.length);
  const supported = new Uint8Array(manifest.fragments.length).fill(1);
  const result = solver.solve(states, damage, supported, { tolerance: 1e-9 });
  expect(result.converged).toBe(true);
  return { solver, result, states, damage, supported };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function nodalActions(
  manifest: DestructibleManifest,
  solver: EquilibriumSolver,
  result: EquilibriumResult,
) {
  const forces = manifest.fragments.map((): Vec3 => [0, 0, 0]);
  const moments = manifest.fragments.map((): Vec3 => [0, 0, 0]);
  for (let i = 0; i < manifest.bonds.length; i++) {
    const bond = manifest.bonds[i],
      section = solver.sections[i];
    const force: Vec3 = [result.forceX[i], result.forceY[i], result.forceZ[i]];
    const moment: Vec3 = [
      result.momentX[i],
      result.momentY[i],
      result.momentZ[i],
    ];
    for (const [id, sign, arm] of [
      [bond.a, 1, section.armA],
      [bond.b, -1, section.armB],
    ] as const) {
      const node = manifest.fragments.findIndex(
        (fragment) => fragment.id === id,
      );
      const lever = cross(arm, force);
      for (let axis = 0; axis < 3; axis++) {
        forces[node][axis] += sign * force[axis];
        moments[node][axis] += sign * (moment[axis] + lever[axis]);
      }
    }
  }
  return { forces, moments };
}

describe("six-DOF elastic equilibrium", () => {
  it("balances the analytic weight and root bending moment of a one-fragment cantilever", () => {
    const manifest = beam(2),
      { solver, result } = solve(manifest);
    const weight = manifest.fragments[1].mass * 9.81;
    expect(result.forceY[0]).toBeCloseTo(-weight, 8);
    expect(result.momentZ[0]).toBeCloseTo(-weight * 0.5, 8);
    const { moments } = nodalActions(manifest, solver, result);
    expect(moments[0][2]).toBeCloseTo(-weight * 1, 8);
    expect(moments[1][2]).toBeCloseTo(0, 8);
    expect([...result.displacement.slice(0, 6)]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(result.displacement[7]).toBeLessThan(0);
    expect(result.displacement[11]).toBeLessThan(0);
  });

  it("accumulates moment quadratically with cantilever length, rather than only counting local load", () => {
    for (const count of [3, 6, 12]) {
      const manifest = beam(count),
        { result } = solve(manifest);
      for (let i = 0; i < count - 1; i++) {
        const supportedCells = count - i - 1,
          weight = 98.1;
        expect(result.forceY[i]).toBeCloseTo(-supportedCells * weight, 5);
        expect(result.momentZ[i]).toBeCloseTo(
          (-weight * supportedCells ** 2) / 2,
          5,
        );
        if (i > 0)
          expect(Math.abs(result.momentZ[i])).toBeLessThan(
            Math.abs(result.momentZ[i - 1]),
          );
      }
    }
  });

  it("splits symmetric clamped-span reactions equally and balances every free fragment", () => {
    const manifest = beam(9, true),
      { solver, result } = solve(manifest);
    const { forces, moments } = nodalActions(manifest, solver, result);
    const totalWeight = 7 * 98.1;
    expect(forces[0][1]).toBeCloseTo(-totalWeight / 2, 6);
    expect(forces[8][1]).toBeCloseTo(-totalWeight / 2, 6);
    expect(moments[0][2]).toBeCloseTo(-moments[8][2], 6);
    for (let node = 1; node < 8; node++) {
      expect(forces[node][0]).toBeCloseTo(0, 6);
      expect(forces[node][1]).toBeCloseTo(98.1, 6);
      expect(forces[node][2]).toBeCloseTo(0, 6);
      for (const moment of moments[node]) expect(moment).toBeCloseTo(0, 6);
    }
  });

  it("conserves world force and moment through a spatial off-center contact", () => {
    const manifest = beam(2);
    manifest.fragments[1].position = [1, 0.2, 0.3];
    manifest.bonds[0].area = 0.15;
    const { solver, result } = solve(manifest);
    const { forces, moments } = nodalActions(manifest, solver, result);
    const gravity: Vec3 = [0, -98.1, 0];
    const expected = cross(manifest.fragments[1].position, gravity);
    for (let axis = 0; axis < 3; axis++) {
      expect(forces[0][axis]).toBeCloseTo(gravity[axis], 6);
      expect(moments[0][axis]).toBeCloseTo(expected[axis], 6);
      expect(forces[1][axis]).toBeCloseTo(-gravity[axis], 6);
      expect(moments[1][axis]).toBeCloseTo(0, 6);
    }
  });

  it("distinguishes axial tension above an anchor from compression below a supported weight", () => {
    for (const direction of [-1, 1]) {
      const manifest = beam(2);
      manifest.fragments[1].position = [0, direction, 0];
      manifest.bonds[0].normal = [0, direction, 0];
      const { result } = solve(manifest);
      expect(result.forceY[0] * direction).toBeCloseTo(-98.1 * direction, 7);
      expect(Math.abs(result.momentZ[0])).toBeLessThan(1e-7);
    }
  });

  it("computes section properties from contact overlap, including the weaker thin-slab bending axis", () => {
    const manifest = beam(2),
      section = getBondSection(manifest, manifest.bonds[0]);
    expect(section.point).toEqual([0.5, 0, 0]);
    expect(section.area).toBeCloseTo(0.4);
    expect(section.sectionModulus1).toBeCloseTo((0.5 * 0.8 ** 2) / 6);
    expect(section.sectionModulus2).toBeCloseTo((0.8 * 0.5 ** 2) / 6);
  });

  it("removes detached fragments and broken bonds without leaving stale reactions or displacement", () => {
    const manifest = beam(5),
      { solver, states, damage, supported } = solve(manifest);
    states[0] = BondState.Broken;
    supported.fill(0, 1);
    const result = solver.solve(states, damage, supported);
    expect(result.converged).toBe(true);
    expect(result.residual).toBe(0);
    expect(result.displacement.every((v) => v === 0)).toBe(true);
    expect(result.forceY.every((v) => v === 0)).toBe(true);
    expect(result.momentZ.every((v) => v === 0)).toBe(true);
  });

  it("reports an unfinished bounded solve honestly and continues it on later calls", () => {
    const manifest = beam(12),
      solver = new EquilibriumSolver(manifest);
    const states = new Uint8Array(11),
      damage = new Float32Array(11),
      supported = new Uint8Array(12).fill(1);
    const unfinished = solver.solve(states, damage, supported, {
      maxIterations: 2,
      tolerance: 1e-8,
    });
    expect(unfinished.converged).toBe(false);
    expect(unfinished.iterations).toBe(2);
    const finished = solver.solve(states, damage, supported, {
      maxIterations: 100,
      tolerance: 1e-8,
    });
    expect(finished.converged).toBe(true);
    expect(finished.momentZ[0]).toBeCloseTo((-98.1 * 11 ** 2) / 2, 4);
    expect(solver.solve(states, damage, supported).iterations).toBe(0);
  });

  it("is invariant to manifest slot ordering under stable fragment and bond IDs", () => {
    const original = beam(8),
      reordered = {
        ...original,
        fragments: [...original.fragments].reverse(),
        bonds: [...original.bonds].reverse(),
      };
    const a = solve(original).result,
      b = solve(reordered).result;
    expect([...a.forceY]).toEqual([...b.forceY].reverse());
    expect([...a.momentZ]).toEqual([...b.momentZ].reverse());
  });

  it("continues the same Krylov solve across tick budgets after removing a bridge pier", () => {
    const manifest = createScenario("bridge");
    const states = new Uint8Array(manifest.bonds.length),
      damage = new Float32Array(states.length),
      supported = new Uint8Array(manifest.fragments.length).fill(1);
    const fragments = new Map(
      manifest.fragments.map((fragment) => [fragment.id, fragment]),
    );
    for (let i = 0; i < states.length; i++) {
      const a = fragments.get(manifest.bonds[i].a)!,
        b = fragments.get(manifest.bonds[i].b)!;
      if (a.region === 0 && b.region === 0 && a.anchored !== b.anchored)
        states[i] = BondState.Broken;
    }
    const full = new EquilibriumSolver(manifest).solve(
      states,
      damage,
      supported,
      { maxIterations: 1200, tolerance: 1e-5 },
    );
    const budgeted = new EquilibriumSolver(manifest);
    let iterations = 0;
    let result: EquilibriumResult | undefined;
    for (let tick = 0; tick < 30; tick++) {
      result = budgeted.solve(states, damage, supported, {
        maxIterations: 32,
        tolerance: 1e-5,
      });
      iterations += result.iterations;
      if (result.converged) break;
    }
    expect(result?.converged).toBe(true);
    expect(iterations).toBe(full.iterations);
    expect(result?.forceY).toEqual(full.forceY);
    expect(result?.momentZ).toEqual(full.momentZ);
  });

  it("converges on each authored structure before using its reactions for fracture", () => {
    for (const scenario of [
      "building",
      "wall",
      "cantilever",
      "bridge",
    ] as const) {
      const manifest = createScenario(scenario),
        solver = new EquilibriumSolver(manifest);
      const states = new Uint8Array(manifest.bonds.length),
        damage = new Float32Array(states.length),
        supported = new Uint8Array(manifest.fragments.length).fill(1);
      const result = solver.solve(states, damage, supported, {
        maxIterations: 1200,
        tolerance: 1e-5,
      });
      expect(
        result.converged,
        `${scenario}: ${result.residual} after ${result.iterations}`,
      ).toBe(true);
      expect(result.displacement.every(Number.isFinite)).toBe(true);
    }
  });
  it("preserves an unfinished component's Krylov sequence while another component changes load", () => {
    const long = beam(40),
      small = beam(2);
    small.fragments = small.fragments.map((fragment) => ({
      ...fragment,
      id: fragment.id + 1000,
      position: [fragment.position[0], 5, 0],
    }));
    small.bonds = small.bonds.map((bond) => ({
      ...bond,
      id: bond.id + 1000,
      a: bond.a + 1000,
      b: bond.b + 1000,
    }));
    const combined = {
      ...long,
      fragments: [...long.fragments, ...small.fragments],
      bonds: [...long.bonds, ...small.bonds],
    };
    const alone = new EquilibriumSolver(long),
      together = new EquilibriumSolver(combined);
    const states = new Uint8Array(combined.bonds.length),
      damage = new Float32Array(states.length),
      supported = new Uint8Array(combined.fragments.length).fill(1);
    const groups = new Int32Array(combined.fragments.length).fill(39);
    groups.fill(41, 40);
    const rhs = new Float64Array(combined.fragments.length * 6);
    for (let i = 0; i < combined.fragments.length; i++)
      rhs[i * 6 + 1] = -10 * 9.81;
    let completed = false;
    for (let tick = 0; tick < 200; tick++) {
      rhs[41 * 6 + 1] = -98.1 * (1 + (tick % 3));
      const reference = alone.solve(
        states.subarray(0, 39),
        damage.subarray(0, 39),
        supported.subarray(0, 40),
        {
          maxIterations: 4,
          tolerance: 1e-7,
          groups: new Int32Array(40).fill(39),
        },
      );
      const actual = together.solve(states, damage, supported, {
        rhs,
        groups,
        loadRevision: tick,
        maxIterations: 4,
        tolerance: 1e-7,
      });
      expect(actual.forceY.subarray(0, 39)).toEqual(reference.forceY);
      expect(actual.momentZ.subarray(0, 39)).toEqual(reference.momentZ);
      if (reference.converged) {
        completed = true;
        break;
      }
    }
    expect(completed).toBe(true);
  });
});
