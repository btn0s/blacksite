import RAPIER from "@dimforge/rapier3d-compat";
import HOST_RAPIER from "rapier-host";
import { beforeAll, describe, expect, it } from "vitest";
import { createDestructibleBoxes } from "../../packages/destruction-authoring/src/boxes";
import {
  FIXED_DT,
  FragmentState,
  MAX_FRACTURE_GENERATION,
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

const hostRapier = HOST_RAPIER as unknown as typeof RAPIER;
const origin: Vec3 = [-6.7, 0.35, 5];
const direction: Vec3 = [0, 0, -1];

beforeAll(async () => {
  await RAPIER.init();
  await HOST_RAPIER.init();
});

function wall() {
  return createDestructibleBoxes([
    { id: "concrete-cover", min: [-8.5, 0, 2], max: [-5, 1.5, 2.5], material: 0, anchored: true },
  ], { id: "bullet-concrete-regression" }).manifest;
}

function stepHost(sim: DestructionSimulation) {
  sim.beforePhysicsStep();
  sim.world.step();
  return sim.afterPhysicsStep();
}

function wallHit(sim: DestructionSimulation, rapier: typeof RAPIER, supportedOnly = false) {
  const frame = sim.frame();
  const supported = new Set([
    ...sim.manifest.fragments.filter((_, i) => frame.states[i] === FragmentState.Supported).map((f) => f.id),
    ...(frame.secondary?.fragments.filter((_, i) => frame.secondary!.states[i] === FragmentState.Supported).map((f) => f.id) ?? []),
  ]);
  const ray = new rapier.Ray({ x: origin[0], y: origin[1], z: origin[2] }, { x: 0, y: 0, z: -1 });
  const hit = sim.world.castRayAndGetNormal(ray, 10, true, undefined, undefined, undefined, undefined,
    (collider) => {
      const id = sim.fragmentForCollider(collider.handle);
      return id !== undefined && (!supportedOnly || supported.has(id));
    });
  if (!hit) throw new Error("Expected physical wall intersection");
  const p = ray.pointAt(hit.timeOfImpact);
  return { collider: hit.collider, position: [p.x, p.y, p.z] as Vec3 };
}

function shoot(sim: DestructionSimulation, collider: RAPIER.Collider, position: Vec3, aim = direction) {
  const command = sim.recordImpact({
    colliderHandle: collider.handle,
    position,
    direction: aim,
    energy: 2019,
    impulse: aim.map((component) => component * 5.6485) as Vec3,
  });
  expect(command).not.toBeNull();
  return command!;
}

describe("localized physical bullet fracture", () => {
  it("exposes a physical cover member with conserved child mass and valid topology", () => {
    const manifest = wall();
    const world = new hostRapier.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = FIXED_DT;
    const floor = world.createCollider(hostRapier.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0));
    const unrelated = world.createRigidBody(hostRapier.RigidBodyDesc.fixed().setTranslation(15, 2, 0));
    const unrelatedCollider = world.createCollider(hostRapier.ColliderDesc.ball(0.25), unrelated);
    const originalBodies = world.bodies.len();
    const originalColliders = world.colliders.len();
    const sim = DestructionSimulation.attach(manifest, { world, rapier: hostRapier });
    try {
      stepHost(sim);
      const before = wallHit(sim, hostRapier);
      expect(Math.abs(before.position[2] - 2.5)).toBeLessThan(0.01);
      const staticVersion = sim.collisionGeometry().version;
      const dynamicVersion = sim.collisionGeometry({ includeDynamic: true }).version;
      let frame = sim.frame();
      let shots = 0;
      while (!frame.secondary?.fragments.length && shots < 8) {
        const hit = wallHit(sim, hostRapier);
        shoot(sim, hit.collider, hit.position);
        frame = stepHost(sim);
        shots++;
      }
      expect(frame.secondary?.fragments.length).toBeGreaterThan(0);
      const roots = new Set(frame.secondary!.fragments.map((child) => child.rootId));
      expect(roots.size).toBeGreaterThan(0);
      for (const rootId of roots) {
        const root = manifest.fragments.find((fragment) => fragment.id === rootId)!;
        const children = frame.secondary!.fragments.filter((child) => child.rootId === rootId);
        expect(children.reduce((mass, child) => mass + child.mass, 0)).toBeCloseTo(root.mass, 6);
        expect(frame.states[manifest.fragments.indexOf(root)]).toBe(FragmentState.Retired);
      }
      expect(frame.transforms.every(Number.isFinite)).toBe(true);
      expect(frame.secondary!.transforms.every(Number.isFinite)).toBe(true);
      expect(verifySnapshot(decodeSnapshot(encodeSnapshot(frame)), manifest)).toBe(true);
      expect(sim.collisionGeometry({ includeDynamic: true }).version).toBeGreaterThan(dynamicVersion);
      expect(sim.collisionGeometry().version).toBeGreaterThanOrEqual(staticVersion);
      sim.dispose();
      expect(world.bodies.len()).toBe(originalBodies);
      expect(world.colliders.len()).toBe(originalColliders);
      expect(world.getCollider(floor.handle)).not.toBeNull();
      expect(world.getCollider(unrelatedCollider.handle)).not.toBeNull();
      expect(world.getRigidBody(unrelated.handle)).not.toBeNull();
    } finally {
      sim.dispose();
      world.free();
    }
  });

  it("keeps repeated physical hits local and preserves descendant mass", async () => {
    const manifest = wall();
    const sim = await DestructionSimulation.create(manifest);
    try {
      sim.step();
      let frame = sim.frame();
      const depths: number[] = [];
      for (let shot = 0; shot < 8; shot++) {
        const hit = wallHit(sim, RAPIER, true);
        depths.push(hit.position[2]);
        shoot(sim, hit.collider, hit.position);
        frame = sim.step();
        expect(frame.transforms.every(Number.isFinite)).toBe(true);
        expect(verifySnapshot(decodeSnapshot(encodeSnapshot(frame)), manifest)).toBe(true);
      }
      expect(frame.secondary?.fragments.length).toBeGreaterThan(0);
      expect(frame.secondary!.fragments.some((child) => child.generation > 1)).toBe(true);
      expect(frame.secondary!.fragments.every((child) => child.generation <= MAX_FRACTURE_GENERATION)).toBe(true);
      expect(Math.min(...depths)).toBeLessThan(depths[0]! - 0.02);
      const originalRoots = new Map(manifest.fragments.map((fragment) => [fragment.id, fragment]));
      const rootIds = new Set(frame.secondary!.fragments.map((child) => child.rootId));
      for (const rootId of rootIds) {
        const children = frame.secondary!.fragments.filter((child) => child.rootId === rootId);
        expect(children.reduce((mass, child) => mass + child.mass, 0)).toBeCloseTo(originalRoots.get(rootId)!.mass, 5);
      }
    } finally {
      sim.dispose();
    }
  });

  it("replays exact native bullet commands and future descendant IDs deterministically", async () => {
    const manifest = wall();
    const original = await DestructionSimulation.create(manifest);
    const replay = await DestructionSimulation.create(manifest);
    try {
      const frames = [original.step()];
      for (let shot = 0; shot < 6; shot++) {
        const hit = wallHit(original, RAPIER, true);
        shoot(original, hit.collider, hit.position);
        for (let tick = 0; tick < 16; tick++) frames.push(original.step());
      }
      const log = parseReplay(serializeReplay(original.recordReplay()), manifest.assetHash);
      expect(log.commands).toHaveLength(6);
      expect(log.commands.some((command) => command.fragmentId! > manifest.fragments.at(-1)!.id)).toBe(true);
      expect(log.commands.every((command) => command.impulse?.[2] === -5.6485)).toBe(true);
      for (const command of log.commands) replay.enqueue(command);
      for (const expected of frames) {
        const actual = replay.step();
        expect(actual.transforms).toEqual(expected.transforms);
        expect(actual.states).toEqual(expected.states);
        expect(actual.secondary).toEqual(expected.secondary);
        expect(actual.stats.checksum).toBe(expected.stats.checksum);
        expect(verifySnapshot(decodeSnapshot(encodeSnapshot(actual)), manifest)).toBe(true);
      }
    } finally {
      original.dispose();
      replay.dispose();
    }
  });

  it.each([0, 500])("subdivides a physical child after %i settling ticks", async (settlingTicks) => {
    const manifest = wall();
    const sim = await DestructionSimulation.create(manifest);
    const directHit = (collider: RAPIER.Collider) => {
      const center = collider.translation();
      const ray = new RAPIER.Ray({ x: center.x, y: center.y + 2, z: center.z }, { x: 0, y: -1, z: 0 });
      const hit = collider.castRayAndGetNormal(ray, 4, true);
      expect(hit).not.toBeNull();
      const p = ray.pointAt(hit!.timeOfImpact);
      shoot(sim, collider, [p.x, p.y, p.z], [0, -1, 0]);
    };
    try {
      sim.step();
      let first = sim.frame();
      for (let shot = 0; shot < 8 && !first.secondary?.fragments.length; shot++) {
        const hit = wallHit(sim, RAPIER, true);
        shoot(sim, hit.collider, hit.position);
        first = sim.step();
      }
      expect(first.secondary!.fragments.some((f) => f.generation === 1)).toBe(true);
      for (let tick = 0; tick < settlingTicks; tick++) sim.step();
      const frame = sim.frame();
      const target = frame.secondary!.fragments
        .filter((_, slot) => frame.secondary!.states[slot] !== FragmentState.Supported)
        .sort((a, b) => b.mass - a.mass)[0]!;
      const slot = frame.secondary!.fragments.indexOf(target);
      expect(frame.secondary!.states[slot]).toBe(settlingTicks ? FragmentState.Settled : FragmentState.Dynamic);
      const collider = sim.world.getCollider(sim.fragmentColliders().find((entry) => entry.fragmentId === target.id)!.handle);
      directHit(collider);
      const second = sim.step();
      expect(second.secondary!.fragments.some((f) => f.id === target.id)).toBe(false);
      expect(second.secondary!.states).not.toContain(FragmentState.Retired);
      const descendants = second.secondary!.fragments.filter((f) => f.parentId === target.id);
      expect(descendants.length).toBeGreaterThan(1);
      expect(descendants.every((f) => f.generation === 2)).toBe(true);
      expect(descendants.reduce((mass, f) => mass + f.mass, 0)).toBeCloseTo(target.mass, 6);
      expect(verifySnapshot(decodeSnapshot(encodeSnapshot(second)), manifest)).toBe(true);
    } finally {
      sim.dispose();
    }
  });
});
