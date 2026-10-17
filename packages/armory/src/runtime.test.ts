import { describe, expect, it, vi } from 'vitest';
import { ALS_WEAPONS, createWeaponRuntime } from './index';
import type { QueryHit, Vec3, WeaponCommand, WeaponDefinition, WeaponQueries, WeaponRuntime } from './index';

const zero = { x: 0, y: 0, z: 0 };
const forward = { x: 0, y: 0, z: -1 };
const queries: WeaponQueries = { castRay: () => null, sweepSphere: () => null };
const command = (tick: number, patch: Partial<WeaponCommand> = {}): WeaponCommand => ({ tick, trigger: false, aim: { origin: zero, direction: forward }, muzzle: zero, ...patch });
const rifle = (patch: Partial<WeaponDefinition> = {}): WeaponDefinition => ({ ...ALS_WEAPONS[0]!, spreadRadians: 0, ...patch });
const bow = (patch: Partial<WeaponDefinition> = {}): WeaponDefinition => ({ ...ALS_WEAPONS[2]!, spreadRadians: 0, ...patch });
const create = (definitions: readonly WeaponDefinition[] = [rifle()]) => createWeaponRuntime({ ownerId: 'player', seed: 2048, definitions });
const ammo = (runtime: WeaponRuntime, id = runtime.snapshot().equippedWeaponId) => runtime.snapshot().weapons.find(weapon => weapon.id === id)!;
const tickUntil = (runtime: WeaponRuntime, lastTick: number, patch: Partial<WeaponCommand> = {}, adapter: WeaponQueries = queries) => {
  const events = [];
  while (runtime.snapshot().nextTick <= lastTick) events.push(...runtime.step(command(runtime.snapshot().nextTick, patch), adapter));
  return events;
};
const hit = (point: Vec3, distance: number, targetId?: string): QueryHit => ({ point, distance, normal: { x: 0, y: 0, z: 1 }, colliderId: targetId ?? 'wall', ...(targetId ? { targetId } : {}) });

