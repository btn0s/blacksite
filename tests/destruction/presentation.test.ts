import { describe, it, expect } from "vitest";
import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial } from "three";
import { Effect } from "effect";
import { createActor } from "xstate";
import { TransformPool } from "../../packages/destruction-render/src";
import {
  createWorkerRuntime,
  PhysicsWorker,
  type WorkerPort,
} from "../../packages/destruction-effects/src";
import { matchMachine } from "../../packages/destruction-machines/src";
describe("presentation ownership and lifecycle", () => {
  it("rejects stale releases and duplicate owners after slot reuse", () => {
    const mesh = new InstancedMesh(
        new BoxGeometry(),
        new MeshBasicMaterial(),
        2,
      ),
      pool = new TransformPool(mesh, 2);
    const first = pool.allocate(55);
    expect(() => pool.allocate(55)).toThrow();
    pool.write(first.slot, new Matrix4().makeTranslation(1, 2, 3));
    expect(pool.release(first.slot, first.generation)).toBe(true);
    const second = pool.allocate(99);
    expect(second.slot).toBe(first.slot);
    expect(second.generation).toBeGreaterThan(first.generation);
    expect(pool.release(first.slot, first.generation)).toBe(false);
    expect(pool.ownerBySlot[second.slot]).toBe(99);
    pool.allocate(101);
    expect(() => pool.allocate(102)).toThrow(/capacity/);
    mesh.geometry.dispose();
    (mesh.material as MeshBasicMaterial).dispose();
  });
  it("scoped Effect service terminates an acquired Worker exactly once", async () => {
    let stopped = 0;
    const worker: WorkerPort = {
      postMessage() {},
      terminate() {
        stopped++;
      },
      onmessage: null,
      onerror: null,
    };
    const runtime = createWorkerRuntime(() => worker);
    expect(await runtime.runPromise(Effect.map(PhysicsWorker, (w) => w))).toBe(
      worker,
    );
    expect(stopped).toBe(0);
    await runtime.dispose();
    expect(stopped).toBe(1);
  });
  it("coarse lifecycle allows loading, playback pause and reset without fragment actors", () => {
    const actor = createActor(matchMachine).start();
    actor.send({ type: "READY" });
    expect(actor.getSnapshot().value).toBe("running");
    actor.send({ type: "REPLAY" });
    actor.send({ type: "PAUSE" });
    expect(actor.getSnapshot().value).toBe("paused");
    actor.send({ type: "REPLAY" });
    expect(actor.getSnapshot().value).toBe("replaying");
    actor.send({ type: "COMPLETE" });
    expect(actor.getSnapshot().value).toBe("paused");
    actor.send({ type: "RESET" });
    expect(actor.getSnapshot().value).toBe("loading");
    actor.stop();
  });
});
