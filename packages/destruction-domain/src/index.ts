export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type ScenarioId = 'building' | 'wall' | 'cantilever' | 'bridge' | 'complex';
export interface MaterialDef {
  /** Damping ratio for compliant connection motors; 1 is critical damping. */
  compliantDampingRatio?: number;
  /** Structural pressure limits in Pa; default elastic = strength/2, fatal = strength*2. */
  tensionElasticLimit?: number;
  tensionFatalLimit?: number;
  compressionElasticLimit?: number;
  compressionFatalLimit?: number;
  shearElasticLimit?: number;
  shearFatalLimit?: number;
  tensionMultiplier?: number;
  compressionMultiplier?: number;
  shearMultiplier?: number;
  bendingMultiplier?: number;
  /** Additional failure pressure in the tension reference channel, in Pa. */
  breakOffset?: number;
  /** Blast material health scale and normalized damage filter. */
  health?: number;
  minDamageThreshold?: number;
  maxDamageThreshold?: number;
  bendingStrength?: number;
  brittleness: number;
  color: string;
  compressionStrength?: number;
  density: number;
  friction: number;
  id: number;
  name: string;
  poissonRatio?: number;
  shearStrength?: number;
  strength: number;
  tensionStrength?: number;
  youngModulus?: number;
}
export type ElementKind = 'column' | 'beam' | 'slab' | 'wall' | 'roof' | 'trim' | 'glass';
export interface FragmentDef {
  /** Parent chunk ID, -1 for an authored element root. Omitted for legacy flat assets. */
  parent?: number;
  depth?: number;
  support?: boolean;
  element?: ElementKind;
  initialHealth?: number;
  aggregate: number;
  anchored: boolean;
  id: number;
  mass: number;
  material: number;
  position: Vec3;
  region: number;
  shape?: {
    faces: Array<{ surface: 'exterior' | 'fracture'; vertices: Array<number> }>;
    inertia: [number, number, number, number, number, number];
    vertices: Array<Vec3>;
    volume: number;
  };
  size: Vec3;
}
export interface BondDef {
  /** Runtime inheritance references the original interface by bond ID. */
  parentBond?: number;
  areaFraction?: number;
  /** The world is endpoint b = -1. */
  centroid?: Vec3;
  joint?: boolean;
  a: number;
  area: number;
  b: number;
  id: number;
  normal: Vec3;
  section?: {
    inertia1: number;
    inertia2: number;
    point: Vec3;
    polarInertia: number;
    sectionModulus1: number;
    sectionModulus2: number;
    tangent1: Vec3;
    tangent2: Vec3;
    torsionModulus: number;
  };
  strength: number;
}
export interface RegionDef {
  id: number;
  max: Vec3;
  min: Vec3;
  name: string;
}
export interface LevelBox {
  collidable: boolean;
  color?: string;
  id: string;
  material: 'boardConcrete' | 'concrete' | 'metal' | 'paint' | 'asphalt' | 'glass';
  position: Vec3;
  rotation?: Quat;
  size: Vec3;
}
export interface LevelSign {
  background?: string;
  color?: string;
  height: number;
  position: Vec3;
  rotation?: Vec3;
  text: string;
  width: number;
}
export interface LevelLight {
  color: string;
  distance: number;
  intensity: number;
  position: Vec3;
}
export interface LevelDef {
  boxes: Array<LevelBox>;
  camera: { position: Vec3; target: Vec3 };
  lights?: Array<LevelLight>;
  signs?: Array<LevelSign>;
  spawn: { position: Vec3; yaw: number };
}
export type PlayerTool = 'explosive' | 'cannonball' | 'hammer' | 'cutter';
export type PlayerLoad =
  | { action: 'explosive'; charge: number }
  | { action: Exclude<PlayerTool, 'explosive'>; radius: number; strength: number };
