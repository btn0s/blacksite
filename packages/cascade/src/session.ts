import { Effect } from 'effect';
import { createActor } from 'xstate';
import { matchMachine } from '../../destruction-machines/src/index';
import {
  PhysicsWorker,
  createWorkerRuntime,
  type WorkerPort,
} from '../../destruction-effects/src/index';
import { PresentationWorld } from '../../destruction-ecs/src/index';
import type {
  BondDef,
  CollisionBox,
  CollisionObject,
  EmitterLaunch,
  PhysicsActionResult,
  WorkerRequest,
  PlayerInput,
  PlayerTool,
  DestructibleManifest,
  DestructionCommand,
  SimulationFrame,
  WorkerResponse,
  ReplayLog,
  SimulationStats,
  Vec3,
  DestructionEvent,
  SecondaryFragmentDef,
} from '../../destruction-domain/src/index';
export interface RuntimeView {
  actionMessage: string;
  actionSerial: number;
  cannonballCount: number;
  chargeCount: number;
  commandCount: number;
  error: string | null;
  events: Array<DestructionEvent>;
  simulationHz: number;
  snapshotHz: number;
  stats: SimulationStats | null;
  status: string;
}
export interface RuntimeHooks {
  actionResult?: (message: string) => void;
  allowAction?: (
    tool: PlayerTool,
    direction: Vec3,
  ) => boolean | { radius: number; reach?: number; strength: number };
  commandAccepted?: (command: DestructionCommand) => void;
  frame?: (frame: SimulationFrame, previous: SimulationFrame | null) => void;
  ready?: () => void;
}
type PhysicsRequest = Extract<
  WorkerRequest,
  { type: 'setCollisionObject' | 'removeCollisionObject' | 'launchFromEmitter' }
