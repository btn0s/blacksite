import {
  MAX_REPLAY_COMMANDS,
  MAX_EXPLOSIVES,
  MAX_CANNONBALLS,
  MAX_SECONDARY_DEFINITION_BYTES,
  MAX_SECONDARY_FRAGMENTS,
  MAX_SECONDARY_ID_SPAN,
  MAX_FRACTURE_GENERATION,
  FragmentState,
  BondState,
  SIMULATION_VERSION,
  PHYSICS_OPERATIONS_VERSION,
  MAX_REPLAY_TICKS,
  TRANSFORM_STRIDE,
  validateCommand,
  isChargeCommand,
  DEMOLITION_CHARGE,
  validatePhysicsOperations,
  type PhysicsOperation,
  type DestructibleManifest,
  type BondDef,
  type DestructionCommand,
  type ReplayLog,
  type OrdnanceState,
  type ScenarioId,
  type SimulationFrame,
  type SecondaryFractureFrame,
  type SecondaryFragmentDef,
  type Vec3,
} from '../../destruction-domain/src/index';
import { topologyChecksum } from '../../destruction-graph/src/index';

export const PROTOCOL_VERSION = 5;
const MAGIC = 0x52_55_50_54;
const HEADER_BYTES = 32;
const FRAGMENT_BYTES = 24;
const ORDNANCE_BYTES = 56;
const SECONDARY_HEADER_BYTES = 12;
const BOND_HEADER_BYTES = 8;
const MAX_BOND_DEFINITION_BYTES = 16_000_000;
const MAX_FRAGMENTS = 20_000;
const MAX_BONDS = 100_000;
const SECONDARY_DEFINITION_BYTES =
  MAX_SECONDARY_FRAGMENTS * (MAX_SECONDARY_DEFINITION_BYTES + 1) + 1;
const PACKET_BYTES =
  HEADER_BYTES +
  MAX_FRAGMENTS * FRAGMENT_BYTES +
  MAX_BONDS +
  (MAX_EXPLOSIVES + MAX_CANNONBALLS) * ORDNANCE_BYTES +
  SECONDARY_HEADER_BYTES +
  SECONDARY_DEFINITION_BYTES +
  MAX_SECONDARY_FRAGMENTS * FRAGMENT_BYTES +
  BOND_HEADER_BYTES +
  MAX_BOND_DEFINITION_BYTES +
  MAX_FRAGMENTS;
export const LIMITS = Object.freeze({
  bonds: MAX_BONDS,
  bondDefinitionBytes: MAX_BOND_DEFINITION_BYTES,
  commands: MAX_REPLAY_COMMANDS,
  endTick: MAX_REPLAY_TICKS,
  fragments: MAX_FRAGMENTS,
  packetBytes: Math.ceil((PACKET_BYTES * 1.05) / 100_000) * 100_000,
  position: 2048,
  replayBytes: 8_000_000,
  secondaryDefinitionBytes: SECONDARY_DEFINITION_BYTES,
  secondaryFaces: 128,
  secondaryFragments: MAX_SECONDARY_FRAGMENTS,
  secondarySize: 32,
  secondaryVertices: 64,
});
export const POSITION_PRECISION = 0.001;
export const QUATERNION_COMPONENT_ERROR = 0.00007;
const SCENARIOS: Array<ScenarioId> = ['building', 'wall', 'cantilever', 'bridge', 'complex'];
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new ProtocolError(message);
  }
}
function uint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xff_ff_ff_ff;
}
function stateValid(value: number): boolean {
  return value === BondState.Intact || value === BondState.Cracked ||
    value === BondState.Yielding || value === BondState.Broken || value === BondState.Compliant;
}
function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface Snapshot {
  bondStates: Uint8Array;
  bonds?: Array<BondDef>;
  bondRevision?: number;
  topologySupported?: Uint8Array;
  checksum: string;
  ordnance?: Array<OrdnanceState>;
  repair: boolean;
  secondary?: SecondaryFractureFrame;
  states: Uint8Array;
  tick: number;
  transforms: Float32Array;
}

function finiteVector(value: unknown, length: number, bound: number): value is Array<number> {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= bound)
  );
}
function idValid(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function positive(value: unknown, bound: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= bound;
}
function validateBondDefinitions(raw: unknown, count: number): asserts raw is Array<BondDef> {
  ensure(Array.isArray(raw) && raw.length === count && count <= LIMITS.bonds, 'Bond definition count mismatch');
  const ids = new Set<number>();
  for (const bond of raw) {
    ensure(record(bond) && idValid(bond.id) && !ids.has(bond.id) && idValid(bond.a) &&
      (bond.b === -1 || idValid(bond.b)) && bond.a !== bond.b &&
      positive(bond.area, 1e12) && positive(bond.strength, 1e12) &&
      finiteVector(bond.normal, 3, 1) && Math.hypot(...bond.normal) > 1e-8 &&
      (bond.centroid === undefined || finiteVector(bond.centroid, 3, LIMITS.position)) &&
      (bond.joint === undefined || typeof bond.joint === 'boolean') &&
      (bond.parentBond === undefined || idValid(bond.parentBond)) &&
      (bond.areaFraction === undefined || (typeof bond.areaFraction === 'number' &&
        Number.isFinite(bond.areaFraction) && bond.areaFraction > 0 && bond.areaFraction <= 1)),
    'Invalid bond definition');
    ids.add(bond.id);
    if (bond.section !== undefined) {
      const section = bond.section;
      ensure(record(section) && finiteVector(section.point, 3, LIMITS.position) &&
        finiteVector(section.tangent1, 3, 1) && finiteVector(section.tangent2, 3, 1) &&
        ['inertia1', 'inertia2', 'polarInertia', 'sectionModulus1', 'sectionModulus2', 'torsionModulus']
          .every((key) => positive(section[key], 1e18)), 'Invalid bond section');
    }
  }
}
const dot = (a: Array<number>, b: Array<number>) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const sub = (a: Array<number>, b: Array<number>) => a.map((n, i) => n - b[i]!);
const cross = (a: Array<number>, b: Array<number>) => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
)!.get!;

