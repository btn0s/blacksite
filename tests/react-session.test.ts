import { afterEach, describe, expect, it, vi } from 'vitest';
import { TacticalRuntime } from '../packages/ai-runtime/src';
import { DEFAULT_CONFIG, type RuntimeWorld, type WorkerRequest, type WorkerResponse } from '../packages/ai-schema/src';
import { createWardenSession, type WardenSession, type WardenWorker } from '../packages/warden-react/src/session';

class FakeWorker implements WardenWorker {
  onmessage: WardenWorker['onmessage'] = null;
  onerror: WardenWorker['onerror'] = null;
  messages: WorkerRequest[] = [];
  terminated = false;
  postMessage(message: WorkerRequest) { this.messages.push(structuredClone(message)); }
  terminate() { this.terminated = true; }
  respond(response: WorkerResponse) { this.onmessage?.(new MessageEvent('message', { data: response })); }
}

function fixture() {
  const runtime = new TacticalRuntime({ ...DEFAULT_CONFIG, agentsPerTeam: 1 });
  try { return { snapshot: runtime.snapshot(), map: runtime.map, replay: runtime.exportReplay() }; }
  finally { runtime.dispose(); }
}
const data = fixture();
const sessions: WardenSession[] = [];
function setup(exportTimeoutMs?: number) {
  const workers: FakeWorker[] = [];
  const session = createWardenSession({ workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; }, exportTimeoutMs });
  sessions.push(session);
  return { session, workers, initialize: () => workers.at(-1)!.respond({ type: 'snapshot', snapshot: data.snapshot, map: data.map }) };
}
afterEach(() => { for (const session of sessions.splice(0)) session.disconnect(); vi.useRealTimers(); });

describe('reusable React worker session', () => {
  it('starts without side effects and supports StrictMode connect/cleanup/connect without stale updates', () => {
    const { session, workers, initialize } = setup();
    expect(workers).toHaveLength(0);
    expect(session.getSnapshot()).toEqual({ status: 'idle' });
    session.connect({ seed: 7, skill: { reaction: .2 } });
    const first = workers[0];
    const oldHandler = first.onmessage;
    expect(first.messages[0]).toMatchObject({ type: 'init', config: { seed: 7, skill: { reaction: .2, perception: DEFAULT_CONFIG.skill.perception } } });
    session.disconnect();
    expect(first.terminated).toBe(true);
    expect(first.messages.at(-1)).toEqual({ type: 'dispose' });
    session.connect({ seed: 7 });
    oldHandler?.(new MessageEvent('message', { data: { type: 'error', message: 'stale old worker' } }));
    expect(session.getSnapshot().status).toBe('loading');
    initialize();
    expect(session.getSnapshot().status).toBe('paused');
    expect(workers).toHaveLength(2);
  });

  it('owns reset inputs and can explicitly remove a custom world', () => {
    const { session, workers } = setup();
    const world: RuntimeWorld = { map: structuredClone(data.map), initialAmmo: 9 };
    session.connect({ seed: 123 }, world);
    world.initialAmmo = 1;
    session.reset();
    expect(workers[1].messages[0]).toMatchObject({ type: 'init', config: { seed: 123 }, world: { initialAmmo: 9 } });
    session.reset({ seed: 456 }, null);
    expect(workers[2].messages[0]).toMatchObject({ type: 'init', config: { seed: 456 } });
    expect(workers[2].messages[0]).not.toHaveProperty('world');
  });

  it('shares concurrent replay exports and rejects them when reset invalidates the world', async () => {
    const { session, workers, initialize } = setup();
    session.connect(); initialize();
    const first = session.exportReplay();
    expect(session.exportReplay()).toBe(first);
    expect(workers[0].messages.filter(message => message.type === 'export')).toHaveLength(1);
    workers[0].respond({ type: 'replay', replay: data.replay });
    await expect(first).resolves.toEqual(data.replay);
    const pending = session.exportReplay();
    const rejected = expect(pending).rejects.toThrow('Session reset');
    session.reset();
    await rejected;
  });

  it('rejects pending exports on unmount and worker failure', async () => {
    const { session, workers, initialize } = setup();
    session.connect(); initialize();
    const unmounted = expect(session.exportReplay()).rejects.toThrow('disconnected');
    session.disconnect();
    await unmounted;
    session.connect(); initialize();
    const crashed = expect(session.exportReplay()).rejects.toThrow('worker crashed');
    workers[1].onerror?.(Object.assign(new Event('error'), { message: 'worker crashed', filename: '', lineno: 0, colno: 0, error: new Error('worker crashed') }));
    await crashed;
    expect(session.getSnapshot()).toMatchObject({ status: 'error', error: 'worker crashed' });
  });

  it('requires reset after export timeout so a late response cannot satisfy a newer request', async () => {
    vi.useFakeTimers();
    const { session, workers, initialize } = setup(50);
    session.connect(); initialize();
    const timedOut = expect(session.exportReplay()).rejects.toThrow('timed out');
    vi.advanceTimersByTime(51);
    await timedOut;
    await expect(session.exportReplay()).rejects.toThrow('initialized simulation');
    workers[0].respond({ type: 'replay', replay: data.replay });
    expect(session.getSnapshot().status).toBe('error');
    session.reset(); initialize();
    const retried = session.exportReplay();
    workers[1].respond({ type: 'replay', replay: data.replay });
    await expect(retried).resolves.toEqual(data.replay);
  });

  it('keeps pause/step/command parity and stops play at round completion', () => {
    const { session, workers, initialize } = setup();
    session.connect(); initialize();
    session.play(4);
    expect(session.getSnapshot().status).toBe('running');
    session.pause();
    initialize();
    expect(session.getSnapshot().status).toBe('paused');
    session.step(3);
    expect(workers[0].messages.at(-1)).toEqual({ type: 'step', count: 3 });
    const command = { tick: 1, agentId: 'alpha-1', move: { x: .2, y: 0 }, lookDelta: { yaw: .1, pitch: 0 }, stance: 'stand' as const, buttons: 0, source: 'human' as const, sourceSequence: 1 };
    session.command(command);
    expect(workers[0].messages.at(-1)).toEqual({ type: 'command', command });
    workers[0].respond({ type: 'snapshot', map: data.map, snapshot: { ...data.snapshot, status: 'complete', winner: 'alpha' } });
    const count = workers[0].messages.length;
    session.play(); session.step(); session.command(command);
    expect(workers[0].messages).toHaveLength(count);
    expect(session.getSnapshot().status).toBe('complete');
  });

  it('reports startup failure without leaking a worker or subscription', () => {
    const session = createWardenSession({ workerFactory: () => { throw new Error('Worker unavailable'); } });
    sessions.push(session);
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    session.connect();
    expect(session.getSnapshot()).toMatchObject({ status: 'error', error: 'Worker unavailable' });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe(); session.disconnect();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