describe('fixed-tick firing and ammunition', () => {
  it('auto cadence is stable across a second of fixed ticks', () => {
    const runtime = create();
    const shots = tickUntil(runtime, 59, { trigger: true }).filter(event => event.type === 'shot');
    expect(shots.map(event => event.tick)).toEqual([0, 6, 12, 18, 24, 30, 36, 42, 48, 54]);
    expect(ammo(runtime)).toEqual({ id: 'rifle', magazine: 20, reserve: 180 });
  });

  it('preserves fractional fire rates without drift or catch-up after a pause', () => {
    const runtime = create([rifle({ roundsPerSecond: 7, magazineSize: 1000 })]);
    const shots = tickUntil(runtime, 599, { trigger: true }).filter(event => event.type === 'shot');
    expect(shots).toHaveLength(70);
    expect(shots.slice(0, 7).map(event => event.tick)).toEqual([0, 9, 18, 26, 35, 43, 52]);
    tickUntil(runtime, 700);
    expect(runtime.step(command(701, { trigger: true }), queries).filter(event => event.type === 'shot')).toHaveLength(1);
    expect(runtime.step(command(702, { trigger: true }), queries)).toHaveLength(0);
  });

  it('semi-auto requires trigger release and obeys cooldown', () => {
    const runtime = create([rifle({ fireMode: 'semi' })]);
    expect(tickUntil(runtime, 15, { trigger: true }).filter(event => event.type === 'shot')).toHaveLength(1);
    runtime.step(command(16), queries);
    expect(runtime.step(command(17, { trigger: true }), queries).some(event => event.type === 'shot')).toBe(true);
    runtime.step(command(18), queries);
    expect(runtime.step(command(19, { trigger: true }), queries).some(event => event.type === 'shot')).toBe(false);
    expect(tickUntil(runtime, 30, { trigger: true }).filter(event => event.type === 'shot')).toHaveLength(0);
  });

  it('burst completes after trigger release but does not repeat while held', () => {
    const runtime = create([rifle({ fireMode: 'burst', burstSize: 3 })]);
    const events = [...runtime.step(command(0, { trigger: true }), queries), ...tickUntil(runtime, 20)];
    expect(events.filter(event => event.type === 'shot').map(event => event.tick)).toEqual([0, 6, 12]);
    expect(tickUntil(runtime, 50, { trigger: true }).filter(event => event.type === 'shot').map(event => event.tick)).toEqual([21, 27, 33]);
  });

  it('does not consume ammunition when empty or spam empty events while held', () => {
    const runtime = create([rifle({ magazineSize: 1 })]);
    const events = tickUntil(runtime, 30, { trigger: true });
    expect(events.filter(event => event.type === 'shot')).toHaveLength(1);
    expect(events.filter(event => event.type === 'trigger-blocked')).toHaveLength(1);
    expect(ammo(runtime).magazine).toBe(0);
  });

  it('reload transfers only available reserve after exact duration and blocks firing', () => {
    const runtime = create([rifle({ magazineSize: 4, initialReserve: 2, reloadSeconds: 0.2 })]);
    tickUntil(runtime, 18, { trigger: true });
    expect(ammo(runtime).magazine).toBe(0);
    expect(runtime.step(command(19, { reload: true }), queries).map(event => event.type)).toEqual(['reload-started']);
    const during = tickUntil(runtime, 30, { trigger: true });
    expect(during.filter(event => event.type === 'shot')).toHaveLength(0);
    expect(ammo(runtime).reserve).toBe(2);
    const completion = runtime.step(command(31), queries);
    expect(completion.map(event => event.type)).toEqual(['reload-completed']);
    expect(ammo(runtime)).toEqual({ id: 'rifle', magazine: 2, reserve: 0 });
  });

  it('uses the empty reload duration only when the magazine is empty', () => {
    const runtime = create([rifle({ magazineSize: 2, reloadSeconds: 0.1, emptyReloadSeconds: 0.3 })]);
    runtime.step(command(0, { trigger: true }), queries);
    runtime.step(command(1, { reload: true }), queries);
    expect(runtime.snapshot().status).toEqual({ kind: 'reloading', untilTick: 7 });
    tickUntil(runtime, 7);
    tickUntil(runtime, 20, { trigger: true });
    expect(ammo(runtime).magazine).toBe(0);
    runtime.step(command(21, { reload: true }), queries);
    expect(runtime.snapshot().status).toEqual({ kind: 'reloading', untilTick: 39 });
  });

  it('cancels reload without ammunition transfer, including completion boundary', () => {
    const runtime = create([rifle({ reloadSeconds: 0.1 })]);
    runtime.step(command(0, { trigger: true }), queries);
    runtime.step(command(1, { reload: true }), queries);
    tickUntil(runtime, 6);
    expect(runtime.step(command(7, { cancelReload: true }), queries).map(event => event.type)).toEqual(['reload-cancelled']);
    expect(ammo(runtime)).toEqual({ id: 'rifle', magazine: 29, reserve: 180 });
  });

  it('switching cancels reload, preserves per-weapon ammo and respects equip delay', () => {
    const runtime = create([rifle(), { ...ALS_WEAPONS[1]!, equipSeconds: 0.1 }]);
    runtime.step(command(0, { trigger: true }), queries);
    runtime.step(command(1, { reload: true }), queries);
    expect(runtime.step(command(2, { selectWeaponId: 'pistol' }), queries).map(event => event.type)).toEqual(['reload-cancelled', 'switch-started']);
    expect(runtime.snapshot().status).toEqual({ kind: 'equipping', untilTick: 8 });
    expect(tickUntil(runtime, 7, { trigger: true }).filter(event => event.type === 'shot')).toHaveLength(0);
    expect(runtime.step(command(8, { trigger: true }), queries).map(event => event.type)).toEqual(['switch-completed']);
    runtime.step(command(9), queries);
    expect(runtime.step(command(10, { trigger: true }), queries).filter(event => event.type === 'shot')).toHaveLength(1);
    expect(ammo(runtime, 'rifle').magazine).toBe(29);
    expect(ammo(runtime, 'pistol').magazine).toBe(11);
  });
});