function snapshotBytes(buffer: ArrayBuffer | Uint8Array): Uint8Array {
  try {
    if (ArrayBuffer.isView(buffer)) {
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }
    arrayBufferByteLength.call(buffer);
    return new Uint8Array(buffer);
  } catch {
    throw new ProtocolError('Invalid snapshot buffer');
  }
}

function generationValid(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_FRACTURE_GENERATION
  );
}
function lineageValid(
  fragment: { generation: unknown; id: unknown; parentId: unknown; rootId: unknown },
  previousId: number,
  present: Set<number>,
): boolean {
  const { generation, id, parentId, rootId } = fragment;
  if (
    !idValid(id) ||
    id <= previousId ||
    !idValid(parentId) ||
    !idValid(rootId) ||
    !generationValid(generation) ||
    rootId >= id
  ) {
    return false;
  }
  if (generation === 1) {
    return parentId === rootId;
  }
  return parentId !== rootId && parentId < id && !present.has(parentId);
}

function validateSecondaryDefinitions(raw: unknown): asserts raw is Array<SecondaryFragmentDef> {
  ensure(
    Array.isArray(raw) && raw.length <= LIMITS.secondaryFragments,
    'Secondary fragment limit exceeded',
  );
  const ids = new Set<number>();
  let previousId = -1;
  for (const f of raw) {
    ensure(
      record(f) && idValid(f.id) && !ids.has(f.id) && f.id > previousId,
      'Invalid, duplicate or unordered secondary fragment ID',
    );
    ensure(
      lineageValid(
        { generation: f.generation, id: f.id, parentId: f.parentId, rootId: f.rootId },
        previousId,
        ids,
      ),
      'Invalid secondary fragment lineage',
    );
    ids.add(f.id);
    previousId = f.id;
    ensure(
      f.anchored === false &&
        idValid(f.material) &&
        idValid(f.region) &&
        idValid(f.aggregate) &&
        finiteVector(f.position, 3, LIMITS.position) &&
        finiteVector(f.size, 3, LIMITS.secondarySize) &&
        f.size.every((n) => n > 0) &&
        positive(f.mass, 1e8),
      'Invalid secondary fragment definition',
    );
    const shape = f.shape;
    if (shape === undefined) continue;
    ensure(
      record(shape) &&
        positive(shape.volume, f.size[0]! * f.size[1]! * f.size[2]! * 1.00001) &&
        finiteVector(shape.inertia, 6, 1e12),
      'Invalid secondary volume or inertia',
    );
    const [xx, yy, zz, xy, xz, yz] = shape.inertia as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const determinant =
      xx * yy * zz + 2 * xy * xz * yz - xx * yz * yz - yy * xz * xz - zz * xy * xy;
    const inertiaBound = f.mass * dot(f.size, f.size);
    ensure(
      xx > 0 &&
        yy > 0 &&
        zz > 0 &&
        xx * yy > xy * xy &&
        determinant > 0 &&
        Math.max(xx, yy, zz) <= inertiaBound,
      'Invalid secondary inertia tensor',
    );
    ensure(
      Array.isArray(shape.vertices) &&
        shape.vertices.length >= 4 &&
        shape.vertices.length <= LIMITS.secondaryVertices &&
        shape.vertices.every(
          (v) =>
            finiteVector(v, 3, LIMITS.secondarySize) &&
            v.every((n, axis) => Math.abs(n) <= (f.size as Array<number>)[axis]! + 1e-6),
        ),
      'Invalid secondary hull vertices',
    );
    ensure(
      Array.isArray(shape.faces) &&
        shape.faces.length >= 4 &&
        shape.faces.length <= LIMITS.secondaryFaces,
      'Invalid secondary hull faces',
    );
    const vertices = shape.vertices as Array<Array<number>>;
    ensure(
      f.size.every(
        (size, axis) =>
          Math.max(...vertices.map((v) => v[axis]!)) - Math.min(...vertices.map((v) => v[axis]!)) <=
          size + 1e-6,
      ),
      'Secondary hull exceeds fragment size',
    );
    const edges = new Map<string, { count: number; orientation: number }>();
    let volume = 0;
    const first = [0, 0, 0];
    const tolerance = 1e-6 * Math.max(1, ...f.size);
    for (const face of shape.faces) {
      ensure(
        record(face) &&
          Array.isArray(face.vertices) &&
          face.vertices.length >= 3 &&
          face.vertices.length <= LIMITS.secondaryVertices &&
          face.vertices.every((i) => idValid(i) && i < vertices.length) &&
          new Set(face.vertices).size === face.vertices.length &&
          (face.surface === 'exterior' || face.surface === 'fracture'),
        'Invalid secondary face indices or surface',
      );
      const indices = face.vertices as Array<number>,
        points = indices.map((i) => vertices[i]!);
      const normal = [0, 0, 0];
      for (let i = 1; i + 1 < points.length; i++) {
        const n = cross(sub(points[i]!, points[0]!), sub(points[i + 1]!, points[0]!));
        const tetra = dot(points[0]!, cross(points[i]!, points[i + 1]!)) / 6;
        volume += tetra;
        for (let axis = 0; axis < 3; axis++) {
          normal[axis]! += n[axis]!;
          first[axis]! +=
            (tetra * (points[0]![axis]! + points[i]![axis]! + points[i + 1]![axis]!)) / 4;
        }
      }
      const length = Math.hypot(...normal);
      ensure(length > 1e-12, 'Degenerate secondary hull face');
      for (let axis = 0; axis < 3; axis++) {
        normal[axis]! /= length;
      }
      ensure(
        points.every((p) => Math.abs(dot(normal, sub(p, points[0]!))) <= tolerance) &&
          vertices.every((p) => dot(normal, sub(p, points[0]!)) <= tolerance),
        'Secondary hull must be planar, convex and outward wound',
      );
      indices.forEach((a, i) => {
        const b = indices[(i + 1) % indices.length]!,
          key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        const edge = edges.get(key) ?? { count: 0, orientation: 0 };
        edge.count++;
        edge.orientation += a < b ? 1 : -1;
        edges.set(key, edge);
      });
    }
    ensure(
      [...edges.values()].every((e) => e.count === 2 && e.orientation === 0),
      'Secondary hull must be closed',
    );
    ensure(
      volume > 0 &&
        Math.abs(volume - shape.volume) <= Math.max(1e-8, shape.volume * 1e-5) &&
        Math.hypot(...first) / volume <= tolerance * 10,
      'Secondary hull volume or center of mass mismatch',
    );
  }
}

