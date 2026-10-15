import { describe, expect, it } from "vitest";
import { DestructionSimulation } from "../../packages/destruction-physics/src/index";
import { cannonballSpeed, MAX_CANNONBALLS, MAX_EXPLOSIVES, MAX_SECONDARY_ID_SPAN, SIMULATION_VERSION, validateCommand, type DestructibleManifest, type DestructionCommand } from "../../packages/destruction-domain/src/index";
import { commandFromIntent, decodeSnapshot, encodeSnapshot, parseReplay, serializeReplay } from "../../packages/destruction-network/src/index";

function wall(): DestructibleManifest {
  return { schemaVersion: 1, assetHash: "ordnance-wall-v1", name: "Impact wall", scenario: "wall", coordinateSystem: "Y_UP_RH",
    materials: [{ id: 0, name: "Masonry", color: "#aaaaaa", density: 1800, strength: 1, brittleness: .8, friction: .7 }],
    fragments: [-.6, 0, .6].map((x, i) => ({ id: (i + 1) * 10, position: [x, 2, 0], size: [.59, 3.99, .3], mass: 100, material: 0, region: 0, anchored: true, aggregate: 0 })),
    bonds: [{ id: 1, a: 10, b: 20, area: .8, strength: 1, normal: [1, 0, 0] }, { id: 2, a: 20, b: 30, area: .8, strength: 1, normal: [1, 0, 0] }],
    regions: [{ id: 0, name: "Wall", min: [-1, 0, -1], max: [1, 4, 1] }] };
}
function ball(id = 1, tick = 1): DestructionCommand { return { type: "cannonball", id, source: 1, tick, position: [0, 2, 8], direction: [0, 0, -1], radius: .32, strength: 3 }; }
function charge(id = 1, tick = 1, x = -.6, fragmentId = 10): DestructionCommand { return { type: "placeExplosive", id, source: 1, tick, position: [x, 2, .15], direction: [0, 0, 1], radius: .7, strength: 3, fragmentId }; }
function detonate(id = 3, tick = 30): DestructionCommand { return { type: "detonate", id, source: 1, tick, position: [0, 0, 0], direction: [0, 1, 0], radius: 1, strength: 1 }; }