describe('fair geometry queries and shot authority', () => {
  it('converges muzzle toward camera aimpoint, then hits the wall blocking the muzzle', () => {
    const calls: Parameters<WeaponQueries['castRay']>[0][] = [];
    const adapter: WeaponQueries = {
      ...queries,
      castRay(query) {
        calls.push(query);
        return calls.length === 1 ? hit({ x: 0, y: 0, z: -100 }, 100, 'enemy') : hit({ x: 0.99, y: 0, z: -1 }, 1.01);
      },
    };
    const events = create().step(command(0, { trigger: true, muzzle: { x: 1, y: 0, z: 0 }, excludedColliderIds: ['self-capsule'] }), adapter);
    expect(calls).toHaveLength(2);
    expect(calls.every(query => query.ownerId === 'player' && query.solid && query.excludedColliderIds.includes('self-capsule'))).toBe(true);
    expect(calls[1]!.direction.x).toBeLessThan(0);
    expect(events.filter(event => event.type === 'damage')).toHaveLength(0);
    expect(events.find(event => event.type === 'impact')?.hit.colliderId).toBe('wall');
    expect(events.find(event => event.type === 'shot')?.end.z).toBe(-1);
  });

  it('solid muzzle overlap is an immediate obstruction even when camera sees a target', () => {
    let calls = 0;
    const events = create().step(command(0, { trigger: true }), { ...queries, castRay: () => ++calls === 1 ? hit({ x: 0, y: 0, z: -10 }, 10, 'enemy') : hit(zero, 0) });
    expect(events.find(event => event.type === 'impact')?.hit.distance).toBe(0);
    expect(events.some(event => event.type === 'damage')).toBe(false);
  });

  it.each(['hitscan', 'projectile'])('cannot fire %s from a barrel pushed through a nearby wall', kind => {
    const runtime = create([kind === 'hitscan' ? rifle() : bow()]);
    const castRay = vi.fn(() => hit({ x: 0, y: 0, z: -0.25 }, 0.25));
    const sweepSphere = vi.fn(() => null);
    const events = runtime.step(command(0, { trigger: true, muzzle: { x: 0, y: 0, z: -0.5 } }), { castRay, sweepSphere });
    expect(castRay).toHaveBeenCalledTimes(1);
    expect(sweepSphere).toHaveBeenCalledTimes(0);
    expect(events.find(event => event.type === 'impact')?.hit.point.z).toBe(-0.25);
    expect(runtime.snapshot().projectiles).toHaveLength(0);
  });

  it('emits damage only for the authoritative muzzle hit, with owner and target identities', () => {
    const events = create().step(command(0, { trigger: true }), { ...queries, castRay: () => hit({ x: 0, y: 0, z: -10 }, 10, 'enemy') });
    expect(events.find(event => event.type === 'damage')).toMatchObject({ ownerId: 'player', targetId: 'enemy', weaponId: 'rifle', amount: 24, direction: forward });
  });

  it('allows float32 endpoint tolerance on the second ray without increasing hard range', () => {
    let calls = 0;
    const runtime = create([rifle({ range: 20 })]);
    const events = runtime.step(command(0, { trigger: true }), { ...queries, castRay(query) {
      calls++;
      if (calls === 1) return hit({ x: 0, y: 0, z: -10 }, 10, 'enemy');
      return query.maxDistance >= 10.0001 ? hit({ x: 0, y: 0, z: -10.0001 }, 10.0001, 'enemy') : null;
    } });
    expect(events.find(event => event.type === 'damage')?.targetId).toBe('enemy');
    const distances: number[] = [];
    create([rifle({ range: 10 })]).step(command(0, { trigger: true }), { ...queries, castRay(query) { distances.push(query.maxDistance); return hit({ x: 0, y: 0, z: -10 }, 10); } });
    expect(distances).toEqual([10, 10]);
  });

  it.each(['owner', 'target', 'collider'])('fails closed if adapter returns an excluded %s', exclusion => {
    const bad = { ...hit({ x: 0, y: 0, z: -1 }, 1, exclusion === 'target' ? 'player' : 'enemy'), ownerId: exclusion === 'owner' ? 'player' : 'other', colliderId: exclusion === 'collider' ? 'self' : 'other' };
    const runtime = create();
    const events = runtime.step(command(0, { trigger: true, excludedColliderIds: ['self'] }), { ...queries, castRay: () => bad });
    expect(events).toEqual([{ tick: 0, ownerId: 'player', weaponId: 'rifle', type: 'query-rejected', reason: 'excluded-hit', query: 'aim' }]);
    expect(ammo(runtime).magazine).toBe(30);
  });

  it('rejects invalid hits instead of creating nonfinite shot data', () => {
    const runtime = create();
    const events = runtime.step(command(0, { trigger: true }), { ...queries, castRay: () => hit({ x: NaN, y: 0, z: 0 }, 1) });
    expect(events[0]).toMatchObject({ type: 'query-rejected', reason: 'invalid-hit' });
    expect(ammo(runtime).magazine).toBe(30);
  });
});

