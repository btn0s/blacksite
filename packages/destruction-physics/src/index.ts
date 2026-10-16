import type RAPIER from "@dimforge/rapier3d-compat";
import { flavourSuffix, loadRapier, type RapierModule } from "./engine";
import { PhysicsPlayer } from "./player";
import { CompliantConnections } from "./joints";
import { bearingPatches, bearingBond, bearingBodyValid, bearingColliderValid, clipBearingPolygon, type BearingPolygon } from "./bearing";
import { SecondaryBearingSolver } from "./bearing-secondary";
import { contactPairSolverContactCount, forEachContactManifold } from "./contact-snapshot";
import {
  crossSectionArea,
  insetCollisionGeometry,
  MIN_FRACTURE_VOLUME,
  MIN_FRACTURE_WIDTH,
} from "./fracture";
import {
  generateImpactSubgraphFracture,
  generateSecondarySubgraphFracture,
  type ImpactSubgraphFractureCommand,
  type SecondarySubgraphFractureCommand,
} from "./subgraph";
import { StructuralGraph } from "../../destruction-graph/src/index";
import {
  FIXED_DT,
  isSupportedTimestep,
  simulationVersionFor,
  restVersionSuffix,
  type RestPolicy,
  physicsOperationsVersionFor,
  BondState,
  FragmentState,
  MAX_REPLAY_COMMANDS,
  MAX_REPLAY_TICKS,
  MAX_EXPLOSIVES,
  MAX_CANNONBALLS,
  MAX_SECONDARY_FRAGMENTS,
  MAX_SECONDARY_SPLITS_PER_TICK,
  MAX_IMPACT_FRACTURES_PER_TICK,
  MAX_FRACTURE_GENERATION,
  MAX_SECONDARY_ID_SPAN,
  MAX_SECONDARY_LINEAGE,
  cannonballSpeed,
  TRANSFORM_STRIDE,
  clamp,
  validateCommand,
  validateCollisionBox,
  validateCollisionObject,
  validatePhysicsOperation,
  validCollisionId,
  MAX_COLLISION_OBJECTS,
  MAX_COLLISION_BOXES,
  MAX_PHYSICS_OPERATIONS,
  type CollisionBox,
  type CollisionObject,
  type EmitterLaunch,
  type PhysicsActionResult,
  type PhysicsOperation,
  type DestructibleManifest,
  type FragmentDef,
  type SecondaryFragmentDef,
  type SecondaryFractureFrame,
  type DestructionCommand,
  type FractureCommandBuffer,
  type DestructionEvent,
  type OrdnanceState,
  type PlayerInput,
  type PlayerTool,
  type AimPreview,
  type ReplayLog,
  type SimulationFrame,
  type Vec3,
  type BondDef,
  type WorkerRequest,
} from "../../destruction-domain/src/index";

import { StepBudget, STEP_BUDGET, type StepWork } from "./budget";

const MAX_FRAGMENTS = 10_000;
const MAX_DYNAMIC_BODIES = 4096;
const MAX_QUEUED_COMMANDS = 2048;
const MAX_COMMANDS_PER_TICK = 64;
/** The Rapier build owned worlds use; set by `create` before any world exists. */
let engine: RapierModule | undefined;
type V = { x: number; y: number; z: number };
type Q = V & { w: number };
interface Island {
  age?: number;
  debrisBorn?: number;
  /** Settled and made a fixed body: out of the contact, support and bookkeeping passes until woken. */
  baked?: boolean;
  body: RAPIER.RigidBody;
  bodyPose?: Array<number>;
  colliders: Array<RAPIER.Collider>;
  key: number;
  /** Active support graph nodes owned by this actor. */
  members: Array<number>;
  /** Shallowest intact chunks: the only chunks that own colliders. */
  visibleChunks: Array<number>;
  poses: Map<number, { position: V; rotation: Q }>;
  primaries: Map<number, RAPIER.Collider>;
  settled: boolean;
  stableTicks: number;
  restTicks?: number;
  transformState?: FragmentState;
}
interface SecondaryBody {
  debrisBorn?: number;
  attachedRoot?: number;
  /** Ticks this piece has been settled; small debris sinks once it reaches its lifetime. */
  age?: number;
  baked?: boolean;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  fragment: SecondaryFragmentDef;
  settled: boolean;
  stableTicks: number;
  restTicks?: number;
  velocity: V;
}
interface VisualRetirement {
  fragments: Array<{ fragment: SecondaryFragmentDef; position: V; rotation: Q }>;
  depth: number;
  ticks: number;
  evicted: number;
}
interface BearingProvider {
  receiver: RAPIER.Collider;
  collider: RAPIER.Collider;
  body: RAPIER.RigidBody | null;
  chunk?: number;
  child?: SecondaryBody;
  point: Vec3;
  area: number;
}
interface BearingAnchor {
  chunk: number;
  definition: Omit<BondDef, 'id'>;
  providers: BearingProvider[];
  bond?: number;
  /** Runtime slot generation; a released slot may later belong to another contact. */
  bondId?: number;
  /** Current completed static reaction on this actor, at the patch centroid, in world axes. */
  reaction?: { force: Vec3; moment: Vec3 };
}
interface BearingSupport {
  body: RAPIER.RigidBody;
  island?: Island;
  child?: SecondaryBody;
  anchors: BearingAnchor[];
  nodes: number[];
  key: string;
  pose: number[];
  radius: number;
  pending: boolean;
  /** The budget ladder reserved this admission rather than ordinary settlement. */
  budgetRequested?: boolean;
  /** Broken support awaiting dynamic capacity; never forget an unsupported fixed actor. */
  releasing?: boolean;
}
interface LiveTarget {
  child?: SecondaryBody;
  primary?: number;
}
interface ImpactRecord {
  consumed: boolean;
  root?: number;
}
interface SecondaryCandidate {
  command?: DestructionCommand;
  dose: number;
  index: number;
  seed: number;
}
interface StructuralImpulse {
  chunk: number;
  point: Vec3;
  impulse: Vec3;
}
/** Read-only native contact endpoint snapshot, owned by one contact pass. */
interface ContactEndpoint {
  body: RAPIER.RigidBody | null;
  dynamic: boolean;
  mass: number;
  position: V;
  rotation: Q;
  velocity: V;
  visible?: number;
  standalone?: SecondaryBody;
}
interface PressureImpulse extends StructuralImpulse {
  command: string;
  receiverChunk?: number;
  launchAccepted?: boolean;
  child?: SecondaryBody;
  /** Preserve source-mass caps on LOS receivers that this event leaves whole. */
  sourceMass: number;
  worldPoint: V;
  worldImpulse: V;
}
interface PressureSource {
  supported: boolean;
  affected: boolean;
  group?: { nodes: number[]; affected: boolean; split?: boolean };
}
interface PressureBurst {
  command: DestructionCommand;
  sources: Map<number, PressureSource>;
  detached: Set<number>;
}
interface PressureSample {
  command: string;
  impulse: V;
  point: V;
  radial?: boolean;
}
interface PressureReceiver {
  sourceMass: number;
  detached: boolean;
  samples: PressureSample[];
}
interface PressureFace {
  normal: V;
  area: number;
  point: V;
  samples: Array<{ point: V; area: number }>;
}
interface Motion {
  angular: V;
  velocity: V;
}
interface PressureLaunch extends Motion {
  /** Pre-pressure velocity field, shared by bodies made from this receiver this step. */
  center: V;
  speed: number;
}
interface Explosive {
  createdTick: number;
  minRadius?: number;
  fragment?: number;
  id: number;
  localPosition: V;
  localRotation: Q;
  radius: number;
  secondaryId?: number;
  source: number;
  strength: number;
}
interface Cannonball {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  createdTick: number;
  id: number;
  lastImpactTick: number;
  radius: number;
  source: number;
  velocity: V;
}
export interface DestructionSimulationOptions {
  /** Re-anchor baked actors through bearing contacts. Default true; false retains legacy baking. */
  experimentalBearingReanchor?: boolean;
  /** Fixed step in seconds: 1/60 (default) or 1/30. */
  timestep?: number;
  /** Blast pressure impulse, N·s/m² per unit command strength. */
  pressureImpulse?: number;
  rest?: Partial<RestPolicy>;
}

export interface DestructionHostPhysics {
  rapier: typeof RAPIER;
  world: RAPIER.World;
  /** Exact native impulse writeback interval when host bodies use additional solver iterations. */
  jointImpulseSampleDt?: (joint: RAPIER.ImpulseJoint) => number;
}

export interface DestructionContactForce {
  collider1(): number;
  collider2(): number;
  maxForceDirection(): Readonly<V>;
  totalForceMagnitude(): number;
}

export interface DestructionPhysicalImpact {
  colliderHandle: number;
  direction: Vec3;
  energy: number;
  impulse?: Vec3;
  position: Vec3;
  radius?: number;
  source?: number;
}

export interface DestructionCollisionGeometry {
  indices: Uint32Array;
  positions: Float32Array;
  version: number;
}

type ForwardedContact = {
  direction: V;
  first: number;
  force: number;
  second: number;
};

const ORDNANCE_SOURCE = 2_147_483_647;
const CANNONBALL_MASS = 80;
// Durations are in seconds and converted with `ticks()`, so a 30 Hz step behaves like a 60 Hz one.
const CANNONBALL_LIFETIME = 20;
const EXPLOSIVE_LIFETIME = 10 * 60;
/** Minimum time between two impact commands from one cannonball. */
const CANNONBALL_IMPACT_COOLDOWN = 0.3;
/** A pair of bodies cannot start another cascade impact for this long. */
const CASCADE_COOLDOWN = 40 / 60;
const CRUSH_CONTACT_FACTOR = 0.1;
const MAX_CRUSHED_PER_TICK = 16;
const BRISANCE_FRACTION = 0.5;
const RETAIN_MIN_MEMBERS = 8;
/** Pressure integrated over a blast pulse, per unit command strength. */
export const BLAST_PRESSURE_IMPULSE = 1000;
/** Kilograms: heavier pressure receivers get proportionally less added speed. */
const BLAST_LAUNCH_REFERENCE_MASS = 300;
const RUBBLE_MEMBERS = 4;
/**
 * Rapier's own sleep thresholds and timer are not reachable from its JS API, and one awake
 * neighbour keeps a whole pile awake anyway, so settling is the engine's own: a body slower than
 * these for this long is baked into a fixed body, a few hundred milliseconds after it stops.
 */
export const SETTLE_SECONDS = 0.4;
export const SETTLE_SPEED = 0.35;
export const SETTLE_SPIN = 0.6;
/** A body between the settle speeds and this multiple of them holds its count; faster resets it. */
const SETTLE_HOLD = 3;
/** Most bodies baked in one tick; a pile that settles together does so over a few ticks. */
const MAX_BAKES_PER_TICK = 96;
const MAX_BAKE_ATTEMPTS = 128;
/**
 * A baked body rests on what it touched below when it was baked. If one of those moves further
 * than this, or faster than the wake speeds, the baked bodies resting on it wake instead of
 * floating. At most this many wake per tick; the rest follow on the next ticks.
 */
const SUPPORT_DRIFT = 0.12;
const SUPPORT_WAKE_SPEED = 0.8;
const SUPPORT_WAKE_SPIN = 1.2;
const MAX_UNBAKES_PER_TICK = 48;
const MAX_SUPPORT_PROBES = 24;
/** A body held back from baking by an awake supporter retries after this many ticks. */
const SETTLE_RETRY_TICKS = 8;
const RUBBLE_ANGULAR_DAMPING = 2.5;
const IMPACT_CRACK_SHARE = 0.06;
/** Debris size of the second level of the hierarchy: coarser cells refine to pieces this wide. */
const SUBCELL_SIZE = 1;
/** A cell wider than this on any axis still has a finer level to refine into. */
const SUBDIVIDABLE_SIZE = SUBCELL_SIZE * 1.05;
/** A loose coarse cell striking something faster than this breaks into debris-sized pieces. */
const SUBDIVIDE_SPEED = 5;
const MAX_SUBDIVISIONS_PER_TICK = 16;
const CHIP_RELEASE_VOLUME = 0.004;
const DEBRIS_ANGULAR_DAMPING = 3;
const DEBRIS_VOLUME = 0.01;
const ROOT_RETIRE_FRACTION = 0.1;
const SECTION_INSET = 0.1;
const MAX_IMPACT_SPEED = 12;
const MAX_SPALL_SPEED = 8;
const MAX_SPALL_SPIN = 12;
const MAX_DEBRIS_SPEED = 20;
const MAX_DEBRIS_SPIN = 30;
const KILL_DEPTH = 50;
const KILL_EXTENT = 1000;
const POSITION_LIMIT = 2047;
const DRILL_MARGIN = 0.01;
const HEAL_OVERLAP = 0.005;
/**
 * Debris tiers. A loose chunk at/below `debrisDepth`, or smaller than `volume` (m^3),
 * is debris: once it has been settled
 * for `settledSeconds` its physics is removed and its visual retires over `sinkSeconds`. More than `liveCap` of it alive at once, and the oldest is sunk first.
 * Larger pieces persist and bake. Mutable on a simulation (`debrisTier`) for tuning and tests.
 */
export interface DebrisTier {
  /** Absolute hierarchy depth; runtime fracture begins at depth 3. */
  debrisDepth?: number;
  liveCap: number;
  settledSeconds: number;
  sinkSeconds: number;
  volume: number;
}
export const DEBRIS_TIER: Readonly<DebrisTier> = {
  debrisDepth: 3,
  liveCap: 600,
  settledSeconds: 8,
  sinkSeconds: 1,
  volume: 0.05,
};
const CHIP_MATERIAL = /concrete|reinforced frame|masonry|brick|terracotta/i;
const vec = (a: Vec3): V => ({ x: a[0], y: a[1], z: a[2] });
const tuple = (a: V): Vec3 => [a.x, a.y, a.z];
const inverse = (q: Q): Q => ({ w: q.w, x: -q.x, y: -q.y, z: -q.z });
const multiply = (a: Q, b: Q): Q => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
const rotate = (q: Q, v: V): V => {
  const t = {
    x: 2 * (q.y * v.z - q.z * v.y),
    y: 2 * (q.z * v.x - q.x * v.z),
    z: 2 * (q.x * v.y - q.y * v.x),
  };
  return {
    x: v.x + q.w * t.x + q.y * t.z - q.z * t.y,
    y: v.y + q.w * t.y + q.z * t.x - q.x * t.z,
    z: v.z + q.w * t.z + q.x * t.y - q.y * t.x,
  };
};
const squared = (v: V) => v.x * v.x + v.y * v.y + v.z * v.z;
const limit = (v: V, magnitude: number): V => {
  const length = Math.sqrt(squared(v));
  return length > magnitude
    ? {
        x: (v.x * magnitude) / length,
        y: (v.y * magnitude) / length,
        z: (v.z * magnitude) / length,
      }
    : v;
};
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const ZERO: V = { x: 0, y: 0, z: 0 };
const volumeOf = (fragment: FragmentDef): number =>
  fragment.shape?.volume ??
  fragment.size[0] * fragment.size[1] * fragment.size[2];
const unit = (v: V): V => {
  const length = Math.sqrt(squared(v));
  return length > 1e-12
    ? { x: v.x / length, y: v.y / length, z: v.z / length }
    : { x: 0, y: 0, z: 0 };
};
const random = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};
const commandOrder = (a: DestructionCommand, b: DestructionCommand) =>
  a.tick - b.tick || a.id - b.id || a.source - b.source;
const isId = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const isPositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const isVector = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

function freezeDefinition<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      freezeDefinition(child);
    }
  }
  return value;
}

function principalInertia(
  tensor: NonNullable<FragmentDef["shape"]>["inertia"],
): {
  frame: Q;
  moments: V;
} {
  const [xx, yy, zz, xy, xz, yz] = tensor;
  const a: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ] = [xx, xy, xz, xy, yy, yz, xz, yz, zz];
  const v: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ] = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const scale = Math.max(xx, yy, zz);
  for (let iteration = 0; iteration < 32; iteration++) {
    let p = 0,
      q = 1;
    if (Math.abs(a[2]) > Math.abs(a[1])) {
      q = 2;
    }
    if (Math.abs(a[5]) > Math.abs(a[p * 3 + q]!)) {
      p = 1;
      q = 2;
    }
    const off = a[p * 3 + q]!;
    if (Math.abs(off) <= scale * 1e-14) {
      break;
    }
    const tau = (a[q * 3 + q]! - a[p * 3 + p]!) / (2 * off);
    const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t),
      s = t * c;
    a[p * 3 + p]! -= t * off;
    a[q * 3 + q]! += t * off;
    a[p * 3 + q] = a[q * 3 + p] = 0;
    for (let k = 0; k < 3; k++) {
      if (k !== p && k !== q) {
        const kp = a[k * 3 + p]!,
          kq = a[k * 3 + q]!;
        a[k * 3 + p] = a[p * 3 + k] = c * kp - s * kq;
        a[k * 3 + q] = a[q * 3 + k] = s * kp + c * kq;
      }
      const kp = v[k * 3 + p]!,
        kq = v[k * 3 + q]!;
      v[k * 3 + p] = c * kp - s * kq;
      v[k * 3 + q] = s * kp + c * kq;
    }
  }
  const moments = { x: a[0], y: a[4], z: a[8] };
  if (![moments.x, moments.y, moments.z].every(isPositive)) {
    throw new Error("Fragment inertia must be positive definite.");
  }
  const trace = v[0] + v[4] + v[8];
  let frame: Q;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    frame = {
      w: s / 4,
      x: (v[7] - v[5]) / s,
      y: (v[2] - v[6]) / s,
      z: (v[3] - v[1]) / s,
    };
  } else if (v[0] > v[4] && v[0] > v[8]) {
    const s = Math.sqrt(1 + v[0] - v[4] - v[8]) * 2;
    frame = {
      w: (v[7] - v[5]) / s,
      x: s / 4,
      y: (v[1] + v[3]) / s,
      z: (v[2] + v[6]) / s,
    };
  } else if (v[4] > v[8]) {
    const s = Math.sqrt(1 + v[4] - v[0] - v[8]) * 2;
    frame = {
      w: (v[2] - v[6]) / s,
      x: (v[1] + v[3]) / s,
      y: s / 4,
      z: (v[5] + v[7]) / s,
    };
  } else {
    const s = Math.sqrt(1 + v[8] - v[0] - v[4]) * 2;
    frame = {
      w: (v[3] - v[1]) / s,
      x: (v[2] + v[6]) / s,
      y: (v[5] + v[7]) / s,
      z: s / 4,
    };
  }
  const length = Math.hypot(frame.x, frame.y, frame.z, frame.w);
  frame.x /= length;
  frame.y /= length;
  frame.z /= length;
  frame.w /= length;
  return { frame, moments };
}

function validatePhysicsManifest(manifest: DestructibleManifest): void {
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    manifest.coordinateSystem !== "Y_UP_RH" ||
    !Array.isArray(manifest.fragments) ||
    !Array.isArray(manifest.bonds) ||
    !Array.isArray(manifest.materials) ||
    !manifest.fragments.length ||
    manifest.fragments.length > MAX_FRAGMENTS ||
    manifest.bonds.length > 100_000 ||
    !manifest.materials.length ||
    manifest.materials.length > 256
  ) {
    throw new Error("Unsupported or oversized destruction manifest.");
  }
  const materials = new Set<number>();
  if (manifest.level) {
    const level = manifest.level;
    if (
      !isVector(level.spawn?.position) ||
      !Number.isFinite(level.spawn.yaw) ||
      !Array.isArray(level.boxes) ||
      level.boxes.length > 4096 ||
      level.boxes.some(
        (box) =>
          !box ||
          typeof box.id !== "string" ||
          !isVector(box.position) ||
          !isVector(box.size) ||
          !box.size.every(isPositive) ||
          typeof box.collidable !== "boolean" ||
          (box.rotation !== undefined &&
            (!Array.isArray(box.rotation) ||
              box.rotation.length !== 4 ||
              !box.rotation.every(Number.isFinite) ||
              Math.abs(Math.hypot(...box.rotation) - 1) > 0.001)),
      )
    ) {
      throw new Error("Invalid level spawn or collision geometry.");
    }
  }
  for (const material of manifest.materials) {
    if (
      !material ||
      !isId(material.id) ||
      materials.has(material.id) ||
      !isPositive(material.density) ||
      !isPositive(material.strength) ||
      !Number.isFinite(material.friction) ||
      material.friction < 0 ||
      material.friction > 1 ||
      !Number.isFinite(material.brittleness) ||
      material.brittleness < 0 ||
      material.brittleness > 1 ||
      (material.youngModulus !== undefined &&
        (!isPositive(material.youngModulus) ||
          material.youngModulus < 1e3 ||
          material.youngModulus > 1e13)) ||
      (material.poissonRatio !== undefined &&
        (!Number.isFinite(material.poissonRatio) ||
          material.poissonRatio < 0 ||
          material.poissonRatio > 0.49)) ||
      [
        material.tensionStrength,
        material.compressionStrength,
        material.shearStrength,
        material.bendingStrength,
      ].some(
        (strength) =>
          strength !== undefined && (!isPositive(strength) || strength > 1e13),
      )
    ) {
      throw new Error("Invalid material definition.");
    }
    materials.add(material.id);
  }
  const fragments = new Set<number>();
  for (const fragment of manifest.fragments) {
    if (
      !fragment ||
      !isId(fragment.id) ||
      fragments.has(fragment.id) ||
      !isPositive(fragment.mass) ||
      !isVector(fragment.position) ||
      !isVector(fragment.size) ||
      !fragment.size.every(isPositive) ||
      typeof fragment.anchored !== "boolean" ||
      !materials.has(fragment.material) ||
      !isId(fragment.aggregate)
    ) {
      throw new Error(
        "Invalid fragment ID, dimensions, position, material, or mass.",
      );
    }
    const shape = fragment.shape;
    if (
      shape &&
      (!Array.isArray(shape.vertices) ||
        shape.vertices.length < 4 ||
        shape.vertices.length > 256 ||
        !shape.vertices.every(isVector) ||
        !isPositive(shape.volume) ||
        !Array.isArray(shape.inertia) ||
        shape.inertia.length !== 6 ||
        !shape.inertia.every(Number.isFinite) ||
        !Array.isArray(shape.faces) ||
        shape.faces.length < 4 ||
        shape.faces.length > 256 ||
        shape.faces.some(
          (face) =>
            !face ||
            !Array.isArray(face.vertices) ||
            face.vertices.length < 3 ||
            face.vertices.some(
              (index) => !isId(index) || index >= shape.vertices.length,
            ) ||
            (face.surface !== "exterior" && face.surface !== "fracture"),
        ))
    ) {
      throw new Error("Invalid convex fragment geometry or inertia.");
    }
    if (shape) {
      const [xx, yy, zz, xy, xz, yz] = shape.inertia;
      if (!(
        xx > 0 &&
        xx * yy - xy * xy > 0 &&
        xx * (yy * zz - yz * yz) -
          xy * (xy * zz - yz * xz) +
          xz * (xy * yz - yy * xz) >
          0
      )) {
        throw new Error("Fragment inertia must be positive definite.");
      }
    }
    fragments.add(fragment.id);
  }
  const bonds = new Set<number>(),
    pairs = new Set<string>();
  for (const bond of manifest.bonds) {
    if (
      !bond ||
      !isId(bond.id) ||
      bonds.has(bond.id) ||
      !fragments.has(bond.a) ||
      (bond.b !== -1 && !fragments.has(bond.b)) ||
      bond.a === bond.b ||
      !isPositive(bond.area) ||
      !isPositive(bond.strength) ||
      !isVector(bond.normal) ||
      Math.abs(Math.hypot(...bond.normal) - 1) > 0.01
    ) {
      throw new Error("Invalid bond ID, endpoints, area, strength, or normal.");
    }
    const pair = `${Math.min(bond.a, bond.b)}:${Math.max(bond.a, bond.b)}`;
    if (pairs.has(pair)) {
      throw new Error("Duplicate bond endpoint pair.");
    }
    bonds.add(bond.id);
    pairs.add(pair);
  }
}

export class DestructionSimulation {
  readonly manifest: DestructibleManifest;
  readonly graph: StructuralGraph;
  readonly world: RAPIER.World;
  readonly commandLog: Array<DestructionCommand> = [];
  private readonly physicsOperations: Array<PhysicsOperation> = [];
  private readonly collisionObjects = new Map<string, Array<RAPIER.Collider>>();
  readonly contactWrenches: Float64Array;
  readonly pressureImpulse: number;
  private readonly landingImpulses: Array<StructuralImpulse> = [];
  private readonly pressureGeometry = new WeakMap<FragmentDef, Array<PressureFace>>();
  /**
   * Contact wrench each baked fragment carried when it was baked. A fixed body makes no contact
   * with the ground it rests on, so without this its supporting reaction would vanish and the
   * support-path model would see a settled body as unsupported.
   */
  private readonly frozenWrenches: Float64Array;
  private readonly experimentalBearingReanchor: boolean;
  private readonly bearingSupports = new Map<RAPIER.RigidBody, BearingSupport>();
  private readonly bearingNodes = new Map<number, BearingSupport>();
  private failedBearingPoses = new WeakMap<RAPIER.RigidBody, Map<string, {
    pose: number[]; providers: RAPIER.Collider[];
  }>>();
  private readonly bearingContactWrenches = new Map<string, Map<number, Float64Array>>();
  private readonly secondaryBearingContactWrenches = new Map<string, Map<number, Float64Array>>();
  private readonly bearingLoads: Float64Array;
  private readonly secondaryBearingLoads = new Map<number, number[]>();
  private readonly secondaryContactWrenches = new Map<number, number[]>();
  private readonly secondaryBearingSolver: SecondaryBearingSolver;
  private readonly frozen: Uint8Array;
  private readonly crushLoad: Float64Array;
  private readonly crushCapacity: Float64Array;
  private crushQueue: Array<number> = [];
  private crushBudget: number;
  private detonated: Array<DestructionCommand> = [];
  private crushedFragments = 0;
  private crushedMass = 0;
  tick = 0;
  private readonly eventsQueue?: RAPIER.EventQueue;
  private readonly rapier: typeof RAPIER;
  private readonly ownsWorld: boolean;
  private readonly legacyContactWriteback: boolean;
  private compliantConnections?: CompliantConnections;
  /** Fixed step in seconds, 1/60 or 1/30. */
  readonly dt: number;
  /** How many 60 Hz ticks one step covers; scales the per-tick work budgets. */
  private readonly tickScale: number;
  private readonly settleTicks: number;
  private readonly rest: RestPolicy;
  private readonly restSuffix: string;
  private readonly forceRestTicks: number;
  /** Bumped whenever a body is created, removed or changes type, to invalidate `dynamicCount`. */
  private bodyRevision = 0;
  private dynamicCount = { count: 0, revision: -1 };
  /** Whether any detached body was awake at the end of the last step (baked bodies excluded). */
  private islandsMoving = false;
  private everBaked = false;
  /** Small-debris tuning; see `DEBRIS_TIER`. */
  debrisTier: DebrisTier = { ...DEBRIS_TIER };
  /** The live cap in force this tick; the step budget tightens it under load. */
  private debrisCap = DEBRIS_TIER.liveCap;
  private debrisSunk = 0;
  private readonly budget: StepBudget;
  private readonly stepWork: StepWork = {
    awakeBodies: 0, awakeColliders: 0, joints: 0, contactConstraints: 0,
    solverIterations: 0, structuralWork: 0, deferredStructuralWork: 0,
  };
  private readonly workContactPairs = new Map<number, Set<number>>();
  /** Turn the step budget off to compare against the unbudgeted engine. */
  set budgetEnabled(value: boolean) {
    this.budget.enabled = value;
  }
  /** Cost of the last step as the host measured it (wall clock around step and snapshot), if reported. */
  private reportedStepMs = 0;
  private budgetBaked = 0;
  private ccdRelaxed = false;
  private budgetBakedTotal = 0;
  private budgetDeferred = 0;
  /** Baked body handle to what owns it, so a supporter that moves can find what rests on it. */
  private readonly bakedOwners = new Map<
    number,
    { child?: SecondaryBody; island?: Island }
  >();
  /** Supporter body handle to the baked bodies that rested on it, and where it was at that time. */
  private readonly restingOn = new Map<
    number,
    { dependents: Set<number>; x: number; y: number; z: number }
  >();
  private unbakeQueue: Array<number> = [];
  private bakesThisTick = 0;
  private bakeReservationsThisTick = 0;
  private budgetBakeReservationsThisTick = 0;
  private bakeAttempts = 0;
  /**
   * Awake multi-member bodies are the only detached bodies the structural passes care about:
   * single-piece rubble has no bonds to load, so its contacts neither fail anything nor feed the
   * support-path model.
   */
  private structuralMoving = false;
  private structuralRevision = 0;
  /**
   * How structural contact loads are gathered: from the force events the solver already reports
   * (default), or by walking every contact pair of every awake body (the pre-event behaviour,
   * kept to compare against). A simulation inside a host's world always walks, because the host
   * decides whether force events are forwarded.
   */
  contactPass: "events" | "walk" = "events";
  private stepping = false;
  private stepStarted = 0;
  private physicsStarted = 0;
  private readonly forwardedContacts: Array<ForwardedContact> = [];
  private topologyRevision = 1;
  private geometryRevision = 1;
  private previousGeometry = new Float64Array();
  private navigationRevision = 1;
  private previousNavigationGeometry = new Float64Array();
  private navigationGeometry?: DestructionCollisionGeometry;
  private dynamicGeometry?: DestructionCollisionGeometry;
  private readonly ownedBodies = new Map<number, RAPIER.RigidBody>();
  private readonly ownedColliders = new Map<number, RAPIER.Collider>();
  private readonly player?: PhysicsPlayer;
  private playerAimInput?: { direction: Vec3; tool: PlayerTool };
  private aimCache?: AimPreview;
  private aimCacheBucket = -1;
  private readonly transforms: Float32Array;
  private readonly states: Uint8Array;
  private readonly staticColliders = new Map<number, RAPIER.Collider>();
  private readonly colliderFragments = new Map<number, number>();
  private readonly islands = new Map<number, Island>();
  private readonly supportedActors = new Map<number, Island>();
  private readonly supportedByFragment = new Map<number, Island>();
  private readonly visibleChunks = new Set<number>();
  private appliedHierarchyRevision = -1;
  private readonly retired = new Set<number>();
  private readonly refined = new Set<number>();
  private fractureSplits = 0;
  private subdivisions = 0;
  /** Coarse cells that landed hard and are waiting to refine; ordered by fragment id on use. */
  private readonly landedCells = new Set<number>();
  private impactFractures = 0;
  private impactTopologyDirty = false;
  private readonly impactRecords = new Map<DestructionCommand, ImpactRecord>();
  private readonly secondary: Array<SecondaryBody> = [];
  /** Retiring visuals own no native bodies, colliders, joints or structural mass. */
  private readonly visualRetirements: Array<VisualRetirement> = [];
  private readonly secondaryById = new Map<number, SecondaryBody>();
  private readonly secondaryColliders = new Map<number, SecondaryBody>();
  private readonly lineage = new Map<
    number,
    { parentId: number; rootId: number }
  >();
  private readonly secondaryIdBase: number;
  private nextSecondaryId: number;
  private secondaryRevision = 0;
  private evictedFragments = 0;
  private readonly fragmentIsland: Int32Array;
  private readonly seen = new Set<string>();
  private readonly commandHistoryKeys = new Set<string>();
  private readonly cooldowns = new Map<string, number>();
  private readonly preStepVelocity = new Map<number, V>();
  private readonly fragmentById = new Map<number, number>();
  private readonly hulls = new Map<
    number,
    { frame: Q; moments: V; points: Float32Array }
  >();
  private readonly pendingColliderMass = new Set<RAPIER.RigidBody>();
  /** Body-type changes invalidate the contact solve's cached effective-mass response. */
  private readonly pendingContactWarmstart = new Set<RAPIER.RigidBody>();
  private readonly collisionEnvelopes = new Map<number, {
    position: Vec3;
    /** Safe affine map inherited by every descendant, in this fragment's COM frame. */
    scale: number;
    offset: Vec3;
    inheritedScale: number;
    points?: Float32Array;
  }>();
  private readonly explosives: Array<Explosive> = [];
  private readonly cannonballs: Array<Cannonball> = [];
  private readonly ballColliders = new Map<number, Cannonball>();
  private readonly ballImpactEffects = new Map<
    number,
    { fragment?: number; impulse: V; position: V; release: boolean }
  >();
  private contactHistory = new Map<number, Map<number, number>>();
  private queue: Array<DestructionCommand> = [];
  private events: Array<DestructionEvent> = [];
  private disposed = false;
  private processedCommands = 0;
  private cascadeId = 0;
  private physicalImpactId = 0;
  private nativeStepMs: number | undefined;
  private physicsMs = 0;
  private structuralMs = 0;
  private appliedDamageRevision = -1;
  private transformRevision = 0;
  private geometryTransforms = -1;
  private geometryMoving = true;
  private geometryTopology = -1;
  private geometrySecondary = -1;
  private contactTransforms = -1;
  private contactTopology = -1;
  private contactMoving = true;
  private workerMs = 0;
  private droppedFrames = 0;
  private capacityEvents = 0;
  private hasStepped = false;
  private healedRoots = 0;
  private readonly createdThisTick = new Set<SecondaryBody>();
  private readonly pressureLaunches = new Map<RAPIER.RigidBody, PressureLaunch>();
  private readonly pressureBursts = new Map<string, PressureBurst>();
  private readonly pressureDescendants = new Map<number, SecondaryBody[]>();
  private readonly lastImpactTick: Float64Array;
  private readonly attachedVolumes = new Map<number, number>();
  private readonly killExtent: number;
  private readonly killFloor: number;

  static async create(
    manifest: DestructibleManifest,
    options: DestructionSimulationOptions = {},
  ): Promise<DestructionSimulation> {
    validatePhysicsManifest(manifest);
    const dt = options.timestep ?? FIXED_DT;
    if (!isSupportedTimestep(dt)) {
      throw new Error("Destruction supports a 1/60 or 1/30 second fixed step.");
    }
    engine = await loadRapier();
    return new DestructionSimulation(manifest, undefined, dt, options);
  }

  static attach(
    manifest: DestructibleManifest,
    host: DestructionHostPhysics,
    options: DestructionSimulationOptions = {},
  ): DestructionSimulation {
    validatePhysicsManifest(manifest);
    if (!host?.world || !host.rapier) {
      throw new Error(
        "A host Rapier module and initialized world are required.",
      );
    }
    if (
      !Number.isFinite(host.world.timestep) ||
      !isSupportedTimestep(host.world.timestep)
    ) {
      throw new Error(
        "Destruction requires the host world to use a 1/60 or 1/30 second fixed step.",
      );
    }
    return new DestructionSimulation(manifest, host, host.world.timestep, options);
  }

