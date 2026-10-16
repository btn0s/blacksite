import {
  FIXED_DT,
  simulationVersionFor,
  restVersionSuffix,
  physicsOperationsVersionFor,
  MAX_REPLAY_COMMANDS,
  MAX_REPLAY_TICKS,
  validateCommand,
  validatePhysicsOperations,
  type PhysicsOperation,
  type PhysicsActionResult,
  type BondDef,
  type DestructibleManifest,
  type DestructionCommand,
  type DestructionActor,
  type ListPatch,
  type DestructionEvent,
  type ReplayLog,
  type RestPolicy,
  type SimulationFrame,
  type WorkerRequest,
  type WorkerResponse,
} from '../../destruction-domain/src/index';
import { DestructionSimulation } from './index';
import { flavourSuffix } from './engine';
import { advanceBudgeted, nextSnapshotDeadline } from './scheduling';

const scope = self as unknown as {
  close(): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Array<Transferable>): void;
};
let simulation: DestructionSimulation | undefined;
let manifest: DestructibleManifest | undefined;
let paused = false;
let speed = 1;
let dt = FIXED_DT;
let rest: Partial<RestPolicy> | undefined;
let accumulator = 0;
let lastTime = performance.now();
let snapshotDeadline = 0;
let latest: SimulationFrame | undefined;
let pendingEvents: Array<DestructionEvent> = [];
let replay:
  | {
      commands: Array<DestructionCommand>;
      cursor: number;
      endTick: number;
      operationCursor: number;
      operations: Array<PhysicsOperation>;
    }
  | undefined;
let serial: Promise<void> = Promise.resolve();

function retainEvents(events: Array<DestructionEvent>): Array<DestructionEvent> {
  if (events.length <= 160) {
    return events;
  }
  const keep = new Set<number>();
  for (let i = events.length - 1; i >= 0 && keep.size < 32; i--) {
    if (events[i]!.type === 'explosiveDetonated' || events[i]!.type === 'cannonballImpact') {
      keep.add(i);
    }
  }
  for (let i = events.length - 1; i >= 0 && keep.size < 160; i--) {
    keep.add(i);
  }
  return events.filter((_, index) => keep.has(index));
}

// Piece definitions are immutable, so each is sent once; a frame carries the new definitions plus
// the ordered id list. Cloning every live definition per snapshot would cost the main thread tens
// of milliseconds once a collapse has thousands of pieces.
let sentPieces = new Set<number>();

function elideSentPieces(frame: SimulationFrame): void {
  const secondary = frame.secondary;
  if (!secondary) {
    sentPieces.clear();
    return;
  }
  const ids = secondary.fragments.map((fragment) => fragment.id);
  secondary.fragments = secondary.fragments.filter((fragment) => !sentPieces.has(fragment.id));
  secondary.ids = ids;
  sentPieces = new Set(ids);
}

let sentBondRevision = -1;
let sentBonds: Array<BondDef> | undefined;
let sentActors: Array<DestructionActor> | undefined;

const sameNumbers = (a: ReadonlyArray<number>, b: ReadonlyArray<number>): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const sameActor = (actor: DestructionActor, other: DestructionActor): boolean =>
  actor.id === other.id && actor.supported === other.supported &&
  sameNumbers(actor.nodes, other.nodes) && sameNumbers(actor.visibleChunks, other.visibleChunks);

function listPatch<T>(next: ReadonlyArray<T>, sent: ReadonlyArray<T>, same: (a: T, b: T) => boolean): ListPatch<T> | undefined {
  if (next.length < sent.length) return undefined;
  const indices: number[] = [], values: T[] = [];
  for (let index = 0; index < next.length; index++) {
    if (index < sent.length && same(next[index]!, sent[index]!)) continue;
    if (indices.length * 2 > next.length) return undefined;
    indices.push(index); values.push(next[index]!);
  }
  return { length: next.length, indices, values };
}

function elideUnchanged(frame: SimulationFrame): void {
  const bonds = frame.bonds;
  if (bonds && sentBonds && frame.bondRevision === sentBondRevision) frame.bonds = undefined;
  else if (bonds && sentBonds) {
    const patch = listPatch(bonds, sentBonds, (a, b) => a === b);
    if (patch) { frame.bonds = undefined; frame.bondPatch = patch; }
  }
  sentBonds = bonds;
  sentBondRevision = bonds ? frame.bondRevision ?? -1 : -1;
  const actors = frame.actors;
  if (actors && sentActors) {
    const patch = listPatch(actors, sentActors, sameActor);
    if (patch) { frame.actors = undefined; if (patch.indices.length || patch.length !== sentActors.length) frame.actorPatch = patch; }
  }
  sentActors = actors;
}