function encodeDefinitions(fragments: Array<SecondaryFragmentDef>): Uint8Array {
  const encoder = new TextEncoder();
  const parts = fragments.map((fragment) => encoder.encode(JSON.stringify(fragment)));
  let length = 1;
  for (const part of parts) {
    ensure(
      part.byteLength <= MAX_SECONDARY_DEFINITION_BYTES,
      'Secondary fragment definition byte limit exceeded',
    );
    length += part.byteLength + 1;
  }
  const bytes = new Uint8Array(Math.max(length, 2));
  let offset = 0;
  bytes[offset++] = 0x5b;
  parts.forEach((part, index) => {
    if (index) {
      bytes[offset++] = 0x2c;
    }
    bytes.set(part, offset);
    offset += part.byteLength;
  });
  bytes[offset] = 0x5d;
  return bytes;
}

function writeFragments(
  view: DataView,
  offset: number,
  transforms: Float32Array,
  states: Uint8Array,
  maxState: number,
) {
  ensure(
    transforms.length === states.length * TRANSFORM_STRIDE,
    'Transform count does not match fragments',
  );
  for (let i = 0; i < states.length; i++) {
    const source = i * TRANSFORM_STRIDE,
      dest = offset + i * FRAGMENT_BYTES;
    for (let axis = 0; axis < 3; axis++) {
      const position = transforms[source + axis]!;
      ensure(
        Number.isFinite(position) && Math.abs(position) <= LIMITS.position,
        'Position exceeds quantization bounds',
      );
      view.setInt32(dest + axis * 4, Math.round(position / POSITION_PRECISION), true);
    }
    const q = Array.from(transforms.subarray(source + 3, source + 7)),
      norm = Math.hypot(...q);
    ensure(Number.isFinite(norm) && Math.abs(norm - 1) <= 0.00001, 'Quaternion must be normalized');
    for (let axis = 0; axis < 4; axis++) {
      view.setInt16(dest + 12 + axis * 2, Math.round((q[axis]! / norm) * 32_767), true);
    }
    const damage = transforms[source + 7]!,
      state = states[i]!;
    ensure(Number.isFinite(damage) && damage >= 0 && damage <= 1, 'Invalid damage');
    ensure(
      Number.isInteger(state) && state >= FragmentState.Supported && state <= maxState,
      'Invalid fragment state',
    );
    view.setUint16(dest + 20, Math.round(damage * 65_535), true);
    view.setUint8(dest + 22, state);
  }
}

