import { describe, expect, it } from "vitest";
import {
  BondState,
  type BondDef,
  type DestructibleManifest,
  type DestructionCommand,
  type Vec3,
} from "../../packages/destruction-domain/src/index";
import { EquilibriumSolver } from "../../packages/destruction-graph/src/equilibrium";
import {
  StructuralGraph,
  topologyChecksum,
} from "../../packages/destruction-graph/src/index";
import {
  buildStructuralLoads,
  type StructuralLoadSnapshot,
} from "../../packages/destruction-graph/src/loads";
import {
  createScenario,
  MATERIALS,
} from "../../packages/destruction-testkit/src/index";

function chain(masses: [number, number, number] = [10, 10, 10]): DestructibleManifest {
  return {
    schemaVersion: 1,
    assetHash: "material-loss-chain",
    name: "Chain",
    scenario: "cantilever",
    coordinateSystem: "Y_UP_RH",
    materials: MATERIALS,
    regions: [{ id: 0, name: "Chain", min: [-1, -1, -1], max: [3, 2, 1] }],
    fragments: [101, 7, 42].map((id, i) => ({
      id,
      position: [i, 0.5, 0] as Vec3,
      size: [0.9, 0.9, 0.9] as Vec3,
      mass: masses[i]!,
      material: 0,
      region: 0,
      anchored: i === 0,
      aggregate: 0,
    })),
    bonds: [
      { id: 19, a: 101, b: 7, area: 0.81, strength: 1, normal: [1, 0, 0] },
      { id: 3, a: 7, b: 42, area: 0.81, strength: 1, normal: [1, 0, 0] },
    ],
  };
}

function cutBond(id: number, a: number, b: number, point: Vec3): BondDef {
  return {
    id,
    a,
    b,
    area: 0.01,
    strength: 1,
    normal: [1, 0, 0],
    section: {
      point,
      tangent1: [0, 0, 1],
      tangent2: [0, -1, 0],
      inertia1: 0.0001,
      inertia2: 0.0001,
      polarInertia: 0.0002,
      sectionModulus1: 0.001,
      sectionModulus2: 0.001,
      torsionModulus: 0.001,
    },
  };
}

function cutFixture(tipMass = 3): DestructibleManifest {
  return {
    schemaVersion: 1,
    assetHash: "material-loss-cut",
    scenario: "cantilever",
    name: "Cut cantilever",
    coordinateSystem: "Y_UP_RH",
    regions: [],
    materials: MATERIALS,
    fragments: [
      { id: 10, position: [0, 0, 0], size: [1, 1, 1], mass: 10, material: 0, region: 0, anchored: true, aggregate: 0 },
      { id: 20, position: [1, 0, 0], size: [1, 1, 1], mass: 2, material: 0, region: 0, anchored: false, aggregate: 0 },
      { id: 30, position: [2, 0, 0], size: [1, 1, 1], mass: tipMass, material: 0, region: 0, anchored: false, aggregate: 0 },
    ],
    bonds: [cutBond(1, 10, 20, [0.5, 0, 0]), cutBond(2, 20, 30, [1.5, 0, 0])],
  };
}

const zeroLoads = (manifest: DestructibleManifest, tick: number): StructuralLoadSnapshot => ({
  bodies: [],
  tick,
  wrenches: new Float64Array(manifest.fragments.length * 6),
});

const impact = (overrides: Partial<DestructionCommand> = {}): DestructionCommand => ({
  type: "pointImpact",
  id: 1,
  tick: 1,
  source: 0,
  position: [0.5, 0.5, 0],
  direction: [0, 0, -1],
  radius: 0.2,
  strength: 0.05,
  ...overrides,
});

const remaining = (graph: StructuralGraph, bond: number) => 1 - graph.damage[bond]! * 0.6;

function expectRelative(actual: number, expected: number, tolerance = 1e-4) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * tolerance + 1e-12);
}

