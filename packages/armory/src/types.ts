/** Metres, seconds, radians; coordinates use the host simulation's world basis. */
export interface Vec3 { readonly x: number; readonly y: number; readonly z: number }

export interface WeaponDefinition {
  readonly id: string;
  readonly label: string;
  readonly fireMode: 'semi' | 'auto' | 'burst';
  readonly roundsPerSecond: number;
  readonly burstSize?: number;
  readonly magazineSize: number;
  readonly initialReserve: number;
  readonly reloadSeconds: number;
  readonly equipSeconds: number;
  readonly damage: number;
  readonly range: number;
  /** Half-angle of the uniform solid-angle spread cone, in radians. */
  readonly spreadRadians: number;
  readonly recoil: { readonly pitchMin: number; readonly pitchMax: number; readonly yawMax: number };
  /** A learnable spray: shot n of a string kicks by kicks[n] (radians, pitch up and yaw right), holding the
   * last entry past the end. The string restarts after resetSeconds without a shot. Replaces the random recoil. */
  readonly pattern?: { readonly kicks: readonly { readonly pitch: number; readonly yaw: number }[]; readonly resetSeconds: number; readonly jitter?: number };
  /** Half-angle cone by stance, in radians. Replaces spreadRadians when set. Bloom grows per shot and
   * recovers linearly from bloomMax to zero over recoverySeconds. crouch multiplies the stance cone. */
  readonly spread?: {
    readonly hip: number; readonly aim: number; readonly move: number; readonly crouch?: number;
    readonly bloomPerShot: number; readonly bloomMax: number; readonly recoverySeconds: number;
  };
  readonly ballistics:
    | { readonly kind: 'hitscan' }
    | {
        readonly kind: 'projectile';
        readonly speed: number;
        readonly gravity: Vec3;
        readonly radius: number;
        readonly lifetimeSeconds: number;
      };
}

export interface WeaponCommand {
  /** Starts at zero, advances exactly once per fixed step. Never a render-frame counter. */
  readonly tick: number;
  readonly trigger: boolean;
  readonly reload?: boolean;
  readonly cancelReload?: boolean;
  readonly selectWeaponId?: string;
  readonly aim: { readonly origin: Vec3; readonly direction: Vec3 };
  readonly muzzle: Vec3;
  /** The owner ID is always excluded, plus these host-physics collider IDs. */
  readonly excludedColliderIds?: readonly string[];
  /** Stance for definitions with spread: aiming down sights, movement 0..1 of full speed, crouched. */
  readonly stance?: { readonly aiming?: boolean; readonly moving?: number; readonly crouched?: boolean };
}

export interface QueryFilter {
  readonly ownerId: string;
  readonly excludedColliderIds: readonly string[];
}

export interface RayQuery extends QueryFilter {
  readonly origin: Vec3;
  readonly direction: Vec3;
  readonly maxDistance: number;
  /** An origin inside solid geometry must return an immediate obstruction. */
  readonly solid: true;
}

export interface SphereSweepQuery extends QueryFilter {
  readonly from: Vec3;
  readonly to: Vec3;
  readonly radius: number;
  readonly solid: true;
}

export interface QueryHit {
  readonly colliderId: string;
  readonly targetId?: string;
  readonly ownerId?: string;
  readonly point: Vec3;
  readonly normal: Vec3;
  /** Travel distance along the ray or swept sphere centre path, not distance to the surface point. */
  readonly distance: number;
}

/** Queries return the nearest eligible collision. Exclude the owner and supplied collider IDs
 * before finding that collision. Query callbacks must be synchronous and deterministic.
 * Throwing aborts the caller's tick; the host should treat that as an authority failure. */
export interface WeaponQueries {
  castRay(query: RayQuery): QueryHit | null;
  sweepSphere(query: SphereSweepQuery): QueryHit | null;
}

export interface ProjectileSnapshot {
  readonly id: string;
  readonly weaponId: string;
  readonly ownerId: string;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly radius: number;
  readonly ageSeconds: number;
  readonly distance: number;
}

export type WeaponStatus =
  | { readonly kind: 'ready' }
  | { readonly kind: 'cooldown'; readonly untilTick: number }
  | { readonly kind: 'reloading'; readonly untilTick: number }
  | { readonly kind: 'equipping'; readonly untilTick: number };

export interface WeaponSnapshot {
  readonly tick: number;
  readonly nextTick: number;
  readonly equippedWeaponId: string;
  readonly status: WeaponStatus;
  /** Current half-angle of the equipped weapon's cone for the last stance, in radians, for a crosshair. */
  readonly spread: number;
  /** Shots in the equipped weapon's current spray string. */
  readonly patternIndex: number;
  readonly weapons: readonly {
    readonly id: string;
    readonly magazine: number;
    readonly reserve: number;
  }[];
  readonly projectiles: readonly ProjectileSnapshot[];
}

interface EventBase { readonly tick: number; readonly ownerId: string; readonly weaponId: string }
export type WeaponEvent =
  | (EventBase & {
      readonly type: 'shot'; readonly shotId: string; readonly kind: 'hitscan' | 'projectile';
      readonly origin: Vec3; readonly direction: Vec3; readonly end: Vec3;
      readonly recoil: { readonly pitch: number; readonly yaw: number };
      /** Position in the current spray string, from zero. */
      readonly patternIndex: number;
      /** Half-angle of the cone this shot was drawn from, in radians. */
      readonly spread: number;
      readonly projectileId?: string;
    })
  | (EventBase & { readonly type: 'impact'; readonly shotId: string; readonly projectileId?: string; readonly hit: QueryHit })
  | (EventBase & { readonly type: 'damage'; readonly shotId: string; readonly targetId: string; readonly amount: number; readonly point: Vec3; readonly direction: Vec3 })
  | (EventBase & { readonly type: 'reload-started' | 'reload-completed' | 'reload-cancelled' })
  | (EventBase & { readonly type: 'switch-started' | 'switch-completed'; readonly previousWeaponId: string })
  | (EventBase & { readonly type: 'trigger-blocked'; readonly reason: 'empty' | 'projectile-limit' })
  | (EventBase & { readonly type: 'projectile-expired'; readonly projectileId: string; readonly reason: 'range' | 'lifetime' })
  | (EventBase & { readonly type: 'query-rejected'; readonly reason: 'invalid-hit' | 'excluded-hit'; readonly query: 'aim' | 'muzzle' | 'projectile' });

export interface WeaponRuntimeOptions {
  readonly ownerId: string;
  readonly seed: number;
  readonly definitions: readonly WeaponDefinition[];
  readonly initialWeaponId?: string;
  readonly fixedDeltaSeconds?: number;
  readonly limits?: {
    readonly maxProjectiles?: number;
    /** Curved trajectories use fixed bounded subdivisions per simulation tick. */
    readonly projectileSubsteps?: number;
  };
}

export interface WeaponRuntime {
  readonly fixedDeltaSeconds: number;
  step(command: WeaponCommand, queries: WeaponQueries): readonly WeaponEvent[];
  snapshot(): WeaponSnapshot;
  /** Restore the initial loadout, empty projectiles, tick zero and the chosen PRNG seed. */
  reset(seed?: number): void;
  dispose(): void;
}
