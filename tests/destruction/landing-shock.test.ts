import { describe, expect, it } from 'vitest';
import {
  BondState,
  FragmentState,
  SIMULATION_VERSION,
  TRANSFORM_STRIDE,
  type DestructibleManifest,
  type DestructionCommand,
  type Vec3,
} from '../../packages/destruction-domain/src/index';
import { StructuralGraph } from '../../packages/destruction-graph/src/index';
import {
  decodeSnapshot,
  encodeSnapshot,
} from '../../packages/destruction-network/src/index';
import { DestructionSimulation } from '../../packages/destruction-physics/src/index';

function tower(gap: number, rows = 8): DestructibleManifest {
  const fragments = Array.from({ length: rows * 2 }, (_, i) => ({
    aggregate: 0,
    anchored: false,
    id: 10 + i * 10,
    mass: 1000,
    material: 0,
    position: [(i % 2) - 0.5, Math.floor(i / 2) + 0.5 + gap, 0] as Vec3,
    region: 0,
    size: [1, 1, 1] as Vec3,
  }));
  const bonds: DestructibleManifest['bonds'] = [];
  for (let i = 0; i < fragments.length; i++) {
    for (const other of [i % 2 === 0 ? i + 1 : -1, i + 2]) {
      if (other < 0 || other >= fragments.length) {
        continue;
      }
      bonds.push({
        a: fragments[i]!.id,
        area: 1,
        b: fragments[other]!.id,
        id: bonds.length,
        normal: other === i + 1 ? [1, 0, 0] : [0, 1, 0],
        strength: 2,
      });
    }
  }
  return {
    assetHash: `landing-${gap}-${rows}`,
    bonds,
    coordinateSystem: 'Y_UP_RH',
    fragments,
    materials: [
      {
        brittleness: 0.7,
        color: '#aaa',
        compressionStrength: 20_000_000,
        density: 1000,
        friction: 0.8,
        id: 0,
        name: 'Concrete',
        strength: 2,
      },
    ],
    name: 'Landing tower',
    regions: [],
    scenario: 'building',
    schemaVersion: 1,
  };
}

function transforms(manifest: DestructibleManifest): Float32Array {
  const result = new Float32Array(manifest.fragments.length * TRANSFORM_STRIDE);
  manifest.fragments.forEach((fragment, i) =>
    result.set([...fragment.position, 0, 0, 0, 1, 0], i * TRANSFORM_STRIDE),
  );
  return result;
}

const impact = (source: number): DestructionCommand => ({
  direction: [1, 0, 0],
  id: 1,
  position: [0, 5, 0],
  radius: 2,
  source,
  strength: 0.1,
  tick: 1,
  type: 'pointImpact',
});

