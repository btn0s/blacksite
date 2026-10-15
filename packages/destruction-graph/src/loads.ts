import type { DestructibleManifest, Quat, Vec3 } from '../../destruction-domain/src/index';

export interface StructuralLoadBody {
  angularVelocity: Vec3;
  members: ReadonlyArray<number>;
  rotation: Quat;
}
export interface StructuralLoadSnapshot {
  bodies: ReadonlyArray<StructuralLoadBody>;
  tick: number;
  wrenches: Float64Array;
}
export interface StructuralLoads {
  clamped: Uint8Array;
  groupOf: Int32Array;
  groups: Array<Array<number>>;
  participating: Uint8Array;
  rhs: Float64Array;
  solverGroups: Int32Array;
  tick: number;
}

function inverseRotate(v: Vec3, q: Quat): Vec3 {
  const x = -q[0],
    y = -q[1],
    z = -q[2],
    w = q[3];
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + y * tz - z * ty,
    v[1] + w * ty + z * tx - x * tz,
    v[2] + w * tz + x * ty - y * tx,
  ];
}
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function inertiaTimes(j: ArrayLike<number>, v: Vec3): Vec3 {
  return [
    j[0]! * v[0] + j[3]! * v[1] + j[4]! * v[2],
    j[3]! * v[0] + j[1]! * v[1] + j[5]! * v[2],
    j[4]! * v[0] + j[5]! * v[1] + j[2]! * v[2],
  ];
}
function inverseInertiaTimes(j: Float64Array, v: Vec3): Vec3 {
  const a = j[0]!,
    d = j[1]!,
    f = j[2]!,
    b = j[3]!,
    c = j[4]!,
    e = j[5]!;
  const aa = d * f - e * e,
    ab = c * e - b * f,
    ac = b * e - c * d;
  const dd = a * f - c * c,
    de = b * c - a * e,
    ff = a * d - b * b;
  const determinant = a * aa + b * ab + c * ac;
  if (!(determinant > 0)) {
    throw new Error('Detached body has singular inertia');
  }
  return [
    (aa * v[0] + ab * v[1] + ac * v[2]) / determinant,
    (ab * v[0] + dd * v[1] + de * v[2]) / determinant,
    (ac * v[0] + de * v[1] + ff * v[2]) / determinant,
  ];
}