function emitFrame(scheduled = false): void {
  if (!simulation) {
    return;
  }
  const frame = latest ?? simulation.frame();
  frame.paused = paused;
  frame.events = pendingEvents;
  pendingEvents = [];
  elideSentPieces(frame);
  elideUnchanged(frame);
  scope.postMessage(frame, [
    frame.transforms.buffer,
    frame.states.buffer,
    frame.bondStates.buffer,
    ...(frame.stress ? [frame.stress.buffer] : []),
    ...(frame.stressKnown ? [frame.stressKnown.buffer] : []),
    ...(frame.secondary ? [frame.secondary.transforms.buffer, frame.secondary.states.buffer] : []),
  ]);
  latest = undefined;
  const emittedAt = performance.now();
  snapshotDeadline = scheduled
    ? nextSnapshotDeadline(snapshotDeadline, emittedAt)
    : emittedAt + 1000 / 30;
}

function applyReplayOperations(): void {
  if (!simulation || !replay) {
    return;
  }
  while (
    replay.operationCursor < replay.operations.length &&
    replay.operations[replay.operationCursor]!.tick === simulation.tick
  ) {
    simulation.applyPhysicsOperation(replay.operations[replay.operationCursor++]!);
  }
}

function advance(): void {
  if (!simulation) {
    return;
  }
  if (replay) {
    applyReplayOperations();
    while (
      replay.cursor < replay.commands.length &&
      replay.commands[replay.cursor]!.tick <= simulation.tick + 1
    ) {
      simulation.enqueue(replay.commands[replay.cursor++]!);
    }
  }
  const stepStarted = performance.now();
  latest = simulation.step();
  latest.stats.workerStepMs = performance.now() - stepStarted;
  pendingEvents.push(...latest.events);
  pendingEvents = retainEvents(pendingEvents);
  if (replay && simulation.tick >= replay.endTick) {
    applyReplayOperations();
    latest = simulation.frame();
    replay = undefined;
    paused = true;
    accumulator = 0;
    emitFrame();
    scope.postMessage({ type: 'replayComplete' });
  }
}

async function replace(nextManifest: DestructibleManifest, timestep = dt): Promise<void> {
  paused = true;
  const next = await DestructionSimulation.create(nextManifest, { timestep, ...(rest ? { rest } : {}) });
  dt = timestep;
  simulation?.dispose();
  sentPieces.clear();
  sentBondRevision = -1;
  sentBonds = undefined;
  sentActors = undefined;
  simulation = next;
  manifest = nextManifest;
  accumulator = 0;
  speed = 1;
  lastTime = performance.now();
  latest = next.frame();
  pendingEvents = [];
  replay = undefined;
}

function checkedReplay(log: ReplayLog): ReplayLog {
  if (
    log?.simulationVersion !== simulationVersionFor(dt) + flavourSuffix() + restVersionSuffix(rest) &&
    log?.simulationVersion !== physicsOperationsVersionFor(dt) + flavourSuffix() + restVersionSuffix(rest)
  ) {
    throw new Error('Replay requires a different simulation version.');
  }
  if (
    Array.isArray(log?.physicsOperations) &&
    log.physicsOperations.length > 0 &&
    log.simulationVersion !== physicsOperationsVersionFor(dt) + flavourSuffix() + restVersionSuffix(rest)
  ) {
    throw new Error('Replay physics operations require their simulation version marker.');
  }
  if (
    !manifest ||
    !log ||
    log.version !== 1 ||
    log.assetHash !== manifest.assetHash ||
    log.scenario !== manifest.scenario
  ) {
    throw new Error('Replay does not match the loaded content manifest.');
  }
  if (
    !Number.isSafeInteger(log.endTick) ||
    log.endTick < 0 ||
    log.endTick > MAX_REPLAY_TICKS ||
    !Array.isArray(log.commands) ||
    log.commands.length > MAX_REPLAY_COMMANDS
  ) {
    throw new Error('Replay exceeds tick or command limits.');
  }
  const ids = new Set<string>();
  for (const command of log.commands) {
    if (!command || !validateCommand(command) || command.tick > log.endTick) {
      throw new Error('Replay contains an invalid command or a command after its end tick.');
    }
    const key = `${command.source}:${command.id}`;
    if (ids.has(key)) {
      throw new Error('Replay contains a duplicate command ID.');
    }
    ids.add(key);
  }
  if (!validatePhysicsOperations(log.physicsOperations, log.commands, log.endTick)) {
    throw new Error('Replay contains invalid physics operations.');
  }
  return log;
}

