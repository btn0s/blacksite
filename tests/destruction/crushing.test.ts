import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import HOST_RAPIER from 'rapier-host';
import {
  FIXED_DT,
  FragmentState,
  type DestructibleManifest,
  type DestructionCommand,
  type Vec3,
} from '../../packages/destruction-domain/src/index';
import {
  decodeSnapshot,
  encodeSnapshot,
  verifySnapshot,
} from '../../packages/destruction-network/src/index';
import { DestructionSimulation } from '../../packages/destruction-physics/src/index';

const hostRapier = HOST_RAPIER as unknown as typeof RAPIER;
beforeAll(async () => {
  await RAPIER.init();
  await HOST_RAPIER.init();
});

function pier(): DestructibleManifest {
  return {
    assetHash: 'crush-pier',
    bonds: [{ a: 10, area: 1, b: 20, id: 1, normal: [0, 1, 0], strength: 2 }],
    coordinateSystem: 'Y_UP_RH',
    fragments: [
      {
        aggregate: 0,
        anchored: true,
        id: 10,
        mass: 100,
        material: 0,
        position: [0, 0.25, 0],
        region: 0,
        size: [1, 0.5, 1],
      },
      {
        aggregate: 0,
        anchored: false,
        id: 20,
        mass: 1000,
        material: 0,
        position: [0, 1, 0],
        region: 0,
        size: [1, 1, 1],
      },
      {
        aggregate: 0,
        anchored: true,
        id: 30,
        mass: 1000,
        material: 0,
        position: [5, 1, 0],
        region: 0,
        size: [1, 1, 1],
      },
    ],
    materials: [
      {
        brittleness: 0.7,
        color: '#aaa',
        density: 1000,
        friction: 0.8,
        id: 0,
        name: 'Concrete',
        strength: 2,
      },
    ],
    name: 'Crush pier',
    regions: [],
    scenario: 'building',
    schemaVersion: 1,
  };
}
const charge: DestructionCommand = {
  direction: [0, 0, 1],
  fragmentId: 20,
  id: 100,
  position: [0, 1, 0.5],
  radius: 3,
  source: 7,
  strength: 2,
  tick: 2,
  type: 'placeExplosive',
};
const detonate: DestructionCommand = {
  ...charge,
  fragmentId: undefined,
  id: 101,
  tick: 3,
  type: 'detonate',
};

function step(sim: DestructionSimulation) {
  sim.beforePhysicsStep();
  sim.world.step();
  return sim.afterPhysicsStep();
}

