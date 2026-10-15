import { expect, it } from "vitest";
import { DestructionSimulation } from "../../packages/destruction-physics/src/index";
import { FragmentState, type DestructibleManifest } from "../../packages/destruction-domain/src/index";

function supportedColumn(): DestructibleManifest {
  return {
    schemaVersion: 1, assetHash: "settled-support-regression-v1", name: "Removable support", scenario: "wall", coordinateSystem: "Y_UP_RH",
    materials: [{ id: 0, name: "Concrete", color: "#aaaaaa", density: 2000, strength: 1, brittleness: .8, friction: .7 }],
    regions: [{ id: 0, name: "Test", min: [-3, 0, -3], max: [3, 4, 3] }],
    fragments: [
      { id: 1, position: [0, .1, 0], size: [.6, .2, .6], mass: 20, material: 0, region: 0, anchored: true, aggregate: 1 },
      { id: 2, position: [0, .95, 0], size: [.4, 1.5, .4], mass: 40, material: 0, region: 0, anchored: false, aggregate: 2 },
      // No graph bond: this free piece rests through actual Rapier contact.
      { id: 3, position: [0, 2.1, 0], size: [1, .5, 1], mass: 10, material: 0, region: 0, anchored: false, aggregate: 3 },
    ],
    bonds: [{ id: 1, a: 1, b: 2, area: .16, strength: 1, normal: [0, 1, 0] }],
  };
}

it("settled rubble falls again after its physical support is removed", async () => {
  const sim = await DestructionSimulation.create(supportedColumn());
  try {
    for (let i = 0; i < 360; i++) sim.step();
    const resting = sim.frame();
    expect(resting.states[2]).toBe(FragmentState.Settled);
    expect(resting.transforms[17]).toBeGreaterThan(1.8);
    sim.graph.removeFragment(1);
    for (let i = 0; i < 240; i++) sim.step();
    const fallen = sim.frame();
    expect(sim.graph.isRemoved(1)).toBe(true);
    expect(fallen.transforms[17], "The top piece must fall when its column disappears, even though it previously settled.").toBeLessThan(resting.transforms[17] - 1);
    expect(fallen.transforms[17]).toBeLessThan(.8);
  } finally { sim.dispose(); }
});