  private constructor(
    manifest: DestructibleManifest,
    host?: DestructionHostPhysics,
    dt = FIXED_DT,
    options: DestructionSimulationOptions = {},
  ) {
    this.experimentalBearingReanchor = options.experimentalBearingReanchor ?? true;
    this.pressureImpulse = options.pressureImpulse ?? BLAST_PRESSURE_IMPULSE;
    if (!Number.isFinite(this.pressureImpulse) || this.pressureImpulse < 0) {
      throw new Error("Blast pressure impulse must be finite and nonnegative.");
    }
    this.dt = dt;
    this.tickScale = Math.max(1, Math.round(dt / FIXED_DT));
    this.rest = { speed: SETTLE_SPEED, spin: SETTLE_SPIN, seconds: SETTLE_SECONDS, ...options.rest };
    this.rest.forceSpeed ??= this.rest.speed * SETTLE_HOLD;
    this.rest.forceSpin ??= this.rest.spin * SETTLE_HOLD;
    for (const value of [this.rest.speed, this.rest.spin, this.rest.seconds, this.rest.forceAfterSeconds ?? 1, this.rest.forceSpeed, this.rest.forceSpin]) {
      if (!Number.isFinite(value) || value <= 0) throw new Error("Rest policy values must be finite and positive.");
    }
    this.restSuffix = restVersionSuffix(options.rest);
    this.settleTicks = Math.max(1, this.ticks(this.rest.seconds));
    this.forceRestTicks = this.rest.forceAfterSeconds === undefined ? Infinity : Math.max(this.settleTicks, this.ticks(this.rest.forceAfterSeconds));
    this.budget = new StepBudget(dt * 1000);
    this.crushBudget = MAX_CRUSHED_PER_TICK * this.tickScale;
    this.rapier = host?.rapier ?? engine!;
    this.legacyContactWriteback = this.rapier.version().startsWith("0.19.");
    this.ownsWorld = host === undefined;
    this.secondaryIdBase = Math.max(...manifest.fragments.map((f) => f.id)) + 1;
    this.nextSecondaryId = this.secondaryIdBase;
    this.graph = new StructuralGraph(manifest);
    this.manifest = this.graph.manifest;
    this.transforms = new Float32Array(
      manifest.fragments.length * TRANSFORM_STRIDE,
    );
    this.states = new Uint8Array(manifest.fragments.length);
    this.contactWrenches = new Float64Array(manifest.fragments.length * 6);
    this.frozenWrenches = new Float64Array(manifest.fragments.length * 6);
    this.bearingLoads = new Float64Array(this.experimentalBearingReanchor ? manifest.fragments.length * 6 : 0);
    this.secondaryBearingSolver = new SecondaryBearingSolver(manifest.materials);
    this.frozen = new Uint8Array(manifest.fragments.length);
    this.crushLoad = new Float64Array(manifest.fragments.length);
    this.crushCapacity = new Float64Array(manifest.fragments.length);
    manifest.fragments.forEach((fragment, index) => {
      const material = manifest.materials.find(
        (m) => m.id === fragment.material,
      );
      const compression =
        material?.compressionStrength ?? (material?.strength ?? 1) * 10_000_000;
      this.crushCapacity[index] =
        compression * Math.cbrt(volumeOf(fragment)) ** 2 * CRUSH_CONTACT_FACTOR;
    });
    this.fragmentIsland = new Int32Array(manifest.fragments.length).fill(-1);
    this.lastImpactTick = new Float64Array(manifest.fragments.length).fill(-1);
    let lowest = Infinity,
      extent = 0;
    for (const f of manifest.fragments) {
      const [hx, hy, hz] = f.size.map((value) => value / 2) as [
        number,
        number,
        number,
      ];
      lowest = Math.min(lowest, f.position[1] - hy);
      extent = Math.max(
        extent,
        Math.abs(f.position[0]) + hx,
        Math.abs(f.position[1]) + hy,
        Math.abs(f.position[2]) + hz,
      );
      for (const vertex of f.shape?.vertices ?? []) {
        lowest = Math.min(lowest, f.position[1] + vertex[1]);
      }
    }
    this.killExtent = Math.min(
      POSITION_LIMIT,
      Math.max(KILL_EXTENT, extent + KILL_DEPTH),
    );
    this.killFloor = Math.max(-this.killExtent, lowest - KILL_DEPTH);
    this.world = host?.world ?? new this.rapier.World({ x: 0, y: -9.81, z: 0 });
    try {
      if (this.ownsWorld) {
        this.world.timestep = this.dt;
        this.world.integrationParameters.numSolverIterations = 6;
        this.eventsQueue = new this.rapier.EventQueue(true);
        this.createCollider(
          this.rapier.ColliderDesc.cuboid(150, 0.5, 150)
            .setTranslation(0, -0.5, 0)
            .setFriction(0.85),
        );
        for (const box of manifest.level?.boxes ?? []) {
          if (!box.collidable) {
            continue;
          }
          const desc = this.rapier.ColliderDesc.cuboid(
            box.size[0] / 2,
            box.size[1] / 2,
            box.size[2] / 2,
          )
            .setTranslation(...box.position)
            .setFriction(0.85);
          if (box.rotation) {
            desc.setRotation({
              w: box.rotation[3],
              x: box.rotation[0],
              y: box.rotation[1],
              z: box.rotation[2],
            });
          }
          this.createCollider(desc);
        }
        this.player = new PhysicsPlayer(
          this.world,
          manifest.level?.spawn.position ?? [0, 0.05, 9],
          this.dt,
          this.rapier,
        );
      }
      const ordered = manifest.fragments
        .map((_, i) => i)
        .sort((a, b) => manifest.fragments[a]!.id - manifest.fragments[b]!.id);
      for (const index of ordered) {
        const f = manifest.fragments[index]!;
        this.fragmentById.set(f.id, index);
        this.transforms.set(
          [...f.position, 0, 0, 0, 1, 0],
          index * TRANSFORM_STRIDE,
        );
      }
      this.rebuildIslands(this.graph.getUnsupportedIslands());
      this.finalizeColliderMasses();
      this.collectStructuralLoads();
      this.graph.initializeStress();
      this.compliantConnections = new CompliantConnections(
        this.rapier, this.world, this.graph, {
          body: (index) => this.actorForFragment(index)?.body,
          pose: (index) => {
            const actor = this.actorForFragment(index), local = actor?.poses.get(index);
            if (!actor || !local) return { position: this.position(index), rotation: this.rotation(index) };
            const rotation = actor.body.rotation();
            return {
              position: add(actor.body.translation(), rotate(rotation, local.position)),
              rotation: multiply(rotation, local.rotation),
            };
          },
          wake: (body) => {
            if (!body.isValid() || (body.isDynamic() && !body.isSleeping())) return;
            const baked = this.bakedOwners.get(body.handle)?.island;
            if (baked) { this.wakeIsland(baked); return; }
            for (const actor of this.islands.values()) {
              if (actor.body.handle === body.handle) { this.wakeIsland(actor); break; }
            }
          },
          sampleDt: host?.jointImpulseSampleDt,
        },
      );
      this.refreshGeometryVersion();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  recordImpact(impact: DestructionPhysicalImpact): DestructionCommand | null {
    this.assertLive();
    if (
      !Number.isFinite(impact.colliderHandle) ||
      !isVector(impact.position) ||
      !isVector(impact.direction) ||
      !Number.isFinite(impact.energy) ||
      impact.energy < 0 ||
      (impact.impulse !== undefined && !isVector(impact.impulse)) ||
      (impact.radius !== undefined && !isPositive(impact.radius)) ||
      (impact.source !== undefined && !isId(impact.source))
    ) {
      throw new Error("Invalid physical impact.");
    }
    const length = Math.hypot(...impact.direction);
    if (length < 1e-9) {
      throw new Error("Physical impact direction must be nonzero.");
    }
    const fragmentId = this.fragmentForCollider(impact.colliderHandle);
    if (fragmentId === undefined || impact.energy < 120) {
      return null;
    }
    const command = this.enqueue({
      direction: [
        impact.direction[0] / length,
        impact.direction[1] / length,
        impact.direction[2] / length,
      ],
      fragmentId,
      id: this.physicalImpactId,
      impulse: impact.impulse ? [...impact.impulse] : [0, 0, 0],
      position: [...impact.position],
      radius: impact.radius ?? 0.35,
      source: impact.source ?? ORDNANCE_SOURCE - 1,
      strength: clamp(Math.sqrt(impact.energy) / 90, 0.4, 8),
      tick: this.tick + 1,
      type: "pointImpact",
    });
    this.physicalImpactId++;
    return command;
  }

  enqueue(command: DestructionCommand): DestructionCommand | null {
    this.assertLive();
    if (!command || !validateCommand(command)) {
      throw new Error("Invalid destruction command.");
    }
    if (
      command.fragmentId !== undefined &&
      !this.fragmentById.has(command.fragmentId) &&
      !(
        Number.isSafeInteger(command.fragmentId) &&
        command.fragmentId >= this.secondaryIdBase &&
        command.fragmentId < this.secondaryIdBase + MAX_SECONDARY_ID_SPAN
      )
    ) {
      throw new Error("Command target refers to an unknown fragment.");
    }
    const key = `${command.source}:${command.id}`;
    if (this.seen.has(key)) {
      return null;
    }
    if (this.queue.length >= MAX_QUEUED_COMMANDS) {
      throw new Error("Command queue capacity exceeded.");
    }
    if (this.ownsWorld && this.commandLog.length >= MAX_REPLAY_COMMANDS) {
      throw new Error(
        "Replay command capacity exceeded. Reset the simulation to start a new session.",
      );
    }
    if (command.tick > this.tick + MAX_REPLAY_TICKS) {
      throw new Error("Command exceeds the maximum future scheduling window.");
    }
    const accepted = {
      ...command,
      direction: [...command.direction] as Vec3,
      position: [...command.position] as Vec3,
      tick: Math.max(this.tick + 1, command.tick),
      ...(command.impulse ? { impulse: [...command.impulse] as Vec3 } : {}),
    };
    this.seen.add(key);
    this.queue.push(accepted);
    this.queue.sort(commandOrder);
    this.commandLog.push(accepted);
    if (!this.ownsWorld) {
      this.commandHistoryKeys.add(key);
      if (this.commandLog.length > MAX_REPLAY_COMMANDS) {
        const retired = this.commandLog.shift()!;
        const retiredKey = `${retired.source}:${retired.id}`;
        this.commandHistoryKeys.delete(retiredKey);
        if (
          !this.queue.some(
            (item) => item.source === retired.source && item.id === retired.id,
          )
        ) {
          this.seen.delete(retiredKey);
        }
      }
    }
    return accepted;
  }

  setCollisionObject(
    object: CollisionObject,
    clearanceBoxes: Array<CollisionBox> = [],
  ): PhysicsActionResult {
    this.assertLive();
    if (
      !validateCollisionObject(object) ||
      !Array.isArray(clearanceBoxes) ||
      clearanceBoxes.length > MAX_COLLISION_BOXES ||
      !clearanceBoxes.every(validateCollisionBox)
    ) {
      return { accepted: false, message: "Invalid collision geometry." };
    }
    if (
      (!this.collisionObjects.has(object.id) &&
        this.collisionObjects.size >= MAX_COLLISION_OBJECTS) ||
      this.physicsOperations.length >= MAX_PHYSICS_OPERATIONS
    ) {
      return { accepted: false, message: "Collision object capacity reached." };
    }
    const owned = new Set(this.collisionObjects.get(object.id) ?? []);
    for (const box of [...object.boxes, ...clearanceBoxes]) {
      const shape = new this.rapier.Cuboid(
        box.size[0] / 2,
        box.size[1] / 2,
        box.size[2] / 2,
      );
      if (
        this.overlapsLive(
          shape,
          vec(box.position),
          this.boxRotation(box),
          owned,
        )
      ) {
        return { accepted: false, message: "Placement is obstructed." };
      }
    }
    this.applyPhysicsOperation({
      object: structuredClone(object),
      tick: this.tick,
      type: "setCollisionObject",
    });
    return { accepted: true };
  }

  removeCollisionObject(id: string): PhysicsActionResult {
    this.assertLive();
    if (!validCollisionId(id) || !this.collisionObjects.has(id)) {
      return { accepted: false, message: "Collision object does not exist." };
    }
    if (this.physicsOperations.length >= MAX_PHYSICS_OPERATIONS) {
      return {
        accepted: false,
        message: "Physics operation capacity reached.",
      };
    }
    this.applyPhysicsOperation({
      id,
      tick: this.tick,
      type: "removeCollisionObject",
    });
    return { accepted: true };
  }

  launchFromEmitter(
    launch: EmitterLaunch,
    id: number,
    source = 1,
  ): PhysicsActionResult {
    this.assertLive();
    if (
      !launch ||
      !validCollisionId(launch.ownerId) ||
      !this.collisionObjects.has(launch.ownerId)
    ) {
      return {
        accepted: false,
        message: "Emitter collision object does not exist.",
      };
    }
    const validPoint = (p: Vec3) =>
      isVector(p) && p.every((n) => Math.abs(n) < 1000);
    const offset = launch.spawnOffset ?? launch.radius + 0.05;
    if (
      !validPoint(launch.breech) ||
      !validPoint(launch.muzzle) ||
      !isVector(launch.direction) ||
      Math.abs(Math.hypot(...launch.direction) - 1) > 0.02 ||
      !Number.isFinite(offset) ||
      offset < 0 ||
      offset > 4
    ) {
      return { accepted: false, message: "Invalid emitter path." };
    }
    const direction = launch.direction.map(
      (n) => n / Math.hypot(...launch.direction),
    ) as Vec3;
    const command: DestructionCommand = {
      direction,
      id,
      position: launch.muzzle.map((n, i) => n + direction[i]! * offset) as Vec3,
      radius: launch.radius,
      source,
      strength: launch.strength,
      tick: this.tick,
      type: "cannonball",
    };
    const barrelLength = Math.hypot(
      ...launch.muzzle.map((n, i) => n - launch.breech[i]!),
    );
    if (
      !validateCommand(command) ||
      barrelLength > 20 ||
      barrelLength < 0.001
    ) {
      return { accepted: false, message: "Invalid emitter projectile." };
    }
    const alignment = direction.reduce(
      (sum, n, i) =>
        sum + (n * (launch.muzzle[i]! - launch.breech[i]!)) / barrelLength,
      0,
    );
    if (alignment < 0.999) {
      return {
        accepted: false,
        message: "Emitter direction does not match its barrel.",
      };
    }
    if (this.seen.has(`${source}:${id}`)) {
      return { accepted: false, message: "Projectile ID was already used." };
    }
    if (
      this.cannonballs.length >= MAX_CANNONBALLS ||
      this.dynamicBodyCount() >= MAX_DYNAMIC_BODIES ||
      this.physicsOperations.length >= MAX_PHYSICS_OPERATIONS
    ) {
      return { accepted: false, message: "Projectile capacity reached." };
    }
    const owned = new Set(this.collisionObjects.get(launch.ownerId)!);
    const shape = new this.rapier.Ball(launch.radius);
    if (
      this.sweepsLive(shape, launch.breech, launch.muzzle, owned) ||
      this.sweepsLive(shape, launch.muzzle, command.position, owned) ||
      this.overlapsLive(
        shape,
        vec(command.position),
        { w: 1, x: 0, y: 0, z: 0 },
        new Set(),
      )
    ) {
      return {
        accepted: false,
        message: "Emitter barrel or muzzle is obstructed.",
      };
    }
    this.applyPhysicsOperation({
      command,
      tick: this.tick,
      type: "launchFromEmitter",
    });
    return { accepted: true, command: structuredClone(command) };
  }

  private boxRotation(box: CollisionBox): Q {
    const q = box.rotation ?? [0, 0, 0, 1];
    return { w: q[3], x: q[0], y: q[1], z: q[2] };
  }

  private playerVolume(): { position: V; shape: RAPIER.Capsule } | undefined {
    const state = this.player?.frame();
    if (!state?.enabled) {
      return;
    }
    const height = state.crouched ? 1.08 : 1.78;
    return {
      position: {
        x: state.position[0],
        y: state.position[1] + height / 2,
        z: state.position[2],
      },
      shape: new this.rapier.Capsule(height / 2 - 0.29, 0.29),
    };
  }

  private overlapsLive(
    shape: RAPIER.Shape,
    position: V,
    rotation: Q,
    owned: Set<RAPIER.Collider>,
  ): boolean {
    let blocked = false;
    this.world.forEachCollider((collider) => {
      if (
        !blocked &&
        collider.isEnabled() &&
        !collider.isSensor() &&
        !owned.has(collider)
      ) {
        blocked = collider.intersectsShape(shape, position, rotation);
      }
    });
    const player = this.playerVolume();
    return (
      blocked ||
      Boolean(
        player &&
        shape.intersectsShape(
          position,
          rotation,
          player.shape,
          player.position,
          {
            w: 1,
            x: 0,
            y: 0,
            z: 0,
          },
        ),
      )
    );
  }

  private sweepsLive(
    shape: RAPIER.Shape,
    from: Vec3,
    to: Vec3,
    owned: Set<RAPIER.Collider>,
  ): boolean {
    const identity = { w: 1, x: 0, y: 0, z: 0 },
      position = vec(from);
    if (this.overlapsLive(shape, position, identity, owned)) {
      return true;
    }
    const velocity = {
      x: to[0] - from[0],
      y: to[1] - from[1],
      z: to[2] - from[2],
    };
    const zero = { x: 0, y: 0, z: 0 };
    let blocked = false;
    this.world.forEachCollider((collider) => {
      if (
        !blocked &&
        collider.isEnabled() &&
        !collider.isSensor() &&
        !owned.has(collider)
      ) {
        blocked = Boolean(
          shape.castShape(
            position,
            identity,
            velocity,
            collider.shape,
            collider.translation(),
            collider.rotation(),
            zero,
            0,
            1,
            true,
          ),
        );
      }
    });
    const player = this.playerVolume();
    return (
      blocked ||
      Boolean(
        player &&
        shape.castShape(
          position,
          identity,
          velocity,
          player.shape,
          player.position,
          identity,
          zero,
          0,
          1,
          true,
        ),
      )
    );
  }

  applyPhysicsOperation(operation: PhysicsOperation): void {
    this.assertLive();
    if (
      !validatePhysicsOperation(operation) ||
      operation.tick !== this.tick ||
      this.physicsOperations.length >= MAX_PHYSICS_OPERATIONS
    ) {
      throw new Error("Invalid physics replay operation.");
    }
    if (operation.type === "setCollisionObject") {
      if (
        !this.collisionObjects.has(operation.object.id) &&
        this.collisionObjects.size >= MAX_COLLISION_OBJECTS
      ) {
        throw new Error("Collision object capacity reached.");
      }
      for (const collider of this.collisionObjects.get(operation.object.id) ??
        []) {
        this.removeCollider(collider, true);
      }
      const colliders = operation.object.boxes.map((box) =>
        this.createCollider(
          this.rapier.ColliderDesc.cuboid(
            box.size[0] / 2,
            box.size[1] / 2,
            box.size[2] / 2,
          )
            .setTranslation(...box.position)
            .setRotation(this.boxRotation(box))
            .setFriction(0.85),
        ),
      );
      this.collisionObjects.set(operation.object.id, colliders);
    } else if (operation.type === "removeCollisionObject") {
      const colliders = this.collisionObjects.get(operation.id);
      if (!colliders) {
        throw new Error("Replay removes an unknown collision object.");
      }
      for (const collider of colliders) {
        this.removeCollider(collider, true);
      }
      this.collisionObjects.delete(operation.id);
    } else {
      const key = `${operation.command.source}:${operation.command.id}`;
      if (
        this.seen.has(key) ||
        this.cannonballs.length >= MAX_CANNONBALLS ||
        this.dynamicBodyCount() >= MAX_DYNAMIC_BODIES
      ) {
        throw new Error("Replay projectile cannot be launched.");
      }
      this.createCannonball(operation.command);
      this.seen.add(key);
      this.processedCommands++;
    }
    this.physicsOperations.push(structuredClone(operation));
    this.aimCache = undefined;
    this.aimCacheBucket = -1;
  }

  setPlayerEnabled(enabled: boolean): void {
    this.assertLive();
    if (!this.player && enabled) {
      throw new Error(
        "Shared-world destruction uses the host character controller.",
      );
    }
    this.player?.setEnabled(Boolean(enabled));
    if (!enabled) {
      this.playerAimInput = this.aimCache = undefined;
    }
  }

  setPlayerInput(input: PlayerInput): void {
    this.assertLive();
    if (!this.player) {
      throw new Error(
        "Shared-world destruction uses the host character controller.",
      );
    }
    this.player.setInput(input);
    if (
      isVector(input?.aim) &&
      ["explosive", "cannonball", "hammer", "cutter"].includes(
        input.tool ?? "",
      ) &&
      Number.isFinite(Math.hypot(...input.aim)) &&
      Math.hypot(...input.aim) > 0.001
    ) {
      const length = Math.hypot(...input.aim);
      this.playerAimInput = {
        direction: input.aim.map((n) => n / length) as Vec3,
        tool: input.tool!,
      };
    } else {
      this.playerAimInput = this.aimCache = undefined;
    }
  }

  clearPlayerInput(): void {
    this.player?.clearInput();
    this.playerAimInput = this.aimCache = undefined;
  }

  respawnPlayer(): void {
    this.assertLive();
    this.player?.respawn();
    this.playerAimInput = this.aimCache = undefined;
  }

  playerAction(request: Extract<WorkerRequest, { type: "playerAction" }>): {
    command?: DestructionCommand;
    message?: string;
  } {
    this.assertLive();
    const state = this.player?.frame();
    if (!state?.enabled) {
      return { message: "Enter walk mode to use this action." };
    }
    if (
      !isVector(request.direction) ||
      !Number.isFinite(Math.hypot(...request.direction)) ||
      Math.hypot(...request.direction) < 0.001 ||
      !isId(request.id) ||
      !isPositive(request.radius) ||
      !isPositive(request.strength) ||
      (request.reach !== undefined && !isPositive(request.reach))
    ) {
      return { message: "Invalid player action." };
    }
    const length = Math.hypot(...request.direction);
    const direction = request.direction.map((n) => n / length) as Vec3;
    const radius =
      request.action === "cannonball"
        ? clamp(request.radius, 0.08, 0.75)
        : request.radius;
    const target = this.inspectPlayerAim(
      request.action,
      direction,
      radius,
      request.reach,
    );
    if (!target.valid) {
      return { message: target.message };
    }
    let command: DestructionCommand;
    if (request.action === "cannonball") {
      const distance = 0.62 + radius;
      command = {
        direction,
        id: request.id,
        position: state.eye.map((n, i) => n + direction[i]! * distance) as Vec3,
        radius,
        source: 1,
        strength: clamp(request.strength, 0.4, 5),
        tick: this.tick + 1,
        type: "cannonball",
      };
    } else if (request.action === "explosive") {
      command = {
        direction: target.normal!,
        id: request.id,
        position: target.position!,
        radius: clamp(radius, 0.1, 10),
        source: 1,
        strength: clamp(request.strength, 0.1, 10),
        tick: this.tick + 1,
        type: "placeExplosive",
        ...(target.fragmentId === undefined
          ? {}
          : { fragmentId: target.fragmentId }),
      };
    } else if (request.action === "hammer" || request.action === "cutter") {
      command = {
        direction: request.action === "hammer" ? direction : target.normal!,
        id: request.id,
        position: target.position!,
        radius: request.action === "hammer" ? 0.48 : 0.38,
        source: 1,
        strength: clamp(request.strength, 0.1, 10),
        tick: this.tick + 1,
        type: request.action === "hammer" ? "pointImpact" : "cut",
      };
    } else {
      return { message: "Unknown player action." };
    }
    return { command: this.enqueue(command) ?? undefined };
  }

  private inspectPlayerAim(
    tool: PlayerTool,
    direction: Vec3,
    ballRadius = 0.32,
    requestedReach?: number,
  ): AimPreview {
    const origin = vec(this.player!.frame().eye),
      aim = vec(direction);
    const hit = this.world.castRayAndGetNormal(
      new this.rapier.Ray(origin, aim),
      5,
      true,
      this.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    const fragmentId = hit
      ? this.fragmentForCollider(hit.collider.handle)
      : undefined;
    const surface: Omit<AimPreview, "valid" | "message"> = hit
      ? {
          distance: hit.timeOfImpact,
          normal: tuple(hit.normal),
          position: [
            origin.x + aim.x * hit.timeOfImpact,
            origin.y + aim.y * hit.timeOfImpact,
            origin.z + aim.z * hit.timeOfImpact,
          ] as Vec3,
          ...(fragmentId === undefined ? {} : { fragmentId }),
        }
      : {};
    if (tool === "cannonball") {
      const blocked = this.world.castShape(
        origin,
        { w: 1, x: 0, y: 0, z: 0 },
        aim,
        new this.rapier.Ball(ballRadius),
        0.025,
        0.62 + ballRadius,
        true,
        this.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      );
      return {
        ...surface,
        message: blocked
          ? "Muzzle obstructed. Step back before firing."
          : "Ready to fire.",
        valid: !blocked,
      };
    }
    if (tool === "explosive" && surface.position) {
      const point = surface.position;
      const nearby = (position: V) =>
        Math.hypot(
          position.x - point[0],
          position.y - point[1],
          position.z - point[2],
        ) < 0.23;
      const occupied =
        this.explosives.some((charge) =>
          nearby(this.explosiveTransform(charge).position),
        ) ||
        this.queue.some(
          (command) =>
            command.type === "placeExplosive" && nearby(vec(command.position)),
        );
      if (occupied) {
        return {
          distance: surface.distance,
          fragmentId: surface.fragmentId,
          message: "Charge already mounted here.",
          valid: false,
        };
      }
    }
    const defaultReach = tool === "hammer" ? 2.4 : 3.2;
    const reach = Math.min(requestedReach ?? defaultReach, defaultReach);
    if (!hit || hit.timeOfImpact > reach) {
      return {
        ...surface,
        message: `Move within ${reach} m of a surface${tool === "explosive" ? " to place a charge" : ""}.`,
        valid: false,
      };
    }
    if (this.ballColliders.has(hit.collider.handle)) {
      return {
        ...surface,
        message: "Aim at a wall, floor, or piece of rubble.",
        valid: false,
      };
    }
    if (tool !== "explosive" && fragmentId === undefined) {
      return {
        ...surface,
        message: "Aim at destructible material.",
        valid: false,
      };
    }
    return {
      ...surface,
      message:
        tool === "explosive"
          ? "Place charge."
          : tool === "hammer"
            ? "Strike surface."
            : "Cut bonds.",
      valid: true,
    };
  }

  private playerAimFrame(): AimPreview | undefined {
    if (!this.player?.frame().enabled || !this.playerAimInput) {
      return;
    }
    const bucket = Math.floor(this.tick / 2);
    if (bucket !== this.aimCacheBucket) {
      this.aimCacheBucket = bucket;
      this.aimCache = this.inspectPlayerAim(
        this.playerAimInput.tool,
        this.playerAimInput.direction,
      );
    }
    return this.aimCache;
  }

  step(): SimulationFrame {
    this.assertLive();
    if (!this.ownsWorld) {
      throw new Error(
        "The host must bracket its world.step with beforePhysicsStep and afterPhysicsStep.",
      );
    }
    this.beforePhysicsStep();
    const nativeStarted = performance.now();
    this.world.step(this.eventsQueue);
    this.nativeStepMs = performance.now() - nativeStarted;
    return this.afterPhysicsStep();
  }

  beforePhysicsStep(): void {
    this.assertLive();
    if (this.stepping) {
      throw new Error("The previous physics step has not completed.");
    }
    if (
      !Number.isFinite(this.world.timestep) ||
      Math.abs(this.world.timestep - this.dt) > 1e-6
    ) {
      throw new Error(
        `Destruction requires a ${Math.round(1 / this.dt)} Hz fixed step.`,
      );
    }
    this.stepping = true;
    try {
      this.prepareStep();
    } catch (error) {
      this.stepping = false;
      throw error;
    }
  }

  private prepareStep(): void {
    this.stepStarted = performance.now();
    if (this.hasStepped) {
      this.budget.observe(Math.max(this.workerMs, this.reportedStepMs));
    }
    this.reportedStepMs = 0;
    this.budget.update();
    this.graph.directBudgetMs = STEP_BUDGET.structuralMsByRung[this.budget.rung] ?? 6;
    this.graph.directWorkLimit = STEP_BUDGET.structuralWorkByRung[this.budget.rung] ?? STEP_BUDGET.structuralWorkByRung[0]!;
    this.stepWork.contactConstraints = 0;
    this.stepWork.structuralWork = 0;
    this.stepWork.deferredStructuralWork = 0;
    this.workContactPairs.clear();
    this.debrisCap =
      this.budget.rung >= 4
        ? Math.min(this.debrisTier.liveCap, STEP_BUDGET.tightDebrisCap)
        : this.debrisTier.liveCap;
    this.budgetBaked = 0;
    if (this.experimentalBearingReanchor) {
      this.bakesThisTick = 0;
      this.bakeReservationsThisTick = 0;
      this.budgetBakeReservationsThisTick = 0;
      this.bakeAttempts = 0;
    }
    this.events = [];
    this.tick++;
    this.fractureSplits = 0;
    this.subdivisions = 0;
    this.impactFractures = 0;
    this.impactRecords.clear();
    this.createdThisTick.clear();
    this.pressureLaunches.clear();
    this.pressureBursts.clear();
    this.pressureDescendants.clear();
    this.crushBudget = MAX_CRUSHED_PER_TICK * this.tickScale;
    const commands: Array<DestructionCommand> = [];
    while (
      this.queue.length &&
      this.queue[0]!.tick <= this.tick &&
      commands.length < MAX_COMMANDS_PER_TICK
    ) {
      const command = this.queue.shift()!;
      commands.push(command);
      const key = `${command.source}:${command.id}`;
      if (!this.ownsWorld && !this.commandHistoryKeys.has(key)) {
        this.seen.delete(key);
      }
    }
    this.processedCommands += commands.length;
    const structuralStart = performance.now();
    this.expireOrdnance();
    this.cullOutOfBounds();
    this.crushFragments();
    const damageCommands = this.resolveOrdnance(commands);
    this.pulverise();
    const pressure = this.collectBlastPressure(damageCommands);
    const structuralCommands = this.fractureImpacts(damageCommands);
    this.graph.breakBudget = Math.max(
      0,
      MAX_DYNAMIC_BODIES - this.dynamicBodyCount(),
    );
    const mounted = this.explosives
      .filter((charge) => charge.fragment !== undefined)
      .map((charge) => ({ charge, ...this.explosiveTransform(charge) }));
    const fractureCommands = this.graph.generateFracture(
      structuralCommands,
      this.transforms,
    );
    this.captureBlastFracture(fractureCommands);
    const applied = this.graph.applyFracture(fractureCommands, this.transforms);
    this.initializeDemotedPoses(applied.demoted);
    this.graph.split();
    // Resolve after demotion: pending loads retain their asset position and find the new child.
    for (const load of this.landingImpulses.splice(0)) {
      this.graph.addForce(load.chunk, load.point, load.impulse);
    }
    for (const load of pressure) {
      if (load.chunk >= 0) this.graph.addForce(load.chunk, load.point, load.impulse);
    }
    if (this.experimentalBearingReanchor) {
      this.submitBearingSupports();
      this.updateBearingLoadSnapshot();
    }
    const topology = this.graph.step(this.dt);
    this.stepWork.structuralWork = this.graph.directResult?.workUsed ?? 0;
    this.stepWork.deferredStructuralWork = this.graph.directResult?.workDeferred ?? 0;
    if (this.experimentalBearingReanchor) this.solveBearingSupports();
    if (
      !this.hasStepped ||
      topology.broken.length ||
      (topology.compliant?.length ?? 0) ||
      this.impactTopologyDirty ||
      this.appliedHierarchyRevision !== this.graph.hierarchyRevision ||
      this.appliedDamageRevision !== this.graph.damageRevision
    ) {
      this.impactTopologyDirty = false;
      this.rebuildIslands(this.experimentalBearingReanchor ? this.graph.getUnsupportedIslands() : topology.islands);
      this.remountHierarchyCharges(mounted);
    }
    this.hasStepped = true;
    this.finalizeColliderMasses();
    this.captureBlastDetachments(pressure);
    this.fractureSecondary(this.secondaryCandidates(damageCommands));
    this.finalizeColliderMasses();
    // Launch actual receivers after all same-event fracture choices and masses
    // are final. A new chip uses its own cap, never its former slab's cap.
    this.applyBlastPressure(pressure);
    // The blast and its same-event subdivisions are complete. Later impacts and
    // the native step retain their own velocity/impulse rules.
    this.pressureLaunches.clear();
    this.pressureBursts.clear();
    this.pressureDescendants.clear();
    for (const index of topology.broken.slice(0, 32)) {
      this.bondEvent(index, "bondBroken");
    }
    for (const index of topology.cracked.slice(0, 16)) {
      this.bondEvent(index, "bondCracked");
    }
    for (const index of (topology.compliant ?? []).slice(0, 32)) {
      this.bondEvent(index, "bondCompliant");
    }
    this.updateDamage();
    this.structuralMs = performance.now() - structuralStart;
    this.physicsStarted = performance.now();
    this.applyImpulses(damageCommands);
    this.wakeDependents();
    this.applyBudget();
    this.compliantConnections?.sync();
    this.impactRecords.clear();
    this.preStepVelocity.clear();
    for (const island of this.islands.values()) {
      if (
        !island.baked &&
        !island.body.isFixed() &&
        !island.body.isSleeping()
      ) {
        this.preStepVelocity.set(island.key, island.body.linvel());
      }
    }
    for (const child of this.secondary) {
      if (!child.baked) {
        child.velocity = child.body.linvel();
      }
    }
    for (const ball of this.cannonballs) {
      ball.velocity = ball.body.linvel();
    }
    this.resetChangedContactWarmstarts();
    // Count the bodies/colliders actually submitted to this native step, after
    // deterministic baking and CCD policy have run. These counts are not timings.
    this.stepWork.awakeBodies = 0;
    this.stepWork.awakeColliders = 0;
    for (const body of this.ownedBodies.values()) {
      if (!body.isDynamic() || body.isSleeping()) continue;
      this.stepWork.awakeBodies++;
      this.stepWork.awakeColliders += body.numColliders();
    }
    this.stepWork.joints = this.world.impulseJoints.len();
    this.stepWork.solverIterations = this.world.integrationParameters.numSolverIterations;
  }

  recordContactForce(event: DestructionContactForce): void {
    this.assertLive();
    if (!this.stepping) {
      throw new Error(
        "Contact forces must be forwarded between beforePhysicsStep and afterPhysicsStep.",
      );
    }
    const first = event.collider1(),
      second = event.collider2();
    if (
      !this.colliderFragments.has(first) &&
      !this.colliderFragments.has(second) &&
      !this.secondaryColliders.has(first) &&
      !this.secondaryColliders.has(second) &&
      !this.ballColliders.has(first) &&
      !this.ballColliders.has(second)
    ) {
      return;
    }
    if (!this.world.getCollider(first)?.isValid() || !this.world.getCollider(second)?.isValid()) return;
    const direction = event.maxForceDirection(),
      force = event.totalForceMagnitude();
    if (
      ![direction.x, direction.y, direction.z, force].every(Number.isFinite) ||
      force < 0
    ) {
      return;
    }
    // Count all reported native contacts, including free debris that needs no
    // structural load pass. Deduplication also covers hosts forwarding a pair twice.
    const low = first < second ? first : second,
      high = first < second ? second : first;
    let worked = this.workContactPairs.get(low);
    if (!worked) this.workContactPairs.set(low, worked = new Set());
    if (!worked.has(high)) {
      worked.add(high);
      this.stepWork.contactConstraints += contactPairSolverContactCount(this.world, first, second);
    }
    this.forwardedContacts.push({
      direction: { ...direction },
      first,
      force,
      second,
    });
  }

  afterPhysicsStep(): SimulationFrame {
    this.assertLive();
    if (!this.stepping) {
      throw new Error("beforePhysicsStep must precede afterPhysicsStep.");
    }
    this.eventsQueue?.drainContactForceEvents((event) =>
      this.recordContactForce(event),
    );
    this.player?.step();
    this.compliantConnections?.collect();
    this.updateTransformsAndSettlement();
    this.collectCascades();
    this.ageDebris();
    this.refreshGeometryVersion();
    this.budget.observeWork(this.stepWork);
    this.physicsMs = performance.now() - this.physicsStarted;
    this.workerMs = performance.now() - this.stepStarted;
    this.stepping = false;
    return this.frame();
  }

  frame(): SimulationFrame {
    this.assertLive();
    const snapshotStarted = performance.now();
    let activeBodies = 0,
      sleepingBodies = 0,
      settledBodies = 0,
      supportedFragments = 0,
      detachedFragments = 0,
      brokenBonds = 0;
    for (const island of this.islands.values()) {
      if (island.settled) {
        settledBodies++;
      } else if (island.body.isSleeping()) {
        sleepingBodies++;
      } else {
        activeBodies++;
      }
    }
    for (const child of this.secondary) {
      if (child.attachedRoot !== undefined) {
        continue;
      }
      if (child.settled) {
        settledBodies++;
      } else if (child.body.isSleeping()) {
        sleepingBodies++;
      } else {
        activeBodies++;
      }
    }
    for (const ball of this.cannonballs) {
      if (ball.body.isSleeping()) {
        sleepingBodies++;
      } else {
        activeBodies++;
      }
    }
    for (const [index, state] of this.states.entries()) {
      if (
        !this.visibleChunks.has(index) ||
        this.refined.has(index) ||
        this.retired.has(index)
      ) {
        continue;
      }
      if (state === FragmentState.Supported) {
        supportedFragments++;
      } else {
        detachedFragments++;
      }
    }
    for (const child of this.secondary) {
      if (
        child.attachedRoot !== undefined &&
        this.states[child.attachedRoot] === FragmentState.Supported
      ) {
        supportedFragments++;
      } else {
        detachedFragments++;
      }
    }
    for (const state of this.graph.states) {
      if (state === 3) {
        brokenBonds++;
      }
    }
    const frame: SimulationFrame = {
      bondStates: this.graph.states.slice(),
      ...(this.graph.bondRevision > 0
        ? {
            bonds: this.manifest.bonds.slice(),
            bondRevision: this.graph.bondRevision,
          }
        : {}),
      ordnance: this.ordnanceFrame(),
      states: this.presentationStates(),
      topologySupported: this.graph.supported.slice(),
      visibleChunks: Uint32Array.from(this.visibleChunks),
      actors: this.graph.getActors(),
      stress: this.graph.fragmentUtilization.slice(),
      stressKnown:
        this.graph.fragmentStressKnown?.slice() ??
        new Uint8Array(this.states.length),
      tick: this.tick,
      transforms: this.transforms.slice(),
      type: "frame",
      ...(this.secondaryRevision > 0 ||
      this.retired.size > 0 ||
      this.refined.size > 0
        ? { secondary: this.secondaryFrame() }
        : {}),
      ...(this.player ? { player: this.player.frame() } : {}),
      aim: this.playerAimFrame(),
      events: this.events.slice(),
      stats: {
        activeBodies,
        brokenBonds,
        capacityEvents: this.capacityEvents,
        checksum: this.graph.checksum(),
        commands: this.processedCommands,
        crushedFragments: this.crushedFragments,
        crushedMass: this.crushedMass,
        budgetBaked: this.budgetBaked,
        budgetBakedTotal: this.budgetBakedTotal,
        budgetDeferred: this.budgetDeferred,
        budgetLimitMs: this.budget.dtMs,
        budgetRung: this.budget.rung,
        budgetStepMs: this.budget.cost,
        debrisCap: this.debrisCap,
        debrisLive: this.secondary.reduce(
          (count, child) =>
            count + (this.tierDebris(child) ? 1 : 0),
          [...this.islands.values()].filter((island) => this.tierIslandDebris(island)).length,
        ),
        debrisSunk: this.debrisSunk,
        detachedFragments,
        droppedFrames: this.droppedFrames,
        evictedFragments: this.evictedFragments,
        healedRoots: this.healedRoots,
        maxUtilization: this.graph.solverStats.maxUtilization,
        physicsMs: this.physicsMs,
        nativeStepMs: this.nativeStepMs,
        secondaryFragments: this.secondary.length,
        settledBodies,
        sleepingBodies,
        solverConverged: this.graph.solverStats.converged,
        solverIterations: this.graph.solverStats.iterations,
        solverResidual: this.graph.solverStats.residual,
        structuralDeferred: this.graph.solverStats.deferred,
        structuralSolver: this.graph.structuralSolver,
        structuralDirectMs: this.graph.directResult?.elapsedMs,
        structuralFactorColumns: this.graph.directResult?.factorizedColumns,
        structuralMs: this.structuralMs,
        structuralWorkUnits: this.graph.solverStats.workUnits,
        supportedFragments,
        tick: this.tick,
        totalBonds: this.manifest.bonds.length,
        workerMs: this.workerMs,
      },
    };
    frame.stats.snapshotMs = performance.now() - snapshotStarted;
    return frame;
  }

  recordReplay(): ReplayLog {
    this.assertLive();
    if (!this.ownsWorld) {
      throw new Error(
        "Shared-world destruction replay requires the host authoritative state and input log; record commandLog with the host replay.",
      );
    }
    return {
      assetHash: this.manifest.assetHash,
      commands: this.commandLog
        .filter((c) => c.tick <= this.tick)
        .map((c) => ({
          ...c,
          direction: [...c.direction],
          position: [...c.position],
          ...(c.impulse ? { impulse: [...c.impulse] as Vec3 } : {}),
        })),
      scenario: this.manifest.scenario,
      simulationVersion: this.physicsOperations.length
        ? this.physicsOperationsVersion
        : this.simulationVersion,
      version: 1,
      ...(this.physicsOperations.length
        ? { physicsOperations: structuredClone(this.physicsOperations) }
        : {}),
      endTick: this.tick,
    };
  }

  /**
   * The host's wall-clock cost of the step it just ran, snapshot included. This is telemetry only;
   * physics admission and the budget ladder use deterministic work counts.
   */
  noteStepCost(ms: number): void {
    if (Number.isFinite(ms) && ms >= 0) {
      this.reportedStepMs = ms;
    }
  }

  noteDroppedFrames(count: number): void {
    this.droppedFrames += Math.max(0, Math.floor(count));
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.compliantConnections?.dispose();
    this.player?.dispose();
    this.eventsQueue?.free();
    if (this.ownsWorld) {
      this.world.free();
    } else {
      for (const body of this.ownedBodies.values()) {
        this.removeRigidBody(body);
      }
      for (const collider of this.ownedColliders.values()) {
        this.removeCollider(collider, true);
      }
    }
    this.ownedBodies.clear();
    this.ownedColliders.clear();
    this.pendingColliderMass.clear();
    this.pendingContactWarmstart.clear();
    this.bearingSupports.clear();
    this.bearingNodes.clear();
    this.failedBearingPoses = new WeakMap();
    this.bearingContactWrenches.clear();
    this.secondaryBearingContactWrenches.clear();
    this.secondaryBearingLoads.clear();
    this.secondaryContactWrenches.clear();
    this.forwardedContacts.length = 0;
    this.seen.clear();
    this.commandHistoryKeys.clear();
    this.navigationGeometry = undefined;
    this.dynamicGeometry = undefined;
    this.queue = [];
    this.collisionObjects.clear();
    this.physicsOperations.length = 0;
    this.islands.clear();
    this.supportedActors.clear();
    this.supportedByFragment.clear();
    this.visibleChunks.clear();
    this.staticColliders.clear();
    this.colliderFragments.clear();
    this.explosives.length = 0;
    this.cannonballs.length = 0;
    this.ballColliders.clear();
    this.ballImpactEffects.clear();
    this.contactHistory.clear();
    this.workContactPairs.clear();
    this.refined.clear();
    this.secondary.length = 0;
    this.visualRetirements.length = 0;
    this.secondaryById.clear();
    this.secondaryColliders.clear();
    this.lineage.clear();
    this.impactRecords.clear();
    this.hulls.clear();
    this.collisionEnvelopes.clear();
    this.landingImpulses.length = 0;
    this.preStepVelocity.clear();
    this.cooldowns.clear();
    this.retired.clear();
    this.createdThisTick.clear();
    this.pressureLaunches.clear();
    this.pressureBursts.clear();
    this.pressureDescendants.clear();
    this.attachedVolumes.clear();
    this.crushQueue = [];
    this.detonated = [];
    this.crushLoad.fill(0);
    this.fractureSplits = 0;
    this.impactFractures = 0;
  }

  get topologyVersion(): number {
    return this.topologyRevision;
  }

  get geometryVersion(): number {
    return this.geometryRevision;
  }

  fragmentForCollider(handle: number): number | undefined {
    this.assertLive();
    const child = this.secondaryColliders.get(handle);
    if (child) {
      return child.fragment.id;
    }
    const index = this.colliderFragments.get(handle);
    return index === undefined ? undefined : this.manifest.fragments[index]?.id;
  }

  fragmentColliders(): ReadonlyArray<{
    debris?: true;
    fragmentId: number;
    handle: number;
  }> {
    this.assertLive();
    return [
      ...[...this.colliderFragments]
        .filter(([handle]) => !this.secondaryColliders.has(handle))
        .map(([handle, index]) => ({
          fragmentId: this.manifest.fragments[index]!.id,
          handle,
        })),
      ...[...this.secondaryColliders].map(([handle, child]) => ({
        ...(this.isDebris(child) ? { debris: true as const } : {}),
        fragmentId: child.fragment.id,
        handle,
      })),
    ].sort((a, b) => a.fragmentId - b.fragmentId);
  }

  private isDebris(child: SecondaryBody): boolean {
    return (
      child.attachedRoot === undefined &&
      volumeOf(child.fragment) < DEBRIS_VOLUME
    );
  }

  private navigableChild(child: SecondaryBody): boolean {
    if (child.attachedRoot !== undefined) {
      const state = this.states[child.attachedRoot]!;
      return (
        state === FragmentState.Supported || state === FragmentState.Settled
      );
    }
    return child.settled && volumeOf(child.fragment) >= DEBRIS_VOLUME;
  }

  collisionGeometry({
    includeDynamic = false,
  }: { includeDynamic?: boolean } = {}): DestructionCollisionGeometry {
    this.assertLive();
    const cached = includeDynamic
      ? this.dynamicGeometry
      : this.navigationGeometry;
    if (cached) {
      return cached;
    }
    const positions: Array<number> = [],
      indices: Array<number> = [];
    const append = (fragment: FragmentDef, collider: RAPIER.Collider) => {
      const [x, y, z] = fragment.size.map((value) => value / 2);
      const vertices: ReadonlyArray<Vec3> = fragment.shape?.vertices ?? [
        [-x!, -y!, -z!],
        [x!, -y!, -z!],
        [x!, y!, -z!],
        [-x!, y!, -z!],
        [-x!, -y!, z!],
        [x!, -y!, z!],
        [x!, y!, z!],
        [-x!, y!, z!],
      ];
      const faces = fragment.shape?.faces.map((face) => face.vertices) ?? [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 4, 7, 3],
        [1, 2, 6, 5],
        [0, 1, 5, 4],
        [3, 7, 6, 2],
      ];
      const base = positions.length / 3,
        translation = collider.translation(),
        rotation = collider.rotation();
      for (const vertex of vertices) {
        const rotated = rotate(rotation, vec(vertex));
        positions.push(
          translation.x + rotated.x,
          translation.y + rotated.y,
          translation.z + rotated.z,
        );
      }
      for (const face of faces) {
        for (let index = 1; index + 1 < face.length; index++) {
          indices.push(
            base + face[0]!,
            base + face[index]!,
            base + face[index + 1]!,
          );
        }
      }
    };
    for (const { handle } of this.fragmentColliders()) {
      const index = this.colliderFragments.get(handle),
        child = this.secondaryColliders.get(handle);
      if (child) {
        if (includeDynamic || this.navigableChild(child)) {
          append(child.fragment, child.collider);
        }
      } else if (index !== undefined) {
        if (
          !includeDynamic &&
          this.states[index]! !== FragmentState.Supported &&
          this.states[index]! !== FragmentState.Settled
        ) {
          continue;
        }
        append(this.manifest.fragments[index]!, this.world.getCollider(handle));
      }
    }
    const geometry = {
      indices: new Uint32Array(indices),
      positions: new Float32Array(positions),
      version: includeDynamic ? this.geometryRevision : this.navigationRevision,
    };
    if (includeDynamic) {
      this.dynamicGeometry = geometry;
    } else {
      this.navigationGeometry = geometry;
    }
    return geometry;
  }

  private refreshGeometryVersion(): void {
    const moving = this.islandsMoving;
    if (
      !moving &&
      !this.geometryMoving &&
      this.geometryTopology === this.topologyRevision &&
      this.geometrySecondary === this.secondaryRevision &&
      this.geometryTransforms === this.transformRevision
    ) {
      return;
    }
    this.geometryTransforms = this.transformRevision;
    this.geometryMoving = moving;
    this.geometryTopology = this.topologyRevision;
    this.geometrySecondary = this.secondaryRevision;
    const values: Array<number> = [this.topologyRevision];
    const navigation: Array<number> = [];
    for (let index = 0; index < this.states.length; index++) {
      values.push(this.states[index]!);
      const navigable =
        this.visibleChunks.has(index) &&
        !this.retired.has(index) &&
        (this.states[index]! === FragmentState.Supported ||
          this.states[index]! === FragmentState.Settled);
      if (navigable) {
        navigation.push(this.manifest.fragments[index]!.id);
      }
      for (let component = 0; component < 7; component++) {
        const value = this.transforms[index * TRANSFORM_STRIDE + component]!;
        values.push(value);
        if (navigable) {
          navigation.push(value);
        }
      }
      if (navigable) {
        navigation.push(
          this.refined.has(index)
            ? Math.ceil(this.attachedVolumeFraction(index) * 8)
            : 8,
        );
      }
    }
    for (const child of this.secondary) {
      const p = child.collider.translation(),
        q = child.collider.rotation();
      values.push(
        child.fragment.id,
        child.settled ? 1 : 0,
        p.x,
        p.y,
        p.z,
        q.x,
        q.y,
        q.z,
        q.w,
      );
      if (child.attachedRoot === undefined && this.navigableChild(child)) {
        navigation.push(child.fragment.id, p.x, p.y, p.z, q.x, q.y, q.z, q.w);
      }
    }
    if (
      values.length !== this.previousGeometry.length ||
      values.some((value, index) => value !== this.previousGeometry[index]!)
    ) {
      this.geometryRevision++;
      this.previousGeometry = new Float64Array(values);
      this.dynamicGeometry = undefined;
    }
    if (
      navigation.length !== this.previousNavigationGeometry.length ||
      navigation.some(
        (value, index) => value !== this.previousNavigationGeometry[index]!,
      )
    ) {
      this.navigationRevision++;
      this.previousNavigationGeometry = new Float64Array(navigation);
      this.navigationGeometry = undefined;
    }
  }

  private createRigidBody(desc: RAPIER.RigidBodyDesc): RAPIER.RigidBody {
    const body = this.world.createRigidBody(desc);
    this.ownedBodies.set(body.handle, body);
    this.bodyRevision++;
    return body;
  }

  private createCollider(
    desc: RAPIER.ColliderDesc,
    body?: RAPIER.RigidBody,
  ): RAPIER.Collider {
    const motion = this.colliderBodyMotion(body);
    const collider = this.world.createCollider(desc, body);
    this.ownedColliders.set(collider.handle, collider);
    if (body) {
      this.pendingColliderMass.add(body);
      this.restoreColliderBodyMotion(body, motion);
    }
    return collider;
  }

  private colliderBodyMotion(body?: RAPIER.RigidBody): (Motion & { center: V }) | undefined {
    return body?.isDynamic()
      ? { center: body.numColliders() ? body.worldCom() : body.translation(), velocity: body.linvel(), angular: body.angvel() }
      : undefined;
  }

  /** Collider edits change COM; preserve the velocity field of the retained rigid geometry. */
  private restoreColliderBodyMotion(body: RAPIER.RigidBody, motion: (Motion & { center: V }) | undefined): void {
    if (!motion) return;
    const center = body.worldCom(), dx = center.x - motion.center.x,
      dy = center.y - motion.center.y, dz = center.z - motion.center.z;
    if (!(dx || dy || dz)) return;
    const w = motion.angular, v = motion.velocity;
    body.setLinvel(this.pressureVelocity(body, { x: v.x + w.y * dz - w.z * dy,
      y: v.y + w.z * dx - w.x * dz, z: v.z + w.x * dy - w.y * dx }, center), false);
  }

  /** Bound only pressure-added motion, including its angular velocity at a child's COM. */
  private pressureVelocity(body: RAPIER.RigidBody, velocity: V, point: V): V {
    const launch = this.pressureLaunches.get(body);
    if (!launch) return velocity;
    const dx = point.x - launch.center.x, dy = point.y - launch.center.y, dz = point.z - launch.center.z;
    const w = launch.angular, v = launch.velocity;
    const before = { x: v.x + w.y * dz - w.z * dy,
      y: v.y + w.z * dx - w.x * dz, z: v.z + w.x * dy - w.y * dx };
    return add(before, limit({ x: velocity.x - before.x, y: velocity.y - before.y,
      z: velocity.z - before.z }, launch.speed));
  }

  /** Finalize complete assemblies before pressure, targeted impulses or joint configuration. */
  private finalizeColliderMasses(): void {
    for (const body of this.pendingColliderMass) {
      if (!body.isValid()) continue;
      const motion = this.colliderBodyMotion(body);
      body.recomputeMassPropertiesFromColliders();
      this.restoreColliderBodyMotion(body, motion);
    }
    this.pendingColliderMass.clear();
  }

  private removeRigidBody(body: RAPIER.RigidBody): void {
    this.releaseBearingSupport(body);
    this.failedBearingPoses.delete(body);
    this.pendingColliderMass.delete(body);
    this.pendingContactWarmstart.delete(body);
    for (let index = 0; index < body.numColliders(); index++) {
      this.ownedColliders.delete(body.collider(index).handle);
    }
    this.ownedBodies.delete(body.handle);
    this.bodyRevision++;
    this.releaseDependents(body.handle);
    this.world.removeRigidBody(body);
  }

  private removeCollider(collider: RAPIER.Collider, wakeUp: boolean): void {
    const body = collider.parent(), motion = this.colliderBodyMotion(body ?? undefined);
    this.ownedColliders.delete(collider.handle);
    this.world.removeCollider(collider, wakeUp);
    if (body) {
      // Native insertion adds mass immediately; removal only marks it dirty.
      // Do not let replacement colliders add onto the removed collider's mass.
      body.recomputeMassPropertiesFromColliders();
      this.restoreColliderBodyMotion(body, motion);
      this.pendingColliderMass.delete(body);
    }
  }

  private dynamicBodyCount(): number {
    if (this.dynamicCount.revision !== this.bodyRevision) {
      let count = 0;
      for (const body of this.ownedBodies.values()) {
        if (body.isDynamic()) {
          count++;
        }
      }
      this.dynamicCount = { count, revision: this.bodyRevision };
    }
    return this.dynamicCount.count;
  }

  private presentationStates(): Uint8Array {
    const states = this.states.slice();
    for (let index = 0; index < states.length; index++) {
      if (!this.visibleChunks.has(index) && !this.retired.has(index)) {
        states[index] = FragmentState.Hidden;
      }
    }
    for (const index of this.refined) {
      states[index] = FragmentState.Retired;
    }
    return states;
  }

  private materialOf(fragment: FragmentDef) {
    return this.manifest.materials.find(
      (value) => value.id === fragment.material,
    );
  }

  private chipEligible(fragment: FragmentDef, strength: number): boolean {
    const material = this.materialOf(fragment);
    return Boolean(
      material &&
      CHIP_MATERIAL.test(material.name) &&
      material.brittleness >= 0.35 &&
      strength >= 0.25,
    );
  }

  private rootOf(fragmentId: number): number | undefined {
    const primary = this.fragmentById.get(fragmentId);
    if (primary !== undefined) {
      return primary;
    }
    const rootId =
      this.secondaryById.get(fragmentId)?.fragment.rootId ??
      this.lineage.get(fragmentId)?.rootId;
    return rootId === undefined ? undefined : this.fragmentById.get(rootId);
  }

  private primaryCollider(index: number): RAPIER.Collider | undefined {
    return (
      this.staticColliders.get(index) ??
      this.actorForFragment(index)?.primaries.get(index)
    );
  }

  private descendsFrom(child: SecondaryBody, ancestorId: number): boolean {
    if (child.fragment.rootId === ancestorId) {
      return true;
    }
    let parent = child.fragment.parentId;
    for (let depth = 0; depth <= MAX_FRACTURE_GENERATION; depth++) {
      if (parent === ancestorId) {
        return true;
      }
      const entry = this.lineage.get(parent);
      if (!entry) {
        return false;
      }
      parent = entry.parentId;
    }
    return false;
  }

  private distanceTo(collider: RAPIER.Collider, point: V): number {
    const hit = collider.projectPoint(point, true);
    return hit
      ? Math.hypot(
          hit.point.x - point.x,
          hit.point.y - point.y,
          hit.point.z - point.z,
        )
      : Infinity;
  }

  private closest(
    candidates: Iterable<SecondaryBody>,
    point: V,
    radius = Infinity,
  ): SecondaryBody | undefined {
    let nearest: SecondaryBody | undefined,
      distance = Infinity;
    for (const child of candidates) {
      const current = this.distanceTo(child.collider, point);
      if (current <= radius && current < distance) {
        nearest = child;
        distance = current;
      }
    }
    return nearest;
  }

  private liveTarget(
    fragmentId: number,
    point: V,
    radius: number,
  ): LiveTarget | undefined {
    const primary = this.fragmentById.get(fragmentId);
    if (
      primary !== undefined &&
      this.visibleChunks.has(primary) &&
      !this.retired.has(primary) &&
      !this.refined.has(primary)
    ) {
      return { primary };
    }
    const child = this.secondaryById.get(fragmentId);
    if (child) {
      return { child };
    }
    if (primary !== undefined && !this.refined.has(primary)) {
      const support = this.supportAt(primary, point);
      let closest: number | undefined,
        distance = radius;
      for (const visible of this.visibleChunks) {
        let related = visible === primary;
        for (
          let ancestor = this.graph.parents[visible]!;
          ancestor >= 0 && !related;
          ancestor = this.graph.parents[ancestor]!
        )
          related = ancestor === primary;
        for (
          let ancestor = primary;
          ancestor >= 0 && !related;
          ancestor = this.graph.parents[ancestor]!
        )
          related = ancestor === visible;
        if (!related && visible !== support) continue;
        const collider = this.primaryCollider(visible);
        const candidate = collider
          ? this.distanceTo(collider, point)
          : Infinity;
        if (candidate <= distance) {
          closest = visible;
          distance = candidate;
        }
      }
      if (closest !== undefined) return { primary: closest };
    }
    const entry = this.lineage.get(fragmentId);
    if (primary === undefined && !entry) {
      return undefined;
    }
    const nearest = this.closest(
      this.secondary.filter((candidate) =>
        this.descendsFrom(candidate, fragmentId),
      ),
      point,
      radius,
    );
    const root = entry ? this.fragmentById.get(entry.rootId) : undefined;
    if (root === undefined || this.retired.has(root)) {
      return nearest ? { child: nearest } : undefined;
    }
    if (!this.refined.has(root)) {
      const collider = this.primaryCollider(root);
      const distance = collider ? this.distanceTo(collider, point) : Infinity;
      return nearest && this.distanceTo(nearest.collider, point) < distance
        ? { child: nearest }
        : distance <= radius
          ? { primary: root }
          : undefined;
    }
    const fallback =
      nearest ??
      this.closest(
        this.secondary.filter(
          (candidate) => candidate.fragment.rootId === entry!.rootId,
        ),
        point,
        radius,
      );
    return fallback ? { child: fallback } : undefined;
  }

  private remember(child: SecondaryBody): void {
    this.lineage.delete(child.fragment.id);
    this.lineage.set(child.fragment.id, {
      parentId: child.fragment.parentId,
      rootId: child.fragment.rootId,
    });
    while (this.lineage.size > MAX_SECONDARY_LINEAGE) {
      this.lineage.delete(this.lineage.keys().next().value!);
    }
  }

  private addSecondary(piece: SecondaryBody): void {
    this.secondary.push(piece);
    this.trimVisualRetirements();
    this.secondaryById.set(piece.fragment.id, piece);
    this.secondaryColliders.set(piece.collider.handle, piece);
    this.createdThisTick.add(piece);
    if (piece.attachedRoot !== undefined) {
      this.colliderFragments.set(piece.collider.handle, piece.attachedRoot);
      this.attachedVolumes.delete(piece.attachedRoot);
    }
  }

  private detachCollider(child: SecondaryBody): void {
    const collider = child.collider;
    this.wakeSupportContacts(collider);
    this.secondaryColliders.delete(collider.handle);
    this.colliderFragments.delete(collider.handle);
    const island =
      child.attachedRoot === undefined
        ? undefined
        : this.actorForFragment(child.attachedRoot);
    if (island && island.body.handle === child.body.handle) {
      island.colliders = island.colliders.filter(
        (value) => value.handle !== collider.handle,
      );
      this.removeCollider(collider, true);
    } else {
      this.removeRigidBody(child.body);
    }
  }

  private removeSecondary(child: SecondaryBody): void {
    this.detachCollider(child);
    this.forgetSecondary(child);
  }

  private forgetSecondary(child: SecondaryBody): void {
    this.createdThisTick.delete(child);
    if (child.attachedRoot !== undefined) {
      this.attachedVolumes.delete(child.attachedRoot);
    }
    const slot = this.secondary.indexOf(child);
    if (slot >= 0) {
      this.secondary.splice(slot, 1);
    }
    this.secondaryById.delete(child.fragment.id);
    this.hulls.delete(child.fragment.id);
    this.collisionEnvelopes.delete(child.fragment.id);
    this.remember(child);
  }

  private releaseChild(child: SecondaryBody): void {
    const center = child.collider.translation(),
      rotation = child.collider.rotation();
    const velocity = child.body.velocityAtPoint(center),
      angular = child.body.angvel();
    this.detachCollider(child);
    if (child.attachedRoot !== undefined) {
      this.attachedVolumes.delete(child.attachedRoot);
    }
    child.attachedRoot = undefined;
    child.body = this.createRigidBody(
      this.rapier.RigidBodyDesc.dynamic()
        .setTranslation(center.x, center.y, center.z)
        .setRotation(rotation)
        .setLinvel(velocity.x, velocity.y, velocity.z)
        .setAngvel(angular)
        .setLinearDamping(0.15)
        .setAngularDamping(this.angularDamping(child.fragment))
        .setCanSleep(true)
        .setCcdEnabled(true),
    );
    child.collider = this.createCollider(
      this.fragmentColliderDesc(child.fragment),
      child.body,
    );
    child.settled = false;
    child.stableTicks = 0;
    this.secondaryColliders.set(child.collider.handle, child);
    this.topologyRevision++;
  }

  private angularDamping(fragment: FragmentDef): number {
    return volumeOf(fragment) < DEBRIS_VOLUME
      ? DEBRIS_ANGULAR_DAMPING
      : RUBBLE_ANGULAR_DAMPING;
  }

  private chargedPieces(): Set<number> {
    const charged = new Set<number>();
    for (const charge of this.explosives) {
      if (charge.secondaryId !== undefined) {
        charged.add(charge.secondaryId);
      }
    }
    return charged;
  }

  private evict(child: SecondaryBody): void {
    this.removeSecondary(child);
    this.evictedFragments++;
  }

  private reserve(
    live: number,
    dynamic: number,
    exclude: ReadonlySet<SecondaryBody>,
    involved: ReadonlySet<number> = new Set(),
  ): boolean {
    const liveOverflow = this.secondary.length + this.retiringSecondaryCount() + live - MAX_SECONDARY_FRAGMENTS;
    const dynamicOverflow =
      dynamic > 0 ? this.dynamicBodyCount() + dynamic - MAX_DYNAMIC_BODIES : 0;
    if (liveOverflow <= 0 && dynamicOverflow <= 0) {
      return true;
    }
    const charged = this.chargedPieces();
    const pinned = (child: SecondaryBody) =>
      exclude.has(child) ||
      this.createdThisTick.has(child) ||
      charged.has(child.fragment.id);
    const resting = (child: SecondaryBody) =>
      child.settled || child.body.isSleeping();
    const loose = this.secondary
      .filter((child) => child.attachedRoot === undefined && !pinned(child))
      .sort(
        (a, b) =>
          (a.settled ? 0 : 1) - (b.settled ? 0 : 1) ||
          (resting(a) ? 0 : 1) - (resting(b) ? 0 : 1) ||
          a.fragment.id - b.fragment.id,
      );
    const quiet = loose.filter(resting);
    const victims = quiet.slice(0, Math.max(liveOverflow, dynamicOverflow));
    const chosen = new Set<SecondaryBody>(victims);
    let liveNeed = liveOverflow - victims.length,
      dynamicNeed = dynamicOverflow - victims.length;
    const heals: Array<{ pieces: Array<SecondaryBody>; root: number }> = [];
    if (liveNeed > 0) {
      const families = new Map<number, Array<SecondaryBody>>();
      for (const child of this.secondary) {
        const family = families.get(child.fragment.rootId);
        if (family) {
          family.push(child);
        } else {
          families.set(child.fragment.rootId, [child]);
        }
      }
      const candidates = [...this.refined]
        .filter(
          (root) =>
            !this.retired.has(root) &&
            !involved.has(root) &&
            this.lastImpactTick[root]! !== this.tick &&
            !(families.get(this.manifest.fragments[root]!.id) ?? []).some(
              pinned,
            ),
        )
        .sort(
          (a, b) => this.lastImpactTick[a]! - this.lastImpactTick[b]! || a - b,
        );
      for (const root of candidates) {
        if (liveNeed <= 0) {
          break;
        }
        const pieces = (
          families.get(this.manifest.fragments[root]!.id) ?? []
        ).filter((child) => !chosen.has(child));
        for (const child of pieces) {
          chosen.add(child);
          liveNeed--;
          if (child.attachedRoot === undefined) {
            dynamicNeed--;
          }
        }
        heals.push({ pieces, root });
      }
    }
    const moving = loose.filter(
      (child) => !chosen.has(child) && !resting(child),
    );
    const extra = Math.max(liveNeed, dynamicNeed, 0);
    if (moving.length < extra) {
      return false;
    }
    for (const child of victims) {
      this.evict(child);
    }
    for (const { pieces, root } of heals) {
      this.heal(root, pieces, pinned);
    }
    let remaining = Math.max(
      this.secondary.length + this.retiringSecondaryCount() + live - MAX_SECONDARY_FRAGMENTS,
      dynamic > 0 ? this.dynamicBodyCount() + dynamic - MAX_DYNAMIC_BODIES : 0,
    );
    for (const child of moving) {
      if (remaining <= 0) {
        break;
      }
      if (this.secondaryById.get(child.fragment.id) === child) {
        this.evict(child);
        remaining--;
      }
    }
    this.secondaryRevision++;
    this.topologyRevision++;
    return true;
  }

  private heal(
    root: number,
    pieces: ReadonlyArray<SecondaryBody>,
    pinned: (child: SecondaryBody) => boolean,
  ): void {
    for (const child of pieces) {
      if (this.secondaryById.get(child.fragment.id) === child) {
        this.evict(child);
      }
    }
    this.refined.delete(root);
    this.attachedVolumes.delete(root);
    const fragment = this.manifest.fragments[root]!;
    this.graph.setFragmentMass(root, fragment.mass);
    const island = this.actorForFragment(root);
    let collider: RAPIER.Collider;
    if (island) {
      const pose = island.poses.get(root)!;
      collider = this.createCollider(
        this.colliderDesc(root)
          .setTranslation(pose.position.x, pose.position.y, pose.position.z)
          .setRotation(pose.rotation),
        island.body,
      );
      island.primaries.set(root, collider);
      island.colliders.push(collider);
      if (this.supportedActors.get(island.key) === island)
        this.staticColliders.set(root, collider);
    } else {
      const p = this.position(root);
      collider = this.createCollider(
        this.colliderDesc(root)
          .setTranslation(p.x, p.y, p.z)
          .setRotation(this.rotation(root)),
      );
      this.staticColliders.set(root, collider);
    }
    this.colliderFragments.set(collider.handle, root);
    this.healedRoots++;
    const radius = Math.hypot(...fragment.size) / 2;
    const center = collider.translation();
    for (const child of this.secondary.slice()) {
      if (child.attachedRoot !== undefined || pinned(child)) {
        continue;
      }
      const p = child.collider.translation();
      if (
        Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z) >
        radius + Math.hypot(...child.fragment.size) / 2
      ) {
        continue;
      }
      const contact = collider.contactCollider(child.collider, 0);
      if (contact && contact.distance < -HEAL_OVERLAP) {
        this.evict(child);
      }
    }
  }

  private retiringSecondaryCount(): number {
    // These pieces occupied secondary slots during the former one-second native sink.
    // Synthetic primary visuals must not change physical secondary fracture capacity.
    return this.visualRetirements.reduce((sum, item) => sum + item.evicted, 0);
  }

  private finishVisualRetirement(index: number): void {
    const [retirement] = this.visualRetirements.splice(index, 1);
    if (!retirement) return;
    this.evictedFragments += retirement.evicted;
    this.debrisSunk++;
    this.secondaryRevision++;
  }

  /** Visual capacity pressure may release older visuals, never live physical pieces. */
  private trimVisualRetirements(additional = 0): number {
    let count = this.visualRetirements.reduce((sum, item) => sum + item.fragments.length, 0);
    while (this.visualRetirements.length && this.secondary.length + count + additional > MAX_SECONDARY_FRAGMENTS) {
      count -= this.visualRetirements[0]!.fragments.length;
      this.finishVisualRetirement(0);
    }
    return Math.max(0, MAX_SECONDARY_FRAGMENTS - this.secondary.length - count);
  }

  private reserveIds(count: number): boolean {
    const last = this.nextSecondaryId + count - 1;
    return (
      Number.isSafeInteger(last) &&
      last < this.secondaryIdBase + MAX_SECONDARY_ID_SPAN
    );
  }

  private attachedVolumeFraction(root: number): number {
    let volume = this.attachedVolumes.get(root);
    if (volume === undefined) {
      volume = 0;
      for (const child of this.secondary) {
        if (child.attachedRoot === root) {
          volume += volumeOf(child.fragment);
        }
      }
      this.attachedVolumes.set(root, volume);
    }
    return volume / volumeOf(this.manifest.fragments[root]!);
  }

  private attachedCenter(root: number): { center: V; mass: number } {
    const parent = this.manifest.fragments[root]!,
      origin = this.position(root),
      rotation = this.rotation(root);
    const center = { x: 0, y: 0, z: 0 };
    let mass = 0;
    for (const child of this.secondary) {
      if (child.attachedRoot !== root) {
        continue;
      }
      const offset = rotate(rotation, {
        x: child.fragment.position[0] - parent.position[0],
        y: child.fragment.position[1] - parent.position[1],
        z: child.fragment.position[2] - parent.position[2],
      });
      const m = child.fragment.mass;
      center.x += (origin.x + offset.x) * m;
      center.y += (origin.y + offset.y) * m;
      center.z += (origin.z + offset.z) * m;
      mass += m;
    }
    if (!(mass > 0)) {
      return { center: origin, mass: this.graph.fragmentMass[root]! };
    }
    return {
      center: { x: center.x / mass, y: center.y / mass, z: center.z / mass },
      mass,
    };
  }

  private updateSections(
    root: number,
    children: ReadonlyArray<SecondaryBody>,
  ): void {
    const parent = this.manifest.fragments[root]!;
    const [hx, hy, hz] = parent.size.map((value) => value / 2) as [
      number,
      number,
      number,
    ];
    const vertices: ReadonlyArray<Vec3> = parent.shape?.vertices ?? [
      [-hx, -hy, -hz],
      [hx, hy, hz],
      [hx, -hy, -hz],
      [-hx, hy, -hz],
      [-hx, -hy, hz],
      [hx, hy, -hz],
      [hx, -hy, hz],
      [-hx, hy, hz],
    ];
    for (const index of this.graph.incidentBonds(root)) {
      if (this.graph.states[index] === BondState.Broken) {
        continue;
      }
      const bond = this.manifest.bonds[index]!;
      const sign = bond.a === parent.id ? 1 : -1;
      const normal: Vec3 = [
        bond.normal[0] * sign,
        bond.normal[1] * sign,
        bond.normal[2] * sign,
      ];
      const along = (point: Vec3) =>
        normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2];
      let low = Infinity,
        high = -Infinity;
      for (const vertex of vertices) {
        low = Math.min(low, along(vertex));
        high = Math.max(high, along(vertex));
      }
      const face = bond.section
        ? clamp(
            along([
              bond.section.point[0] - parent.position[0],
              bond.section.point[1] - parent.position[1],
              bond.section.point[2] - parent.position[2],
            ]),
            low,
            high,
          )
        : high;
      const level = face - Math.min((high - low) * 0.25, SECTION_INSET);
      const total = crossSectionArea(parent, normal, level);
      if (!(total > 0)) {
        continue;
      }
      let live = 0;
      for (const child of children) {
        live += crossSectionArea(
          child.fragment,
          normal,
          level -
            along([
              child.fragment.position[0] - parent.position[0],
              child.fragment.position[1] - parent.position[1],
              child.fragment.position[2] - parent.position[2],
            ]),
        );
      }
      this.graph.setBondSectionFraction(index, live / total);
    }
  }

