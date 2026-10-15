import { describe, expect, it } from "vitest";
import type {
  DestructibleManifest,
  Quat,
  Vec3,
} from "../../packages/destruction-domain/src/index";
import { EquilibriumSolver } from "../../packages/destruction-graph/src/equilibrium";
import {
  buildStructuralLoads,
  type StructuralLoadSnapshot,
  type StructuralLoads,
} from "../../packages/destruction-graph/src/loads";
import { MATERIALS } from "../../packages/destruction-testkit/src/index";

function beam(n = 4): DestructibleManifest {
  return {
    schemaVersion: 1,
    assetHash: "inertial-relief",
    name: "Free beam",
    scenario: "cantilever",
    coordinateSystem: "Y_UP_RH",
    materials: MATERIALS,
    regions: [{ id: 0, name: "Beam", min: [-1, -1, -1], max: [n, 1, 1] }],
    fragments: Array.from({ length: n }, (_, i) => ({
      id: 100 - i,
      position: [i, 0, 0],
      size: [1, 0.5, 0.8],
      mass: 10 + i,
      material: 0,
      region: 0,
      anchored: false,
      aggregate: 0,
    })),
    bonds: Array.from({ length: n - 1 }, (_, i) => ({
      id: i + 1,
      a: 100 - i,
      b: 99 - i,
      area: 0.4,
      strength: 1,
      normal: [1, 0, 0],
    })),
  };
}
function snapshot(
  manifest: DestructibleManifest,
  rotation: Quat = [0, 0, 0, 1],
  angularVelocity: Vec3 = [0, 0, 0],
): StructuralLoadSnapshot {
  return {
    tick: 1,
    wrenches: new Float64Array(manifest.fragments.length * 6),
    bodies: [
      {
        members: manifest.fragments.map((_, i) => i),
        rotation,
        angularVelocity,
      },
    ],
  };
}
function totalWrench(
  manifest: DestructibleManifest,
  load: StructuralLoads,
  members: readonly number[],
) {
  const total = [0, 0, 0, 0, 0, 0];
  for (const i of members) {
    const [x, y, z] = manifest.fragments[i].position,
      o = i * 6;
    const [fx, fy, fz, mx, my, mz] = load.rhs.subarray(o, o + 6);
    total[0] += fx;
    total[1] += fy;
    total[2] += fz;
    total[3] += mx + y * fz - z * fy;
    total[4] += my + z * fx - x * fz;
    total[5] += mz + x * fy - y * fx;
  }
  return total;
}

describe("contact load inertial relief", () => {
  it("cancels uniform gravity in free fall, without introducing gauge reactions", () => {
    const manifest = beam(),
      input = snapshot(manifest);
    const load = buildStructuralLoads(manifest, new Uint8Array(4), input);
    expect([...load.rhs]).toEqual(new Array(24).fill(0));
    expect([...load.clamped]).toEqual([0, 0, 0, 1]);
    const result = new EquilibriumSolver(manifest).solve(
      new Uint8Array(3),
      new Float32Array(3),
      load.participating,
      { rhs: load.rhs, clamped: load.clamped },
    );
    expect(result.converged).toBe(true);
    expect([...result.forceY]).toEqual([0, 0, 0]);
  });

  it("balances all six rigid-body modes with eccentric contacts, angular acceleration and gyroscopic terms", () => {
    const manifest = beam(),
      input = snapshot(manifest, [0, 0, 0, 1], [1.2, -0.4, 0.7]);
    input.wrenches.set([31, 900, -23, 7, -19, 40], 6);
    const load = buildStructuralLoads(manifest, new Uint8Array(4), input);
    for (const value of totalWrench(manifest, load, [0, 1, 2, 3]))
      expect(value).toBeCloseTo(0, 8);
    expect(load.rhs.some((value) => Math.abs(value) > 1)).toBe(true);
  });

  it("produces identical internal forces for different rigid-motion gauges", () => {
    const manifest = beam(),
      input = snapshot(manifest);
    input.wrenches[1] = 800;
    const load = buildStructuralLoads(manifest, new Uint8Array(4), input);
    const states = new Uint8Array(3),
      damage = new Float32Array(3);
    const a = new EquilibriumSolver(manifest).solve(
      states,
      damage,
      load.participating,
      { rhs: load.rhs, clamped: load.clamped, tolerance: 1e-10 },
    );
    const b = new EquilibriumSolver(manifest).solve(
      states,
      damage,
      load.participating,
      {
        rhs: load.rhs,
        clamped: new Uint8Array([1, 0, 0, 0]),
        tolerance: 1e-10,
      },
    );
    expect(a.converged && b.converged).toBe(true);
    for (let i = 0; i < 3; i++) {
      expect(a.forceY[i]).toBeCloseTo(b.forceY[i], 7);
      expect(a.momentZ[i]).toBeCloseTo(b.momentZ[i], 7);
    }
  });

  it("rotates world contact wrenches and angular velocity into authored coordinates", () => {
    const manifest = beam(),
      a = snapshot(manifest, [0, 0, 0, 1], [1, 2, 3]),
      half = Math.sqrt(0.5);
    const b = snapshot(manifest, [0, 0, half, half], [-2, 1, 3]);
    a.wrenches.set([13, 70, -9, 3, 5, 8], 6);
    b.wrenches.set([-70, 13, -9, -5, 3, 8], 6);
    const x = buildStructuralLoads(manifest, new Uint8Array(4), a),
      y = buildStructuralLoads(manifest, new Uint8Array(4), b);
    for (let i = 0; i < x.rhs.length; i++)
      expect(x.rhs[i]).toBeCloseTo(y.rhs[i], 8);
  });

  it("balances newly split live-bond components separately from stale physics body membership", () => {
    const manifest = beam(),
      input = snapshot(manifest, [0, 0, 0, 1], [0, 0, 0.4]);
    input.wrenches.set([0, 600, 0, 0, 0, 0], 0);
    const load = buildStructuralLoads(manifest, new Uint8Array(4), input, [
      [0, 1],
      [2, 3],
    ]);
    expect([...load.clamped]).toEqual([0, 1, 0, 1]);
    for (const members of [
      [0, 1],
      [2, 3],
    ])
      for (const value of totalWrench(manifest, load, members))
        expect(value).toBeCloseTo(0, 8);
  });

  it("erases a previous loaded solution when the same component returns to zero RHS", () => {
    const manifest = beam(),
      input = snapshot(manifest);
    input.wrenches[1] = 800;
    const load = buildStructuralLoads(manifest, new Uint8Array(4), input),
      solver = new EquilibriumSolver(manifest);
    const states = new Uint8Array(3),
      damage = new Float32Array(3);
    const loaded = solver.solve(states, damage, load.participating, {
      rhs: load.rhs,
      clamped: load.clamped,
    });
    expect(loaded.forceY.some((value) => Math.abs(value) > 1)).toBe(true);
    const free = solver.solve(states, damage, load.participating, {
      rhs: new Float64Array(24),
      clamped: load.clamped,
    });
    expect(free.converged).toBe(true);
    expect(free.displacement.every((value) => value === 0)).toBe(true);
    expect(free.forceY.every((value) => value === 0)).toBe(true);
    expect(free.momentZ.every((value) => value === 0)).toBe(true);
  });
});
