import RAPIER from "@dimforge/rapier3d-compat";
import { afterEach, describe, expect, it } from "vitest";
import { DestructionSimulation } from "../../packages/destruction-physics/src";
import {
  parseReplay,
  serializeReplay,
} from "../../packages/destruction-network/src";
import {
  MAX_COLLISION_OBJECTS,
  PHYSICS_OPERATIONS_VERSION,
  SIMULATION_VERSION,
  type CollisionObject,
  type DestructibleManifest,
  type EmitterLaunch,
  type Vec3,
} from "../../packages/destruction-domain/src";

function fixture(dynamic = false): DestructibleManifest {
  return {
    schemaVersion: 1,
    assetHash: "placed-physics-v1",
    scenario: "wall",
    name: "Placed physics",
    coordinateSystem: "Y_UP_RH",
    bonds: [],
    regions: [],
    materials: [
      {
        id: 0,
        name: "Concrete",
        density: 2000,
        strength: 1.2,
        color: "#aaa",
        friction: 0.8,
        brittleness: 0.8,
      },
    ],
    fragments: [
      {
        id: 10,
        position: dynamic ? [0, 5, 0] : [30, 3, 30],
        size: [1, 1, 1],
        mass: 50,
        material: 0,
        region: 0,
        aggregate: 0,
        anchored: !dynamic,
      },
    ],
    level: {
      spawn: { position: [0, 0.03, 0], yaw: 0 },
      camera: { position: [10, 10, 10], target: [0, 0, 0] },
      boxes: [],
    },
  };
}
const sessions: DestructionSimulation[] = [];
async function create(dynamic = false) {
  const sim = await DestructionSimulation.create(fixture(dynamic));
  sessions.push(sim);
  return sim;
}
afterEach(() => sessions.splice(0).forEach((sim) => sim.dispose()));
function object(
  id = "emitter",
  position: Vec3 = [0, 1.05, 5],
  size: Vec3 = [1, 2, 1],
): CollisionObject {
  return { id, boxes: [{ position, size }] };
}
function launch(): EmitterLaunch {
  return {
    ownerId: "emitter",
    breech: [0, 1.5, 5],
    muzzle: [0, 1.5, 3],
    direction: [0, 0, -1],
    radius: 0.2,
    strength: 3,
  };
}
function input(forward: number) {
  return {
    forward,
    right: 0,
    yaw: 0,
    sprint: false,
    crouch: false,
    jump: false,
  };
}

