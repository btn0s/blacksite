import { describe, expect, it } from "vitest";
import {
  BondState,
  type DestructibleManifest,
  type DestructionCommand,
} from "../../packages/destruction-domain/src/index";
import {
  StructuralGraph,
  topologyChecksum,
} from "../../packages/destruction-graph/src/index";
import {
  createScenario,
  MATERIALS,
} from "../../packages/destruction-testkit/src/index";

const impact = (
  overrides: Partial<DestructionCommand> = {},
): DestructionCommand => ({
  type: "pointImpact",
  id: 1,
  tick: 1,
  source: 0,
  position: [0, 3, 0],
  direction: [0, 0, -1],
  radius: 1,
  strength: 1,
  ...overrides,
});
function chain(): DestructibleManifest {
  return {
    schemaVersion: 1,
    assetHash: "chain-v1",
    name: "Chain",
    scenario: "cantilever",
    coordinateSystem: "Y_UP_RH",
    materials: MATERIALS,
    regions: [{ id: 0, name: "Chain", min: [-1, -1, -1], max: [3, 2, 1] }],
    fragments: [101, 7, 42].map((id, i) => ({
      id,
      position: [i, 0.5, 0],
      size: [0.9, 0.9, 0.9],
      mass: 10,
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

describe("StructuralGraph", () => {
  it("detaches an unsupported component as one island and retains it in subsequent steps", () => {
    const graph = new StructuralGraph(chain());
    graph.applyCommands([
      impact({ type: "cut", position: [0.5, 0.5, 0], radius: 0.2 }),
    ]);
    const result = graph.step();
    expect(result.broken).toEqual([0]);
    expect(result.islands).toEqual([[1, 2]]);
    expect([...graph.supported]).toEqual([1, 0, 0]);
    expect(graph.step().islands).toEqual([[1, 2]]);
    expect(graph.step().broken).toEqual([]);
  });

  it("builds a symmetric CSR graph from stable IDs that are not array indices", () => {
    const graph = new StructuralGraph(chain());
    expect([...graph.rowOffsets]).toEqual([0, 1, 3, 4]);
    expect([...graph.bondIndices]).toEqual([0, 1, 0, 1]);
    expect(graph.supported.every((value) => value === 1)).toBe(true);
  });

  it("targets the struck chunk without damaging unrelated support bonds", () => {
    const manifest = chain();
    const radial = new StructuralGraph(manifest);
    const targeted = new StructuralGraph(manifest);
    const shot = impact({ position: [0, 0.5, -0.45], radius: 0.025, strength: 0.4 });
    radial.applyCommands([shot]);
    targeted.applyCommands([{ ...shot, fragmentId: 101 }]);
    expect(radial.step().broken).toEqual([]);
    expect([...radial.damage]).toEqual([0, 0]);
    expect(targeted.step().broken).toEqual([]);
    expect(targeted.chunkHealth[0]).toBeLessThan(1);
    expect(targeted.damage[1]).toBe(0);
    const initialHealth = targeted.chunkHealth[0]!;
    targeted.applyCommands([{ ...shot, id: 2, fragmentId: 101 }]);
    targeted.step();
    expect(targeted.chunkHealth[0]).toBeLessThanOrEqual(initialHealth);
    const unknown = new StructuralGraph(manifest);
    unknown.applyCommands([impact({ position: [0.5, 0.5, 0], strength: 8, fragmentId: 999 })]);
    expect(unknown.step().broken).toEqual([]);
    expect([...unknown.damage]).toEqual([0, 0]);
    expect([...unknown.chunkHealth]).toEqual([1, 1, 1]);
  });

  it("exposes initially unsupported islands without advancing material damage", () => {
    const manifest = chain();
    manifest.fragments[0].anchored = false;
    const graph = new StructuralGraph(manifest);
    expect(graph.getUnsupportedIslands()).toEqual([[1, 2, 0]]);
    expect(graph.supported.every((value) => value === 0)).toBe(true);
    expect(graph.damage.every((value) => value === 0)).toBe(true);
  });

  it("preserves local fracture on the 1,000-fragment wall", () => {
    const manifest = createScenario("wall"),
      graph = new StructuralGraph(manifest);
    graph.applyCommands([
      impact({
        type: "explosion",
        position: [0, 3, 0],
        radius: 1.25,
        strength: 1.2,
      }),
    ]);
    const result = graph.step();
    expect(result.broken.length).toBeGreaterThan(15);
    expect(result.broken.length).toBeLessThan(manifest.bonds.length * 0.1);
    expect(graph.supported.reduce((a, b) => a + b, 0)).toBeGreaterThan(850);
    for (const i of result.broken) {
      const bond = manifest.bonds[i];
      const a = manifest.fragments.find((fragment) => fragment.id === bond.a)!;
      const b = manifest.fragments.find((fragment) => fragment.id === bond.b)!;
      expect(
        Math.hypot(
          (a.position[0] + b.position[0]) / 2,
          (a.position[1] + b.position[1]) / 2 - 3,
        ),
      ).toBeLessThanOrEqual(1.25);
    }
  });

  it("replays the same command stream with identical topology and material damage every tick", () => {
    const manifest = createScenario("building"),
      a = new StructuralGraph(manifest),
      b = new StructuralGraph(manifest);
    for (let tick = 0; tick < 120; tick++) {
      if (tick % 12 === 0) {
        const command = impact({
          id: tick + 1,
          tick,
          type: "explosion",
          position: [(tick % 7) - 3, 2 + (tick % 5), 4.5],
          radius: 1.8,
        });
        a.applyCommands([command]);
        b.applyCommands([command]);
      }
      expect(a.step().checksum).toEqual(b.step().checksum);
      expect(a.damage).toEqual(b.damage);
    }
  }, 20_000); // 240 full solves; allow CPU contention with the other replay suites.

  it("makes command permutations and duplicate delivery deterministic", () => {
    const manifest = createScenario("wall"),
      a = new StructuralGraph(manifest),
      b = new StructuralGraph(manifest);
    const commands = [1, 2, 3, 4].map((id) =>
      impact({ id, strength: 0.18, position: [id * 0.15, 3, 0] }),
    );
    a.applyCommands(commands);
    b.applyCommands([...commands].reverse());
    expect(a.step().checksum).toEqual(b.step().checksum);
    expect(a.damage).toEqual(b.damage);
    b.applyCommands(commands);
    expect(a.step().checksum).toEqual(b.step().checksum);
    expect(a.damage).toEqual(b.damage);
  });

  it("keeps stable-ID checksums independent of manifest slot ordering", () => {
    const original = chain(),
      reordered = {
        ...original,
        fragments: [...original.fragments].reverse(),
        bonds: [...original.bonds].reverse(),
      };
    const a = new StructuralGraph(original),
      b = new StructuralGraph(reordered);
    const command = impact({
      type: "cut",
      position: [0.5, 0.5, 0],
      radius: 0.2,
    });
    a.applyCommands([command]);
    b.applyCommands([command]);
    expect(a.step().checksum).toEqual(b.step().checksum);
  });

  it("evaluates damage in current dynamic fragment space", () => {
    const manifest = chain(),
      graph = new StructuralGraph(manifest),
      transforms = new Float32Array(24);
    for (let i = 0; i < 3; i++) {
      transforms.set(
        [manifest.fragments[i].position[0] + 10, 0.5, 0, 0, 0, 0, 1, 0],
        i * 8,
      );
    }
    graph.applyCommands(
      [impact({ type: "cut", position: [0.5, 0.5, 0], radius: 0.2 })],
      transforms,
    );
    expect(graph.step().broken).toEqual([]);
    graph.applyCommands(
      [impact({ id: 2, type: "cut", position: [10.5, 0.5, 0], radius: 0.2 })],
      transforms,
    );
    expect(graph.step().broken).toEqual([0]);
  });

  it("never heals a weakened bond under repeated structural steps", () => {
    const manifest = chain();
    manifest.bonds[0].strength = 0.00001;
    const graph = new StructuralGraph(manifest);
    let previous = 0;
    for (let tick = 0; tick < 60; tick++) {
      graph.step();
      expect(graph.damage[0]).toBeGreaterThanOrEqual(previous);
      previous = graph.damage[0]!;
    }
    expect(graph.damage[0]).toBeLessThanOrEqual(1);
  });

  it("never reconnects islands when more bonds break", () => {
    const graph = new StructuralGraph(chain());
    graph.applyCommands([
      impact({ type: "cut", position: [0.5, 0.5, 0], radius: 0.2 }),
    ]);
    const a = graph.step();
    graph.applyCommands([
      impact({ id: 2, type: "cut", position: [1.5, 0.5, 0], radius: 0.2 }),
    ]);
    const b = graph.step();
    expect(b.islands.length).toBeGreaterThan(a.islands.length);
    for (const island of b.islands)
      for (const fragment of island) expect(graph.supported[fragment]).toBe(0);
  });

  it("allows an independent snapshot audit to compute its topology checksum", () => {
    const manifest = chain(),
      graph = new StructuralGraph(manifest);
    expect(topologyChecksum(manifest, graph.states, graph.supported)).toBe(
      graph.checksum(),
    );
    graph.applyCommands([
      impact({ type: "cut", position: [0.5, 0.5, 0], radius: 0.2 }),
    ]);
    graph.step();
    expect(topologyChecksum(manifest, graph.states, graph.supported)).toBe(
      graph.checksum(),
    );
  });

  it("leaves every pristine authored fixture stable under gravity", () => {
    for (const id of ["building", "wall", "cantilever", "bridge"] as const) {
      const manifest = createScenario(id),
        graph = new StructuralGraph(manifest);
      for (let tick = 0; tick < 120; tick++)
        expect(graph.step().broken).toEqual([]);
      expect(graph.damage.every((value) => value === 0)).toBe(true);
      expect(graph.supported.every((value) => value === 1)).toBe(true);
    }
  });
});