function readFragments(
  view: DataView,
  offset: number,
  count: number,
  minState: number,
  maxState: number,
) {
  const transforms = new Float32Array(count * TRANSFORM_STRIDE),
    states = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const source = offset + i * FRAGMENT_BYTES,
      dest = i * TRANSFORM_STRIDE;
    for (let axis = 0; axis < 3; axis++) {
      const position = view.getInt32(source + axis * 4, true) * POSITION_PRECISION;
      ensure(Math.abs(position) <= LIMITS.position, 'Position exceeds quantization bounds');
      transforms[dest + axis] = position;
    }
    const q = Array.from(
        { length: 4 },
        (_, axis) => view.getInt16(source + 12 + axis * 2, true) / 32_767,
      ),
      norm = Math.hypot(...q);
    ensure(Math.abs(norm - 1) <= 0.0001, 'Malformed quaternion');
    for (let axis = 0; axis < 4; axis++) {
      transforms[dest + 3 + axis] = q[axis]! / norm;
    }
    transforms[dest + 7] = view.getUint16(source + 20, true) / 65_535;
    states[i] = view.getUint8(source + 22);
    ensure(
      states[i]! >= minState && states[i]! <= maxState && view.getUint8(source + 23) === 0,
      'Invalid fragment state or reserved byte',
    );
  }
  return { states, transforms };
}

function legacyDefinitions(raw: unknown): unknown {
  ensure(
    Array.isArray(raw) && raw.length <= LIMITS.secondaryFragments,
    'Secondary fragment limit exceeded',
  );
  return raw.map((fragment: unknown) => {
    ensure(
      record(fragment) && fragment.generation === 1 && fragment.rootId === undefined,
      'Unsupported fracture generation for snapshot version',
    );
    return { ...fragment, rootId: fragment.parentId };
  });
}

export function encodeSnapshot(frame: SimulationFrame, repair = false): ArrayBuffer {
  const count = frame.states.length;
  const bonds = frame.bondStates.length;
  const ordnance = frame.ordnance ?? [];
  ensure(ordnance.length <= MAX_EXPLOSIVES + MAX_CANNONBALLS, 'Ordnance count exceeded');
  ensure(count <= LIMITS.fragments && bonds <= LIMITS.bonds, 'Snapshot entity limit exceeded');
  ensure(
    frame.transforms.length === count * TRANSFORM_STRIDE,
    'Transform count does not match fragments',
  );
  ensure(uint32(frame.tick), 'Invalid snapshot tick');
  ensure(
    /^[\da-f]{8}$/i.test(frame.stats.checksum),
    'Checksum must be eight hexadecimal characters',
  );
  const ordnanceOffset = HEADER_BYTES + count * FRAGMENT_BYTES + bonds;
  const secondaryOffset = ordnanceOffset + ordnance.length * ORDNANCE_BYTES;
  const secondary = frame.secondary;
  const revisedBonds = frame.bonds;
  const support = frame.topologySupported;
  if (support) ensure(support.length === count && support.every((value) => value <= 1), 'Invalid topology support mask');
  const revised = Boolean(revisedBonds || support);
  let bondDefinitions = new Uint8Array(0);
  if (revisedBonds) {
    ensure(typeof frame.bondRevision === 'number' && uint32(frame.bondRevision) &&
      frame.bondRevision > 0, 'Invalid bond revision');
    validateBondDefinitions(revisedBonds, bonds);
    bondDefinitions = new TextEncoder().encode(JSON.stringify(revisedBonds));
    ensure(bondDefinitions.byteLength <= LIMITS.bondDefinitionBytes, 'Bond definition byte limit exceeded');
  } else {
    ensure(frame.bondRevision === undefined || frame.bondRevision === 0, 'Missing revised bond definitions');
  }
  let definitions: Uint8Array = new Uint8Array(0);
  if (secondary) {
    ensure(uint32(secondary.revision), 'Invalid secondary revision');
    validateSecondaryDefinitions(secondary.fragments);
    ensure(
      secondary.states.length === secondary.fragments.length,
      'Secondary state count mismatch',
    );
    definitions = encodeDefinitions(secondary.fragments);
    ensure(
      definitions.byteLength <= LIMITS.secondaryDefinitionBytes,
      'Secondary definition byte limit exceeded',
    );
  }
  const bytes =
    secondaryOffset +
    SECONDARY_HEADER_BYTES +
    definitions.byteLength +
    (secondary?.states.length ?? 0) * FRAGMENT_BYTES +
    (revised ? BOND_HEADER_BYTES + bondDefinitions.byteLength + count : 0);
  ensure(bytes <= LIMITS.packetBytes, 'Snapshot byte limit exceeded');
  const buffer = new ArrayBuffer(bytes);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint8(4, revised ? PROTOCOL_VERSION : 4);
  view.setUint8(5, repair ? 1 : 0);
  view.setUint16(6, HEADER_BYTES, true);
  view.setUint32(8, frame.tick, true);
  view.setUint32(12, count, true);
  view.setUint32(16, bonds, true);
  view.setUint32(20, Number.parseInt(frame.stats.checksum, 16), true);
  view.setUint32(24, bytes, true);
  view.setUint32(28, ordnance.length, true);
  writeFragments(view, HEADER_BYTES, frame.transforms, frame.states, FragmentState.Hidden);
  for (let i = 0; i < bonds; i++) {
    ensure(stateValid(frame.bondStates[i]!), 'Invalid bond state');
    view.setUint8(HEADER_BYTES + count * FRAGMENT_BYTES + i, frame.bondStates[i]!);
  }
  for (let i = 0; i < ordnance.length; i++) {
    const item = ordnance[i]!,
      offset = ordnanceOffset + i * ORDNANCE_BYTES;
    ensure(
      (item.type === 'explosive' || item.type === 'cannonball') &&
        Number.isSafeInteger(item.id) &&
        item.id >= 0 &&
        Number.isSafeInteger(item.source) &&
        item.source >= 0 &&
        Number.isFinite(item.radius) &&
        item.radius > 0 &&
        item.radius <= 10,
      'Invalid ordnance state',
    );
    const q = item.rotation ?? [0, 0, 0, 1];
    ensure(
      item.position.length === 3 &&
        item.position.every((n) => Number.isFinite(n) && Math.abs(n) <= LIMITS.position) &&
        q.length === 4 &&
        Math.abs(Math.hypot(...q) - 1) < 0.001,
      'Invalid ordnance transform',
    );
    view.setUint32(offset, item.type === 'explosive' ? 0 : 1, true);
    view.setFloat64(offset + 4, item.id, true);
    view.setFloat64(offset + 12, item.source, true);
    view.setFloat32(offset + 20, item.radius, true);
    item.position.forEach((n, axis) => view.setFloat32(offset + 24 + axis * 4, n, true));
    q.forEach((n, axis) => view.setFloat32(offset + 36 + axis * 4, n, true));
  }
  view.setUint32(secondaryOffset, secondary?.revision ?? 0, true);
  view.setUint32(secondaryOffset + 4, secondary?.states.length ?? 0, true);
  view.setUint32(secondaryOffset + 8, definitions.byteLength, true);
  new Uint8Array(buffer, secondaryOffset + SECONDARY_HEADER_BYTES, definitions.byteLength).set(
    definitions,
  );
  if (secondary) {
    writeFragments(
      view,
      secondaryOffset + SECONDARY_HEADER_BYTES + definitions.byteLength,
      secondary.transforms,
      secondary.states,
      FragmentState.Settled,
    );
  }
  if (revised) {
    const offset = secondaryOffset + SECONDARY_HEADER_BYTES + definitions.byteLength +
      (secondary?.states.length ?? 0) * FRAGMENT_BYTES;
    view.setUint32(offset, frame.bondRevision ?? 0, true);
    view.setUint32(offset + 4, bondDefinitions.byteLength, true);
    new Uint8Array(buffer, offset + BOND_HEADER_BYTES, bondDefinitions.byteLength).set(bondDefinitions);
    new Uint8Array(buffer, offset + BOND_HEADER_BYTES + bondDefinitions.byteLength, count).set(
      support ?? frame.states.map((state) => state === FragmentState.Supported ? 1 : 0),
    );
  }
  return buffer;
}

