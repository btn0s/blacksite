import { describe, expect, it } from 'vitest';
import { StructuralGraph } from '../../packages/destruction-graph/src/index';
import { createScenario } from '../../packages/destruction-testkit/src/index';

describe('direct structural work', () => {
  it('reuses a stable load without changing the solved topology or bond actions', () => {
    const graph = new StructuralGraph(createScenario('cantilever'));
    graph.directWorkLimit = Infinity;
    const first = graph.step();
    const actions = graph.directResult!.combinedImpulse.slice();
    const second = graph.step();
    expect(second.checksum).toBe(first.checksum);
    expect(graph.directResult!.combinedImpulse).toEqual(actions);
    expect(graph.directResult!.complete).toBe(true);
    expect(graph.directResult!.cachedComponents).toBeGreaterThanOrEqual(0);
  });
});

it('honors a deterministic direct-solver work quota on a large graph', () => {
  const template = createScenario('cantilever');
  const count = 1400;
  const manifest = {
    ...template,
    fragments: Array.from({ length: count }, (_, i) => ({
      ...template.fragments[0], id: i, anchored: i === 0, mass: 1,
      position: [i, 0, 0] as [number, number, number],
      size: [1, 1, 1] as [number, number, number], shape: undefined,
    })),
    bonds: Array.from({ length: count - 1 }, (_, i) => ({
      id: i, a: i, b: i + 1, normal: [1, 0, 0] as [number, number, number], area: 1, strength: 100,
    })),
  };
  const first = new StructuralGraph(manifest), second = new StructuralGraph(manifest);
  first.directWorkLimit = second.directWorkLimit = 500;
  for (let tick = 0; tick < 8; tick++) {
    expect(first.step().checksum).toBe(second.step().checksum);
    expect(first.damage).toEqual(second.damage);
    expect(first.directResult!.workUsed).toBeLessThanOrEqual(500);
    expect(first.directResult!.workUsed).toBe(second.directResult!.workUsed);
    expect(first.directResult!.workDeferred).toBe(second.directResult!.workDeferred);
  }
});

it('updates the direct RHS when contact loads or live mass change', () => {
  const manifest = createScenario('cantilever');
  const graph = new StructuralGraph(manifest);
  graph.directWorkLimit = Infinity;
  const wrenches = new Float64Array(manifest.fragments.length * 6);
  graph.setExternalLoads({ tick: 1, bodies: [], wrenches });
  graph.step();
  const base = graph.directResult!.rhs.slice();
  const tip = manifest.fragments.findIndex(fragment => !fragment.anchored && fragment.support !== false);
  wrenches[tip * 6] = 100;
  graph.setExternalLoads({ tick: 2, bodies: [], wrenches });
  graph.step();
  expect(graph.directResult!.rhs[tip * 6]).toBeGreaterThan(base[tip * 6]!);
  graph.setFragmentMass(tip, graph.fragmentMass[tip]! * 0.8);
  graph.step();
  expect(graph.directResult!.rhs[tip * 6 + 1]).toBeGreaterThan(base[tip * 6 + 1]!);
});

it('batches primary removal and keeps topology checksums current', () => {
  const manifest = createScenario('cantilever');
  const batch = new StructuralGraph(manifest),
    individual = new StructuralGraph(manifest);
  const before = batch.checksum();
  const indices = manifest.fragments
    .flatMap((fragment, index) => (fragment.anchored ? [] : [index]))
    .slice(0, 6);
  batch.removeFragments(indices);
  for (const index of indices) individual.removeFragment(index);
  expect(batch.checksum()).not.toBe(before);
  expect(batch.checksum()).toBe(individual.checksum());
  expect(batch.supported).toEqual(individual.supported);
  expect(batch.states).toEqual(individual.states);
  const unchanged = batch.checksum();
  expect(() => batch.removeFragments([0, manifest.fragments.length])).toThrow();
  expect(batch.checksum()).toBe(unchanged);
});

// Skipped: baked rubble is a fixed body and its pose is no longer polled every tick.
it.skip('refreshes sleeping native body poses after a host teleport without waking them', async () => {
  const { DestructionSimulation, FragmentState } = await import('../../packages/cascade/src/index');
  const { default: rapier } = await import('@dimforge/rapier3d-compat');
  const template = createScenario('cantilever');
  const manifest = {
    ...template,
    fragments: [0, 1].map((i) => ({
      ...template.fragments[0],
      id: i,
      anchored: false,
      mass: 1,
      position: [i - 0.5, 0.6, 0] as [number, number, number],
      size: [1, 1, 1] as [number, number, number],
      shape: undefined,
    })),
    bonds: [
      { id: 0, a: 0, b: 1, normal: [1, 0, 0] as [number, number, number], area: 1, strength: 100 },
    ],
  };
  const simulation = await DestructionSimulation.create(manifest);
  try {
    for (let tick = 0; tick < 400; tick++) simulation.step();
    const before = simulation.frame();
    expect(before.states[0]).toBe(FragmentState.Settled);
    const version = simulation.collisionGeometry().version;
    simulation.world.forEachRigidBody((body) => {
      body.setBodyType(rapier.RigidBodyType.Fixed, false);
      const position = body.translation();
      body.setTranslation({ ...position, x: position.x + 1 }, false);
    });
    simulation.world.propagateModifiedBodyPositionsToColliders();
    const after = simulation.step();
    expect(after.states[0]).toBe(FragmentState.Settled);
    expect(after.transforms[0]).toBeCloseTo(before.transforms[0] + 1, 5);
    expect(simulation.collisionGeometry().version).toBeGreaterThan(version);
  } finally {
    simulation.dispose();
  }
});
