import { add, clone, finiteVector, length, normalize, scale, spreadDirection, sub } from './math';
import type {
  ProjectileSnapshot, QueryHit, Vec3, WeaponCommand, WeaponDefinition, WeaponEvent,
  WeaponQueries, WeaponRuntime, WeaponRuntimeOptions, WeaponSnapshot, WeaponStatus,
} from './types';

interface Ammo { magazine: number; reserve: number; nextFireTick: number }
interface Projectile {
  id: string; shotId: string; definition: WeaponDefinition & { ballistics: { kind: 'projectile'; speed: number; gravity: Vec3; radius: number; lifetimeSeconds: number } };
  position: Vec3; velocity: Vec3; ageSeconds: number; distance: number; excludedColliderIds: readonly string[];
}
type CheckedHit = { valid: true; hit: QueryHit | null } | { valid: false };
const EPSILON = 1e-8;
const integer = (value: number, min: number, max: number): boolean => Number.isSafeInteger(value) && value >= min && value <= max;
const finite = (value: number, min: number, max: number): boolean => Number.isFinite(value) && value >= min && value <= max;
const assert = (condition: boolean, message: string): void => { if (!condition) throw new Error(`Weapon system: ${message}`); };
const copyDefinition = (definition: WeaponDefinition): WeaponDefinition => ({
  ...definition, recoil: { ...definition.recoil },
  ballistics: definition.ballistics.kind === 'hitscan'
    ? { kind: 'hitscan' }
    : { ...definition.ballistics, gravity: clone(definition.ballistics.gravity) },
});

