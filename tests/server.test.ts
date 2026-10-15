import { expect, test } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { createResearchServer } from '../packages/server/src/index';

test('server binds commands to one seat and only sends belief-based opponent contacts', async () => {
  const app = createResearchServer();
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const port = (app.server.address() as AddressInfo).port;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/session`);
  const messages: Record<string, unknown>[] = [];
  const next = (type: string) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const existing = messages.find(message => message.type === type);
    if (existing) { resolve(existing); return; }
    const timer = setTimeout(() => { socket.off('message', listener); reject(new Error(`No ${type} received`)); }, 10000);
    const listener = (bytes: Buffer) => { const value = JSON.parse(bytes.toString()); if (value.type === type) { clearTimeout(timer); socket.off('message', listener); resolve(value); } };
    socket.on('message', listener);
  });
  socket.on('message', bytes => messages.push(JSON.parse(bytes.toString())));
  try {
    const welcome = await next('welcome');
    expect(welcome.agentId).toMatch(/^alpha-/);
    const snapshot = await next('snapshot');
    expect(snapshot).not.toHaveProperty('agents');
    expect(snapshot).not.toHaveProperty('sharedBeliefs');
    expect(snapshot.contacts).toEqual([]);
    expect((snapshot.friends as { id: string }[]).every(friend => friend.id.startsWith('alpha-'))).toBe(true);
    socket.send(JSON.stringify({ tick: 1, agentId: 'bravo-1', move: { x: 0, y: 0 }, lookDelta: { yaw: 0, pitch: 0 }, stance: 'stand', buttons: 0, source: 'human', sourceSequence: 1 }));
    expect((await next('error')).message).toMatch(/unowned/);
  } finally { socket.terminate(); await app.close(); }
}, 15000);
