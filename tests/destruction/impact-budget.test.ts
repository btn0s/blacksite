import RAPIER from "@dimforge/rapier3d-compat";
import HOST_RAPIER from "rapier-host";
import { beforeAll, describe, expect, it } from "vitest";
import { createDestructibleBoxes } from "../../packages/destruction-authoring/src/boxes";
import {
  FIXED_DT,
  FragmentState,
  MAX_SECONDARY_FRAGMENTS,
  type DestructibleManifest,
  type SimulationFrame,
  type Vec3,
} from "../../packages/destruction-domain/src/index";
import {
  decodeSnapshot,
  encodeSnapshot,
  parseReplay,
  serializeReplay,
  verifySnapshot,
} from "../../packages/destruction-network/src/index";
import { DestructionSimulation } from "../../packages/destruction-physics/src/index";

const AKM_ENERGY = 2019;
const AKM_IMPULSE = 5.6485;
const hostRapier = HOST_RAPIER as unknown as typeof RAPIER;

beforeAll(async () => {
  await RAPIER.init();
  await HOST_RAPIER.init();
});

function verified(frame: SimulationFrame, manifest: DestructibleManifest) {
  return verifySnapshot(decodeSnapshot(encodeSnapshot(frame)), manifest);
}

function fire(sim: DestructionSimulation, rapier: typeof RAPIER, x: number, y: number, face: number, skipDebris = true) {
  const skip = new Set(skipDebris ? sim.fragmentColliders().filter((entry) => entry.debris).map((entry) => entry.handle) : []);
  const ray = new rapier.Ray({ x, y, z: face + 2.5 }, { x: 0, y: 0, z: -1 });
  const hit = sim.world.castRay(ray, 10, true, undefined, undefined, undefined, undefined,
    (collider) => sim.fragmentForCollider(collider.handle) !== undefined && !skip.has(collider.handle));
  if (!hit) return false;
  const p = ray.pointAt(hit.timeOfImpact);
  return sim.recordImpact({ colliderHandle: hit.collider.handle, direction: [0, 0, -1], energy: AKM_ENERGY,
    impulse: [0, 0, -AKM_IMPULSE], position: [p.x, p.y, p.z] }) !== null;
}

function replayMatches(manifest: DestructibleManifest, original: DestructionSimulation, frames: ReadonlyArray<SimulationFrame>,
  prepare: (sim: DestructionSimulation) => void = () => {}) {
  return DestructionSimulation.create(manifest).then((replay) => {
    try {
      prepare(replay);
      const log = parseReplay(serializeReplay(original.recordReplay()), manifest.assetHash);
      for (const command of log.commands) replay.enqueue(command);
      for (const expected of frames) {
        const actual = replay.step();
        expect(actual.stats.checksum).toBe(expected.stats.checksum);
        expect(actual.states).toEqual(expected.states);
      }
      const last = replay.frame();
      expect(last.transforms).toEqual(frames.at(-1)!.transforms);
      expect(last.secondary).toEqual(frames.at(-1)!.secondary);
      expect(last.stats.healedRoots).toBe(frames.at(-1)!.stats.healedRoots);
    } finally {
      replay.dispose();
    }
  });
}

