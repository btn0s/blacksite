import {
  DEFAULT_CONFIG,
  type AgentCommand,
  type RenderSnapshot,
  type ReplayFile,
  type RuntimeConfig,
  type RuntimeWorld,
  type SkillProfile,
  type TacticalMap,
  type WorkerRequest,
  type WorkerResponse,
} from '../../ai-schema/src';

export type WardenConfig = Partial<Omit<RuntimeConfig, 'skill'>> & { skill?: Partial<SkillProfile> };
export type WardenStatus = 'idle' | 'loading' | 'paused' | 'running' | 'complete' | 'error';

/** Each factory call must return a new worker owned exclusively by this session. */
export type WardenWorker = {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => unknown) | null;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
};
export type WardenWorkerFactory = () => WardenWorker;
export type WardenSessionState = {
  status: WardenStatus;
  snapshot?: RenderSnapshot;
  map?: TacticalMap;
  error?: string;
};
export type WardenSessionOptions = {
  workerFactory?: WardenWorkerFactory;
  /** A transport timeout, never a simulation clock. */
  exportTimeoutMs?: number;
};

export function resolveWardenConfig(config: WardenConfig = {}): RuntimeConfig {
  return { ...DEFAULT_CONFIG, ...config, skill: { ...DEFAULT_CONFIG.skill, ...config.skill } };
}

export function createWardenWorker(): WardenWorker {
  return new Worker(new URL('../../ai-worker/src/worker.ts', import.meta.url), { type: 'module' });
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * Local authoritative research session. Snapshots include hidden truth and private
 * beliefs: do not forward them to untrusted multiplayer clients.
 * Creation is side-effect free. connect()/disconnect() can repeat (React StrictMode).
 */
export function createWardenSession(options: WardenSessionOptions = {}) {
  const factory = options.workerFactory ?? createWardenWorker;
  let worker: WardenWorker | undefined;
  let config = resolveWardenConfig();
  let world: RuntimeWorld | undefined;
  let state: WardenSessionState = { status: 'idle' };
  const listeners = new Set<() => void>();
  let pendingExport: {
    promise: Promise<ReplayFile>;
    resolve: (replay: ReplayFile) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | undefined;

  const publish = (next: WardenSessionState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const rejectExport = (reason: string) => {
    if (!pendingExport) return;
    clearTimeout(pendingExport.timer);
    pendingExport.reject(new Error(reason));
    pendingExport = undefined;
  };
  const fail = (error: unknown) => {
    const message = messageOf(error);
    rejectExport(message);
    try { worker?.postMessage({ type: 'pause' }); } catch { /* The transport may be gone. */ }
    publish({ ...state, status: 'error', error: message });
  };
  const stopWorker = (reason: string) => {
    const previous = worker;
    worker = undefined;
    rejectExport(reason);
    if (!previous) return;
    previous.onmessage = null;
    previous.onerror = null;
    try { previous.postMessage({ type: 'dispose' }); } catch { /* A crashed worker is already unavailable. */ }
    finally { previous.terminate(); }
  };
  const connect = (nextConfig: WardenConfig = config, nextWorld?: RuntimeWorld) => {
    stopWorker('Session reset before replay export completed');
    config = resolveWardenConfig(nextConfig);
    // Own the reset inputs so host mutations cannot change a later replay/reset.
    try {
      config = structuredClone(config);
      world = nextWorld === undefined ? undefined : structuredClone(nextWorld);
      publish({ status: 'loading' });
      const active = factory();
      worker = active;
      active.onmessage = event => {
        if (worker !== active || state.status === 'error') return;
        const response = event.data;
        if (response.type === 'snapshot') {
          publish({
            map: response.map,
            snapshot: response.snapshot,
            status: response.snapshot.status === 'complete' ? 'complete' : state.status === 'running' ? 'running' : 'paused',
          });
        } else if (response.type === 'replay' && pendingExport) {
          clearTimeout(pendingExport.timer);
          pendingExport.resolve(response.replay);
          pendingExport = undefined;
        } else if (response.type === 'error') fail(response.message);
      };
      active.onerror = event => { if (worker === active) fail(event.message || 'Simulation worker failed'); };
      active.postMessage({ type: 'init', config, ...(world ? { world } : {}) });
    } catch (error) {
      stopWorker('Session initialization failed');
      fail(error);
    }
  };
  const ready = () => !!worker && !!state.snapshot && state.status !== 'error';
  const send = (request: WorkerRequest) => {
    if (!worker) return;
    try { worker.postMessage(request); } catch (error) { fail(error); }
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect,
    disconnect: () => { stopWorker('Session disconnected before replay export completed'); publish({ status: 'idle' }); },
    /** Restarts paused. Omitted config/world reuse the latest owned reset inputs. */
    reset: (nextConfig?: WardenConfig, nextWorld?: RuntimeWorld | null) => connect(
      nextConfig === undefined ? config : resolveWardenConfig(nextConfig),
      nextWorld === null ? undefined : nextWorld ?? world,
    ),
    play: (speed = 1) => {
      if (!ready() || state.status === 'complete') return;
      if (![.25, .5, 1, 2, 4, 8].includes(speed)) { fail('Speed must be 0.25, 0.5, 1, 2, 4 or 8'); return; }
      publish({ ...state, status: 'running' });
      send({ type: 'play', speed });
    },
    pause: () => {
      if (!ready()) return;
      publish({ ...state, status: state.snapshot?.status === 'complete' ? 'complete' : 'paused' });
      send({ type: 'pause' });
    },
    step: (count = 1) => {
      if (!ready() || state.status === 'complete') return;
      if (!Number.isInteger(count) || count < 1 || count > 120) { fail('Step count must be an integer from 1 to 120'); return; }
      publish({ ...state, status: 'paused' });
      send({ type: 'step', count });
    },
    /** Commands use the normal tick-indexed human/AI input queue; authority validates them. */
    command: (command: AgentCommand) => { if (ready() && state.status !== 'complete') send({ type: 'command', command }); },
    /** Concurrent callers share one export; reset/unmount/crash rejects pending callers. */
    exportReplay: (): Promise<ReplayFile> => {
      if (pendingExport) return pendingExport.promise;
      if (!ready()) return Promise.reject(new Error('Wait for an initialized simulation before exporting'));
      let resolve!: (replay: ReplayFile) => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<ReplayFile>((res, rej) => { resolve = res; reject = rej; });
      const timer = setTimeout(() => fail('Replay export timed out'), options.exportTimeoutMs ?? 10_000);
      pendingExport = { promise, resolve, reject, timer };
      send({ type: 'export' });
      return promise;
    },
  };
}

export type WardenSession = ReturnType<typeof createWardenSession>;