  private retireRoot(root: number): void {
    this.refined.delete(root);
    this.retired.add(root);
    this.visibleChunks.delete(root);
    this.states[root] = FragmentState.Retired;
    this.graph.removeFragment(root);
    this.impactTopologyDirty = true;
    this.topologyRevision++;
  }

  private refreshRoot(root: number): void {
    if (this.retired.has(root) || !this.refined.has(root)) {
      return;
    }
    const parent = this.manifest.fragments[root]!;
    const children = this.secondary.filter(
      (child) => child.attachedRoot === root,
    );
    let mass = 0,
      volume = 0;
    for (const child of children) {
      mass += child.fragment.mass;
      volume += volumeOf(child.fragment);
    }
    if (children.length && volume >= volumeOf(parent) * ROOT_RETIRE_FRACTION) {
      this.graph.setFragmentMass(root, Math.min(mass, parent.mass));
      this.updateSections(root, children);
      return;
    }
    if (
      children.length &&
      !this.reserve(0, children.length, new Set(children))
    ) {
      this.capacityEvents++;
      this.graph.setFragmentMass(root, Math.min(mass, parent.mass));
      this.updateSections(root, children);
      return;
    }
    for (const child of children) {
      this.releaseChild(child);
    }
    this.retireRoot(root);
  }

