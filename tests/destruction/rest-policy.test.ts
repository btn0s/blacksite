import { describe, expect, it } from "vitest";
import { DestructionSimulation } from "../../packages/destruction-physics/src/index";
import { SIMULATION_VERSION, restVersionSuffix, type DestructibleManifest } from "../../packages/destruction-domain/src/index";

function supportedColumn(): DestructibleManifest {
  return {
    schemaVersion: 1, assetHash: "rest-policy-v1", name: "Rest policy", scenario: "wall", coordinateSystem: "Y_UP_RH",
    materials: [{ id: 0, name: "Concrete", color: "#aaaaaa", density: 2000, strength: 1, brittleness: .8, friction: .7 }],
    regions: [{ id: 0, name: "Test", min: [-3, 0, -3], max: [3, 4, 3] }],
    fragments: [
      { id: 1, position: [0, .1, 0], size: [.6, .2, .6], mass: 20, material: 0, region: 0, anchored: true, aggregate: 1 },
      { id: 2, position: [0, .95, 0], size: [.4, 1.5, .4], mass: 40, material: 0, region: 0, anchored: false, aggregate: 2 },
      { id: 3, position: [0, 2.1, 0], size: [1, .5, 1], mass: 10, material: 0, region: 0, anchored: false, aggregate: 3 },
    ],
    bonds: [{ id: 1, a: 1, b: 2, area: .16, strength: 1, normal: [0, 1, 0] }],
  };
}

const rest = { forceAfterSeconds: 1, forceSpeed: .5, forceSpin: .9 };

describe("rest policy", () => {
  it("keeps the default simulation version and marks opted-in runs", async () => {
    expect(restVersionSuffix()).toBe("");
    const plain = await DestructionSimulation.create(supportedColumn());
    const rested = await DestructionSimulation.create(supportedColumn(), { rest });
    try {
      expect(plain.simulationVersion).toBe(SIMULATION_VERSION);
      expect(rested.simulationVersion).toBe(SIMULATION_VERSION + restVersionSuffix(rest));
      expect(rested.simulationVersion).not.toBe(SIMULATION_VERSION);
    } finally { plain.dispose(); rested.dispose(); }
  });

  it("rejects values that are not finite and positive", async () => {
    await expect(DestructionSimulation.create(supportedColumn(), { rest: { forceSpeed: 0 } })).rejects.toThrow(/Rest policy/);
    await expect(DestructionSimulation.create(supportedColumn(), { rest: { forceAfterSeconds: Number.NaN } })).rejects.toThrow(/Rest policy/);
  });

  it("replays identically and still drops rested rubble when its support goes", async () => {
    const a = await DestructionSimulation.create(supportedColumn(), { rest });
    const b = await DestructionSimulation.create(supportedColumn(), { rest });
    try {
      for (let i = 0; i < 360; i++) expect(b.step().stats.checksum).toBe(a.step().stats.checksum);
      const resting = a.frame().transforms[17]!;
      expect(resting).toBeGreaterThan(1.8);
      a.graph.removeFragment(1);
      for (let i = 0; i < 240; i++) a.step();
      expect(a.frame().transforms[17]).toBeLessThan(.8);
    } finally { a.dispose(); b.dispose(); }
  });
});
