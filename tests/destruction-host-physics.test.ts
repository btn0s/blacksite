import RAPIER from "@dimforge/rapier3d-compat";
import HOST_RAPIER from "rapier-host";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DestructionSimulation } from "../packages/destruction-physics/src/index";
import {
  FIXED_DT,
  MAX_REPLAY_COMMANDS,
  FragmentState,
  type DestructibleManifest,
  type DestructionCommand,
} from "../packages/destruction-domain/src/index";

function fixture(anchored = true): DestructibleManifest {
  return {
    schemaVersion: 1,
    assetHash: "host-fixture",
    name: "Shared world",
    scenario: "wall",
    coordinateSystem: "Y_UP_RH",
    materials: [
      {
        id: 0,
        name: "Concrete",
        color: "#aaa",
        density: 1000,
        strength: 2,
        brittleness: 0.7,
        friction: 0.8,
      },
    ],
    regions: [],
    fragments: [
      {
        id: 10,
        position: [-0.5, 8, 0],
        size: [1, 1, 1],
        mass: 50,
        material: 0,
        region: 0,
        anchored,
        aggregate: 0,
      },
      {
        id: 30,
        position: [0.5, 8, 0],
        size: [1, 1, 1],
        mass: 50,
        material: 0,
        region: 0,
        anchored: false,
        aggregate: 0,
      },
    ],
    bonds: [{ id: 100, a: 10, b: 30, area: 1, strength: 2, normal: [1, 0, 0] }],
    level: {
      spawn: { position: [0, 0, 9], yaw: 0 },
      camera: { position: [0, 4, 10], target: [0, 3, 0] },
      boxes: [
        {
          id: "host-existing-wall",
          position: [100, 0, 0],
          size: [3, 3, 3],
          collidable: true,
          material: "concrete",
        },
      ],
    },
  };
}
const cut: DestructionCommand = {
  type: "cut",
  id: 5,
  source: 0,
  tick: 1,
  position: [0, 8, 0],
  direction: [1, 0, 0],
  radius: 0.4,
  strength: 10,
};

// The second module deliberately has distinct nominal WASM types. Registry consumers
// install one Rapier version; this test bridges declarations to exercise both real ABIs.
const COMPATIBLE_HOST_RAPIER = HOST_RAPIER as unknown as typeof RAPIER;

beforeAll(async () => {
  await RAPIER.init();
  await HOST_RAPIER.init();
});