  private spallVelocity(
    seed: number,
    axis: V,
    radial: V,
    speed: number,
  ): { angular: V; velocity: V } {
    const next = random(seed);
    const jitter = unit({
      x: next() * 2 - 1,
      y: next() * 2 - 1,
      z: next() * 2 - 1,
    });
    const spread = unit(radial);
    const direction = unit({
      x: -axis.x + spread.x * 0.3 + jitter.x * 0.1,
      y: -axis.y + spread.y * 0.3 + jitter.y * 0.1,
      z: -axis.z + spread.z * 0.3 + jitter.z * 0.1,
    });
    const spin = MAX_SPALL_SPIN / Math.sqrt(3);
    return {
      angular: {
        x: (next() * 2 - 1) * spin,
        y: (next() * 2 - 1) * spin,
        z: (next() * 2 - 1) * spin,
      },
      velocity: {
        x: direction.x * speed,
        y: direction.y * speed,
        z: direction.z * speed,
      },
    };
  }

  private cappedImpulse(body: RAPIER.RigidBody, impulse: V): V {
    const mass = body.mass(),
      magnitude = Math.sqrt(squared(impulse));
    if (!(mass > 0) || magnitude <= MAX_IMPACT_SPEED * mass) {
      return impulse;
    }
    const scale = (MAX_IMPACT_SPEED * mass) / magnitude;
    return { x: impulse.x * scale, y: impulse.y * scale, z: impulse.z * scale };
  }

  private drillsThrough(child: SecondaryBody, direction: V): boolean {
    const root = child.attachedRoot!;
    const parent = this.manifest.fragments[root]!;
    const axis = rotate(inverse(this.rotation(root)), unit(direction));
    const along = (point: Vec3) =>
      point[0] * axis.x + point[1] * axis.y + point[2] * axis.z;
    const [hx, hy, hz] = parent.size.map((value) => value / 2) as [
      number,
      number,
      number,
    ];
    const corners: ReadonlyArray<Vec3> = parent.shape?.vertices ?? [
      [-hx, -hy, -hz],
      [hx, hy, hz],
      [hx, -hy, -hz],
      [-hx, hy, -hz],
      [-hx, -hy, hz],
      [hx, hy, -hz],
      [hx, -hy, hz],
      [-hx, hy, hz],
    ];
    const back = Math.max(...corners.map(along));
    const offset = child.fragment.position.map(
      (value, component) => value - parent.position[component]!,
    ) as Vec3;
    const reach = Math.max(
      ...(child.fragment.shape?.vertices ?? []).map((vertex) =>
        along([
          vertex[0] + offset[0],
          vertex[1] + offset[1],
          vertex[2] + offset[2],
        ]),
      ),
    );
    return reach >= back - DRILL_MARGIN;
  }

  private releaseAttached(
    child: SecondaryBody | undefined,
    command: DestructionCommand,
    seed: number,
  ): void {
    if (
      !child ||
      child.attachedRoot === undefined ||
      volumeOf(child.fragment) > CHIP_RELEASE_VOLUME ||
      this.drillsThrough(child, vec(command.direction))
    ) {
      return;
    }
    if (!this.reserve(0, 1, new Set([child]))) {
      this.capacityEvents++;
      return;
    }
    const root = child.attachedRoot;
    this.releaseChild(child);
    const energy = 0.005 * (90 * command.strength) ** 2;
    const speed = Math.min(
      Math.sqrt((2 * energy) / child.fragment.mass),
      MAX_SPALL_SPEED,
    );
    const launch = this.spallVelocity(
      seed,
      unit(vec(command.direction)),
      ZERO,
      speed,
    );
    child.body.setLinvel(
      limit(
        add(limit(child.body.linvel(), MAX_IMPACT_SPEED), launch.velocity),
        MAX_DEBRIS_SPEED,
      ),
      true,
    );
    child.body.setAngvel(
      limit(add(child.body.angvel(), launch.angular), MAX_DEBRIS_SPIN),
      true,
    );
    this.impactRecords.set(command, { consumed: true });
    this.impactFractures++;
    this.refreshRoot(root);
  }

  private fractureImpacts(
    commands: Array<DestructionCommand>,
  ): Array<DestructionCommand> {
    const structural: Array<DestructionCommand> = [];
    for (const command of commands) {
      if (command.type !== "pointImpact" || command.fragmentId === undefined) {
        structural.push(command);
        continue;
      }
      const point = vec(command.position);
      const target = this.liveTarget(command.fragmentId, point, command.radius);
      const rootIndex =
        target?.primary ??
        target?.child?.attachedRoot ??
        this.rootOf(command.fragmentId);
      const rootFragment =
        rootIndex === undefined
          ? undefined
          : this.manifest.fragments[rootIndex];
      if (
        !rootFragment ||
        this.graph.children[rootIndex!]?.length ||
        !this.chipEligible(rootFragment, command.strength)
      ) {
        structural.push(command);
        continue;
      }
      const child = target?.child;
      const anchored = child
        ? child.attachedRoot !== undefined
        : target?.primary !== undefined ||
          this.fragmentById.has(command.fragmentId);
      const finish = () => {
        if (anchored) {
          this.lastImpactTick[rootIndex!] = this.tick;
          structural.push({
            ...command,
            fragmentId: rootFragment.id,
            strength: command.strength * IMPACT_CRACK_SHARE,
          });
        }
      };
      const primary = target?.primary;
      const parent =
        child?.fragment ??
        (primary === undefined ? undefined : this.manifest.fragments[primary]);
      const collider =
        child?.collider ??
        (primary === undefined ? undefined : this.primaryCollider(primary));
      const material = parent && this.materialOf(parent);
      if (!parent || !collider || !material) {
        finish();
        continue;
      }
      if (
        command.strength / (material.health ?? 1) <=
        (material.minDamageThreshold ?? 0.02)
      ) {
        finish();
        continue;
      }
      if (
        this.impactFractures >=
        MAX_IMPACT_FRACTURES_PER_TICK * this.tickScale
      ) {
        this.capacityEvents++;
        finish();
        continue;
      }
      const projection = collider.projectPoint(point, true);
      if (
        !projection ||
        Math.hypot(
          projection.point.x - point.x,
          projection.point.y - point.y,
          projection.point.z - point.z,
        ) > command.radius
      ) {
        finish();
        continue;
      }
      const seed =
        (Math.imul(parent.id, 73_856_093) ^
          Math.imul(command.id, 19_349_663) ^
          Math.imul(command.source, 83_492_791) ^
          this.tick) >>>
        0;
      const generation = child?.fragment.generation ?? 0;
      if (generation >= MAX_FRACTURE_GENERATION) {
        this.releaseAttached(child, command, seed);
        finish();
        continue;
      }
      const center = collider.translation(),
        rotation = collider.rotation();
      const toLocal = inverse(rotation);
      const local = rotate(toLocal, {
        x: projection.point.x - center.x,
        y: projection.point.y - center.y,
        z: projection.point.z - center.z,
      });
      const fracture = generateImpactSubgraphFracture(
        parent,
        material,
        command.strength,
        tuple(local),
        tuple(rotate(toLocal, vec(command.direction))),
        seed,
      );
      if (!fracture) {
        this.releaseAttached(child, command, seed);
        finish();
        continue;
      }
      this.applyImpactSubgraphFracture(fracture, {
        command,
        rootIndex: rootIndex!,
        primary,
        child,
        parent,
        collider,
        generation,
        center,
        rotation,
        point: projection.point,
        seed,
      });
      finish();
    }
    return structural;
  }

  /** Applies already-generated geometric fracture commands to colliders, bodies and chunk mass. */
  private applyImpactSubgraphFracture(
    fracture: ImpactSubgraphFractureCommand,
    context: {
      command: DestructionCommand;
      rootIndex: number;
      primary?: number;
      child?: SecondaryBody;
      parent: FragmentDef;
      collider: RAPIER.Collider;
      generation: number;
      center: V;
      rotation: Q;
      point: V;
      seed: number;
    },
  ): void {
    const {
      command,
      rootIndex,
      primary,
      child,
      parent,
      collider,
      generation,
      center,
      rotation,
      point,
      seed,
    } = context;
    const { partition } = fracture;
    if (fracture.chunkId !== parent.id) return;
    const root = child ? child.attachedRoot : primary;
    const island = root === undefined ? undefined : this.actorForFragment(root);
    const parentBody = collider.parent();
    const moving = Boolean(parentBody?.isDynamic());
    const count = partition.retained.length + partition.detached.length;
    const dynamic =
      partition.detached.length +
      (root === undefined ? partition.retained.length : 0) -
      (child && root === undefined ? 1 : 0);
    if (
      !this.reserveIds(count) ||
      !this.reserve(
        count - (child ? 1 : 0),
        dynamic,
        new Set(child ? [child] : []),
        new Set([rootIndex!]),
      )
    ) {
      this.capacityEvents++;
      return;
    }
    const axis = unit(rotate(rotation, vec(partition.axis)));
    const impulse = vec(command.impulse ?? [0, 0, 0]);
    const bullet = moving
      ? {
          x: impulse.x / parent.mass,
          y: impulse.y / parent.mass,
          z: impulse.z / parent.mass,
        }
      : { x: 0, y: 0, z: 0 };
    const chipMass = partition.detached.reduce(
      (sum, piece) => sum + piece.mass,
      0,
    );
    const spallSpeed =
      chipMass > 0
        ? Math.min(
            Math.sqrt((2 * 0.005 * (90 * command.strength) ** 2) / chipMass),
            MAX_SPALL_SPEED,
          )
        : 0;
    const rootId = child ? child.fragment.rootId : parent.id;
    const prepared = [
      ...partition.retained.map((fragment) => ({ chip: false, fragment })),
      ...partition.detached.map((fragment) => ({ chip: true, fragment })),
    ].map(({ chip, fragment }, slot) => {
      const offset = rotate(rotation, vec(fragment.position));
      const position = {
        x: center.x + offset.x,
        y: center.y + offset.y,
        z: center.z + offset.z,
      };
      const definition: SecondaryFragmentDef = {
        ...fragment,
        generation: generation + 1,
        depth: (parent.depth ?? 2) + 1,
        support: false,
        parent: parent.id,
        id: this.nextSecondaryId + slot,
        parentId: parent.id,
        position: parent.position.map(
          (value, component) => value + fragment.position[component]!,
        ) as Vec3,
        rootId,
      };
      // Capture the source envelope before removeSecondary drops its cached definition.
      this.collisionEnvelope(definition);
      const inherited =
        parentBody && moving
          ? limit(parentBody.velocityAtPoint(position), MAX_IMPACT_SPEED)
          : ZERO;
      let velocity = inherited;
      let angular =
        parentBody && moving
          ? limit(parentBody.angvel(), MAX_DEBRIS_SPIN)
          : ZERO;
      if (chip) {
        const relative = {
          x: position.x - point.x,
          y: position.y - point.y,
          z: position.z - point.z,
        };
        const height =
          relative.x * axis.x + relative.y * axis.y + relative.z * axis.z;
        const launch = this.spallVelocity(
          (seed ^ Math.imul(slot + 1, 0x9e_37_79_b1)) >>> 0,
          axis,
          {
            x: relative.x - axis.x * height,
            y: relative.y - axis.y * height,
            z: relative.z - axis.z * height,
          },
          spallSpeed,
        );
        velocity = limit(add(inherited, launch.velocity), MAX_DEBRIS_SPEED);
        angular = limit(add(angular, launch.angular), MAX_DEBRIS_SPIN);
      } else if (root === undefined) {
        velocity = limit(
          add(inherited, limit(bullet, MAX_IMPACT_SPEED)),
          MAX_DEBRIS_SPEED,
        );
      }
      return {
        angular,
        attached: !chip && root !== undefined,
        definition: freezeDefinition(definition),
        position,
        velocity,
      };
    });
    const mounted = this.explosives
      .filter((charge) =>
        child
          ? charge.secondaryId === child.fragment.id
          : charge.fragment === primary,
      )
      .map((charge) => ({ charge, ...this.explosiveTransform(charge) }));
    if (child) {
      this.removeSecondary(child);
    } else {
      this.refined.add(primary!);
      this.wakeSupportContacts(collider);
      this.staticColliders.delete(primary!);
      this.colliderFragments.delete(collider.handle);
      if (island) {
        island.primaries.delete(primary!);
        island.colliders = island.colliders.filter(
          (value) => value.handle !== collider.handle,
        );
      }
      this.removeCollider(collider, true);
    }
    this.nextSecondaryId += count;
    const created: Array<SecondaryBody> = [];
    let retainedMass = 0;
    for (const item of prepared) {
      const desc = this.fragmentColliderDesc(item.definition);
      let body: RAPIER.RigidBody, descendant: RAPIER.Collider;
      if (item.attached && island) {
        body = island.body;
        const translation = body.translation(),
          inverseRotation = inverse(body.rotation());
        const offset = rotate(inverseRotation, {
          x: item.position.x - translation.x,
          y: item.position.y - translation.y,
          z: item.position.z - translation.z,
        });
        descendant = this.createCollider(
          desc
            .setTranslation(offset.x, offset.y, offset.z)
            .setRotation(multiply(inverseRotation, rotation)),
          body,
        );
        island.colliders.push(descendant);
        retainedMass += item.definition.mass;
      } else {
        const bodyDesc = (
          item.attached
            ? this.rapier.RigidBodyDesc.fixed()
            : this.rapier.RigidBodyDesc.dynamic()
        )
          .setTranslation(item.position.x, item.position.y, item.position.z)
          .setRotation(rotation)
          .setLinearDamping(0.15)
          .setAngularDamping(this.angularDamping(item.definition))
          .setCanSleep(true)
          .setCcdEnabled(true);
        if (!item.attached) {
          bodyDesc
            .setLinvel(item.velocity.x, item.velocity.y, item.velocity.z)
            .setAngvel(item.angular);
        }
        body = this.createRigidBody(bodyDesc);
        descendant = this.createCollider(desc, body);
      }
      const piece: SecondaryBody = {
        body,
        collider: descendant,
        fragment: item.definition,
        settled: false,
        stableTicks: 0,
        velocity: item.velocity,
        ...(item.attached ? { attachedRoot: root! } : {}),
      };
      this.addSecondary(piece);
      created.push(piece);
    }
    for (const { charge, position, rotation: chargeRotation } of mounted) {
      const nearest = this.closest(created, position)!;
      const translation = nearest.collider.translation(),
        inverseRotation = inverse(nearest.collider.rotation());
      charge.fragment = undefined;
      charge.secondaryId = nearest.fragment.id;
      charge.localPosition = rotate(inverseRotation, {
        x: position.x - translation.x,
        y: position.y - translation.y,
        z: position.z - translation.z,
      });
      charge.localRotation = multiply(inverseRotation, chargeRotation);
    }
    if (moving) {
      if (island && retainedMass > 0 && island.body.isDynamic()) {
        island.body.recomputeMassPropertiesFromColliders();
        const share = retainedMass / parent.mass;
        island.body.applyImpulseAtPoint(
          this.cappedImpulse(island.body, {
            x: impulse.x * share,
            y: impulse.y * share,
            z: impulse.z * share,
          }),
          point,
          true,
        );
        island.settled = false;
        island.stableTicks = 0;
      }
      this.impactRecords.set(command, { consumed: true });
    } else {
      this.impactRecords.set(command, { consumed: root === undefined, root });
    }
    this.impactFractures++;
    this.secondaryRevision++;
    this.topologyRevision++;
    this.world.propagateModifiedBodyPositionsToColliders();
    if (root !== undefined) {
      this.refreshRoot(root);
    }
  }

  /** A loose, single-cell, concrete fragment coarser than the debris level. */
  private subdividable(index: number): boolean {
    if (
      this.retired.has(index) ||
      this.refined.has(index) ||
      this.graph.children[index]?.length
    ) {
      return false;
    }
    const island = this.islands.get(this.fragmentIsland[index]!);
    const parent = this.manifest.fragments[index]!;
    return (
      island !== undefined &&
      island.members.length === 1 &&
      Math.max(...parent.size) > SUBDIVIDABLE_SIZE &&
      /concrete|reinforced frame/i.test(this.materialOf(parent)?.name ?? "")
    );
  }

  private secondaryCandidates(
    commands: Array<DestructionCommand>,
  ): Array<SecondaryCandidate> {
    const candidates = new Map<number, SecondaryCandidate>();
    for (const command of commands) {
      if (command.type !== "explosion") {
        continue;
      }
      for (const island of this.islands.values()) {
        if (island.members.length !== 1) {
          continue;
        }
        const index = island.members[0]!,
          parent = this.manifest.fragments[index]!;
        const collider = island.primaries.get(index);
        if (
          this.retired.has(index) ||
          this.refined.has(index) ||
          this.graph.children[index]?.length ||
          !collider
        ) {
          continue;
        }
        const volume = volumeOf(parent);
        if (
          volume < MIN_FRACTURE_VOLUME ||
          Math.min(...parent.size) < MIN_FRACTURE_WIDTH
        ) {
          continue;
        }
        const material = this.materialOf(parent);
        if (!material || !/concrete|reinforced frame/i.test(material.name)) {
          continue;
        }
        const hit = collider.projectPoint(vec(command.position), true);
        if (!hit) {
          continue;
        }
        const distance = Math.hypot(
          hit.point.x - command.position[0],
          hit.point.y - command.position[1],
          hit.point.z - command.position[2],
        );
        const dose =
          command.strength * Math.max(0, 1 - distance / command.radius);
        if (dose < Math.max(0.7, material.strength * 0.65)) {
          continue;
        }
        const previous = candidates.get(index);
        if (!previous || dose > previous.dose) {
          candidates.set(index, {
            command,
            dose,
            index,
            seed:
              (Math.imul(parent.id, 73_856_093) ^
                Math.imul(command.id, 19_349_663) ^
                Math.imul(command.source, 83_492_791) ^
                this.tick) >>>
              0,
          });
        }
      }
    }
    const blasted = [...candidates.values()].sort(
      (a, b) =>
        b.dose - a.dose ||
        this.manifest.fragments[a.index]!.id -
          this.manifest.fragments[b.index]!.id,
    );
    const landed = [...this.landedCells]
      .filter((index) => !candidates.has(index))
      .sort(
        (a, b) =>
          this.manifest.fragments[a]!.id - this.manifest.fragments[b]!.id,
      )
      .map((index) => ({
        dose: 0,
        index,
        seed:
          (Math.imul(this.manifest.fragments[index]!.id, 73_856_093) ^
            this.tick) >>>
          0,
      }));
    this.landedCells.clear();
    return [...blasted, ...landed];
  }

  /**
   * A cell is exposed when some face other than its lowest is open to air: a point just outside it
   * lies in no other body. A cell inside a pile, or one that only shows its underside, is not.
   */
  private isExposed(index: number): boolean {
    const island = this.islands.get(this.fragmentIsland[index]!);
    const collider = island?.primaries.get(index);
    if (!island || !collider) {
      return false;
    }
    const centre = collider.translation(),
      rotation = collider.rotation(),
      half = this.manifest.fragments[index]!.size.map(
        (value) => value / 2 + 0.08,
      ) as Vec3;
    const faces: Array<V> = [];
    for (let axis = 0; axis < 3; axis++) {
      for (const sign of [1, -1]) {
        const local = { x: 0, y: 0, z: 0 };
        local[(["x", "y", "z"] as const)[axis]!] = sign * half[axis]!;
        faces.push(rotate(rotation, local));
      }
    }
    const lowest = faces.reduce(
      (low, face, slot) => (face.y < faces[low]!.y ? slot : low),
      0,
    );
    return faces.some((offset, slot) => {
      if (slot === lowest) {
        return false;
      }
      let blocked = false;
      this.world.intersectionsWithPoint(
        {
          x: centre.x + offset.x,
          y: centre.y + offset.y,
          z: centre.z + offset.z,
        },
        (other) => {
          if (other.parent()?.handle !== island.body.handle) {
            blocked = true;
          }
          return !blocked;
        },
      );
      return !blocked;
    });
  }

  /** True when a contact point sits low on the cell, i.e. the cell took the hit on its underside. */
  private struckUnderside(index: number, point: V): boolean {
    const size = this.manifest.fragments[index]!.size;
    const centre = this.position(index);
    return point.y < centre.y - Math.min(size[0]!, size[1]!, size[2]!) * 0.25;
  }

  private fractureSecondary(candidates: Array<SecondaryCandidate>): void {
    if (this.budget.rung >= 3) {
      // Rung 3: sub-fracture that nobody can see waits (a landed cell stays queued), or is skipped
      // for this step altogether when the step is far over budget.
      const skip = this.budget.skipFracture;
      candidates = candidates.filter((candidate) => {
        // A charge's own target is kept unless it is hidden; only landing refinement is skipped.
        if (
          this.isExposed(candidate.index) &&
          !(skip && candidate.dose === 0)
        ) {
          return true;
        }
        this.budgetDeferred++;
        // A landed cell that is merely over budget stays queued; one that is hidden never refines.
        if (candidate.dose === 0 && skip && this.landedCells.size < 256) {
          this.landedCells.add(candidate.index);
        }
        return false;
      });
    }
    let splits = 0,
      attempts = 0;
    for (const candidate of candidates) {
      const index = candidate.index;
      const coarse =
        Math.max(...this.manifest.fragments[index]!.size) > SUBDIVIDABLE_SIZE;
      if (
        coarse
          ? this.subdivisions >= MAX_SUBDIVISIONS_PER_TICK * this.tickScale
          : this.fractureSplits >=
              MAX_SECONDARY_SPLITS_PER_TICK * this.tickScale ||
            attempts >= 8 * this.tickScale
      ) {
        this.capacityEvents++;
        if (coarse) {
          this.landedCells.add(index);
          continue;
        }
        break;
      }
      const island = this.islands.get(this.fragmentIsland[index]!);
      const source = island?.primaries.get(index);
      if (
        !island ||
        !source ||
        island.members.length !== 1 ||
        this.retired.has(index) ||
        this.refined.has(index) ||
        this.graph.children[index]?.length
      ) {
        continue;
      }
      // Landing refinement never happens inside a pile; a charge's own target always splits.
      if (candidate.dose === 0 && !this.isExposed(index)) {
        continue;
      }
      const parent = this.manifest.fragments[index]!;
      const replacesDynamic = island.body.isDynamic() ? 1 : 0;
      attempts++;
      const material = this.materialOf(parent);
      if (!material) continue;
      const fracture = generateSecondarySubgraphFracture(
        parent,
        material,
        candidate.dose > 0 ? candidate.dose : 1,
        candidate.seed,
        coarse ? SUBCELL_SIZE : undefined,
      );
      const { children } = fracture;
      if (children.length < 2) {
        continue;
      }
      // Refining is cosmetic and costs bodies: with no headroom the cell stays whole rather
      // than evicting settled rubble to make room.
      if (
        coarse &&
        (this.secondary.length + this.retiringSecondaryCount() + children.length > MAX_SECONDARY_FRAGMENTS ||
          this.dynamicBodyCount() + children.length - replacesDynamic >
            MAX_DYNAMIC_BODIES)
      ) {
        this.capacityEvents++;
        continue;
      }
      if (
        !this.reserveIds(children.length) ||
        !this.reserve(
          children.length,
          children.length - replacesDynamic,
          new Set(),
          new Set([index]),
        )
      ) {
        this.capacityEvents++;
        continue;
      }
      this.applySecondarySubgraphFracture(fracture, island, source, index, candidate.command);
      splits++;
      if (coarse) {
        this.subdivisions++;
      } else {
        this.fractureSplits++;
      }
    }
    if (splits) {
      this.world.propagateModifiedBodyPositionsToColliders();
    }
  }

  private applySecondarySubgraphFracture(
    fracture: SecondarySubgraphFractureCommand,
    island: Island,
    source: RAPIER.Collider,
    index: number,
    command?: DestructionCommand,
  ): void {
    const parent = this.manifest.fragments[index]!;
    if (fracture.chunkId !== parent.id) return;
    const { children } = fracture;
    const center = source.translation(),
      rotation = source.rotation();
    const angular = island.body.angvel();
    const pressureLaunch = this.pressureLaunches.get(island.body);
    const mounted = this.explosives
      .filter((charge) => charge.fragment === index)
      .map((charge) => ({ charge, ...this.explosiveTransform(charge) }));
    const prepared = children.map((child, slot) => {
      const offset = rotate(rotation, vec(child.position));
      const position = {
        x: center.x + offset.x,
        y: center.y + offset.y,
        z: center.z + offset.z,
      };
      const fragment: SecondaryFragmentDef = {
        ...child,
        generation: 1,
        depth: (parent.depth ?? 2) + 1,
        support: false,
        parent: parent.id,
        id: this.nextSecondaryId + slot,
        parentId: parent.id,
        position: parent.position.map(
          (n, axis) => n + child.position[axis]!,
        ) as Vec3,
        rootId: parent.id,
      };
      return {
        desc: this.fragmentColliderDesc(fragment),
        fragment,
        position,
        velocity: this.pressureVelocity(island.body, island.body.velocityAtPoint(position), position),
      };
    });
    this.nextSecondaryId += children.length;
    for (const collider of island.colliders) {
      this.colliderFragments.delete(collider.handle);
      this.secondaryColliders.delete(collider.handle);
    }
    this.removeRigidBody(island.body);
    this.islands.delete(island.key);
    this.fragmentIsland[index] = -1;
    this.retired.add(index);
    this.visibleChunks.delete(index);
    this.states[index] = FragmentState.Retired;
    this.graph.removeFragment(index);
    const created: Array<SecondaryBody> = [];
    for (const child of prepared) {
      const body = this.createRigidBody(
        this.rapier.RigidBodyDesc.dynamic()
          .setTranslation(child.position.x, child.position.y, child.position.z)
          .setRotation(rotation)
          .setLinvel(child.velocity.x, child.velocity.y, child.velocity.z)
          .setAngvel(angular)
          .setLinearDamping(0.15)
          .setAngularDamping(this.angularDamping(child.fragment))
          .setCanSleep(true)
          .setCcdEnabled(true),
      );
      if (pressureLaunch) this.pressureLaunches.set(body, pressureLaunch);
      const collider = this.createCollider(child.desc, body);
      const piece: SecondaryBody = {
        body,
        collider,
        fragment: freezeDefinition(child.fragment),
        settled: false,
        stableTicks: 0,
        velocity: child.velocity,
      };
      this.addSecondary(piece);
      created.push(piece);
    }
    if (this.pressureBursts.size) {
      this.pressureDescendants.set(index, created);
      // An already-free single chunk becomes this blast's detachment only when
      // subgraph fracture really succeeds, after budget/capacity checks.
      if (command) this.pressureBursts.get(`${command.source}:${command.id}`)?.detached.add(index);
    }
    for (const { charge, position, rotation: chargeRotation } of mounted) {
      const child = this.closest(created, position)!;
      const childCenter = child.collider.translation(),
        inverseRotation = inverse(child.collider.rotation());
      charge.fragment = undefined;
      charge.secondaryId = child.fragment.id;
      charge.localPosition = rotate(inverseRotation, {
        x: position.x - childCenter.x,
        y: position.y - childCenter.y,
        z: position.z - childCenter.z,
      });
      charge.localRotation = multiply(inverseRotation, chargeRotation);
    }
    this.secondaryRevision++;
    this.topologyRevision++;
  }

  private secondaryFrame(): SecondaryFractureFrame {
    const pieces = this.secondary.map((child) => ({
      fragment: child.fragment,
      position: child.collider.translation(),
      rotation: child.collider.rotation(),
      scale: 1,
      state: child.attachedRoot !== undefined
        ? this.states[child.attachedRoot]!
        : child.settled ? FragmentState.Settled
        : child.body.isSleeping() ? FragmentState.Sleeping : FragmentState.Dynamic,
    }));
    const duration = Math.max(1, this.ticks(this.debrisTier.sinkSeconds));
    for (const retirement of this.visualRetirements) {
      const progress = Math.min(1, retirement.ticks / duration);
      for (const piece of retirement.fragments) pieces.push({
        ...piece,
        position: { ...piece.position, y: piece.position.y - retirement.depth * progress },
        scale: retirement.depth > 0 ? 1 : 1 - progress,
        state: FragmentState.Settled,
      });
    }
    pieces.sort((a, b) => a.fragment.id - b.fragment.id);
    const transforms = new Float32Array(pieces.length * TRANSFORM_STRIDE);
    const states = new Uint8Array(pieces.length);
    for (const [index, piece] of pieces.entries()) {
      const p = piece.position, q = piece.rotation;
      transforms.set([p.x,p.y,p.z,q.x,q.y,q.z,q.w,piece.scale], index * TRANSFORM_STRIDE);
      states[index] = piece.state;
    }
    return { fragments: pieces.map((piece) => piece.fragment), revision: this.secondaryRevision, states, transforms };
  }

  private explosiveTransform(charge: Explosive): { position: V; rotation: Q } {
    const secondary =
      charge.secondaryId === undefined
        ? undefined
        : this.secondaryById.get(charge.secondaryId);
    if (
      (charge.fragment === undefined || this.retired.has(charge.fragment)) &&
      !secondary
    ) {
      return { position: charge.localPosition, rotation: charge.localRotation };
    }
    const center = secondary
        ? secondary.collider.translation()
        : this.position(charge.fragment!),
      parent = secondary
        ? secondary.collider.rotation()
        : this.rotation(charge.fragment!);
    const offset = rotate(parent, charge.localPosition);
    return {
      position: {
        x: center.x + offset.x,
        y: center.y + offset.y,
        z: center.z + offset.z,
      },
      rotation: multiply(parent, charge.localRotation),
    };
  }

  private ordnanceFrame(): Array<OrdnanceState> {
    const result: Array<OrdnanceState> = [];
    for (const charge of this.explosives) {
      const { position, rotation } = this.explosiveTransform(charge);
      result.push({
        id: charge.id,
        position: tuple(position),
        radius: 0.16,
        rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
        source: charge.source,
        type: "explosive",
      });
    }
    for (const ball of this.cannonballs) {
      const q = ball.body.rotation();
      result.push({
        id: ball.id,
        position: tuple(ball.body.translation()),
        radius: ball.radius,
        rotation: [q.x, q.y, q.z, q.w],
        source: ball.source,
        type: "cannonball",
      });
    }
    return result;
  }

  private resolveOrdnance(
    commands: Array<DestructionCommand>,
  ): Array<DestructionCommand> {
    const effects: Array<DestructionCommand> = [];
    for (const command of commands) {
      if (command.type === "placeExplosive") {
        if (this.explosives.length >= MAX_EXPLOSIVES) {
          this.explosives.shift();
          this.capacityEvents++;
        }
        const norm = Math.hypot(...command.direction);
        const normal =
          norm > 0.001
            ? {
                x: command.direction[0] / norm,
                y: command.direction[1] / norm,
                z: command.direction[2] / norm,
              }
            : { x: 0, y: 1, z: 0 };
        let rotation: Q;
        if (normal.z < -0.99999) {
          rotation = { w: 0, x: 0, y: 1, z: 0 };
        } else {
          rotation = { w: 1 + normal.z, x: -normal.y, y: normal.x, z: 0 };
          const length = Math.hypot(
            rotation.x,
            rotation.y,
            rotation.z,
            rotation.w,
          );
          rotation = {
            w: rotation.w / length,
            x: rotation.x / length,
            y: rotation.y / length,
            z: rotation.z / length,
          };
        }
        const position = {
          x: command.position[0] + normal.x * 0.065,
          y: command.position[1] + normal.y * 0.065,
          z: command.position[2] + normal.z * 0.065,
        };
        const target =
          command.fragmentId === undefined
            ? undefined
            : this.liveTarget(command.fragmentId, position, command.radius);
        const fragment = target?.primary,
          secondary = target?.child;
        const parent =
          secondary?.collider.translation() ??
          (fragment === undefined ? undefined : this.position(fragment));
        const inverseRotation = secondary
          ? inverse(secondary.collider.rotation())
          : fragment === undefined
            ? undefined
            : inverse(this.rotation(fragment));
        this.explosives.push({
          createdTick: this.tick,
          fragment,
          id: command.id,
          localPosition:
            parent && inverseRotation
              ? rotate(inverseRotation, {
                  x: position.x - parent.x,
                  y: position.y - parent.y,
                  z: position.z - parent.z,
                })
              : position,
          localRotation: inverseRotation
            ? multiply(inverseRotation, rotation)
            : rotation,
          radius: command.radius,
          minRadius: command.minRadius,
          secondaryId: secondary?.fragment.id,
          source: command.source,
          strength: command.strength,
        });
      } else if (command.type === "detonate") {
        for (const charge of this.explosives) {
          const { position, rotation } = this.explosiveTransform(charge);
          const blast: DestructionCommand = {
            direction: tuple(rotate(rotation, { x: 0, y: 0, z: 1 })),
            id: this.cascadeId++,
            position: tuple(position),
            radius: charge.radius,
            minRadius: charge.minRadius,
            source: ORDNANCE_SOURCE,
            strength: charge.strength,
            tick: this.tick,
            type: "explosion",
          };
          effects.push(blast);
          this.detonated.push(blast);
        }
        this.explosives.length = 0;
      } else if (command.type === "cannonball") {
        if (this.cannonballs.length >= MAX_CANNONBALLS) {
          this.removeCannonball(this.cannonballs[0]!);
          this.capacityEvents++;
        }
        if (this.dynamicBodyCount() >= MAX_DYNAMIC_BODIES) {
          this.capacityEvents++;
          continue;
        }
        this.createCannonball(command);
      } else {
        effects.push(command);
      }
    }
    return effects;
  }