describe("live-budget recycling, kill volume and debris energy", { timeout: 120_000 }, () => {
  it("exposes both covers under repeated hits with conserved child mass and replay", async () => {
    const manifest = createDestructibleBoxes([
      { id: "cover-a", min: [-8.5, 0, 2], max: [-5, 1.5, 2.5], material: 0, anchored: true },
      { id: "cover-b", min: [3, 0, 2], max: [6.5, 1.5, 2.5], material: 0, anchored: true },
    ], { id: "budget-two-covers" }).manifest;
    const sim = await DestructionSimulation.create(manifest);
    try {
      const frames = [sim.step()];
      for (const x of [-6.7, 4.7]) {
        const roots = new Set(manifest.fragments.filter((fragment) => Math.abs(fragment.position[0] - x) < 2)
          .map((fragment) => fragment.id));
        let exposed = false;
        for (let shot = 0; shot < 12 && !exposed; shot++) {
          expect(fire(sim, RAPIER, x, 0.35, 2.5)).toBe(true);
          const frame = sim.step();
          frames.push(frame);
          exposed = (frame.secondary?.fragments ?? []).some((child) => roots.has(child.rootId));
          expect((frame.secondary?.fragments.length ?? 0)).toBeLessThanOrEqual(MAX_SECONDARY_FRAGMENTS);
          expect(frame.transforms.every(Number.isFinite)).toBe(true);
          expect(verified(frame, manifest)).toBe(true);
        }
        expect(exposed).toBe(true);
      }
      const final = frames.at(-1)!;
      for (const rootId of new Set(final.secondary!.fragments.map((child) => child.rootId))) {
        const root = manifest.fragments.find((fragment) => fragment.id === rootId)!;
        expect(final.secondary!.fragments.filter((child) => child.rootId === rootId)
          .reduce((mass, child) => mass + child.mass, 0)).toBeCloseTo(root.mass, 5);
      }
      await replayMatches(manifest, sim, frames);
    } finally {
      sim.dispose();
    }
  });

  it("keeps long-running host snapshots finite and within the debris budget", () => {
    const manifest = createDestructibleBoxes([
      { id: "concrete-cover", min: [-8.5, 0, 2], max: [-5, 1.5, 2.5], material: 0, anchored: true },
    ], { id: "ledge-kill-volume" }).manifest;
    const world = new hostRapier.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = FIXED_DT;
    world.createCollider(hostRapier.ColliderDesc.cuboid(10, 0.5, 2).setTranslation(-6, -0.5, 1.5));
    const sim = DestructionSimulation.attach(manifest, { rapier: hostRapier, world });
    const step = () => {
      sim.beforePhysicsStep();
      world.step();
      return sim.afterPhysicsStep();
    };
    try {
      let frame = step();
      for (let shot = 0; shot < 12 && !frame.secondary?.fragments.length; shot++) {
        expect(fire(sim, hostRapier, -6.7, 0.35, 2.5)).toBe(true);
        frame = step();
      }
      expect(frame.secondary?.fragments.length).toBeGreaterThan(0);
      for (let tick = 1; tick <= 60 * 60; tick++) {
        frame = step();
        expect(frame.transforms.every(Number.isFinite)).toBe(true);
        expect(frame.secondary?.transforms.every(Number.isFinite) ?? true).toBe(true);
        expect((frame.secondary?.fragments.length ?? 0)).toBeLessThanOrEqual(MAX_SECONDARY_FRAGMENTS);
        if (tick % 120 === 0) expect(verified(frame, manifest)).toBe(true);
      }
      expect(verified(frame, manifest)).toBe(true);
    } finally {
      sim.dispose();
      world.free();
    }
  });

  it("caps loose debris speed under two rounds per tick on a small patch and replays deterministically", async () => {
    const manifest = createDestructibleBoxes([
      { id: "concrete-cover", min: [-8.5, 0, 2], max: [-5, 1.5, 2.5], material: 0, anchored: true },
    ], { id: "debris-energy" }).manifest;
    const ground = (sim: DestructionSimulation) => {
      sim.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.1, 50).setTranslation(0, -0.1, 0));
    };
    const sim = await DestructionSimulation.create(manifest);
    try {
      ground(sim);
      let seed = 1;
      const next = () => {
        seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
        return seed / 4_294_967_296;
      };
      const frames: Array<SimulationFrame> = [];
      let maximum = 0, checked = 0;
      for (let tick = 0; tick < 300; tick++) {
        for (let k = 0; k < 2; k++) fire(sim, RAPIER, -6.7 + (next() - 0.5) * 0.15, 0.75 + (next() - 0.5) * 0.15, 2, false);
        frames.push(sim.step());
        for (const { debris, handle } of sim.fragmentColliders()) {
          if (!debris) continue;
          const body = sim.world.getCollider(handle).parent()!;
          if (!body.isDynamic()) continue;
          const v = body.linvel();
          const speed = Math.hypot(v.x, v.y, v.z);
          maximum = Math.max(maximum, speed);
          checked++;
          expect(speed).toBeLessThanOrEqual(20 + 1e-3);
        }
      }
      expect(checked).toBeGreaterThan(1000);
      expect(maximum).toBeGreaterThan(1);
      await replayMatches(manifest, sim, frames, ground);
    } finally {
      sim.dispose();
    }
  });

  it("keeps new blast descendants or records capacity after repeated fire", async () => {
    const manifest = createDestructibleBoxes([
      { id: "concrete-cover", min: [-8.5, 0, 2], max: [-5, 1.5, 2.5], material: 0, anchored: true },
      { id: "wall", min: [-3, 0, 8], max: [3, 3, 8.4], material: 0, anchored: true },
    ], { id: "saturated-split" }).manifest;
    const sim = await DestructionSimulation.create(manifest);
    try {
      let frame = sim.step(), attempt = 0;
      for (let shot = 0; shot < 12 && !frame.secondary?.fragments.length; shot++) {
        expect(fire(sim, RAPIER, -6.7, 0.35, 2.5)).toBe(true);
        frame = sim.step();
      }
      expect(frame.secondary?.fragments.length).toBeGreaterThan(0);
      for (let tick = 0; tick < 140; tick++) {
        for (let k = 0; k < 2; k++) {
          const i = attempt++;
          fire(sim, RAPIER, -2.9 + ((i * 0.618034) % 1) * 5.8, 0.05 + ((i * 0.4142136) % 1) * 2.9, 8.4);
        }
        frame = sim.step();
      }
      expect(frame.secondary!.fragments.length).toBeLessThanOrEqual(MAX_SECONDARY_FRAGMENTS);
      sim.enqueue({ type: "explosion", id: 1, source: 0, tick: frame.tick + 1, position: [-6, 0.4, 3], direction: [0, 1, 0],
        strength: 3, radius: 2.5 });
      for (let tick = 0; tick < 120; tick++) frame = sim.step();
      const loose = manifest.fragments.map((f, slot) => ({ f, slot })).filter(({ slot }) =>
        frame.states[slot] === FragmentState.Dynamic || frame.states[slot] === FragmentState.Sleeping
        || frame.states[slot] === FragmentState.Settled);
      expect(loose.length).toBeGreaterThan(0);
      const { slot } = loose[0]!;
      const position: Vec3 = [frame.transforms[slot * 8]!, frame.transforms[slot * 8 + 1]! + 0.3, frame.transforms[slot * 8 + 2]!];
      const before = frame.states.slice(), capacity = frame.stats.capacityEvents ?? 0;
      const known = new Set(frame.secondary!.fragments.map((f) => f.id));
      sim.enqueue({ type: "explosion", id: 2, source: 0, tick: frame.tick + 1, position, direction: [0, 1, 0], strength: 3, radius: 2 });
      frame = sim.step();
      const retired = manifest.fragments.filter((_, index) =>
        before[index] !== FragmentState.Retired && frame.states[index] === FragmentState.Retired);
      expect(retired.length).toBeGreaterThan(0);
      for (const fragment of retired) {
        const descendants = frame.secondary!.fragments.filter((f) => f.rootId === fragment.id && !known.has(f.id));
        expect(descendants.length > 0 || (frame.stats.capacityEvents ?? 0) > capacity).toBe(true);
      }
      expect(frame.secondary!.fragments.length).toBeLessThanOrEqual(MAX_SECONDARY_FRAGMENTS);
      expect(verified(frame, manifest)).toBe(true);
    } finally {
      sim.dispose();
    }
  });
});
