import RAPIER from "@dimforge/rapier3d-compat";
import { describe, expect, it } from "vitest";
import { DestructionSimulation } from "../../packages/destruction-physics/src/index";
import {
  COMPOUND_PROPS,
  COMPLEX_STAIR_ROUTE,
  createComplexScenario,
} from "../../packages/destruction-testkit/src/complex";
import type {
  DestructibleManifest,
  LevelBox,
  PlayerInput,
  Vec3,
} from "../../packages/destruction-domain/src/index";

const input = (overrides: Partial<PlayerInput> = {}): PlayerInput => ({
  forward: 0,
  right: 0,
  yaw: 0,
  jump: false,
  sprint: false,
  crouch: false,
  ...overrides,
});
const box = (id: string, position: Vec3, size: Vec3): LevelBox => ({
  id,
  position,
  size,
  material: "concrete",
  collidable: true,
});
function fixture(
  boxes: LevelBox[] = [],
  spawn: Vec3 = [0, 0.03, 0],
): DestructibleManifest {
  return {
    schemaVersion: 1,
    assetHash: "player-fixture",
    scenario: "building",
    name: "Player fixture",
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
    fragments: [
      {
        id: 10,
        position: [30, 3, 30],
        size: [1, 1, 1],
        mass: 100,
        material: 0,
        region: 0,
        aggregate: 0,
        anchored: true,
      },
    ],
    bonds: [],
    regions: [],
    level: {
      spawn: { position: spawn, yaw: 0 },
      camera: { position: [10, 10, 10], target: [0, 0, 0] },
      boxes,
    },
  };
}
function advance(sim: DestructionSimulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

describe("Rapier FPS controller", () => {
  it.each(COMPOUND_PROPS)("blocks walking through the $id prop and lets the player walk around it", async (prop) => {
    const authored = createComplexScenario().level!.boxes.find(
      (box) => box.id === `prop-collider-compound-${prop.id}`,
    )!;
    const front = prop.collider[2] / 2;
    const sin = Math.sin(prop.yaw), cos = Math.cos(prop.yaw);
    const sim = await DestructionSimulation.create(fixture([authored], [
      prop.at[0] + sin * (front + 1.3),
      0.03,
      prop.at[2] + cos * (front + 1.3),
    ]));
    const local = () => {
      const p = sim.frame().player!.position;
      const x = p[0] - prop.at[0], z = p[2] - prop.at[2];
      return { x: cos * x - sin * z, z: sin * x + cos * z, y: p[1] };
    };
    try {
      sim.setPlayerEnabled(true);
      advance(sim, 10);
      sim.setPlayerInput(input({ forward: 1, yaw: prop.yaw }));
      advance(sim, 100);
      expect(local().z).toBeGreaterThan(front + 0.2);
      expect(local().z).toBeLessThan(front + 0.5);
      expect(local().y).toBeLessThan(0.1);
      // Strafe past the actual rotated edge, then walk through the clear space alongside.
      sim.setPlayerInput(input({ right: 1, yaw: prop.yaw }));
      advance(sim, Math.ceil((prop.collider[0] / 2 + 0.65) * 60 / 3.5));
      expect(local().x).toBeGreaterThan(prop.collider[0] / 2 + 0.35);
      sim.setPlayerInput(input({ forward: 1, yaw: prop.yaw }));
      advance(sim, 80);
      expect(local().z).toBeLessThan(-front - 0.5);
      expect(sim.frame().player!.respawns).toBe(0);
    } finally {
      sim.dispose();
    }
  });

  it("steps across adjacent convex floor seams and 31 cm oblique rubble without getting pinned in a narrow passage", async () => {
    const sim = await DestructionSimulation.create(fixture([], [0, 0.24, 0.6]));
    try {
      const points = new Float32Array([
        -1, -0.1, -0.35, 1, -0.1, -0.35, -1, 0.1, -0.35, 1, 0.1, -0.35, -1,
        -0.1, 0.35, 1, -0.1, 0.35, -1, 0.1, 0.35, 1, 0.1, 0.35,
      ]);
      for (let i = 0; i < 12; i++)
        sim.world.createCollider(
          RAPIER.ColliderDesc.convexHull(points)!.setTranslation(
            0,
            0.1,
            0.35 - i * 0.7,
          ),
        );
      for (const x of [-0.9, 0.9])
        sim.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.12, 1.5, 4).setTranslation(x, 1.5, -3),
        );
      for (let i = 0; i < 3; i++)
        sim.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.6, 0.155, 0.2)
            .setTranslation(0, 0.355, -1.3 - i * 1.5)
            .setRotation({
              x: 0,
              y: Math.sin(Math.PI / 8),
              z: 0,
              w: Math.cos(Math.PI / 8),
            }),
        );
      sim.setPlayerEnabled(true);
      advance(sim, 15);
      sim.setPlayerInput(input({ forward: 1 }));
      advance(sim, 180);
      const player = sim.frame().player!;
      expect(player.position[2]).toBeLessThan(-5.3);
      expect(player.respawns).toBe(0);
      expect(player.position.every(Number.isFinite)).toBe(true);
    } finally {
      sim.dispose();
    }
  });

  it("walks the public entrance and both actual stair flights to the upper gallery", async () => {
    const sim = await DestructionSimulation.create(createComplexScenario());
    try {
      sim.setPlayerEnabled(true);
      advance(sim, 10);
      for (const waypoint of COMPLEX_STAIR_ROUTE) {
        let distance = Infinity;
        for (let i = 0; i < 360; i++) {
          const position = sim.frame().player!.position;
          const dx = waypoint[0] - position[0],
            dz = waypoint[2] - position[2];
          distance = Math.hypot(dx, dz);
          if (distance < 0.1) break;
          sim.setPlayerInput(
            input({
              forward: Math.min(1, distance * 3),
              yaw: Math.atan2(-dx, -dz),
            }),
          );
          sim.step();
        }
        expect(
          distance,
          `route ${waypoint}; actual ${sim.frame().player!.position}`,
        ).toBeLessThan(0.12);
        expect(sim.frame().player!.position[1]).toBeCloseTo(waypoint[1], 0);
      }
      expect(sim.frame().player!.respawns).toBe(0);
      expect(sim.frame().player!.position[1]).toBeGreaterThan(3.3);
    } finally {
      sim.dispose();
    }
  }, 15_000);

  it("refuses automatic step recovery through a low ceiling and permits crouched traversal", async () => {
    const sim = await DestructionSimulation.create(
      fixture([
        box("threshold", [0, 0.155, -2], [4, 0.31, 1]),
        box("low ceiling", [0, 2.08, -2], [4, 0.3, 1]),
      ]),
    );
    try {
      sim.setPlayerEnabled(true);
      advance(sim, 10);
      sim.setPlayerInput(input({ forward: 1 }));
      advance(sim, 120);
      expect(sim.frame().player!.position[2]).toBeGreaterThan(-1.4);
      expect(sim.frame().player!.respawns).toBe(0);
      sim.setPlayerInput(input({ forward: 1, crouch: true }));
      advance(sim, 80);
      expect(sim.frame().player!.position[2]).toBeLessThan(-3);
      expect(sim.frame().player!.respawns).toBe(0);
    } finally {
      sim.dispose();
    }
  });

  it("walks against real walls, normalizes diagonal input, and clears stale movement", async () => {
    const sim = await DestructionSimulation.create(
      fixture([box("wall", [0, 1.5, -3], [5, 3, 0.3])]),
    );
    try {
      sim.setPlayerEnabled(true);
      advance(sim, 10);
      sim.setPlayerInput(input({ forward: 1 }));
      advance(sim, 120);
      expect(sim.frame().player!.position[2]).toBeGreaterThan(-2.58);
      expect(sim.frame().player!.position[2]).toBeLessThan(-2.45);
      sim.clearPlayerInput();
      const stopped = sim.frame().player!.position;
      advance(sim, 20);
      expect(sim.frame().player!.position[2]).toBeCloseTo(stopped[2], 4);
      sim.respawnPlayer();
      sim.setPlayerInput(input({ right: 1, forward: -1 }));
      advance(sim, 30);
      const diagonal = sim.frame().player!.velocity;
      expect(Math.hypot(diagonal[0], diagonal[2])).toBeCloseTo(3.5, 4);
      sim.clearPlayerInput();
      sim.setPlayerInput(input({ forward: NaN, right: Infinity, yaw: NaN }));
      advance(sim, 10);
      expect(sim.frame().player!.position.every(Number.isFinite)).toBe(true);
      expect(sim.frame().player!.respawns).toBe(1);
      sim.setPlayerEnabled(false);
      sim.setPlayerInput(input({ right: 1 }));
      const before = sim.frame().player!.position;
      advance(sim, 30);
      expect(sim.frame().player!.position).toEqual(before);
    } finally {
      sim.dispose();
    }
  });

  it("climbs 20 cm stairs using their actual collision treads", async () => {
    const boxes = Array.from({ length: 8 }, (_, i) =>
      box(
        `step${i}`,
        [0, (i + 1) * 0.1, -1.3 - i * 0.38],
        [2.2, (i + 1) * 0.2, 0.38],
      ),
    );
    boxes.push(box("landing", [0, 0.8, -5.05], [2.2, 1.6, 1.8]));
    const sim = await DestructionSimulation.create(fixture(boxes));
    try {
      sim.setPlayerEnabled(true);
      advance(sim, 10);
      sim.setPlayerInput(input({ forward: 1 }));
      advance(sim, 95);
      const player = sim.frame().player!;
      expect(player.position[2]).toBeLessThan(-4);
      expect(player.position[1]).toBeGreaterThan(1.5);
      expect(player.grounded).toBe(true);
    } finally {
      sim.dispose();
    }
  });

  it("climbs a gentle ramp but cannot walk up a steep wall-like slope", async () => {
    for (const angle of [Math.PI / 6, Math.PI / 3]) {
      const ramp = box(
        "ramp",
        [0, Math.sin(angle) * 2 + Math.cos(angle) * 0.1, -2],
        [3, 0.2, 4],
      );
      ramp.rotation = [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
      const sim = await DestructionSimulation.create(
        fixture([ramp], [0, 0.03, 1]),
      );
      try {
        sim.setPlayerEnabled(true);
        advance(sim, 10);
        sim.setPlayerInput(input({ forward: 1 }));
        advance(sim, 80);
        const player = sim.frame().player!;
        if (angle < Math.PI / 4) {
          expect(player.position[1]).toBeGreaterThan(1);
          expect(player.position[2]).toBeLessThan(-2);
        } else {
          expect(player.position[1]).toBeLessThan(0.5);
          expect(player.position[2]).toBeGreaterThan(-1);
        }
      } finally {
        sim.dispose();
      }
    }
  });

  it("falls under gravity, jumps once per press, and lands", async () => {
    const sim = await DestructionSimulation.create(fixture([], [0, 3, 0]));
    try {
      sim.setPlayerEnabled(true);
      advance(sim, 12);
      expect(sim.frame().player!.position[1]).toBeLessThan(2.8);
      expect(sim.frame().player!.grounded).toBe(false);
      advance(sim, 65);
      expect(sim.frame().player!.grounded).toBe(true);
      sim.setPlayerInput(input({ jump: true }));
      advance(sim, 18);
      expect(sim.frame().player!.position[1]).toBeGreaterThan(0.7);
      advance(sim, 100);
      expect(sim.frame().player!.grounded).toBe(true);
      expect(sim.frame().player!.position[1]).toBeLessThan(0.05);
      advance(sim, 45);
      expect(sim.frame().player!.position[1]).toBeLessThan(0.05);
    } finally {
      sim.dispose();
    }
  });

  it("crouches through a low passage and only stands when the head has clearance", async () => {
    const sim = await DestructionSimulation.create(
      fixture([box("lintel", [0, 1.7, -2], [3, 0.8, 2])]),
    );
    try {
      sim.setPlayerEnabled(true);
      advance(sim, 10);
      sim.setPlayerInput(input({ forward: 1, crouch: true }));
      advance(sim, 65);
      expect(sim.frame().player!.position[2]).toBeLessThan(-1.5);
      sim.setPlayerInput(input());
      advance(sim, 10);
      expect(sim.frame().player!.crouched).toBe(true);
      expect(sim.frame().player!.eye[1]).toBeLessThan(1);
      sim.setPlayerInput(input({ forward: -1 }));
      advance(sim, 80);
      expect(sim.frame().player!.crouched).toBe(false);
      expect(sim.frame().player!.eye[1]).toBeGreaterThan(1.6);
      sim.setPlayerInput(input({ crouch: true }));
      advance(sim, 10);
      sim.respawnPlayer();
      advance(sim, 20);
      expect(sim.frame().player!.crouched).toBe(false);
      expect(sim.frame().player!.position[1]).toBeGreaterThan(0);
      expect(sim.frame().player!.eye[1]).toBeGreaterThan(1.6);
    } finally {
      sim.dispose();
    }
  });

  it("rides a moving support and falls when the support disappears", async () => {
    const sim = await DestructionSimulation.create(fixture([], [0, 1.22, 0]));
    try {
      const platform = sim.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, 0),
      );
      sim.world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.2, 2), platform);
      sim.setPlayerEnabled(true);
      advance(sim, 15);
      expect(sim.frame().player!.grounded).toBe(true);
      for (let i = 0; i < 90; i++) {
        platform.setNextKinematicTranslation({ x: (i + 1) / 60, y: 1, z: 0 });
        sim.step();
      }
      expect(sim.frame().player!.position[0]).toBeGreaterThan(1.35);
      sim.world.removeRigidBody(platform);
      advance(sim, 15);
      expect(sim.frame().player!.position[1]).toBeLessThan(0.9);
      expect(sim.frame().player!.grounded).toBe(false);
      advance(sim, 50);
      expect(sim.frame().player!.grounded).toBe(true);
    } finally {
      sim.dispose();
    }
  });

  it("uses authoritative eye rays for reachable charges and refuses an obstructed muzzle", async () => {
    const manifest = fixture([box("rear", [0, 1.5, -2], [5, 3, 0.3])]);
    manifest.fragments[0] = {
      ...manifest.fragments[0],
      position: [0, 1.5, -2],
      size: [1, 3, 0.3],
    };
    manifest.level!.boxes = [];
    const sim = await DestructionSimulation.create(manifest);
    try {
      sim.setPlayerEnabled(true);
      advance(sim, 10);
      const charge = sim.playerAction({
        type: "playerAction",
        id: 1,
        action: "explosive",
        direction: [0, 0, -1],
        radius: 2,
        strength: 2,
      });
      expect(charge.command?.fragmentId).toBe(10);
      expect(charge.command?.position[2]).toBeCloseTo(-1.85, 1);
      expect(
        sim.playerAction({
          type: "playerAction",
          id: 4,
          action: "hammer",
          direction: [0, 0, -1],
          radius: 1,
          strength: 2,
        }).command,
      ).toMatchObject({
        type: "pointImpact",
        radius: 0.48,
        direction: [0, 0, -1],
      });
      expect(
        sim.playerAction({
          type: "playerAction",
          id: 2,
          action: "explosive",
          direction: [0, 0, 1],
          radius: 2,
          strength: 2,
        }).message,
      ).toContain("3.2 m");
      sim.setPlayerInput(input({ forward: 1 }));
      advance(sim, 45);
      const shot = sim.playerAction({
        type: "playerAction",
        id: 3,
        action: "cannonball",
        direction: [0, 0, -1],
        radius: 0.32,
        strength: 2,
      });
      expect(shot.command).toBeUndefined();
      expect(shot.message).toContain("obstructed");
      expect(sim.commandLog).toHaveLength(2);
    } finally {
      sim.dispose();
    }
  });

  it("previews actual target range and restricts hammer/cutter damage to destructible hits", async () => {
    const manifest = fixture();
    manifest.fragments[0] = {
      ...manifest.fragments[0],
      position: [0, 1.5, -3],
      size: [1, 3, 0.3],
    };
    const sim = await DestructionSimulation.create(manifest);
    try {
      sim.setPlayerEnabled(true);
      sim.setPlayerInput(input({ aim: [0, 0, -1], tool: "hammer" }));
      advance(sim, 10);
      expect(sim.frame().aim).toMatchObject({ valid: false, fragmentId: 10 });
      expect(sim.frame().aim!.distance).toBeGreaterThan(2.4);
      expect(sim.frame().aim!.position).toBeDefined();
      const action = {
        type: "playerAction" as const,
        id: 1,
        direction: [0, 0, -1] as Vec3,
        radius: 1,
        strength: 2,
      };
      expect(
        sim.playerAction({ ...action, action: "hammer" }).command,
      ).toBeUndefined();
      const cutter = sim.playerAction({ ...action, action: "cutter" });
      expect(cutter.command).toMatchObject({
        type: "cut",
        radius: 0.38,
        source: 1,
      });
      expect(cutter.command!.position[2]).toBeCloseTo(-2.85, 1);
      // Level geometry may hold a charge, but direct damage tools cannot target it.
      sim.world.createCollider(
        RAPIER.ColliderDesc.cuboid(1, 1.5, 0.15).setTranslation(0, 1.5, -1.2),
      );
      sim.setPlayerInput(input({ aim: [0, 0, -1], tool: "cutter" }));
      advance(sim, 2);
      expect(sim.frame().aim).toMatchObject({
        valid: false,
        message: "Aim at destructible material.",
      });
      expect(
        sim.playerAction({ ...action, id: 2, action: "hammer" }).command,
      ).toBeUndefined();
      expect(
        sim.playerAction({ ...action, id: 2, action: "cutter" }).command,
      ).toBeUndefined();
      expect(
        sim.playerAction({ ...action, id: 2, action: "explosive" }).command
          ?.type,
      ).toBe("placeExplosive");
      sim.setPlayerInput(input({ aim: [0, 0, 1], tool: "explosive" }));
      advance(sim, 2);
      expect(sim.frame().aim).toMatchObject({ valid: false });
      expect(sim.frame().aim!.position).toBeUndefined();
      sim.setPlayerEnabled(false);
      expect(sim.frame().aim).toBeUndefined();
    } finally {
      sim.dispose();
    }
  });

  it("hides the placement ghost and rejects stacked charges while allowing adjacent mounts and clearing detonated mounts", async () => {
    const manifest = fixture();
    manifest.fragments[0] = {
      ...manifest.fragments[0],
      position: [0, 1.5, -2],
      size: [3, 3, 0.3],
    };
    const sim = await DestructionSimulation.create(manifest);
    try {
      sim.setPlayerEnabled(true);
      sim.setPlayerInput(input({ aim: [0, 0, -1], tool: "explosive" }));
      advance(sim, 10);
      const placement = {
        type: "playerAction" as const,
        action: "explosive" as const,
        direction: [0, 0, -1] as Vec3,
        radius: 0.1,
        strength: 0.1,
      };
      expect(sim.playerAction({ ...placement, id: 1 }).command?.type).toBe(
        "placeExplosive",
      );
      // Reject a second click even before the accepted command has been stepped.
      expect(sim.playerAction({ ...placement, id: 2 }).message).toBe(
        "Charge already mounted here.",
      );
      advance(sim, 2);
      expect(sim.frame().aim).toMatchObject({
        valid: false,
        message: "Charge already mounted here.",
      });
      expect(sim.frame().aim!.position).toBeUndefined();
      expect(sim.frame().aim!.normal).toBeUndefined();
      expect(sim.playerAction({ ...placement, id: 2 }).command).toBeUndefined();
      // This ray hits the same panel about 40 cm beside the first mounting point.
      const adjacent: Vec3 = [0.4, 0, -1.85];
      expect(
        sim.playerAction({ ...placement, direction: adjacent, id: 3 }).command
          ?.type,
      ).toBe("placeExplosive");
      advance(sim, 2);
      expect(sim.frame().ordnance).toHaveLength(2);
      sim.enqueue({
        type: "detonate",
        id: 4,
        source: 1,
        tick: sim.tick + 1,
        position: [0, 0, 0],
        direction: [0, 1, 0],
        radius: 1,
        strength: 1,
      });
      advance(sim, 2);
      expect(sim.frame().ordnance).toHaveLength(0);
      expect(sim.frame().aim).toMatchObject({ valid: true });
      expect(sim.playerAction({ ...placement, id: 5 }).command?.type).toBe(
        "placeExplosive",
      );
    } finally {
      sim.dispose();
    }
  });

  it("frees the old aiming point when an attached charge moves with a falling fragment", async () => {
    const manifest = fixture(
      [box("player platform", [0, 1.2, 0], [3, 2.4, 2])],
      [0, 2.43, 0],
    );
    manifest.fragments = [
      {
        ...manifest.fragments[0],
        position: [0, 4, -2],
        size: [3, 2, 0.3],
        anchored: false,
      },
      {
        ...manifest.fragments[0],
        id: 20,
        position: [0, 4, -3],
        size: [3, 8, 0.3],
      },
    ];
    const sim = await DestructionSimulation.create(manifest);
    try {
      sim.setPlayerEnabled(true);
      sim.setPlayerInput(input({ aim: [0, 0, -1], tool: "explosive" }));
      advance(sim, 10);
      expect(
        sim.playerAction({
          type: "playerAction",
          action: "explosive",
          id: 1,
          direction: [0, 0, -1],
          radius: 1,
          strength: 1,
        }).command?.fragmentId,
      ).toBe(10);
      advance(sim, 60);
      expect(sim.frame().ordnance).toHaveLength(1);
      expect(sim.frame().ordnance![0].position[1]).toBeLessThan(3);
      expect(sim.frame().aim).toMatchObject({ valid: true, fragmentId: 20 });
    } finally {
      sim.dispose();
    }
  });

  it("keeps destruction replay exact while the player walks among falling debris", async () => {
    const manifest = fixture([], [0, 0.03, 0]);
    manifest.fragments = [
      { ...manifest.fragments[0], position: [-0.5, 5, 0], anchored: false },
      {
        ...manifest.fragments[0],
        id: 20,
        position: [0.5, 5, 0],
        anchored: false,
      },
    ];
    manifest.bonds = [
      { id: 1, a: 10, b: 20, area: 1, strength: 0.1, normal: [1, 0, 0] },
    ];
    const original = await DestructionSimulation.create(manifest),
      replay = await DestructionSimulation.create(manifest);
    try {
      original.setPlayerEnabled(true);
      expect(original.world.colliders.len()).toBe(replay.world.colliders.len());
      original.setPlayerInput(input({ right: 0.1 }));
      original.enqueue({
        type: "cannonball",
        id: 1,
        source: 1,
        tick: 30,
        position: [0, 4, 4],
        direction: [0, 0, -1],
        radius: 0.32,
        strength: 1,
      });
      const recordedFrames = [];
      for (let i = 0; i < 240; i++) {
        recordedFrames.push(original.step());
      }
      const log = original.recordReplay();
      expect(Object.keys(log).sort()).toEqual([
        "assetHash",
        "commands",
        "endTick",
        "scenario",
        "simulationVersion",
        "version",
      ]);
      for (const command of log.commands) replay.enqueue(command);
      for (const a of recordedFrames) {
        const b = replay.step();
        expect(a.transforms).toEqual(b.transforms);
        expect(a.states).toEqual(b.states);
        expect(a.bondStates).toEqual(b.bondStates);
        expect(a.stress).toEqual(b.stress);
      }
    } finally {
      original.dispose();
      replay.dispose();
    }
  });
});