describe('swept ballistic projectiles', () => {
  it('sweeps fast projectiles through thin targets and excludes owned colliders on every query', () => {
    const runtime = create([bow({ ballistics: { kind: 'projectile', speed: 6000, gravity: zero, radius: 0.02, lifetimeSeconds: 2 } })]);
    const adapter: WeaponQueries = { ...queries, sweepSphere(query) {
      expect(query.ownerId).toBe('player');
      expect(query.excludedColliderIds).toEqual(['self']);
      expect(query.radius).toBe(0.02);
      return query.from.z > -3 && query.to.z <= -3 ? hit({ x: 0, y: 0, z: -3 }, 3 + query.from.z, 'enemy') : null;
    } };
    const shotEvents = runtime.step(command(0, { trigger: true, excludedColliderIds: ['self'] }), adapter);
    expect(shotEvents.some(event => event.type === 'shot')).toBe(true);
    expect(runtime.snapshot().projectiles).toHaveLength(1);
    const impactEvents = runtime.step(command(1), adapter);
    expect(impactEvents.find(event => event.type === 'damage')).toMatchObject({ targetId: 'enemy', amount: 80, ownerId: 'player' });
    expect(runtime.snapshot().projectiles).toHaveLength(0);
  });

  it('applies gravity over fixed steps and continues flight when switching weapons', () => {
    const runtime = create([bow({ range: 1000 }), rifle()]);
    runtime.step(command(0, { trigger: true }), queries);
    runtime.step(command(1, { selectWeaponId: 'rifle' }), queries);
    tickUntil(runtime, 60);
    const projectile = runtime.snapshot().projectiles[0]!;
    expect(projectile.position.z).toBeCloseTo(-55, 8);
    expect(projectile.position.y).toBeCloseTo(-4.905, 8);
    expect(projectile.velocity.y).toBeCloseTo(-9.81, 8);
    expect(projectile.ageSeconds).toBeCloseTo(1, 8);
  });

  it('stops exactly at range and does not hit a target beyond that range', () => {
    const runtime = create([bow({ range: 1, ballistics: { kind: 'projectile', speed: 600, gravity: zero, radius: 0.01, lifetimeSeconds: 3 } })]);
    const to: Vec3[] = [];
    const adapter = { ...queries, sweepSphere(query: Parameters<WeaponQueries['sweepSphere']>[0]) { to.push(query.to); return null; } };
    runtime.step(command(0, { trigger: true }), adapter);
    const events = runtime.step(command(1), adapter);
    expect(events).toContainEqual({ tick: 1, ownerId: 'player', weaponId: 'bow', type: 'projectile-expired', projectileId: 'player:projectile:0', reason: 'range' });
    expect(to.at(-1)!.z).toBeCloseTo(-1);
    expect(runtime.snapshot().projectiles).toHaveLength(0);
  });

  it('expires by lifetime including a partial last substep', () => {
    const runtime = create([bow({ ballistics: { kind: 'projectile', speed: 1, gravity: zero, radius: 0.01, lifetimeSeconds: 0.025 } })]);
    runtime.step(command(0, { trigger: true }), queries);
    runtime.step(command(1), queries);
    expect(runtime.step(command(2), queries)).toContainEqual({ tick: 2, ownerId: 'player', weaponId: 'bow', type: 'projectile-expired', projectileId: 'player:projectile:0', reason: 'lifetime' });
    expect(runtime.snapshot().projectiles).toHaveLength(0);
  });

  it('blocks spawning beyond the pool limit without consuming ammo and bounds query work', () => {
    const runtime = createWeaponRuntime({ ownerId: 'player', seed: 7, definitions: [bow({ magazineSize: 5, fireMode: 'auto', roundsPerSecond: 60 })], limits: { maxProjectiles: 2, projectileSubsteps: 3 } });
    const sweepSphere = vi.fn(() => null);
    const adapter = { ...queries, sweepSphere };
    runtime.step(command(0, { trigger: true }), adapter);
    runtime.step(command(1, { trigger: true }), adapter);
    sweepSphere.mockClear();
    const events = runtime.step(command(2, { trigger: true }), adapter);
    expect(events).toContainEqual({ tick: 2, ownerId: 'player', weaponId: 'bow', type: 'trigger-blocked', reason: 'projectile-limit' });
    expect(ammo(runtime).magazine).toBe(3);
    expect(runtime.snapshot().projectiles).toHaveLength(2);
    expect(sweepSphere).toHaveBeenCalledTimes(6);
  });

  it('uses a swept sphere for barrel obstruction before spawning an arrow', () => {
    const runtime = create([bow()]);
    const events = runtime.step(command(0, { trigger: true }), { ...queries, sweepSphere: () => hit(zero, 0) });
    expect(events.map(event => event.type)).toEqual(['shot', 'impact']);
    expect(runtime.snapshot().projectiles).toHaveLength(0);
    expect(ammo(runtime).magazine).toBe(0);
  });
});