async function handle(message: WorkerRequest): Promise<void> {
  if (!message || typeof message.type !== 'string') {
    throw new Error('Invalid Worker request.');
  }
  switch (message.type) {
    case 'init':
      rest = message.rest;
      await replace(message.manifest, message.timestep ?? FIXED_DT);
      paused = false;
      scope.postMessage({ type: 'ready' });
      emitFrame();
      break;
    case 'command': {
      if (!simulation) {
        throw new Error('Simulation has not initialized.');
      }
      if (replay) {
        throw new Error('Commands are disabled during replay.');
      }
      const accepted = simulation.enqueue(message.command);
      if (accepted) {
        scope.postMessage({ command: accepted, type: 'commandAccepted' });
      }
      break;
    }
    case 'setCollisionObject':
    case 'removeCollisionObject':
    case 'launchFromEmitter': {
      let result: PhysicsActionResult;
      try {
        if (!Number.isSafeInteger(message.requestId) || message.requestId < 0) {
          throw new Error('Invalid physics request ID.');
        }
        if (!simulation || paused || replay) {
          result = {
            accepted: false,
            message: 'Resume the simulation to change physics objects.',
          };
        } else if (message.type === 'setCollisionObject') {
          result = simulation.setCollisionObject(message.object, message.clearanceBoxes);
        } else if (message.type === 'removeCollisionObject') {
          result = simulation.removeCollisionObject(message.id);
        } else {
          result = simulation.launchFromEmitter(message.launch, message.id, message.source);
        }
      } catch (error) {
        result = {
          accepted: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
      if (result.command) {
        scope.postMessage({
          command: result.command,
          requestId: message.requestId,
          type: 'commandAccepted',
        });
      }
      scope.postMessage({
        requestId: message.requestId,
        type: 'physicsActionResult',
        ...result,
      });
      if (result.accepted && simulation) {
        latest = simulation.frame();
        emitFrame();
      }
      break;
    }
    case 'pause':
      paused = Boolean(message.paused);
      simulation?.clearPlayerInput();
      accumulator = 0;
      lastTime = performance.now();
      emitFrame();
      break;
    case 'speed':
      if (!Number.isFinite(message.speed) || message.speed < 0.1 || message.speed > 4) {
        throw new Error('Simulation speed must be between 0.1 and 4.');
      }
      speed = message.speed;
      break;
    case 'step':
      paused = true;
      simulation?.clearPlayerInput();
      advance();
      emitFrame();
      break;
    case 'player':
      if (!simulation) {
        throw new Error('Simulation has not initialized.');
      }
      simulation.setPlayerEnabled(Boolean(message.enabled) && !replay);
      latest = simulation.frame();
      emitFrame();
      break;
    case 'playerInput':
      if (simulation && !paused && !replay) {
        simulation.setPlayerInput(message.input);
      }
      break;
    case 'playerRespawn':
      if (simulation && !replay) {
        simulation.respawnPlayer();
        latest = simulation.frame();
        emitFrame();
      }
      break;
    case 'playerAction': {
      if (!simulation || replay || paused) {
        scope.postMessage({
          message: 'Resume the simulation to use ordnance.',
          type: 'actionResult',
        });
        break;
      }
      const result = simulation.playerAction(message);
      if (result.command) {
        scope.postMessage({ command: result.command, type: 'commandAccepted' });
      }
      if (result.message) {
        scope.postMessage({ message: result.message, type: 'actionResult' });
      }
      break;
    }
    case 'reset':
      if (!manifest) {
        throw new Error('Simulation has not initialized.');
      }
      await replace(manifest);
      paused = false;
      scope.postMessage({ type: 'ready' });
      emitFrame();
      break;
    case 'replay': {
      const log = checkedReplay(message.log);
      await replace(manifest!);
      replay = {
        commands: [...log.commands].sort(
          (a, b) => a.tick - b.tick || a.id - b.id || a.source - b.source,
        ),
        cursor: 0,
        endTick: log.endTick,
        operationCursor: 0,
        operations: log.physicsOperations ?? [],
      };
      paused = false;
      applyReplayOperations();
      latest = simulation!.frame();
      emitFrame();
      if (log.endTick === 0) {
        replay = undefined;
        paused = true;
        scope.postMessage({ type: 'replayComplete' });
      }
      break;
    }
    case 'exportReplay':
      if (!simulation) {
        throw new Error('Simulation has not initialized.');
      }
      emitFrame();
      scope.postMessage({
        log: simulation.recordReplay(),
        requestId: message.requestId,
        type: 'replayExport',
      });
      break;
    case 'dispose':
      clearInterval(timer);
      simulation?.dispose();
      simulation = undefined;
      scope.close();
      break;
    default:
      throw new Error('Unknown Worker request.');
  }
}

scope.onmessage = (event) => {
  serial = serial
    .then(() => handle(event.data))
    .catch((error) => {
      scope.postMessage({
        message: error instanceof Error ? error.message : String(error),
        type: 'error',
      });
    });
};

const timer = setInterval(() => {
  const now = performance.now();
  const elapsed = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;
  if (!simulation || paused) {
    return;
  }
  try {
    const result = advanceBudgeted(
      accumulator + elapsed * speed,
      () => {
        const began = performance.now();
        advance();
        // At 30 Hz every step is a snapshot; a jittery clock must not skip every other one.
        if (!paused && latest && (dt > 1 / 45 || performance.now() >= snapshotDeadline)) {
          emitFrame(true);
        }
        // Profile the whole step including snapshots; physics policy uses counted work only.
        simulation?.noteStepCost(performance.now() - began);
        return !paused;
      },
      () => performance.now(),
      dt,
    );
    accumulator = result.remainder;
    if (result.dropped) {
      simulation.noteDroppedFrames(result.dropped);
    }
  } catch (error) {
    paused = true;
    simulation?.clearPlayerInput();
    scope.postMessage({
      message: error instanceof Error ? error.message : String(error),
      type: 'error',
    });
  }
}, 8);
