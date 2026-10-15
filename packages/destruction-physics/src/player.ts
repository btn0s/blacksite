import type RAPIER from '@dimforge/rapier3d-compat';
import {
  FIXED_DT,
  clamp,
  type PlayerInput,
  type PlayerState,
  type Vec3,
} from '../../destruction-domain/src/index';

type V = { x: number; y: number; z: number };
const IDENTITY = { w: 1, x: 0, y: 0, z: 0 };
const RADIUS = 0.29;
const STANDING_HEIGHT = 1.78;
const CROUCH_HEIGHT = 1.08;
const OFFSET = 0.03;
const safe = (n: number, limit: number) => (Number.isFinite(n) ? clamp(n, -limit, limit) : 0);
const zeroInput = (): PlayerInput => ({
  crouch: false,
  forward: 0,
  jump: false,
  right: 0,
  sprint: false,
  yaw: 0,
});
const vector = (p: Vec3): V => ({ x: p[0], y: p[1], z: p[2] });
const tuple = (p: V): Vec3 => [p.x, p.y, p.z];
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const rotate = (q: RAPIER.Rotation, p: V): V => {
  const tx = 2 * (q.y * p.z - q.z * p.y),
    ty = 2 * (q.z * p.x - q.x * p.z),
    tz = 2 * (q.x * p.y - q.y * p.x);
  return {
    x: p.x + q.w * tx + q.y * tz - q.z * ty,
    y: p.y + q.w * ty + q.z * tx - q.x * tz,
    z: p.z + q.w * tz + q.x * ty - q.y * tx,
  };
};

export class PhysicsPlayer {
  private input = zeroInput();
  private query?: {
    capsule: RAPIER.Collider;
    controller: RAPIER.KinematicCharacterController;
    world: RAPIER.World;
  };
  private readonly mirrors = new Map<
    number,
    {
      collider: RAPIER.Collider;
      position: V;
      rotation: RAPIER.Rotation;
      shape: RAPIER.Shape;
      source: RAPIER.Collider;
    }
  >();
  private readonly sources = new Map<number, RAPIER.Collider>();
  private feet: V;
  private velocity: V = { x: 0, y: 0, z: 0 };
  private enabled = false;
  private grounded = false;
  private crouched = false;
  private jumpHeld = false;
  private respawns = 0;
  private trappedTicks = 0;
  private stalledTicks = 0;
  private support?: {
    collider: RAPIER.Collider;
    localPoint: V;
    worldPoint: V;
  };

  constructor(
    private readonly world: RAPIER.World,
    private readonly spawn: Vec3,
    private readonly dt = FIXED_DT,
    /** The Rapier build that owns `world`; shapes and descriptors must come from it. */
    private readonly R: typeof RAPIER,
  ) {
    this.feet = vector(spawn);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.clearInput();
    if (enabled) {
      this.ensureQueryWorld();
    }
  }

  dispose(): void {
    this.query?.world.free();
    this.query = undefined;
    this.mirrors.clear();
    this.sources.clear();
  }

  setInput(input: PlayerInput): void {
    this.input = {
      crouch: input?.crouch === true,
      forward: safe(input?.forward, 1),
      jump: input?.jump === true,
      right: safe(input?.right, 1),
      sprint: input?.sprint === true,
      yaw: safe(input?.yaw, Math.PI * 1e6) % (Math.PI * 2),
    };
  }

  clearInput(): void {
    this.input = zeroInput();
    this.jumpHeld = false;
    this.stalledTicks = 0;
    this.velocity.x = this.velocity.z = 0;
  }

  respawn(): void {
    this.feet = vector(this.spawn);
    this.velocity = { x: 0, y: 0, z: 0 };
    this.grounded = this.crouched = false;
    this.support = undefined;
    this.trappedTicks = 0;
    this.respawns++;
    this.clearInput();
    this.query?.capsule.setShape(new this.R.Capsule(STANDING_HEIGHT / 2 - RADIUS, RADIUS));
  }

  frame(): PlayerState {
    return {
      crouched: this.crouched,
      enabled: this.enabled,
      eye: [this.feet.x, this.feet.y + (this.crouched ? 0.94 : 1.62), this.feet.z],
      grounded: this.grounded,
      position: tuple(this.feet),
      respawns: this.respawns,
      velocity: tuple(this.velocity),
    };
  }