export interface AimPreview {
  distance?: number;
  fragmentId?: number;
  message: string;
  normal?: Vec3;
  position?: Vec3;
  valid: boolean;
}
export interface PlayerInput {
  aim?: Vec3;
  crouch: boolean;
  forward: number;
  jump: boolean;
  right: number;
  sprint: boolean;
  tool?: PlayerTool;
  yaw: number;
}
export interface PlayerState {
  crouched: boolean;
  enabled: boolean;
  eye: Vec3;
  grounded: boolean;
  position: Vec3;
  respawns: number;
  velocity: Vec3;
}
export interface DestructibleManifest {
  /** Deepest authored chunk depth, excluding run-time subfracture. */
  depth?: number;
  supportDepth?: number;
  /** Authored child interfaces, activated only when their support ancestor is demoted. */
  subsupportBonds?: Array<BondDef>;
  assetHash: string;
  bonds: Array<BondDef>;
  coordinateSystem: 'Y_UP_RH';
  fragments: Array<FragmentDef>;
  level?: LevelDef;
  materials: Array<MaterialDef>;
  name: string;
  regions: Array<RegionDef>;
  scenario: ScenarioId;
  schemaVersion: 1;
}
export enum BondState {
  Intact = 0,
  Cracked = 1,
  Yielding = 2,
  Broken = 3,
  Compliant = 4,
}
export enum FragmentState {
  Supported = 0,
  Dynamic = 1,
  Sleeping = 2,
  Settled = 3,
  Retired = 4,
  Hidden = 5,
}
export interface SecondaryFragmentDef extends FragmentDef {
  readonly generation: number;
  readonly parentId: number;
  readonly rootId: number;
}
export interface SecondaryFractureFrame {
  /** Worker to session: only definitions not sent before when `ids` is present, else all. */
  fragments: Array<SecondaryFragmentDef>;
  /** Worker to session only: the full ordered list of live piece ids. */
  ids?: Array<number>;
  revision: number;
  states: Uint8Array;
  transforms: Float32Array;
}
export const MAX_SECONDARY_FRAGMENTS = 4096;
export const MAX_SECONDARY_DEFINITION_BYTES = 3800;
export const MAX_SECONDARY_SPLITS_PER_TICK = 2;
export const MAX_IMPACT_FRACTURES_PER_TICK = 4;
export const MAX_FRACTURE_GENERATION = 8;
export const MAX_SECONDARY_ID_SPAN = 16_777_216;
export const MAX_SECONDARY_LINEAGE = 4096;
interface ProgramBase {
  position: Vec3;
  maxRadius: number;
  normal?: Vec3;
  /** Manifest index of the support chunk physically struck, when known. */
  chunk?: number;
  commandKey?: string;
}
/** Geometry plus raw damage in material health units; shaders emit normalized health deltas. */
export interface ProfileProgram extends ProgramBase {
  type: 'radial' | 'capsule' | 'shear' | 'impactSpread';
  damage: number;
  minRadius: number;
  end?: Vec3;
}
export interface BlastProgram extends ProgramBase {
  type: 'blast';
  charge: number;
}
export type DamageProgramDescriptor = ProfileProgram | BlastProgram;
export interface BondFractureCommand {
  bond: number;
  health: number;
  program?: number;
}
export interface ChunkFractureCommand {
  chunk: number;
  health: number;
  program?: number;
}
export type FractureCommand = ({ type: 'bond' } & BondFractureCommand) | ({ type: 'chunk' } & ChunkFractureCommand);
export interface FractureCommandBuffer {
  bonds: Array<BondFractureCommand>;
  chunks: Array<ChunkFractureCommand>;
  programs: Array<DamageProgramDescriptor>;
}
export interface ChunkDemotion {
  parent: number;
  children: Array<number>;
}
export interface FractureApplyResult {
  broken: Array<number>;
  cracked: Array<number>;
  demoted: Array<ChunkDemotion>;
}
interface CommandBase {
  direction: Vec3;
  fragmentId?: number;
  id: number;
  position: Vec3;
  source: number;
  tick: number;
}
export interface ChargeCommand extends CommandBase {
  charge: number;
  type: 'explosion' | 'placeExplosive';
}
export interface DetonateCommand extends CommandBase {
  type: 'detonate';
}
export interface StrikeCommand extends CommandBase {
  damageProgram?: ProfileProgram['type'];
  minRadius?: number;
  end?: Vec3;
  impulse?: Vec3;
  radius: number;
  strength: number;
  type: 'pointImpact' | 'cut' | 'cannonball';
}
export type DestructionCommand = ChargeCommand | DetonateCommand | StrikeCommand;
export const isChargeCommand = (command: DestructionCommand): command is ChargeCommand =>
  command.type === 'explosion' || command.type === 'placeExplosive';
