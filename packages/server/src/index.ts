import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { Effect } from 'effect';
import { WebSocketServer, WebSocket } from 'ws';
import { AuthorityService, createAuthority } from '@blacksite/ai-services';
import { isCommand } from '@blacksite/ai-worker';
import { DEFAULT_CONFIG, TICK_RATE, type AgentCommand, type RenderSnapshot } from '@blacksite/ai-schema';

/** Research server: one isolated match/controlled seat per connection. Never broadcasts debug truth. */
export function createResearchServer() {
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', protocol: 'cutting-edge-session-1', mode: 'isolated-research' }));
    } else { response.writeHead(404); response.end('Not found'); }
  });
  const sockets = new WebSocketServer({ server, path: '/session', maxPayload: 4096 });
  sockets.on('connection', socket => {
    if (sockets.clients.size > 8) { socket.close(1013, 'Session capacity reached'); return; }
    const authority = createAuthority({ ...DEFAULT_CONFIG, seed: DEFAULT_CONFIG.seed });
    let controlledId = '';
    let tick = 0;
    let lastSequence = -1;
    let pending = new Map<number, AgentCommand>();
    let closed = false;
    let busy = false;
    let inFlight: Promise<void> = Promise.resolve();
    const send = (data: unknown) => { if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 1_000_000) socket.send(JSON.stringify(data)); };
    const view = (snapshot: RenderSnapshot) => {
      const self = snapshot.agents.find(agent => agent.id === controlledId)!;
      // Team HUD is a declared game rule; opponents are reconstructed ONLY from this seat's beliefs.
      return { type: 'snapshot', tick: snapshot.tick, status: snapshot.status, winner: snapshot.winner,
        self, friends: snapshot.agents.filter(a => a.team === self.team).map(a => ({ id: a.id, position: a.position, yaw: a.yaw, health: a.health, alive: a.alive })),
        contacts: self.beliefs.map(track => ({ subjectId: track.subjectId, position: track.meanPosition, uncertainty: track.uncertaintyRadius, confidence: track.confidence, source: track.source })),
        objective: snapshot.objective,
        events: snapshot.events.filter(event => event.agentId === controlledId || event.type === 'objective') };
    };
    const initialize = authority.runPromise(Effect.gen(function* () {
      const service = yield* AuthorityService;
      const snapshot = yield* service.snapshot();
      controlledId = snapshot.agents.find(agent => agent.team === 'alpha')!.id;
      send({ type: 'welcome', protocol: 'cutting-edge-session-1', agentId: controlledId, tickRate: TICK_RATE, map: service.map });
      send(view(snapshot));
    })).catch(() => { socket.close(1011, 'Authority initialization failed'); });

    socket.on('message', bytes => {
      try {
        const message: unknown = JSON.parse(bytes.toString());
        if (!isCommand(message) || message.agentId !== controlledId || message.source !== 'human'
          || message.tick <= tick || message.tick > tick + 6 || message.sourceSequence <= lastSequence)
          throw new Error('Rejected stale, invalid, or unowned input');
        lastSequence = message.sourceSequence; pending.set(message.tick, message);
      } catch { send({ type: 'error', message: 'Rejected stale, invalid, or unowned input' }); }
    });
    const timer = setInterval(() => {
      if (closed || busy || !controlledId) return;
      busy = true;
      inFlight = authority.runPromise(Effect.gen(function* () {
        const service = yield* AuthorityService;
        const command = pending.get(tick + 1) ?? { tick: tick + 1, agentId: controlledId, move: { x: 0, y: 0 }, lookDelta: { yaw: 0, pitch: 0 }, stance: 'stand' as const, buttons: 0, source: 'human' as const, sourceSequence: Math.max(0, lastSequence) };
        pending.delete(tick + 1);
        const snapshot = yield* service.step([command]); tick = snapshot.tick;
        if (tick % 3 === 0 || snapshot.status === 'complete') send(view(snapshot));
        if (snapshot.status === 'complete') clearInterval(timer);
      })).catch(() => { socket.close(1011, 'Authority tick failed'); }).finally(() => { busy = false; });
    }, 1000 / TICK_RATE);
    socket.on('close', () => {
      closed = true; clearInterval(timer); pending.clear();
      void Promise.all([initialize, inFlight]).then(() => authority.dispose());
    });
  });
  return { server, sockets, close: () => new Promise<void>(resolve => {
    for (const socket of sockets.clients) socket.terminate();
    sockets.close(() => server.close(() => resolve()));
  }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createResearchServer();
  const port = Number(process.env.PORT ?? 8787);
  app.server.listen(port, process.env.HOST ?? '127.0.0.1', () => console.log(`Warden isolated research authority listening on port ${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void app.close(); });
}