export function decodeSnapshot(
  buffer: ArrayBuffer | Uint8Array,
  expectedCounts?: { bonds?: number; fragments: number },
): Snapshot {
  const bytes = snapshotBytes(buffer);
  ensure(
    bytes.byteLength >= HEADER_BYTES && bytes.byteLength <= LIMITS.packetBytes,
    'Invalid snapshot size',
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  ensure(view.getUint32(0, true) === MAGIC, 'Invalid snapshot magic');
  const version = view.getUint8(4);
  ensure(
    (version === PROTOCOL_VERSION || version === 4 || version === 3 || version === 2 || version === 1) &&
      view.getUint16(6, true) === HEADER_BYTES,
    'Unsupported snapshot version',
  );
  ensure(
    view.getUint8(5) <= 1 && (view.getUint8(4) !== 1 || view.getUint32(28, true) === 0),
    'Unsupported snapshot flags',
  );
  const count = view.getUint32(12, true);
  const bonds = view.getUint32(16, true);
  const ordnanceCount = view.getUint32(28, true);
  ensure(ordnanceCount <= MAX_EXPLOSIVES + MAX_CANNONBALLS, 'Ordnance count exceeded');
  ensure(count <= LIMITS.fragments && bonds <= LIMITS.bonds, 'Snapshot entity limit exceeded');
  ensure(
    HEADER_BYTES +
      count * FRAGMENT_BYTES +
      bonds +
      ordnanceCount * ORDNANCE_BYTES +
      (version >= 3 ? SECONDARY_HEADER_BYTES : 0) +
      (version >= 5 ? BOND_HEADER_BYTES : 0) <=
      bytes.byteLength && view.getUint32(24, true) === bytes.byteLength,
    'Snapshot count/length mismatch',
  );
  const secondaryOffset =
    HEADER_BYTES + count * FRAGMENT_BYTES + bonds + ordnanceCount * ORDNANCE_BYTES;
  let secondary: SecondaryFractureFrame | undefined;
  let revisedBonds: Array<BondDef> | undefined;
  let bondRevision: number | undefined;
  let topologySupported: Uint8Array | undefined;
  if (version >= 3) {
    const revision = view.getUint32(secondaryOffset, true),
      childCount = view.getUint32(secondaryOffset + 4, true),
      definitionBytes = view.getUint32(secondaryOffset + 8, true);
    ensure(
      childCount <= LIMITS.secondaryFragments && definitionBytes <= LIMITS.secondaryDefinitionBytes,
      'Secondary count or byte limit exceeded',
    );
    const childOffset = secondaryOffset + SECONDARY_HEADER_BYTES + definitionBytes;
    ensure(
      childOffset + childCount * FRAGMENT_BYTES + (version >= 5 ? BOND_HEADER_BYTES + count : 0) <= bytes.byteLength &&
        (version >= 5 || childOffset + childCount * FRAGMENT_BYTES === bytes.byteLength),
      'Secondary count/length mismatch',
    );
    if (version >= 5) {
      const bondOffset = childOffset + childCount * FRAGMENT_BYTES;
      bondRevision = view.getUint32(bondOffset, true);
      const definitionBytes = view.getUint32(bondOffset + 4, true);
      ensure(((bondRevision === 0 && definitionBytes === 0) || (bondRevision > 0 && definitionBytes > 0)) &&
        definitionBytes <= LIMITS.bondDefinitionBytes &&
        bondOffset + BOND_HEADER_BYTES + definitionBytes + count === bytes.byteLength,
      'Bond definition count/length mismatch');
      if (definitionBytes) {
        try {
          revisedBonds = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
            bytes.subarray(bondOffset + BOND_HEADER_BYTES, bondOffset + BOND_HEADER_BYTES + definitionBytes),
          ));
        } catch {
          throw new ProtocolError('Invalid bond definition JSON');
        }
        validateBondDefinitions(revisedBonds, bonds);
      }
      topologySupported = bytes.slice(bondOffset + BOND_HEADER_BYTES + definitionBytes);
      ensure(topologySupported.every((value) => value <= 1), 'Invalid topology support mask');
    }
    if (definitionBytes) {
      let fragments: unknown;
      try {
        fragments = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            bytes.subarray(secondaryOffset + SECONDARY_HEADER_BYTES, childOffset),
          ),
        );
      } catch {
        throw new ProtocolError('Invalid secondary definition JSON');
      }
      if (version < 4) {
        fragments = legacyDefinitions(fragments);
      }
      validateSecondaryDefinitions(fragments);
      encodeDefinitions(fragments);
      ensure(fragments.length === childCount, 'Secondary definition count mismatch');
      secondary = {
        fragments,
        revision,
        ...readFragments(
          view,
          childOffset,
          childCount,
          version >= 4 ? FragmentState.Supported : FragmentState.Dynamic,
          FragmentState.Settled,
        ),
      };
    } else {
      ensure(childCount === 0 && revision === 0, 'Missing secondary definitions');
    }
  } else {
    ensure(secondaryOffset === bytes.byteLength, 'Snapshot count/length mismatch');
  }
  if (expectedCounts) {
    ensure(
      count === expectedCounts.fragments && (expectedCounts.bonds === undefined || bonds === expectedCounts.bonds),
      'Snapshot does not match manifest',
    );
  }
  const { states, transforms } = readFragments(
    view,
    HEADER_BYTES,
    count,
    FragmentState.Supported,
    version >= 3 ? FragmentState.Hidden : FragmentState.Settled,
  );
  const bondOffset = HEADER_BYTES + count * FRAGMENT_BYTES;
  const bondStates = bytes.slice(bondOffset, bondOffset + bonds);
  ensure(bondStates.every(stateValid), 'Invalid bond state');
  const ordnance: Array<OrdnanceState> = [];
  for (let i = 0; i < ordnanceCount; i++) {
    const offset = bondOffset + bonds + i * ORDNANCE_BYTES;
    const kind = view.getUint32(offset, true),
      id = view.getFloat64(offset + 4, true),
      source = view.getFloat64(offset + 12, true),
      radius = view.getFloat32(offset + 20, true);
    const position: Vec3 = [
      view.getFloat32(offset + 24, true),
      view.getFloat32(offset + 28, true),
      view.getFloat32(offset + 32, true),
    ];
    const rotation: [number, number, number, number] = [
      view.getFloat32(offset + 36, true),
      view.getFloat32(offset + 40, true),
      view.getFloat32(offset + 44, true),
      view.getFloat32(offset + 48, true),
    ];
    ensure(
      kind <= 1 &&
        Number.isSafeInteger(id) &&
        id >= 0 &&
        Number.isSafeInteger(source) &&
        source >= 0 &&
        Number.isFinite(radius) &&
        radius > 0 &&
        radius <= 10 &&
        view.getUint32(offset + 52, true) === 0,
      'Invalid ordnance state',
    );
    ensure(
      position.every((n) => Number.isFinite(n) && Math.abs(n) <= LIMITS.position) &&
        Math.abs(Math.hypot(...rotation) - 1) < 0.001,
      'Invalid ordnance transform',
    );
    ordnance.push({
      id,
      position,
      radius,
      rotation,
      source,
      type: kind === 0 ? 'explosive' : 'cannonball',
    });
  }
  return {
    bondStates,
    ...(revisedBonds ? { bonds: revisedBonds, bondRevision } : {}),
    ...(topologySupported ? { topologySupported } : {}),
    checksum: view.getUint32(20, true).toString(16).padStart(8, '0'),
    ordnance,
    repair: view.getUint8(5) === 1,
    states,
    tick: view.getUint32(8, true),
    transforms,
    ...(secondary ? { secondary } : {}),
  };
}

