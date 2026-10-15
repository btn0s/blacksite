import { SIMULATION_VERSION } from "../../destruction-domain/src/index";
import { createServer, type Server as HttpServer } from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import type {
  DestructibleManifest,
  ReplayLog,
  ScenarioId,
  SimulationFrame,
} from "../../destruction-domain/src/index";
import { DestructionSimulation } from "../../destruction-physics/src/index";
import { createOrganicScenario } from "../../destruction-testkit/src/index";
import {
  commandFromIntent,
  encodeSnapshot,
  LIMITS,
  PROTOCOL_VERSION,
  ProtocolError,
  serializeReplay,
} from "../../destruction-network/src/index";

export interface ServerOptions {
  port?: number;
  host?: string;
  scenario?: ScenarioId;
  autoTick?: boolean;
}
export interface RunningServer {
  http: HttpServer;
  port: number;
  manifest: DestructibleManifest;
  step(): SimulationFrame;
  close(): Promise<void>;
  replay(): ReplayLog;
}
interface Peer {
  socket: WebSocket;
  source: number;
  ready: boolean;
  lastId: number;
  tokens: number;
  refillAt: number;
  repairAt: number;
  failures: number;
  handshake: ReturnType<typeof setTimeout>;
}
const COMMAND_RATE = 8;
const COMMAND_BURST = 12;
const MAX_CLIENTS = 16;
const MAX_BUFFERED_BYTES = LIMITS.packetBytes * 2;

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const manifest = createOrganicScenario(options.scenario ?? "building");
  const simulation = await DestructionSimulation.create(manifest);
  const peers = new Set<Peer>();
  const commands: ReplayLog["commands"] = [];
  let frame = simulation.frame();
  let nextSource = 1;
  let nextCommand = 1;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const replay = (): ReplayLog => ({
    version: 1,
    simulationVersion: SIMULATION_VERSION,
    assetHash: manifest.assetHash,
    scenario: manifest.scenario,
    commands: commands.filter((command) => command.tick <= frame.tick),
    endTick: frame.tick,
  });
  const http = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "GET") {
      response.writeHead(405);
      response.end(JSON.stringify({ error: "GET required" }));
      return;
    }
    if (request.url === "/health") {
      response.end(
        JSON.stringify({
          status: stopped ? "stopped" : "ok",
          protocol: PROTOCOL_VERSION,
          tick: frame.tick,
          clients: peers.size,
          scenario: manifest.scenario,
          assetHash: manifest.assetHash,
        }),
      );
      return;
    }
    if (request.url === "/replay") {
      response.end(serializeReplay(replay()));
      return;
    }
    response.writeHead(404);
    response.end(
      JSON.stringify({
        error: "Use /health, /replay, or a WebSocket connection",
      }),
    );
  });
  const sockets = new WebSocketServer({
    server: http,
    maxPayload: 4096,
    perMessageDeflate: false,
  });
  function send(peer: Peer, data: string | ArrayBuffer): boolean {
    if (peer.socket.readyState !== WebSocket.OPEN) return false;
    if (peer.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      peer.socket.close(1013, "Slow receiver");
      return false;
    }
    peer.socket.send(data);
    return true;
  }
  function json(peer: Peer, value: unknown): boolean {
    return send(peer, JSON.stringify(value));
  }
  function fail(peer: Peer, message: string): void {
    json(peer, { type: "error", message });
    if (++peer.failures >= 3) peer.socket.close(1008, "Too many invalid messages");
  }
  function snapshot(peer: Peer, repair: boolean): void {
    send(peer, encodeSnapshot(frame, repair));
  }
  sockets.on("connection", (socket) => {
    if (stopped || peers.size >= MAX_CLIENTS) {
      socket.close(1013, "Server at capacity");
      return;
    }
    const peer: Peer = {
      socket,
      source: nextSource++,
      ready: false,
      lastId: -1,
      tokens: COMMAND_BURST,
      refillAt: performance.now(),
      repairAt: -Infinity,
      failures: 0,
      handshake: setTimeout(() => socket.close(1008, "Hello required"), 5000),
    };
    peers.add(peer);
    socket.on("error", () => socket.close());
    socket.on("close", () => {
      clearTimeout(peer.handshake);
      peers.delete(peer);
    });
    json(peer, {
      type: "welcome",
      protocol: PROTOCOL_VERSION,
      assetHash: manifest.assetHash,
      scenario: manifest.scenario,
      channels: ["events", "snapshots", "audit", "repair"],
      transport: "websocket-reliable",
    });
    socket.on("message", (data, isBinary) => {
      try {
        if (isBinary) throw new ProtocolError("Client messages must be JSON");
        const message: unknown = JSON.parse(data.toString());
        if (typeof message !== "object" || message === null || Array.isArray(message))
          throw new ProtocolError("Invalid message");
        const input = message as Record<string, unknown>;
        if (input.type === "hello") {
          if (peer.ready) throw new ProtocolError("Already initialized");
          if (input.protocol !== PROTOCOL_VERSION || input.assetHash !== manifest.assetHash) {
            json(peer, {
              type: "error",
              message: "Protocol or content hash mismatch",
            });
            socket.close(1008, "Protocol or content hash mismatch");
            return;
          }
          clearTimeout(peer.handshake);
          peer.ready = true;
          json(peer, {
            type: "init",
            manifest,
            tick: frame.tick,
            stats: frame.stats,
            source: peer.source,
          });
          snapshot(peer, true);
          return;
        }
        if (!peer.ready) throw new ProtocolError("Send hello before commands");
        if (input.type === "repair") {
          const now = performance.now();
          if (now - peer.repairAt < 1000) throw new ProtocolError("Repair rate limit");
          peer.repairAt = now;
          json(peer, {
            type: "repair",
            tick: frame.tick,
            checksum: frame.stats.checksum,
          });
          snapshot(peer, true);
          return;
        }
        if (input.type !== "command") throw new ProtocolError("Unknown message type");
        const now = performance.now();
        peer.tokens = Math.min(
          COMMAND_BURST,
          peer.tokens + ((now - peer.refillAt) / 1000) * COMMAND_RATE,
        );
        peer.refillAt = now;
        if (peer.tokens < 1) throw new ProtocolError("Command rate limit");
        if (commands.length >= LIMITS.commands || frame.tick >= LIMITS.endTick)
          throw new ProtocolError("Session replay budget reached");
        const command = commandFromIntent(input.command, {
          tick: frame.tick + 1,
          source: peer.source,
          lastId: peer.lastId,
        });
        const insideArena = manifest.regions.some((region) =>
          command.position.every(
            (p, axis) => p >= region.min[axis] - 10 && p <= region.max[axis] + 10,
          ),
        );
        if (!insideArena) throw new ProtocolError("Command lies outside arena");
        const requestId = command.id;
        command.id = nextCommand++;
        const accepted = simulation.enqueue(command);
        if (!accepted) throw new ProtocolError("Duplicate authoritative command");
        peer.lastId = requestId;
        peer.tokens--;
        commands.push(accepted);
        json(peer, { type: "ack", requestId, command: accepted });
      } catch (error) {
        fail(peer, error instanceof Error ? error.message : "Invalid request");
      }
    });
  });
  function step(): SimulationFrame {
    if (stopped || frame.tick >= LIMITS.endTick) return frame;
    frame = simulation.step();
    let encoded: ArrayBuffer | undefined;
    for (const peer of peers) {
      if (!peer.ready) continue;
      if (frame.events.length)
        json(peer, { type: "events", tick: frame.tick, events: frame.events });
      if (frame.tick % 4 === 0) {
        encoded ??= encodeSnapshot(frame);
        send(peer, encoded);
      }
      if (frame.tick % 60 === 0)
        json(peer, {
          type: "audit",
          tick: frame.tick,
          checksum: frame.stats.checksum,
          stats: frame.stats,
        });
    }
    return frame;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      http.once("error", reject);
      http.listen(options.port ?? 3001, options.host ?? "127.0.0.1", () => {
        http.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    simulation.dispose();
    sockets.close();
    throw error;
  }
  if (options.autoTick !== false) {
    let previous = performance.now();
    let accumulator = 0;
    timer = setInterval(() => {
      const now = performance.now();
      accumulator += Math.min(now - previous, 250);
      previous = now;
      for (let n = 0; n < 5 && accumulator >= 1000 / 60; n++, accumulator -= 1000 / 60) {
        try {
          step();
        } catch (error) {
          console.error("Simulation halted:", error);
          stopped = true;
          if (timer) clearInterval(timer);
          break;
        }
      }
      accumulator = Math.min(accumulator, 1000 / 12);
    }, 8);
  }
  const address = http.address();
  const port = typeof address === "object" && address ? address.port : (options.port ?? 3001);
  return {
    http,
    port,
    manifest,
    step,
    replay,
    async close() {
      stopped = true;
      if (timer) clearInterval(timer);
      for (const peer of peers) {
        clearTimeout(peer.handshake);
        peer.socket.terminate();
      }
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
      simulation.dispose();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const requestedPort = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535)
    throw new Error("PORT must be 0–65535");
  const server = await startServer({
    port: requestedPort,
    host: process.env.HOST ?? "127.0.0.1",
  });
  console.log(
    `Destruction authority listening on port ${server.port}. GET /health or /replay. See apps/server/README.md for protocol.`,
  );
  const shutdown = () => void server.close().then(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