export type DestructionIntent = DestructionCommand extends infer C ? C extends DestructionCommand ? Omit<C, 'id' | 'source' | 'tick'> : never : never;
export interface Strengths {
  bending: number;
  compression: number;
  shear: number;
  tension: number;
}
export function materialStrengths(material: MaterialDef): Strengths {
  return {
    bending: material.bendingStrength ?? 4e6,
    compression: material.compressionStrength ?? 25e6,
    shear: material.shearStrength ?? 2e6,
    tension: material.tensionStrength ?? 2.4e6,
  };
}
export const MIN_CHARGE = 0.01;
export const MAX_CHARGE = 1000;
export const DEMOLITION_CHARGE = 0.76;
const ATMOSPHERE = 101_325;
const TNT_DENSITY = 1600;
export const CHARGE_SURFACE = Math.cbrt(3 / (4 * Math.PI * TNT_DENSITY));
const MAX_SCALED_DISTANCE = 100;
export function blastOverpressure(scaled: number): number {
  const z = Math.max(scaled, CHARGE_SURFACE);
  return ATMOSPHERE * 808 * (1 + (z / 4.5) ** 2) /
    Math.sqrt((1 + (z / 0.048) ** 2) * (1 + (z / 0.32) ** 2) * (1 + (z / 1.35) ** 2));
}
export function blastImpulse(charge: number, scaled: number): number {
  const z = Math.max(scaled, CHARGE_SURFACE);
  return 6.7 * Math.cbrt(charge) * Math.sqrt(1 + (z / 0.23) ** 4) / (z * z * Math.cbrt(1 + (z / 1.55) ** 3));
}
export function blastReflection(overpressure: number): number {
  return 2 * (7 * ATMOSPHERE + 4 * overpressure) / (7 * ATMOSPHERE + overpressure);
}
export interface BlastLoad {
  pressure: number;
  impulse: number;
}
export function blastLoad(charge: number, distance: number): BlastLoad {
  const scaled = distance / Math.cbrt(charge);
  const overpressure = blastOverpressure(scaled), reflection = blastReflection(overpressure);
  return { pressure: overpressure * reflection, impulse: blastImpulse(charge, scaled) * reflection };
}
export function blastRange(charge: number, pressure: number): number {
  const reflected = (z: number) => { const p = blastOverpressure(z); return p * blastReflection(p); };
  let near = CHARGE_SURFACE, far = MAX_SCALED_DISTANCE;
  if (reflected(near) <= pressure) return near * Math.cbrt(charge);
  if (reflected(far) >= pressure) return far * Math.cbrt(charge);
  for (let i = 0; i < 48; i++) {
    const mid = Math.sqrt(near * far);
    if (reflected(mid) > pressure) near = mid; else far = mid;
  }
  return Math.sqrt(near * far) * Math.cbrt(charge);
}
export function blastReach(charge: number, materials: ReadonlyArray<MaterialDef>): number {
  const weakest = Math.min(...materials.map((material) => (material.minDamageThreshold ?? 0) * materialStrengths(material).tension));
  return blastRange(charge, weakest);
}
export interface OrdnanceState {
  id: number;
  position: Vec3;
  radius: number;
  rotation?: Quat;
  source: number;
  type: 'explosive' | 'cannonball';
}
export interface DestructionEvent {
  /** Event source mass in kg and impulse magnitude in N·s, when known. */
  mass?: number;
  impulse?: number;
  normal?: Vec3;
  radius?: number;
  count: number;
  energy: number;
  position: Vec3;
  tick: number;
  type:
    | 'bondBroken'
    | 'bondCracked'
    | 'bondCompliant'
    | 'islandDetached'
    | 'heavyImpact'
    | 'rubbleSettled'
    | 'explosiveDetonated'
    | 'cannonballImpact';
}
export const SIMULATION_VERSION = 'cascade-hierarchy-40';
export const PHYSICS_OPERATIONS_VERSION = 'cascade-hierarchy-40-physics-operations-1';
export const cannonballSpeed = (strength: number): number => 18 + strength * 8;
export const MAX_EXPLOSIVES = 32;
export const MAX_CANNONBALLS = 24;
export const MAX_REPLAY_COMMANDS = 10_000;
export const MAX_REPLAY_TICKS = 216_000;
export interface SimulationStats {
  activeBodies: number;
  brokenBonds: number;
  capacityEvents?: number;
  checksum: string;
  commands: number;
  crushedFragments?: number;
  crushedMass?: number;
  detachedFragments: number;
  droppedFrames: number;
  evictedFragments?: number;
  /** Step budget: rung of the degradation ladder in force (0 = none, 4 = all), and its inputs. */
  budgetRung?: number;
  /** Running physics step cost the budget acts on, in ms, and the step it is held to. */
  budgetStepMs?: number;
  budgetLimitMs?: number;
  /** Bodies the ladder baked this tick and since the start; sub-fractures deferred or skipped since the start. */
  budgetBaked?: number;
  budgetBakedTotal?: number;
  budgetDeferred?: number;
  /** Small debris alive, and the cap in force (tightened at rung 4). */
  debrisLive?: number;
  debrisCap?: number;
  /** Small debris that has sunk out of the world after its lifetime, or over the live cap. */
  debrisSunk?: number;
  healedRoots?: number;
  maxUtilization?: number;
  /** Measured only when this simulation owns and steps the native world. */
  nativeStepMs?: number;
  /** Snapshot construction, including checksums and presentation arrays. */
  snapshotMs?: number;
  /** Worker wrapper time in simulation.step(), including snapshot construction. */
  workerStepMs?: number;
  physicsMs: number;
  secondaryFragments?: number;
  settledBodies: number;
  sleepingBodies: number;
  solverConverged?: boolean;
  solverIterations?: number;
  solverResidual?: number;
  structuralDeferred?: boolean;
  structuralSolver?: 'direct' | 'support-path';
  structuralDirectMs?: number;
  structuralFactorColumns?: number;
  structuralMs: number;
  structuralWorkUnits?: number;
  supportedFragments: number;
  tick: number;
  totalBonds: number;
  workerMs: number;
}
export const TRANSFORM_STRIDE = 8;
export interface DestructionActor {
  id: number;
  supported: boolean;
  /** Manifest indices of active support chunks owned by this actor. */
  nodes: Array<number>;
  /** Manifest indices of shallowest intact visible chunks. */
  visibleChunks: Array<number>;
}
export interface ListPatch<T> {
  length: number;
  indices: Array<number>;
  values: Array<T>;
}
export const applyListPatch = <T>(base: ReadonlyArray<T>, patch: ListPatch<T>): Array<T> => {
  const next = base.slice(0, patch.length);
  patch.indices.forEach((index, offset) => { next[index] = patch.values[offset]!; });
  return next;
};
export interface SimulationFrame {
  /** Structural support for every authored chunk, including hidden hierarchy members. */
  topologySupported?: Uint8Array;
  /** Updated connection definitions after in-place support demotion. */
  bonds?: Array<BondDef>;
  bondRevision?: number;
  bondPatch?: ListPatch<BondDef>;
  actors?: Array<DestructionActor>;
  actorPatch?: ListPatch<DestructionActor>;
  visibleChunks?: Uint32Array;
  hierarchyRevision?: number;
  aim?: AimPreview;
  bondStates: Uint8Array;
  events: Array<DestructionEvent>;
  ordnance?: Array<OrdnanceState>;
  paused?: boolean;
  player?: PlayerState;
  secondary?: SecondaryFractureFrame;
  states: Uint8Array;
  stats: SimulationStats;
  stress?: Float32Array;
  stressKnown?: Uint8Array;
  tick: number;
  transforms: Float32Array;
  type: 'frame';
}
export interface CollisionBox {
  position: Vec3;
  rotation?: Quat;
  size: Vec3;
}
export interface CollisionObject {
  boxes: Array<CollisionBox>;
  id: string;
}
export interface EmitterLaunch {
  breech: Vec3;
  direction: Vec3;
  muzzle: Vec3;
  ownerId: string;
  radius: number;
  spawnOffset?: number;
  strength: number;
}
export interface PhysicsActionResult {
  accepted: boolean;
  command?: DestructionCommand;
  message?: string;
}
export const MAX_COLLISION_OBJECTS = 32;
export const MAX_COLLISION_BOXES = 8;
export const MAX_PHYSICS_OPERATIONS = 10_000;
export type PhysicsOperation = { tick: number } & (
  | { object: CollisionObject; type: 'setCollisionObject' }
  | { id: string; type: 'removeCollisionObject' }
  | { command: StrikeCommand; type: 'launchFromEmitter' }
);
const boundedPoint = (value: unknown): value is Vec3 =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((n) => Number.isFinite(n) && Math.abs(n) < 1000);
export const validCollisionId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-zA-Z0-9_.:-]{1,80}$/.test(id);
export function validateCollisionBox(box: CollisionBox): boolean {
  return Boolean(
    box &&
    boundedPoint(box.position) &&
    Array.isArray(box.size) &&
    box.size.length === 3 &&
    box.size.every((n) => Number.isFinite(n) && n >= 0.02 && n <= 32) &&
    (box.rotation === undefined ||
      (Array.isArray(box.rotation) &&
        box.rotation.length === 4 &&
        box.rotation.every(Number.isFinite) &&
        Math.abs(Math.hypot(...box.rotation) - 1) < 0.0001)),
  );
}
export function validateCollisionObject(object: CollisionObject): boolean {
  return Boolean(
    object &&
    validCollisionId(object.id) &&
    Array.isArray(object.boxes) &&
    object.boxes.length > 0 &&
    object.boxes.length <= MAX_COLLISION_BOXES &&
    object.boxes.every(validateCollisionBox),
  );
}
export function validatePhysicsOperation(operation: PhysicsOperation): boolean {
  if (
    !operation ||
    !Number.isSafeInteger(operation.tick) ||
    operation.tick < 0 ||
    operation.tick > MAX_REPLAY_TICKS
  ) {
    return false;
  }
  if (operation.type === 'setCollisionObject') {
    return validateCollisionObject(operation.object);
  }
  if (operation.type === 'removeCollisionObject') {
    return validCollisionId(operation.id);
  }
  return (
    operation.type === 'launchFromEmitter' &&
    operation.command?.type === 'cannonball' &&
    validateCommand(operation.command) &&
    operation.command.tick === operation.tick
  );
}
export function validatePhysicsOperations(
  operations: Array<PhysicsOperation> | undefined,
  commands: Array<DestructionCommand>,
  endTick: number,
): boolean {
  if (operations === undefined) {
    return true;
  }
  if (!Array.isArray(operations) || operations.length > MAX_PHYSICS_OPERATIONS) {
    return false;
  }
  const objects = new Set<string>();
  const ids = new Set(commands.map((command) => `${command.source}:${command.id}`));
  let tick = 0;
  for (const operation of operations) {
    if (!validatePhysicsOperation(operation) || operation.tick < tick || operation.tick > endTick) {
      return false;
    }
    tick = operation.tick;
    if (operation.type === 'setCollisionObject') {
      objects.add(operation.object.id);
      if (objects.size > MAX_COLLISION_OBJECTS) {
        return false;
      }
    } else if (operation.type === 'removeCollisionObject') {
      if (!objects.delete(operation.id)) {
        return false;
      }
    } else {
      const key = `${operation.command.source}:${operation.command.id}`;
      if (ids.has(key)) {
        return false;
      }
      ids.add(key);
    }
  }
  return true;
}
export interface ReplayLog {
  assetHash: string;
  commands: Array<DestructionCommand>;
  endTick: number;
  physicsOperations?: Array<PhysicsOperation>;
  scenario: ScenarioId;
  simulationVersion?: string;
  version: 1;
}
export interface RestPolicy {
  speed: number;
  spin: number;
  seconds: number;
  forceAfterSeconds?: number;
  forceSpeed?: number;
  forceSpin?: number;
}
export const restVersionSuffix = (rest?: Partial<RestPolicy>): string => {
  if (!rest) return '';
  const parts = [rest.speed, rest.spin, rest.seconds, rest.forceAfterSeconds, rest.forceSpeed, rest.forceSpin];
  return parts.some(part => part !== undefined) ? `-rest${parts.map(part => part ?? '').join(',')}` : '';
};
export type WorkerRequest =
  | { manifest: DestructibleManifest; rest?: Partial<RestPolicy>; timestep?: number; type: 'init' }
  | { command: DestructionCommand; type: 'command' }
  | {
      clearanceBoxes?: Array<CollisionBox>;
      object: CollisionObject;
      requestId: number;
      type: 'setCollisionObject';
    }
  | { id: string; requestId: number; type: 'removeCollisionObject' }
  | {
      id: number;
      launch: EmitterLaunch;
      requestId: number;
      source: number;
      type: 'launchFromEmitter';
    }
  | { enabled: boolean; type: 'player' }
  | { input: PlayerInput; type: 'playerInput' }
  | { type: 'playerRespawn' }
  | (PlayerLoad & { direction: Vec3; id: number; reach?: number; type: 'playerAction' })
  | { paused: boolean; type: 'pause' }
  | { speed: number; type: 'speed' }
  | { type: 'reset' }
  | { log: ReplayLog; type: 'replay' }
  | { requestId: number; type: 'exportReplay' }
  | { type: 'step' }
  | { type: 'dispose' };
