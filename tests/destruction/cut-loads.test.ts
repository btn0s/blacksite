import { describe, expect, it } from "vitest";
import { type BondDef, type DestructibleManifest, type Vec3 } from "../../packages/destruction-domain/src/index";
import { StructuralGraph } from "../../packages/destruction-graph/src/index";
import { buildStructuralLoads } from "../../packages/destruction-graph/src/loads";

function bond(id: number, a: number, b: number, point: Vec3, normal: Vec3 = [1, 0, 0]): BondDef {
  return { id, a, b, area: .01, strength: 1, normal,
    section: { point, tangent1: [0, 0, 1], tangent2: [normal[1], -normal[0], 0], inertia1: .0001, inertia2: .0001, polarInertia: .0002, sectionModulus1: .001, sectionModulus2: .001, torsionModulus: .001 } };
}
function fixture(): DestructibleManifest {
  return {
    schemaVersion: 1, assetHash: "cut-loads-v2", scenario: "cantilever", name: "Direct load invariant", coordinateSystem: "Y_UP_RH", regions: [],
    materials: [{ id: 0, name: "Concrete", color: "#aaa", density: 1000, strength: 1, brittleness: .8, friction: .7, youngModulus: 20e9, tensionStrength: 1e4, compressionStrength: 1e4, shearStrength: 1e4, bendingStrength: 1e4 }],
    fragments: [
      { id: 10, position: [0, 0, 0], size: [1, 1, 1], mass: 10, material: 0, region: 0, anchored: false, aggregate: 0 },
      { id: 20, position: [1, 0, 0], size: [1, 1, 1], mass: 2, material: 0, region: 0, anchored: false, aggregate: 0 },
      { id: 30, position: [2, 1, 0], size: [1, 1, 1], mass: 3, material: 0, region: 0, anchored: false, aggregate: 0 },
    ],
    bonds: [bond(0, 10, -1, [0, -.5, 0], [0, -1, 0]), bond(1, 10, 20, [.5, 0, 0]), bond(2, 20, 30, [1.5, .5, 0], [Math.SQRT1_2, Math.SQRT1_2, 0])],
  };
}

function solved(graph: StructuralGraph) {
  graph.step();
  const result = graph.directResult!;
  expect(result.complete).toBe(true);
  for (const values of [result.forceX, result.forceY, result.forceZ, result.momentX, result.momentY, result.momentZ, result.rhs, result.utilization])
    expect([...values].every(Number.isFinite)).toBe(true);
  expect([...graph.damage].every(value => value >= 0 && value <= 1)).toBe(true);
  return result;
}

describe("direct structural load invariants", () => {
  it("holds a connected member through its world bond and detaches it when that bond breaks", () => {
    const graph = new StructuralGraph(fixture());
    expect([...graph.supported]).toEqual([1, 1, 1]);
    expect(graph.failIncidentBonds(0)).toBe(2);
    graph.step();
    expect([...graph.supported]).toEqual([0, 0, 0]);
    expect(graph.getUnsupportedIslands().flat().sort()).toEqual([0, 1, 2]);
  });

  it("balances gravity with current contact uplift in the load builder", () => {
    const manifest = fixture(), graph = new StructuralGraph(manifest);
    const contacts = new Float64Array(manifest.fragments.length * 6);
    manifest.fragments.forEach((fragment, index) => { contacts[index * 6 + 1] = fragment.mass * 9.81; });
    const loads = buildStructuralLoads(manifest, graph.supported, { tick: 1, wrenches: contacts, bodies: [] });
    for (let index = 0; index < manifest.fragments.length; index++)
      expect(loads.rhs[index * 6 + 1]).toBeCloseTo(0, 8);
    graph.setExternalLoads({ tick: 1, wrenches: contacts, bodies: [] });
    expect([...solved(graph).rhs].every(Number.isFinite)).toBe(true);
  });

  it("solves a cyclic support graph with bounded finite connection actions", () => {
    const manifest = fixture();
    manifest.bonds.push(bond(3, 10, 30, [1, .5, 0]));
    const graph = new StructuralGraph(manifest);
    const result = solved(graph);
    expect(result.solvedBonds.length).toBe(manifest.bonds.length);
    expect([...result.solvedBonds].every(value => value === 1)).toBe(true);
  });

  it("never heals bond damage when current loading changes", () => {
    const graph = new StructuralGraph(fixture());
    solved(graph);
    const before = graph.damage.slice();
    const contacts = new Float64Array(18);
    contacts[7] = 100;
    graph.setExternalLoads({ tick: 2, wrenches: contacts, bodies: [] });
    solved(graph);
    graph.damage.forEach((value, index) => expect(value).toBeGreaterThanOrEqual(before[index]!));
  });

  it("replays identical loads with identical topology and direct actions", () => {
    const a = new StructuralGraph(fixture()), b = new StructuralGraph(fixture());
    for (let tick = 0; tick < 8; tick++) {
      const contacts = new Float64Array(18);
      contacts[7] = tick * 3;
      for (const graph of [a, b]) graph.setExternalLoads({ tick, wrenches: contacts, bodies: [] });
      expect(a.step().checksum).toBe(b.step().checksum);
      expect(a.damage).toEqual(b.damage);
      expect(a.directResult!.utilization).toEqual(b.directResult!.utilization);
    }
  });
});
