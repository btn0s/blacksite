import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { createDestructibleBoxes } from "../../packages/destruction-authoring/src/boxes";
import {
  FragmentState,
  MAX_FRACTURE_GENERATION,
  MAX_SECONDARY_FRAGMENTS,
  type DestructionCommand,
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

beforeAll(async () => {
  await RAPIER.init();
});

function cover() {
  return createDestructibleBoxes([
    { id: "concrete-cover", min: [-8.5, 0, 2], max: [-5, 1.5, 2.5], material: 0, anchored: true },
  ], { id: "sustained-concrete-cover" }).manifest;
}

function fire(sim: DestructionSimulation, target: Vec3 = [-6.7, 0.35, 2.5]) {
  const debris = new Set(sim.fragmentColliders().filter((entry) => entry.debris).map((entry) => entry.handle));
  const ray = new RAPIER.Ray({ x: target[0], y: target[1], z: target[2] + 2.5 }, { x: 0, y: 0, z: -1 });
  const hit = sim.world.castRay(ray, 10, true, undefined, undefined, undefined, undefined,
    (collider) => sim.fragmentForCollider(collider.handle) !== undefined && !debris.has(collider.handle));
  if (!hit) return null;
  const point = ray.pointAt(hit.timeOfImpact);
  return sim.recordImpact({ colliderHandle: hit.collider.handle, direction: [0, 0, -1],
    energy: 2019, impulse: [0, 0, -5.6485], position: [point.x, point.y, point.z] });
}

function validFrame(frame: ReturnType<DestructionSimulation["frame"]>, manifest: ReturnType<typeof cover>) {
  expect(frame.transforms.every(Number.isFinite)).toBe(true);
  expect(frame.secondary?.transforms.every(Number.isFinite) ?? true).toBe(true);
  expect((frame.secondary?.fragments.length ?? 0)).toBeLessThanOrEqual(MAX_SECONDARY_FRAGMENTS);
  expect(verifySnapshot(decodeSnapshot(encodeSnapshot(frame)), manifest)).toBe(true);
}

function rootMass(frame: ReturnType<DestructionSimulation["frame"]>, rootId: number) {
  return (frame.secondary?.fragments ?? []).filter((child) => child.rootId === rootId)
    .reduce((mass, child) => mass + child.mass, 0);
}

describe("sustained physical fire on authored concrete", () => {
  it("exposes a member before checking conserved descendant mass, caps and replay", async () => {
    const manifest = cover();
    const original = await DestructionSimulation.create(manifest);
    const replay = await DestructionSimulation.create(manifest);
    try {
      const frames = [original.step()];
      let exposed = false;
      for (let shot = 0; shot < 12; shot++) {
        expect(fire(original)).not.toBeNull();
        const frame = original.step();
        frames.push(frame);
        exposed ||= (frame.secondary?.fragments.length ?? 0) > 0;
        validFrame(frame, manifest);
        if (frame.secondary) {
          const ids = frame.secondary.fragments.map((child) => child.id);
          expect(ids.every((id, slot) => slot === 0 || id > ids[slot - 1]!)).toBe(true);
          expect(frame.secondary.fragments.every((child) => child.generation <= MAX_FRACTURE_GENERATION)).toBe(true);
          for (const rootId of new Set(frame.secondary.fragments.map((child) => child.rootId))) {
            const root = manifest.fragments.find((fragment) => fragment.id === rootId)!;
            expect(rootMass(frame, rootId)).toBeCloseTo(root.mass, 5);
          }
        }
      }
      expect(exposed).toBe(true);
      const log = parseReplay(serializeReplay(original.recordReplay()), manifest.assetHash);
      expect(log.commands.length).toBe(12);
      for (const command of log.commands) replay.enqueue(command);
      for (const expected of frames) {
        const actual = replay.step();
        expect(actual.stats.checksum).toBe(expected.stats.checksum);
        expect(actual.states).toEqual(expected.states);
        expect(actual.bondStates).toEqual(expected.bondStates);
        expect(actual.transforms).toEqual(expected.transforms);
        expect(actual.secondary).toEqual(expected.secondary);
      }
    } finally {
      original.dispose();
      replay.dispose();
    }
  });

  it("keeps remote support and refreshes collision geometry after local exposure", async () => {
    const manifest = cover();
    const sim = await DestructionSimulation.create(manifest);
    try {
      sim.step();
      const staticVersion = sim.collisionGeometry().version;
      const dynamicVersion = sim.collisionGeometry({ includeDynamic: true }).version;
      let frame = sim.frame();
      for (let shot = 0; shot < 12 && !frame.secondary?.fragments.length; shot++) {
        expect(fire(sim)).not.toBeNull();
        frame = sim.step();
      }
      expect(frame.secondary?.fragments.length).toBeGreaterThan(0);
      expect(manifest.bonds.some((bond) => bond.b === -1)).toBe(true);
      expect(frame.stats.supportedFragments).toBeGreaterThan(0);
      const remoteRay = new RAPIER.Ray({ x: -8, y: 0.35, z: 5 }, { x: 0, y: 0, z: -1 });
      const remoteHit = sim.world.castRay(remoteRay, 10, true, undefined, undefined, undefined, undefined,
        (collider) => sim.fragmentForCollider(collider.handle) !== undefined);
      expect(remoteHit).not.toBeNull();
      expect(sim.collisionGeometry({ includeDynamic: true }).version).toBeGreaterThan(dynamicVersion);
      expect(sim.collisionGeometry().version).toBeGreaterThanOrEqual(staticVersion);
      validFrame(frame, manifest);
    } finally {
      sim.dispose();
    }
  });

  it("processes a blast and bullet in one tick without duplicating descendant mass", async () => {
    const manifest = cover();
    const original = await DestructionSimulation.create(manifest);
    const replay = await DestructionSimulation.create(manifest);
    try {
      original.step();
      replay.step();
      let frame = original.frame();
      for (let shot = 0; shot < 12 && !frame.secondary?.fragments.length; shot++) {
        const command = fire(original);
        expect(command).not.toBeNull();
        replay.enqueue(command!);
        frame = original.step();
        expect(replay.step().stats.checksum).toBe(frame.stats.checksum);
      }
      expect(frame.secondary?.fragments.length).toBeGreaterThan(0);
      const child = frame.secondary!.fragments[0]!;
      const slot = frame.secondary!.fragments.indexOf(child);
      const position = Array.from(frame.secondary!.transforms.subarray(slot * 8, slot * 8 + 3)) as Vec3;
      const commands: DestructionCommand[] = [
        { type: "explosion", id: 100, source: 9, tick: frame.tick + 1, position,
          direction: [0, 1, 0], radius: 1, strength: 2 },
        { type: "pointImpact", id: 101, source: 9, tick: frame.tick + 1, position,
          direction: [0, 0, -1], radius: 0.35, strength: 0.5,
          impulse: [0, 0, -5.6485], fragmentId: child.id },
      ];
      for (const command of commands) {
        original.enqueue(command);
        replay.enqueue(command);
      }
      const a = original.step(), b = replay.step();
      expect(a.stats.checksum).toBe(b.stats.checksum);
      expect(a.secondary).toEqual(b.secondary);
      expect(a.states).toEqual(b.states);
      const root = manifest.fragments.find((fragment) => fragment.id === child.rootId)!;
      expect(rootMass(a, root.id)).toBeCloseTo(root.mass, 5);
      expect(a.secondary!.fragments.map((part) => part.id).every((id, i, ids) => i === 0 || id > ids[i - 1]!)).toBe(true);
      validFrame(a, manifest);
    } finally {
      original.dispose();
      replay.dispose();
    }
  });

  it("resolves a retired authored target to its exposed live descendant", async () => {
    const manifest = cover();
    const stale = await DestructionSimulation.create(manifest);
    const direct = await DestructionSimulation.create(manifest);
    try {
      stale.step();
      direct.step();
      let frame = stale.frame();
      for (let shot = 0; shot < 12 && !frame.secondary?.fragments.length; shot++) {
        const command = fire(stale);
        expect(command).not.toBeNull();
        direct.enqueue(command!);
        frame = stale.step();
        expect(direct.step().stats.checksum).toBe(frame.stats.checksum);
      }
      expect(frame.secondary?.fragments.length).toBeGreaterThan(0);
      const child = frame.secondary!.fragments[0]!;
      const rootSlot = manifest.fragments.findIndex((fragment) => fragment.id === child.rootId);
      expect(frame.states[rootSlot]).toBe(FragmentState.Retired);
      const slot = frame.secondary!.fragments.indexOf(child);
      const position = Array.from(frame.secondary!.transforms.subarray(slot * 8, slot * 8 + 3)) as Vec3;
      const command: DestructionCommand = { type: "pointImpact", id: 200, source: 9,
        tick: frame.tick + 1, position, direction: [0, 0, -1], radius: 0.35,
        strength: 0.5, impulse: [0, 0, -5.6485], fragmentId: child.rootId };
      expect(stale.enqueue(command)).not.toBeNull();
      expect(direct.enqueue({ ...command, fragmentId: child.id })).not.toBeNull();
      const a = stale.step(), b = direct.step();
      expect(a.stats.checksum).toBe(b.stats.checksum);
      expect(a.secondary).toEqual(b.secondary);
      validFrame(a, manifest);
    } finally {
      stale.dispose();
      direct.dispose();
    }
  });
});