describe("physical ordnance", () => {
  it("flies as a CCD rigid sphere and fractures only after a physical collision", async () => {
    const sim = await DestructionSimulation.create(wall());
    try {
      sim.enqueue(ball());
      for (let i = 0; i < 6; i++) {
        const frame = sim.step();
        expect(frame.stats.brokenBonds).toBe(0);
        expect(frame.ordnance).toHaveLength(1);
        expect(frame.stats.activeBodies).toBe(1);
        expect(frame.ordnance![0].position[2]).toBeGreaterThan(3);
      }
      let firstContact = -1;
      for (let i = 0; i < 40; i++) {
        const frame = sim.step();
        if (firstContact < 0 && frame.events.some(event => event.type === "cannonballImpact")) firstContact = frame.tick;
      }
      expect(firstContact).toBeGreaterThan(6);
      expect(sim.frame().stats.brokenBonds).toBeGreaterThan(0);
      expect(sim.frame().ordnance![0].position[1]).toBeLessThan(2);
    } finally { sim.dispose(); }
  });

  it("keeps several charges inert until a later detonate command", async () => {
    const sim = await DestructionSimulation.create(wall());
    try {
      sim.enqueue(charge()); sim.enqueue(charge(2, 3, .6, 30)); sim.enqueue(detonate());
      for (let i = 0; i < 29; i++) {
        const frame = sim.step();
        expect(frame.stats.brokenBonds).toBe(0);
        if (frame.tick >= 3) expect(frame.ordnance).toHaveLength(2);
      }
      const frame = sim.step();
      expect(frame.ordnance).toHaveLength(0);
      expect(frame.events.filter(event => event.type === "explosiveDetonated")).toHaveLength(2);
      expect(frame.stats.brokenBonds).toBe(2);
    } finally { sim.dispose(); }
  });

  it("mounts a charge in fragment-local space while the fragment falls and rotates", async () => {
    const manifest = wall();
    manifest.fragments = [{ ...manifest.fragments[0], anchored: false, position: [0, 8, 0], size: [1, 1, 1] }];
    manifest.bonds = [];
    const sim = await DestructionSimulation.create(manifest);
    try {
      sim.enqueue({ ...charge(), position: [.5, 8, 0], direction: [1, 0, 0] });
      sim.world.forEachRigidBody(body => body.setAngvel({ x: 0, y: 0, z: 1 }, true));
      for (let i = 0; i < 30; i++) sim.step();
      const frame = sim.frame(), p = frame.ordnance![0].position;
      const distance = Math.hypot(p[0] - frame.transforms[0], p[1] - frame.transforms[1], p[2] - frame.transforms[2]);
      expect(distance).toBeCloseTo(.565, 4);
      expect(p[1]).toBeLessThan(8);
      expect(frame.ordnance![0].rotation![2]).not.toBe(0);
    } finally { sim.dispose(); }
  });

  it("preserves attachment IDs through replay parsing and reproduces ordnance, physics, and contacts", async () => {
    const a = await DestructionSimulation.create(wall()), b = await DestructionSimulation.create(wall());
    try {
      const log = parseReplay(serializeReplay({ version: 1, simulationVersion: SIMULATION_VERSION, assetHash: a.manifest.assetHash, scenario: "wall", endTick: 100, commands: [charge(), { ...ball(2, 3), position: [0, 2, 12] }, detonate(3, 45)] }));
      expect(log.simulationVersion).toBe(SIMULATION_VERSION);
      expect(log.commands[0].fragmentId).toBe(10);
      log.commands.forEach(command => a.enqueue(command));
      [...log.commands].reverse().forEach(command => b.enqueue(command));
      for (let i = 0; i < log.endTick; i++) {
        const fa = a.step(), fb = b.step();
        expect(fa.ordnance).toEqual(fb.ordnance);
        expect(fa.transforms).toEqual(fb.transforms);
        expect(fa.stats.checksum).toBe(fb.stats.checksum);
        expect(fa.events).toEqual(fb.events);
      }
    } finally { a.dispose(); b.dispose(); }
  });

  it("bounds charges and cannonballs, expires bodies deterministically, and releases colliders", async () => {
    const sim = await DestructionSimulation.create(wall());
    try {
      const initialBodies = sim.world.bodies.len();
      const initialHandles = new Set(sim.world.bodies.getAll().map(body => body.handle));
      for (let i = 0; i < MAX_CANNONBALLS + 1; i++) sim.enqueue({ ...ball(i), position: [20, 5 + i, 10], direction: [1, 0, 0] });
      for (let i = 0; i < MAX_EXPLOSIVES + 1; i++) sim.enqueue(charge(100 + i));
      const frame = sim.step();
      expect(frame.ordnance!.filter(item => item.type === "cannonball")).toHaveLength(MAX_CANNONBALLS);
      expect(frame.ordnance!.filter(item => item.type === "explosive")).toHaveLength(MAX_EXPLOSIVES);
      expect(frame.stats.capacityEvents).toBe(2);
      expect(sim.world.bodies.len()).toBe(initialBodies + MAX_CANNONBALLS);
      const ordnanceBodies = sim.world.bodies.getAll().filter(body => !initialHandles.has(body.handle));
      const ordnanceColliders = ordnanceBodies.flatMap(body => Array.from({ length: body.numColliders() }, (_, index) => body.collider(index).handle));
      for (let i = 0; i < 1201; i++) sim.step();
      expect(sim.frame().ordnance!.filter(item => item.type === "cannonball")).toHaveLength(0);
      for (const body of ordnanceBodies) expect(body.isValid()).toBe(false);
      for (const handle of ordnanceColliders) expect(sim.world.getCollider(handle)).toBeNull();
      sim.dispose();
      const reset = await DestructionSimulation.create(wall());
      expect(reset.frame().ordnance).toHaveLength(0);
      reset.dispose();
    } finally { sim.dispose(); }
  });

  it("uses normal approach speed so a fast grazing contact is not a head-on impact", async () => {
    const sim = await DestructionSimulation.create(wall());
    try {
      const direction: [number, number, number] = [Math.sqrt(1 - .02 ** 2), 0, -.02];
      sim.enqueue({ ...ball(), position: [-.5, 2, .48], direction });
      let impacts = 0;
      for (let i = 0; i < 8; i++) impacts += sim.step().events.filter(event => event.type === "cannonballImpact").length;
      expect(impacts).toBe(0);
      expect(sim.frame().stats.brokenBonds).toBe(0);
    } finally { sim.dispose(); }
  });

  it("round-trips bounded ordnance snapshots and enforces authoritative weapon policy", async () => {
    const sim = await DestructionSimulation.create(wall());
    try {
      sim.enqueue(charge()); sim.enqueue(ball(2));
      const frame = sim.step(), snapshot = decodeSnapshot(encodeSnapshot(frame));
      expect(snapshot.ordnance).toHaveLength(2);
      for (let i = 0; i < 2; i++) {
        expect(snapshot.ordnance![i].type).toBe(frame.ordnance![i].type);
        expect(snapshot.ordnance![i].id).toBe(frame.ordnance![i].id);
        for (let axis = 0; axis < 3; axis++) expect(snapshot.ordnance![i].position[axis]).toBeCloseTo(frame.ordnance![i].position[axis], 5);
      }
      const accepted = commandFromIntent({ ...charge(), strength: 999, radius: 999 }, { tick: 1, source: 7, lastId: 0 });
      expect(accepted.fragmentId).toBe(10);
      expect(accepted.strength).toBe(2.8);
      expect(validateCommand({ ...ball(), strength: .4 })).toBe(true);
      expect(cannonballSpeed(.4)).toBe(21.2);
      expect(validateCommand({ ...ball(), direction: [0, 0, 0] })).toBe(false);
      expect(() => sim.enqueue({ ...charge(50), fragmentId: 15 })).toThrow("unknown fragment");
      expect(() => sim.enqueue({ ...charge(51), fragmentId: 31 + MAX_SECONDARY_ID_SPAN })).toThrow("unknown fragment");
      expect(() => sim.enqueue({ ...charge(52), fragmentId: 31.5 })).toThrow();
      expect(sim.enqueue({ ...charge(53), fragmentId: 999 })).not.toBeNull();
    } finally { sim.dispose(); }
  });
});
