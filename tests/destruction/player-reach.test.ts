import { afterEach, describe, expect, it } from "vitest";
import { DestructionSimulation } from "../../packages/destruction-physics/src";
import type {
  DestructibleManifest,
  WorkerRequest,
} from "../../packages/destruction-domain/src";
const sessions: DestructionSimulation[] = [];
afterEach(() => sessions.splice(0).forEach((sim) => sim.dispose()));
async function surface(distance: number) {
  const manifest: DestructibleManifest = {
    schemaVersion: 1,
    assetHash: "player-reach-v1",
    name: "Action reach",
    scenario: "wall",
    coordinateSystem: "Y_UP_RH",
    materials: [
      {
        id: 0,
        name: "Concrete",
        color: "#aaa",
        density: 1000,
        strength: 1,
        brittleness: 0.8,
        friction: 0.8,
      },
    ],
    fragments: [
      {
        id: 10,
        position: [0, 2, -distance - 0.1],
        size: [2, 4, 0.2],
        mass: 100,
        material: 0,
        region: 0,
        aggregate: 0,
        anchored: true,
      },
    ],
    bonds: [],
    regions: [],
    level: {
      spawn: { position: [0, 0.03, 0], yaw: 0 },
      camera: { position: [5, 5, 5], target: [0, 0, 0] },
      boxes: [],
    },
  };
  const sim = await DestructionSimulation.create(manifest);
  sessions.push(sim);
  sim.setPlayerEnabled(true);
  sim.step();
  return sim;
}
function action(
  id: number,
  reach?: number,
): Extract<WorkerRequest, { type: "playerAction" }> {
  return {
    type: "playerAction",
    id,
    action: "hammer",
    direction: [0, 0, -1],
    radius: 0.48,
    strength: 1,
    ...(reach === undefined ? {} : { reach }),
  };
}
describe("optional authoritative surface reach", () => {
  it("accepts a near strike and rejects a farther strike while legacy range remains valid", async () => {
    const near = await surface(1.5),
      far = await surface(2);
    expect(near.playerAction(action(1, 1.7)).command?.type).toBe("pointImpact");
    expect(far.playerAction(action(1, 1.7))).toMatchObject({
      message: "Move within 1.7 m of a surface.",
    });
    expect(far.recordReplay().commands).toHaveLength(0);
    expect(far.playerAction(action(1)).command?.type).toBe("pointImpact");
  });
  it("never permits a requested reach beyond each tool's engine maximum", async () => {
    const hammerFar = await surface(2.6),
      allFar = await surface(3.4);
    expect(hammerFar.playerAction(action(1, 1e9)).command).toBeUndefined();
    expect(
      hammerFar.playerAction({ ...action(2, 1e9), action: "cutter" }).command
        ?.type,
    ).toBe("cut");
    for (const tool of ["hammer", "cutter", "explosive"] as const)
      expect(
        allFar.playerAction({ ...action(1, 1e9), action: tool }).command,
      ).toBeUndefined();
  });
  it("rejects nonfinite or nonpositive reach without recording a hit", async () => {
    const sim = await surface(1.5);
    for (const reach of [NaN, Infinity, -Infinity, 0, -1]) {
      expect(sim.playerAction(action(1, reach))).toEqual({
        message: "Invalid player action.",
      });
      expect(sim.recordReplay().commands).toHaveLength(0);
    }
    expect(sim.playerAction(action(1, 1.7)).command?.type).toBe("pointImpact");
  });
});
