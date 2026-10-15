import { Effect } from 'effect';
import { AuthorityService, createAuthority, type ManagedAuthority } from '@blacksite/ai-services';
import { TICK_RATE, type AgentCommand, type WorkerResponse } from '@blacksite/ai-schema';
import { parseRequest } from './validation';
type WorkerBoundary = {
  close(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: WorkerResponse): void;
};
const worker = self as unknown as WorkerBoundary;
let authority: ManagedAuthority | undefined;
let playing = false;
let speed = 1;
let credit = 0;
let currentTick = 0;
let chain = Promise.resolve();
let timerQueued = false;
const commands = new Map<number, Map<string, AgentCommand>>();
const post = (message: WorkerResponse) => worker.postMessage(message);
const fail = (error: unknown) => {
  playing = false;
  post({ message: error instanceof Error ? error.message : String(error), type: 'error' });
};
async function publish(stepCount = 0) {
  if (!authority) {
    return;
  }
  await authority.runPromise(
    Effect.gen(function* () {
      const service = yield* AuthorityService;
      let snapshot = yield* service.snapshot();
      for (let i = 0; i < stepCount && snapshot.status !== 'complete'; i++) {
        const inputs = [...(commands.get(snapshot.tick + 1)?.values() ?? [])];
        commands.delete(snapshot.tick + 1);
        snapshot = yield* service.step(inputs);
      }
      currentTick = snapshot.tick;
      if (snapshot.status === 'complete') {
        playing = false;
      }
      post({ map: service.map, snapshot, type: 'snapshot' });
    }),
  );
}
worker.onmessage = (event) => {
  chain = chain
    .then(async () => {
      const request = parseRequest(event.data);
      switch (request.type) {
        case 'init':
          playing = false;
          credit = 0;
          commands.clear();
          currentTick = 0;
          await authority?.dispose();
          authority = createAuthority(request.config, request.world);
          await publish();
          break;
        case 'play':
          if (!authority) {
            throw new Error('Initialize a session first');
          }
          playing = true;
          speed = request.speed;
          break;
        case 'pause':
          playing = false;
          credit = 0;
          break;
        case 'step':
          playing = false;
          await publish(request.count ?? 1);
          break;
        case 'export':
          if (authority) {
            post({
              replay: await authority.runPromise(
                Effect.flatMap(AuthorityService, (service) => service.replay()),
              ),
              type: 'replay',
            });
          }
          break;
        case 'command': {
          if (request.command.tick <= currentTick || request.command.tick > currentTick + 120) {
            throw new Error('Command is stale or too far in the future');
          }
          const queued = commands.get(request.command.tick) ?? new Map<string, AgentCommand>();
          queued.set(request.command.agentId, request.command);
          commands.set(request.command.tick, queued);
          break;
        }
        case 'dispose':
          playing = false;
          clearInterval(timer);
          await authority?.dispose();
          authority = undefined;
          worker.close();
          break;
      }
    })
    .catch(fail);
};
const timer = setInterval(() => {
  if (!playing || timerQueued) {
    return;
  }
  timerQueued = true;
  chain = chain
    .then(async () => {
      if (!playing) {
        return;
      }
      credit += speed;
      const steps = Math.floor(credit);
      credit -= steps;
      if (steps > 0) {
        await publish(steps);
      }
    })
    .catch(fail)
    .finally(() => {
      timerQueued = false;
    });
}, 1000 / TICK_RATE);