describe('determinism, ownership and validation', () => {
  it('same seed and commands produce identical complete streams including spread/recoil', () => {
    const first = create([ALS_WEAPONS[0]!]);
    const second = create([ALS_WEAPONS[0]!]);
    const firstEvents = tickUntil(first, 100, { trigger: true });
    expect(tickUntil(second, 100, { trigger: true })).toEqual(firstEvents);
    expect(first.snapshot()).toEqual(second.snapshot());
    second.reset();
    expect(tickUntil(second, 100, { trigger: true })).toEqual(firstEvents);
    second.reset(1);
    expect(tickUntil(second, 100, { trigger: true })).not.toEqual(firstEvents);
  });

  it('owns definitions and snapshots without retaining caller-mutable numeric state', () => {
    const definition = rifle();
    const runtime = create([definition]);
    Object.assign(definition, { damage: 999, magazineSize: 999 });
    Object.assign(runtime.snapshot().weapons[0]!, { magazine: 999 });
    const events = runtime.step(command(0, { trigger: true }), { ...queries, castRay: () => hit({ x: 0, y: 0, z: -1 }, 1, 'enemy') });
    expect(events.find(event => event.type === 'damage')?.amount).toBe(24);
    expect(ammo(runtime).magazine).toBe(29);
  });

  it.each([
    { tick: 1 }, { trigger: 'yes' }, { selectWeaponId: 'missing' },
    { muzzle: { x: NaN, y: 0, z: 0 } }, { aim: { origin: zero, direction: zero } },
  ])('rejects invalid commands before mutating state (%j)', patch => {
    const runtime = create();
    const before = runtime.snapshot();
    expect(() => runtime.step(command(0, patch as Partial<WeaponCommand>), queries)).toThrow();
    expect(runtime.snapshot()).toEqual(before);
  });

  it.each([
    { roundsPerSecond: 61 }, { magazineSize: 0 }, { initialReserve: -1 }, { range: Infinity },
    { spreadRadians: NaN }, { reloadSeconds: 0 }, { fireMode: 'unknown' },
  ])('rejects invalid definitions (%j)', patch => {
    expect(() => create([rifle(patch as Partial<WeaponDefinition>)])).toThrow();
  });

  it('reset clears active projectiles and restores ammo; dispose is terminal', () => {
    const runtime = create([bow()]);
    runtime.step(command(0, { trigger: true }), queries);
    expect(runtime.snapshot().projectiles).toHaveLength(1);
    runtime.reset();
    expect(runtime.snapshot()).toMatchObject({ nextTick: 0, equippedWeaponId: 'bow', projectiles: [], weapons: [{ id: 'bow', magazine: 1, reserve: 30 }] });
    runtime.dispose();
    expect(() => runtime.step(command(0), queries)).toThrow('disposed');
    expect(() => runtime.reset()).toThrow('disposed');
  });
});
