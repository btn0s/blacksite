import { describe, expect, it } from "vitest";
import {
  assertManifest,
  validateManifest,
} from "../../packages/destruction-authoring/src/index";
import { createScenario } from "../../packages/destruction-testkit/src/index";

describe("content validation", () => {
  it("validates all deterministic canonical fixtures and their support paths", () => {
    for (const id of ["building", "wall", "cantilever", "bridge"] as const) {
      const manifest = createScenario(id),
        report = validateManifest(manifest);
      expect(report.errors).toEqual([]);
      expect(report.valid).toBe(true);
      expect(report.stats.anchors).toBeGreaterThan(0);
      expect(createScenario(id).assetHash).toBe(manifest.assetHash);
    }
    expect(createScenario("building").fragments.length).toBeGreaterThanOrEqual(
      500,
    );
    expect(createScenario("building").fragments.length).toBeLessThanOrEqual(
      1500,
    );
    expect(createScenario("wall").fragments.length).toBe(1000);
  });

  it("rejects malformed unknown input without throwing", () => {
    for (const input of [null, [], {}, { fragments: [null], bonds: "bad" }])
      expect(validateManifest(input).valid).toBe(false);
  });

  it("validates structural material units and numerical ranges at the authoring boundary", () => {
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
      const manifest = createScenario("cantilever");
      Object.assign(manifest.materials[0], { [key]: value });
      const report = validateManifest(manifest);
      expect(report.valid, `${key}=${String(value)}`).toBe(false);
      expect(
        report.errors.some((issue) => issue.path === `materials[0].${key}`),
      ).toBe(true);
    }
  });

  it("accepts legacy materials and finite structural properties at their range boundaries", () => {
    const manifest = createScenario("cantilever");
    const structuralKeys = [
      "youngModulus",
      "poissonRatio",
      "tensionStrength",
      "compressionStrength",
      "shearStrength",
      "bendingStrength",
    ] as const;
    for (const material of manifest.materials)
      for (const key of structuralKeys) delete material[key];
    expect(validateManifest(manifest).valid).toBe(true);
    for (const poissonRatio of [0, 0.49]) {
      Object.assign(manifest.materials[0], {
        youngModulus: poissonRatio === 0 ? 1e3 : 1e13,
        poissonRatio,
        tensionStrength: 1,
        compressionStrength: 1e13,
        shearStrength: 1e6,
        bendingStrength: 1e6,
      });
      expect(validateManifest(manifest).errors).toEqual([]);
    }
  });

  it("rejects nonfinite positions, nonpositive mass, duplicate IDs, and invalid references", () => {
    const manifest = createScenario("cantilever");
    manifest.fragments[0].position[0] = Infinity;
    manifest.fragments[1].mass = 0;
    manifest.fragments[2].id = manifest.fragments[3].id;
    manifest.fragments[4].region = 99;
    manifest.fragments[5].material = 99;
    manifest.bonds[0].a = 999999;
    const report = validateManifest(manifest);
    expect(report.valid).toBe(false);
    for (const path of [
      "fragments[0].position",
      "fragments[1].mass",
      "fragments[3].id",
      "fragments[4].region",
      "fragments[5].material",
      "bonds[0].a",
    ])
      expect(report.errors.some((issue) => issue.path === path)).toBe(true);
    expect(() => assertManifest(manifest)).toThrow(
      "Invalid destructible manifest",
    );
  });

  it("rejects unanchored authored islands and out-of-region bounds", () => {
    const manifest = createScenario("cantilever");
    manifest.bonds = manifest.bonds.filter(
      (bond) =>
        bond.a !== manifest.fragments.at(-1)!.id &&
        bond.b !== manifest.fragments.at(-1)!.id,
    );
    manifest.fragments[0].position[0] = -100;
    const report = validateManifest(manifest);
    expect(
      report.errors.some((issue) =>
        issue.message.includes("no path to a support anchor"),
      ),
    ).toBe(true);
    expect(
      report.errors.some((issue) =>
        issue.message.includes("outside its region"),
      ),
    ).toBe(true);
  });

  it("rejects duplicate endpoint pairs and non-unit contact normals", () => {
    const manifest = createScenario("bridge");
    manifest.bonds.push({ ...manifest.bonds[0], id: 999999 });
    manifest.bonds[1].normal = [0, 0, 0];
    const report = validateManifest(manifest);
    expect(
      report.errors.some((issue) =>
        issue.message.includes("Duplicate endpoint pair"),
      ),
    ).toBe(true);
    expect(
      report.errors.some((issue) => issue.message.includes("unit vector")),
    ).toBe(true);
  });
});