>;
export class DestructionSession {
  readonly actor = createActor(matchMachine).start();
  readonly mirror: PresentationWorld;
  frame: SimulationFrame | null = null;
  previous: SimulationFrame | null = null;
  frameAt = 0;
  frames = 0;
  /** Main-thread milliseconds spent applying frame messages since last read (see `takeApplyMs`). */
  private applyMs = 0;
  private pieces = new Map<number, SecondaryFragmentDef>();
  private bonds: Array<BondDef> | undefined;
  private snapshotPeriod = 1000 / 30;
  private readonly timestep: number | undefined;
  private rateSample = { at: 0, frames: 0, tick: 0 };
  private managed: ReturnType<typeof createWorkerRuntime>;
  private worker: WorkerPort | null = null;
  private disposed = false;
  private lifecycleRevision = 0;
  private replaying = false;
  private sequence = 1;
  private playerEnabled = false;
  private log: Array<DestructionCommand> = [];
  private exportSequence = 0;
  private pendingPhysics = new Map<number, (result: PhysicsActionResult) => void>();
  private pendingExports = new Map<
    number,
    { reject: (error: Error) => void; resolve: (log: ReplayLog) => void }
  >();
  private lastNotify = 0;
  private view: RuntimeView = {
    actionMessage: '',
    actionSerial: 0,
    cannonballCount: 0,
    chargeCount: 0,
    commandCount: 0,
    error: null,
    events: [],
    simulationHz: 0,
    snapshotHz: 0,
    stats: null,
    status: 'loading',
  };
  private listeners = new Set<() => void>();
  constructor(
    readonly manifest: DestructibleManifest,
    readonly hooks: RuntimeHooks = {},
    options: { timestep?: number; workerFactory?: () => WorkerPort } = {},
  ) {
    this.timestep = options.timestep;
    this.managed = createWorkerRuntime(options.workerFactory ?? createDestructionWorker);
    this.mirror = new PresentationWorld(manifest);
    this.actor.subscribe((s) => {
      this.view = { ...this.view, status: String(s.value) };
      this.emit();
    });
    this.start();
  }
  private async start() {
    try {
      const worker = await this.managed.runPromise(Effect.map(PhysicsWorker, (w) => w));
      if (this.disposed) {
        return;
      }
      this.worker = worker;
      worker.onmessage = (e) => this.receive(e.data as WorkerResponse);
      worker.onerror = (e) => this.fail(e.message || 'Physics worker stopped unexpectedly');
      worker.postMessage({ manifest: this.manifest, timestep: this.timestep, type: 'init' });
    } catch (error) {
      this.fail(String(error));
    }
  }
  private fail(error: string) {
    this.lifecycleRevision++;
    this.cancelPhysicsRequests(error);
    for (const pending of this.pendingExports.values()) {
      pending.reject(new Error(error));
    }
    this.pendingExports.clear();
    this.view = { ...this.view, error };
    this.actor.send({ type: 'FAIL' });
  }
  private receive(message: WorkerResponse) {
    if (this.disposed) {
      return;
    }
    if (message.type === 'physicsActionResult') {
      this.pendingPhysics.get(message.requestId)?.({
        accepted: message.accepted,
        command: message.command,
        message: message.message,
      });
      this.pendingPhysics.delete(message.requestId);
      return;
    }
    if (message.type === 'replayExport') {
      this.pendingExports.get(message.requestId)?.resolve(message.log);
      this.pendingExports.delete(message.requestId);
      return;
    }
    if (message.type === 'ready') {
      this.actor.send({ type: 'READY' });
      this.setPlayerEnabled(this.playerEnabled);
      this.hooks.ready?.();
      return;
    }
    if (message.type === 'error') {
      this.fail(message.message);
      return;
    }
    if (message.type === 'actionResult') {
      this.hooks.actionResult?.(message.message);
      this.view = {
        ...this.view,
        actionMessage: message.message,
        actionSerial: this.view.actionSerial + 1,
      };
      this.emit();
      return;
    }
    if (message.type === 'commandAccepted') {
      if (message.requestId !== undefined && !this.pendingPhysics.has(message.requestId)) {
        return;
      }
      this.log.push(message.command);
      this.hooks.commandAccepted?.(message.command);
      this.view = { ...this.view, commandCount: this.log.length };
      this.emit();
      return;
    }
    if (message.type === 'replayComplete') {
      this.replaying = false;
      this.actor.send({ type: 'COMPLETE' });
      this.setPlayerEnabled(this.playerEnabled);
      return;
    }
    if (message.type === 'frame') {
      if (this.view.status === 'loading') {
        return;
      }
      const arrivedAt = performance.now();
      const applyStarted = arrivedAt;
      if (this.frame && message.tick > this.frame.tick) {
        const observed = Math.max(16, Math.min(100, arrivedAt - this.frameAt));
        this.snapshotPeriod = this.snapshotPeriod * 0.7 + observed * 0.3;
      }
      if (message.bonds) this.bonds = message.bonds;
      else if (this.frame && message.tick < this.frame.tick) this.bonds = undefined;
      message.bonds = this.bonds;
      const secondary = message.secondary;
      if (secondary?.ids) {
        for (const piece of secondary.fragments) {
          this.pieces.set(piece.id, piece);
        }
        secondary.fragments = secondary.ids.map((id) => this.pieces.get(id)!);
        if (this.pieces.size > secondary.ids.length) {
          const live = new Set(secondary.ids);
          for (const id of this.pieces.keys()) {
            if (!live.has(id)) {
              this.pieces.delete(id);
            }
          }
        }
        secondary.ids = undefined;
      } else {
        this.pieces.clear();
      }
      this.previous = this.frame;
      this.frame = message;
      this.frameAt = arrivedAt;
      const sample = this.rateSample;
      if (!sample.at || message.tick < sample.tick) {
        this.rateSample = { at: arrivedAt, frames: 0, tick: message.tick };
      } else {
        sample.frames++;
        const elapsed = arrivedAt - sample.at;
        if (elapsed >= 750) {
          this.view = {
            ...this.view,
            simulationHz: Math.round(((message.tick - sample.tick) * 1000) / elapsed),
            snapshotHz: Math.round((sample.frames * 1000) / elapsed),
          };
          this.rateSample = { at: arrivedAt, frames: 0, tick: message.tick };
        }
      }
      this.frames++;
      this.mirror.accept(message);
      this.hooks.frame?.(message, this.previous);
      this.view = {
        ...this.view,
        cannonballCount: message.ordnance?.filter((o) => o.type === 'cannonball').length ?? 0,
        chargeCount: message.ordnance?.filter((o) => o.type === 'explosive').length ?? 0,
        events: [...message.events, ...this.view.events].slice(0, 50),
        stats: message.stats,
      };
      if (this.view.status === 'paused' || performance.now() - this.lastNotify > 120) {
        this.lastNotify = performance.now();
        this.emit();
      }
      this.applyMs += performance.now() - applyStarted;
    }
  }
  takeApplyMs(): number {
    const ms = this.applyMs;
    this.applyMs = 0;
    return ms;
  }
  interpolationAlpha = () => Math.min(1, (performance.now() - this.frameAt) / this.snapshotPeriod);
  private emit() {
    this.listeners.forEach((fn) => fn());
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.view;
  impact(
    type: DestructionCommand['type'],
    position: Vec3,
    direction: Vec3,
    radius: number,
    strength: number,
    fragmentId?: number,
    minRadius?: number,
  ) {
    if (this.view.status !== 'running') {
      return false;
    }
    const command: DestructionCommand = {
      direction,
      id: this.sequence++,
      position: position.map((v) => Math.round(v * 100) / 100) as Vec3,
      radius,
      source: 1,
      strength,
      tick: (this.frame?.tick ?? 0) + 1,
      type,
      ...(fragmentId === undefined ? {} : { fragmentId }),
      ...(minRadius === undefined ? {} : { minRadius }),
    };
    this.worker?.postMessage({ command, type: 'command' });
    return true;
  }
  setCollisionObject(
    object: CollisionObject,
    clearanceBoxes: Array<CollisionBox> = [],
  ): Promise<PhysicsActionResult> {
    return this.physicsRequest((requestId) => ({
      clearanceBoxes,
      object,
      requestId,
      type: 'setCollisionObject',
    }));
  }
  removeCollisionObject(id: string): Promise<PhysicsActionResult> {
    return this.physicsRequest((requestId) => ({
      id,
      requestId,
      type: 'removeCollisionObject',
    }));
  }
  launchFromEmitter(launch: EmitterLaunch): Promise<PhysicsActionResult> {
    return this.physicsRequest((requestId) => ({
      id: requestId,
      launch,
      requestId,
      source: 1,
      type: 'launchFromEmitter',
    }));
  }
  private physicsRequest(
    makeRequest: (requestId: number) => PhysicsRequest,
  ): Promise<PhysicsActionResult> {
    if (!this.worker || this.disposed || this.replaying || this.view.status !== 'running') {
      return Promise.resolve({
        accepted: false,
        message: 'Simulation is unavailable or paused.',
      });
    }
    const requestId = this.sequence++;
    return new Promise((resolve) => {
      this.pendingPhysics.set(requestId, resolve);
      this.worker!.postMessage(makeRequest(requestId));
    });
  }
  private cancelPhysicsRequests(message: string): void {
    for (const resolve of this.pendingPhysics.values()) {
      resolve({ accepted: false, message });
    }
    this.pendingPhysics.clear();
  }
  setPlayerEnabled(enabled: boolean) {
    this.playerEnabled = enabled;
    this.worker?.postMessage({
      enabled,
      type: 'player',
    });
  }
  playerInput(input: PlayerInput) {
    this.worker?.postMessage({ input, type: 'playerInput' });
  }
  respawnPlayer() {
    this.worker?.postMessage({ type: 'playerRespawn' });
  }
  playerAction(
    action: PlayerTool,
    direction: Vec3,
    radius: number,
    strength: number,
    reach?: number,
  ) {
    if (this.view.status !== 'running' || !this.playerEnabled) {
      return;
    }
    const allowed = this.hooks.allowAction?.(action, direction) ?? true;
    if (!allowed) {
      return;
    }
    if (typeof allowed === 'object') {
      ({ radius, strength } = allowed);
      reach = allowed.reach ?? reach;
    }
    this.worker?.postMessage({
      action,
      direction,
      id: this.sequence++,
      radius: action === 'cannonball' ? 0.32 : radius,
      strength,
      type: 'playerAction',
      ...(reach === undefined ? {} : { reach }),
    });
  }
  togglePause() {
    if (!['paused', 'running', 'replaying'].includes(this.view.status)) {
      return;
    }
    const paused = this.view.status === 'paused';
    this.worker?.postMessage({ paused: !paused, type: 'pause' });
    this.actor.send({
      type: paused ? (this.replaying ? 'REPLAY' : 'RESUME') : 'PAUSE',
    });
  }
  setSpeed(speed: number) {
    this.worker?.postMessage({ speed, type: 'speed' });
  }
  step() {
    if (
      !this.worker ||
      this.disposed ||
      !['paused', 'running', 'replaying'].includes(this.view.status)
    ) {
      return;
    }
    this.actor.send({ type: 'PAUSE' });
    this.worker.postMessage({ type: 'step' });
  }
  reset() {
    this.lifecycleRevision++;
    this.cancelPhysicsRequests('Simulation was reset.');
    this.replaying = false;
    this.log = [];
    this.frame = null;
    this.previous = null;
    this.bonds = undefined;
    this.rateSample = { at: 0, frames: 0, tick: 0 };
    this.snapshotPeriod = 1000 / 30;
    this.view = {
      ...this.view,
      cannonballCount: 0,
      chargeCount: 0,
      commandCount: 0,
      error: null,
      events: [],
      stats: null,
    };
    this.actor.send({ type: 'RESET' });
    this.worker?.postMessage({ type: 'reset' });
  }
  async replay(log?: ReplayLog) {
    if (
      !this.worker ||
      this.disposed ||
      !['paused', 'running', 'replaying'].includes(this.view.status)
    ) {
      throw new Error('Simulation is unavailable or not ready for replay.');
    }
    const revision = ++this.lifecycleRevision;
    const replay = log ?? (await this.exportReplay());
    if (this.disposed || revision !== this.lifecycleRevision) {
      return;
    }
    this.cancelPhysicsRequests('Simulation was replaced by replay.');
    this.replaying = true;
    this.log = [
      ...replay.commands,
      ...(replay.physicsOperations ?? []).flatMap((operation) =>
        operation.type === 'launchFromEmitter' ? [operation.command] : [],
      ),
    ];
    this.sequence = Math.max(this.sequence, ...this.log.map((c) => c.id + 1));
    this.frame = null;
    this.previous = null;
    this.bonds = undefined;
    this.rateSample = { at: 0, frames: 0, tick: 0 };
    this.snapshotPeriod = 1000 / 30;
    this.view = {
      ...this.view,
      cannonballCount: 0,
      chargeCount: 0,
      commandCount: this.log.length,
      events: [],
    };
    this.actor.send({ type: 'REPLAY' });
    this.worker?.postMessage({ log: replay, type: 'replay' });
  }
  exportReplay(): Promise<ReplayLog> {
    if (!this.worker || this.disposed) {
      return Promise.reject(new Error('Simulation is unavailable.'));
    }
    const requestId = ++this.exportSequence;
    return new Promise((resolve, reject) => {
      this.pendingExports.set(requestId, { reject, resolve });
      this.worker!.postMessage({ requestId, type: 'exportReplay' });
    });
  }
  async dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.lifecycleRevision++;
    this.cancelPhysicsRequests('Simulation was closed.');
    for (const pending of this.pendingExports.values()) {
      pending.reject(new Error('Simulation was closed.'));
    }
    this.pendingExports.clear();
    this.actor.stop();
    this.mirror.dispose();
    this.listeners.clear();
    await this.managed.dispose();
  }
}

export function createDestructionWorker(): WorkerPort {
  return new Worker(
    new URL('../../destruction-physics/src/destruction.worker.ts', import.meta.url),
    {
      type: 'module',
    },
  );
}
