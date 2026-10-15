import { describe, expect, test } from 'vitest';
import { Effect } from 'effect';
import { DEFAULT_CONFIG, VERSIONS, validateRuntimeWorld, type RuntimeWorld } from '@blacksite/ai-schema';
import { TacticalRuntime, verifyReplay } from '@blacksite/ai-runtime';
import { AuthorityService, createAuthority } from '@blacksite/ai-services';
import { parseRequest } from '@blacksite/ai-worker';

const config = { ...DEFAULT_CONFIG, scenarioId: 'low-ammo' as const, agentsPerTeam: 2, maxTicks: 45 };
function authoredWorld(): RuntimeWorld {
  const point = (x: number, z: number) => ({ x, y: 0, z });
  return {
    initialAmmo: 9, initialHealth: { 'alpha-1': 47, 'bravo-2': 66 },
    map: {
      id: 'custom-courier-yard', name: 'Courier yard', version: 'courier-yard-v7', width: 24, depth: 18,
      obstacles: [{ id: 'workshop', x: 0, z: 0, width: 3, depth: 5, height: 3 }],
      regions: [
        { id: 'west', name: 'West yard', center: point(-7, 0), neighbors: ['loading'] },
        { id: 'loading', name: 'Loading yard', center: point(0, 7), neighbors: ['west', 'east'] },
        { id: 'east', name: 'East yard', center: point(7, 0), neighbors: ['loading'] },
      ],
      nodes: [
        { id: 'west-cover', position: point(-7, 4), regionId: 'west', kind: 'cover', cover: .8, exposure: .2, capacity: 1, neighbors: ['loading-point'] },
        { id: 'east-cover', position: point(7, 4), regionId: 'east', kind: 'cover', cover: .8, exposure: .2, capacity: 1, neighbors: ['loading-point'] },
        { id: 'loading-point', position: point(0, 7), regionId: 'loading', kind: 'objective', cover: .5, exposure: .5, capacity: 1, neighbors: ['west-cover', 'east-cover'] },
      ],
      spawns: { alpha: [point(-9, -2), point(-9, 2)], bravo: [point(9, -2), point(9, 2)] },
      objectives: [{ id: 'courier', position: point(0, 7), regionId: 'loading' }],
    },
  };
}