describe("structural fragment mass", () => {
  it("starts from manifest masses and validates updates", () => {
    const graph = new StructuralGraph(chain([10, 8, 6]));
    expect([...graph.fragmentMass]).toEqual([10, 8, 6]);
    expect(() => graph.setFragmentMass(-1, 1)).toThrow("Invalid fragment index");
    expect(() => graph.setFragmentMass(3, 1)).toThrow("Invalid fragment index");
    expect(() => graph.setFragmentMass(1.5, 1)).toThrow("Invalid fragment index");
    expect(() => graph.setFragmentMass(1, 0)).toThrow("Invalid fragment mass");
    expect(() => graph.setFragmentMass(1, -1)).toThrow("Invalid fragment mass");
    expect(() => graph.setFragmentMass(1, Number.NaN)).toThrow("Invalid fragment mass");
    expect(() => graph.setFragmentMass(1, Number.POSITIVE_INFINITY)).toThrow("Invalid fragment mass");
    expect(() => graph.setFragmentMass(1, 8.01)).toThrow("Invalid fragment mass");
    graph.setFragmentMass(1, 8 * (1 + 1e-12));
    expect(graph.fragmentMass[1]).toBe(8);
    graph.setFragmentMass(1, 3.5);
    expect([...graph.fragmentMass]).toEqual([10, 3.5, 6]);
  });

  it("drives gravity loads exactly like an authored lighter fragment on the very next step", () => {
    const graph = new StructuralGraph(chain()),
      reference = new StructuralGraph(chain([10, 10, 4]));
    for (let tick = 0; tick < 8; tick++) {
      graph.step();
      reference.step();
    }
    graph.setFragmentMass(2, 4);
    const result = graph.step();
    expect(result.broken).toEqual([]);
    expect(graph.solverStats.converged).toBe(true);
    expect(graph.directResult!.rhs[2 * 6 + 1]).toBeCloseTo(-4 * 9.81, 8);
    expect(graph.utilization.every(Number.isFinite)).toBe(true);
    expect(reference.directResult!.rhs[2 * 6 + 1]).toBeCloseTo(graph.directResult!.rhs[2 * 6 + 1]!, 8);
    expect(graph.checksum()).toBe(reference.checksum());
  });

  it.each([0.6, 0.997])(
    "refreshes frozen measured loads after a %s mass change with unchanged topology",
    (scale) => {
      const manifest = chain(),
        graph = new StructuralGraph(manifest),
        reference = new StructuralGraph(chain([10, 10, 10 * scale]));
      for (let tick = 1; tick <= 40; tick++) {
        graph.setExternalLoads(zeroLoads(manifest, tick));
        reference.setExternalLoads(zeroLoads(manifest, tick));
        graph.step();
        reference.step();
      }
      const before = [...graph.utilization];
      expect(before[0]).toBeGreaterThan(0);
      graph.setFragmentMass(2, 10 * scale);
      graph.setExternalLoads(zeroLoads(manifest, 41));
      reference.setExternalLoads(zeroLoads(manifest, 41));
      graph.step();
      reference.step();
      for (let bond = 0; bond < 2; bond++) {
        expect(graph.utilization[bond]).toBeLessThan(before[bond]!);
        expectRelative(graph.utilization[bond]!, reference.utilization[bond]!);
      }
      expect(graph.solverStats.maxUtilization).toBeGreaterThan(0);
      expectRelative(graph.solverStats.maxUtilization, reference.solverStats.maxUtilization);
    },
  );

  it("uses the structural mass for direct-solver gravity loads", () => {
    const graph = new StructuralGraph(cutFixture()),
      reference = new StructuralGraph(cutFixture(1));
    graph.step();
    const heavy = graph.directResult!.rhs[2 * 6 + 1]!;
    graph.setFragmentMass(2, 1);
    graph.step();
    reference.step();
    expect(graph.directResult!.rhs[2 * 6 + 1]).toBeCloseTo(reference.directResult!.rhs[2 * 6 + 1]!, 8);
    expect(graph.directResult!.rhs[2 * 6 + 1]).toBeGreaterThan(heavy);
  });

  it("scales island gravity, inertia and solver gravity by structural mass", () => {
    const shape = {
      faces: [],
      inertia: [2, 3, 4, 0.1, -0.2, 0.3] as [number, number, number, number, number, number],
      vertices: [],
      volume: 1,
    };
    const beam = (scale: number): DestructibleManifest => ({
      ...chain(),
      fragments: chain().fragments.map((fragment, i) => ({
        ...fragment,
        anchored: false,
        mass: i === 1 ? fragment.mass * scale : fragment.mass,
        shape: {
          ...shape,
          inertia: shape.inertia.map((value) => (i === 1 ? value * scale : value)) as typeof shape.inertia,
        },
      })),
    });
    const full = beam(1),
      reduced = beam(0.25),
      masses = Float64Array.from(full.fragments, (fragment) => fragment.mass);
    masses[1] = 2.5;
    const snapshot: StructuralLoadSnapshot = {
      bodies: [{ angularVelocity: [0.4, -1.1, 0.7], members: [0, 1, 2], rotation: [0, 0, 0.2, 0.98] }],
      tick: 1,
      wrenches: new Float64Array([0, 4, 0, 0, 0, 1, 2, -3, 1, 0.5, 0, 0, 0, 0, -6, 0, 2, 0]),
    };
    const expected = buildStructuralLoads(reduced, new Uint8Array(3), snapshot);
    const actual = buildStructuralLoads(full, new Uint8Array(3), snapshot, undefined, undefined, masses);
    const unscaled = buildStructuralLoads(full, new Uint8Array(3), snapshot);
    for (let j = 0; j < 18; j++) {
      expect(actual.rhs[j]).toBeCloseTo(expected.rhs[j]!, 10);
    }
    expect([...actual.rhs]).not.toEqual([...unscaled.rhs]);
    expect(() =>
      buildStructuralLoads(full, new Uint8Array(3), snapshot, undefined, undefined, [1, 2]),
    ).toThrow("Invalid structural mass buffer length");
    expect(() =>
      buildStructuralLoads(full, new Uint8Array(3), snapshot, undefined, undefined, [1, Number.NaN, 2]),
    ).toThrow("Invalid structural fragment mass");

    const supported = new Uint8Array([1, 1, 1]);
    const grounded = chain(),
      lighter = chain([10, 2.5, 10]);
    const solved = new EquilibriumSolver(grounded).solve(new Uint8Array(2), new Float32Array(2), supported, {
      masses: [10, 2.5, 10],
    });
    const authored = new EquilibriumSolver(lighter).solve(new Uint8Array(2), new Float32Array(2), supported);
    for (let bond = 0; bond < 2; bond++) {
      expect(solved.forceY[bond]).toBeCloseTo(authored.forceY[bond]!, 8);
      expect(solved.momentZ[bond]).toBeCloseTo(authored.momentZ[bond]!, 8);
    }
  });
});

