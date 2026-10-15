import {
  BondState,
  type BondDef,
  type DestructibleManifest,
  type Vec3,
} from '../../destruction-domain/src/index';

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const keyFor = (a: number, b: number): string => `${Math.min(a, b)}:${Math.max(a, b)}`;

/** Sum interface polygons using the parallel-axis theorem, retaining their principal section. */
export function combineInterfaces(parts: ReadonlyArray<BondDef>, a: number, b: number, id: number): BondDef {
  const first = parts[0]!;
  const area = parts.reduce((sum, part) => sum + part.area, 0);
  const centroid: Vec3 = [0, 0, 0];
  for (const part of parts) {
    const point = part.centroid ?? part.section!.point;
    for (let axis = 0; axis < 3; axis++) centroid[axis]! += point[axis]! * part.area / area;
  }
  const normal = [...first.normal] as Vec3;
  const tangent1 = first.section!.tangent1;
  const tangent2 = cross(normal, tangent1);
  let xx = 0, yy = 0, xy = 0;
  for (const part of parts) {
    const section = part.section!;
    const offset = section.point.map((value, axis) => value - centroid[axis]!) as Vec3;
    const x = dot(offset, tangent1), y = dot(offset, tangent2);
    const u1 = dot(section.tangent1, tangent1), u2 = dot(section.tangent1, tangent2);
    const v1 = dot(section.tangent2, tangent1), v2 = dot(section.tangent2, tangent2);
    xx += section.inertia2 * u1 * u1 + section.inertia1 * v1 * v1 + part.area * x * x;
    yy += section.inertia2 * u2 * u2 + section.inertia1 * v2 * v2 + part.area * y * y;
    xy += section.inertia2 * u1 * u2 + section.inertia1 * v1 * v2 + part.area * x * y;
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy), c = Math.cos(angle), s = Math.sin(angle);
  const u = tangent1.map((value, axis) => c * value + s * tangent2[axis]!) as Vec3;
  const v = cross(normal, u);
  const inertia1 = Math.max(1e-14, s * s * xx - 2 * s * c * xy + c * c * yy);
  const inertia2 = Math.max(1e-14, c * c * xx + 2 * s * c * xy + s * s * yy);
  let extent1 = 1e-9, extent2 = 1e-9, radius = 1e-9;
  for (const part of parts) {
    const section = part.section!;
    const offset = section.point.map((value, axis) => value - centroid[axis]!) as Vec3;
    const width = section.inertia2 / section.sectionModulus2;
    const height = section.inertia1 / section.sectionModulus1;
    const x = Math.abs(dot(offset, u)) + Math.abs(dot(section.tangent1, u)) * width + Math.abs(dot(section.tangent2, u)) * height;
    const y = Math.abs(dot(offset, v)) + Math.abs(dot(section.tangent1, v)) * width + Math.abs(dot(section.tangent2, v)) * height;
    extent1 = Math.max(extent1, x); extent2 = Math.max(extent2, y); radius = Math.max(radius, Math.hypot(x, y));
  }
  return {
    a, b, id, area, centroid, normal,
    joint: parts.some((part) => part.joint),
    strength: parts.reduce((sum, part) => sum + part.strength * part.area, 0) / area,
    section: { point: centroid, tangent1: u, tangent2: v, inertia1, inertia2,
      polarInertia: inertia1 + inertia2, sectionModulus1: inertia1 / extent2,
      sectionModulus2: inertia2 / extent1, torsionModulus: (inertia1 + inertia2) / radius },
  };
}

export interface InheritedBond {
  bond: BondDef;
  damage: number;
  state: BondState;
}

/** Activate dormant authored polygon patches after one or more support chunks demote. */
export function inheritChildBonds(
  manifest: DestructibleManifest,
  parents: Int32Array,
  before: Uint8Array,
  after: Uint8Array,
  damage: Float32Array,
  states: Uint8Array,
): Array<InheritedBond> {
  const indices = new Map(manifest.fragments.map((fragment, index) => [fragment.id, index]));
  const ancestor = (id: number, active: Uint8Array): number => {
    if (id === -1) return -1;
    let index = indices.get(id) ?? -1;
    while (index >= 0) {
      if (active[index]) return manifest.fragments[index]!.id;
      index = parents[index]!;
    }
    return -2;
  };
  const oldPairs = new Map(manifest.bonds.map((bond, index) => [keyFor(bond.a, bond.b), index]));
  const groups = new Map<string, { a: number; b: number; parts: Array<BondDef>; damage: number; state: BondState; parentBond?: BondDef }>();
  for (const patch of manifest.subsupportBonds ?? []) {
    let a = ancestor(patch.a, after), b = ancestor(patch.b, after);
    if (a < 0 || b === -2 || a === b) continue;
    const ai = indices.get(a)!, bi = indices.get(b);
    if (before[ai] && (bi === undefined || before[bi])) continue;
    const oldA = ancestor(patch.a, before), oldB = ancestor(patch.b, before);
    if (oldA === -2 || oldB === -2) continue;
    const oldBond = oldA === oldB ? undefined : oldPairs.get(keyFor(oldA, oldB));
    // There is no new connection where the original support graph had no interface.
    if (oldA !== oldB && oldBond === undefined) continue;
    let part = patch;
    if (b !== -1 && a > b) {
      [a, b] = [b, a];
      part = { ...patch, normal: patch.normal.map((value) => -value) as Vec3 };
    }
    const key = keyFor(a, b);
    let group = groups.get(key);
    if (!group) {
      group = { a, b, parts: [], parentBond: oldBond === undefined ? undefined : manifest.bonds[oldBond], damage: oldBond === undefined ? 0 : damage[oldBond]!, state: oldBond === undefined ? BondState.Intact : states[oldBond]! };
      groups.set(key, group);
    }
    group.parts.push(oldBond === undefined ? part : { ...part, strength: manifest.bonds[oldBond]!.strength });
  }
  let id = manifest.bonds.reduce((maximum, bond) => Math.max(maximum, bond.id), 0) + 1;
  return [...groups.values()].sort((a, b) => a.a - b.a || a.b - b.b).map((group) => ({
    bond: { ...combineInterfaces(group.parts, group.a, group.b, id++), ...(group.parentBond ? { parentBond: group.parentBond.id, areaFraction: group.parts.reduce((area, part) => area + part.area, 0) / group.parentBond.area } : {}) }, damage: group.damage, state: group.state,
  }));
}