describe('portable authored worlds', () => {
  test('custom geometry, spawn settings and replay content replace demo selection without sharing mutable data', () => {
    const world = authoredWorld(), runtime = new TacticalRuntime(config, world);
    try {
      expect(runtime.map.id).toBe(world.map.id);
      expect(runtime.snapshot().scenarioId).toBe(world.map.id);
      expect(runtime.snapshot().agents.map(agent => [agent.id, agent.health, agent.ammo])).toEqual([
        ['alpha-1', 47, 9], ['alpha-2', 100, 9], ['bravo-1', 100, 9], ['bravo-2', 66, 9],
      ]);
      world.map.spawns.alpha[0].x = -10;
      world.initialHealth!['alpha-1'] = 1;
      expect(runtime.map.spawns.alpha[0].x).toBe(-9);
      for (let tick = 0; tick < config.maxTicks; tick++) runtime.step();
      const replay = JSON.parse(JSON.stringify(runtime.exportReplay()));
      expect(replay.world.map.id).toBe('custom-courier-yard');
      expect(replay.world.initialHealth['alpha-1']).toBe(47);
      expect(replay.versions.map).toBe('courier-yard-v7');
      expect(verifyReplay(replay)).toEqual({ valid: true, checkedTicks: runtime.snapshot().tick });
      replay.world.initialHealth['alpha-1'] = 46;
      expect(verifyReplay(replay)).toMatchObject({ valid: false, mismatchTick: 1 });
    } finally { runtime.dispose(); }
  });

  test('custom replay compatibility uses embedded map version while retaining historical planner provenance', () => {
    const runtime = new TacticalRuntime(config, authoredWorld());
    try {
      runtime.step(); const replay = runtime.exportReplay();
      replay.versions.planner = 'prior-planner'; replay.versions.model = 'prior-model';
      expect(verifyReplay(replay)).toEqual({ valid: true, checkedTicks: 1 });
      replay.versions.map = 'wrong-authored-map';
      expect(verifyReplay(replay)).toMatchObject({ valid: false, checkedTicks: 0 });
      replay.versions.map = 'courier-yard-v7'; replay.world!.map.nodes[0].regionId = 'missing';
      expect(verifyReplay(replay)).toMatchObject({ valid: false, checkedTicks: 0, reason: expect.stringContaining('unknown region') });
    } finally { runtime.dispose(); }
  });

  test('omitting a world keeps built-in content and replay compatibility unchanged', () => {
    const runtime = new TacticalRuntime(config);
    try {
      expect(runtime.map.id).toBe('low-ammo-arena');
      expect(runtime.snapshot().agents.every(agent => agent.ammo === 3)).toBe(true);
      runtime.step();
      const replay = runtime.exportReplay();
      expect(replay.world).toBeUndefined();
      expect(replay.versions.map).toBe(VERSIONS.map);
      expect(verifyReplay(replay)).toEqual({ valid: true, checkedTicks: 1 });
    } finally { runtime.dispose(); }
  });

  test('omitted authored spawn settings use simulation defaults rather than demo overrides', () => {
    const world = authoredWorld(); delete world.initialAmmo; delete world.initialHealth;
    const runtime = new TacticalRuntime(config, world);
    try { expect(runtime.snapshot().agents.every(agent => agent.health === 100 && agent.ammo === 24)).toBe(true); }
    finally { runtime.dispose(); }
  });

  test('worker initialization retains validated serializable content and the Effect authority uses it', async () => {
    const world = authoredWorld();
    const request = parseRequest(structuredClone({ type: 'init', config, world }));
    expect(request.type).toBe('init');
    if (request.type !== 'init') throw new Error('Expected init request');
    expect(request.world).toEqual(world);
    expect(request.world).not.toBe(world);
    const authority = createAuthority(request.config, request.world);
    try {
      const result = await authority.runPromise(Effect.gen(function* () {
        const service = yield* AuthorityService;
        yield* service.step();
        return { map: service.map, replay: yield* service.replay() };
      }));
      expect(result.map.id).toBe(world.map.id);
      expect(result.replay.world).toEqual(world);
      expect(verifyReplay(result.replay)).toEqual({ valid: true, checkedTicks: 1 });
    } finally { await authority.dispose(); }
  });

  test.each<[string, (world: RuntimeWorld) => void]>([
    ['nonfinite bounds', world => { world.map.width = Infinity; }],
    ['zero obstacle width', world => { world.map.obstacles[0].width = 0; }],
    ['unknown node region', world => { world.map.nodes[0].regionId = 'missing'; }],
    ['unknown node neighbor', world => { world.map.nodes[0].neighbors = ['missing']; }],
    ['unknown region neighbor', world => { world.map.regions[0].neighbors = ['missing']; }],
    ['duplicate node id', world => { world.map.nodes[1].id = world.map.nodes[0].id; }],
    ['unknown objective region', world => { world.map.objectives[0].regionId = 'missing'; }],
    ['missing objectives', world => { world.map.objectives = []; }],
    ['wrong spawn count', world => { world.map.spawns.alpha.pop(); }],
    ['obstructed spawn', world => { world.map.spawns.alpha[0] = { x: 0, y: 0, z: 0 }; }],
    ['overlapping spawns', world => { world.map.spawns.alpha[1] = { ...world.map.spawns.alpha[0] }; }],
    ['out-of-bounds objective', world => { world.map.objectives[0].position.x = 100; }],
    ['unknown health agent', world => { world.initialHealth!['alpha-3'] = 100; }],
    ['negative health', world => { world.initialHealth!['alpha-1'] = -1; }],
    ['overfull magazine', world => { world.initialAmmo = 25; }],
    ['callback payload', world => { Object.assign(world, { initialHealth: () => 100 }); }],
    ['cyclic payload', world => { Object.assign(world, { cycle: world }); }],
  ])('rejects %s before any authority is created', (_name, mutate) => {
    const world = authoredWorld(); mutate(world);
    expect(() => validateRuntimeWorld(world, 2)).toThrow('Invalid runtime world');
    expect(() => new TacticalRuntime(config, world)).toThrow('Invalid runtime world');
    expect(() => parseRequest({ type: 'init', config, world })).toThrow('Invalid runtime world');
  });
});
