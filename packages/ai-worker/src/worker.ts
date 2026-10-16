import { Effect } from 'effect';
import { AuthorityService, createAuthority, type ManagedAuthority } from '@blacksite/ai-services';
import {
  TICK_RATE,
  type AgentCommand,
  type BeliefTrack,
  type RenderSnapshot,
  type SnapshotDetail,
  type WorkerResponse,
} from '@blacksite/ai-schema';
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
let detail: SnapshotDetail = 'full';
let mapSent = false;
let chain = Promise.resolve();
let timerQueued = false;
const commands = new Map<number, Map<string, AgentCommand>>();
const post = (message: WorkerResponse) => worker.postMessage(message);
const RENDER_TACTICAL_CANDIDATES = 4;
const lean = (track: BeliefTrack): BeliefTrack => ({
  ...track,
  provenance: track.provenance.slice(-1),
});
function forRender(snapshot: RenderSnapshot): RenderSnapshot {
  return {
    ...snapshot,
    agents: snapshot.agents.map((agent) => ({
      ...agent,
      beliefs: agent.beliefs.map(lean),
      trace: agent.trace && {
        ...agent.trace,
        candidates: [
          ...agent.trace.candidates.filter((candidate) => !('nodeId' in candidate)),
          ...agent.trace.candidates
            .filter((candidate) => 'nodeId' in candidate && candidate.applicable)
            .slice(0, RENDER_TACTICAL_CANDIDATES),
        ],
        observationProvenance: [],
      },
    })),
    sharedBeliefs: {
      alpha: snapshot.sharedBeliefs.alpha.map(lean),
      bravo: snapshot.sharedBeliefs.bravo.map(lean),
    },
  };
}
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
      if (detail === 'full' || !mapSent) {
        mapSent = true;
        post({ map: service.map, snapshot: detail === 'full' ? snapshot : forRender(snapshot), type: 'snapshot' });
      } else {
        post({ snapshot: forRender(snapshot), type: 'snapshot' });
      }
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
          detail = request.detail ?? 'full';
          mapSent = false;
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
