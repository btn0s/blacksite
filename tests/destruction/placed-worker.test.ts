import { afterEach, expect, it, vi } from "vitest";
import {
  PHYSICS_OPERATIONS_VERSION,
  SIMULATION_VERSION,
  type DestructibleManifest,
  type WorkerRequest,
  type WorkerResponse,
} from "../../packages/destruction-domain/src";
const manifest: DestructibleManifest = {
  schemaVersion: 1,
  assetHash: "placed-worker-v1",
  name: "Protocol",
  scenario: "wall",
  coordinateSystem: "Y_UP_RH",
  fragments: [
    {
      id: 1,
      position: [30, 3, 30],
      size: [1, 1, 1],
      mass: 10,
      material: 0,
      region: 0,
      aggregate: 0,
      anchored: true,
    },
  ],
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
  bonds: [],
  regions: [],
};
let scope: {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
  close: () => void;
};
afterEach(async () => {
  scope?.onmessage?.({
    data: { type: "dispose" },
  } as MessageEvent<WorkerRequest>);
  await Promise.resolve();
  await Promise.resolve();
  vi.unstubAllGlobals();
  vi.resetModules();
});
it("acknowledges requests by ID, exports actual shots once and clears objects on reset/replay", async () => {
  vi.resetModules();
  const messages: WorkerResponse[] = [];
  scope = {
    onmessage: null,
    postMessage: (message) => {
      messages.push(message);
    },
    close: vi.fn(),
  };
  vi.stubGlobal("self", scope);
  // Deterministic protocol test; step messages own the simulation clock.
  vi.stubGlobal(
    "setInterval",
    vi.fn(() => 0),
  );
  await import("../../packages/destruction-physics/src/destruction.worker");
  async function send(
    request: WorkerRequest,
    done: (message: WorkerResponse) => boolean,
  ) {
    const start = messages.length;
    scope.onmessage!({ data: request } as MessageEvent<WorkerRequest>);
    await vi.waitFor(() => expect(messages.slice(start).some(done)).toBe(true));
    return messages.slice(start);
  }
  await send({ type: "init", manifest }, (message) => message.type === "ready");
  const object = {
    id: "emitter",
    boxes: [
      {
        position: [0, 1, 5] as [number, number, number],
        size: [1, 1, 1] as [number, number, number],
      },
    ],
  };
  const deploy = await send(
    { type: "setCollisionObject", requestId: 40, object },
    (message) => message.type === "physicsActionResult",
  );
  expect(deploy).toContainEqual({
    type: "physicsActionResult",
    requestId: 40,
    accepted: true,
  });
  const launch = {
    ownerId: "emitter",
    breech: [0, 1, 5] as [number, number, number],
    muzzle: [0, 1, 3] as [number, number, number],
    direction: [0, 0, -1] as [number, number, number],
    radius: 0.2,
    strength: 3,
  };
  const shot = await send(
    { type: "launchFromEmitter", requestId: 41, id: 41, source: 1, launch },
    (message) => message.type === "physicsActionResult",
  );
  expect(shot[0].type).toBe("commandAccepted");
  expect(shot[1]).toMatchObject({
    type: "physicsActionResult",
    requestId: 41,
    accepted: true,
  });
  const exported = await send(
    { type: "exportReplay", requestId: 42 },
    (message) => message.type === "replayExport",
  );
  const reply = exported.find((message) => message.type === "replayExport")!;
  expect(reply.log.commands).toHaveLength(0);
  expect(reply.log.physicsOperations).toHaveLength(2);
  expect(reply.log.simulationVersion).toBe(PHYSICS_OPERATIONS_VERSION);
  const reset = await send(
    { type: "reset" },
    (message) => message.type === "ready",
  );
  expect(
    reset.find((message) => message.type === "frame")!.ordnance,
  ).toHaveLength(0);
  const failed = await send(
    { type: "launchFromEmitter", requestId: 43, id: 43, source: 1, launch },
    (message) => message.type === "physicsActionResult",
  );
  expect(failed).toHaveLength(1);
  expect(failed[0]).toMatchObject({
    type: "physicsActionResult",
    requestId: 43,
    accepted: false,
  });
  const downgraded = await send(
    {
      type: "replay",
      log: { ...reply.log, simulationVersion: SIMULATION_VERSION },
    },
    (message) => message.type === "error",
  );
  expect(downgraded[0]).toMatchObject({
    type: "error",
    message:
      "Replay physics operations require their simulation version marker.",
  });
  const replay = await send(
    { type: "replay", log: reply.log },
    (message) => message.type === "replayComplete",
  );
  expect(
    replay.find((message) => message.type === "frame")!.ordnance,
  ).toHaveLength(1);
  expect(replay.some((message) => message.type === "commandAccepted")).toBe(
    false,
  );
  const legacy = await send(
    {
      type: "replay",
      log: {
        ...reply.log,
        simulationVersion: SIMULATION_VERSION,
        physicsOperations: undefined,
      },
    },
    (message) => message.type === "replayComplete",
  );
  expect(
    legacy.find((message) => message.type === "frame")!.ordnance,
  ).toHaveLength(0);
});