describe('contact-localized landing shock', () => {
  it('damages internal bonds near the nearest contact once, leaving distant and external bonds intact', () => {
    const manifest = tower(0);
    const graph = new StructuralGraph(manifest);
    const contact = { x: 0, y: 0, z: 0 };
    graph.shockIsland(
      manifest.fragments.map((_, i) => i),
      [contact, contact],
      8,
      2,
      transforms(manifest),
    );
    graph.step();
    expect(graph.states[0]).toBe(BondState.Broken);
    const remote = manifest.bonds.findIndex((bond) => bond.a === manifest.fragments.at(-2)!.id);
    expect(graph.damage[remote]).toBe(0);
    expect(graph.states[remote]).toBe(BondState.Intact);
    const once = new StructuralGraph(manifest);
    const duplicate = new StructuralGraph(manifest);
    once.shockIsland([0, 1], [contact], 0.2, 2, transforms(manifest));
    duplicate.shockIsland([1, 0, 0, 1], [contact, contact], 0.2, 2, transforms(manifest));
    once.step();
    duplicate.step();
    expect([...once.damage]).toEqual([...duplicate.damage]);
    expect(once.damage[0]).toBeGreaterThan(0);
    expect(once.damage[1]).toBe(0);
  });

  it('keeps a storey-height block intact after a ten-centimetre slump', async () => {
    const sim = await DestructionSimulation.create(tower(0.1, 4));
    try {
      for (let i = 0; i < 600; i++) {
        sim.step();
      }
      const frame = sim.frame();
      expect(frame.stats.brokenBonds).toBe(0);
      expect(frame.stats.settledBodies).toBe(1);
      expect(frame.stats.activeBodies).toBe(0);
      expect(frame.stats.crushedFragments).toBe(0);
    } finally {
      sim.dispose();
    }
  });

  it('lands a bonded tower with finite state and no remote bond failure', async () => {
    const manifest = tower(3);
    const sim = await DestructionSimulation.create(manifest);
    try {
      let landed = false;
      for (let i = 0; i < 180; i++) {
        const frame = sim.step();
        if (frame.transforms[1]! >= 0.8) {
          continue;
        }
        expect(frame.transforms.every(Number.isFinite)).toBe(true);
        const remote = manifest.bonds.findIndex((bond) => bond.a === manifest.fragments.at(-2)!.id);
        expect(frame.bondStates[remote]).toBe(BondState.Intact);
        expect(frame.stats.brokenBonds).toBeLessThan(manifest.bonds.length);
        landed = true;
        break;
      }
      expect(landed).toBe(true);
      for (let i = 0; i < 600; i++) {
        sim.step();
      }
      const frame = sim.frame();
      const spread = manifest.fragments
        .map((_, i) =>
          Math.hypot(
            Math.max(0, Math.abs(frame.transforms[i * TRANSFORM_STRIDE]!) - 1),
            Math.max(0, Math.abs(frame.transforms[i * TRANSFORM_STRIDE + 2]!) - 0.5),
          ),
        )
        .sort((a, b) => a - b);
      expect(spread[Math.floor(spread.length * 0.9)]).toBeLessThan(4);
      const decoded = decodeSnapshot(encodeSnapshot(frame));
      expect(decoded.states).toEqual(frame.states);
      expect(decoded.bondStates).toEqual(frame.bondStates);
    } finally {
      sim.dispose();
    }
  });

  it('leaves Rapier contact momentum unchanged for cascades, while retaining player impulses', async () => {
    const manifest = tower(4.5, 1);
    manifest.fragments = [manifest.fragments[0]!];
    manifest.fragments[0]!.position = [0, 5, 0];
    manifest.bonds = [];
    for (const source of [2_147_483_647, 7]) {
      const sim = await DestructionSimulation.create(manifest);
      try {
        sim.enqueue(impact(source));
        sim.beforePhysicsStep();
        const velocities: Array<number> = [];
        sim.world.forEachRigidBody((body) => velocities.push(body.linvel().x));
        if (source === 2_147_483_647) {
          expect(velocities).toEqual([0]);
        } else {
          expect(velocities[0]).toBeGreaterThan(0);
        }
        sim.world.step();
        sim.afterPhysicsStep();
      } finally {
        sim.dispose();
      }
    }
  });

  it('uses the whole falling body mass and allows several bounded cascades for a large island', async () => {
    const sim = await DestructionSimulation.create(tower(3, 40));
    try {
      let checked = false;
      for (let tick = 0; tick < 120; tick++) {
        const frame = sim.step();
        const cascades = frame.events.filter((event) => event.type === 'heavyImpact');
        if (!cascades.length) {
          continue;
        }
        expect(cascades.length).toBeGreaterThan(1);
        expect(cascades.length).toBeLessThanOrEqual(3);
        expect(cascades[0]!.energy).toBeGreaterThan(500_000);
        checked = true;
        break;
      }
      expect(checked).toBe(true);
    } finally {
      sim.dispose();
    }
  });

  it('replays landing contacts with identical topology, transforms, events and dust mass', async () => {
    const manifest = tower(3, 4);
    const original = await DestructionSimulation.create(manifest);
    const replay = await DestructionSimulation.create(manifest);
    try {
      for (let tick = 0; tick < 240; tick++) {
        const a = original.step(),
          b = replay.step();
        expect(b.transforms).toEqual(a.transforms);
        expect(b.states).toEqual(a.states);
        expect(b.bondStates).toEqual(a.bondStates);
        expect(b.events).toEqual(a.events);
        expect(b.stats.checksum).toBe(a.stats.checksum);
        expect(b.stats.crushedMass).toBe(a.stats.crushedMass);
      }
      expect(original.frame().transforms.every(Number.isFinite)).toBe(true);
      expect(original.recordReplay().simulationVersion).toBe(SIMULATION_VERSION);
    } finally {
      original.dispose();
      replay.dispose();
    }
  });
});
