import { expect, it } from "vitest";
import { DestructionSimulation } from "../../packages/destruction-physics/src/index";
import { FragmentState, type DestructibleManifest } from "../../packages/destruction-domain/src/index";

function block(): DestructibleManifest {
  return { schemaVersion: 1, assetHash: "contact-reaction-v1", name: "Contact reaction", scenario: "wall", coordinateSystem: "Y_UP_RH",
    materials: [{ id: 0, name: "Concrete", color: "#aaaaaa", density: 1000, strength: 1, brittleness: .7, friction: .7 }],
    fragments: [{ id: 1, position: [0, .496, 0], size: [1, 1, 1], mass: 10, material: 0, region: 0, anchored: false, aggregate: 1 }], bonds: [],
    regions: [{ id: 0, name: "Floor", min: [-2, 0, -2], max: [2, 2, 2] }] };
}

it("bakes a resting free actor without losing its mass or collider", async () => {
  const sim = await DestructionSimulation.create(block());
  try {
    for (let i = 0; i < 360; i++) sim.step();
    const frame = sim.frame();
    expect(frame.states[0]).toBe(FragmentState.Settled);
    expect(frame.transforms[1]).toBeGreaterThan(0.45);
    expect(frame.transforms[1]).toBeLessThan(0.55);
    expect(sim.world.bodies.getAll().some(body => body.isFixed())).toBe(true);
    expect(sim.fragmentColliders()).toHaveLength(1);
    expect(sim.graph.fragmentMass[0]).toBe(10);
  } finally { sim.dispose(); }
});

it("reports the first physical landing impact with finite energy and impulse", async () => {
  const fixture = block();
  fixture.fragments[0].position = [0, 3, 0];
  const sim = await DestructionSimulation.create(fixture);
  try {
    let impacts = 0;
    for (let i = 0; i < 120; i++) {
      const frame = sim.step();
      for (const event of frame.events.filter(event => event.type === "heavyImpact")) {
        expect(event.energy).toBeGreaterThan(0);
        expect(event.impulse).toBeGreaterThan(0);
        expect(Number.isFinite(event.energy)).toBe(true);
        impacts++;
      }
    }
    expect(impacts).toBeGreaterThan(0);
    expect([...sim.frame().transforms].every(Number.isFinite)).toBe(true);
  } finally { sim.dispose(); }
});
