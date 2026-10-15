import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BondState,
  type DestructibleManifest,
  type DestructionCommand,
  type ReplayLog,
} from "../../packages/destruction-domain/src/index";
import { StructuralGraph } from "../../packages/destruction-graph/src/index";
import { DestructionSimulation } from "../../packages/destruction-physics/src/index";
import { createScenario } from "../../packages/destruction-testkit/src/index";

// Replay the recorded commands against the current bridge and compare both runs.
const supportRemovalReplay: ReplayLog = JSON.parse(
  readFileSync(
    new URL("./fixtures/bridge-support-removal.v1.json", import.meta.url),
    "utf8",
  ),
);

function westPierCuts(manifest: DestructibleManifest): DestructionCommand[] {
  const fragments = new Map(manifest.fragments.map((f) => [f.id, f]));
  return manifest.bonds
    .filter((bond) => {
      const a = fragments.get(bond.a)!,
        b = fragments.get(bond.b)!;
      return a.region === 0 && b.region === 0 && a.anchored !== b.anchored;
    })
    .map((bond, index) => {
      const a = fragments.get(bond.a)!,
        b = fragments.get(bond.b)!;
      return {
        type: "cut",
        id: index + 1,
        source: 1,
        tick: 1,
        position: [
          (a.position[0] + b.position[0]) / 2,
          (a.position[1] + b.position[1]) / 2,
          (a.position[2] + b.position[2]) / 2,
        ],
        direction: [1, 0, 0],
        radius: 0.05,
        strength: 10,
      };
    });
}

describe("structural collapse regressions", () => {
  it("keeps the undamaged twin-pier bridge stable under its own weight", () => {
    const graph = new StructuralGraph(createScenario("bridge"));
    for (let tick = 0; tick < 600; tick++) {
      expect(graph.step().broken).toEqual([]);
    }
    expect(graph.damage.every((damage) => damage === 0)).toBe(true);
    expect(graph.supported.every((supported) => supported === 1)).toBe(true);
  });

  it("breaks targeted west-pier bonds while retaining valid support and monotonic damage", () => {
    const manifest = createScenario("bridge"),
      graph = new StructuralGraph(manifest);
    const deck = manifest.fragments.flatMap((f, i) =>
      f.region === 1 ? [i] : [],
    );
    const cuts = westPierCuts(manifest);
    expect(cuts.length).toBeGreaterThan(0);
    const targets = graph.generateFracture(cuts).bonds.map((dose) => dose.bond);
    expect(targets.length).toBeGreaterThan(0);
    graph.applyCommands(cuts);
    const cutResult = graph.step();
    expect(targets.every((bond) => graph.states[bond] === BondState.Broken)).toBe(true);
    expect(cutResult.broken.length).toBeGreaterThan(0);
    expect(deck.every((i) => graph.supported[i] === 1)).toBe(true);
    let previous = graph.damage.slice();
    for (let tick = 1; tick < 600; tick++) {
      graph.step();
      expect(graph.damage.every((damage, i) => Number.isFinite(damage) && damage >= previous[i]! && damage <= 1)).toBe(true);
      previous = graph.damage.slice();
    }
    expect(graph.supported.every((supported) => supported === 0 || supported === 1)).toBe(true);
  }, 20_000); // 600 progressive solves, independent of wall-clock rendering.

  it("deterministically replays the recorded bridge impacts with finite transforms", async () => {
    const manifest = createScenario("bridge");
    const leftDeck = manifest.fragments.flatMap((fragment, index) =>
      fragment.region === 1 && fragment.position[0] < -1 ? [index] : [],
    );
    const original = await DestructionSimulation.create(manifest);
    const replay = await DestructionSimulation.create(manifest);
    try {
      for (const command of supportRemovalReplay.commands)
        original.enqueue(command);
      for (const command of [...supportRemovalReplay.commands].reverse())
        replay.enqueue(command);
      for (let tick = 1; tick <= 1800; tick++) {
        const a = original.step(),
          b = replay.step();
        if (tick === 351) {
          expect(a.stats.brokenBonds).toBe(0);
          expect(a.stats.supportedFragments).toBe(manifest.fragments.length);
        }
        expect(b.stats.checksum).toBe(a.stats.checksum);
        expect(b.bondStates).toEqual(a.bondStates);
        expect(b.states).toEqual(a.states);
        expect(b.transforms).toEqual(a.transforms);
        expect(a.transforms.every(Number.isFinite)).toBe(true);
        expect(a.stats.supportedFragments + a.stats.detachedFragments).toBeLessThanOrEqual(manifest.fragments.length);
      }
      expect(original.commandLog).toHaveLength(13);
      expect(leftDeck.length).toBeGreaterThan(0);
    } finally {
      original.dispose();
      replay.dispose();
    }
  }, 120_000);
});