  private createCannonball(command: DestructionCommand): void {
    const speed = cannonballSpeed(command.strength);
    const norm = Math.hypot(...command.direction);
    const velocity = {
      x: (command.direction[0] / norm) * speed,
      y: (command.direction[1] / norm) * speed,
      z: (command.direction[2] / norm) * speed,
    };
    const body = this.createRigidBody(
      this.rapier.RigidBodyDesc.dynamic()
        .setTranslation(...command.position)
        .setLinvel(velocity.x, velocity.y, velocity.z)
        .setLinearDamping(0.025)
        .setAngularDamping(0.1)
        .setCcdEnabled(true)
        .setCanSleep(true),
    );
    const collider = this.createCollider(
      this.rapier.ColliderDesc.ball(command.radius)
        .setMass(CANNONBALL_MASS)
        .setFriction(0.7)
        .setRestitution(0.16)
        .setActiveEvents(this.rapier.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(100),
      body,
    );
    const ball = {
      body,
      collider,
      createdTick: this.tick,
      id: command.id,
      lastImpactTick: -100,
      radius: command.radius,
      source: command.source,
      velocity,
    };
    this.cannonballs.push(ball);
    this.ballColliders.set(collider.handle, ball);
  }

  private removeCannonball(ball: Cannonball): void {
    this.ballColliders.delete(ball.collider.handle);
    this.removeRigidBody(ball.body);
    const index = this.cannonballs.indexOf(ball);
    if (index >= 0) {
      this.cannonballs.splice(index, 1);
    }
  }

  private expireOrdnance(): void {
    while (
      this.explosives.length &&
      this.tick - this.explosives[0]!.createdTick >=
        this.ticks(EXPLOSIVE_LIFETIME)
    ) {
      this.explosives.shift();
    }
    const cannonballs = this.cannonballs.slice();
    for (const ball of cannonballs) {
      const p = ball.body.translation();
      if (
        this.tick - ball.createdTick >= this.ticks(CANNONBALL_LIFETIME) ||
        p.y < -30 ||
        Math.abs(p.x) > 300 ||
        Math.abs(p.z) > 300
      ) {
        this.removeCannonball(ball);
      }
    }
  }

  private outOfBounds(p: V): boolean {
    return (
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      !Number.isFinite(p.z) ||
      p.y < this.killFloor ||
      Math.abs(p.x) > this.killExtent ||
      Math.abs(p.y) > this.killExtent ||
      Math.abs(p.z) > this.killExtent
    );
  }

  private cullOutOfBounds(): void {
    const lost = new Set<number>();
    for (const child of this.secondary.slice()) {
      if (
        child.attachedRoot === undefined &&
        !child.baked &&
        this.outOfBounds(child.collider.translation())
      ) {
        lost.add(child.fragment.id);
        this.evict(child);
      }
    }
    for (const island of this.islands.values()) {
      if (
        island.baked ||
        island.body.isFixed() ||
        !this.outOfBounds(island.body.translation())
      ) {
        continue;
      }
      for (const index of island.members) {
        for (const child of this.secondary.slice()) {
          if (child.attachedRoot === index) {
            lost.add(child.fragment.id);
            this.evict(child);
          }
        }
        lost.add(this.manifest.fragments[index]!.id);
        this.refined.delete(index);
        this.attachedVolumes.delete(index);
        this.retired.add(index);
        this.visibleChunks.delete(index);
        this.states[index] = FragmentState.Retired;
        this.fragmentIsland[index] = -1;
        this.graph.removeFragment(index);
      }
      for (const collider of island.colliders) {
        this.colliderFragments.delete(collider.handle);
        this.secondaryColliders.delete(collider.handle);
      }
      this.removeRigidBody(island.body);
      this.islands.delete(island.key);
      this.impactTopologyDirty = true;
    }
    if (!lost.size) {
      return;
    }
    for (let slot = this.explosives.length - 1; slot >= 0; slot--) {
      const charge = this.explosives[slot]!;
      if (
        (charge.secondaryId !== undefined && lost.has(charge.secondaryId)) ||
        (charge.fragment !== undefined &&
          lost.has(this.manifest.fragments[charge.fragment]!.id))
      ) {
        this.explosives.splice(slot, 1);
      }
    }
    this.secondaryRevision++;
    this.topologyRevision++;
  }

  private cannonballImpact(
    ball: Cannonball,
    other: RAPIER.Collider,
    normal: V,
    contactImpulse: number,
  ): boolean {
    if (
      this.tick - ball.lastImpactTick <
        this.ticks(CANNONBALL_IMPACT_COOLDOWN) ||
      this.queue.length >= MAX_QUEUED_COMMANDS
    ) {
      return false;
    }
    const fragment = this.colliderFragments.get(other.handle);
    const target =
      fragment === undefined
        ? undefined
        : this.islands.get(this.fragmentIsland[fragment]!);
    const secondary = this.secondaryColliders.get(other.handle);
    const targetBody = secondary?.body ?? target?.body;
    const targetVelocity =
      secondary?.velocity ??
      (target ? this.preStepVelocity.get(target.key) : undefined);
    const relative = {
      x: ball.velocity.x - (targetVelocity?.x ?? 0),
      y: ball.velocity.y - (targetVelocity?.y ?? 0),
      z: ball.velocity.z - (targetVelocity?.z ?? 0),
    };
    const normalVelocity =
      relative.x * normal.x + relative.y * normal.y + relative.z * normal.z;
    const speed = Math.abs(normalVelocity);
    const targetMass =
      targetBody && !targetBody.isFixed() ? targetBody.mass() : Infinity;
    const mass = Number.isFinite(targetMass)
      ? (CANNONBALL_MASS * targetMass) / (CANNONBALL_MASS + targetMass)
      : CANNONBALL_MASS;
    const energy = 0.5 * mass * speed * speed;
    if (speed < 2.5 || energy < 120) {
      return false;
    }
    let position = ball.body.translation();
    forEachContactManifold(this.world, ball.collider, other, (manifold) => {
      if (manifold.numSolverContacts()) {
        const contact = manifold.solverContactPoint(0);
        if (contact) {
          position = contact;
        }
      }
    });
    ball.lastImpactTick = this.tick;
    const direction = {
      x: normal.x * Math.sign(normalVelocity),
      y: normal.y * Math.sign(normalVelocity),
      z: normal.z * Math.sign(normalVelocity),
    };
    const id = this.cascadeId++;
    const impulse = Math.min(contactImpulse, CANNONBALL_MASS * speed * 1.2);
    this.ballImpactEffects.set(id, {
      fragment,
      impulse: {
        x: direction.x * impulse,
        y: direction.y * impulse,
        z: direction.z * impulse,
      },
      position,
      release: !targetBody || targetBody.isFixed(),
    });
    this.queue.push({
      direction: tuple(direction),
      id,
      position: tuple(position),
      radius: clamp(ball.radius * 3 + Math.sqrt(energy) / 450, 0.8, 2.2),
      source: ORDNANCE_SOURCE,
      strength: clamp(Math.sqrt(energy) / 90, 0.4, 8),
      tick: this.tick + 1,
      type: "pointImpact",
    });
    this.events.push({
      count: 1,
      energy, mass, impulse: contactImpulse, normal: tuple(direction), radius: ball.radius,
      position: tuple(position),
      tick: this.tick,
      type: "cannonballImpact",
    });
    return true;
  }

  private assertLive(): void {
    if (this.disposed) {
      throw new Error("Simulation has been disposed.");
    }
  }

  private addContactWrench(
    collider: RAPIER.Collider,
    point: V,
    force: V,
    transient = false,
    other?: RAPIER.Collider,
    endpoint?: ContactEndpoint,
    otherEndpoint?: ContactEndpoint,
    supportChunk?: number,
  ): void {
    const standalone = endpoint ? endpoint.standalone
      : this.experimentalBearingReanchor ? this.secondaryColliders.get(collider.handle) : undefined;
    if (standalone?.attachedRoot === undefined && standalone && this.bearingSupports.has(standalone.body)) {
      const support = this.bearingSupports.get(standalone.body)!;
      const otherBody = otherEndpoint ? otherEndpoint.body : other?.parent();
      const carried = otherBody ? this.bearingSupports.get(otherBody) : undefined;
      if (!transient && other && (support.anchors.some((anchor) => anchor.providers.some((provider) =>
          provider.receiver.handle === collider.handle && provider.collider.handle === other.handle)) ||
          carried?.anchors.some((anchor) => anchor.providers.some((provider) =>
            provider.receiver.handle === other.handle && provider.collider.handle === collider.handle)))) return;
      const sameCollider = endpoint && standalone.collider.handle === collider.handle;
      const center = sameCollider ? endpoint.position : standalone.collider.translation(),
        q = inverse(sameCollider ? endpoint.rotation : standalone.collider.rotation());
      const arm = { x: point.x-center.x, y: point.y-center.y, z: point.z-center.z };
      if (transient) {
        const asset = rotate(q, arm), impulse = rotate(q, force), rest = standalone.fragment.position;
        this.secondaryBearingSolver.addForce(standalone.fragment.id, [rest[0]+asset.x,rest[1]+asset.y,rest[2]+asset.z],
          [impulse.x*this.dt,impulse.y*this.dt,impulse.z*this.dt]);
      } else {
        const load = this.secondaryContactWrenches.get(standalone.fragment.id) ?? [0,0,0,0,0,0];
        const values = [force.x,force.y,force.z,arm.y*force.z-arm.z*force.y,arm.z*force.x-arm.x*force.z,arm.x*force.y-arm.y*force.x];
        for (let axis=0;axis<6;axis++) load[axis]! += values[axis]!;
        this.secondaryContactWrenches.set(standalone.fragment.id, load);
        if (this.experimentalBearingReanchor && other &&
            (!(otherEndpoint ? otherEndpoint.dynamic : otherBody?.isDynamic()) ||
             !(endpoint ? endpoint.dynamic : collider.parent()?.isDynamic()))) {
          const key = this.bearingPairKey(collider, other);
          let nodes = this.secondaryBearingContactWrenches.get(key);
          if (!nodes) this.secondaryBearingContactWrenches.set(key, nodes = new Map());
          let wrench = nodes.get(standalone.fragment.id);
          if (!wrench) nodes.set(standalone.fragment.id, wrench = new Float64Array(6));
          for (let axis=0;axis<6;axis++) wrench[axis]! += values[axis]!;
        }
      }
      return;
    }
    const visible = endpoint ? endpoint.visible : this.colliderFragments.get(collider.handle);
    if (visible === undefined) return;
    const fragment = supportChunk ?? this.supportAt(visible, point);
    if (fragment < 0) return;
    if (transient) {
      this.landingImpulses.push(this.structuralImpulse(fragment, point, {
        x: force.x * this.dt, y: force.y * this.dt, z: force.z * this.dt,
      }));
      return;
    }
    const bearing = this.experimentalBearingReanchor ? this.bearingNodes.get(fragment) : undefined;
    const otherBody = this.experimentalBearingReanchor
      ? otherEndpoint ? otherEndpoint.body : other?.parent() : undefined;
    const carried = otherBody ? this.bearingSupports.get(otherBody) : undefined;
    if (other && (bearing?.anchors.some((anchor) => anchor.providers.some((provider) => provider.receiver.handle === collider.handle && provider.collider.handle === other.handle)) ||
        carried?.anchors.some((anchor) => anchor.providers.some((provider) => provider.receiver.handle === other.handle && provider.collider.handle === collider.handle)))) return;
    if (this.frozen[fragment] && !bearing) return;
    const center = this.position(fragment);
    const x = point.x - center.x,
      y = point.y - center.y,
      z = point.z - center.z;
    const offset = fragment * 6;
    this.contactWrenches[offset]! += force.x;
    this.contactWrenches[offset + 1]! += force.y;
    this.contactWrenches[offset + 2]! += force.z;
    this.contactWrenches[offset + 3]! += y * force.z - z * force.y;
    this.contactWrenches[offset + 4]! += z * force.x - x * force.z;
    this.contactWrenches[offset + 5]! += x * force.y - y * force.x;
    if (this.experimentalBearingReanchor && other &&
        (!(otherEndpoint ? otherEndpoint.dynamic : otherBody?.isDynamic()) ||
         !(endpoint ? endpoint.dynamic : collider.parent()?.isDynamic()))) {
      const key = this.bearingPairKey(collider, other);
      let nodes = this.bearingContactWrenches.get(key);
      if (!nodes) this.bearingContactWrenches.set(key, nodes = new Map());
      let wrench = nodes.get(fragment);
      if (!wrench) nodes.set(fragment, wrench = new Float64Array(6));
      const values = [force.x, force.y, force.z, y * force.z - z * force.y, z * force.x - x * force.z, x * force.y - y * force.x];
      for (let axis = 0; axis < 6; axis++) wrench[axis]! += values[axis]!;
    }
  }

  /** Whether a contact pair feeds the structural passes: a standing fragment or a bonded body. */
  private structuralCollider(handle: number): boolean {
    const fragment = this.colliderFragments.get(handle);
    if (fragment === undefined) {
      if (!this.experimentalBearingReanchor) return false;
      const child = this.secondaryColliders.get(handle);
      return !!child && this.bearingSupports.has(child.body);
    }
    return (
      (this.experimentalBearingReanchor && (!!this.graph.supported[fragment] || this.bearingNodes.has(fragment))) ||
      this.states[fragment] === FragmentState.Supported ||
      (this.islands.get(this.fragmentIsland[fragment]!)?.members.length ?? 0) >
        1
    );
  }

  private collectStructuralLoads(): void {
    const events = this.contactPass === "events" && this.ownsWorld;
    let moving = !this.ownsWorld;
    let revision = this.transformRevision;
    if (events) {
      revision = this.structuralRevision;
      moving =
        this.structuralMoving ||
        this.forwardedContacts.some(
          (event) =>
            this.structuralCollider(event.first) ||
            this.structuralCollider(event.second),
        );
    } else if (!moving) {
      this.world.forEachActiveRigidBody((body) => {
        if (!body.isFixed() && !body.isSleeping()) {
          moving = true;
        }
      });
    }
    if (
      !moving &&
      !this.contactMoving &&
      this.contactTopology === this.topologyRevision &&
      this.contactTransforms === revision &&
      this.crushQueue.length === 0
    ) {
      return;
    }
    this.contactTransforms = revision;
    this.contactMoving = moving;
    this.contactTopology = this.topologyRevision;
    this.contactWrenches.fill(0);
    if (this.experimentalBearingReanchor) {
      this.bearingContactWrenches.clear();
      this.secondaryBearingContactWrenches.clear();
      this.secondaryContactWrenches.clear();
    }
    this.crushLoad.fill(0);
    if (this.everBaked) {
      for (const island of this.islands.values()) {
        if (island.baked && (!this.experimentalBearingReanchor || !this.bearingSupports.has(island.body))) {
          for (const index of island.members) {
            for (let axis = 0; axis < 6; axis++) {
              this.contactWrenches[index * 6 + axis] =
                this.frozenWrenches[index * 6 + axis]!;
            }
          }
        }
      }
    }
    const visited = new Map<number, Set<number>>();
    const nextHistory = new Map<number, Map<number, number>>();
    // Contact callbacks only accumulate wrenches and queue impulses. No body,
    // collider, graph membership or pose is changed until after this pair walk.
    const endpoints = new Map<RAPIER.Collider, ContactEndpoint>();
    const bodies = new Map<RAPIER.RigidBody, { dynamic: boolean; mass: number }>();
    const iterations = this.world.integrationParameters.numSolverIterations;
    const velocityBefore = (collider: RAPIER.Collider): V => {
      const ball = this.ballColliders.get(collider.handle);
      if (ball) {
        return ball.velocity;
      }
      const secondary = this.secondaryColliders.get(collider.handle);
      if (secondary) {
        return secondary.velocity;
      }
      const fragment = this.colliderFragments.get(collider.handle);
      return fragment === undefined
        ? { x: 0, y: 0, z: 0 }
        : (this.preStepVelocity.get(this.fragmentIsland[fragment]!) ?? {
            x: 0,
            y: 0,
            z: 0,
          });
    };
    const endpointOf = (collider: RAPIER.Collider): ContactEndpoint => {
      let endpoint = endpoints.get(collider);
      if (endpoint) return endpoint;
      const body = collider.parent();
      let properties = body ? bodies.get(body) : undefined;
      if (body && !properties) {
        const dynamic = body.isDynamic();
        properties = { dynamic, mass: dynamic ? body.mass() : Infinity };
        bodies.set(body, properties);
      }
      endpoint = { body, dynamic: properties?.dynamic ?? false, mass: properties?.mass ?? Infinity,
        position: collider.translation(), rotation: collider.rotation(), velocity: velocityBefore(collider),
        visible: this.colliderFragments.get(collider.handle),
        standalone: this.experimentalBearingReanchor ? this.secondaryColliders.get(collider.handle) : undefined };
      endpoints.set(collider, endpoint);
      return endpoint;
    };
    const resolvePair = (collider: RAPIER.Collider, other: RAPIER.Collider) => {
      if (!collider?.isValid() || !other?.isValid()) return;
      {
        const low = collider.handle < other.handle ? collider.handle : other.handle,
          high = collider.handle < other.handle ? other.handle : collider.handle;
        let seen = visited.get(low);
        if (seen?.has(high)) {
          return;
        }
        if (!seen) visited.set(low, seen = new Set());
        seen.add(high);
        let worked = this.workContactPairs.get(low);
        if (!worked) this.workContactPairs.set(low, worked = new Set());
        const countWork = !worked.has(high);
        worked.add(high);
        forEachContactManifold(this.world, collider, other, (manifold, flipped) => {
          const solverContacts = manifold.numSolverContacts();
          if (countWork) this.stepWork.contactConstraints += solverContacts;
          const first = flipped ? other : collider,
            second = flipped ? collider : other;
          const firstEndpoint = endpointOf(first), secondEndpoint = endpointOf(second);
          const normal = manifold.normal();
          const v1 = firstEndpoint.velocity,
            v2 = secondEndpoint.velocity;
          const relative = { x: v1.x - v2.x, y: v1.y - v2.y, z: v1.z - v2.z };
          const alongNormal =
            relative.x * normal.x +
            relative.y * normal.y +
            relative.z * normal.z;
          const previousImpulse = this.contactHistory.get(low)?.get(high);
          const contacts = manifold.numContacts(), impulses: number[] = [];
          let totalNormalImpulse = 0;
          for (let i = 0; i < contacts; i++) {
            const impulse = manifold.contactImpulse(i);
            impulses.push(impulse);
            totalNormalImpulse += impulse;
          }
          let history = nextHistory.get(low);
          if (!history) nextHistory.set(low, history = new Map());
          history.set(high, totalNormalImpulse);
          const steadyImpulse =
            previousImpulse !== undefined &&
            Math.abs(totalNormalImpulse - previousImpulse) <=
              Math.max(1e-6, totalNormalImpulse * 0.01);
          const scale =
            this.legacyContactWriteback &&
            steadyImpulse &&
            Math.abs(alongNormal) < 0.25
              ? iterations / (iterations + 1)
              : 1;
          const restingImpulse = Math.min(firstEndpoint.mass, secondEndpoint.mass) * 9.81 * this.dt;
          const transient = Math.abs(alongNormal) > SETTLE_SPEED ||
            (!steadyImpulse && totalNormalImpulse > restingImpulse * 1.5);
          const crushes =
            !this.ballColliders.has(first.handle) &&
            !this.ballColliders.has(second.handle);
          const firstPosition = firstEndpoint.position,
            firstRotation = firstEndpoint.rotation;
          const secondPosition = secondEndpoint.position,
            secondRotation = secondEndpoint.rotation;
          const rate = scale / this.dt;
          for (let i = 0; i < contacts; i++) {
            const impulse = impulses[i]!;
            if (
              !Number.isFinite(impulse) ||
              impulse <= 1e-9
            ) {
              continue;
            }
            const local1 = manifold.localContactPoint1(i),
              local2 = manifold.localContactPoint2(i);
            let point: V;
            if (local1 && local2) {
              const p1 = rotate(firstRotation, local1),
                p2 = rotate(secondRotation, local2);
              point = {
                x: (firstPosition.x + p1.x + secondPosition.x + p2.x) * 0.5,
                y: (firstPosition.y + p1.y + secondPosition.y + p2.y) * 0.5,
                z: (firstPosition.z + p1.z + secondPosition.z + p2.z) * 0.5,
              };
            } else if (solverContacts) {
              const contact = manifold.solverContactPoint(
                Math.min(i, solverContacts - 1),
              );
              if (!contact) {
                continue;
              }
              point = contact;
            } else {
              continue;
            }
            const force = {
              x: -normal.x * impulse * rate,
              y: -normal.y * impulse * rate,
              z: -normal.z * impulse * rate,
            };
            // Separate the collision pulse from the persistent contact reaction. Rapier has
            // already applied this impulse to bodies; only the structural solve receives it.
            const a = firstEndpoint.visible === undefined ? -1 : this.supportAt(firstEndpoint.visible, point);
            const b = secondEndpoint.visible === undefined ? -1 : this.supportAt(secondEndpoint.visible, point);
            this.addContactWrench(first, point, force, transient, second, firstEndpoint, secondEndpoint, a);
            this.addContactWrench(second, point, {
              x: -force.x,
              y: -force.y,
              z: -force.z,
            }, transient, first, secondEndpoint, firstEndpoint, b);
            if (crushes && !transient) {
              const magnitude = impulse * rate;
              if (a >= 0) this.crushLoad[a]! += magnitude;
              if (b >= 0) this.crushLoad[b]! += magnitude;
            }
          }
        });
      }
    };
    if (this.contactPass === "events" && this.ownsWorld) {
      // Only pairs the solver reported above the force-event threshold this step. Resting,
      // sleeping and baked bodies produce no events, so idle ticks do no manifold walk at all.
      for (const event of this.forwardedContacts) {
        if (
          !this.structuralCollider(event.first) &&
          !this.structuralCollider(event.second)
        ) {
          continue;
        }
        const first = this.world.getCollider(event.first),
          second = this.world.getCollider(event.second);
        if (first && second) {
          resolvePair(first, second);
        }
      }
    } else {
      const collect = (collider: RAPIER.Collider) => {
        this.world.contactPairsWith(collider, (other) => {
          if (other) {
            resolvePair(collider, other);
          }
        });
      };
      for (const island of this.islands.values()) {
        // A sleeping body is in equilibrium and cannot change its loads on its own: awake
        // neighbours report every pair they share with it, and it is rechecked once woken.
        if (island.body.isSleeping() && this.ownsWorld) {
          continue;
        }
        for (const collider of island.colliders) {
          collect(collider);
        }
      }
      for (const child of this.secondary) {
        if (
          child.attachedRoot === undefined &&
          this.isDebris(child) &&
          (child.settled || child.body.isSleeping())
        ) {
          continue;
        }
        if (
          child.attachedRoot === undefined ||
          this.states[child.attachedRoot] === FragmentState.Supported
        ) {
          collect(child.collider);
        }
      }
      for (const ball of this.cannonballs) {
        collect(ball.collider);
      }
    }
    this.contactHistory = nextHistory;
    this.queueCrushing();
    if (this.experimentalBearingReanchor) this.updateBearingLoadSnapshot();
    else {
      this.graph.setExternalLoads?.({
        bodies: [...this.islands.values()]
          .filter((island) => island.members.length > 1)
          .map((island) => {
            const q = this.rotation(island.members[0]!),
              omega = island.body.angvel();
            return {
              angularVelocity: [omega.x, omega.y, omega.z],
              members: island.members,
              rotation: [q.x, q.y, q.z, q.w],
            };
          }),
        tick: this.tick,
        wrenches: this.contactWrenches,
      });
    }
  }

  private colliderDesc(index: number): RAPIER.ColliderDesc {
    const fragment = this.manifest.fragments[index]!;
    return this.fragmentColliderDesc(fragment,
      this.graph.activeChunks[index] ? this.graph.fragmentMass[index]! : fragment.mass);
  }

  private pulverise(): void {
    const crushed = new Set(this.crushQueue);
    for (const command of this.detonated) {
      const core =
        command.radius * BRISANCE_FRACTION * Math.sqrt(command.strength / 2);
      for (let index = 0; index < this.states.length; index++) {
        if (
          !this.graph.activeChunks[index] ||
          this.graph.children[index]?.length ||
          this.manifest.fragments[index]!.anchored ||
          this.retired.has(index)
        ) {
          continue;
        }
        const p = this.position(index);
        if (
          Math.hypot(
            p.x - command.position[0],
            p.y - command.position[1],
            p.z - command.position[2],
          ) <= core
        ) {
          crushed.add(index);
        }
      }
    }
    this.detonated = [];
    this.crushQueue = [...crushed].sort(
      (a, b) => this.manifest.fragments[a]!.id - this.manifest.fragments[b]!.id,
    );
    this.crushFragments();
  }

  /**
   * Generic contact overload. A standing fragment that its contacts overload fractures away
   * from the structure (its bonds fail) rather than being deleted. Rubble is never crushed by
   * generic contact: dust comes only from placed-charge cores (`pulverise`). Multi-piece falling
   * bodies get no generic contact load either; their weight and landing loads are carried and
   * broken by the graph's support paths.
   */
  private queueCrushing(): void {
    const fracture: Array<{ index: number; ratio: number }> = [];
    for (let index = 0; index < this.crushLoad.length; index++) {
      const load = this.crushLoad[index]!;
      if (
        !load ||
        this.retired.has(index) ||
        !this.graph.activeChunks[index] ||
        this.states[index] !== FragmentState.Supported
      ) {
        continue;
      }
      const massFraction =
        this.graph.fragmentMass[index]! / this.manifest.fragments[index]!.mass;
      const ratio =
        load / (this.crushCapacity[index]! * massFraction ** (2 / 3));
      if (ratio > 1) {
        fracture.push({ index, ratio });
      }
    }
    fracture.sort(
      (a, b) =>
        b.ratio - a.ratio ||
        this.manifest.fragments[a.index]!.id -
          this.manifest.fragments[b.index]!.id,
    );
    for (const { index } of fracture.slice(
      0,
      MAX_CRUSHED_PER_TICK * this.tickScale,
    )) {
      this.graph.failIncidentBonds(index);
    }
    if (fracture.length > MAX_CRUSHED_PER_TICK * this.tickScale) {
      this.capacityEvents++;
    }
  }

  private crushFragments(): void {
    const removed: Array<number> = [];
    while (this.crushQueue.length && this.crushBudget > 0) {
      const index = this.crushQueue.shift()!;
      if (this.retired.has(index) || !this.graph.activeChunks[index] || this.manifest.fragments[index]!.anchored) {
        continue;
      }
      const body = this.islands.get(this.fragmentIsland[index]!);
      const position = this.position(index);
      const mass = this.graph.fragmentMass[index]!;
      const velocity = body?.body.linvel() ?? { x: 0, y: 0, z: 0 };
      const momentum = mass * Math.sqrt(squared(velocity));
      this.frozen[index] = 0;
      for (const child of this.secondary.slice()) {
        if (child.attachedRoot === index) {
          this.removeSecondary(child);
        }
      }
      const fixed = this.staticColliders.get(index);
      if (fixed) {
        this.wakeSupportContacts(fixed);
        this.colliderFragments.delete(fixed.handle);
        this.removeCollider(fixed, true);
        this.staticColliders.delete(index);
      }
      if (body && body.members.length > 1) {
        this.removeIslandMember(body, index);
      } else if (body) {
        for (const collider of body.colliders) {
          this.wakeSupportContacts(collider);
          this.colliderFragments.delete(collider.handle);
          this.secondaryColliders.delete(collider.handle);
        }
        this.removeRigidBody(body.body);
        this.islands.delete(body.key);
      }
      this.fragmentIsland[index] = -1;
      this.refined.delete(index);
      this.retired.add(index);
      this.visibleChunks.delete(index);
      this.states[index] = FragmentState.Retired;
      this.attachedVolumes.delete(index);
      removed.push(index);
      this.impactTopologyDirty = true;
      this.secondaryRevision++;
      this.topologyRevision++;
      this.crushedFragments++;
      this.crushedMass += mass;
      this.crushBudget--;
      this.events.push({
        count: 1,
        energy: 0.5 * mass * squared(velocity), mass, impulse: momentum,
        radius: Math.cbrt(volumeOf(this.manifest.fragments[index]!)) / 2,
        position: tuple(position),
        tick: this.tick,
        type: "heavyImpact",
      });
    }
    this.graph.removeFragments(removed);
    if (this.crushQueue.length) {
      this.capacityEvents++;
    }
  }

  /**
   * Take one fragment out of a multi-member body: drop its collider, forget its pose and wake the
   * body. Attached secondary children were already detached by the caller. The graph then
   * reports the remaining components; rebuildIslands keeps the body when it stayed connected and
   * splits it otherwise.
   */
  private removeIslandMember(island: Island, index: number): void {
    this.frozen[index] = 0;
    const collider = island.primaries.get(index);
    if (collider) {
      this.wakeSupportContacts(collider);
      this.colliderFragments.delete(collider.handle);
      island.colliders = island.colliders.filter(
        (value) => value.handle !== collider.handle,
      );
      island.primaries.delete(index);
      this.removeCollider(collider, true);
    }
    island.poses.delete(index);
    // `members` aliases the graph's component array, so replace rather than edit it.
    island.members = island.members.filter((member) => member !== index);
    island.visibleChunks = island.visibleChunks.filter(
      (member) => member !== index,
    );
    if (island.key === index) {
      this.islands.delete(island.key);
      island.key = island.members[0]!;
      this.islands.set(island.key, island);
      for (const member of island.members) {
        this.fragmentIsland[member] = island.key;
      }
      const velocity = this.preStepVelocity.get(index);
      this.preStepVelocity.delete(index);
      if (velocity) {
        this.preStepVelocity.set(island.key, velocity);
      }
    }
    island.body.recomputeMassPropertiesFromColliders();
    this.wakeIsland(island);
    island.transformState = undefined;
  }

  private collisionEnvelope(f: FragmentDef): {
    position: Vec3; scale: number; offset: Vec3; inheritedScale: number; points?: Float32Array;
  } {
    const cached = this.collisionEnvelopes.get(f.id);
    if (cached) return cached;
    let inheritedScale = 1;
    let offset: Vec3 = [0, 0, 0];
    if (f.parent !== undefined && f.parent >= 0) {
      let parent = this.collisionEnvelopes.get(f.parent);
      if (!parent) {
        const index = this.fragmentById.get(f.parent);
        const definition = index === undefined ? this.secondaryById.get(f.parent)?.fragment : this.manifest.fragments[index];
        if (!definition) throw new Error(`Missing collision envelope for parent ${f.parent}`);
        parent = this.collisionEnvelope(definition);
      }
      inheritedScale = parent.scale;
      offset = f.position.map((value, axis) => parent!.offset[axis]! +
        (inheritedScale - 1) * (value - parent!.position[axis]!)) as Vec3;
    }
    const inset = f.shape ? insetCollisionGeometry(f, SECTION_INSET) : undefined;
    let points = inset?.vertices;
    if (!points && offset.some(value => value !== 0)) {
      points = new Float32Array(24);
      for (let vertex = 0; vertex < 8; vertex++) for (let axis = 0; axis < 3; axis++) {
        points[vertex * 3 + axis] = ((vertex >> axis) & 1 ? 1 : -1) * f.size[axis]! * 0.495;
      }
    }
    if (points) for (let index = 0; index < points.length; index++) {
      points[index] = inheritedScale * points[index]! + offset[index % 3]!;
    }
    // Every child is transformed through the same parent affine map before its
    // own face inset. A child wholly in the old skin still has a nonempty proxy;
    // its collision vertices shift inward, while its rendered COM stays put.
    const envelope = { position: [...f.position] as Vec3, inheritedScale, offset,
      scale: inheritedScale * (inset?.safeScale ?? 0.99), points };
    this.collisionEnvelopes.set(f.id, envelope);
    return envelope;
  }

  private fragmentColliderDesc(f: FragmentDef, mass = f.mass): RAPIER.ColliderDesc {
    const material = this.manifest.materials.find((m) => m.id === f.material);
    const envelope = this.collisionEnvelope(f);
    let desc: RAPIER.ColliderDesc;
    if (envelope.points) {
      let hull = this.hulls.get(f.id);
      if (!hull) {
        const [x, y, z] = f.size.map(size => size * 0.99);
        hull = {
          points: envelope.points,
          ...(f.shape ? principalInertia(f.shape.inertia) : {
            moments: { x: f.mass * (y! * y! + z! * z!) / 12,
              y: f.mass * (x! * x! + z! * z!) / 12,
              z: f.mass * (x! * x! + y! * y!) / 12 },
            frame: { x: 0, y: 0, z: 0, w: 1 },
          }),
        };
        this.hulls.set(f.id, hull);
      }
      const convex = this.rapier.ColliderDesc.convexHull(hull.points);
      if (!convex) {
        throw new Error(`Invalid convex hull for fragment ${f.id}`);
      }
      desc = convex.setMassProperties(
        mass,
        { x: 0, y: 0, z: 0 },
        mass === f.mass ? hull.moments : {
          x: hull.moments.x * mass / f.mass,
          y: hull.moments.y * mass / f.mass,
          z: hull.moments.z * mass / f.mass,
        },
        hull.frame,
      );
    } else {
      desc = this.rapier.ColliderDesc.cuboid(
        f.size[0] * 0.495 * envelope.inheritedScale,
        f.size[1] * 0.495 * envelope.inheritedScale,
        f.size[2] * 0.495 * envelope.inheritedScale,
      );
      if (envelope.inheritedScale === 1) desc.setMass(mass);
      else {
        // Preserve the original cuboid's inertia, independent of inherited skin.
        const [x, y, z] = f.size.map(size => size * 0.99);
        desc.setMassProperties(mass, { x: 0, y: 0, z: 0 }, {
          x: mass * (y! * y! + z! * z!) / 12,
          y: mass * (x! * x! + z! * z!) / 12,
          z: mass * (x! * x! + y! * y!) / 12,
        }, { x: 0, y: 0, z: 0, w: 1 });
      }
    }
    return desc
      .setFriction(material?.friction ?? 0.7)
      .setRestitution(0.06)
      .setActiveEvents(this.rapier.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(500);
  }

  private position(index: number): V {
    const i = index * TRANSFORM_STRIDE;
    return {
      x: this.transforms[i]!,
      y: this.transforms[i + 1]!,
      z: this.transforms[i + 2]!,
    };
  }
  private rotation(index: number): Q {
    const i = index * TRANSFORM_STRIDE;
    return {
      w: this.transforms[i + 6]!,
      x: this.transforms[i + 3]!,
      y: this.transforms[i + 4]!,
      z: this.transforms[i + 5]!,
    };
  }

  private wakeSupportContacts(support: RAPIER.Collider): void {
    if (!bearingColliderValid(support, 'wake support')) return;
    const touching = new Map<
      number,
      {
        body: RAPIER.RigidBody;
        child?: SecondaryBody;
        island?: Island;
        order: number;
      }
    >();
    const consider = (other: RAPIER.Collider | null) => {
      if (!bearingColliderValid(other, 'wake contact')) return;
      const body = other.parent();
      if (!body || !bearingBodyValid(body, 'wake contact parent')) return;
      const fragment = this.colliderFragments.get(other.handle);
      const island =
        fragment === undefined
          ? undefined
          : this.islands.get(this.fragmentIsland[fragment]!);
      const child =
        fragment === undefined
          ? this.secondaryColliders.get(other.handle)
          : undefined;
      // A baked body is fixed, so it only counts when it is one.
      if (!body.isDynamic() && !island?.baked && !child?.baked) {
        return;
      }
      touching.set(body.handle, {
        body,
        child,
        island,
        order:
          fragment === undefined
            ? Number.MAX_SAFE_INTEGER
            : this.manifest.fragments[fragment]!.id,
      });
    };
    this.world.contactPairsWith(support, consider);
    if (!bearingColliderValid(support, 'wake support after enumeration')) return;
    if (this.everBaked) {
      // Fixed bodies make no contact pairs with other fixed colliders, so a baked body resting on
      // a static fragment is found by proximity instead.
      const centre = support.translation();
      const supportFragment = this.colliderFragments.get(support.handle);
      const reach =
        (supportFragment === undefined
          ? 1.5
          : Math.hypot(...this.manifest.fragments[supportFragment]!.size) / 2) +
        0.1;
      this.world.collidersWithAabbIntersectingAabb(
        centre,
        { x: reach, y: reach, z: reach },
        (other) => {
          if (!bearingColliderValid(other, 'wake broadphase candidate')) return true;
          if (other.handle !== support.handle) {
            consider(other);
          }
          return true;
        },
      );
    }
    for (const { body, child, island } of [...touching.values()].sort(
      (a, b) => a.order - b.order || a.body.handle - b.body.handle,
    )) {
      if (!bearingBodyValid(body, 'wake queued contact')) continue;
      if (island) {
        this.wakeIsland(island);
      } else if (child) {
        this.wakeChild(child);
      } else {
        body.wakeUp();
      }
    }
  }

  /** A support chunk's children keep its rigid pose when the graph demotes it in place. */
  private initializeDemotedPoses(
    demotions: ReadonlyArray<{ parent: number; children: Array<number> }>,
  ): void {
    for (const { parent, children } of demotions) {
      const p = this.position(parent),
        q = this.rotation(parent);
      const origin = this.manifest.fragments[parent]!.position;
      const visit = (index: number): void => {
        const rest = this.manifest.fragments[index]!.position;
        const offset = rotate(q, {
          x: rest[0] - origin[0],
          y: rest[1] - origin[1],
          z: rest[2] - origin[2],
        });
        this.transforms.set(
          [p.x + offset.x, p.y + offset.y, p.z + offset.z, q.x, q.y, q.z, q.w],
          index * TRANSFORM_STRIDE,
        );
        this.fragmentIsland[index] = this.fragmentIsland[parent]!;
        this.states[index] = this.states[parent]!;
        this.frozen[index] = 0;
        for (const child of this.graph.children[index] ?? []) visit(child);
      };
      for (const child of children) visit(child);
    }
  }

  /** Charges follow the surviving visible chunks when their original mounting chunk disappears. */
  private remountHierarchyCharges(
    mounted: ReadonlyArray<{ charge: Explosive; position: V; rotation: Q }>,
  ): void {
    for (const { charge, position, rotation } of mounted) {
      if (
        charge.fragment === undefined ||
        this.visibleChunks.has(charge.fragment)
      )
        continue;
      const fragmentId = this.manifest.fragments[charge.fragment]!.id;
      const target = this.liveTarget(fragmentId, position, charge.radius);
      const collider =
        target?.child?.collider ??
        (target?.primary === undefined
          ? undefined
          : this.primaryCollider(target.primary));
      charge.fragment = target?.primary;
      charge.secondaryId = target?.child?.fragment.id;
      if (!collider) {
        charge.localPosition = position;
        charge.localRotation = rotation;
        continue;
      }
      const center = collider.translation(),
        inverseRotation = inverse(collider.rotation());
      charge.localPosition = rotate(inverseRotation, {
        x: position.x - center.x,
        y: position.y - center.y,
        z: position.z - center.z,
      });
      charge.localRotation = multiply(inverseRotation, rotation);
    }
  }

  /** Includes hidden descendants so demotion inherits the complete actor pose. */
  private actorPoseIndices(
    nodes: ReadonlyArray<number>,
    visible: ReadonlyArray<number>,
  ): Array<number> {
    const owned = new Set<number>(visible);
    const visit = (index: number): void => {
      if (owned.has(index) && !visible.includes(index)) return;
      owned.add(index);
      for (const child of this.graph.children[index] ?? []) visit(child);
    };
    for (const index of nodes) visit(index);
    return [...owned];
  }

  private actorForFragment(index: number): Island | undefined {
    return (
      this.islands.get(this.fragmentIsland[index]!) ??
      this.supportedByFragment.get(index)
    );
  }

  /** Map a hit on a visible ancestor to the graph node at the actual contact position. */
  private supportAt(index: number, point: V): number {
    // resolveSupportChunk returns a live active ancestor before consulting the
    // hit position. Preserve that exact branch without constructing a local point.
    for (let ancestor = index; ancestor >= 0; ancestor = this.graph.parents[ancestor]!) {
      if (this.graph.activeChunks[ancestor] && !this.graph.isRemoved(ancestor)) return ancestor;
    }
    const origin = this.position(index),
      rotation = inverse(this.rotation(index));
    const local = rotate(rotation, {
      x: point.x - origin.x,
      y: point.y - origin.y,
      z: point.z - origin.z,
    });
    const rest = this.manifest.fragments[index]!.position;
    return this.graph.resolveSupportChunk(index, [
      rest[0] + local.x,
      rest[1] + local.y,
      rest[2] + local.z,
    ]);
  }

  private rebuildSupportedActors(): void {
    const actors = this.graph.getActors().filter((actor) => actor.supported && (!this.experimentalBearingReanchor || !actor.nodes.some((node) => this.bearingNodes.has(node))));
    const keep = new Set<number>();
    const same = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) =>
      a.length === b.length && a.every((value, index) => value === b[index]);
    for (const actor of actors) {
      const old = this.supportedActors.get(actor.id);
      if (
        old &&
        same(old.members, actor.nodes) &&
        same(old.visibleChunks, actor.visibleChunks)
      )
        keep.add(actor.id);
    }
    for (const [key, actor] of this.supportedActors) {
      if (keep.has(key)) continue;
      for (const [index, collider] of actor.primaries) {
        this.wakeSupportContacts(collider);
        this.staticColliders.delete(index);
        this.colliderFragments.delete(collider.handle);
      }
      // Attached subsupport pieces move to the replacement actor below.
      for (const child of this.secondary) {
        if (child.body.handle !== actor.body.handle) continue;
        this.secondaryColliders.delete(child.collider.handle);
        this.colliderFragments.delete(child.collider.handle);
      }
      this.removeRigidBody(actor.body);
      this.supportedActors.delete(key);
    }
    this.supportedByFragment.clear();
    for (const actor of actors) {
      let physical = this.supportedActors.get(actor.id);
      if (!physical) {
        const center = { x: 0, y: 0, z: 0 };
        let mass = 0;
        for (const index of actor.nodes) {
          const m = this.graph.fragmentMass[index]!,
            p = this.position(index);
          mass += m;
          center.x += p.x * m;
          center.y += p.y * m;
          center.z += p.z * m;
        }
        if (mass > 0) {
          center.x /= mass;
          center.y /= mass;
          center.z /= mass;
        }
        const body = this.createRigidBody(
          this.rapier.RigidBodyDesc.fixed().setTranslation(
            center.x,
            center.y,
            center.z,
          ),
        );
        const colliders: Array<RAPIER.Collider> = [],
          primaries = new Map<number, RAPIER.Collider>();
        const poses = new Map<number, { position: V; rotation: Q }>();
        for (const index of this.actorPoseIndices(
          actor.nodes,
          actor.visibleChunks,
        )) {
          const p = this.position(index),
            q = this.rotation(index);
          poses.set(index, {
            position: {
              x: p.x - center.x,
              y: p.y - center.y,
              z: p.z - center.z,
            },
            rotation: q,
          });
          this.states[index] = FragmentState.Supported;
          this.fragmentIsland[index] = -1;
        }
        for (const index of actor.visibleChunks) {
          if (this.retired.has(index) || this.refined.has(index)) continue;
          const pose = poses.get(index)!;
          const collider = this.createCollider(
            this.colliderDesc(index)
              .setTranslation(pose.position.x, pose.position.y, pose.position.z)
              .setRotation(pose.rotation),
            body,
          );
          primaries.set(index, collider);
          colliders.push(collider);
          this.staticColliders.set(index, collider);
          this.colliderFragments.set(collider.handle, index);
        }
        for (const child of this.secondary) {
          if (
            child.attachedRoot === undefined ||
            !actor.nodes.includes(child.attachedRoot)
          )
            continue;
          const root = child.attachedRoot,
            origin = this.manifest.fragments[root]!.position;
          const p = this.position(root),
            q = this.rotation(root);
          const offset = rotate(q, {
            x: child.fragment.position[0] - origin[0],
            y: child.fragment.position[1] - origin[1],
            z: child.fragment.position[2] - origin[2],
          });
          if (child.collider.isValid()) this.detachCollider(child);
          child.body = body;
          child.collider = this.createCollider(
            this.fragmentColliderDesc(child.fragment)
              .setTranslation(
                p.x + offset.x - center.x,
                p.y + offset.y - center.y,
                p.z + offset.z - center.z,
              )
              .setRotation(q),
            body,
          );
          this.secondaryColliders.set(child.collider.handle, child);
          this.colliderFragments.set(child.collider.handle, root);
          colliders.push(child.collider);
        }
        physical = {
          body,
          key: actor.id,
          members: actor.nodes,
          visibleChunks: actor.visibleChunks,
          poses,
          primaries,
          colliders,
          settled: false,
          stableTicks: 0,
        };
        this.supportedActors.set(actor.id, physical);
        this.topologyRevision++;
      }
      for (const index of physical.poses.keys())
        this.supportedByFragment.set(index, physical);
    }
  }

  private rebuildIslands(components: ReadonlyArray<Array<number>>): void {
    this.appliedHierarchyRevision = this.graph.hierarchyRevision;
    this.rebuildSupportedActors();
    this.visibleChunks.clear();
    for (const actor of this.graph.getActors()) {
      for (const index of actor.visibleChunks)
        if (!this.retired.has(index)) this.visibleChunks.add(index);
    }
    for (const index of this.retired) {
      this.fragmentIsland[index] = -1;
    }
    const runtimeSupported = this.experimentalBearingReanchor
      ? this.graph.getActors().filter((actor) => actor.supported && actor.nodes.some((node) => this.bearingNodes.has(node)))
      : [];
    const ordered = [...components, ...runtimeSupported.map((actor) => actor.nodes)]
      .map((members) =>
        members
          .filter((index) => !this.retired.has(index))
          .sort(
            (a, b) =>
              this.manifest.fragments[a]!.id - this.manifest.fragments[b]!.id,
          ),
      )
      .filter((members) => members.length > 0)
      .sort(
        (a, b) =>
          this.manifest.fragments[a[0]!]!.id -
          this.manifest.fragments[b[0]!]!.id,
      );
    const keep = new Set<number>();
    const motion = new Map<number, Motion>();
    const create: Array<{ key: number; members: Array<number> }> = [];
    for (const members of ordered) {
      const key = members[0]!;
      const old = this.islands.get(key);
      const visibleChunks = this.graph.getVisibleChunks(members);
      if (
        old &&
        old.members.length === members.length &&
        old.members.every((index, slot) => index === members[slot]!) &&
        old.visibleChunks.length === visibleChunks.length &&
        old.visibleChunks.every((index, slot) => index === visibleChunks[slot])
      ) {
        keep.add(key);
        continue;
      }
      // Demoting a member in a free actor changes its graph nodes, not its
      // geometry. Keep the body and its visible colliders until an actual split.
      const previousActor = this.islands.get(this.fragmentIsland[members[0]!]!);
      if (
        previousActor &&
        this.retainDemotedActor(previousActor, members, visibleChunks)
      ) {
        keep.add(previousActor.key);
        continue;
      }
      create.push({ key, members });
      for (const index of members) {
        const previous = this.islands.get(this.fragmentIsland[index]!);
        if (previous && !previous.settled) {
          motion.set(index, {
            angular: previous.body.angvel(),
            velocity: previous.body.velocityAtPoint(this.position(index)),
          });
        }
      }
    }
    // A body that splits keeps its largest remainder, so only the pieces that leave pay for new
    // colliders. Without this, every split of an N-piece building recreates all N colliders.
    const retained = this.retainSplitBodies(create);
    for (const [key, island] of this.islands) {
      if (keep.has(key) || retained.has(island)) {
        continue;
      }
      for (const collider of island.colliders) {
        this.colliderFragments.delete(collider.handle);
        this.secondaryColliders.delete(collider.handle);
      }
      this.removeRigidBody(island.body);
      for (const index of island.poses.keys()) this.fragmentIsland[index] = -1;
      this.islands.delete(key);
    }
    for (const [island, members] of retained) {
      this.shrinkIsland(island, members);
    }
    let dynamicCount = this.dynamicBodyCount();
    for (const { key, members } of create) {
      let mass = 0;
      const center = { x: 0, y: 0, z: 0 },
        velocity = { x: 0, y: 0, z: 0 },
        angular = { x: 0, y: 0, z: 0 };
      let newlyDetached = 0;
      for (const index of members) {
        if (this.states[index] === FragmentState.Supported) newlyDetached++;
        const refined = this.refined.has(index);
        const weighted = refined
          ? this.attachedCenter(index)
          : {
              center: this.position(index),
              mass: this.graph.fragmentMass[index]!,
            };
        const m = weighted.mass,
          p = weighted.center,
          inherited = motion.get(index);
        mass += m;
        center.x += p.x * m;
        center.y += p.y * m;
        center.z += p.z * m;
        if (inherited) {
          velocity.x += inherited.velocity.x * m;
          velocity.y += inherited.velocity.y * m;
          velocity.z += inherited.velocity.z * m;
          angular.x += inherited.angular.x * m;
          angular.y += inherited.angular.y * m;
          angular.z += inherited.angular.z * m;
        }
        if (refined && this.fragmentIsland[index]! < 0) {
          newlyDetached++;
        }
        const fixed = this.staticColliders.get(index);
        if (fixed) {
          this.wakeSupportContacts(fixed);
          this.colliderFragments.delete(fixed.handle);
          this.removeCollider(fixed, true);
          this.staticColliders.delete(index);
          newlyDetached++;
        }
      }
      for (const target of [center, velocity, angular]) {
        target.x /= mass;
        target.y /= mass;
        target.z /= mass;
      }
      // Over the cap a new body would otherwise appear fixed in mid-air; the step budget, not this
      // cap, is what keeps cost down, so it takes a soft margin before that happens.
      const settled = dynamicCount >= MAX_DYNAMIC_BODIES * 1.5;
      if (settled) {
        this.everBaked = true;
        this.capacityEvents++;
      }
      const desc = (
        settled
          ? this.rapier.RigidBodyDesc.fixed()
          : this.rapier.RigidBodyDesc.dynamic()
      )
        .setTranslation(center.x, center.y, center.z)
        .setLinearDamping(0.15)
        .setAngularDamping(
          members.length <= RUBBLE_MEMBERS ? RUBBLE_ANGULAR_DAMPING : 0.4,
        )
        .setCanSleep(true)
        .setCcdEnabled(true);
      if (!settled) {
        desc.setLinvel(velocity.x, velocity.y, velocity.z).setAngvel(angular);
        dynamicCount++;
      }
      const body = this.createRigidBody(desc);
      const colliders: Array<RAPIER.Collider> = [];
      const primaries = new Map<number, RAPIER.Collider>();
      const poses = new Map<number, { position: V; rotation: Q }>();
      const visibleChunks = this.graph
        .getVisibleChunks(members)
        .filter((index) => !this.retired.has(index));
      for (const index of this.actorPoseIndices(members, visibleChunks)) {
        const p = this.position(index),
          q = this.rotation(index);
        poses.set(index, {
          position: { x: p.x - center.x, y: p.y - center.y, z: p.z - center.z },
          rotation: q,
        });
        this.fragmentIsland[index] = key;
        this.frozen[index] = 0;
        this.states[index] = settled
          ? FragmentState.Settled
          : FragmentState.Dynamic;
        if (!visibleChunks.includes(index) && !this.refined.has(index))
          continue;
        if (this.refined.has(index)) {
          const origin = this.manifest.fragments[index]!.position;
          for (const child of this.secondary) {
            if (child.attachedRoot !== index) {
              continue;
            }
            const offset = rotate(q, {
              x: child.fragment.position[0] - origin[0],
              y: child.fragment.position[1] - origin[1],
              z: child.fragment.position[2] - origin[2],
            });
            if (child.collider.isValid()) {
              this.wakeSupportContacts(child.collider);
              this.colliderFragments.delete(child.collider.handle);
              this.secondaryColliders.delete(child.collider.handle);
              this.removeRigidBody(child.body);
            }
            child.body = body;
            child.collider = this.createCollider(
              this.fragmentColliderDesc(child.fragment)
                .setTranslation(
                  p.x + offset.x - center.x,
                  p.y + offset.y - center.y,
                  p.z + offset.z - center.z,
                )
                .setRotation(q),
              body,
            );
            child.settled = settled;
            child.baked = settled;
            child.stableTicks = 0;
            this.secondaryColliders.set(child.collider.handle, child);
            this.colliderFragments.set(child.collider.handle, index);
            colliders.push(child.collider);
          }
          continue;
        }
        const collider = this.createCollider(
          this.colliderDesc(index)
            .setTranslation(p.x - center.x, p.y - center.y, p.z - center.z)
            .setRotation(q),
          body,
        );
        this.colliderFragments.set(collider.handle, index);
        primaries.set(index, collider);
        colliders.push(collider);
      }
      const island: Island = {
        baked: settled,
        body,
        colliders,
        key,
        members,
        visibleChunks,
        poses,
        primaries,
        settled,
        stableTicks: 0,
      };
      this.islands.set(key, island);
      if (newlyDetached) {
        this.events.push({
          count: members.length,
          energy: mass,
          mass, impulse: mass * Math.sqrt(squared(velocity)),
          radius: Math.cbrt(members.reduce((v, i) => v + volumeOf(this.manifest.fragments[i]!), 0)) / 2,
          position: [center.x, center.y, center.z],
          tick: this.tick,
          type: "islandDetached",
        });
      }
      if (settled) {
        this.events.push({
          count: members.length,
          energy: 0,
          mass, impulse: mass * Math.sqrt(squared(velocity)), normal: [0, 1, 0],
          radius: Math.cbrt(members.reduce((v, i) => v + volumeOf(this.manifest.fragments[i]!), 0)) / 2,
          position: [center.x, center.y, center.z],
          tick: this.tick,
          type: "rubbleSettled",
        });
      }
    }
    if (create.length || retained.size) {
      this.topologyRevision++;
      this.world.propagateModifiedBodyPositionsToColliders();
    }
  }

  /** Retain a complete free actor whose only change is its support-node cover. */
  private retainDemotedActor(
    island: Island,
    members: Array<number>,
    visibleChunks: Array<number>,
  ): boolean {
    if (
      island.visibleChunks.length !== visibleChunks.length ||
      island.visibleChunks.some((index, slot) => index !== visibleChunks[slot]) ||
      island.primaries.size !== island.colliders.length ||
      island.primaries.size !== visibleChunks.length ||
      members.some((index) =>
        this.fragmentIsland[index] !== island.key ||
        !island.poses.has(index) || this.refined.has(index) ||
        this.graph.fragmentMass[index]! < this.manifest.fragments[index]!.mass * (1 - 1e-8),
      )
    ) return false;
    const mass = members.reduce((sum, index) => sum + this.graph.fragmentMass[index]!, 0);
    const visibleMass = visibleChunks.reduce((sum, index) => sum + this.manifest.fragments[index]!.mass, 0);
    // Full ownership prevents retaining a cover over a removed cell or one that
    // has left in another component, even if its sibling geometry is unchanged.
    if (Math.abs(mass - visibleMass) > visibleMass * 1e-8) return false;

    const oldKey = island.key, key = members[0]!;
    this.islands.delete(oldKey);
    island.key = key;
    island.members = members;
    island.visibleChunks = visibleChunks;
    this.islands.set(key, island);
    const velocity = this.preStepVelocity.get(oldKey);
    this.preStepVelocity.delete(oldKey);
    if (velocity) this.preStepVelocity.set(key, velocity);
    // Hidden descendants already have actor-local poses. Keep visible ancestors
    // mapped too, since colliders, charges and contact routing still use them.
    for (const index of island.poses.keys()) this.fragmentIsland[index] = key;
    island.transformState = undefined;
    this.topologyRevision++;
    return true;
  }

  /**
   * Among the components about to get new bodies, find those that are the largest remainder of a
   * body that is only splitting (every member already lives in that one body). They are removed
   * from `create` and returned with the body that keeps them. Bodies with attached secondary
   * pieces, settled-as-fixed bodies and small remainders are rebuilt as before.
   */
  private retainSplitBodies(
    create: Array<{ key: number; members: Array<number> }>,
  ): Map<Island, Array<number>> {
    const retained = new Map<Island, Array<number>>();
    const largest = new Map<Island, number>();
    create.forEach(({ members }, slot) => {
      const old = this.islands.get(this.fragmentIsland[members[0]!]!);
      if (
        !old ||
        old.body.isFixed() ||
        members.length < RETAIN_MIN_MEMBERS ||
        old.poses.size !== old.members.length ||
        old.visibleChunks.length !== old.members.length ||
        old.visibleChunks.some((index) => !old.members.includes(index)) ||
        this.graph
          .getVisibleChunks(members)
          .some((index) => !members.includes(index)) ||
        old.primaries.size !== old.colliders.length ||
        old.primaries.size !== old.members.length ||
        members.some(
          (index) =>
            this.fragmentIsland[index] !== old.key || !old.primaries.has(index),
        )
      ) {
        return;
      }
      const best = largest.get(old);
      if (best === undefined || members.length > create[best]!.members.length) {
        largest.set(old, slot);
      }
    });
    const taken = new Set<number>();
    for (const [island, slot] of largest) {
      retained.set(island, create[slot]!.members);
      taken.add(slot);
    }
    if (taken.size) {
      const remaining = create.filter((_, slot) => !taken.has(slot));
      create.length = 0;
      create.push(...remaining);
    }
    return retained;
  }

  /** Reduce a body to `members`: drop the colliders of the pieces that left and re-key it. */
  private shrinkIsland(island: Island, members: Array<number>): void {
    const stay = new Set(members);
    const gone = new Set<number>();
    for (const index of island.members) {
      if (stay.has(index)) {
        continue;
      }
      this.frozen[index] = 0;
      const collider = island.primaries.get(index);
      if (collider) {
        this.wakeSupportContacts(collider);
        this.colliderFragments.delete(collider.handle);
        gone.add(collider.handle);
        this.removeCollider(collider, true);
        island.primaries.delete(index);
      }
      island.poses.delete(index);
    }
    island.colliders = island.colliders.filter(
      (collider) => !gone.has(collider.handle),
    );
    this.islands.delete(island.key);
    const velocity = this.preStepVelocity.get(island.key);
    this.preStepVelocity.delete(island.key);
    island.members = members;
    island.visibleChunks = this.graph.getVisibleChunks(members);
    island.key = members[0]!;
    this.islands.set(island.key, island);
    if (velocity) {
      this.preStepVelocity.set(island.key, velocity);
    }
    for (const member of members) {
      this.fragmentIsland[member] = island.key;
    }
    island.body.recomputeMassPropertiesFromColliders();
    this.wakeIsland(island);
    island.transformState = undefined;
  }

  private applyTargetedImpulse(command: DestructionCommand): void {
    const impulse = vec(command.impulse!);
    if (!(Math.sqrt(squared(impulse)) > 0)) {
      return;
    }
    const record = this.impactRecords.get(command);
    if (record?.consumed) {
      return;
    }
    let child: SecondaryBody | undefined, root: number | undefined;
    if (record?.root !== undefined) {
      root = record.root;
    } else {
      const target = this.liveTarget(
        command.fragmentId!,
        vec(command.position),
        command.radius,
      );
      child = target?.child;
      root = target?.primary ?? child?.attachedRoot;
      if (child?.attachedRoot !== undefined) {
        child = undefined;
      }
    }
    const island =
      child || root === undefined
        ? undefined
        : this.islands.get(this.fragmentIsland[root]!);
    const body = child?.body ?? island?.body;
    if (!body) {
      return;
    }
    if (child ? !this.wakeChild(child) : !this.wakeIsland(island!)) {
      return;
    }
    body.recomputeMassPropertiesFromColliders();
    body.applyImpulseAtPoint(
      this.cappedImpulse(body, impulse),
      vec(command.position),
      true,
    );
  }

  /** Preserve the application point as well as J when an actor is rebuilt or demoted. */
  private structuralImpulse(chunk: number, point: V, impulse: V): StructuralImpulse {
    const center = this.position(chunk), rotation = inverse(this.rotation(chunk));
    const local = rotate(rotation, {
      x: point.x - center.x, y: point.y - center.y, z: point.z - center.z,
    });
    const rest = this.manifest.fragments[chunk]!.position;
    return {
      chunk, point: [rest[0] + local.x, rest[1] + local.y, rest[2] + local.z],
      impulse: tuple(rotate(rotation, impulse)),
    };
  }

  private blastFaces(fragment: FragmentDef): Array<PressureFace> {
    const cached = this.pressureGeometry.get(fragment);
    if (cached) return cached;
    let polygons: Array<Array<Vec3>>;
    if (fragment.shape) {
      polygons = fragment.shape.faces.map((face) => face.vertices.map((i) => fragment.shape!.vertices[i]!));
    } else {
      polygons = [];
      for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
        const u = (axis + 1) % 3, v = (axis + 2) % 3;
        const corners = sign > 0 ? [[-1, -1], [1, -1], [1, 1], [-1, 1]] : [[-1, -1], [-1, 1], [1, 1], [1, -1]];
        polygons.push(corners.map(([a, b]) => {
          const p: Vec3 = [0, 0, 0];
          p[axis] = sign * fragment.size[axis]! / 2;
          p[u] = a! * fragment.size[u]! / 2;
          p[v] = b! * fragment.size[v]! / 2;
          return p;
        }));
      }
    }
    const faces: Array<PressureFace> = [];
    for (const polygon of polygons) {
      const first = polygon[0];
      if (!first || polygon.length < 3) continue;
      const samples: PressureFace['samples'] = [];
      const normal = { x: 0, y: 0, z: 0 }, center = { x: 0, y: 0, z: 0 };
      let area = 0;
      for (let i = 1; i + 1 < polygon.length; i++) {
        const b = polygon[i]!, c = polygon[i + 1]!;
        const ux = b[0] - first[0], uy = b[1] - first[1], uz = b[2] - first[2];
        const vx = c[0] - first[0], vy = c[1] - first[1], vz = c[2] - first[2];
        const cross = { x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx };
        const triangleArea = Math.sqrt(squared(cross)) / 2;
        if (!(triangleArea > 1e-12)) continue;
        normal.x += cross.x; normal.y += cross.y; normal.z += cross.z;
        center.x += (first[0] + b[0] + c[0]) * triangleArea / 3;
        center.y += (first[1] + b[1] + c[1]) * triangleArea / 3;
        center.z += (first[2] + b[2] + c[2]) * triangleArea / 3;
        area += triangleArea;
        // Three-point triangle quadrature retains off-centre pressure torque on wide panels.
        for (const weights of [[2 / 3, 1 / 6, 1 / 6], [1 / 6, 2 / 3, 1 / 6], [1 / 6, 1 / 6, 2 / 3]]) {
          samples.push({
            point: {
              x: first[0] * weights[0]! + b[0] * weights[1]! + c[0] * weights[2]!,
              y: first[1] * weights[0]! + b[1] * weights[1]! + c[1] * weights[2]!,
              z: first[2] * weights[0]! + b[2] * weights[1]! + c[2] * weights[2]!,
            }, area: triangleArea / 3,
          });
        }
      }
      const length = Math.sqrt(squared(normal));
      if (!(area > 0) || !(length > 0)) continue;
      normal.x /= length; normal.y /= length; normal.z /= length;
      center.x /= area; center.y /= area; center.z /= area;
      if (normal.x * center.x + normal.y * center.y + normal.z * center.z < 0) {
        normal.x *= -1; normal.y *= -1; normal.z *= -1;
      }
      faces.push({ normal, area, point: center, samples });
    }
    this.pressureGeometry.set(fragment, faces);
    return faces;
  }