export type WorkerResponse =
  | SimulationFrame
  | { command: DestructionCommand; requestId?: number; type: 'commandAccepted' }
  | ({ requestId: number; type: 'physicsActionResult' } & PhysicsActionResult)
  | { type: 'replayComplete' }
  | { log: ReplayLog; requestId: number; type: 'replayExport' }
  | { type: 'ready' }
  | { message: string; type: 'actionResult' }
  | { message: string; type: 'error' };
export const FIXED_DT = 1 / 60;
/** Half-rate step, for hosts that run physics in a Worker and interpolate between snapshots. */
export const FIXED_DT_30HZ = 1 / 30;
export const isSupportedTimestep = (dt: number): boolean =>
  Math.abs(dt - FIXED_DT) < 1e-6 || Math.abs(dt - FIXED_DT_30HZ) < 1e-6;
/** Results at 30 Hz differ from 60 Hz, so a replay records the rate in its version. */
export const simulationVersionFor = (dt: number): string =>
  Math.abs(dt - FIXED_DT_30HZ) < 1e-6 ? `${SIMULATION_VERSION}-30hz` : SIMULATION_VERSION;
export const physicsOperationsVersionFor = (dt: number): string =>
  Math.abs(dt - FIXED_DT_30HZ) < 1e-6
    ? `${SIMULATION_VERSION}-30hz-physics-operations-1`
    : PHYSICS_OPERATIONS_VERSION;
