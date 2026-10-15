import { describe, it, expect } from "vitest";
import { bondUtilization } from "../../packages/destruction-graph/src/stress";
import { getBondSection } from "../../packages/destruction-graph/src/equilibrium";
import { createScenario } from "../../packages/destruction-testkit/src/index";
import { prepareFixtureReplay } from "../../packages/destruction-testkit/src/replay";
import { parseReplay, serializeReplay } from "../../packages/destruction-network/src/index";
import source from "./fixtures/bridge-support-removal.v1.json";
import { SIMULATION_VERSION, type ReplayLog } from "../../packages/destruction-domain/src/index";
describe("material stress and recorded fixture migration", () => {
  it("separates tension, compression, shear and pure contact bending", () => {
    const m = createScenario("wall"),
      section = getBondSection(m, m.bonds.find((b) => b.normal[1] === 1)!);
    const strength = {
      tension: 1e6,
      compression: 10e6,
      shear: 2e6,
      bending: 3e6,
    };
    const force = 1e6 * section.area;
    expect(
      bondUtilization(section, [0, force, 0], [0, 0, 0], strength).combined,
    ).toBeCloseTo(1);
    expect(
      bondUtilization(section, [0, -force, 0], [0, 0, 0], strength).combined,
    ).toBeCloseTo(0.1);
    const s = section.tangent1.map((v) => v * 2e6 * section.area) as [
      number,
      number,
      number,
    ];
    expect(bondUtilization(section, s, [0, 0, 0], strength).shear).toBeCloseTo(
      1,
    );
    const moment = section.tangent1.map(
      (v) => v * 3e6 * section.sectionModulus1,
    ) as [number, number, number];
    expect(
      bondUtilization(section, [0, 0, 0], moment, strength).bending,
    ).toBeCloseTo(1);
  });
  it("upgrades the actual known legacy replay explicitly and preserves every command", () => {
    const manifest = createScenario("bridge"),
      legacy = structuredClone(source) as ReplayLog;
    // Unversioned recordings are never parsed as current physics on their own.
    expect(legacy.simulationVersion).toBeUndefined();
    expect(() => parseReplay(JSON.stringify(source))).toThrow(/simulation version/);
    const result = prepareFixtureReplay(legacy, manifest);
    expect(result.upgraded).toBe(true);
    expect(result.log.commands).toEqual(legacy.commands);
    expect(result.log.endTick).toBe(9611);
    expect(result.log.assetHash).toBe(manifest.assetHash);
    expect(result.log.simulationVersion).toBe(SIMULATION_VERSION);
    // The explicit upgrade output must satisfy the strict parser without losing commands.
    const log = parseReplay(serializeReplay(result.log), manifest.assetHash);
    expect(log.commands).toEqual(legacy.commands);
    expect(log.simulationVersion).toBe(SIMULATION_VERSION);
    expect(prepareFixtureReplay(log, manifest).upgraded).toBe(false);
  });
  it("does not bypass checks for unknown content or simulation revisions", () => {
    const log = structuredClone(source) as ReplayLog,
      manifest = createScenario("bridge");
    expect(() =>
      prepareFixtureReplay({ ...log, assetHash: "unknown" }, manifest),
    ).toThrow(/hash/);
    expect(() => prepareFixtureReplay(log, createScenario("wall"))).toThrow(
      /Select/,
    );
    expect(() =>
      prepareFixtureReplay({ ...log, simulationVersion: "different-solver" }, manifest),
    ).toThrow(/hash/);
    expect(() => parseReplay(JSON.stringify(source))).toThrow(/simulation version/);
    expect(() =>
      parseReplay(
        JSON.stringify({ ...source, simulationVersion: "different-solver" }),
      ),
    ).toThrow(/version/);
  });
});