describe('crushing lifecycle', () => {
  it.each([RAPIER, hostRapier])(
    'pulverises a placed-charge pier and removes refined colliders without losing loose chip lineage',
    (rapier) => {
      const manifest = pier();
      const world = new rapier.World({ x: 0, y: -9.81, z: 0 });
      world.timestep = FIXED_DT;
      const unrelated = world.createCollider(
        rapier.ColliderDesc.ball(0.2).setTranslation(10, 2, 0),
      );
      const sim = DestructionSimulation.attach(manifest, { rapier, world });
      try {
        step(sim);
        const target = sim.fragmentColliders().find((entry) => entry.fragmentId === 20)!;
        sim.recordImpact({
          colliderHandle: target.handle,
          direction: [0, 0, -1],
          energy: 2019,
          impulse: [0, 0, -5.6],
          position: [0, 1, 0.5],
        });
        const refined = step(sim);
        expect(refined.secondary!.states).toContain(FragmentState.Supported);
        const attachedIds = new Set(
          refined
            .secondary!.fragments.filter(
              (_, i) => refined.secondary!.states[i] === FragmentState.Supported,
            )
            .map((fragment) => fragment.id),
        );
        const attachedHandles = sim
          .fragmentColliders()
          .filter((entry) => attachedIds.has(entry.fragmentId))
          .map((entry) => entry.handle);
        const looseIds = refined
          .secondary!.fragments.filter(
            (_, i) => refined.secondary!.states[i] !== FragmentState.Supported,
          )
          .map((fragment) => fragment.id);
        const navBefore = sim.collisionGeometry();
        sim.enqueue({ ...charge, tick: sim.tick + 1 });
        sim.enqueue({ ...detonate, tick: sim.tick + 2 });
        step(sim);
        const frame = step(sim);
        expect(frame.stats.crushedFragments).toBeGreaterThanOrEqual(1);
        expect(frame.stats.crushedMass).toBeGreaterThan(900);
        expect(frame.states[1]).toBe(FragmentState.Retired);
        expect(frame.states[0]).toBe(FragmentState.Supported);
        expect(frame.states[2]).toBe(FragmentState.Supported);
        expect(frame.secondary!.fragments.map((fragment) => fragment.id)).toEqual(looseIds);
        for (const handle of attachedHandles) {
          expect(sim.fragmentForCollider(handle)).toBeUndefined();
        }
        expect(sim.fragmentForCollider(target.handle)).toBeUndefined();
        expect(sim.graph.isRemoved(1)).toBe(true);
        expect(sim.collisionGeometry().version).toBeGreaterThan(navBefore.version);
        expect(sim.collisionGeometry().positions.length).toBeLessThan(navBefore.positions.length);
        expect(verifySnapshot(decodeSnapshot(encodeSnapshot(frame)), manifest)).toBe(true);
        expect(unrelated.isValid()).toBe(true);
        sim.dispose();
        expect(world.colliders.len()).toBe(1);
        expect(world.bodies.len()).toBe(0);
      } finally {
        sim.dispose();
        world.free();
      }
    },
  );

  it('does not pulverise material for generic explosions and never crushes anchored footings', async () => {
    const sim = await DestructionSimulation.create(pier());
    try {
      sim.enqueue({ ...charge, fragmentId: undefined, type: 'explosion', tick: 1 });
      const frame = sim.step();
      expect(frame.stats.crushedFragments).toBe(0);
      expect(frame.states[0]).toBe(FragmentState.Supported);
      expect(frame.stats.crushedMass).toBe(0);
    } finally {
      sim.dispose();
    }
  });

  it('bounds placed-charge crushing to sixteen retirements per tick and drains the remainder', async () => {
    const manifest = pier();
    manifest.fragments = [
      manifest.fragments[0]!,
      ...Array.from({ length: 40 }, (_, i) => ({
        ...manifest.fragments[1]!,
        id: 20 + i,
        position: [(i % 5) * 1.1, 1, Math.floor(i / 5) * 1.1] as Vec3,
      })),
    ];
    manifest.bonds = manifest.fragments
      .slice(1)
      .map((fragment, i) => ({ ...manifest.bonds[0]!, b: fragment.id, id: i }));
    const sim = await DestructionSimulation.create(manifest);
    try {
      sim.enqueue({ ...charge, position: [2.2, 1, 3.85], radius: 10, tick: 1 });
      sim.enqueue({ ...detonate, radius: 10, tick: 2 });
      sim.step();
      const a = sim.step();
      expect(a.stats.crushedFragments).toBe(16);
      expect(a.stats.capacityEvents).toBeGreaterThan(0);
      const b = sim.step();
      expect(b.stats.crushedFragments).toBe(32);
      const c = sim.step();
      expect(c.stats.crushedFragments).toBeGreaterThan(32);
      expect(c.stats.crushedFragments).toBeLessThanOrEqual(40);
      expect(c.states[0]).toBe(FragmentState.Supported);
      expect(sim.fragmentColliders().every(({ handle }) => sim.fragmentForCollider(handle) !== undefined)).toBe(true);
    } finally {
      sim.dispose();
    }
  });

  it('preserves material under a generic falling load', async () => {
    const manifest = pier();
    manifest.materials[0]!.compressionStrength = 2_000_000;
    manifest.fragments[1]!.mass = 100;
    manifest.fragments.push({
      ...manifest.fragments[1]!,
      id: 40,
      mass: 10_000,
      position: [0, 5, 0],
    });
    const sim = await DestructionSimulation.create(manifest);
    try {
      let frame = sim.frame();
      for (let i = 0; i < 160; i++) {
        frame = sim.step();
      }
      expect(frame.stats.crushedFragments).toBe(0);
      expect(frame.stats.crushedMass).toBe(0);
      expect(frame.states[0]).toBe(FragmentState.Supported);
      expect(frame.transforms.every(Number.isFinite)).toBe(true);
    } finally {
      sim.dispose();
    }
  });

  it.each([RAPIER, hostRapier])(
    'retains a bonded landing body in a shared world without forwarded contact events',
    (rapier) => {
      const manifest = pier();
      manifest.fragments = [
        { ...manifest.fragments[1]!, position: [-0.5, 8, 0] },
        { ...manifest.fragments[1]!, id: 40, position: [0.5, 8, 0] },
      ];
      manifest.bonds = [{ ...manifest.bonds[0]!, a: 20, b: 40, normal: [1, 0, 0] }];
      const world = new rapier.World({ x: 0, y: -9.81, z: 0 });
      world.timestep = FIXED_DT;
      const floor = world.createCollider(
        rapier.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0),
      );
      const sim = DestructionSimulation.attach(manifest, { rapier, world });
      try {
        for (let tick = 0; tick < 600; tick++) {
          step(sim);
        }
        expect(sim.frame().stats.brokenBonds).toBe(0);
        expect(sim.frame().stats.settledBodies).toBe(1);
        expect(sim.frame().transforms.every(Number.isFinite)).toBe(true);
        sim.dispose();
        expect(world.colliders.len()).toBe(1);
        expect(world.bodies.len()).toBe(0);
        expect(floor.isValid()).toBe(true);
      } finally {
        sim.dispose();
        world.free();
      }
    },
  );
});
