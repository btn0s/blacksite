import { Context, Effect, Layer, ManagedRuntime } from 'effect';
export interface WorkerPort {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Array<Transferable>): void;
  terminate(): void;
}
export class PhysicsWorker extends Context.Tag('cascade/PhysicsWorker')<
  PhysicsWorker,
  WorkerPort
>() {}
export const WorkerLive = (factory: () => WorkerPort) =>
  Layer.scoped(
    PhysicsWorker,
    Effect.acquireRelease(Effect.sync(factory), (worker) => Effect.sync(() => worker.terminate())),
  );
export const WorkerTest = (worker: WorkerPort) => Layer.succeed(PhysicsWorker, worker);
export const createWorkerRuntime = (factory: () => WorkerPort) =>
  ManagedRuntime.make(WorkerLive(factory));