  /** Intact touching interfaces shield their shared area from the pressure wave. */
  private exposedPressureFraction(chunk: number, face: PressureFace): number {
    const fragment = this.manifest.fragments[chunk]!;
    const p = { x: face.point.x + fragment.position[0], y: face.point.y + fragment.position[1], z: face.point.z + fragment.position[2] };
    let covered = 0;
    for (let at = this.graph.rowOffsets[chunk]!; at < this.graph.rowOffsets[chunk + 1]!; at++) {
      const index = this.graph.bondIndices[at]!;
      if (this.graph.states[index] === BondState.Broken) continue;
      const bond = this.manifest.bonds[index]!, a = this.graph.endpointsA[index]!, b = this.graph.endpointsB[index]!;
      const sign = a === chunk ? 1 : -1;
      if (sign * (bond.normal[0] * face.normal.x + bond.normal[1] * face.normal.y + bond.normal[2] * face.normal.z) < 0.999) continue;
      const point = bond.centroid ?? bond.section?.point;
      if (!point || Math.abs((point[0] - p.x) * face.normal.x + (point[1] - p.y) * face.normal.y + (point[2] - p.z) * face.normal.z) > 0.01) continue;
      if (bond.b !== -1) {
        const worldPoint = (node: number): V => {
          const rest = this.manifest.fragments[node]!.position, center = this.position(node);
          const offset = rotate(this.rotation(node), { x: point[0] - rest[0], y: point[1] - rest[1], z: point[2] - rest[2] });
          return { x: center.x + offset.x, y: center.y + offset.y, z: center.z + offset.z };
        };
        const pa = worldPoint(a), pb = worldPoint(b);
        if (Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z) > 0.02) continue;
      }
      covered += bond.area;
    }
    return clamp(1 - covered / face.area, 0, 1);
  }

  private collectBlastPressure(commands: Array<DestructionCommand>): Array<PressureImpulse> {
    const result: Array<PressureImpulse> = [];
    for (const command of commands) {
      if (command.type !== "explosion") continue;
      const key = `${command.source}:${command.id}`;
      const burst: PressureBurst = { command, sources: new Map(), detached: new Set() };
      this.pressureBursts.set(key, burst);
      const groups = new Map<Island, NonNullable<PressureSource['group']>>();
      const origin = vec(command.position);
      const affected = new Map<number, number>();
      let magnitude = 0;
      const minRadius = command.minRadius ?? command.radius * BRISANCE_FRACTION;
      const edgePressure = (minRadius / command.radius) ** 2;
      const sample = (fragment: FragmentDef, chunk: number, center: V, rotation: Q, child?: SecondaryBody) => {
        if (Math.hypot(center.x - origin.x, center.y - origin.y, center.z - origin.z) > command.radius + Math.hypot(...fragment.size) / 2) return;
        // Attached refined geometry still belongs to its support node even when
        // that node's original collider has been replaced by retained pieces.
        if (chunk >= 0 && !burst.sources.has(chunk)) {
          const source: PressureSource = { supported: !!this.graph.supported[chunk], affected: false };
          const actor = this.actorForFragment(chunk);
          if (!source.supported && actor) {
            let group = groups.get(actor);
            if (!group) groups.set(actor, group = { nodes: [...actor.members], affected: false });
            source.group = group;
          }
          burst.sources.set(chunk, source);
        }
        for (const face of this.blastFaces(fragment)) {
          const exposed = chunk >= 0 && !child ? this.exposedPressureFraction(chunk, face) : 1;
          if (!(exposed > 0)) continue;
          const normal = rotate(rotation, face.normal);
          for (const sample of face.samples) {
            const offset = rotate(rotation, sample.point);
            const point = { x: center.x + offset.x, y: center.y + offset.y, z: center.z + offset.z };
            const direction = { x: point.x - origin.x, y: point.y - origin.y, z: point.z - origin.z };
            const distance = Math.sqrt(squared(direction));
            if (!(distance > 1e-6) || distance >= command.radius) continue;
            direction.x /= distance; direction.y /= distance; direction.z /= distance;
            const incidence = -(normal.x * direction.x + normal.y * direction.y + normal.z * direction.z);
            if (!(incidence > 0)) continue;
            // Subtract and normalize the inverse-square value at the outer edge:
            // full pressure in the core, continuous decay to zero at the radius.
            const falloff = distance <= minRadius ? 1
              : ((minRadius / distance) ** 2 - edgePressure) / (1 - edgePressure);
            const pressure = this.pressureImpulse * command.strength * falloff;
            const impulse = pressure * sample.area * exposed * incidence;
            if (!(impulse > 0)) continue;
            const blocker = this.world.castRay(new this.rapier.Ray(origin, direction), Math.max(0, distance - 0.02), true,
              undefined, undefined, undefined, undefined, (collider) => {
                if (child && collider.handle === child.collider.handle) return false;
                const visible = this.colliderFragments.get(collider.handle);
                if (visible !== undefined && chunk >= 0) {
                  for (let node = chunk; node >= 0; node = this.graph.parents[node]!) if (node === visible) return false;
                }
                return !this.ballColliders.has(collider.handle) && !collider.isSensor();
              });
            if (blocker) continue;
            const worldImpulse = { x: direction.x * impulse, y: direction.y * impulse, z: direction.z * impulse };
            const load = chunk >= 0 ? this.structuralImpulse(chunk, point, worldImpulse)
              : { chunk: -1, point: tuple(point), impulse: tuple(worldImpulse) };
            result.push({ ...load, command: key, child,
              sourceMass: child ? fragment.mass : this.graph.fragmentMass[chunk]!,
              worldPoint: point, worldImpulse });
            affected.set(fragment.id, child ? fragment.mass : this.graph.fragmentMass[chunk]!);
            magnitude += impulse;
          }
        }
      };
      for (let chunk = 0; chunk < this.manifest.fragments.length; chunk++) {
        if (!this.graph.activeChunks[chunk] || this.retired.has(chunk) || this.refined.has(chunk)) continue;
        sample(this.manifest.fragments[chunk]!, chunk, this.position(chunk), this.rotation(chunk));
      }
      for (const child of this.secondary) {
        sample(child.fragment, child.attachedRoot ?? -1, child.collider.translation(), child.collider.rotation(), child);
      }
      const mass = [...affected.values()].reduce((sum, value) => sum + value, 0);
      this.events.push({ count: affected.size, energy: mass > 0 ? magnitude * magnitude / (2 * mass) : 0,
        mass, impulse: magnitude, normal: command.direction, radius: command.radius,
        position: command.position, tick: this.tick, type: "explosiveDetonated" });
    }
    return result;
  }

  /** Match accepted programs without changing batched graph fracture ordering. */
  private captureBlastFracture(buffer: FractureCommandBuffer): void {
    if (!this.pressureBursts.size) return;
    const bursts = buffer.programs.map(program => program.commandKey ? this.pressureBursts.get(program.commandKey) : undefined);
    const accepted = new Set(bursts.filter((burst): burst is PressureBurst => !!burst));
    for (const [key, burst] of this.pressureBursts) if (!accepted.has(burst)) this.pressureBursts.delete(key);
    const touch = (program: number | undefined, node: number) => {
      if (program === undefined) return;
      const source = bursts[program]?.sources.get(node);
      if (source) source.affected = true;
      if (source?.group) source.group.affected = true;
    };
    for (const command of buffer.chunks) if (command.health > 0) touch(command.program, command.chunk);
    for (const command of buffer.bonds) if (command.health > 0) {
      touch(command.program, this.graph.endpointsA[command.bond]!);
      touch(command.program, this.graph.endpointsB[command.bond]!);
    }
  }

  private blastSource(burst: PressureBurst, chunk: number): PressureSource | undefined {
    for (let node = chunk; node >= 0; node = this.graph.parents[node]!) {
      const source = burst.sources.get(node);
      if (source) return source;
    }
    return undefined;
  }

  private blastGroupSplit(group: NonNullable<PressureSource['group']>): boolean {
    if (group.split !== undefined) return group.split;
    const bodies = new Set<RAPIER.RigidBody>();
    const visit = (node: number): void => {
      if (bodies.size > 1) return;
      if (this.graph.activeChunks[node]) {
        const actor = this.actorForFragment(node);
        if (actor) bodies.add(actor.body);
      } else for (const child of this.graph.children[node] ?? []) visit(child);
    };
    for (const node of group.nodes) visit(node);
    return group.split = bodies.size > 1;
  }

  /** Capture graph detachments and sample recipients before secondary removes graph leaves. */
  private captureBlastDetachments(loads: Array<PressureImpulse>): void {
    // Preserve old LOS wake/admission order before secondary candidate and
    // capacity choices. Only the physical impulse waits for final descendants.
    for (const load of loads) {
      const child = load.child;
      if (child && child.attachedRoot === undefined) {
        load.launchAccepted = this.secondaryById.has(child.fragment.id) && this.wakeChild(child);
        continue;
      }
      const chunk = this.graph.resolveSupportChunk(load.chunk, load.point);
      load.receiverChunk = chunk;
      const actor = chunk >= 0 ? this.actorForFragment(chunk) : undefined;
      load.launchAccepted = !!actor && !this.graph.supported[chunk] && this.wakeIsland(actor);
    }
    for (const burst of this.pressureBursts.values()) {
      for (const actor of this.islands.values()) for (const chunk of actor.members) {
        if (this.retired.has(chunk) || this.graph.supported[chunk]) continue;
        const source = this.blastSource(burst, chunk);
        if (source && (source.supported && source.affected || source.group?.affected && this.blastGroupSplit(source.group))) burst.detached.add(chunk);
      }
    }
  }

  private radialPressure(command: DestructionCommand, fragment: FragmentDef, center: V): V | undefined {
    const direction = { x: center.x - command.position[0], y: center.y - command.position[1], z: center.z - command.position[2] };
    const distance = Math.sqrt(squared(direction));
    if (!(distance > 1e-6) || distance >= command.radius) return;
    const minRadius = command.minRadius ?? command.radius * BRISANCE_FRACTION;
    const edgePressure = (minRadius / command.radius) ** 2;
    const falloff = distance <= minRadius ? 1
      : ((minRadius / distance) ** 2 - edgePressure) / (1 - edgePressure);
    const magnitude = this.pressureImpulse * command.strength * falloff * volumeOf(fragment) ** (2 / 3);
    if (!(magnitude > 0)) return;
    return { x: direction.x * magnitude / distance, y: direction.y * magnitude / distance, z: direction.z * magnitude / distance };
  }

  private applyBlastPressure(loads: Array<PressureImpulse>): void {
    const targets = new Map<RAPIER.RigidBody, PressureReceiver>();
    const target = (body: RAPIER.RigidBody, sourceMass: number, sample: PressureSample) => {
      let receiver = targets.get(body);
      if (!receiver) targets.set(body, receiver = { sourceMass, detached: false, samples: [] });
      receiver.sourceMass = Math.max(receiver.sourceMass, sourceMass);
      if (sample.radial) {
        receiver.detached = true;
        // This event launches detached geometry once: radial pressure replaces
        // its previously sampled LOS launch on that same receiver.
        receiver.samples = receiver.samples.filter(previous => previous.command !== sample.command || previous.radial);
      } else if (receiver.samples.some(previous => previous.command === sample.command && previous.radial)) return;
      receiver.samples.push(sample);
    };
    for (const load of loads) {
      if (!load.launchAccepted) continue;
      const child = load.child;
      if (child?.attachedRoot === undefined && child) {
        if (this.secondaryById.has(child.fragment.id)) {
          target(child.body, load.sourceMass, { command: load.command, impulse: load.worldImpulse, point: load.worldPoint });
        }
        continue;
      }
      const chunk = load.receiverChunk ?? -1;
      if (chunk < 0) continue;
      const rest = this.manifest.fragments[chunk]!.position;
      const center = this.position(chunk), rotation = this.rotation(chunk);
      const offset = rotate(rotation, { x: load.point[0] - rest[0], y: load.point[1] - rest[1], z: load.point[2] - rest[2] });
      const point = { x: center.x + offset.x, y: center.y + offset.y, z: center.z + offset.z };
      const descendants = this.pressureDescendants.get(chunk);
      if (descendants) {
        const receiver = this.closest(descendants, point);
        if (receiver) target(receiver.body, load.sourceMass, { command: load.command, impulse: rotate(rotation, vec(load.impulse)), point });
        continue;
      }
      const actor = this.actorForFragment(chunk);
      if (!actor || this.graph.supported[chunk]) continue;
      target(actor.body, load.sourceMass, { command: load.command, impulse: rotate(rotation, vec(load.impulse)), point });
    }
    for (const [key, burst] of this.pressureBursts) {
      const launch = (body: RAPIER.RigidBody, fragment: FragmentDef, point: V) => {
        const receiver = targets.get(body);
        if (receiver) receiver.detached = true;
        const impulse = this.radialPressure(burst.command, fragment, point);
        if (impulse) target(body, 0, { command: key, impulse, point, radial: true });
      };
      for (const chunk of burst.detached) {
        const descendants = this.pressureDescendants.get(chunk);
        if (descendants) {
          for (const child of descendants) if (this.secondaryById.has(child.fragment.id) && this.wakeChild(child)) {
            launch(child.body, child.fragment, child.body.translation());
          }
          continue;
        }
        const actor = this.actorForFragment(chunk);
        if (!actor || this.graph.supported[chunk] || !this.wakeIsland(actor)) continue;
        if (this.refined.has(chunk)) {
          for (const child of this.secondary) if (child.attachedRoot === chunk) launch(actor.body, child.fragment, child.collider.translation());
        } else launch(actor.body, this.manifest.fragments[chunk]!, this.position(chunk));
      }
    }
    for (const [body, { sourceMass, detached, samples }] of targets) {
      // The actual receiving body owns the launch budget. A still-compound actor
      // uses its full mass; independent same-event children each use their own.
      body.recomputeMassPropertiesFromColliders();
      const mass = body.mass();
      if (!body.isDynamic() || !(mass > 0)) continue;
      const capMass = detached ? mass : Math.max(mass, sourceMass);
      const speed = MAX_DEBRIS_SPEED * Math.min(1, BLAST_LAUNCH_REFERENCE_MASS / capMass);
      this.pressureLaunches.set(body, { speed, center: body.worldCom(), velocity: body.linvel(), angular: body.angvel() });
      const total = samples.reduce((sum, sample) => add(sum, sample.impulse), { x: 0, y: 0, z: 0 });
      const magnitude = Math.sqrt(squared(total));
      const scale = magnitude > 0 ? Math.min(1, mass * speed / magnitude) : 1;
      for (const { impulse, point } of samples) {
        body.applyImpulseAtPoint({ x: impulse.x * scale, y: impulse.y * scale, z: impulse.z * scale }, point, true);
      }
      body.setLinvel(limit(this.pressureVelocity(body, body.linvel(), body.worldCom()), MAX_DEBRIS_SPEED), true);
      body.setAngvel(limit(body.angvel(), MAX_DEBRIS_SPIN), true);
    }
  }

  private applyImpulses(commands: Array<DestructionCommand>): void {
    for (const command of commands) {
      if (command.type === "cut" || command.type === "explosion") {
        continue;
      }
      if (command.impulse && command.fragmentId !== undefined) {
        this.applyTargetedImpulse(command);
        continue;
      }
      const ballImpact =
        command.source === ORDNANCE_SOURCE
          ? this.ballImpactEffects.get(command.id)
          : undefined;
      if (ballImpact) {
        this.ballImpactEffects.delete(command.id);
        if (ballImpact.release && ballImpact.fragment !== undefined) {
          const island = this.islands.get(
            this.fragmentIsland[ballImpact.fragment]!,
          );
          if (island && !island.settled) {
            island.body.applyImpulseAtPoint(
              ballImpact.impulse,
              ballImpact.position,
              true,
            );
          }
        }
        continue;
      }
      if (
        command.source === ORDNANCE_SOURCE &&
        command.type === "pointImpact"
      ) {
        continue;
      }
      const origin = vec(command.position);
      for (const island of this.islands.values()) {
        let closest = Infinity,
          point = this.position(island.members[0]!);
        for (const index of island.members) {
          const p = this.position(index),
            f = this.manifest.fragments[index]!;
          if (this.refined.has(index)) {
            for (const child of this.secondary) {
              if (child.attachedRoot !== index) {
                continue;
              }
              const d = this.distanceTo(child.collider, origin);
              if (d < closest) {
                closest = d;
                point = child.collider.translation();
              }
            }
            continue;
          }
          if (f.shape) {
            const collider = island.primaries.get(index);
            const d = collider ? this.distanceTo(collider, origin) : Infinity;
            if (d < closest) {
              closest = d;
              point = p;
            }
            continue;
          }
          const dx = Math.max(0, Math.abs(p.x - origin.x) - f.size[0] / 2),
            dy = Math.max(0, Math.abs(p.y - origin.y) - f.size[1] / 2),
            dz = Math.max(0, Math.abs(p.z - origin.z) - f.size[2] / 2);
          const d = Math.hypot(dx, dy, dz);
          if (d < closest) {
            closest = d;
            point = p;
          }
        }
        if (closest > command.radius) {
          continue;
        }
        if ((island.settled || island.baked) && !this.wakeIsland(island)) {
          continue;
        }
        island.stableTicks = 0;
        const direction = vec(command.direction);
        const norm = Math.sqrt(squared(direction)) || 1;
        const falloff = clamp(1 - closest / command.radius, 0.1, 1);
        const impulse =
          Math.min(island.body.mass(), 900) * command.strength * 1.8 * falloff;
        island.body.applyImpulseAtPoint(
          {
            x: (direction.x / norm) * impulse,
            y: (direction.y / norm) * impulse,
            z: (direction.z / norm) * impulse,
          },
          point,
          true,
        );
      }
      for (const child of this.secondary) {
        if (child.attachedRoot !== undefined) {
          continue;
        }
        const hit = child.collider.projectPoint(origin, true);
        if (!hit) {
          continue;
        }
        const distance = Math.hypot(
          hit.point.x - origin.x,
          hit.point.y - origin.y,
          hit.point.z - origin.z,
        );
        if (distance > command.radius) {
          continue;
        }
        if (!this.wakeChild(child)) {
          continue;
        }
        const point = child.collider.translation();
        const direction = vec(command.direction);
        const norm = Math.sqrt(squared(direction)) || 1;
        const impulse =
          Math.min(child.body.mass(), 900) *
          command.strength *
          1.8 *
          clamp(1 - distance / command.radius, 0.1, 1);
        child.body.applyImpulseAtPoint(
          {
            x: (direction.x / norm) * impulse,
            y: (direction.y / norm) * impulse,
            z: (direction.z / norm) * impulse,
          },
          point,
          true,
        );
      }
    }
  }

  /**
   * A body that has been slow for SETTLE_SECONDS is baked: made a fixed body, which keeps it out of
   * the solver, the contact pass and these loops until something wakes it (`wakeIsland`,
   * `wakeChild`). Rapier's own sleeping cannot do this for a pile, since one awake neighbour keeps
   * every body it touches awake, and forcing a single body asleep is undone by that neighbour on
   * the next step.
   */
  private bake(body: RAPIER.RigidBody): void {
    body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    this.changeBodyType(body, this.rapier.RigidBodyType.Fixed, false);
    this.bodyRevision++;
    this.everBaked = true;
  }

  private changeBodyType(body: RAPIER.RigidBody, type: RAPIER.RigidBodyType, wakeUp: boolean): void {
    if (body.bodyType() === type) return;
    body.setBodyType(type, wakeUp);
    this.pendingContactWarmstart.add(body);
  }

  /** Run outside contact callbacks: native manifold pointers must not be borrowed here. */
  private resetChangedContactWarmstarts(): void {
    const reset = (this.world.narrowPhase as RAPIER.NarrowPhase & {
      resetContactWarmstart?: (collider: number) => void;
    }).resetContactWarmstart;
    if (typeof reset !== 'function') {
      this.pendingContactWarmstart.clear();
      return;
    }
    for (const body of this.pendingContactWarmstart) {
      if (!body.isValid()) continue;
      for (let i = 0; i < body.numColliders(); i++) {
        reset.call(this.world.narrowPhase, body.collider(i).handle);
      }
    }
    this.pendingContactWarmstart.clear();
  }

  /**
   * A body counts a tick as stable when it is slower than the settle speeds. Jitter in a heavy pile
   * pushes a body just over them for a tick or two, so a body inside a looser band holds its count
   * and only a clearly moving one starts again.
   */
  private countStable(item: {
    body: RAPIER.RigidBody;
    stableTicks: number;
    restTicks?: number;
  }): void {
    const linvel = squared(item.body.linvel()),
      angvel = squared(item.body.angvel()),
      linear = linvel / this.rest.speed ** 2,
      angular = angvel / this.rest.spin ** 2;
    if (linear < 1 && angular < 1) {
      item.stableTicks++;
    } else if (linear > SETTLE_HOLD ** 2 || angular > SETTLE_HOLD ** 2) {
      item.stableTicks = 0;
    }
    if (this.forceRestTicks === Infinity) return;
    item.restTicks = linvel < this.rest.forceSpeed! ** 2 && angvel < this.rest.forceSpin! ** 2 ? (item.restTicks ?? 0) + 1 : 0;
  }

  private forceRest(item: { body: RAPIER.RigidBody; restTicks?: number }): void {
    if ((item.restTicks ?? 0) < this.forceRestTicks) return;
    if (item.body.isDynamic() && !item.body.isSleeping() && !this.bearingSupports.has(item.body)) item.body.sleep();
  }

  /** What an island carries once baked: its contact wrenches are frozen and it counts as settled. */
  private finishIslandBake(island: Island): void {
    for (const index of island.members) {
      for (let axis = 0; axis < 6; axis++) {
        this.frozenWrenches[index * 6 + axis] =
          this.contactWrenches[index * 6 + axis]!;
      }
      this.frozen[index] = 1;
    }
    island.baked = true;
    island.settled = true;
    const p = island.body.translation();
    const mass = island.members.reduce((sum, index) => sum + this.graph.fragmentMass[index]!, 0);
    const velocity = this.preStepVelocity.get(island.key) ?? { x: 0, y: 0, z: 0 };
    this.events.push({
      count: island.members.length,
      energy: 0.5 * mass * squared(velocity),
      mass, impulse: mass * Math.sqrt(squared(velocity)), normal: [0, 1, 0],
      radius: Math.cbrt(island.members.reduce((v, i) => v + volumeOf(this.manifest.fragments[i]!), 0)) / 2,
      position: [p.x, p.y, p.z],
      tick: this.tick,
      type: "rubbleSettled",
    });
  }

  /**
   * Whether a body rests on the ground or on a baked body, so it is safe to bake now. A pile that is
   * itself still moving does not count: freezing a group that merely falls together would leave it
   * hanging in the air.
   */
  private grounded(
    body: RAPIER.RigidBody,
    colliders: ReadonlyArray<RAPIER.Collider>,
  ): boolean {
    if (!bearingBodyValid(body, 'grounding owner')) return false;
    if (Math.abs(body.linvel().y) > 1.5) {
      return false;
    }
    const live = colliders.filter(collider => bearingColliderValid(collider, 'grounding collider'));
    const probes =
      live.length > 8
        ? live
            .sort((a, b) => a.translation().y - b.translation().y)
            .slice(0, 8)
        : live;
    for (const collider of probes) {
      let found = false;
      this.forEachSupporter(
        body,
        [collider],
        (other) => {
          found = !other || !other.isDynamic();
          return !found;
        },
        true,
      );
      if (found) {
        return true;
      }
    }
    return false;
  }

  /**
   * The step budget's degradation ladder (see budget.ts), applied just before the step. Rung 1 bakes
   * every awake body that is slow and resting; rung 2 bakes the slowest resting ones, oldest first,
   * as many as the overage calls for. Rungs 3 and 4 act in `fractureSecondary` and `ageDebris`.
   */
  private chunky(island?: Island, child?: SecondaryBody): boolean {
    const sizes = island
      ? island.members.map((index) => this.manifest.fragments[index]!.size)
      : [child!.fragment.size];
    return sizes.every(
      (size) => Math.min(...size) >= STEP_BUDGET.chunkyThickness,
    );
  }

  /** Full continuous collision detection on, or soft prediction in its place. */
  private setCcd(body: RAPIER.RigidBody, full: boolean): void {
    body.enableCcd(full);
    body.setSoftCcdPrediction(full ? 0 : STEP_BUDGET.softCcdPrediction);
  }

  private applyBudget(): void {
    const rung = this.budget.rung;
    // Recheck every body: a previously relaxed body can accelerate in a later
    // step or leave the small-rubble candidate set after its geometry changes.
    const keepFastCcd = (body: RAPIER.RigidBody) => {
      if (body.isDynamic() && !body.isCcdEnabled() && squared(body.linvel()) > STEP_BUDGET.fullCcdSpeed ** 2) {
        this.setCcd(body, true);
      }
    };
    for (const island of this.islands.values()) keepFastCcd(island.body);
    for (const child of this.secondary) if (child.attachedRoot === undefined) keepFastCcd(child.body);
    if (rung < STEP_BUDGET.relaxCcdRung && this.ccdRelaxed) {
      this.ccdRelaxed = false;
      for (const island of this.islands.values()) {
        this.setCcd(island.body, true);
      }
      for (const child of this.secondary) {
        if (child.attachedRoot === undefined) {
          this.setCcd(child.body, true);
        }
      }
    }
    if (rung < 1) {
      return;
    }
    interface Entry {
      child?: SecondaryBody;
      colliders: ReadonlyArray<RAPIER.Collider>;
      id: number;
      island?: Island;
      linear: number;
      spin: number;
      stable: number;
    }
    const awake: Array<Entry> = [];
    for (const island of this.islands.values()) {
      // Structural chunks are left to settle on their own: one that has only just let go of its
      // footings is slow and "resting" until it starts to fall, and freezing it freezes the collapse.
      if (
        island.baked ||
        island.settled ||
        island.members.length > STEP_BUDGET.rubbleMembers ||
        !island.body.isDynamic() ||
        island.body.isSleeping()
      ) {
        continue;
      }
      awake.push({
        colliders: island.colliders,
        id: this.manifest.fragments[island.members[0]!]!.id,
        island,
        stable: island.stableTicks,
        linear: squared(island.body.linvel()),
        spin: squared(island.body.angvel()),
      });
    }
    for (const child of this.secondary) {
      if (
        child.attachedRoot !== undefined ||
        child.baked ||
        !child.body.isDynamic() ||
        child.body.isSleeping()
      ) {
        continue;
      }
      awake.push({
        child,
        colliders: [child.collider],
        id: child.fragment.id,
        stable: child.stableTicks,
        linear: squared(child.body.linvel()),
        spin: squared(child.body.angvel()),
      });
    }
    if (rung >= STEP_BUDGET.relaxCcdRung) {
      // Full continuous collision detection is the largest single cost of a falling pile. Chunky
      // bodies swap it for soft prediction while over budget; thin chips keep the real thing.
      this.ccdRelaxed = true;
      for (const entry of awake) {
        const item = (entry.island ?? entry.child)!;
        if (
          item.body.isCcdEnabled() &&
          entry.linear <= STEP_BUDGET.fullCcdSpeed ** 2 &&
          this.chunky(entry.island, entry.child)
        ) {
          this.setCcd(item.body, false);
        }
      }
    }
    const baked = new Set<Entry>();
    let room = STEP_BUDGET.bakesPerTick * this.tickScale - (this.experimentalBearingReanchor ? this.budgetBakeReservationsThisTick : 0);
    const settle = (entry: Entry): boolean => {
      const owner = entry.island
        ? { island: entry.island }
        : { child: entry.child };
      const body = (entry.island ?? entry.child)!.body;
      if (!this.grounded(body, entry.colliders) || !this.bakeBody(owner, true)) return false;
      baked.add(entry);
      room--;
      if (!this.experimentalBearingReanchor) {
        this.budgetBaked++;
        this.budgetBakedTotal++;
        if (entry.island) this.finishIslandBake(entry.island);
        else { entry.child!.baked = true; entry.child!.settled = true; }
      }
      return true;
    };
    const oldestFirst = (a: Entry, b: Entry) => a.id - b.id;
    for (const entry of awake
      .filter(
        (e) =>
          e.stable >= STEP_BUDGET.sleepAfterTicks &&
          e.linear < STEP_BUDGET.sleepSpeed ** 2 &&
          e.spin < STEP_BUDGET.sleepSpin ** 2,
      )
      .sort(oldestFirst)) {
      if (room <= 0) {
        break;
      }
      settle(entry);
    }
    if (rung < 2) {
      return;
    }
    let quota = Math.min(this.budget.quota(awake.length), room);
    for (const entry of awake
      .filter((e) => !baked.has(e) && e.linear < STEP_BUDGET.bakeSpeed ** 2)
      .sort((a, b) => a.linear - b.linear || a.id - b.id)) {
      if (quota <= 0 || room <= 0) {
        break;
      }
      if (settle(entry)) quota--;
    }
  }

  private bearingPairKey(a: RAPIER.Collider, b: RAPIER.Collider): string {
    return a.handle < b.handle
      ? `${a.handle}:${b.handle}`
      : `${b.handle}:${a.handle}`;
  }

  private bearingPose(body: RAPIER.RigidBody): number[] {
    const p = body.translation(),
      q = body.rotation();
    return [p.x, p.y, p.z, q.x, q.y, q.z, q.w];
  }

  private bearingRotation(support: BearingSupport, anchor: BearingAnchor): Q {
    return support.child
      ? support.child.collider.rotation()
      : this.rotation(anchor.chunk);
  }

  private bearingWorldPoint(
    support: BearingSupport,
    anchor: BearingAnchor,
  ): Vec3 {
    const fragment =
      support.child?.fragment ?? this.manifest.fragments[anchor.chunk]!;
    const p = support.child
      ? support.child.collider.translation()
      : this.position(anchor.chunk);
    const c = anchor.definition.centroid!;
    const offset = rotate(this.bearingRotation(support, anchor), {
      x: c[0] - fragment.position[0],
      y: c[1] - fragment.position[1],
      z: c[2] - fragment.position[2],
    });
    return [p.x + offset.x, p.y + offset.y, p.z + offset.z];
  }

  /** Capture real bearing polygons; defer making the actor fixed until the next completed B2 solve. */
  private requestBearingSupport(
    owner: { island?: Island; child?: SecondaryBody },
    colliders: readonly RAPIER.Collider[],
  ): void {
    if (!this.experimentalBearingReanchor) return;
    const item = (owner.island ?? owner.child)!,
      body = item.body;
    if (!bearingBodyValid(body, 'capture owner') || this.bearingSupports.has(body) || !body.isDynamic()) return;
    if (owner.child && !bearingColliderValid(owner.child.collider, 'capture secondary')) return;
    const contacts = bearingPatches(this.world, body, colliders);
    const groups = new Map<
      number,
      { polygons: BearingPolygon[]; providers: BearingProvider[] }
    >();
    const members = owner.island?.members ?? [-1];
    for (const contact of contacts) {
      if (!bearingBodyValid(body, 'capture owner after patch enumeration')) return;
      if (!bearingColliderValid(contact.receiver, 'capture receiver') ||
          !bearingColliderValid(contact.supporter, 'capture supporter')) continue;
      const otherBody = contact.supporter.parent();
      if (otherBody && !bearingBodyValid(otherBody, 'capture supporter parent')) continue;
      if (otherBody && this.bearingSupports.get(otherBody)?.releasing) continue;
      // Fixed fragments from the original level are permanent world; baked providers remain
      // individually solvable and wake their dependents if their own bearing bonds fail.
      const secondary = this.secondaryColliders.get(contact.supporter.handle);
      const receiver = this.colliderFragments.get(contact.receiver.handle);
      const directChunk = receiver !== undefined && this.graph.activeChunks[receiver] && members.includes(receiver) ? receiver : undefined;
      for (const chunk of directChunk === undefined ? members : [directChunk]) {
        const fragment =
          owner.child?.fragment ?? this.manifest.fragments[chunk]!;
        if (
          !owner.child &&
          (!this.graph.activeChunks[chunk] ||
            this.graph.fragmentMass[chunk]! <= 0)
        )
          continue;
        const p = owner.child
          ? owner.child.collider.translation()
          : this.position(chunk);
        const q = inverse(
          owner.child ? owner.child.collider.rotation() : this.rotation(chunk),
        );
        const local = contact.points.map((point): Vec3 => {
          const delta = rotate(q, {
            x: point[0] - p.x,
            y: point[1] - p.y,
            z: point[2] - p.z,
          });
          return [
            fragment.position[0] + delta.x,
            fragment.position[1] + delta.y,
            fragment.position[2] + delta.z,
          ];
        });
        // An active node owns its complete collider, including inherited affine collision
        // offsets. Only an aggregate visible ancestor needs partitioning among graph children.
        const points = owner.child || directChunk !== undefined ? local : clipBearingPolygon(local, fragment);
        if (points.length < 3) continue;
        const normal = tuple(rotate(q, vec(contact.normal)));
        const material = this.manifest.materials.find(
          (m) => m.id === fragment.material,
        )!;
        const patch = bearingBond(
          fragment,
          [{ points, normal }],
          material.strength,
        );
        if (!patch) continue;
        const centroid = patch.centroid!;
        const offset = rotate(inverse(q), {
          x: centroid[0] - fragment.position[0],
          y: centroid[1] - fragment.position[1],
          z: centroid[2] - fragment.position[2],
        });
        const point: Vec3 = [p.x + offset.x, p.y + offset.y, p.z + offset.z];
        const visible = this.colliderFragments.get(contact.supporter.handle);
        const providerChunk =
          secondary?.attachedRoot ??
          (visible === undefined
            ? undefined
            : this.supportAt(visible, vec(point)));
        let group = groups.get(chunk);
        if (!group)
          groups.set(chunk, (group = { polygons: [], providers: [] }));
        group.polygons.push({ points, normal });
        group.providers.push({
          receiver: contact.receiver,
          collider: contact.supporter,
          body: otherBody,
          point,
          area: patch.area,
          ...(secondary && secondary.attachedRoot === undefined
            ? { child: secondary }
            : {}),
          ...(providerChunk !== undefined && providerChunk >= 0
            ? { chunk: providerChunk }
            : {}),
        });
      }
    }
    const anchors: BearingAnchor[] = [];
    for (const [chunk, group] of groups) {
      const fragment = owner.child?.fragment ?? this.manifest.fragments[chunk]!;
      const material = this.manifest.materials.find(
        (m) => m.id === fragment.material,
      )!;
      const definition = bearingBond(
        fragment,
        group.polygons,
        material.strength,
      );
      if (definition)
        anchors.push({ chunk, definition, providers: group.providers });
    }
    if (!anchors.length) return;
    const identity = owner.child
      ? `s${owner.child.fragment.id}`
      : `p${members.join(",")}`;
    const key = `${identity}/${anchors
      .flatMap((anchor) => anchor.providers.map((p) => p.collider.handle))
      .sort((a, b) => a - b)
      .join(",")}`;
    const failures = this.failedBearingPoses.get(body);
    if (failures) for (const [failedKey, failed] of failures) {
      if (failed.providers.some(provider => !provider.isValid())) failures.delete(failedKey);
    }
    const pose = this.bearingPose(body),
      failed = failures?.get(key)?.pose;
    if (
      failed &&
      Math.hypot(
        pose[0]! - failed[0]!,
        pose[1]! - failed[1]!,
        pose[2]! - failed[2]!,
      ) <= SUPPORT_DRIFT &&
      pose.slice(3).every((v, i) => Math.abs(v - failed[i + 3]!) <= 1e-4)
    )
      return;
    failures?.delete(key);
    const radius = Math.max(
      ...contacts.flatMap((contact) =>
        contact.points.map((point) =>
          Math.hypot(
            point[0] - pose[0]!,
            point[1] - pose[1]!,
            point[2] - pose[2]!,
          ),
        ),
      ),
    );
    const support: BearingSupport = {
      ...owner,
      body,
      anchors,
      nodes: [...(owner.island?.members ?? [])],
      key,
      pose,
      radius,
      pending: true,
    };
    this.bearingSupports.set(body, support);
    for (const member of owner.island?.members ?? [])
      this.bearingNodes.set(member, support);
    // Replace exactly the recorded bearing reaction with graph constraints. Keeping both would
    // cancel self-weight before the world bonds ever see it.
    const removed = new Set<string>();
    for (const provider of anchors.flatMap((anchor) => anchor.providers)) {
      const pair = this.bearingPairKey(provider.receiver, provider.collider);
      if (removed.has(pair)) continue;
      removed.add(pair);
      for (const [chunk, wrench] of this.bearingContactWrenches.get(pair) ??
        []) {
        for (let axis = 0; axis < 6; axis++)
          this.contactWrenches[chunk * 6 + axis]! -= wrench[axis]!;
      }
      for (const [id, wrench] of this.secondaryBearingContactWrenches.get(
        pair,
      ) ?? []) {
        const load = this.secondaryContactWrenches.get(id);
        if (load)
          for (let axis = 0; axis < 6; axis++) load[axis]! -= wrench[axis]!;
      }
    }
    if (owner.child) {
      const q = owner.child.collider.rotation();
      this.secondaryBearingSolver.register(
        owner.child.fragment.id,
        owner.child.fragment,
        [q.x, q.y, q.z, q.w],
        anchors.map((a) => a.definition),
      );
    }
    this.contactTopology = -1;
  }

  /** A deferred dynamic candidate must still touch the same measured bearing faces. */
  private pendingBearingContactValid(support: BearingSupport): boolean {
    if (!this.bearingReferencesValid(support, 'contact validation')) return false;
    if (!support.pending) return true;
    const pose = this.bearingPose(support.body);
    const translation = Math.hypot(
      pose[0]! - support.pose[0]!,
      pose[1]! - support.pose[1]!,
      pose[2]! - support.pose[2]!,
    );
    const dot = Math.min(
      1,
      Math.abs(
        pose
          .slice(3)
          .reduce((sum, value, i) => sum + value * support.pose[i + 3]!, 0),
      ),
    );
    const angular = 2 * support.radius * Math.sqrt(Math.max(0, 1 - dot * dot));
    const providers = support.anchors.flatMap((anchor) => anchor.providers);
    const tolerance =
      this.world.integrationParameters.normalizedAllowedLinearError *
        this.world.integrationParameters.lengthUnit +
      Math.max(
        ...providers.map(
          (provider) =>
            provider.receiver.contactSkin() + provider.collider.contactSkin(),
        ),
      );
    if (translation + angular > tolerance) return false;
    const contacts = bearingPatches(
      this.world,
      support.body,
      support.island?.colliders ?? [support.child!.collider],
    );
    const pairs = new Set(
      contacts.map((contact) =>
        this.bearingPairKey(contact.receiver, contact.supporter),
      ),
    );
    return providers.every((provider) =>
      pairs.has(this.bearingPairKey(provider.receiver, provider.collider)),
    );
  }

  /** Validate cached wrappers before reading native pose, skin or body type. */
  private bearingReferencesValid(support: BearingSupport, context: string): boolean {
    if (!bearingBodyValid(support.body, `${context}: owner`)) return false;
    const colliders = support.island?.colliders ?? [support.child?.collider];
    if (!colliders.every(collider => bearingColliderValid(collider, `${context}: owner collider`))) return false;
    return support.anchors.every(anchor => anchor.providers.every(provider =>
      bearingColliderValid(provider.receiver, `${context}: receiver`) &&
      bearingColliderValid(provider.collider, `${context}: provider`) &&
      (!provider.body || bearingBodyValid(provider.body, `${context}: provider body`)) &&
      (!provider.child || (bearingBodyValid(provider.child.body, `${context}: secondary provider body`) &&
        bearingColliderValid(provider.child.collider, `${context}: secondary provider collider`))),
    ));
  }

  /** Batch topology insertion; existing connection health and authored baselines remain untouched. */
  private submitBearingSupports(): void {
    if (!this.experimentalBearingReanchor) return;
    const pending: BearingAnchor[] = [];
    for (const support of [...this.bearingSupports.values()]) {
      if (support.releasing) {
        this.unbakeBearingSupport(support, false);
        continue;
      }
      if (
        !this.bearingReferencesValid(support, 'submit') ||
        support.anchors.some((anchor) =>
          anchor.providers.some(
            (provider) =>
              !provider.receiver.isValid() ||
              !provider.receiver.isEnabled() ||
              !provider.collider.isValid() ||
              !provider.collider.isEnabled() ||
              (provider.body &&
                (!provider.body.isFixed() ||
                  this.bearingSupports.get(provider.body)?.releasing)),
          ),
        ) ||
        support.island?.members.some(
          (node) =>
            !this.graph.activeChunks[node] ||
            this.graph.fragmentMass[node]! <= 0,
        ) ||
        !this.pendingBearingContactValid(support)
      ) {
        this.unbakeBearingSupport(support, false);
        continue;
      }
      if (support.island)
        for (const anchor of support.anchors)
          if (anchor.bond === undefined) pending.push(anchor);
    }
    if (!pending.length) return;
    const indices = this.graph.addBearingWorldBonds(
      pending.map((anchor) => anchor.definition),
    );
    pending.forEach((anchor, i) => {
      anchor.bond = indices[i]!;
      anchor.bondId = this.graph.manifest.bonds[anchor.bond]!.id;
    });
    this.impactTopologyDirty = true;
  }

  /** Current solved reactions and secondary families share the main B2 step budget. */
  private solveBearingSupports(): void {
    if (!this.experimentalBearingReanchor) return;
    const direct = this.graph.directResult;
    const available = direct?.workRemaining ?? this.graph.directWorkLimit ??
      STEP_BUDGET.structuralWorkByRung[this.budget.rung]!;
    for (const support of this.bearingSupports.values()) {
      if (support.releasing) continue;
      if (!this.bearingReferencesValid(support, 'solve rotation')) {
        this.unbakeBearingSupport(support, false);
        continue;
      }
      if (!support.child) continue;
      const rotation = support.child.collider.rotation();
      this.secondaryBearingSolver.setRotation(support.child.fragment.id, [
        rotation.x, rotation.y, rotation.z, rotation.w,
      ]);
    }
    const secondary = this.secondaryBearingSolver.solve(
      this.dt,
      available,
      this.secondaryBearingLoads,
    );
    this.stepWork.structuralWork += secondary.workUsed;
    this.stepWork.deferredStructuralWork += secondary.workDeferred;
    const secondaryFailed = new Set(secondary.failed);
    // Body-cap deferral must not admit a contact whose completed B2 test already failed.
    const proposedFailures = new Set(direct?.fractures.bonds
      .filter(command => command.health > 0).map(command => command.bond));
    for (const support of [...this.bearingSupports.values()]) {
      if (support.releasing) continue;
      if (!this.bearingReferencesValid(support, 'solve admission')) {
        this.unbakeBearingSupport(support, false);
        continue;
      }
      const failed = support.child
        ? secondaryFailed.has(support.child.fragment.id)
        : support.anchors.some(
            (anchor) =>
              anchor.bond !== undefined &&
              (this.graph.manifest.bonds[anchor.bond]?.id !== anchor.bondId ||
                this.graph.states[anchor.bond] === BondState.Broken || proposedFailures.has(anchor.bond)),
          );
      if (failed) {
        this.unbakeBearingSupport(support, true);
        continue;
      }
      const ready = support.child
        ? secondary.ready.has(support.child.fragment.id)
        : support.anchors.every(
            (anchor) =>
              anchor.bond !== undefined && this.graph.manifest.bonds[anchor.bond]?.id === anchor.bondId &&
                direct?.solvedBonds[anchor.bond],
          );
      if (
        !ready ||
        support.island?.members.some(
          (node) =>
            direct?.deferredImpulseNodes[node] ||
            (support.pending && direct?.currentImpulseNodes[node]),
        )
      )
        continue;
      if (support.child) {
        const reaction = secondary.reactions.get(support.child.fragment.id);
        if (reaction) {
          const q = support.child.collider.rotation();
          support.anchors[0]!.reaction = {
            force: tuple(rotate(q, vec(reaction.force))),
            moment: tuple(rotate(q, vec(reaction.moment))),
          };
        }
      } else
        for (const anchor of support.anchors) {
          const bond = anchor.bond!,
            q = this.bearingRotation(support, anchor);
          const actions = direct!.staticActions;
          anchor.reaction = {
            force: tuple(
              rotate(q, {
                x: actions.forceX[bond]!,
                y: actions.forceY[bond]!,
                z: actions.forceZ[bond]!,
              }),
            ),
            moment: tuple(
              rotate(q, {
                x: actions.momentX[bond]!,
                y: actions.momentY[bond]!,
                z: actions.momentZ[bond]!,
              }),
            ),
          };
        }
      if (!support.pending) continue;
      // Deferred candidates may become ready together; keep the original transition limits.
      if (support.budgetRequested
        ? this.budgetBaked >= STEP_BUDGET.bakesPerTick * this.tickScale
        : this.bakesThisTick - this.budgetBaked >= MAX_BAKES_PER_TICK * this.tickScale) continue;
      // The provider may have unbaked earlier in this same pass.
      if (
        support.anchors.some((anchor) =>
          anchor.providers.some(
            (provider) =>
              provider.body &&
              (!provider.body.isFixed() ||
                this.bearingSupports.get(provider.body)?.releasing),
          ),
        ) ||
        !this.pendingBearingContactValid(support)
      ) {
        this.unbakeBearingSupport(support, false);
        continue;
      }
      const colliders = support.island?.colliders ?? [support.child!.collider];
      this.registerSupports(support.body, colliders);
      const own = this.restingOn.get(support.body.handle);
      if (own) {
        const p = support.body.translation();
        own.x = p.x;
        own.y = p.y;
        own.z = p.z;
      }
      this.bake(support.body);
      this.bakedOwners.set(support.body.handle, support);
      support.pending = false;
      this.bakesThisTick++;
      if (support.budgetRequested) {
        this.budgetBaked++;
        this.budgetBakedTotal++;
      }
      if (support.island) this.finishIslandBake(support.island);
      else {
        support.child!.baked = true;
        support.child!.settled = true;
      }
    }
  }

  private rememberFailedBearing(support: BearingSupport): void {
    if (!bearingBodyValid(support.body, 'failed pose')) return;
    let failures = this.failedBearingPoses.get(support.body);
    if (!failures) this.failedBearingPoses.set(support.body, (failures = new Map()));
    failures.set(support.key, {
      pose: this.bearingPose(support.body),
      providers: support.anchors.flatMap(anchor => anchor.providers.map(provider => provider.collider)),
    });
  }

  private removeBearingAnchors(support: BearingSupport): void {
    const anchors = support.anchors.filter(anchor => anchor.bond !== undefined && anchor.bondId !== undefined);
    if (anchors.length) this.graph.removeBearingWorldBonds(
      anchors.map(anchor => anchor.bond!), anchors.map(anchor => anchor.bondId!),
    );
    // A releasing owner can survive until capacity permits waking. It must not
    // retain a slot reference after that slot becomes eligible for recycling.
    for (const anchor of support.anchors) {
      anchor.bond = undefined;
      anchor.bondId = undefined;
      anchor.reaction = undefined;
    }
  }

  private releaseBearingSupport(body: RAPIER.RigidBody, failed = false): void {
    if (!this.experimentalBearingReanchor) return;
    const support = this.bearingSupports.get(body);
    if (!support) return;
    this.bearingSupports.delete(body);
    if (failed) this.rememberFailedBearing(support);
    this.removeBearingAnchors(support);
    if (support.child) {
      this.secondaryBearingSolver.remove(support.child.fragment.id);
      this.secondaryContactWrenches.delete(support.child.fragment.id);
    }
    for (const node of support.nodes)
      if (this.bearingNodes.get(node) === support)
        this.bearingNodes.delete(node);
    this.contactTopology = -1;
    this.impactTopologyDirty = true;
    this.releaseDependents(body.handle);
  }

  private unbakeBearingSupport(support: BearingSupport, failed: boolean): void {
    if (!bearingBodyValid(support.body, 'unbake owner')) {
      this.releaseBearingSupport(support.body);
      return;
    }
    if (!support.releasing) {
      support.releasing = true;
      if (failed) this.rememberFailedBearing(support);
      this.removeBearingAnchors(support);
      if (support.child) {
        this.secondaryBearingSolver.remove(support.child.fragment.id);
        this.secondaryContactWrenches.delete(support.child.fragment.id);
      }
      this.impactTopologyDirty = true;
      this.releaseDependents(support.body.handle);
    }
    if (support.pending && this.forceRestTicks !== Infinity && support.body.isDynamic()) {
      this.releaseBearingSupport(support.body);
      (support.island ?? support.child)!.stableTicks = 0;
      return;
    }
    // At the live-body cap the broken record remains retryable on the next prepare pass.
    if (support.island) this.wakeIsland(support.island);
    else if (support.child) this.wakeChild(support.child);
  }

  /** Transfer each world-bond reaction to the real provider, including its complete moment arm. */
  private updateBearingLoadSnapshot(): void {
    if (!this.experimentalBearingReanchor) return;
    this.bearingLoads.fill(0);
    this.secondaryBearingLoads.clear();
    for (const support of [...this.bearingSupports.values()]) {
      if (!support.releasing && !this.bearingReferencesValid(support, 'load snapshot'))
        this.unbakeBearingSupport(support, false);
    }
    for (const support of this.bearingSupports.values())
      if (support.child && !support.releasing) {
        const wrench = this.secondaryContactWrenches.get(
          support.child.fragment.id,
        );
        if (!wrench) continue;
        const q = inverse(support.child.collider.rotation());
        const force = rotate(q, {
          x: wrench[0]!,
          y: wrench[1]!,
          z: wrench[2]!,
        });
        const moment = rotate(q, {
          x: wrench[3]!,
          y: wrench[4]!,
          z: wrench[5]!,
        });
        this.secondaryBearingLoads.set(support.child.fragment.id, [
          force.x,
          force.y,
          force.z,
          moment.x,
          moment.y,
          moment.z,
        ]);
      }
    for (const support of this.bearingSupports.values())
      for (const anchor of support.anchors) {
        if (support.releasing || !anchor.reaction) continue;
        const at = this.bearingWorldPoint(support, anchor);
        const area = anchor.providers.reduce(
          (sum, provider) => sum + provider.area,
          0,
        );
        for (const provider of anchor.providers) {
          if (
            !provider.collider.isValid() ||
            (provider.body &&
              (!provider.body.isFixed() ||
                this.bearingSupports.get(provider.body)?.releasing))
          )
            continue;
          const fraction = provider.area / area;
          const f = anchor.reaction.force.map((v) => -v * fraction) as Vec3;
          // Split the moment about the aggregate centroid, then shift to the receiving COM.
          const center = provider.child
            ? provider.child.collider.translation()
            : provider.chunk === undefined
              ? undefined
              : this.position(provider.chunk);
          if (!center) continue; // The host's permanent world absorbs its reaction.
          const r: Vec3 = [
            at[0] - center.x,
            at[1] - center.y,
            at[2] - center.z,
          ];
          const moment: Vec3 = [
            -anchor.reaction.moment[0] * fraction + r[1] * f[2] - r[2] * f[1],
            -anchor.reaction.moment[1] * fraction + r[2] * f[0] - r[0] * f[2],
            -anchor.reaction.moment[2] * fraction + r[0] * f[1] - r[1] * f[0],
          ];
          if (provider.child) {
            const q = inverse(provider.child.collider.rotation()),
              force = rotate(q, vec(f)),
              torque = rotate(q, vec(moment));
            const values = [
              force.x,
              force.y,
              force.z,
              torque.x,
              torque.y,
              torque.z,
            ];
            const load = this.secondaryBearingLoads.get(
              provider.child.fragment.id,
            ) ?? [0, 0, 0, 0, 0, 0];
            for (let axis = 0; axis < 6; axis++) load[axis]! += values[axis]!;
            this.secondaryBearingLoads.set(provider.child.fragment.id, load);
          } else {
            const values = [...f, ...moment],
              offset = provider.chunk! * 6;
            for (let axis = 0; axis < 6; axis++)
              this.bearingLoads[offset + axis]! += values[axis]!;
          }
        }
      }
    const wrenches = this.contactWrenches.slice();
    for (let i = 0; i < wrenches.length; i++)
      wrenches[i]! += this.bearingLoads[i]!;
    this.graph.setExternalLoads({
      bodies: [...this.islands.values(), ...this.supportedActors.values()]
        .filter(island => bearingBodyValid(island.body, 'load snapshot actor')).map(
        (island) => {
          const q = this.rotation(island.members[0]!),
            omega = island.body.angvel();
          return {
            angularVelocity: [omega.x, omega.y, omega.z],
            members: island.members,
            rotation: [q.x, q.y, q.z, q.w],
          };
        },
      ),
      tick: this.tick,
      wrenches,
    });
  }
  /**
   * Bake an island or loose piece and remember what it rests on, so it cannot outlive its support.
   * A body bakes only when it rests on the ground or on something already baked, so a pile settles
   * from the bottom up and nothing is frozen on top of what is still moving. One that does not
   * retries a few ticks later, at most MAX_BAKE_ATTEMPTS bodies a tick. `force` skips the check (the
   * step budget has already made it). In experimental re-anchor mode, true reserves a deferred
   * admission; otherwise it records an immediate bake as before.
   */
  private bakeBody(
    owner: { child?: SecondaryBody; island?: Island },
    force = false,
  ): boolean {
    const item = (owner.island ?? owner.child)!;
    const body = item.body;
    if (!bearingBodyValid(body, 'bake candidate')) return false;
    if (this.experimentalBearingReanchor) {
      if (this.bearingSupports.has(body)) return false;
      if (force
        ? this.budgetBakeReservationsThisTick >= STEP_BUDGET.bakesPerTick * this.tickScale
        : this.bakeReservationsThisTick >= MAX_BAKES_PER_TICK * this.tickScale) return false;
    }
    if (this.compliantConnections?.canBake(body) === false) return false;
    const colliders = owner.island
      ? owner.island.colliders
      : [owner.child!.collider];
    if (!force && this.bakeAttempts++ >= MAX_BAKE_ATTEMPTS * this.tickScale) {
      return false;
    }
    if (!force && !this.grounded(body, colliders)) {
      item.stableTicks = Math.max(0, this.settleTicks - SETTLE_RETRY_TICKS);
      return false;
    }
    if (!this.experimentalBearingReanchor) {
      this.registerSupports(body, colliders);
      // What rests on this body is measured from here, not from wherever it was last baked.
      const own = this.restingOn.get(body.handle);
      if (own) {
        const at = body.translation();
        own.x = at.x;
        own.y = at.y;
        own.z = at.z;
      }
      this.bake(body);
      this.bakedOwners.set(body.handle, owner);
      this.bakesThisTick++;
      return true;
    }
    // Becoming static creates structural support, not an exemption from the structural solve.
    // The next prepare pass admits the actor only after its bearing bonds survive B2.
    this.requestBearingSupport(owner, colliders);
    const support = this.bearingSupports.get(body);
    if (!support) return false;
    support.budgetRequested = force;
    if (force) this.budgetBakeReservationsThisTick++;
    else this.bakeReservationsThisTick++;
    return true; // A reservation; only solveBearingSupports records a completed bake.
  }

  /**
   * Visit actual bearing contacts before a dynamic body bakes. An enclosing radius or broad-phase
   * overlap cannot establish support: a wide slab can have those while metres above the floor.
   * Parentless fixed geometry is eligible for grounding, but needs no wake dependency. Return
   * false from the visitor to stop. Fixed bodies are never rebaked, so fixed/fixed manifolds are
   * unnecessary here.
   */
  private forEachSupporter(
    body: RAPIER.RigidBody,
    colliders: ReadonlyArray<RAPIER.Collider>,
    visit: (other: RAPIER.RigidBody | null) => boolean,
    fixed = false,
  ): void {
    if (!bearingBodyValid(body, 'support enumeration owner')) return;
    const parameters = this.world.integrationParameters;
    const tolerance = parameters.normalizedAllowedLinearError * parameters.lengthUnit;
    const live = colliders.filter(collider => bearingColliderValid(collider, 'support enumeration collider'));
    const lowest =
      live.length > MAX_SUPPORT_PROBES
        ? live
            .sort((a, b) => a.translation().y - b.translation().y)
            .slice(0, MAX_SUPPORT_PROBES)
        : live;
    for (const collider of lowest) {
      if (!bearingColliderValid(collider, 'support enumeration receiver') || !collider.isEnabled() || collider.isSensor()) continue;
      const candidates: Array<RAPIER.Collider> = [];
      this.world.contactPairsWith(collider, (other) => {
        // Native pairs can outlive a collider removed during this prepare pass.
        if (bearingColliderValid(other, 'support contact pair') && candidates.length < MAX_SUPPORT_PROBES) candidates.push(other);
      });
      // Finish enumerating native pairs before borrowing a contact manifold or calling visitors.
      for (const other of candidates) {
        if (!bearingBodyValid(body, 'support enumeration owner after callback')) return;
        if (!bearingColliderValid(collider, 'support receiver after callback')) break;
        if (!bearingColliderValid(other, 'support candidate after callback') || !other.isEnabled() || other.isSensor()) continue;
        const otherBody = other.parent();
        if (otherBody && !bearingBodyValid(otherBody, 'support candidate parent')) continue;
        if (
          otherBody?.handle === body.handle ||
          (!fixed && (!otherBody ||
            (!otherBody.isDynamic() && !this.bakedOwners.has(otherBody.handle))))
        ) continue;
        const contactDistance = collider.contactSkin() + other.contactSkin() + tolerance;
        let bearing = false;
        forEachContactManifold(this.world, collider, other, (manifold, flipped) => {
          // The manifold normal points out of its first collider. The reaction on this body
          // therefore carries weight only when its outward normal points down.
          if (manifold.normal().y * (flipped ? -1 : 1) >= 0) return;
          for (let i = 0; i < manifold.numContacts(); i++) {
            if (manifold.contactDist(i) <= contactDistance) { bearing = true; break; }
          }
        });
        if (bearing && !visit(otherBody)) return;
      }
    }
  }

  private registerSupports(
    body: RAPIER.RigidBody,
    colliders: ReadonlyArray<RAPIER.Collider>,
  ): void {
    this.forEachSupporter(body, colliders, (other) => {
      // A baked body already rests on the ground or on a baked body (`grounded`); the awake bodies
      // that merely touch it are not what holds it up.
      if (!other || other.isDynamic()) {
        return true;
      }
      let entry = this.restingOn.get(other.handle);
      if (!entry) {
        const at = other.translation();
        entry = { dependents: new Set(), x: at.x, y: at.y, z: at.z };
        this.restingOn.set(other.handle, entry);
      }
      entry.dependents.add(body.handle);
      return true;
    });
  }

  /**
   * Queue the baked bodies that rest on a supporter that has moved or been removed. A body that
   * merely wakes does not release what is on it: it is awake now, `checkSupport` watches it, and it
   * releases them the moment it really moves. Waking every dependent at once would wake a whole
   * pile for one nudge.
   */
  private releaseDependents(handle: number): void {
    this.bakedOwners.delete(handle);
    const entry = this.restingOn.get(handle);
    if (!entry) {
      return;
    }
    this.restingOn.delete(handle);
    for (const dependent of entry.dependents) {
      if (this.bakedOwners.has(dependent)) {
        this.unbakeQueue.push(dependent);
      }
    }
  }

  /** An awake supporter that drifts or speeds up lets go of what is baked on top of it. */
  private checkSupport(body: RAPIER.RigidBody): void {
    const entry = this.restingOn.get(body.handle);
    if (!entry) {
      return;
    }
    const at = body.translation();
    const drift =
      (at.x - entry.x) ** 2 + (at.y - entry.y) ** 2 + (at.z - entry.z) ** 2;
    if (drift > SUPPORT_DRIFT ** 2 || this.movedPast(body)) {
      this.releaseDependents(body.handle);
    }
  }

  /** Whether a body is moving too fast to hold something baked on top of it. */
  private movedPast(body: RAPIER.RigidBody): boolean {
    return (
      squared(body.linvel()) > SUPPORT_WAKE_SPEED ** 2 ||
      squared(body.angvel()) > SUPPORT_WAKE_SPIN ** 2
    );
  }

  /** Wake queued dependents before the step, a bounded number per tick, nearest queued first. */
  private wakeDependents(): void {
    let budget = MAX_UNBAKES_PER_TICK * this.tickScale;
    const queue = this.unbakeQueue;
    this.unbakeQueue = [];
    for (let slot = 0; slot < queue.length; slot++) {
      const owner = this.bakedOwners.get(queue[slot]!);
      if (!owner || !this.ownedBodies.has(queue[slot]!)) {
        continue;
      }
      if (budget <= 0) {
        this.unbakeQueue.push(queue[slot]!);
        continue;
      }
      budget--;
      // Waking can enqueue the pieces resting on this one; they join the tail of this tick's queue.
      const before = this.unbakeQueue.length;
      if (owner.island) {
        this.wakeIsland(owner.island);
      } else if (owner.child) {
        this.wakeChild(owner.child);
      }
      if (this.unbakeQueue.length > before) {
        queue.push(...this.unbakeQueue.splice(before));
      }
    }
  }

  /** Return a settled or baked body to the simulation. Returns false if the dynamic budget is full. */
  private wakeIsland(island: Island): boolean {
    if (this.supportedActors.get(island.key) === island) return false;
    if (island.baked && this.dynamicBodyCount() >= MAX_DYNAMIC_BODIES) return false;
    this.releaseBearingSupport(island.body);
    if (island.baked) {
      island.baked = false;
      for (const index of island.members) {
        this.frozen[index] = 0;
      }
      this.changeBodyType(island.body, this.rapier.RigidBodyType.Dynamic, true);
      island.body.recomputeMassPropertiesFromColliders();
      this.bodyRevision++;
    }
    island.body.wakeUp();
    island.settled = false;
    island.stableTicks = 0;
    island.restTicks = 0;
    return true;
  }

  private wakeChild(child: SecondaryBody): boolean {
    if (child.baked && this.dynamicBodyCount() >= MAX_DYNAMIC_BODIES) return false;
    this.releaseBearingSupport(child.body);
    if (child.baked) {
      child.baked = false;
      this.changeBodyType(child.body, this.rapier.RigidBodyType.Dynamic, true);
      child.body.recomputeMassPropertiesFromColliders();
      this.bodyRevision++;
    }
    child.body.wakeUp();
    child.settled = false;
    child.stableTicks = 0;
    child.restTicks = 0;
    return true;
  }

  private debrisChunk(fragment: FragmentDef): boolean {
    return (fragment.depth ?? 2) >= (this.debrisTier.debrisDepth ?? 3) ||
      volumeOf(fragment) < this.debrisTier.volume;
  }

  private tierIslandDebris(island: Island): boolean {
    return island.visibleChunks.length > 0 && island.visibleChunks.every((index) =>
      this.debrisChunk(this.manifest.fragments[index]!));
  }

  private tierDebris(child: SecondaryBody): boolean {
    return (
      child.attachedRoot === undefined &&
      this.debrisChunk(child.fragment)
    );
  }

  /**
   * After the settled lifetime, remove debris physics immediately and animate stored visual poses.
   * Over the live cap, retire the oldest settled bodies before the oldest moving ones.
   */
  private ageDebris(): void {
    const lifetime = this.ticks(this.debrisTier.settledSeconds);
    const sinkTicks = Math.max(1, this.ticks(this.debrisTier.sinkSeconds));
    for (let i = this.visualRetirements.length - 1; i >= 0; i--) {
      const retirement = this.visualRetirements[i]!;
      if (++retirement.ticks < sinkTicks) continue;
      this.finishVisualRetirement(i);
    }
    let charged: Set<number> | undefined;
    const eligible = (child: SecondaryBody) =>
      !(charged ??= this.chargedPieces()).has(child.fragment.id);
    const live: Array<SecondaryBody> = [];
    const primary: Array<Island> = [];
    for (const child of this.secondary.slice()) {
      if (!this.tierDebris(child)) continue;
      child.debrisBorn ??= this.tick;
      if (child.baked) {
        child.age = (child.age ?? 0) + 1;
        if (child.age >= lifetime && eligible(child)) {
          this.startSink(child);
          continue;
        }
      } else child.age = 0;
      live.push(child);
    }
    for (const island of [...this.islands.values()]) {
      if (!this.tierIslandDebris(island)) continue;
      island.debrisBorn ??= this.tick;
      const hasCharge = this.explosives.some((charge) => charge.fragment !== undefined &&
        (island.members.includes(charge.fragment) || island.visibleChunks.includes(charge.fragment)));
      const hasSeam = island.members.some((index) => this.graph.incidentBonds(index).some((bond) => this.graph.states[bond] === BondState.Compliant));
      if (hasCharge || hasSeam) continue;
      island.age = island.baked ? (island.age ?? 0) + 1 : 0;
      if (island.age >= lifetime) this.startIslandSink(island);
      else primary.push(island);
    }
    // Preserve settled-first, oldest-first live-cap ordering. Retiring visuals are no longer live.
    let overflow = live.length + primary.length - this.debrisCap;
    if (overflow > 0) {
      const order = [
        ...live.filter(eligible).map((child) => ({ born: child.debrisBorn!, baked: child.baked,
          sink: () => this.startSink(child) })),
        ...primary.map((island) => ({ born: island.debrisBorn!, baked: island.baked,
          sink: () => this.startIslandSink(island) })),
      ].sort((a, b) => Number(Boolean(b.baked)) - Number(Boolean(a.baked)) || a.born - b.born);
      for (const entry of order) {
        if (overflow-- <= 0) break;
        entry.sink();
      }
    }
  }

  /** A near-ground retirement may descend by its own projected height, never its altitude. */
  private retirementDepth(body: RAPIER.RigidBody, pieces: VisualRetirement["fragments"]): number {
    let low = Infinity, high = -Infinity;
    for (const piece of pieces) {
      const f = piece.fragment;
      const vertices = f.shape?.vertices ?? [-1,1].flatMap((x) => [-1,1].flatMap((y) =>
        [-1,1].map((z): Vec3 => [x*f.size[0]/2,y*f.size[1]/2,z*f.size[2]/2])));
      for (const vertex of vertices) {
        const y = piece.position.y + rotate(piece.rotation, vec(vertex)).y;
        low = Math.min(low, y); high = Math.max(high, y);
      }
    }
    if (!(high > low)) return 0;
    let tolerance = this.world.integrationParameters.normalizedAllowedLinearError * this.world.integrationParameters.lengthUnit;
    for (let i=0;i<body.numColliders();i++) tolerance = Math.max(tolerance, body.collider(i).contactSkin());
    const center = body.translation();
    const hit = this.world.castRayAndGetNormal(
      new this.rapier.Ray({x:center.x,y:low+tolerance,z:center.z}, {x:0,y:-1,z:0}),
      2*tolerance, true, this.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined, undefined, body, (collider) => {
        if (!collider.isValid() || !collider.isEnabled() || this.colliderFragments.has(collider.handle) ||
            this.secondaryColliders.has(collider.handle) || this.ballColliders.has(collider.handle)) return false;
        const parent = collider.parent();
        return !parent || parent.isFixed();
      },
    );
    if (!hit || hit.normal.y <= 0) return 0;
    const ground = low + tolerance - hit.timeOfImpact;
    return Math.min(high-low, Math.max(0, high-ground));
  }

  private startIslandSink(island: Island): void {
    const attached = this.secondary.filter((child) => child.body.handle === island.body.handle);
    const pieces: VisualRetirement["fragments"] = [];
    const visible = island.visibleChunks.filter((index) => !this.refined.has(index) && !this.retired.has(index));
    let slots = this.trimVisualRetirements(visible.length);
    for (const index of visible) {
      const fragment = this.manifest.fragments[index]!;
      if (slots <= 0 || !this.reserveIds(1)) continue;
      slots--;
      pieces.push({ fragment: { ...fragment, id: this.nextSecondaryId++, anchored: false,
        generation: 1, parentId: fragment.id, rootId: fragment.id },
        position: this.position(index), rotation: this.rotation(index) });
    }
    for (const child of attached) pieces.push({ fragment: child.fragment,
      position: child.collider.translation(), rotation: child.collider.rotation() });
    const depth = this.retirementDepth(island.body, pieces);
    // Wake neighbours while handles are still valid; native body removal removes every proxy,
    // compound collider and attached joint atomically, without an intermediate massless body.
    for (let i=0;i<island.body.numColliders();i++) this.wakeSupportContacts(island.body.collider(i));
    this.releaseBearingSupport(island.body);
    for (const child of attached) this.forgetSecondary(child);
    for (const index of island.members) {
      this.retired.add(index); this.refined.delete(index); this.attachedVolumes.delete(index);
      this.fragmentIsland[index] = -1; this.states[index] = FragmentState.Retired;
    }
    for (const index of island.visibleChunks) {
      this.visibleChunks.delete(index); this.retired.add(index); this.states[index] = FragmentState.Retired;
    }
    for (let i=0;i<island.body.numColliders();i++) {
      const handle = island.body.collider(i).handle;
      this.colliderFragments.delete(handle); this.secondaryColliders.delete(handle);
    }
    for (const index of island.poses.keys()) this.fragmentIsland[index] = -1;
    this.graph.removeFragments(island.members);
    this.bakedOwners.delete(island.body.handle);
    this.removeRigidBody(island.body);
    this.islands.delete(island.key);
    this.visualRetirements.push({fragments:pieces,depth,ticks:0,evicted:attached.length});
    this.impactTopologyDirty = true;
    this.secondaryRevision++; this.topologyRevision++;
  }

  private startSink(child: SecondaryBody): void {
    const pieces = [{fragment:child.fragment,position:child.collider.translation(),rotation:child.collider.rotation()}];
    const depth = this.retirementDepth(child.body, pieces);
    for (let i=0;i<child.body.numColliders();i++) this.wakeSupportContacts(child.body.collider(i));
    this.releaseBearingSupport(child.body);
    for (let i=0;i<child.body.numColliders();i++) {
      const handle = child.body.collider(i).handle;
      this.colliderFragments.delete(handle); this.secondaryColliders.delete(handle);
    }
    this.bakedOwners.delete(child.body.handle);
    this.forgetSecondary(child);
    this.removeRigidBody(child.body);
    this.visualRetirements.push({fragments:pieces,depth,ticks:0,evicted:1});
    this.secondaryRevision++; this.topologyRevision++;
  }

  private updateTransformsAndSettlement(): void {
    this.updateTransforms();
    // Read the just-applied contact impulse using current poses and dynamic
    // mass before baking can freeze a body or replace its contact colliders.
    this.collectStructuralLoads();
    this.settleBodies();
  }

  private updateTransforms(): void {
    let moving = false,
      structuralMoving = false;
    for (const island of this.islands.values()) {
      if (
        island.baked &&
        this.ownsWorld &&
        island.transformState === FragmentState.Settled
      ) {
        continue;
      }
      if (
        island.settled &&
        !island.baked &&
        !island.body.isFixed() &&
        !island.body.isSleeping()
      ) {
        island.settled = false;
        island.stableTicks = 0;
      }
      const state = island.settled
        ? FragmentState.Settled
        : island.body.isSleeping()
          ? FragmentState.Sleeping
          : FragmentState.Dynamic;
      if (!island.baked && state !== FragmentState.Sleeping) {
        moving = true;
        if (island.members.length > 1) {
          structuralMoving = true;
        }
      }
      const rotation = island.body.rotation(),
        center = island.body.translation();
      const bodyPose = [
        center.x,
        center.y,
        center.z,
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w,
      ];
      if (
        island.transformState === state &&
        (island.body.isFixed() || island.body.isSleeping()) &&
        bodyPose.every((value, index) => value === island.bodyPose?.[index])
      ) {
        continue;
      }
      island.bodyPose = bodyPose;
      island.transformState = state;
      this.transformRevision++;
      if (island.members.length > 1) {
        this.structuralRevision++;
      }
      for (const [index, pose] of island.poses) {
        const rotated = rotate(rotation, pose.position),
          p = {
            x: center.x + rotated.x,
            y: center.y + rotated.y,
            z: center.z + rotated.z,
          },
          q = multiply(rotation, pose.rotation),
          offset = index * TRANSFORM_STRIDE;
        this.transforms[offset] = p.x;
        this.transforms[offset + 1] = p.y;
        this.transforms[offset + 2] = p.z;
        this.transforms[offset + 3] = q.x;
        this.transforms[offset + 4] = q.y;
        this.transforms[offset + 5] = q.z;
        this.transforms[offset + 6] = q.w;
        this.states[index] = state;
      }
    }
    for (const child of this.secondary) {
      if (child.attachedRoot !== undefined) {
        child.settled = this.states[child.attachedRoot] === FragmentState.Settled;
      } else if (!child.baked && !child.body.isSleeping()) {
        moving = true;
      }
    }
    this.islandsMoving = moving;
    this.structuralMoving = structuralMoving;
  }


  private settleBodies(): void {
    if (!this.experimentalBearingReanchor) {
      this.bakesThisTick = 0;
      this.bakeAttempts = 0;
    }
    for (const island of this.islands.values()) {
      if (!island.settled) {
        this.countStable(island);
        this.forceRest(island);
        if (this.restingOn.size) {
          this.checkSupport(island.body);
        }
        if (
          island.stableTicks >= this.settleTicks &&
          (this.experimentalBearingReanchor ? this.bakeReservationsThisTick : this.bakesThisTick) < MAX_BAKES_PER_TICK * this.tickScale &&
          this.bakeBody({ island }) && !this.experimentalBearingReanchor
        ) this.finishIslandBake(island);
      }
      if (island.settled && island.transformState !== FragmentState.Settled) {
        island.transformState = FragmentState.Settled;
        for (const index of island.members) this.states[index] = FragmentState.Settled;
        this.transformRevision++;
        if (island.members.length > 1) this.structuralRevision++;
      }
    }
    for (const child of this.secondary) {
      if (child.attachedRoot !== undefined) {
        child.settled =
          this.states[child.attachedRoot] === FragmentState.Settled;
        continue;
      }
      if (child.baked) {
        continue;
      }
      if (this.isDebris(child) && child.body.isDynamic()) {
        const linear = child.body.linvel(),
          angular = child.body.angvel();
        if (squared(linear) > MAX_DEBRIS_SPEED * MAX_DEBRIS_SPEED) {
          child.body.setLinvel(limit(linear, MAX_DEBRIS_SPEED), false);
        }
        if (squared(angular) > MAX_DEBRIS_SPIN * MAX_DEBRIS_SPIN) {
          child.body.setAngvel(limit(angular, MAX_DEBRIS_SPIN), false);
        }
      }
      if (child.settled && !child.body.isFixed() && !child.body.isSleeping()) {
        child.settled = false;
        child.stableTicks = 0;
      }
      if (!child.settled) {
        this.countStable(child);
        this.forceRest(child);
        if (this.restingOn.size) {
          this.checkSupport(child.body);
        }
        if (
          child.stableTicks >= this.settleTicks &&
          (this.experimentalBearingReanchor ? this.bakeReservationsThisTick : this.bakesThisTick) < MAX_BAKES_PER_TICK * this.tickScale &&
          this.bakeBody({ child }) && !this.experimentalBearingReanchor
        ) { child.baked = true; child.settled = true; }
      }
    }
  }

  private collectCascades(): void {
    let ballImpact = false;
    const primaryCount = this.manifest.fragments.length;
    const contactIndex = (handle: number) => {
      const primary = this.colliderFragments.get(handle);
      if (primary !== undefined) {
        return primary;
      }
      const child = this.secondaryColliders.get(handle);
      return child
        ? primaryCount + child.fragment.id - this.secondaryIdBase
        : -1;
    };
    const secondaryAt = (index: number) =>
      this.secondaryById.get(index - primaryCount + this.secondaryIdBase)!;
    const velocity = (index: number): V =>
      index >= primaryCount
        ? secondaryAt(index).velocity
        : (this.preStepVelocity.get(
            index < 0 ? -1 : this.fragmentIsland[index]!,
          ) ?? {
            x: 0,
            y: 0,
            z: 0,
          });
    const massOf = (index: number) => {
      if (index < 0) {
        return Infinity;
      }
      const body =
        index >= primaryCount
          ? secondaryAt(index).body
          : this.islands.get(this.fragmentIsland[index]!)?.body;
      return body && !body.isFixed() ? body.mass() : Infinity;
    };
    const bodyKey = (index: number) =>
      index >= primaryCount
        ? -2 - index + primaryCount
        : this.fragmentIsland[index]!;
    const candidates: Array<{
      a: number;
      b: number;
      direction: Vec3;
      energy: number;
      mass: number;
      impulse: number;
      position: Vec3;
    }> = [];
    this.forwardedContacts.splice(0).forEach((event) => {
      const ballA = this.ballColliders.get(event.first),
        ballB = this.ballColliders.get(event.second);
      if (ballA || ballB) {
        if (ballA && !ballB) {
          ballImpact =
            this.cannonballImpact(
              ballA,
              this.world.getCollider(event.second),
              event.direction,
              event.force * this.dt,
            ) || ballImpact;
        } else if (ballB && !ballA) {
          ballImpact =
            this.cannonballImpact(
              ballB,
              this.world.getCollider(event.first),
              event.direction,
              event.force * this.dt,
            ) || ballImpact;
        }
        return;
      }
      const a = contactIndex(event.first),
        b = contactIndex(event.second);
      if (a < 0 && b < 0) {
        return;
      }
      const va = velocity(a),
        vb = velocity(b);
      const normal = event.direction;
      const relative = Math.abs(
        (va.x - vb.x) * normal.x +
          (va.y - vb.y) * normal.y +
          (va.z - vb.z) * normal.z,
      );
      if (relative < 2 || event.force * this.dt < 20) {
        return;
      }
      const ma = massOf(a),
        mb = massOf(b);
      const mass = !Number.isFinite(ma)
        ? mb
        : !Number.isFinite(mb)
          ? ma
          : (ma * mb) / (ma + mb);
      if (!Number.isFinite(mass)) {
        return;
      }
      const energy = 0.5 * mass * relative * relative;
      if (energy < 80) {
        return;
      }
      const ca = this.world.getCollider(event.first),
        cb = this.world.getCollider(event.second);
      const fallback = a >= 0 ? a : b;
      let p =
        fallback >= primaryCount
          ? secondaryAt(fallback).collider.translation()
          : this.position(fallback);
      forEachContactManifold(this.world, ca, cb, (manifold) => {
        if (manifold.numSolverContacts()) {
          const contact = manifold.solverContactPoint(0);
          if (contact) {
            p = contact;
          }
        }
      });
      if (relative >= SUBDIVIDE_SPEED) {
        for (const index of [a, b]) {
          // Refine where a landing is seen: a hit on the cell's underside lands it on whatever
          // it rests on, so that cell stays whole. Exposure is checked when the split is made.
          if (
            index >= 0 &&
            index < primaryCount &&
            this.subdividable(index) &&
            !this.struckUnderside(index, p)
          ) {
            this.landedCells.add(index);
          }
        }
      }
      candidates.push({
        a,
        b,
        direction: [normal.x, normal.y, normal.z],
        energy, mass, impulse: event.force * this.dt,
        position: [p.x, p.y, p.z],
      });
    });
    const stableId = (index: number) =>
      index < 0
        ? -1
        : index >= primaryCount
          ? secondaryAt(index).fragment.id
          : this.manifest.fragments[index]!.id;
    candidates.sort(
      (a, b) =>
        b.energy - a.energy ||
        stableId(a.a) - stableId(b.a) ||
        stableId(a.b) - stableId(b.b),
    );
    let count = 0;
    const touchedBodies = new Map<number, number>();
    const impactsFor = (key: number) =>
      Math.min(
        6,
        1 + Math.floor((this.islands.get(key)?.members.length ?? 1) / 40),
      );
    for (const candidate of candidates) {
      if (count >= 12 * this.tickScale) {
        break;
      }
      const key = bodyKey(
        !Number.isFinite(massOf(candidate.a)) ? candidate.b : candidate.a,
      );
      const touched = touchedBodies.get(key) ?? 0;
      if (touched >= impactsFor(key)) {
        continue;
      }
      const pair = `${Math.min(candidate.a, candidate.b)}:${Math.max(candidate.a, candidate.b)}`;
      if (
        (this.cooldowns.get(pair) ?? -100) >
        this.tick - this.ticks(CASCADE_COOLDOWN)
      ) {
        continue;
      }
      touchedBodies.set(key, touched + 1);
      this.cooldowns.set(pair, this.tick);
      this.events.push({
        count: 1,
        energy: candidate.energy,
        mass: candidate.mass, impulse: candidate.impulse, normal: candidate.direction,
        radius: clamp(Math.sqrt(candidate.energy) / 60, 0.6, 1.6),
        position: candidate.position,
        tick: this.tick,
        type: "heavyImpact",
      });
      // collectStructuralLoads already routes the collision impulse through
      // graph.addForce; landing presentation must not issue a second damage program.
      count++;
    }
    if (ballImpact) {
      this.queue.sort(commandOrder);
    }
    if (this.tick % 120 === 0) {
      for (const [key, last] of this.cooldowns) {
        if (last < this.tick - 120) {
          this.cooldowns.delete(key);
        }
      }
    }
  }

  private updateDamage(): void {
    if (this.appliedDamageRevision === this.graph.damageRevision) {
      return;
    }
    this.appliedDamageRevision = this.graph.damageRevision;
    for (let i = 0; i < this.states.length; i++) {
      this.transforms[i * TRANSFORM_STRIDE + 7] = 0;
    }
    for (let b = 0; b < this.manifest.bonds.length; b++) {
      const bond = this.manifest.bonds[b]!;
      for (const id of [bond.a, bond.b]) {
        const index = this.fragmentById.get(id);
        if (index !== undefined) {
          const offset = index * TRANSFORM_STRIDE + 7;
          this.transforms[offset] = Math.max(
            this.transforms[offset]!,
            this.graph.damage[b]!,
          );
        }
      }
    }
    for (const visible of this.visibleChunks) {
      let damage = this.transforms[visible * TRANSFORM_STRIDE + 7]!;
      const visit = (index: number): void => {
        damage = Math.max(
          damage,
          this.transforms[index * TRANSFORM_STRIDE + 7]!,
        );
        for (const child of this.graph.children[index] ?? []) visit(child);
      };
      visit(visible);
      this.transforms[visible * TRANSFORM_STRIDE + 7] = damage;
    }
  }

  get simulationVersion(): string {
    return simulationVersionFor(this.dt) + flavourSuffix() + this.restSuffix;
  }

  get physicsOperationsVersion(): string {
    return physicsOperationsVersionFor(this.dt) + flavourSuffix() + this.restSuffix;
  }

  /** Converts a duration in seconds to whole ticks of this simulation's step. */
  private ticks(seconds: number): number {
    return Math.max(1, Math.round(seconds / this.dt));
  }

  private bondEvent(index: number, type: "bondBroken" | "bondCracked" | "bondCompliant"): void {
    const bond = this.manifest.bonds[index]!,
      a = this.fragmentById.get(bond.a),
      b = this.fragmentById.get(bond.b);
    if (a === undefined || (b === undefined && bond.b !== -1)) return;
    const pa = this.position(a),
      pb =
        b === undefined
          ? vec(
              bond.centroid ??
                bond.section?.point ??
                this.manifest.fragments[a]!.position,
            )
          : this.position(b);
    this.events.push({
      count: 1,
      energy: this.graph.damage[index]!,
      mass: (this.graph.fragmentMass[a]! || this.manifest.fragments[a]!.mass) +
        (b === undefined ? 0 : this.graph.fragmentMass[b]! || this.manifest.fragments[b]!.mass),
      impulse: this.graph.directResult?.combinedImpulse[index] ?? 0,
      normal: tuple(rotate(this.rotation(a), vec(bond.normal))), radius: Math.sqrt(bond.area / Math.PI),
      position: [(pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2],
      tick: this.tick,
      type,
    });
  }
}
