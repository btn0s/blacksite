import { describe, expect, it } from "vitest";
import { DestructionSimulation } from "../../packages/destruction-physics/src/index";
import {
  FragmentState,
  type DestructibleManifest,
  type DestructionCommand,
} from "../../packages/destruction-domain/src/index";

function fixture(anchored = false): DestructibleManifest {
  return {
    schemaVersion: 1,
    assetHash: "physics-test-v1",
    name: "Physics fixture",
    scenario: "wall",
    coordinateSystem: "Y_UP_RH",
    materials: [
      {
        id: 0,
        name: "Concrete",
        color: "#aaa",
        density: 1000,
        strength: 2,
        brittleness: 0.7,
        friction: 0.8,
      },
    ],
    regions: [],
    fragments: [
      {
        id: 10,
        position: [-0.5, 8, 0],
        size: [1, 1, 1],
        mass: 1,
        material: 0,
        region: 0,
        anchored,
        aggregate: 0,
      },
      {
        id: 30,
        position: [0.5, 8, 0],
        size: [1, 1, 1],
        mass: 1,
        material: 0,
        region: 0,
        anchored: false,
        aggregate: 0,
      },
    ],
    bonds: [{ id: 100, a: 10, b: 30, area: 1, strength: 2, normal: [1, 0, 0] }],
  };
}
const cut = (tick = 1): DestructionCommand => ({
  type: "cut",
  id: 5,
  source: 0,
  tick,
  position: [0, 8, 0],
  direction: [1, 0, 0],
  radius: 0.4,
  strength: 10,
});