export function createWeaponRuntime(options: WeaponRuntimeOptions): WeaponRuntime {
  const dt = options.fixedDeltaSeconds ?? 1 / 60;
  const maxProjectiles = options.limits?.maxProjectiles ?? 128;
  const substeps = options.limits?.projectileSubsteps ?? 4;
  assert(typeof options.ownerId === 'string' && options.ownerId.length > 0, 'ownerId is required');
  assert(integer(options.seed, 0, 0xffffffff), 'seed must be an unsigned 32-bit integer');
  assert(finite(dt, 1 / 1000, 0.1), 'fixedDeltaSeconds must be between 0.001 and 0.1');
  assert(integer(maxProjectiles, 1, 4096), 'maxProjectiles must be 1..4096');
  assert(integer(substeps, 1, 16), 'projectileSubsteps must be 1..16');
  assert(Array.isArray(options.definitions) && options.definitions.length > 0 && options.definitions.length <= 64, 'provide 1..64 weapon definitions');
  const definitions = new Map<string, WeaponDefinition>();
  for (const definition of options.definitions) {
    assert(typeof definition.id === 'string' && definition.id.length > 0 && !definitions.has(definition.id), 'weapon IDs must be nonempty and unique');
    assert(['auto', 'semi', 'burst'].includes(definition.fireMode), `${definition.id}: invalid fire mode`);
    assert(finite(definition.roundsPerSecond, 0.01, 1 / dt), `${definition.id}: firing rate must fit the fixed tick rate`);
    assert(definition.fireMode !== 'burst' || integer(definition.burstSize ?? 3, 2, 32), `${definition.id}: invalid burst size`);
    assert(integer(definition.magazineSize, 1, 1_000_000) && integer(definition.initialReserve, 0, 1_000_000), `${definition.id}: invalid ammunition`);
    assert(finite(definition.reloadSeconds, dt, 300) && finite(definition.emptyReloadSeconds ?? definition.reloadSeconds, dt, 300) && finite(definition.equipSeconds, 0, 30), `${definition.id}: invalid reload/equip duration`);
    assert(finite(definition.damage, 0, 1_000_000) && finite(definition.range, 0.001, 100_000), `${definition.id}: invalid damage/range`);
    assert(finite(definition.spreadRadians, 0, Math.PI / 4), `${definition.id}: invalid spread angle`);
    assert(!!definition.recoil && finite(definition.recoil.pitchMin, 0, Math.PI / 2) && finite(definition.recoil.pitchMax, definition.recoil.pitchMin, Math.PI / 2) && finite(definition.recoil.yawMax, 0, Math.PI / 2), `${definition.id}: invalid recoil`);
    assert(!!definition.ballistics && ['hitscan', 'projectile'].includes(definition.ballistics.kind), `${definition.id}: invalid ballistics`);
    if (definition.ballistics.kind === 'projectile') {
      const ballistic = definition.ballistics;
      assert(finite(ballistic.speed, 0.001, 100_000) && finite(ballistic.radius, 0.0001, 100) && finite(ballistic.lifetimeSeconds, dt / substeps, 300), `${definition.id}: invalid projectile bounds`);
      assert(finiteVector(ballistic.gravity) && length(ballistic.gravity) <= 10_000, `${definition.id}: invalid gravity`);
    }
    definitions.set(definition.id, copyDefinition(definition));
  }
  const ownerId = options.ownerId;
  const firstWeapon = options.initialWeaponId ?? options.definitions[0]!.id;
  assert(definitions.has(firstWeapon), 'initial weapon does not exist');
  let initialSeed = options.seed;
  let rng = 0;
  let nextTick = 0;
  let currentWeapon = firstWeapon;
  let reloadUntil: number | null = null;
  let equip: { untilTick: number; previousWeaponId: string } | null = null;
  let previousTrigger = false;
  let previousReload = false;
  let burstRemaining = 0;
  let shotSequence = 0;
  let blockedReason: string | null = null;
  let disposed = false;
  const ammunition = new Map<string, Ammo>();
  let projectiles: Projectile[] = [];

  function initialize(seed: number): void {
    assert(integer(seed, 0, 0xffffffff), 'seed must be an unsigned 32-bit integer');
    initialSeed = seed;
    rng = seed;
    nextTick = 0;
    currentWeapon = firstWeapon;
    reloadUntil = null;
    equip = null;
    previousTrigger = false;
    previousReload = false;
    burstRemaining = 0;
    shotSequence = 0;
    blockedReason = null;
    projectiles = [];
    ammunition.clear();
    for (const definition of definitions.values()) ammunition.set(definition.id, {
      magazine: definition.magazineSize, reserve: definition.initialReserve, nextFireTick: 0,
    });
  }

  // Mulberry32 has a useful zero seed, unlike uncorrected xorshift32.
  function random(): number {
    rng = (rng + 0x6d2b79f5) >>> 0;
    let value = rng;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  function snapshot(): WeaponSnapshot {
    const nextFireTick = ammunition.get(currentWeapon)!.nextFireTick;
    const status: WeaponStatus = equip ? { kind: 'equipping', untilTick: equip.untilTick }
      : reloadUntil !== null ? { kind: 'reloading', untilTick: reloadUntil }
      : nextTick < nextFireTick - EPSILON ? { kind: 'cooldown', untilTick: Math.ceil(nextFireTick - EPSILON) }
      : { kind: 'ready' };
    return {
      tick: nextTick - 1, nextTick, equippedWeaponId: currentWeapon, status,
      weapons: [...ammunition].map(([id, ammo]) => ({ id, magazine: ammo.magazine, reserve: ammo.reserve })),
      projectiles: projectiles.map((projectile): ProjectileSnapshot => ({
        id: projectile.id, weaponId: projectile.definition.id, ownerId,
        position: clone(projectile.position), velocity: clone(projectile.velocity),
        radius: projectile.definition.ballistics.radius, ageSeconds: projectile.ageSeconds, distance: projectile.distance,
      })),
    };
  }

  function step(command: WeaponCommand, queries: WeaponQueries): readonly WeaponEvent[] {
    assert(!disposed, 'runtime is disposed');
    assert(integer(command.tick, 0, Number.MAX_SAFE_INTEGER - 100_000) && command.tick === nextTick, `expected tick ${nextTick}, received ${command.tick}`);
    assert(typeof command.trigger === 'boolean', 'trigger must be a boolean');
    assert(command.reload === undefined || typeof command.reload === 'boolean', 'reload must be a boolean');
    assert(command.cancelReload === undefined || typeof command.cancelReload === 'boolean', 'cancelReload must be a boolean');
    assert(command.selectWeaponId === undefined || definitions.has(command.selectWeaponId), 'unknown selected weapon');
    assert(!!command.aim && finiteVector(command.aim.origin) && finiteVector(command.aim.direction) && finiteVector(command.muzzle), 'aim and muzzle must be finite vectors');
    assert(length(command.aim.direction) > EPSILON && length(command.aim.direction) < 1e9 && length(command.aim.origin) < 1e9 && length(command.muzzle) < 1e9, 'invalid aim/muzzle magnitude');
    assert(command.excludedColliderIds === undefined || (Array.isArray(command.excludedColliderIds) && command.excludedColliderIds.length <= 1024 && command.excludedColliderIds.every(id => typeof id === 'string' && id.length > 0)), 'invalid collider exclusions');
    assert(!!queries && typeof queries.castRay === 'function' && typeof queries.sweepSphere === 'function', 'provide ray and sphere-sweep queries');

    const tick = command.tick;
    const events: WeaponEvent[] = [];
    const exclusions = [...(command.excludedColliderIds ?? [])];
    const base = (weaponId = currentWeapon) => ({ tick, ownerId, weaponId });
    const checkedHit = (hit: QueryHit | null, maximumDistance: number, excluded: readonly string[], query: 'aim' | 'muzzle' | 'projectile', weaponId: string): CheckedHit => {
      if (hit === null) return { valid: true, hit: null };
      if (!hit || typeof hit.colliderId !== 'string' || !hit.colliderId || !finiteVector(hit.point) || !finiteVector(hit.normal) || !finite(hit.distance, 0, maximumDistance + 1e-5) || (hit.targetId !== undefined && (typeof hit.targetId !== 'string' || !hit.targetId))) {
        events.push({ ...base(weaponId), type: 'query-rejected', reason: 'invalid-hit', query });
        return { valid: false };
      }
      if (hit.ownerId === ownerId || hit.targetId === ownerId || excluded.includes(hit.colliderId)) {
        events.push({ ...base(weaponId), type: 'query-rejected', reason: 'excluded-hit', query });
        return { valid: false };
      }
      return { valid: true, hit: { ...hit, point: clone(hit.point), normal: clone(hit.normal) } };
    };
    const impact = (definition: WeaponDefinition, shotId: string, hit: QueryHit, direction: Vec3, projectileId?: string) => {
      events.push({ ...base(definition.id), type: 'impact', shotId, hit, ...(projectileId ? { projectileId } : {}) });
      if (hit.targetId !== undefined && definition.damage > 0) events.push({
        ...base(definition.id), type: 'damage', shotId, targetId: hit.targetId, amount: definition.damage,
        point: clone(hit.point), direction: clone(direction),
      });
    };

    // Existing projectiles advance independently of reloading, switching, or trigger state.
    // New projectiles remain at their muzzle for this tick's render snapshot.
    const survivors: Projectile[] = [];
    for (const projectile of projectiles) {
      const definition = projectile.definition;
      const ballistic = definition.ballistics;
      let alive = true;
      for (let index = 0; index < substeps && alive; index++) {
        const remainingLife = ballistic.lifetimeSeconds - projectile.ageSeconds;
        const remainingRange = definition.range - projectile.distance;
        if (remainingLife <= EPSILON || remainingRange <= EPSILON) {
          events.push({ ...base(definition.id), type: 'projectile-expired', projectileId: projectile.id, reason: remainingLife <= EPSILON ? 'lifetime' : 'range' });
          alive = false;
          break;
        }
        const duration = Math.min(dt / substeps, remainingLife);
        const displacement = add(scale(projectile.velocity, duration), scale(ballistic.gravity, 0.5 * duration * duration));
        const fullDistance = length(displacement);
        const fraction = fullDistance > remainingRange ? remainingRange / fullDistance : 1;
        const displacementClipped = scale(displacement, fraction);
        const distance = length(displacementClipped);
        const destination = add(projectile.position, displacementClipped);
        const result = checkedHit(queries.sweepSphere({
          ownerId, excludedColliderIds: projectile.excludedColliderIds, from: clone(projectile.position), to: destination, radius: ballistic.radius, solid: true,
        }), distance, projectile.excludedColliderIds, 'projectile', definition.id);
        if (!result.valid) { alive = false; break; }
        if (result.hit) {
          impact(definition, projectile.shotId, result.hit, distance > EPSILON ? normalize(displacementClipped) : length(projectile.velocity) > EPSILON ? normalize(projectile.velocity) : { x: 0, y: -1, z: 0 }, projectile.id);
          alive = false;
          break;
        }
        projectile.position = destination;
        projectile.velocity = add(projectile.velocity, scale(ballistic.gravity, duration * fraction));
        projectile.ageSeconds += duration * fraction;
        projectile.distance += distance;
        if (fraction < 1 || projectile.distance >= definition.range - EPSILON || projectile.ageSeconds >= ballistic.lifetimeSeconds - EPSILON) {
          events.push({ ...base(definition.id), type: 'projectile-expired', projectileId: projectile.id, reason: projectile.ageSeconds >= ballistic.lifetimeSeconds - EPSILON ? 'lifetime' : 'range' });
          alive = false;
        }
      }
      if (alive) survivors.push(projectile);
    }
    projectiles = survivors;

    const cancelReload = () => {
      if (reloadUntil !== null) {
        events.push({ ...base(), type: 'reload-cancelled' });
        reloadUntil = null;
      }
    };
    const selecting = command.selectWeaponId !== undefined && command.selectWeaponId !== currentWeapon;
    // Explicit cancellation and switching win on the reload-completion boundary.
    if (command.cancelReload || selecting) cancelReload();
    if (selecting) {
      const previousWeaponId = currentWeapon;
      currentWeapon = command.selectWeaponId!;
      equip = { previousWeaponId, untilTick: tick + Math.ceil(definitions.get(currentWeapon)!.equipSeconds / dt - EPSILON) };
      burstRemaining = 0;
      blockedReason = null;
      events.push({ ...base(), type: 'switch-started', previousWeaponId });
    }
    if (equip && tick >= equip.untilTick) {
      events.push({ ...base(), type: 'switch-completed', previousWeaponId: equip.previousWeaponId });
      equip = null;
    }
    const definition = definitions.get(currentWeapon)!;
    const ammo = ammunition.get(currentWeapon)!;
    if (reloadUntil !== null && tick >= reloadUntil) {
      const transferred = Math.min(definition.magazineSize - ammo.magazine, ammo.reserve);
      ammo.magazine += transferred;
      ammo.reserve -= transferred;
      reloadUntil = null;
      blockedReason = null;
      events.push({ ...base(), type: 'reload-completed' });
    }
    if (command.reload && !previousReload && !command.cancelReload && !equip && reloadUntil === null && ammo.magazine < definition.magazineSize && ammo.reserve > 0) {
      reloadUntil = tick + Math.ceil((ammo.magazine <= 0 ? definition.emptyReloadSeconds ?? definition.reloadSeconds : definition.reloadSeconds) / dt - EPSILON);
      burstRemaining = 0;
      events.push({ ...base(), type: 'reload-started' });
    }

    const pressed = command.trigger && !previousTrigger;
    if (!command.trigger) blockedReason = null;
    const canFire = !equip && reloadUntil === null && tick + EPSILON >= ammo.nextFireTick;
    if (definition.fireMode === 'burst' && pressed && canFire && burstRemaining === 0) burstRemaining = definition.burstSize ?? 3;
    const wantsFire = definition.fireMode === 'auto' ? command.trigger : definition.fireMode === 'burst' ? burstRemaining > 0 : pressed;
    if (canFire && wantsFire) {
      const reason = ammo.magazine <= 0 ? 'empty' : definition.ballistics.kind === 'projectile' && projectiles.length >= maxProjectiles ? 'projectile-limit' : null;
      if (reason) {
        if (blockedReason !== reason) events.push({ ...base(), type: 'trigger-blocked', reason });
        blockedReason = reason;
        burstRemaining = 0;
      } else {
        const direction = spreadDirection(command.aim.direction, definition.spreadRadians, random(), random());
        const aimResult = checkedHit(queries.castRay({ ownerId, excludedColliderIds: exclusions, origin: clone(command.aim.origin), direction, maxDistance: definition.range, solid: true }), definition.range, exclusions, 'aim', currentWeapon);
        if (aimResult.valid) {
          const aimPoint = aimResult.hit?.point ?? add(command.aim.origin, scale(direction, definition.range));
          const delta = sub(aimPoint, command.muzzle);
          // If the camera is behind cover nearer than the muzzle, never turn the gun backwards.
          const forwardDistance = delta.x * direction.x + delta.y * direction.y + delta.z * direction.z;
          const muzzleDirection = length(delta) > EPSILON && forwardDistance > EPSILON ? normalize(delta) : direction;
          const shotRange = forwardDistance > EPSILON ? Math.min(definition.range, length(delta)) : definition.range;
          // Camera and muzzle casts use different origins. Rapier's float32 surface point
          // can land microscopically before the same surface on the second cast. Continue
          // 5 mm beyond the aim point, while still respecting the weapon's hard range.
          const muzzleCastRange = Math.min(definition.range, shotRange + (aimResult.hit ? 0.005 : 0));
          const shotId = `${ownerId}:shot:${shotSequence}`;
          const projectileId = definition.ballistics.kind === 'projectile' ? `${ownerId}:projectile:${shotSequence}` : undefined;
          // A barrel already pushed through the camera's obstruction must not fire from
          // its far side. The obstruction wins, including for a newly spawned projectile.
          const muzzleResult: CheckedHit = aimResult.hit && forwardDistance <= EPSILON
            ? { valid: true, hit: aimResult.hit }
            : definition.ballistics.kind === 'hitscan'
            ? checkedHit(queries.castRay({ ownerId, excludedColliderIds: exclusions, origin: clone(command.muzzle), direction: muzzleDirection, maxDistance: muzzleCastRange, solid: true }), muzzleCastRange, exclusions, 'muzzle', currentWeapon)
            : checkedHit(queries.sweepSphere({ ownerId, excludedColliderIds: exclusions, from: clone(command.muzzle), to: add(command.muzzle, scale(muzzleDirection, Math.min(0.05, definition.range))), radius: definition.ballistics.radius, solid: true }), Math.min(0.05, definition.range), exclusions, 'muzzle', currentWeapon);
          if (muzzleResult.valid) {
            ammo.magazine--;
            const period = 1 / (definition.roundsPerSecond * dt);
            // Preserve fractional cadence while continuously firing, but never catch up missed shots.
            const continuing = definition.fireMode === 'auto' ? previousTrigger : definition.fireMode === 'burst' && !pressed;
            const firingTime = continuing && tick - ammo.nextFireTick < 1 + EPSILON ? ammo.nextFireTick : tick;
            ammo.nextFireTick = firingTime + period;
            if (definition.fireMode === 'burst') burstRemaining--;
            blockedReason = null;
            shotSequence++;
            const end = muzzleResult.hit?.point ?? add(command.muzzle, scale(muzzleDirection, shotRange));
            events.push({ ...base(), type: 'shot', shotId, kind: definition.ballistics.kind, origin: clone(command.muzzle), direction: muzzleDirection, end,
              recoil: { pitch: definition.recoil.pitchMin + random() * (definition.recoil.pitchMax - definition.recoil.pitchMin), yaw: (random() * 2 - 1) * definition.recoil.yawMax },
              ...(projectileId ? { projectileId } : {}),
            });
            if (muzzleResult.hit) impact(definition, shotId, muzzleResult.hit, muzzleDirection, projectileId);
            else if (definition.ballistics.kind === 'projectile') projectiles.push({
              id: projectileId!, shotId, definition: definition as Projectile['definition'],
              position: clone(command.muzzle), velocity: scale(muzzleDirection, definition.ballistics.speed),
              ageSeconds: 0, distance: 0, excludedColliderIds: exclusions,
            });
          }
        }
      }
    }
    previousTrigger = command.trigger;
    previousReload = !!command.reload;
    nextTick++;
    return events;
  }

  initialize(initialSeed);
  return {
    fixedDeltaSeconds: dt, step, snapshot,
    reset(seed = initialSeed) { assert(!disposed, 'runtime is disposed'); initialize(seed); },
    dispose() { projectiles = []; disposed = true; },
  };
}