export function verifySnapshot(snapshot: Snapshot, manifest: DestructibleManifest): boolean {
  const bonds = snapshot.bonds ?? manifest.bonds;
  if (
    snapshot.states.length !== manifest.fragments.length ||
    snapshot.bondStates.length !== bonds.length ||
    (snapshot.topologySupported !== undefined &&
      (snapshot.topologySupported.length !== manifest.fragments.length ||
        !snapshot.topologySupported.every((value) => value <= 1))) ||
    (snapshot.bonds !== undefined && (!snapshot.bondRevision ||
      bonds.some((bond) => !manifest.fragments.some((fragment) => fragment.id === bond.a) ||
        (bond.b !== -1 && !manifest.fragments.some((fragment) => fragment.id === bond.b)))))
  ) {
    return false;
  }
  const topology = snapshot.bonds ? { ...manifest, bonds } : manifest;
  const supported = snapshot.topologySupported ??
    snapshot.states.map((state) => state === FragmentState.Supported ? 1 : 0);
  const secondary = snapshot.secondary;
  if (!secondary) {
    return (
      topologyChecksum(topology, snapshot.bondStates, supported) === snapshot.checksum
    );
  }
  const fragments = secondary.fragments;
  const firstId = manifest.fragments.reduce((max, fragment) => Math.max(max, fragment.id), -1) + 1;
  const endId = firstId + MAX_SECONDARY_ID_SPAN;
  if (
    !Array.isArray(fragments) ||
    fragments.length > MAX_SECONDARY_FRAGMENTS ||
    secondary.states.length !== fragments.length ||
    !Number.isSafeInteger(endId - 1)
  ) {
    return false;
  }
  const roots = new Map(manifest.fragments.map((fragment, index) => [fragment.id, index]));
  const present = new Set<number>();
  let previousId = firstId - 1;
  for (let index = 0; index < fragments.length; index++) {
    const child = fragments[index]!;
    const state = secondary.states[index]!;
    const root = roots.get(child.rootId);
    const rootFragment = root === undefined ? undefined : manifest.fragments[root];
    if (
      !rootFragment ||
      !lineageValid(child, previousId, present) ||
      child.id >= endId ||
      (child.generation > 1 && child.parentId < firstId) ||
      snapshot.states[root!] !== FragmentState.Retired ||
      state > FragmentState.Settled ||
      child.material !== rootFragment.material ||
      child.region !== rootFragment.region
    ) {
      return false;
    }
    present.add(child.id);
    previousId = child.id;
    if (!snapshot.topologySupported && state === FragmentState.Supported) {
      supported[root!] = 1;
    }
  }
  return topologyChecksum(topology, snapshot.bondStates, supported) === snapshot.checksum;
}
export function topologyMatches(snapshot: Snapshot, checksum: string): boolean {
  return snapshot.checksum === checksum;
}

