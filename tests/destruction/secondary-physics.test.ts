import { describe, expect, it, vi } from "vitest";
import { DestructionSimulation } from "../../packages/destruction-physics/src/index";
import {
  encodeSnapshot,
  decodeSnapshot,
  verifySnapshot,
} from "../../packages/destruction-network/src/index";
import {
  FragmentState,
  MAX_SECONDARY_FRAGMENTS,
  type DestructibleManifest,
  type DestructionCommand,
  type FragmentDef,
  type Vec3,
} from "../../packages/destruction-domain/src/index";

function fragment(id = 10, position: Vec3 = [0, 5, 0]): FragmentDef {
  return {
    id,
    position,
    size: [1, 1, 1],
    mass: 50,
    material: 0,
    region: 0,
    aggregate: id,
    anchored: false,
  };
}
function fixture(fragments = [fragment()]): DestructibleManifest {
  return {
    schemaVersion: 1,
    assetHash: "secondary-fixture",
    name: "Secondary fracture",
    scenario: "wall",
    coordinateSystem: "Y_UP_RH",
    fragments,
    bonds: [],
    regions: [],
    materials: [
      {
        id: 0,
        name: "Cast concrete",
        density: 2350,
        strength: 1.2,
        color: "#aaa",
        friction: 0.8,
        brittleness: 0.8,
      },
    ],
  };
}
function blast(
  id: number,
  tick: number,
  position: Vec3 = [0, 5, 0],
  strength = 2,
  radius = 2,
): DestructionCommand {
  return {
    type: "explosion",
    id,
    tick,
    source: 0,
    position,
    direction: [0, 1, 0],
    strength,
    radius,
  };
}
function advance(sim: DestructionSimulation, count: number) {
  for (let i = 0; i < count; i++) sim.step();
}