describe("placed generic collision objects and emitters", () => {
  it("blocks the real KCC, preserves old geometry on invalid replacement, and removes collision", async () => {
    const sim = await create();
    sim.setPlayerEnabled(true);
    expect(
      sim.setCollisionObject(object("barrier", [0, 1.05, -2], [3, 2, 0.4]))
        .accepted,
    ).toBe(true);
    expect(
      sim.setCollisionObject(object("barrier", [0, 0.9, 0])).accepted,
    ).toBe(false);
    sim.setPlayerInput(input(1));
    for (let i = 0; i < 60; i++) sim.step();
    expect(sim.frame().player!.position[2]).toBeGreaterThan(-1.6);
    expect(sim.frame().player!.position[2]).toBeLessThan(-1.3);
    expect(sim.removeCollisionObject("barrier").accepted).toBe(true);
    for (let i = 0; i < 45; i++) sim.step();
    expect(sim.frame().player!.position[2]).toBeLessThan(-3);
  });

  it("checks same-tick geometry, clearance volumes and the player without installing clearance", async () => {
    const sim = await create();
    sim.setPlayerEnabled(true);
    expect(sim.setCollisionObject(object("player", [0, 0.9, 0])).accepted).toBe(
      false,
    );
    expect(sim.setCollisionObject(object("emitter")).accepted).toBe(true);
    expect(sim.setCollisionObject(object("overlap")).accepted).toBe(false);
    expect(
      sim.setCollisionObject(object("remote", [4, 1, 4]), [
        { position: [0, 1.05, 5], size: [1, 1, 1] },
      ]).accepted,
    ).toBe(false);
    const before = sim.world.colliders.len();
    expect(
      sim.setCollisionObject(object("remote", [4, 1.05, 4]), [
        { position: [4, 3, 4], size: [1, 1, 1] },
      ]).accepted,
    ).toBe(true);
    expect(sim.world.colliders.len()).toBe(before + 1);
  });

  it("rejects placements inside moving primary and secondary debris at live poses", async () => {
    const sim = await create(true);
    for (let i = 0; i < 8; i++) sim.step();
    const frame = sim.frame();
    const p: Vec3 = [
      frame.transforms[0],
      frame.transforms[1],
      frame.transforms[2],
    ];
    expect(
      sim.setCollisionObject(object("moving", p, [0.1, 0.1, 0.1])).accepted,
    ).toBe(false);
    sim.enqueue({
      type: "explosion",
      id: 1,
      source: 0,
      tick: sim.tick + 1,
      position: p,
      direction: [0, 1, 0],
      radius: 2,
      strength: 2,
    });
    const fractured = sim.step();
    expect(fractured.secondary?.fragments.length).toBeGreaterThan(0);
    const child = fractured.secondary!.transforms;
    expect(
      sim.setCollisionObject(
        object("child", [child[0], child[1], child[2]], [0.1, 0.1, 0.1]),
      ).accepted,
    ).toBe(false);
  });

  it("sweeps the whole barrel, including initial overlap, and exempts only its own colliders", async () => {
    const sim = await create();
    expect(sim.setCollisionObject(object()).accepted).toBe(true);
    expect(
      sim.setCollisionObject(object("wall", [0, 1.5, 4], [3, 2, 0.1])).accepted,
    ).toBe(true);
    expect(sim.launchFromEmitter(launch(), 1).accepted).toBe(false); // muzzle is beyond the wall
    expect(sim.frame().ordnance).toHaveLength(0);
    sim.removeCollisionObject("wall");
    expect(
      sim.setCollisionObject(
        object("breechBlock", [0.65, 1.5, 5], [0.15, 0.3, 0.3]),
      ).accepted,
    ).toBe(true);
    const offsetBarrel = {
      ...launch(),
      breech: [0.49, 1.5, 5] as Vec3,
      muzzle: [0.49, 1.5, 3] as Vec3,
    };
    expect(sim.launchFromEmitter(offsetBarrel, 1).accepted).toBe(false);
    sim.removeCollisionObject("breechBlock");
    expect(sim.launchFromEmitter(launch(), 1).accepted).toBe(true);
    expect(sim.frame().ordnance).toHaveLength(1);
    expect(sim.frame().ordnance![0].position).toEqual([0, 1.5, 2.75]);
    expect(sim.launchFromEmitter(launch(), 1).accepted).toBe(false);
  });

  it("rejects a projectile embedded in its owner but permits a barrel starting inside it", async () => {
    const sim = await create();
    expect(
      sim.setCollisionObject(object("emitter", [0, 1, 5], [1, 1, 1])).accepted,
    ).toBe(true);
    const shortBarrel: EmitterLaunch = {
      ...launch(),
      breech: [0, 1, 5.2],
      muzzle: [0, 1, 4.8],
      spawnOffset: 0,
    };
    const failed = sim.launchFromEmitter(shortBarrel, 1);
    expect(failed.accepted).toBe(false);
    expect(failed.command).toBeUndefined();
    expect(sim.frame().ordnance).toHaveLength(0);
    expect(sim.recordReplay().physicsOperations).toHaveLength(1);

    // Clearing the sphere's centre alone is insufficient: its radius must clear.
    expect(
      sim.launchFromEmitter({ ...shortBarrel, muzzle: [0, 1, 4.4] }, 1)
        .accepted,
    ).toBe(false);
    const accepted = sim.launchFromEmitter(
      { ...shortBarrel, muzzle: [0, 1, 4.2] },
      1,
    );
    expect(accepted.accepted).toBe(true);
    expect(sim.frame().ordnance).toHaveLength(1);
    expect(sim.frame().ordnance![0].position[2]).toBeCloseTo(4.2);
  });

  it("rejects a barrel path through the player and through newly moved debris", async () => {
    const sim = await create(true);
    sim.setPlayerEnabled(true);
    expect(sim.setCollisionObject(object()).accepted).toBe(true);
    const towardPlayer = { ...launch(), muzzle: [0, 1.5, -1] as Vec3 };
    expect(sim.launchFromEmitter(towardPlayer, 1).accepted).toBe(false);
    sim.setPlayerEnabled(false);
    const body = sim.world.bodies.getAll()[0];
    body.setTranslation({ x: 0, y: 1.5, z: 4 }, true);
    sim.world.propagateModifiedBodyPositionsToColliders();
    expect(sim.launchFromEmitter(launch(), 1).accepted).toBe(false);
  });

  it("refuses owned-body capacity before acknowledgement and records no failed launch", async () => {
    const manifest = fixture(true);
    const fragment = manifest.fragments[0]!;
    manifest.fragments = Array.from({ length: 4096 }, (_, id) => ({
      ...fragment,
      id,
      aggregate: id,
      position: [
        100 + (id % 16) * 2,
        100 + Math.floor(id / 16) * 2,
        100,
      ] as Vec3,
    }));
    const sim = await DestructionSimulation.create(manifest);
    sessions.push(sim);
    sim.setCollisionObject(object());
    const failed = sim.launchFromEmitter(launch(), 1);
    expect(failed.accepted).toBe(false);
    expect(failed.command).toBeUndefined();
    expect(failed.message).toMatch(/capacity/);
    expect(sim.frame().ordnance).toHaveLength(0);
    expect(sim.recordReplay().physicsOperations).toHaveLength(1);
  });

  it("bounds payloads, objects, and barrel direction without any mutations", async () => {
    const sim = await create();
    expect(sim.setCollisionObject(object("bad", [NaN, 1, 0])).accepted).toBe(
      false,
    );
    expect(
      sim.setCollisionObject(object("big", [0, 1, 0], [100, 1, 1])).accepted,
    ).toBe(false);
    for (let i = 0; i < MAX_COLLISION_OBJECTS; i++)
      expect(
        sim.setCollisionObject(
          object(i === 0 ? "emitter" : `box${i}`, [i * 2, 1.05, 5]),
        ).accepted,
      ).toBe(true);
    expect(
      sim.setCollisionObject(object("extra", [80, 1.05, 5])).accepted,
    ).toBe(false);
    expect(
      sim.launchFromEmitter({ ...launch(), direction: [1, 0, 0] }, 1).accepted,
    ).toBe(false);
    expect(
      sim.launchFromEmitter({ ...launch(), spawnOffset: 100 }, 1).accepted,
    ).toBe(false);
    expect(sim.frame().ordnance).toHaveLength(0);
  });

  it("replays ordered same-tick lifecycle and actual launched bodies once, including final-tick changes", async () => {
    const a = await create(),
      b = await create();
    a.setCollisionObject(object());
    a.launchFromEmitter(launch(), 2);
    a.enqueue({
      type: "explosion",
      id: 1,
      source: 1,
      tick: 2,
      position: [30, 3, 30],
      direction: [0, 1, 0],
      radius: 1,
      strength: 1,
    });
    for (let i = 0; i < 5; i++) a.step();
    a.removeCollisionObject("emitter");
    a.setCollisionObject(object("stopper", [0, 1.5, -3], [3, 3, 0.2]));
    for (let i = 0; i < 10; i++) a.step();
    a.removeCollisionObject("stopper");
    const log = parseReplay(serializeReplay(a.recordReplay()));
    expect(log.commands).toHaveLength(1);
    expect(
      log.physicsOperations!.filter(
        (operation) => operation.type === "launchFromEmitter",
      ),
    ).toHaveLength(1);
    let cursor = 0;
    for (;;) {
      while (
        cursor < log.physicsOperations!.length &&
        log.physicsOperations![cursor].tick === b.tick
      )
        b.applyPhysicsOperation(log.physicsOperations![cursor++]);
      if (b.tick === log.endTick) break;
      for (const command of log.commands.filter(
        (command) => command.tick === b.tick + 1,
      ))
        b.enqueue(command);
      b.step();
    }
    expect(b.frame().transforms).toEqual(a.frame().transforms);
    expect(b.frame().ordnance).toEqual(a.frame().ordnance);
    expect(b.world.colliders.len()).toBe(a.world.colliders.len());
    expect(b.recordReplay()).toEqual(log);
    const legacy = parseReplay(
      serializeReplay({
        ...log,
        simulationVersion: SIMULATION_VERSION,
        physicsOperations: undefined,
      }),
    );
    expect(legacy.physicsOperations).toBeUndefined();
  });

  it("marks operation-bearing exports as incompatible with old parsers, accepts versioned operation-free logs and rejects unversioned logs", async () => {
    const sim = await create();
    const plain = sim.recordReplay();
    expect(plain.simulationVersion).toBe(SIMULATION_VERSION);
    expect(plain.physicsOperations ?? []).toHaveLength(0);
    expect(parseReplay(serializeReplay(plain))).toEqual(plain);
    expect(() => parseReplay(JSON.stringify({ ...plain, simulationVersion: undefined }))).toThrow(/Unsupported simulation version/);

    sim.setCollisionObject(object());
    const operations = sim.recordReplay();
    expect(operations.simulationVersion).toBe(PHYSICS_OPERATIONS_VERSION);
    expect(operations.simulationVersion).not.toBe(SIMULATION_VERSION);
    expect(parseReplay(serializeReplay(operations))).toEqual(operations);
    // A downgraded marker is a known version, so the operation-specific guard must reject it.
    expect(() =>
      parseReplay(JSON.stringify({ ...operations, simulationVersion: SIMULATION_VERSION })),
    ).toThrow(/simulation version marker/);
    // A stripped marker is an unversioned recording and is rejected before operations are considered.
    expect(() =>
      parseReplay(JSON.stringify({ ...operations, simulationVersion: undefined })),
    ).toThrow(/Unsupported simulation version/);
  });

  it("reproduces debris support and its removal from the lifecycle log", async () => {
    const a = await create(true),
      b = await create(true);
    expect(
      a.setCollisionObject(object("shelf", [0, 2.5, 0], [4, 0.2, 4])).accepted,
    ).toBe(true);
    for (let i = 0; i < 55; i++) a.step();
    expect(a.frame().transforms[1]).toBeGreaterThan(3);
    a.removeCollisionObject("shelf");
    for (let i = 0; i < 20; i++) a.step();
    const log = parseReplay(serializeReplay(a.recordReplay()));
    let cursor = 0;
    while (b.tick < log.endTick) {
      while (
        cursor < log.physicsOperations!.length &&
        log.physicsOperations![cursor].tick === b.tick
      )
        b.applyPhysicsOperation(log.physicsOperations![cursor++]);
      b.step();
    }
    expect(a.frame().transforms[1]).toBeLessThan(3);
    expect(b.frame().transforms).toEqual(a.frame().transforms);
    expect(b.frame().stats.checksum).toBe(a.frame().stats.checksum);
  });

  it("rejects malformed replay lifecycle and duplicate launch commands before importing", async () => {
    const sim = await create();
    sim.setCollisionObject(object());
    sim.launchFromEmitter(launch(), 1);
    const log = sim.recordReplay();
    expect(() =>
      parseReplay(
        JSON.stringify({
          ...log,
          physicsOperations: [
            { type: "removeCollisionObject", tick: 0, id: "missing" },
          ],
        }),
      ),
    ).toThrow(/physics/);
    const shot = log.physicsOperations![1];
    if (shot.type !== "launchFromEmitter") throw new Error("missing shot");
    expect(() =>
      parseReplay(JSON.stringify({ ...log, commands: [shot.command] })),
    ).toThrow(/physics/);
    expect(() =>
      parseReplay(
        JSON.stringify({
          ...log,
          physicsOperations: [
            {
              type: "setCollisionObject",
              tick: 0,
              object: object("bad", [0, 1, 0], [Infinity, 1, 1]),
            },
          ],
        }),
      ),
    ).toThrow(/physics/);
    sim.dispose();
    const reset = await create();
    expect(reset.frame().ordnance).toHaveLength(0);
    expect(reset.world.colliders.len()).toBe(2);
    expect(reset.recordReplay().physicsOperations).toBeUndefined();
  });
});