export function buildStructuralLoads(
  manifest: DestructibleManifest,
  supported: Uint8Array,
  snapshot: StructuralLoadSnapshot,
  components: ReadonlyArray<ReadonlyArray<number>> = snapshot.bodies.map((body) => body.members),
  supportedComponents?: ReadonlyArray<ReadonlyArray<number>>,
  masses: ArrayLike<number> = manifest.fragments.map((fragment) => fragment.mass),
  worldSupported?: Uint8Array,
): StructuralLoads {
  const n = manifest.fragments.length;
  if (snapshot.wrenches.length !== n * 6 || supported.length !== n) {
    throw new Error('Invalid structural load snapshot');
  }
  if (masses.length !== n) {
    throw new Error('Invalid structural mass buffer length');
  }
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(masses[i]!) || masses[i]! < 0) {
      throw new Error('Invalid structural fragment mass');
    }
  }
  const validMember = (index: number) => Number.isInteger(index) && index >= 0 && index < n;
  for (const body of snapshot.bodies) {
    if (body.members.some((index) => !validMember(index))) {
      throw new Error('Structural load body contains an invalid fragment index');
    }
  }
  for (const component of components) {
    if (component.some((index) => !validMember(index))) {
      throw new Error('Structural component contains an invalid fragment index');
    }
  }
  for (const component of supportedComponents ?? []) {
    if (!component.length || component.some((index) => !validMember(index))) {
      throw new Error('Supported component contains an invalid fragment index');
    }
  }
  const rhs = new Float64Array(n * 6),
    participating = supported.slice(),
    clamped = new Uint8Array(n);
  const groups: Array<Array<number>> = [],
    groupOf = new Int32Array(n).fill(-1);
  const bodies = new Map<number, StructuralLoadBody>();
  for (const body of snapshot.bodies) {
    for (const member of body.members) {
      bodies.set(member, body);
    }
  }
  const anchoredGroup: Array<number> = [];
  for (let i = 0; i < n; i++) {
    if (!supported[i]!) {
      continue;
    }
    anchoredGroup.push(i);
    clamped[i] = worldSupported?.[i] ?? (manifest.fragments[i]!.anchored ? 1 : 0);
    // A runtime world bond anchors the actor where it landed. Both gravity and
    // the provider's world-frame wrench must use that actor's current frame,
    // including a one-chunk actor which never enters the free-component loop.
    const rotation = bodies.get(i)?.rotation ?? [0, 0, 0, 1];
    const gravity = inverseRotate([0, -9.81, 0], rotation);
    const offset = i * 6;
    const force = inverseRotate([snapshot.wrenches[offset]!, snapshot.wrenches[offset + 1]!, snapshot.wrenches[offset + 2]!], rotation);
    const moment = inverseRotate([snapshot.wrenches[offset + 3]!, snapshot.wrenches[offset + 4]!, snapshot.wrenches[offset + 5]!], rotation);
    for (let axis = 0; axis < 3; axis++) {
      rhs[offset + axis] = force[axis]! + masses[i]! * gravity[axis]!;
      rhs[offset + axis + 3] = moment[axis]!;
    }
  }
  if (supportedComponents) {
    groups.push(...supportedComponents.map((members) => [...members]));
  } else if (anchoredGroup.length) {
    groups.push(anchoredGroup);
  }
  for (const component of components) {
    const members = [...component]
      .filter((i) => !supported[i]!)
      .sort((a, b) => manifest.fragments[a]!.id - manifest.fragments[b]!.id);
    if (members.length < 2 || members.some((i) => !bodies.has(i))) {
      continue;
    }
    const body = bodies.get(members[0]!)!;
    const gravity = inverseRotate([0, -9.81, 0], body.rotation);
    const omega = inverseRotate(body.angularVelocity, body.rotation);
    let mass = 0;
    const center: Vec3 = [0, 0, 0],
      force: Vec3 = [0, 0, 0],
      torque: Vec3 = [0, 0, 0];
    const inertia = new Float64Array(6);
    for (const i of members) {
      const fragment = manifest.fragments[i]!;
      mass += masses[i]!;
      for (let axis = 0; axis < 3; axis++) {
        center[axis]! += masses[i]! * fragment.position[axis]!;
      }
    }
    for (let axis = 0; axis < 3; axis++) {
      center[axis]! /= mass;
    }
    for (const i of members) {
      const fragment = manifest.fragments[i]!,
        o = i * 6;
      const f = inverseRotate(
        [snapshot.wrenches[o]!, snapshot.wrenches[o + 1]!, snapshot.wrenches[o + 2]!],
        body.rotation,
      );
      const moment = inverseRotate(
        [snapshot.wrenches[o + 3]!, snapshot.wrenches[o + 4]!, snapshot.wrenches[o + 5]!],
        body.rotation,
      );
      const r = fragment.position.map((value, axis) => value - center[axis]!) as Vec3;
      for (let axis = 0; axis < 3; axis++) {
        f[axis]! += masses[i]! * gravity[axis]!;
        rhs[o + axis] = f[axis]!;
        rhs[o + axis + 3] = moment[axis]!;
        force[axis]! += f[axis]!;
      }
      const lever = cross(r, f);
      for (let axis = 0; axis < 3; axis++) {
        torque[axis]! += moment[axis]! + lever[axis]!;
      }
      const [sx, sy, sz] = fragment.size,
        m = masses[i]!;
      if (fragment.shape) {
        const j = fragment.shape.inertia,
          scale = m === fragment.mass ? 1 : m / fragment.mass;
        inertia[0]! += j[0] * scale + m * (r[1] * r[1] + r[2] * r[2]);
        inertia[1]! += j[1] * scale + m * (r[0] * r[0] + r[2] * r[2]);
        inertia[2]! += j[2] * scale + m * (r[0] * r[0] + r[1] * r[1]);
        inertia[3]! += j[3] * scale - m * r[0] * r[1];
        inertia[4]! += j[4] * scale - m * r[0] * r[2];
        inertia[5]! += j[5] * scale - m * r[1] * r[2];
      } else {
        inertia[0]! += m * ((sy * sy + sz * sz) / 12 + r[1] * r[1] + r[2] * r[2]);
        inertia[1]! += m * ((sx * sx + sz * sz) / 12 + r[0] * r[0] + r[2] * r[2]);
        inertia[2]! += m * ((sx * sx + sy * sy) / 12 + r[0] * r[0] + r[1] * r[1]);
        inertia[3]! -= m * r[0] * r[1];
        inertia[4]! -= m * r[0] * r[2];
        inertia[5]! -= m * r[1] * r[2];
      }
    }
    const gyroscopic = cross(omega, inertiaTimes(inertia, omega));
    const alpha = inverseInertiaTimes(
      inertia,
      torque.map((value, axis) => value - gyroscopic[axis]!) as Vec3,
    );
    const acceleration = force.map((value) => value / mass) as Vec3;
    for (const i of members) {
      const fragment = manifest.fragments[i]!,
        o = i * 6,
        [sx, sy, sz] = fragment.size,
        m = masses[i]!,
        scale = m === fragment.mass ? 1 : m / fragment.mass;
      const r = fragment.position.map((value, axis) => value - center[axis]!) as Vec3;
      const angular = cross(alpha, r),
        centrifugal = cross(omega, cross(omega, r));
      const ji: Vec3 = [
        (m * (sy * sy + sz * sz)) / 12,
        (m * (sx * sx + sz * sz)) / 12,
        (m * (sx * sx + sy * sy)) / 12,
      ];
      const angularMomentum = fragment.shape
        ? inertiaTimes(fragment.shape.inertia, omega)
        : (ji.map((value, axis) => value * omega[axis]!) as Vec3);
      const spin = cross(omega, angularMomentum);
      const intrinsicAcceleration = fragment.shape
        ? inertiaTimes(fragment.shape.inertia, alpha)
        : (ji.map((value, axis) => value * alpha[axis]!) as Vec3);
      const intrinsicScale = fragment.shape ? scale : 1;
      for (let axis = 0; axis < 3; axis++) {
        rhs[o + axis]! -= m * (acceleration[axis]! + angular[axis]! + centrifugal[axis]!);
        rhs[o + axis + 3]! -= (intrinsicAcceleration[axis]! + spin[axis]!) * intrinsicScale;
      }
      for (let axis = 0; axis < 6; axis++) {
        if (Math.abs(rhs[o + axis]!) < 1e-9) {
          rhs[o + axis] = 0;
        }
      }
      participating[i] = 1;
    }
    clamped[members[0]!] = 1;
    groups.push(members);
  }
  const solverGroups = new Int32Array(n).fill(-1);
  for (let group = 0; group < groups.length; group++) {
    const key = groups[group]!.reduce((a, b) =>
      manifest.fragments[a]!.id < manifest.fragments[b]!.id ? a : b,
    );
    for (const member of groups[group]!) {
      groupOf[member] = group;
      solverGroups[member] = key;
    }
  }
  return {
    clamped,
    groupOf,
    groups,
    participating,
    rhs,
    solverGroups,
    tick: snapshot.tick,
  };
}