describe("Rapier destruction simulation", () => {
  it("keeps supported fragments fixed without per-fragment rigid bodies", async () => {
    const sim = await DestructionSimulation.create(fixture(true));
    try {
      for (let i = 0; i < 30; i++) sim.step();
      expect(sim.world.bodies.getAll().filter(body => body.isDynamic())).toHaveLength(0);
      expect(sim.frame().stats.supportedFragments).toBe(2);
      expect(sim.frame().transforms[1]).toBe(8);
      sim.enqueue(cut());
      const frame = sim.step();
      expect(frame.stats.activeBodies).toBe(1);
      expect(frame.stats.detachedFragments).toBe(1);
      expect(frame.states[0]).toBe(FragmentState.Supported);
      expect(frame.states[1]).toBe(FragmentState.Dynamic);
      expect(frame.stats.brokenBonds).toBe(1);
    } finally {
      sim.dispose();
    }
  });

  it("activates a connected unsupported island and settles without losing fragments", async () => {
    const sim = await DestructionSimulation.create(fixture());
    try {
      expect(sim.frame().stats.detachedFragments).toBe(2);
      expect([...sim.frame().states]).toEqual([
        FragmentState.Dynamic,
        FragmentState.Dynamic,
      ]);
      expect(sim.world.bodies.len()).toBe(1);
      sim.step();
      expect(sim.world.bodies.len()).toBe(1);
      expect(sim.frame().stats.detachedFragments).toBe(2);
      for (let i = 0; i < 29; i++) sim.step();
      expect(sim.frame().transforms[1]).toBeLessThan(7);
      for (let i = 0; i < 420; i++) sim.step();
      const frame = sim.frame();
      expect(frame.transforms[1]).toBeGreaterThan(0.45);
      expect(frame.transforms[1]).toBeLessThan(0.6);
      expect(frame.states).toHaveLength(2);
      expect(frame.transforms.every(Number.isFinite)).toBe(true);
      expect(frame.stats.settledBodies).toBeGreaterThanOrEqual(1);
      expect(frame.stats.activeBodies).toBe(0);
    } finally {
      sim.dispose();
    }
  });

  it("splits a moving aggregate while preserving its existing horizontal momentum", async () => {
    const sim = await DestructionSimulation.create(fixture());
    try {
      sim.step();
      sim.world.forEachRigidBody((body) =>
        body.setLinvel({ x: 3, y: -1, z: 2 }, true),
      );
      sim.enqueue(cut(2));
      const frame = sim.step();
      expect(frame.stats.activeBodies).toBe(2);
      expect(sim.world.bodies.len()).toBe(2);
      const velocities: { x: number; z: number }[] = [];
      sim.world.forEachRigidBody((body) => velocities.push(body.linvel()));
      for (const velocity of velocities) {
        expect(velocity.x).toBeCloseTo(3, 1);
        expect(velocity.z).toBeCloseTo(2, 1);
      }
    } finally {
      sim.dispose();
    }
  });

  it("replays canonical ticks, command ordering, topology and physics with the pinned Wasm", async () => {
    const original = await DestructionSimulation.create(fixture(true));
    const replay = await DestructionSimulation.create(fixture(true));
    try {
      const commands: DestructionCommand[] = [
        cut(10),
        {
          ...cut(12),
          id: 9,
          type: "explosion",
          position: [0.5, 8, 0],
          radius: 2,
          strength: 1,
        },
      ];
      for (const command of [...commands].reverse()) original.enqueue(command);
      expect(original.enqueue(commands[0])).toBeNull();
      for (const command of original.commandLog) replay.enqueue(command);
      for (let i = 0; i < 180; i++) {
        const a = original.step(),
          b = replay.step();
        expect(b.stats.checksum).toBe(a.stats.checksum);
        expect(b.transforms).toEqual(a.transforms);
        expect(b.states).toEqual(a.states);
      }
      expect(original.commandLog).toHaveLength(2);
      expect(original.recordReplay().endTick).toBe(180);
    } finally {
      original.dispose();
      replay.dispose();
    }
  });

  it("owns frame buffers and rejects invalid commands without corrupting the world", async () => {
    const sim = await DestructionSimulation.create(fixture());
    try {
      const frame = sim.frame();
      frame.transforms.fill(999);
      expect(sim.frame().transforms[1]).toBe(8);
      expect(() => sim.enqueue({ ...cut(), radius: Infinity })).toThrow(
        "Invalid destruction command",
      );
      sim.step();
      const accepted = sim.enqueue(cut(0));
      expect(accepted?.tick).toBe(2);
      sim.dispose();
      expect(() => sim.step()).toThrow("disposed");
    } finally {
      sim.dispose();
    }
  });

  it("reproduces contact-energy cascades without recording them as user commands", async () => {
    const manifest = fixture();
    manifest.fragments.forEach((fragment) => {
      fragment.mass = 100;
    });
    manifest.bonds[0].strength = 0.15;
    const original = await DestructionSimulation.create(manifest);
    const replay = await DestructionSimulation.create(manifest);
    let heavyImpacts = 0;
    try {
      for (let i = 0; i < 240; i++) {
        const a = original.step(),
          b = replay.step();
        heavyImpacts += a.events.filter(
          (event) => event.type === "heavyImpact",
        ).length;
        expect(b.transforms).toEqual(a.transforms);
        expect(b.stats.checksum).toBe(a.stats.checksum);
      }
      expect(heavyImpacts).toBeGreaterThan(0);
      expect(original.recordReplay().commands).toHaveLength(0);
    } finally {
      original.dispose();
      replay.dispose();
    }
  });

  it("bounds dynamic bodies while retaining collision and render slots for overflow", async () => {
    const manifest = fixture();
    manifest.bonds = [];
    manifest.fragments = Array.from({ length: 6150 }, (_, i) => ({
      ...manifest.fragments[0],
      id: i + 1,
      position: [(i % 30) * 1.2 - 18, 6, Math.floor(i / 30) * 1.2 - 10],
    }));
    const sim = await DestructionSimulation.create(manifest);
    try {
      const frame = sim.step();
      expect(frame.stats.activeBodies).toBe(6144);
      expect(frame.stats.settledBodies).toBe(6);
      expect(frame.stats.capacityEvents).toBe(6);
      expect(frame.stats.detachedFragments).toBe(6150);
      expect(sim.world.colliders.len()).toBe(6151);
      expect(frame.transforms.every(Number.isFinite)).toBe(true);
    } finally {
      sim.dispose();
    }
  });

  it("omits commands scheduled beyond a replay end tick", async () => {
    const sim = await DestructionSimulation.create(fixture(true));
    try {
      sim.enqueue(cut(10));
      expect(sim.recordReplay().commands).toHaveLength(0);
      for (let i = 0; i < 10; i++) sim.step();
      expect(sim.recordReplay().commands).toHaveLength(1);
    } finally {
      sim.dispose();
    }
  });

  it("rejects nonfinite structural data and duplicate stable IDs before initializing physics", async () => {
    const nonfinite = fixture();
    nonfinite.bonds[0].strength = NaN;
    await expect(DestructionSimulation.create(nonfinite)).rejects.toThrow(
      "Invalid bond",
    );
    const duplicate = fixture();
    duplicate.bonds.push({ ...duplicate.bonds[0] });
    await expect(DestructionSimulation.create(duplicate)).rejects.toThrow(
      "Invalid bond",
    );
    const unknownMaterial = fixture();
    unknownMaterial.fragments[0].material = 99;
    await expect(DestructionSimulation.create(unknownMaterial)).rejects.toThrow(
      "Invalid fragment",
    );
  });

  it("rejects malformed optional elastic and stress properties before initializing physics", async () => {
    const invalidProperties: [string, unknown][] = [
      ["youngModulus", 999],
      ["youngModulus", 1e14],
      ["youngModulus", Infinity],
      ["youngModulus", null],
      ["poissonRatio", -0.01],
      ["poissonRatio", 0.5],
      ["poissonRatio", NaN],
      ["poissonRatio", "0.2"],
    ];
    for (const key of [
      "tensionStrength",
      "compressionStrength",
      "shearStrength",
      "bendingStrength",
    ])
      for (const value of [0, -1, Infinity, NaN, null, "1000", 1e14])
        invalidProperties.push([key, value]);
    for (const [key, value] of invalidProperties) {
      const manifest = fixture();
      Object.assign(manifest.materials[0], { [key]: value });
      await expect(DestructionSimulation.create(manifest)).rejects.toThrow(
        "Invalid material",
      );
    }
  });

  it("accepts finite structural properties on the runtime boundary", async () => {
    for (const poissonRatio of [0, 0.49]) {
      const manifest = fixture();
      Object.assign(manifest.materials[0], {
        youngModulus: poissonRatio === 0 ? 1e3 : 1e13,
        poissonRatio,
        tensionStrength: 1,
        compressionStrength: 1e13,
        shearStrength: 1e6,
        bendingStrength: 1e6,
      });
      const sim = await DestructionSimulation.create(manifest);
      sim.dispose();
    }
  });
});
