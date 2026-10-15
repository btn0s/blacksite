import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DestructionSession, RuntimeHooks } from "../../packages/cascade/src/session";
import type {
  DestructibleManifest,
  DestructionCommand,
  ReplayLog,
  WorkerRequest,
  WorkerResponse,
} from "../../packages/destruction-domain/src";
class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror = null;
  postMessage = vi.fn<(message: WorkerRequest) => void>();
  terminate = vi.fn();
  constructor() {
    TestWorker.instances.push(this);
  }
  deliver(data: WorkerResponse) {
    this.onmessage?.({ data } as MessageEvent<WorkerResponse>);
  }
}
const manifest: DestructibleManifest = {
  schemaVersion: 1,
  assetHash: "placed-runtime-v1",
  scenario: "wall",
  name: "Runtime",
  coordinateSystem: "Y_UP_RH",
  fragments: [],
  bonds: [],
  regions: [],
  materials: [],
};
const sessions: DestructionSession[] = [];
beforeEach(() => {
  vi.resetModules();
  TestWorker.instances = [];
  vi.stubGlobal("Worker", TestWorker);
});
afterEach(async () => {
  for (const runtime of sessions.splice(0)) await runtime.dispose();
  vi.unstubAllGlobals();
});
async function create(allowAction?: RuntimeHooks["allowAction"]) {
  const { DestructionSession } = await import("../../packages/cascade/src/session");
  const accepted = vi.fn();
  const runtime = new DestructionSession(manifest, {
    commandAccepted: accepted,
    allowAction,
  });
  sessions.push(runtime);
  await vi.waitFor(() =>
    expect(TestWorker.instances.at(-1)?.onmessage).toBeTypeOf("function"),
  );
  const worker = TestWorker.instances.at(-1)!;
  worker.deliver({ type: "ready" });
  return { runtime, worker, accepted };
}
const object = {
  id: "emitter",
  boxes: [
    {
      position: [0, 1, 5] as [number, number, number],
      size: [1, 1, 1] as [number, number, number],
    },
  ],
};
const replayLog: ReplayLog = {
  version: 1, assetHash: manifest.assetHash, scenario: manifest.scenario,
  commands: [], endTick: 10,
};
it("single-steps into paused state and resumes with one toggle", async () => {
  const { runtime, worker } = await create();
  runtime.step();
  expect(runtime.getSnapshot().status).toBe("paused");
  expect(worker.postMessage.mock.calls.at(-1)![0]).toEqual({ type: "step" });
  expect(await runtime.removeCollisionObject("emitter")).toMatchObject({ accepted: false });
  runtime.togglePause();
  expect(worker.postMessage.mock.calls.at(-1)![0]).toEqual({ type: "pause", paused: false });
  expect(runtime.getSnapshot().status).toBe("running");
  await runtime.replay(replayLog);
  runtime.step();
  expect(runtime.getSnapshot().status).toBe("paused");
  runtime.togglePause();
  expect(runtime.getSnapshot().status).toBe("replaying");
});
it("rejects replay before readiness instead of dropping it, then accepts it once ready", async () => {
  const { DestructionSession } = await import("../../packages/cascade/src/session");
  const runtime = new DestructionSession(manifest);
  sessions.push(runtime);
  await expect(runtime.replay(replayLog)).rejects.toThrow(/not ready/);
  await vi.waitFor(() => expect(TestWorker.instances.at(-1)?.onmessage).toBeTypeOf("function"));
  const worker = TestWorker.instances.at(-1)!;
  await expect(runtime.replay(replayLog)).rejects.toThrow(/not ready/);
  runtime.step();
  expect(worker.postMessage.mock.calls.some(([message]) => message.type === "replay" || message.type === "step")).toBe(false);
  worker.deliver({ type: "ready" });
  await runtime.replay(replayLog);
  expect(runtime.getSnapshot().status).toBe("replaying");
  expect(worker.postMessage.mock.calls.at(-1)![0]).toEqual({ type: "replay", log: replayLog });
});
it("does not let a late replay export supersede reset or a newer replay", async () => {
  const { runtime, worker } = await create();
  const pending = runtime.replay();
  const request = worker.postMessage.mock.calls.at(-1)![0];
  if (request.type !== "exportReplay") throw new Error("missing export request");
  runtime.reset();
  worker.deliver({ type: "replayExport", requestId: request.requestId, log: replayLog });
  await pending;
  expect(runtime.getSnapshot().status).toBe("loading");
  expect(worker.postMessage.mock.calls.some(([message]) => message.type === "replay")).toBe(false);
  worker.deliver({ type: "ready" });
  const oldReplay = runtime.replay();
  const oldRequest = worker.postMessage.mock.calls.at(-1)![0];
  if (oldRequest.type !== "exportReplay") throw new Error("missing export request");
  const newer = { ...replayLog, endTick: 20 };
  await runtime.replay(newer);
  worker.deliver({ type: "replayExport", requestId: oldRequest.requestId, log: replayLog });
  await oldReplay;
  expect(worker.postMessage.mock.calls.filter(([message]) => message.type === "replay").map(([message]) => message)).toEqual([{ type: "replay", log: newer }]);
  expect(runtime.getSnapshot().status).toBe("replaying");
});
it("forwards optional hook reach while preserving the legacy action request", async () => {
  const narrowed = await create(() => ({
    radius: 0.48,
    strength: 2,
    reach: 1.7,
  }));
  narrowed.runtime.setPlayerEnabled(true);
  narrowed.runtime.playerAction("hammer", [0, 0, -1], 1, 1);
  expect(narrowed.worker.postMessage.mock.calls.at(-1)![0]).toMatchObject({
    type: "playerAction",
    action: "hammer",
    radius: 0.48,
    strength: 2,
    reach: 1.7,
  });
  const legacy = await create();
  legacy.runtime.setPlayerEnabled(true);
  legacy.runtime.playerAction("hammer", [0, 0, -1], 1, 1);
  expect(legacy.worker.postMessage.mock.calls.at(-1)![0]).not.toHaveProperty(
    "reach",
  );
});
it("matches request acknowledgements and only invokes spending hooks for an accepted shot", async () => {
  const { runtime, worker, accepted } = await create();
  const deploy = runtime.setCollisionObject(object);
  const request = worker.postMessage.mock.calls.at(-1)![0];
  if (request.type !== "setCollisionObject") throw new Error("missing request");
  worker.deliver({
    type: "physicsActionResult",
    requestId: request.requestId,
    accepted: false,
    message: "Obstructed",
  });
  expect(await deploy).toMatchObject({
    accepted: false,
    message: "Obstructed",
  });
  expect(accepted).not.toHaveBeenCalled();
  const shot = runtime.launchFromEmitter({
    ownerId: "emitter",
    breech: [0, 1, 5],
    muzzle: [0, 1, 3],
    direction: [0, 0, -1],
    radius: 0.2,
    strength: 3,
  });
  const fire = worker.postMessage.mock.calls.at(-1)![0];
  if (fire.type !== "launchFromEmitter")
    throw new Error("missing launch request");
  const command: DestructionCommand = {
    type: "cannonball",
    id: fire.id,
    source: fire.source,
    tick: 0,
    position: [0, 1, 2.75],
    direction: [0, 0, -1],
    radius: 0.2,
    strength: 3,
  };
  worker.deliver({
    type: "commandAccepted",
    command,
    requestId: fire.requestId,
  });
  worker.deliver({
    type: "physicsActionResult",
    requestId: fire.requestId,
    accepted: true,
    command,
  });
  expect(await shot).toMatchObject({ accepted: true, command });
  expect(accepted).toHaveBeenCalledExactlyOnceWith(command);
});
it("settles pending requests on reset and ignores stale acknowledgements without reusing IDs", async () => {
  const { runtime, worker, accepted } = await create();
  const first = runtime.setCollisionObject(object);
  const a = worker.postMessage.mock.calls.at(-1)![0];
  if (a.type !== "setCollisionObject") throw new Error("missing request");
  runtime.reset();
  expect(await first).toMatchObject({
    accepted: false,
    message: "Simulation was reset.",
  });
  worker.deliver({ type: "ready" });
  const next = runtime.setCollisionObject(object);
  const b = worker.postMessage.mock.calls.at(-1)![0];
  if (b.type !== "setCollisionObject") throw new Error("missing request");
  expect(b.requestId).toBeGreaterThan(a.requestId);
  let resolved = false;
  void next.then(() => {
    resolved = true;
  });
  worker.deliver({
    type: "commandAccepted",
    requestId: a.requestId,
    command: {
      type: "cannonball",
      id: a.requestId,
      source: 1,
      tick: 0,
      position: [0, 1, 3],
      direction: [0, 0, -1],
      radius: 0.2,
      strength: 3,
    },
  });
  expect(accepted).not.toHaveBeenCalled();
  worker.deliver({
    type: "physicsActionResult",
    requestId: a.requestId,
    accepted: true,
  });
  await Promise.resolve();
  expect(resolved).toBe(false);
  worker.deliver({
    type: "physicsActionResult",
    requestId: b.requestId,
    accepted: true,
  });
  expect(await next).toMatchObject({ accepted: true });
});
it("cancels promises on disposal and blocks physics requests while paused", async () => {
  const { runtime, worker } = await create();
  runtime.togglePause();
  worker.postMessage.mockClear();
  expect(await runtime.setCollisionObject(object)).toMatchObject({
    accepted: false,
  });
  expect(worker.postMessage).not.toHaveBeenCalled();
  runtime.togglePause();
  const pending = runtime.removeCollisionObject("emitter");
  await runtime.dispose();
  sessions.splice(sessions.indexOf(runtime), 1);
  expect(await pending).toMatchObject({
    accepted: false,
    message: "Simulation was closed.",
  });
});