describe("structural bond section loss", () => {
  it("never restores lost bond section and eventually disconnects an exhausted bond", () => {
    const graph = new StructuralGraph(chain());
    graph.step();
    graph.setBondSectionFraction(0, 0.8);
    graph.step();
    const firstDamage = graph.damage[0]!;
    expect(firstDamage).toBeGreaterThan(0);
    graph.setBondSectionFraction(0, 0.9);
    graph.step();
    expect(graph.damage[0]).toBeGreaterThanOrEqual(firstDamage);
    graph.setBondSectionFraction(0, 0);
    graph.step();
    expect(graph.states[0]).toBe(BondState.Broken);
    expect(graph.supported[1]).toBe(0);
    expect(graph.supported[2]).toBe(0);
  });

  it("composes with existing material damage and validates input", () => {
    const graph = new StructuralGraph(chain());
    graph.applyFracture({ bonds: [{ bond: 0, health: 0.2 }], chunks: [], programs: [] });
    graph.step();
    const damaged = remaining(graph, 0);
    expect(damaged).toBeLessThan(1);
    graph.setBondSectionFraction(0, 0.5);
    graph.step();
    expect(remaining(graph, 0)).toBeCloseTo(damaged * 0.5, 6);
    expect(() => graph.setBondSectionFraction(2, 0.5)).toThrow("Invalid bond index");
    expect(() => graph.setBondSectionFraction(-1, 0.5)).toThrow("Invalid bond index");
    expect(() => graph.setBondSectionFraction(0, Number.NaN)).toThrow("Invalid bond section fraction");
    graph.setBondSectionFraction(1, 2);
    graph.setBondSectionFraction(1, -3);
    expect(graph.step().broken).toEqual([1]);
  });
});