export class SnapshotReceiver {
  current: Snapshot | undefined;
  rejected = 0;
  accept(buffer: ArrayBuffer | Uint8Array, manifest: DestructibleManifest): boolean {
    const snapshot = decodeSnapshot(buffer, {
      fragments: manifest.fragments.length,
    });
    if (!verifySnapshot(snapshot, manifest)) {
      this.rejected++;
      return false;
    }
    if (
      this.current &&
      snapshot.tick <= this.current.tick &&
      !(snapshot.repair && snapshot.tick === this.current.tick)
    ) {
      return false;
    }
    this.current = snapshot;
    return true;
  }
  needsRepair(audit: { checksum: string; tick: number }): boolean {
    return (
      !this.current ||
      (this.current.tick === audit.tick && this.current.checksum !== audit.checksum)
    );
  }
}

export function parseReplay(text: string, expectedAssetHash?: string): ReplayLog {
  ensure(
    text.length <= LIMITS.replayBytes &&
      new TextEncoder().encode(text).byteLength <= LIMITS.replayBytes,
    'Replay byte limit exceeded',
  );
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProtocolError('Replay is not valid JSON');
  }
  ensure(record(raw) && raw.version === 1, 'Unsupported replay version');
  ensure(validHash(raw.assetHash), 'Invalid replay content hash');
  if (expectedAssetHash !== undefined) {
    ensure(raw.assetHash === expectedAssetHash, 'Replay content hash mismatch');
  }
  ensure(SCENARIOS.includes(raw.scenario as ScenarioId), 'Unknown replay scenario');
  ensure(
    Number.isInteger(raw.endTick) &&
      Number(raw.endTick) >= 0 &&
      Number(raw.endTick) <= LIMITS.endTick,
    'Invalid replay duration',
  );
  ensure(
    Array.isArray(raw.commands) && raw.commands.length <= LIMITS.commands,
    'Replay command limit exceeded',
  );
  const seen = new Set<string>();
  const commands: Array<DestructionCommand> = [];
  for (const item of raw.commands) {
    ensure(record(item), 'Invalid replay command');
    const command = item as unknown as DestructionCommand;
    ensure(
      validateCommand(command) && command.tick <= Number(raw.endTick),
      'Invalid replay command',
    );
    const key = `${command.source}:${command.id}`;
    ensure(!seen.has(key), 'Duplicate replay command');
    seen.add(key);
    const base = {
      direction: [...command.direction] as Vec3,
      id: command.id,
      position: [...command.position] as Vec3,
      source: command.source,
      tick: command.tick,
      ...(command.fragmentId === undefined ? {} : { fragmentId: command.fragmentId }),
    };
    if (isChargeCommand(command)) commands.push({ ...base, charge: command.charge, type: command.type });
    else if (command.type === 'detonate') commands.push({ ...base, type: command.type });
    else commands.push({
      ...base,
      radius: command.radius,
      strength: command.strength,
      type: command.type,
      ...(command.impulse === undefined ? {} : { impulse: [...command.impulse] as Vec3 }),
      ...(command.damageProgram === undefined ? {} : { damageProgram: command.damageProgram }),
      ...(command.minRadius === undefined ? {} : { minRadius: command.minRadius }),
      ...(command.end === undefined ? {} : { end: [...command.end] as Vec3 }),
    });
  }
  commands.sort((a, b) => a.tick - b.tick || a.id - b.id || a.source - b.source);
  ensure(
    raw.playerLoads === undefined ||
      (Array.isArray(raw.playerLoads) && raw.playerLoads.length === 0),
    'Player-weight recordings are no longer supported',
  );
  ensure(
    raw.simulationVersion === SIMULATION_VERSION ||
      raw.simulationVersion === PHYSICS_OPERATIONS_VERSION,
    `Unsupported simulation version; this build supports ${SIMULATION_VERSION} and ${PHYSICS_OPERATIONS_VERSION}`,
  );
  ensure(
    !Array.isArray(raw.physicsOperations) ||
      raw.physicsOperations.length === 0 ||
      raw.simulationVersion === PHYSICS_OPERATIONS_VERSION,
    'Replay physics operations require their simulation version marker',
  );
  ensure(
    validatePhysicsOperations(
      raw.physicsOperations as Array<PhysicsOperation> | undefined,
      commands,
      Number(raw.endTick),
    ),
    'Invalid replay physics operations',
  );
  return {
    version: 1,
    ...(raw.simulationVersion ? { simulationVersion: raw.simulationVersion as string } : {}),
    assetHash: raw.assetHash,
    commands,
    endTick: Number(raw.endTick),
    scenario: raw.scenario as ScenarioId,
    ...(raw.physicsOperations === undefined
      ? {}
      : {
          physicsOperations: structuredClone(raw.physicsOperations as Array<PhysicsOperation>),
        }),
  };
}

