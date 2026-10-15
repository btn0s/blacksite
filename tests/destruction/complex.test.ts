import { describe, expect, it } from "vitest";
import { validateManifest } from "../../packages/destruction-authoring/src/index";
import {
  FragmentState,
} from "../../packages/destruction-domain/src/index";
import { DestructionSimulation } from "../../packages/destruction-physics/src/index";
import {
  createComplexScenario,
  createOrganicScenario,
  createScenario,
} from "../../packages/destruction-testkit/src/index";

const complex = createComplexScenario();

describe("municipal service annex", () => {
  it("authors a deterministic, portable level with validated convex members and actual contact sections", () => {
    expect(validateManifest(complex).errors).toEqual([]);
    expect(complex.fragments.length).toBeGreaterThan(600);
    expect(complex.fragments.length).toBeLessThan(900);
    expect(complex.fragments.every((fragment) => fragment.shape)).toBe(true);
    expect(complex.bonds.every((bond) => bond.section)).toBe(true);
    expect(createComplexScenario()).toEqual(complex);
    expect(createScenario("complex").assetHash).toBe(complex.assetHash);
    expect(createOrganicScenario("complex").assetHash).toBe(complex.assetHash);
    expect(complex.level?.spawn.position[1]).toBeGreaterThanOrEqual(0);
    expect(
      complex.level?.boxes.filter((box) => box.collidable).length,
    ).toBeGreaterThan(30);
    // Static circulation and context are part of asset identity, not client-only scenery.
    const staticIds = complex.level!.boxes.map((box) => box.id);
    expect(new Set(staticIds).size).toBe(staticIds.length);
    expect(staticIds).toContain("core-top-landing");
  });

  it("rejects malformed level collision and presentation data at the portable authoring boundary", () => {
    const level = complex.level!,
      box = level.boxes[0],
      sign = level.signs![0],
      light = level.lights![0];
    const invalid: [unknown, string][] = [
      [null, "level"],
      [{ ...level, spawn: { position: [0, NaN, 0], yaw: 0 } }, "level.spawn"],
      [
        { ...level, spawn: { position: [0, 0, 0], yaw: Infinity } },
        "level.spawn",
      ],
      [
        { ...level, camera: { position: [0, 0], target: [0, 0, 0] } },
        "level.camera",
      ],
      [{ ...level, boxes: null }, "level.boxes"],
      [
        { ...level, boxes: Array.from({ length: 4097 }, () => box) },
        "level.boxes",
      ],
      [{ ...level, boxes: [box, box] }, "level.boxes[1].id"],
      [{ ...level, boxes: [{ ...box, size: [1, 0, 1] }] }, "level.boxes[0]"],
      [
        { ...level, boxes: [{ ...box, rotation: [0, 0, 0, 0] }] },
        "level.boxes[0].rotation",
      ],
      [
        { ...level, boxes: [{ ...box, rotation: [0, 0, 0, 2] }] },
        "level.boxes[0].rotation",
      ],
      [
        { ...level, boxes: [{ ...box, collidable: "yes" }] },
        "level.boxes[0].collidable",
      ],
      [
        { ...level, boxes: [{ ...box, material: "unsupported" }] },
        "level.boxes[0].material",
      ],
      [{ ...level, signs: [{ ...sign, width: -1 }] }, "level.signs[0]"],
      [{ ...level, signs: [{ ...sign, text: 42 }] }, "level.signs[0]"],
      [
        { ...level, signs: [{ ...sign, rotation: [0, Infinity, 0] }] },
        "level.signs[0]",
      ],
      [{ ...level, lights: [{ ...light, intensity: NaN }] }, "level.lights[0]"],
      [{ ...level, lights: [{ ...light, distance: 0 }] }, "level.lights[0]"],
    ];
    for (const [level, path] of invalid) {
      const report = validateManifest({ ...complex, level });
      expect(report.valid, path).toBe(false);
      expect(
        report.errors.some((issue) => issue.path.startsWith(path)),
        path,
      ).toBe(true);
    }
  });

  it("holds its intact wing and cantilever at equilibrium without spontaneous damage", async () => {
    const simulation = await DestructionSimulation.create(complex);
    try {
      for (let tick = 0; tick < 600; tick++) simulation.step();
      const frame = simulation.frame();
      expect(frame.stats.brokenBonds).toBe(0);
      expect(frame.stats.supportedFragments).toBe(complex.fragments.length);
      expect(frame.stats.detachedFragments).toBe(0);
      expect(frame.stats.solverConverged).toBe(true);
      expect(frame.stats.maxUtilization).toBeLessThan(1);
      expect(frame.stats.capacityEvents).toBe(0);
      expect(frame.transforms.every(Number.isFinite)).toBe(true);
    } finally {
      simulation.dispose();
    }
  }, 20_000);

  it("localizes an upper-route cut while leaving supported gallery members in place", async () => {
    const simulation = await DestructionSimulation.create(complex);
    try {
      simulation.enqueue({
        type: "cut",
        id: 1,
        source: 1,
        tick: 1,
        position: [6, 3.27, 0.5],
        direction: [1, 0, 0],
        radius: 1.65,
        strength: 4,
      });
      for (let tick = 0; tick < 360; tick++) simulation.step();
      const frame = simulation.frame();
      const gallery = complex.fragments
        .map((fragment, index) => ({ fragment, index }))
        .filter(({ fragment }) => fragment.region === 2);
      expect(gallery.length).toBeGreaterThan(20);
      expect(frame.stats.brokenBonds).toBeGreaterThan(0);
      expect(gallery.some(({ index }) => frame.states[index] !== FragmentState.Supported)).toBe(true);
      expect(gallery.some(({ index }) => frame.states[index] === FragmentState.Supported)).toBe(true);
      expect(frame.stats.supportedFragments).toBeGreaterThan(
        complex.fragments.length * 0.8,
      );
      expect(frame.stats.capacityEvents).toBe(0);
      expect(frame.transforms.every(Number.isFinite)).toBe(true);
    } finally {
      simulation.dispose();
    }
  }, 20_000);
});