describe("structural fragment removal", () => {
  it("lists incident bonds in ascending bond index order", () => {
    const graph = new StructuralGraph(chain());
    expect([...graph.bondIndices.subarray(graph.rowOffsets[1], graph.rowOffsets[2])]).toEqual([1, 0]);
    expect(graph.incidentBonds(0)).toEqual([0]);
    expect(graph.incidentBonds(1)).toEqual([0, 1]);
    expect(graph.incidentBonds(2)).toEqual([1]);
    expect(() => graph.incidentBonds(3)).toThrow("Invalid fragment index");
    expect(() => graph.isRemoved(-1)).toThrow("Invalid fragment index");
  });

  it("removes a non-anchored fragment immediately and quietly", () => {
    const manifest = chain(),
      graph = new StructuralGraph(manifest);
    graph.step();
    graph.removeFragment(1);
    expect(graph.isRemoved(1)).toBe(true);
    expect(graph.isRemoved(0)).toBe(false);
    expect([...graph.states]).toEqual([BondState.Broken, BondState.Broken]);
    expect([...graph.damage]).toEqual([1, 1]);
    expect([...graph.supported]).toEqual([1, 0, 0]);
    expect(graph.getUnsupportedIslands()).toEqual([[2]]);
    expect(graph.checksum()).toBe(topologyChecksum(manifest, graph.states, graph.supported));
    const result = graph.step();
    expect(result.broken).toEqual([]);
    expect(result.cracked).toEqual([]);
    expect(result.islands).toEqual([[2]]);
    expect(result.checksum).toBe(topologyChecksum(manifest, graph.states, graph.supported));
    const checksum = graph.checksum();
    graph.setFragmentMass(1, 1);
    expect(graph.fragmentMass[1]).toBe(0);
    graph.removeFragment(1);
    expect(graph.checksum()).toBe(checksum);
    expect(graph.step().checksum).toBe(checksum);
  });

  it("removes an anchored fragment, unsupporting everything it carried", () => {
    const manifest = chain(),
      graph = new StructuralGraph(manifest);
    graph.step();
    graph.removeFragment(0);
    expect(graph.states[0]).toBe(BondState.Broken);
    expect(graph.states[1]).toBe(BondState.Intact);
    expect([...graph.supported]).toEqual([0, 0, 0]);
    expect(graph.getUnsupportedIslands()).toEqual([[1, 2]]);
    expect(graph.checksum()).toBe(topologyChecksum(manifest, graph.states, graph.supported));
    const result = graph.step();
    expect(result.broken).toEqual([]);
    expect(result.cracked).toEqual([]);
    expect(result.islands).toEqual([[1, 2]]);
    graph.removeFragment(0);
    expect(graph.step().islands).toEqual([[1, 2]]);
  });

  it("removes an isolated anchored fragment without reporting it as an island", () => {
    const manifest = chain(),
      graph = new StructuralGraph(manifest);
    graph.applyCommands([impact({ type: "cut", strength: 1 })]);
    expect(graph.step().broken).toEqual([0]);
    expect([...graph.supported]).toEqual([1, 0, 0]);
    graph.removeFragment(0);
    expect([...graph.supported]).toEqual([0, 0, 0]);
    expect(graph.getUnsupportedIslands()).toEqual([[1, 2]]);
    expect(graph.checksum()).toBe(topologyChecksum(manifest, graph.states, graph.supported));
  });

  it("keeps measured loads valid after removing fragments from a wall", () => {
    const manifest = createScenario("wall"),
      graph = new StructuralGraph(manifest);
    const anchored = manifest.fragments.findIndex((fragment) => fragment.anchored);
    const free = manifest.fragments.findIndex(
      (fragment, i) => !fragment.anchored && graph.incidentBonds(i).length >= 4,
    );
    for (let tick = 1; tick <= 3; tick++) {
      graph.setExternalLoads(zeroLoads(manifest, tick));
      graph.step();
    }
    for (const index of [anchored, free]) {
      const bonds = graph.incidentBonds(index);
      graph.removeFragment(index);
      for (const bond of bonds) expect(graph.states[bond]).toBe(BondState.Broken);
      expect(graph.supported[index]).toBe(0);
      expect(graph.getUnsupportedIslands().flat()).not.toContain(index);
      graph.setExternalLoads(zeroLoads(manifest, 4));
      const result = graph.step();
      for (const bond of bonds) {
        expect(result.broken).not.toContain(bond);
        expect(result.cracked).not.toContain(bond);
      }
      expect(result.islands.flat()).not.toContain(index);
      expect(result.checksum).toBe(topologyChecksum(manifest, graph.states, graph.supported));
    }
  });
});

describe("structural material loss determinism", () => {
  it("replays mass, section and removal edits with bit-identical state", () => {
    const manifest = createScenario("wall");
    const run = () => {
      const graph = new StructuralGraph(manifest),
        trace: Array<string> = [];
      for (let tick = 1; tick <= 24; tick++) {
        graph.setExternalLoads(zeroLoads(manifest, tick));
        if (tick % 3 === 0) {
          const index = (tick * 37) % manifest.fragments.length;
          graph.setFragmentMass(index, manifest.fragments[index]!.mass * (0.5 + (tick % 5) * 0.1));
          for (const bond of graph.incidentBonds(index)) {
            graph.setBondSectionFraction(bond, 1 - tick / 40);
          }
        }
        if (tick % 8 === 0) {
          graph.removeFragment((tick * 53) % manifest.fragments.length);
        }
        const result = graph.step();
        trace.push(
          JSON.stringify([
            result.checksum,
            result.broken,
            result.cracked,
            result.islands,
            [...graph.damage],
            [...graph.utilization],
            [...graph.fragmentMass],
          ]),
        );
      }
      return trace;
    };
    expect(run()).toEqual(run());
  }, 30_000);
});