describe("bounded secondary rigid debris", () => {
  it("detaches on the first blast, subdivides on a repeat blast, and never resurrects a retired parent on later topology rebuilds", async () => {
    const manifest = fixture([
      { ...fragment(1, [-1, 5, 0]), anchored: true },
      fragment(),
      { ...fragment(20, [7, 5, 0]), anchored: true },
      fragment(30, [8, 5, 0]),
    ]);
    manifest.bonds = [
      { id: 1, a: 1, b: 10, area: 1, strength: 0.5, normal: [1, 0, 0] },
      { id: 2, a: 20, b: 30, area: 1, strength: 0.5, normal: [1, 0, 0] },
    ];
    const sim = await DestructionSimulation.create(manifest);
    try {
      sim.enqueue(blast(1, 1));
      const first = sim.step();
      expect(first.secondary?.fragments.length).toBeGreaterThan(0);
      expect(first.states[1]).toBe(FragmentState.Retired);
      expect(first.secondary!.fragments.reduce((mass, child) => mass + child.mass, 0)).toBeCloseTo(manifest.fragments[1]!.mass, 6);
      sim.enqueue(blast(2, 2));
      const broken = sim.step();
      expect(broken.states[1]).toBe(FragmentState.Retired);
      expect(broken.secondary!.fragments.length).toBeGreaterThan(0);
      const decoded = decodeSnapshot(encodeSnapshot(broken));
      expect(verifySnapshot(decoded, manifest)).toBe(true);
      expect(decoded.secondary!.fragments).toEqual(broken.secondary!.fragments);
      expect(
        broken.secondary!.fragments.every(
          (f) => f.parentId === 10 && f.generation === 1,
        ),
      ).toBe(true);
      sim.enqueue({
        ...blast(3, 3, [7.5, 5, 0], 10, 0.3),
        type: "cut",
        direction: [1, 0, 0],
      });
      advance(sim, 30);
      expect(sim.frame().states[1]).toBe(FragmentState.Retired);
      expect(sim.frame().stats.brokenBonds).toBe(2);
      expect(sim.frame().secondary!.fragments.length).toBeGreaterThan(0);
      expect(sim.frame().secondary!.fragments.every((child) => child.generation <= 2)).toBe(true);
      expect(sim.frame().transforms.every(Number.isFinite)).toBe(true);
      expect(sim.fragmentColliders().every(({ handle }) => sim.fragmentForCollider(handle) !== undefined)).toBe(true);
    } finally {
      sim.dispose();
    }
  });

  it("preserves mass, inherited rigid velocity and spin, and authored rest-space geometry at subdivision", async () => {
    const sim = await DestructionSimulation.create(fixture());
    try {
      const parent = sim.world.bodies.getAll()[0];
      parent.setTranslation({ x: 2, y: 8, z: 1 }, true);
      parent.setRotation(
        { x: 0, y: Math.sin(0.3), z: 0, w: Math.cos(0.3) },
        true,
      );
      parent.setLinvel({ x: 3, y: 1, z: -2 }, true);
      parent.setAngvel({ x: 0.4, y: 1, z: -0.2 }, true);
      sim.world.propagateModifiedBodyPositionsToColliders();
      const created: {
        position: Vec3;
        velocity: Vec3;
        angular: Vec3;
        expected: Vec3;
      }[] = [];
      const create = sim.world.createRigidBody.bind(sim.world);
      const spy = vi
        .spyOn(sim.world, "createRigidBody")
        .mockImplementation((desc) => {
          const body = create(desc),
            p = body.translation(),
            v = body.linvel(),
            w = body.angvel();
          const r = { x: p.x - 2, y: p.y - 8, z: p.z - 1 };
          created.push({
            position: [p.x, p.y, p.z],
            velocity: [v.x, v.y, v.z],
            angular: [w.x, w.y, w.z],
            expected: [
              3 + r.z + 0.2 * r.y,
              1 - 0.2 * r.x - 0.4 * r.z,
              -2 + 0.4 * r.y - r.x,
            ],
          });
          return body;
        });
      sim.enqueue(blast(1, 1, [2, 8, 1]));
      const frame = sim.step();
      spy.mockRestore();
      const children = frame.secondary!.fragments;
      expect(children).toHaveLength(4);
      expect(children.reduce((sum, f) => sum + f.mass, 0)).toBeCloseTo(50, 8);
      expect(
        sim.world.bodies.getAll().reduce((sum, body) => sum + body.mass(), 0),
      ).toBeCloseTo(50, 4);
      for (const sample of created) {
        sample.velocity.forEach((n, i) =>
          expect(n).toBeCloseTo(sample.expected[i], 5),
        );
        sample.angular.forEach((n, i) =>
          expect(n).toBeCloseTo([0.4, 1, -0.2][i], 5),
        );
      }
      for (const child of children) {
        expect(child.position[0]).toBeGreaterThan(-0.5);
        expect(child.position[0]).toBeLessThan(0.5);
        expect(child.position[1]).toBeGreaterThan(4.5);
        expect(child.position[1]).toBeLessThan(5.5);
        expect(
          child.shape!.faces.some((face) => face.surface === "fracture"),
        ).toBe(true);
      }
      expect(frame.secondary!.transforms[0]).toBeGreaterThan(1.3);
    } finally {
      sim.dispose();
    }
  });

  it("leaves weak, distant and unsupported-material targets intact while exposing a compound member", async () => {
    const manifest = fixture([
      fragment(),
      fragment(20, [4, 5, 0]),
      fragment(30, [7, 5, 0]),
      fragment(40, [8, 5, 0]),
    ]);
    manifest.materials.push({
      ...manifest.materials[0],
      id: 1,
      name: "Facade glass",
    });
    manifest.fragments[1].material = 1;
    manifest.bonds = [
      { id: 1, a: 30, b: 40, area: 1, strength: 10, normal: [1, 0, 0] },
    ];
    const sim = await DestructionSimulation.create(manifest);
    try {
      sim.enqueue(blast(1, 1, [0, 5, 0], 0.1));
      sim.enqueue(blast(2, 1, [0, 5, 5], 10, 1));
      sim.enqueue(blast(3, 1, [4, 5, 0], 2, 0.6));
      sim.enqueue(blast(4, 1, [7, 5, 0], 2, 0.6));
      const frame = sim.step();
      expect(frame.secondary?.fragments.length).toBeGreaterThan(0);
      expect(frame.secondary!.fragments.every((child) => child.rootId === 30)).toBe(true);
      expect(frame.secondary!.fragments.reduce((mass, child) => mass + child.mass, 0)).toBeCloseTo(manifest.fragments[2]!.mass, 6);
      expect(frame.states[0]).not.toBe(FragmentState.Retired);
      expect(frame.states[1]).not.toBe(FragmentState.Retired);
      expect(verifySnapshot(decodeSnapshot(encodeSnapshot(frame)), manifest)).toBe(true);
    } finally {
      sim.dispose();
    }
  });

  it("retains settled rubble mass and lineage through a later blast", async () => {
    const sim = await DestructionSimulation.create(
      fixture([fragment(10, [0, 0.5, 0])]),
    );
    try {
      advance(sim, 200);
      expect(sim.frame().stats.settledBodies).toBe(1);
      sim.enqueue(blast(1, sim.tick + 1, [0, 0.5, 0]));
      expect(sim.step().secondary!.fragments).toHaveLength(4);
      advance(sim, 400);
      expect(sim.frame().stats.activeBodies).toBe(0);
      const frame = sim.frame().secondary!;
      for (let i = 0; i < frame.fragments.length; i++)
        expect(frame.transforms[i * 8 + 1]).toBeGreaterThan(0);
      const position: Vec3 = [
        frame.transforms[0],
        frame.transforms[1],
        frame.transforms[2],
      ];
      sim.enqueue(blast(2, sim.tick + 1, position, 2, 4));
      const kicked = sim.step();
      expect(kicked.secondary!.fragments).toHaveLength(4);
      expect(kicked.secondary!.fragments.reduce((mass, child) => mass + child.mass, 0)).toBeCloseTo(50, 6);
      expect(kicked.secondary!.fragments.every((child) => child.generation === 1)).toBe(true);
      expect(kicked.secondary!.transforms.every(Number.isFinite)).toBe(true);
      expect(verifySnapshot(decodeSnapshot(encodeSnapshot(kicked)), sim.manifest)).toBe(true);
    } finally {
      sim.dispose();
    }
  });

  it("caps subdivision to two parents per tick and keeps live debris within budget", async () => {
    const manifest = fixture(
      Array.from({ length: 160 }, (_, i) => ({
        ...fragment(i + 1, [(i % 10) * 0.3, 5, Math.floor(i / 10) * 0.3]),
        size: [0.2, 0.2, 0.2] as Vec3,
        mass: 10,
      })),
    );
    const sim = await DestructionSimulation.create(manifest);
    try {
      const initialBodies = sim.world.bodies.len();
      let retired = 0,
        blasts = 0;
      while (retired < manifest.fragments.length && blasts < 400) {
        blasts++;
        const before = sim.frame();
        const existingRoots = new Set(before.secondary?.fragments.map((child) => child.rootId) ?? []);
        const target = before.states.findIndex(
          (state) => state !== FragmentState.Retired,
        );
        const position: Vec3 = [
          before.transforms[target * 8],
          before.transforms[target * 8 + 1],
          before.transforms[target * 8 + 2],
        ];
        sim.enqueue(blast(blasts, before.tick + 1, position, 1.5, 10));
        const frame = sim.step();
        const now = frame.states.filter((state) => state === FragmentState.Retired).length;
        const newRoots = new Set((frame.secondary?.fragments ?? [])
          .filter((child) => !existingRoots.has(child.rootId)).map((child) => child.rootId));
        const splitRoots = [...newRoots].filter((rootId) =>
          frame.secondary!.fragments.filter((child) => child.rootId === rootId).length > 1);
        expect(splitRoots.length).toBeLessThanOrEqual(2);
        retired = now;
        expect(frame.secondary!.fragments.length).toBeLessThanOrEqual(
          MAX_SECONDARY_FRAGMENTS,
        );
        const ids = frame.secondary!.fragments.map((f) => f.id);
        expect(ids.every((id, slot) => slot === 0 || id > ids[slot - 1]!)).toBe(true);
      }
      const frame = sim.frame();
      expect(retired).toBe(manifest.fragments.length);
      expect(frame.secondary!.fragments.length).toBeLessThanOrEqual(MAX_SECONDARY_FRAGMENTS);
      expect(frame.stats.capacityEvents).toBeGreaterThan(0);
      expect(sim.world.bodies.len()).toBeLessThanOrEqual(initialBodies + MAX_SECONDARY_FRAGMENTS);
      expect(frame.secondary!.transforms.every(Number.isFinite)).toBe(true);
      expect(frame.secondary!.fragments.every((f) => f.generation === 1)).toBe(true);
      expect(verifySnapshot(decodeSnapshot(encodeSnapshot(frame)), manifest)).toBe(true);
    } finally {
      sim.dispose();
    }
  }, 15_000);

  it("subdivides with headroom under the current dynamic-body budget", async () => {
    const manifest = fixture(
      Array.from({ length: 1023 }, (_, i) => ({
        ...fragment(i + 1, [i * 2, 5, 0]),
        size: [0.2, 0.2, 0.2] as Vec3,
        mass: 10,
      })),
    );
    const sim = await DestructionSimulation.create(manifest);
    try {
      sim.enqueue(blast(1, 1, [0, 5, 0], 2, 0.5));
      const frame = sim.step();
      expect(frame.secondary?.fragments.length).toBeGreaterThan(0);
      expect(frame.secondary!.fragments.filter((child) => child.rootId === manifest.fragments[0]!.id)
        .reduce((mass, child) => mass + child.mass, 0)).toBeCloseTo(manifest.fragments[0]!.mass, 6);
      expect(sim.world.bodies.len()).toBeLessThanOrEqual(4096);
      expect(frame.stats.capacityEvents).toBe(0);
    } finally {
      sim.dispose();
    }
  });

  it("keeps mounted charges at their world pose and accepts deterministic future child IDs during replay enqueue", async () => {
    const manifest = fixture(),
      original = await DestructionSimulation.create(manifest),
      replay = await DestructionSimulation.create(manifest);
    try {
      const commands: DestructionCommand[] = [
        {
          ...blast(1, 1, [0, 5, 0.5], 1, 1),
          type: "placeExplosive",
          fragmentId: 10,
          direction: [0, 0, 1],
        },
        blast(2, 2),
        {
          ...blast(3, 3, [0, 5, 0.5], 1, 1),
          type: "placeExplosive",
          fragmentId: 11,
          direction: [0, 0, 1],
        },
        { ...blast(4, 10), type: "detonate" },
      ];
      for (const command of commands) {
        original.enqueue(command);
        replay.enqueue(command);
      }
      for (let tick = 1; tick <= 100; tick++) {
        const a = original.step(),
          b = replay.step();
        if (tick === 2) {
          const position = a.ordnance![0].position;
          expect(position.every(Number.isFinite)).toBe(true);
          expect(a.states[0]).toBe(FragmentState.Retired);
        }
        if (tick === 3) expect(a.ordnance).toHaveLength(2);
        expect(a.transforms).toEqual(b.transforms);
        expect(a.states).toEqual(b.states);
        expect(a.secondary).toEqual(b.secondary);
        expect(a.ordnance).toEqual(b.ordnance);
        expect(a.stats.checksum).toEqual(b.stats.checksum);
      }
    } finally {
      original.dispose();
      replay.dispose();
    }
  });

  it("transfers cannonball momentum to physical children without subdividing them again", async () => {
    const sim = await DestructionSimulation.create(fixture());
    try {
      sim.enqueue(blast(1, 1));
      const exposed = sim.step();
      expect(exposed.secondary?.fragments.length).toBeGreaterThan(0);
      const target = [...exposed.secondary!.fragments].sort((a, b) => b.mass - a.mass)[0]!;
      const targetCollider = sim.world.getCollider(sim.fragmentColliders()
        .find((entry) => entry.fragmentId === target.id)!.handle);
      const center = targetCollider.translation();
      sim.world.gravity = { x: 0, y: 0, z: 0 };
      sim.world.forEachRigidBody((body) => {
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      });
      sim.enqueue({
        ...blast(2, 2, [center.x, center.y, center.z + 3], 1, 0.2),
        type: "cannonball",
        direction: [0, 0, -1],
      });
      let hit = false;
      for (let i = 0; i < 30; i++) {
        const frame = sim.step();
        hit ||= frame.events.some((event) => event.type === "cannonballImpact");
      }
      expect(hit).toBe(true);
      expect(sim.frame().secondary!.fragments).toHaveLength(4);
      const movingChildren = sim.world.bodies
        .getAll()
        .filter((body) => body.mass() < 50 && Math.abs(body.linvel().z) > 0.5);
      expect(movingChildren.length).toBeGreaterThan(0);
    } finally {
      sim.dispose();
    }
  });

  it("exposes secondary surfaces to FPS aiming and mounted charges", async () => {
    const manifest = fixture([fragment(10, [0, 1.7, -1.6])]);
    manifest.level = {
      spawn: { position: [0, 0.03, 0], yaw: 0 },
      camera: { position: [3, 3, 3], target: [0, 1, 0] },
      boxes: [],
    };
    const sim = await DestructionSimulation.create(manifest);
    try {
      sim.setPlayerEnabled(true);
      sim.enqueue(blast(1, 1, [0, 1.7, -1.6], 1.2));
      const frame = sim.step(),
        eye = frame.player!.eye;
      const point = frame.secondary!.transforms.slice(0, 3);
      const direction = point.map((n, i) => n - eye[i]);
      const length = Math.hypot(...direction);
      const aim = Array.from(direction, (n) => n / length) as Vec3;
      sim.setPlayerInput({
        forward: 0,
        right: 0,
        yaw: 0,
        jump: false,
        sprint: false,
        crouch: false,
        tool: "explosive",
        aim,
      });
      sim.step();
      expect(sim.frame().aim).toMatchObject({ valid: true });
      expect(sim.frame().aim!.fragmentId).toBeGreaterThan(10);
      const result = sim.playerAction({
        type: "playerAction",
        action: "explosive",
        id: 2,
        direction: aim,
        radius: 1,
        strength: 1,
      });
      expect(result.command?.fragmentId).toBeGreaterThan(10);
      sim.step();
      expect(sim.frame().ordnance).toHaveLength(1);
    } finally {
      sim.dispose();
    }
  });
});