export function serializeReplay(log: ReplayLog): string {
  const canonical = parseReplay(JSON.stringify(log));
  const pretty = JSON.stringify(canonical, null, 2);
  return new TextEncoder().encode(pretty).byteLength <= LIMITS.replayBytes
    ? pretty
    : JSON.stringify(canonical);
}

export const WEAPONS = Object.freeze({
  cannonball: { radius: 0.32, strength: 3 },
  cut: { radius: 1.4, strength: 2.2 },
  detonate: {},
  explosion: { charge: DEMOLITION_CHARGE },
  placeExplosive: { charge: DEMOLITION_CHARGE },
  pointImpact: { radius: 0.8, strength: 0.9 },
});
export function commandFromIntent(
  raw: unknown,
  context: { lastId: number; source: number; tick: number },
): DestructionCommand {
  ensure(
    record(raw) &&
      (raw.type === 'pointImpact' ||
        raw.type === 'explosion' ||
        raw.type === 'cut' ||
        raw.type === 'placeExplosive' ||
        raw.type === 'detonate' ||
        raw.type === 'cannonball'),
    'Invalid command type',
  );
  ensure(
    Number.isSafeInteger(raw.id) && Number(raw.id) > context.lastId && Number(raw.id) >= 0,
    'Command ID must increase',
  );
  const position = raw.position;
  ensure(
    Array.isArray(position) &&
      position.length === 3 &&
      position.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1000),
    'Invalid command position',
  );
  const direction = raw.direction ?? [0, -1, 0];
  ensure(
    Array.isArray(direction) &&
      direction.length === 3 &&
      direction.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1.01),
    'Invalid command direction',
  );
  const norm = Math.hypot(...direction);
  ensure(norm > 0.001 && norm < 1.75, 'Invalid command direction');
  const policy = WEAPONS[raw.type];
  const command = {
    direction: direction.map((n) => n / norm) as Vec3,
    id: Number(raw.id),
    position: [...position] as Vec3,
    source: context.source,
    tick: context.tick,
    type: raw.type,
    ...policy,
    ...(raw.fragmentId === undefined ? {} : { fragmentId: Number(raw.fragmentId) }),
  } as DestructionCommand;
  ensure(
    raw.fragmentId === undefined ||
      (typeof raw.fragmentId === 'number' &&
        Number.isSafeInteger(raw.fragmentId) &&
        raw.fragmentId >= 0),
    'Invalid fragment attachment',
  );
  ensure(validateCommand(command), 'Invalid authoritative command');
  return command;
}