  step(): void {
    if (!this.enabled) {
      return;
    }
    const query = this.ensureQueryWorld();
    this.synchronizeGeometry();
    const dt = this.dt;
    const wasGrounded = this.grounded;
    const previousCrouch = this.crouched;
    this.updateCrouch();
    if (previousCrouch !== this.crouched) {
      query.capsule.setShape(new this.R.Capsule(this.height() / 2 - RADIUS, RADIUS));
    }
    query.capsule.setTranslation({
      x: this.feet.x,
      y: this.feet.y + this.height() / 2,
      z: this.feet.z,
    });
    query.world.step();
    const jump = this.input.jump && !this.jumpHeld;
    this.jumpHeld = this.input.jump;
    let carry: V = { x: 0, y: 0, z: 0 };
    if (wasGrounded && this.support?.collider.isValid() && this.support.collider.isEnabled()) {
      const support = this.support;
      const p = add(
        support.collider.translation(),
        rotate(support.collider.rotation(), support.localPoint),
      );
      const delta = {
        x: p.x - support.worldPoint.x,
        y: p.y - support.worldPoint.y,
        z: p.z - support.worldPoint.z,
      };
      if (Math.hypot(delta.x, delta.y, delta.z) < 0.5 && delta.y > -0.12) {
        carry = delta;
      }
    }
    if (jump && wasGrounded && !this.crouched) {
      this.velocity.y = 5.2;
      this.grounded = false;
      carry.y = Math.max(0, carry.y);
    } else if (wasGrounded) {
      this.velocity.y = -0.6;
    }
    this.velocity.y = Math.max(-35, this.velocity.y - 14 * dt);

    const magnitude = Math.max(1, Math.hypot(this.input.forward, this.input.right));
    const forward = this.input.forward / magnitude,
      right = this.input.right / magnitude;
    const speed = this.crouched ? 1.8 : this.input.sprint ? 5.8 : 3.5;
    const sin = Math.sin(this.input.yaw),
      cos = Math.cos(this.input.yaw);
    const targetX = (right * cos - forward * sin) * speed;
    const targetZ = (-right * sin - forward * cos) * speed;
    const acceleration = (wasGrounded ? 28 : 8) * dt;
    const dx = targetX - this.velocity.x,
      dz = targetZ - this.velocity.z;
    const change = Math.min(1, acceleration / Math.max(0.0001, Math.hypot(dx, dz)));
    this.velocity.x += dx * change;
    this.velocity.z += dz * change;
    const desired = {
      x: this.velocity.x * dt + carry.x,
      y: this.velocity.y * dt + carry.y,
      z: this.velocity.z * dt + carry.z,
    };
    if (this.velocity.y > 0) {
      query.controller.disableSnapToGround();
    } else {
      query.controller.enableSnapToGround(0.32);
    }
    query.controller.computeColliderMovement(
      query.capsule,
      desired,
      this.R.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    let movement = query.controller.computedMovement();
    const horizontal = Math.hypot(desired.x, desired.z);
    const progress =
      horizontal > 0.0001 ? (movement.x * desired.x + movement.z * desired.z) / horizontal : 0;
    this.stalledTicks =
      wasGrounded && !jump && horizontal > 0.001 && progress < horizontal * 0.4
        ? this.stalledTicks + 1
        : 0;
    if (this.stalledTicks >= Math.round(0.1 / this.dt)) {
      const recovery = this.recoverLedge(desired, movement);
      if (recovery) {
        movement = recovery;
        this.stalledTicks = 0;
      }
    }
    this.feet = add(this.feet, movement);
    this.grounded = query.controller.computedGrounded() && this.velocity.y <= 0;
    if (this.grounded) {
      this.velocity.y = 0;
    } else if (this.velocity.y > 0 && movement.y < this.velocity.y * dt * 0.2) {
      this.velocity.y = 0;
    }
    this.support = undefined;
    if (this.grounded) {
      for (let i = 0; i < query.controller.numComputedCollisions(); i++) {
        const hit = query.controller.computedCollision(i);
        if (!hit?.collider || hit.normal1.y < 0.6) {
          continue;
        }
        const source = this.sources.get(hit.collider.handle);
        if (!source?.isValid()) {
          continue;
        }
        this.rememberSupport(source);
        break;
      }
      if (!this.support) {
        const floor = this.world.castRayAndGetNormal(
          new this.R.Ray(
            { x: this.feet.x, y: this.feet.y + 0.04, z: this.feet.z },
            { x: 0, y: -1, z: 0 },
          ),
          0.13,
          true,
          this.R.QueryFilterFlags.EXCLUDE_SENSORS,
        );
        if (floor && floor.normal.y > 0.6) {
          this.rememberSupport(floor.collider);
        }
      }
    }
    let trapped = false;
    const eye = this.frame().eye;
    this.world.intersectionsWithShape(
      vector(eye),
      IDENTITY,
      new this.R.Ball(0.12),
      () => {
        trapped = true;
        return false;
      },
      this.R.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    this.trappedTicks = trapped ? this.trappedTicks + 1 : 0;
    if (
      this.feet.y < -20 ||
      Math.abs(this.feet.x) > 145 ||
      Math.abs(this.feet.z) > 145 ||
      this.trappedTicks > Math.round(3 / this.dt)
    ) {
      this.respawn();
    }
  }

  private height(): number {
    return this.crouched ? CROUCH_HEIGHT : STANDING_HEIGHT;
  }

  private recoverLedge(desired: V, original: V): V | undefined {
    const query = this.ensureQueryWorld();
    const length = Math.hypot(desired.x, desired.z);
    if (length < 0.001) {
      return;
    }
    const dx = desired.x / length,
      dz = desired.z / length;
    let height: number | undefined;
    for (const ahead of [0.12, 0.25, 0.4]) {
      const hit = this.world.castRayAndGetNormal(
        new this.R.Ray(
          {
            x: this.feet.x + dx * ahead,
            y: this.feet.y + 0.4,
            z: this.feet.z + dz * ahead,
          },
          { x: 0, y: -1, z: 0 },
        ),
        0.42,
        true,
        this.R.QueryFilterFlags.EXCLUDE_SENSORS,
      );
      if (!hit || hit.normal.y < Math.SQRT1_2) {
        continue;
      }
      const rise = 0.4 - hit.timeOfImpact + OFFSET;
      if (rise > 0.005 && rise <= 0.38) {
        height = rise;
        break;
      }
    }
    if (height === undefined) {
      return;
    }
    const start = query.capsule.translation();
    query.controller.computeColliderMovement(
      query.capsule,
      { x: 0, y: height, z: 0 },
      this.R.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    const up = query.controller.computedMovement();
    if (up.y >= height * 0.98) {
      query.capsule.setTranslation(add(start, up));
      query.controller.computeColliderMovement(
        query.capsule,
        { x: desired.x, y: -0.001, z: desired.z },
        this.R.QueryFilterFlags.EXCLUDE_SENSORS,
      );
      const forward = query.controller.computedMovement();
      if (
        forward.x * dx + forward.z * dz >
        Math.max(length * 0.6, original.x * dx + original.z * dz + 0.001)
      ) {
        return add(up, forward);
      }
    }
    query.capsule.setTranslation(start);
    query.controller.computeColliderMovement(
      query.capsule,
      desired,
      this.R.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    return;
  }

  private rememberSupport(collider: RAPIER.Collider): void {
    const pose = collider.translation(),
      q = collider.rotation();
    const worldPoint = { ...this.feet };
    const relative = {
      x: worldPoint.x - pose.x,
      y: worldPoint.y - pose.y,
      z: worldPoint.z - pose.z,
    };
    this.support = {
      collider,
      localPoint: rotate({ w: q.w, x: -q.x, y: -q.y, z: -q.z }, relative),
      worldPoint,
    };
  }

  private ensureQueryWorld() {
    if (this.query) {
      return this.query;
    }
    const world = new this.R.World({ x: 0, y: 0, z: 0 });
    world.timestep = this.dt;
    const capsule = world.createCollider(
      this.R.ColliderDesc.capsule(this.height() / 2 - RADIUS, RADIUS)
        .setSensor(true)
        .setCollisionGroups(0),
    );
    const controller = world.createCharacterController(OFFSET);
    controller.setApplyImpulsesToDynamicBodies(false);
    controller.setSlideEnabled(true);
    controller.setMaxSlopeClimbAngle(Math.PI / 4);
    controller.setMinSlopeSlideAngle(Math.PI * 0.29);
    controller.enableAutostep(0.38, 0.2, true);
    controller.enableSnapToGround(0.32);
    this.query = { capsule, controller, world };
    return this.query;
  }

  private synchronizeGeometry(): void {
    const query = this.ensureQueryWorld();
    const seen = new Set<number>();
    this.world.forEachCollider((source) => {
      if (!source.isEnabled() || source.isSensor()) {
        return;
      }
      seen.add(source.handle);
      const position = source.translation(),
        rotation = source.rotation(),
        shape = source.shape;
      let mirror = this.mirrors.get(source.handle);
      if (!mirror) {
        const collider = query.world.createCollider(
          new this.R.ColliderDesc(shape)
            .setTranslation(position.x, position.y, position.z)
            .setRotation(rotation),
        );
        mirror = { collider, position, rotation, shape, source };
        this.mirrors.set(source.handle, mirror);
        this.sources.set(collider.handle, source);
      } else {
        if (mirror.shape !== shape) {
          mirror.collider.setShape(shape);
          mirror.shape = shape;
        }
        const p = mirror.position,
          q = mirror.rotation;
        if (p.x !== position.x || p.y !== position.y || p.z !== position.z) {
          mirror.collider.setTranslation(position);
          mirror.position = position;
        }
        if (q.x !== rotation.x || q.y !== rotation.y || q.z !== rotation.z || q.w !== rotation.w) {
          mirror.collider.setRotation(rotation);
          mirror.rotation = rotation;
        }
      }
    });
    for (const [handle, mirror] of this.mirrors) {
      if (seen.has(handle)) {
        continue;
      }
      this.sources.delete(mirror.collider.handle);
      query.world.removeCollider(mirror.collider, false);
      this.mirrors.delete(handle);
    }
  }

  private updateCrouch(): void {
    if (this.input.crouch === this.crouched) {
      return;
    }
    if (!this.input.crouch) {
      let blocked = false;
      this.world.intersectionsWithShape(
        {
          x: this.feet.x,
          y: this.feet.y + STANDING_HEIGHT / 2 + 0.01,
          z: this.feet.z,
        },
        IDENTITY,
        new this.R.Capsule(STANDING_HEIGHT / 2 - RADIUS, RADIUS - 0.008),
        () => {
          blocked = true;
          return false;
        },
        this.R.QueryFilterFlags.EXCLUDE_SENSORS,
      );
      if (blocked) {
        return;
      }
    }
    this.crouched = this.input.crouch;
  }
}