export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
export function validateCommand(command: DestructionCommand): boolean {
  const base =
    Number.isSafeInteger(command.id) &&
    command.id >= 0 &&
    Number.isSafeInteger(command.tick) &&
    command.tick >= 0 &&
    Number.isSafeInteger(command.source) &&
    command.source >= 0 &&
    Array.isArray(command.position) &&
    command.position.length === 3 &&
    command.position.every((n) => Number.isFinite(n) && Math.abs(n) < 1000) &&
    Array.isArray(command.direction) &&
    command.direction.length === 3 &&
    command.direction.every((n) => Number.isFinite(n) && Math.abs(n) <= 1.01) &&
    (command.fragmentId === undefined ||
      ((command.type === 'placeExplosive' || command.type === 'pointImpact') &&
        Number.isSafeInteger(command.fragmentId) &&
        command.fragmentId >= 0));
  if (!base) return false;
  if (isChargeCommand(command)) {
    return Number.isFinite(command.charge) && command.charge >= MIN_CHARGE && command.charge <= MAX_CHARGE;
  }
  if (command.type === 'detonate') return true;
  return (
    ['pointImpact', 'cut', 'cannonball'].includes(command.type) &&
    (command.damageProgram === undefined || ['radial', 'capsule', 'shear', 'impactSpread'].includes(command.damageProgram)) &&
    (command.minRadius === undefined || (Number.isFinite(command.minRadius) && command.minRadius >= 0 && command.minRadius <= command.radius)) &&
    (command.end === undefined || boundedPoint(command.end)) &&
    Number.isFinite(command.radius) &&
    command.radius > 0 &&
    command.radius <= 10 &&
    Number.isFinite(command.strength) &&
    command.strength > 0 &&
    command.strength <= 10 &&
    (command.impulse === undefined ||
      (command.type === 'pointImpact' &&
        command.fragmentId !== undefined &&
        Array.isArray(command.impulse) &&
        command.impulse.length === 3 &&
        command.impulse.every((n) => Number.isFinite(n)))) &&
    (command.type !== 'cannonball' ||
      (command.radius >= 0.08 &&
        command.radius <= 0.75 &&
        command.strength >= 0.4 &&
        command.strength <= 5 &&
        Math.abs(Math.hypot(...command.direction) - 1) <= 0.02))
  );
}
