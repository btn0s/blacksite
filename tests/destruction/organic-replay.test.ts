import { describe, it, expect } from "vitest";
import { createOrganicScenario } from "../../packages/destruction-testkit/src";
import { prepareFixtureReplay } from "../../packages/destruction-testkit/src/replay";
import { type ReplayLog } from "../../packages/destruction-domain/src";
import recording from "./fixtures/building-contact-collapse.v1.json";

describe("organic building replay compatibility", () => {
  it("rejects the pre-threshold building recording with a clear content-hash error", () => {
    const organic = createOrganicScenario("building");
    const log = recording as ReplayLog;
    expect(() => prepareFixtureReplay(log, organic)).toThrow(
      "Replay content hash does not match the loaded structure.",
    );
  });
  it("rejects unrelated, modified-destination and future-solver recordings", () => {
    const organic = createOrganicScenario("building"),
      log = recording as ReplayLog;
    expect(() =>
      prepareFixtureReplay({ ...log, assetHash: "unknown" }, organic),
    ).toThrow(/hash/);
    expect(() =>
      prepareFixtureReplay(log, { ...organic, assetHash: "edited" }),
    ).toThrow(/hash/);
    expect(() =>
      prepareFixtureReplay(
        { ...log, simulationVersion: "future-solver" },
        organic,
      ),
    ).toThrow(/hash/);
  });
});