describe.each([
  ["standalone dependency", RAPIER],
  ["Space host Rapier 0.21", COMPATIBLE_HOST_RAPIER],
] as const)("shared destruction with %s", (_name, rapier) => {
  function host() {
    const world = new rapier.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = FIXED_DT;
    world.integrationParameters.numSolverIterations = 7;
    const floor = world.createCollider(
      rapier.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0),
    );
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic().setTranslation(10, 4, 0),
    );
    const collider = world.createCollider(rapier.ColliderDesc.ball(0.2), body);
    return { world, floor, body, collider };
  }
  function advance(
    sim: DestructionSimulation,
    world: RAPIER.World,
    queue?: RAPIER.EventQueue,
  ) {
    sim.beforePhysicsStep();
    world.step(queue);
    queue?.drainContactForceEvents((event) => sim.recordContactForce(event));
    return sim.afterPhysicsStep();
  }

  it("attaches synchronously without ground, authored level duplicates, player, physics stepping, or host settings changes", () => {
    const { world, body, floor } = host();
    const step = vi.spyOn(world, "step"),
      free = vi.spyOn(world, "free");
    const sim = DestructionSimulation.attach(fixture(), { world, rapier });
    try {
      expect(sim.world).toBe(world);
      expect(world.bodies.len()).toBeGreaterThan(1);
      expect(world.colliders.len()).toBe(4);
      expect(sim.frame().player).toBeUndefined();
      expect(world.integrationParameters.numSolverIterations).toBe(7);
      expect(world.gravity).toEqual({ x: 0, y: -9.81, z: 0 });
      expect(() => sim.step()).toThrow("host must bracket");
      expect(() => sim.setPlayerEnabled(true)).toThrow(
        "host character controller",
      );
      expect(() => sim.recordReplay()).toThrow("host authoritative");
      sim.beforePhysicsStep();
      expect(body.translation().y).toBe(4);
      expect(step).not.toHaveBeenCalled();
      world.step();
      sim.afterPhysicsStep();
      expect(step).toHaveBeenCalledTimes(1);
      expect(sim.tick).toBe(1);
      expect(body.translation().y).toBeLessThan(4);
      sim.dispose();
      sim.dispose();
      expect(free).not.toHaveBeenCalled();
      expect(world.bodies.len()).toBe(1);
      expect(world.colliders.len()).toBe(2);
      expect(floor.isValid()).toBe(true);
      expect(body.isValid()).toBe(true);
      world.step();
      expect(step).toHaveBeenCalledTimes(2);
    } finally {
      sim.dispose();
      world.free();
    }
  });

  it("guards step phases and the required fixed timestep", () => {
    const { world } = host();
    const sim = DestructionSimulation.attach(fixture(), { world, rapier });
    try {
      expect(() => sim.afterPhysicsStep()).toThrow("beforePhysicsStep");
      sim.beforePhysicsStep();
      expect(() => sim.beforePhysicsStep()).toThrow("not completed");
      world.step();
      sim.afterPhysicsStep();
      world.timestep = 1 / 30;
      expect(() => sim.beforePhysicsStep()).toThrow("60 Hz fixed step");
      expect(sim.tick).toBe(1);
      const thirtyHz = DestructionSimulation.attach(fixture(), { world, rapier });
      try {
        thirtyHz.beforePhysicsStep();
        world.step();
        expect(thirtyHz.afterPhysicsStep().tick).toBe(1);
      } finally {
        thirtyHz.dispose();
      }
      world.timestep = 1 / 45;
      expect(() => DestructionSimulation.attach(fixture(), { world, rapier })).toThrow("1/60 or 1/30");
    } finally {
      sim.dispose();
      world.free();
    }
  });

  it("exposes sparse fragment IDs and cached navigation geometry independent of airborne motion", () => {
    const { world, floor } = host();
    const sim = DestructionSimulation.attach(fixture(), { world, rapier });
    try {
      expect(sim.fragmentForCollider(floor.handle)).toBeUndefined();
      expect(
        sim.fragmentColliders().map((c) => sim.fragmentForCollider(c.handle)),
      ).toEqual([10, 30]);
      const original = sim.collisionGeometry(),
        topology = sim.topologyVersion;
      expect(original.positions.length).toBe(48);
      expect(original.indices.length).toBe(72);
      advance(sim, world);
      expect(sim.collisionGeometry()).toBe(original);
      sim.enqueue(cut);
      const detached = advance(sim, world);
      expect(detached.states[1]).toBe(FragmentState.Dynamic);
      expect(sim.topologyVersion).toBeGreaterThan(topology);
      const openPassage = sim.collisionGeometry(),
        moving = sim.collisionGeometry({ includeDynamic: true });
      expect(openPassage.version).toBeGreaterThan(original.version);
      expect(openPassage.indices.length).toBe(36);
      expect(moving.indices.length).toBe(72);
      for (let i = 0; i < 10; i++) advance(sim, world);
      expect(sim.collisionGeometry()).toBe(openPassage);
      expect(
        sim.collisionGeometry({ includeDynamic: true }).version,
      ).toBeGreaterThan(moving.version);
      for (let i = 0; i < 450; i++) advance(sim, world);
      expect(sim.frame().states[1]).toBe(FragmentState.Settled);
      expect(sim.collisionGeometry().version).toBeGreaterThan(
        openPassage.version,
      );
      expect(sim.collisionGeometry().indices.length).toBe(72);
    } finally {
      sim.dispose();
      world.free();
    }
  });

  it("budgets only owned dynamic bodies and removes those bodies without affecting host entities", () => {
    const { world, body, collider } = host();
    for (let i = 0; i < 1024; i++)
      world.createRigidBody(
        rapier.RigidBodyDesc.dynamic().setTranslation(100, 100, i),
      );
    const originalBodies = world.bodies.len(),
      originalColliders = world.colliders.len();
    const sim = DestructionSimulation.attach(fixture(false), { world, rapier });
    try {
      expect(sim.frame().stats.activeBodies).toBe(1);
      expect(world.bodies.len()).toBe(originalBodies + 1);
      sim.enqueue(cut);
      advance(sim, world);
      expect(sim.frame().stats.activeBodies).toBe(2);
      sim.dispose();
      expect(world.bodies.len()).toBe(originalBodies);
      expect(world.colliders.len()).toBe(originalColliders);
      expect(body.isValid()).toBe(true);
      expect(collider.isValid()).toBe(true);
    } finally {
      sim.dispose();
      world.free();
    }
  });

  it("copies forwarded contact forces while leaving the host event queue under host ownership", () => {
    const { world, floor, collider } = host();
    const sim = DestructionSimulation.attach(fixture(false), { world, rapier });
    const queue = new rapier.EventQueue(true);
    const drain = vi.spyOn(queue, "drainContactForceEvents");
    try {
      const fragmentCollider = world.getCollider(
        sim.fragmentColliders()[0]!.handle,
      );
      fragmentCollider.parent()!.setLinvel({ x: 0, y: -8, z: 0 }, true);
      const borrowed = {
        first: fragmentCollider.handle,
        second: floor.handle,
        direction: { x: 0, y: 1, z: 0 },
        force: 2000,
      };
      const event = {
        collider1: () => borrowed.first,
        collider2: () => borrowed.second,
        maxForceDirection: () => borrowed.direction,
        totalForceMagnitude: () => borrowed.force,
      };
      expect(() => sim.recordContactForce(event)).toThrow("between");
      sim.beforePhysicsStep();
      world.step(queue);
      sim.recordContactForce({ ...event, collider1: () => collider.handle }); // unrelated host contact
      sim.recordContactForce(event);
      borrowed.first = collider.handle;
      borrowed.direction.y = 0;
      borrowed.force = 0;
      const frame = sim.afterPhysicsStep();
      expect(frame.events.filter((e) => e.type === "heavyImpact")).toHaveLength(
        1,
      );
      expect(drain).not.toHaveBeenCalled();
      queue.drainContactForceEvents(() => {});
      expect(drain).toHaveBeenCalledTimes(1);
    } finally {
      sim.dispose();
      queue.free();
      world.free();
    }
  });

  it("uses the supplied Rapier for secondary fracture and disposes every owned child collider", () => {
    const { world } = host();
    const manifest = fixture(false);
    manifest.fragments = [manifest.fragments[1]!];
    manifest.bonds = [];
    const sim = DestructionSimulation.attach(manifest, { world, rapier });
    try {
      sim.enqueue({
        type: "explosion",
        id: 1,
        source: 0,
        tick: 1,
        position: [0.5, 8, 0],
        direction: [0, 1, 0],
        radius: 2,
        strength: 2,
      });
      const frame = advance(sim, world);
      expect(frame.states[0]).toBe(FragmentState.Retired);
      expect(frame.secondary?.fragments.length).toBe(4);
      expect(
        sim.fragmentColliders().map((c) => sim.fragmentForCollider(c.handle)),
      ).toEqual(frame.secondary?.fragments.map((f) => f.id));
      expect(sim.collisionGeometry().indices.length).toBe(0);
      expect(
        sim.collisionGeometry({ includeDynamic: true }).indices.length,
      ).toBeGreaterThan(0);
      sim.dispose();
      expect(world.colliders.len()).toBe(2);
      expect(world.bodies.len()).toBe(1);
    } finally {
      sim.dispose();
      world.free();
    }
  });

  it("accepts confirmed off-center bullet hits and advances a finite host frame", () => {
    const { world, floor } = host();
    const sim = DestructionSimulation.attach(fixture(), { world, rapier });
    try {
      const hit = {
        colliderHandle: sim.fragmentColliders()[1]!.handle,
        position: [0.99, 8.49, 0.49] as [number, number, number],
        direction: [1, 0, 0] as [number, number, number],
        energy: 500,
        impulse: [4, 0, 0] as [number, number, number],
      };
      expect(
        sim.recordImpact({ ...hit, colliderHandle: floor.handle }),
      ).toBeNull();
      expect(sim.recordImpact({ ...hit, energy: 119 })).toBeNull();
      expect(() => sim.recordImpact({ ...hit, energy: NaN })).toThrow(
        "Invalid",
      );
      expect(() => sim.recordImpact({ ...hit, direction: [0, 0, 0] })).toThrow(
        "nonzero",
      );
      expect(() =>
        sim.recordImpact({ ...hit, impulse: [Infinity, 0, 0] }),
      ).toThrow("Invalid");
      const command = sim.recordImpact(hit)!;
      expect(command.fragmentId).toBe(30);
      expect(command.strength).toBe(0.4);
      expect(command.radius).toBe(0.35);
      expect(command.impulse).toEqual([4, 0, 0]);
      const frame = advance(sim, world);
      expect(frame.tick).toBe(1);
      expect([...frame.transforms].every(Number.isFinite)).toBe(true);
      expect(frame.stats.activeBodies).toBeGreaterThanOrEqual(0);
    } finally {
      sim.dispose();
      world.free();
    }
  });

  it("keeps shared-world impact history bounded without a lifetime replay limit", () => {
    const { world } = host();
    const manifest = fixture();
    manifest.fragments = [manifest.fragments[0]!];
    manifest.bonds = [];
    // History bookkeeping only: a ductile material keeps the target collider stable.
    manifest.materials = [{ ...manifest.materials[0]!, name: "Structural steel", brittleness: 0.12 }];
    const sim = DestructionSimulation.attach(manifest, { world, rapier });
    try {
      const scheduled = { ...cut, id: 999999, tick: 1000 };
      sim.enqueue(scheduled);
      const colliderHandle = sim.fragmentColliders()[0]!.handle;
      for (let id = 0; id < MAX_REPLAY_COMMANDS + 18; id++) {
        expect(
          sim.recordImpact({
            colliderHandle,
            position: [-0.5, 8, 0],
            direction: [1, 0, 0],
            energy: 500,
          }),
        ).not.toBeNull();
        if ((id + 1) % 64 === 0) advance(sim, world);
      }
      advance(sim, world);
      expect(sim.commandLog).toHaveLength(MAX_REPLAY_COMMANDS);
      expect(sim.commandLog[0]!.id).toBe(18);
      expect(sim.enqueue(scheduled)).toBeNull();
      expect(sim.frame().stats.commands).toBe(MAX_REPLAY_COMMANDS + 18);
    } finally {
      sim.dispose();
      world.free();
    }
  });

  it("keeps shared-world impact history bounded while bullets refine concrete", () => {
    const { world } = host();
    const manifest = fixture();
    manifest.fragments = [manifest.fragments[0]!];
    manifest.bonds = [];
    const sim = DestructionSimulation.attach(manifest, { world, rapier });
    try {
      const scheduled = { ...cut, id: 999999, tick: 1000 };
      sim.enqueue(scheduled);
      advance(sim, world);
      // Each batch aims at the next point of a face grid so craters spread; thousands of
      // rounds legitimately bore through the cube, so exhausted grid points are skipped.
      let batch = 0;
      const liveHit = () => {
        let cast: RAPIER.RayColliderHit | null = null, ray: RAPIER.Ray | undefined;
        for (let attempt = 0; attempt < 49 && !cast; attempt++, batch++) {
          const x = -0.86 + (batch % 7) * 0.12, y = 7.64 + (Math.floor(batch / 7) % 7) * 0.12;
          ray = new rapier.Ray({ x, y, z: 3 }, { x: 0, y: 0, z: -1 });
          cast = world.castRay(ray, 10, true, undefined, undefined, undefined, undefined,
            (collider) => sim.fragmentForCollider(collider.handle) !== undefined && !collider.parent()?.isDynamic());
        }
        expect(cast).not.toBeNull();
        const p = ray!.pointAt(cast!.timeOfImpact);
        return { colliderHandle: cast!.collider.handle, position: [p.x, p.y, p.z] as [number, number, number] };
      };
      let target = liveHit();
      for (let id = 0; id < MAX_REPLAY_COMMANDS + 18; id++) {
        expect(
          sim.recordImpact({
            ...target,
            direction: [0, 0, -1],
            energy: 500,
          }),
        ).not.toBeNull();
        if ((id + 1) % 64 === 0) {
          advance(sim, world);
          target = liveHit();
        }
      }
      advance(sim, world);
      expect(sim.commandLog).toHaveLength(MAX_REPLAY_COMMANDS);
      expect(sim.commandLog[0]!.id).toBe(18);
      expect(sim.enqueue(scheduled)).toBeNull();
      expect(sim.frame().stats.commands).toBe(MAX_REPLAY_COMMANDS + 18);
      const frame = sim.frame();
      expect(frame.secondary!.fragments.length).toBeGreaterThan(0);
      expect(frame.secondary!.states).not.toContain(FragmentState.Retired);
    } finally {
      sim.dispose();
      world.free();
    }
  }, 15_000);

  it("keeps host contact loads finite through landing and sleep", () => {
    const { world } = host();
    const sim = DestructionSimulation.attach(fixture(false), { world, rapier });
    try {
      for (let i = 0; i < 500; i++) advance(sim, world);
      expect([...sim.contactWrenches].every(Number.isFinite)).toBe(true);
      expect([...sim.frame().transforms].every(Number.isFinite)).toBe(true);
    } finally {
      sim.dispose();
      world.free();
    }
  });

  it("cleans up partial attachment if a host collider allocation fails", () => {
    const { world } = host();
    const originalCreate = world.createCollider.bind(world),
      count = world.colliders.len();
    vi.spyOn(world, "createCollider")
      .mockImplementationOnce(originalCreate)
      .mockImplementationOnce(() => {
        throw new Error("allocation failed");
      });
    try {
      expect(() =>
        DestructionSimulation.attach(fixture(), { world, rapier }),
      ).toThrow("allocation failed");
      expect(world.colliders.len()).toBe(count);
      expect(world.bodies.len()).toBe(1);
      world.step();
    } finally {
      world.free();
    }
  });
});

it("replays source-owned host impact calibration and exact momentum in standalone mode", async () => {
  const original = await DestructionSimulation.create(fixture(false));
  const replay = await DestructionSimulation.create(fixture(false));
  try {
    const impulse: [number, number, number] = [4, 0, 0];
    original.recordImpact({
      colliderHandle: original.fragmentColliders()[0]!.handle,
      position: [-0.99, 8.49, 0.49],
      direction: [1, 0, 0],
      energy: 500,
      impulse,
    });
    impulse[0] = 40;
    expect(original.commandLog[0]!.impulse).toEqual([4, 0, 0]);
    original.step();
    const log = original.recordReplay();
    for (const command of log.commands) replay.enqueue(command);
    replay.step();
    expect(original.frame().transforms).toEqual(replay.frame().transforms);
    for (let i = 0; i < 30; i++) {
      expect(original.step().transforms).toEqual(replay.step().transforms);
    }
  } finally {
    original.dispose();
    replay.dispose();
  }
});
