import type {
  BondDef,
  DestructibleManifest,
  FragmentDef,
  ScenarioId,
  Vec3,
} from '../../destruction-domain/src/index';
import { createScenario, hashManifest } from './index';

type Face = {
  neighbor?: number;
  points: Array<Vec3>;
  surface: 'exterior' | 'fracture';
};
type Cell = {
  faces: Array<Face>;
  fragment: FragmentDef;
  max: Vec3;
  member: number;
  min: Vec3;
};
type Member = { fragments: Array<FragmentDef>; max: Vec3; min: Vec3 };
export type OrganicMember = Member;
type Point2 = [number, number];
const EPSILON = 1e-8;
export const MIN_STRUCTURAL_BOND_WIDTH = 0.045;

export function isResolvedBondSection(
  area: number,
  section: Pick<NonNullable<BondDef['section']>, 'inertia1' | 'inertia2'>,
): boolean {
  const minimumArea = MIN_STRUCTURAL_BOND_WIDTH ** 2;
  return (
    area >= minimumArea && (12 * Math.min(section.inertia1, section.inertia2)) / area >= minimumArea
  );
}

export function hashOrganicManifest(manifest: Omit<DestructibleManifest, 'assetHash'>): string {
  const canonical = JSON.stringify(manifest, (_key, value: unknown) =>
    typeof value === 'number'
      ? Number(Math.abs(value) < 1 ? value.toFixed(12) : value.toPrecision(12))
      : value,
  );
  return hashManifest(JSON.parse(canonical));
}
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a));
const distanceSquared = (a: Vec3, b: Vec3): number => dot(subtract(a, b), subtract(a, b));
const mean = (points: Array<Vec3>): Vec3 => scale(points.reduce(add, [0, 0, 0]), 1 / points.length);

function random(id: number, salt: number): number {
  let n = Math.imul(id ^ salt, 0x4_5d_9f_3b);
  n = Math.imul(n ^ (n >>> 16), 0x4_5d_9f_3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4_294_967_296;
}

function orderedFace(points: Array<Vec3>, normal: Vec3): Array<Vec3> {
  const center = mean(points);
  const tangent = unit(cross(normal, Math.abs(normal[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
  const bitangent = cross(normal, tangent);
  return points.slice().sort((a, b) => {
    const da = subtract(a, center),
      db = subtract(b, center);
    return (
      Math.atan2(dot(da, bitangent), dot(da, tangent)) -
      Math.atan2(dot(db, bitangent), dot(db, tangent))
    );
  });
}

function boxFaces(min: Vec3, max: Vec3): Array<Face> {
  const faces: Array<Face> = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1]) {
      const others = [0, 1, 2].filter((value) => value !== axis);
      const normal: Vec3 = [0, 0, 0];
      normal[axis] = sign;
      const points: Array<Vec3> = [];
      for (const first of [min[others[0]!]!, max[others[0]!]!]) {
        for (const second of [min[others[1]!]!, max[others[1]!]!]) {
          const point: Vec3 = [0, 0, 0];
          point[axis] = sign < 0 ? min[axis]! : max[axis]!;
          point[others[0]!] = first;
          point[others[1]!] = second;
          points.push(point);
        }
      }
      faces.push({ points: orderedFace(points, normal), surface: 'exterior' });
    }
  }
  return faces;
}

function unique(points: Array<Vec3>): Array<Vec3> {
  const result: Array<Vec3> = [];
  for (const point of points) {
    if (!result.some((existing) => distanceSquared(existing, point) < 1e-15)) {
      result.push(point);
    }
  }
  return result;
}

function clip(faces: Array<Face>, normal: Vec3, offset: number, neighbor: number): Array<Face> {
  const vertices = faces.flatMap((face) => face.points);
  if (vertices.every((point) => dot(normal, point) - offset <= EPSILON)) {
    return faces;
  }
  const result: Array<Face> = [],
    intersections: Array<Vec3> = [];
  for (const face of faces) {
    const points: Array<Vec3> = [];
    for (let index = 0; index < face.points.length; index++) {
      const a = face.points[index]!,
        b = face.points[(index + 1) % face.points.length]!;
      const da = dot(normal, a) - offset,
        db = dot(normal, b) - offset;
      if (da <= EPSILON) {
        points.push(a);
      }
      if ((da < -EPSILON && db > EPSILON) || (da > EPSILON && db < -EPSILON)) {
        const intersection = add(a, scale(subtract(b, a), da / (da - db)));
        points.push(intersection);
        intersections.push(intersection);
      } else if (Math.abs(da) <= EPSILON) {
        intersections.push(a);
      }
    }
    const distinct = unique(points);
    if (distinct.length >= 3) {
      result.push({ ...face, points: distinct });
    }
  }
  const cap = unique(intersections);
  if (cap.length >= 3) {
    result.push({
      neighbor,
      points: orderedFace(cap, normal),
      surface: 'fracture',
    });
  }
  return result;
}

function faceNormal(face: Face): Vec3 {
  const center = mean(face.points);
  let normal: Vec3 = [0, 0, 0];
  for (let index = 0; index < face.points.length; index++) {
    normal = add(
      normal,
      cross(
        subtract(face.points[index]!, center),
        subtract(face.points[(index + 1) % face.points.length]!, center),
      ),
    );
  }
  return unit(normal);
}

function makeFragment(original: FragmentDef, faces: Array<Face>, density: number): FragmentDef {
  const origin = mean(unique(faces.flatMap((face) => face.points)));
  let volume = 0,
    first: Vec3 = [0, 0, 0];
  const second = [0, 0, 0, 0, 0, 0];
  const components: Array<[number, number]> = [
    [0, 0],
    [1, 1],
    [2, 2],
    [0, 1],
    [0, 2],
    [1, 2],
  ];
  for (const face of faces) {
    for (let index = 1; index + 1 < face.points.length; index++) {
      const points = [
        subtract(face.points[0]!, origin),
        subtract(face.points[index]!, origin),
        subtract(face.points[index + 1]!, origin),
      ];
      const tetraVolume = dot(points[0]!, cross(points[1]!, points[2]!)) / 6;
      volume += tetraVolume;
      const sum = points.reduce(add, [0, 0, 0]);
      first = add(first, scale(sum, tetraVolume / 4));
      components.forEach(([a, b], component) => {
        second[component]! +=
          (tetraVolume *
            (sum[a]! * sum[b]! +
              points.reduce((total, point) => total + point[a]! * point[b]!, 0))) /
          20;
      });
    }
  }
  if (!(volume > 1e-7)) {
    throw new Error(`Empty organic fracture cell ${original.id}`);
  }
  const localCenter = scale(first, 1 / volume),
    position = add(origin, localCenter);
  components.forEach(([a, b], index) => {
    second[index]! -= volume * localCenter[a]! * localCenter[b]!;
  });
  const inertia: NonNullable<FragmentDef['shape']>['inertia'] = [
    density * (second[1]! + second[2]!),
    density * (second[0]! + second[2]!),
    density * (second[0]! + second[1]!),
    -density * second[3]!,
    -density * second[4]!,
    -density * second[5]!,
  ];
  const worldVertices = unique(faces.flatMap((face) => face.points));
  const vertices = worldVertices.map((vertex) => subtract(vertex, position));
  const size: Vec3 = [0, 0, 0];
  for (const vertex of vertices) {
    for (let axis = 0; axis < 3; axis++) {
      size[axis] = Math.max(size[axis]!, Math.abs(vertex[axis]!) * 2);
    }
  }
  return {
    ...original,
    mass: density * volume,
    position,
    shape: {
      faces: faces.map((face) => ({
        surface: face.surface,
        vertices: face.points.map((point) =>
          worldVertices.findIndex((vertex) => distanceSquared(vertex, point) < 1e-15),
        ),
      })),
      inertia,
      vertices,
      volume,
    },
    size,
  };
}

function memberGroups(base: DestructibleManifest): Array<Member> {
  const grouped = new Map<string, Array<FragmentDef>>();
  for (const fragment of base.fragments) {
    let key: string;
    if (fragment.material === 1) {
      key = `slab:${Math.floor((fragment.id - 1) / 100)}`;
    } else if (fragment.material === 3) {
      key = `column:${fragment.aggregate}`;
    } else if (fragment.material === 0) {
      key = `parapet:${fragment.aggregate}`;
    } else {
      const alongX = fragment.size[0] > fragment.size[2];
      const axis = alongX ? 0 : 2,
        fixed = alongX ? 2 : 0;
      const bay = Math.round(fragment.position[axis] + 4.5);
      const row = Math.round((fragment.position[1] - fragment.region * 3 - 0.556) / 0.552);
      key = `facade:${fragment.region}:${fixed}:${fragment.position[fixed]}:${Math.floor(bay / 3)}:${fragment.material === 4 ? 'glass' : row}`;
    }
    const group = grouped.get(key) ?? [];
    group.push(fragment);
    grouped.set(key, group);
  }
  return [...grouped].map(([key, fragments]) => {
    const min: Vec3 = [Infinity, Infinity, Infinity],
      max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const fragment of fragments) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis]!, fragment.position[axis]! - fragment.size[axis]! / 2);
        max[axis] = Math.max(max[axis]!, fragment.position[axis]! + fragment.size[axis]! / 2);
      }
    }
    const first = fragments[0]!;
    if (key.startsWith('slab')) {
      min[0] = min[2] = -5;
      max[0] = max[2] = 5;
    } else if (key.startsWith('column')) {
      min[1] = first.region * 3 + 0.28;
      max[1] = first.region * 3 + 3.04;
    } else if (key.startsWith('parapet')) {
      min[1] = 9.28;
      max[1] = 9.85;
      const axis = first.size[0] > first.size[2] ? 0 : 2;
      min[axis] = axis === 0 ? -5 : -4.38;
      max[axis] = axis === 0 ? 5 : 4.38;
    } else {
      const axis = first.size[0] > first.size[2] ? 0 : 2;
      min[axis] -= 0.006;
      max[axis] += 0.006;
      const lowerRow = Math.round((min[1] - first.region * 3 - 0.286) / 0.552);
      const upperRow = Math.round((max[1] - first.region * 3 - 0.826) / 0.552);
      min[1] = first.region * 3 + 0.28 + lowerRow * 0.552;
      max[1] = first.region * 3 + 0.28 + (upperRow + 1) * 0.552;
    }
    return { fragments, max, min };
  });
}

function fractureMember(member: Member, memberId: number, density: number): Array<Cell> {
  const seeds = member.fragments.map(
    (fragment) =>
      fragment.position.map((value, axis) => {
        const jitter =
          (random(fragment.id, [0x3c_9e_12, 0x71_db_e1, 0x1_95_f7][axis]!) - 0.5) *
          0.86 *
          fragment.size[axis]!;
        const margin = (member.max[axis]! - member.min[axis]!) * 0.02;
        return Math.max(
          member.min[axis]! + margin,
          Math.min(member.max[axis]! - margin, value + jitter),
        );
      }) as Vec3,
  );
  return member.fragments.map((original, index) => {
    let faces = boxFaces(member.min, member.max);
    const others = seeds
      .map((seed, other) => ({
        distance: distanceSquared(seed, seeds[index]!),
        other,
        seed,
      }))
      .filter(({ other }) => other !== index)
      .sort((a, b) => a.distance - b.distance || a.other - b.other);
    for (const { other, seed } of others) {
      const normal = unit(subtract(seed, seeds[index]!));
      const midpoint = scale(add(seed, seeds[index]!), 0.5);
      faces = clip(faces, normal, dot(normal, midpoint), member.fragments[other]!.id);
    }
    faces = faces.filter((face) => {
      const a = face.points[0]!;
      return face.points.some(
        (point, pointIndex) =>
          pointIndex > 1 &&
          Math.hypot(...cross(subtract(face.points[1]!, a), subtract(point, a))) > 1e-10,
      );
    });
    const fragment = makeFragment(original, faces, density);
    const min: Vec3 = [Infinity, Infinity, Infinity],
      max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const face of faces) {
      for (const point of face.points) {
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis]!, point[axis]!);
          max[axis] = Math.max(max[axis]!, point[axis]!);
        }
      }
    }
    return { faces, fragment, max, member: memberId, min };
  });
}

function polygonSection(
  points: Array<Vec3>,
  normal: Vec3,
): { area: number; section: NonNullable<BondDef['section']> } {
  const origin = mean(points);
  const u = unit(cross(normal, Math.abs(normal[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
  const v = cross(normal, u);
  const local = points.map((point): Point2 => [
    dot(subtract(point, origin), u),
    dot(subtract(point, origin), v),
  ]);
  let signedArea = 0,
    cx = 0,
    cy = 0,
    xx = 0,
    yy = 0,
    xy = 0;
  for (let index = 0; index < local.length; index++) {
    const [ax, ay] = local[index]!,
      [bx, by] = local[(index + 1) % local.length]!;
    const d = ax * by - bx * ay;
    signedArea += d / 2;
    cx += ((ax + bx) * d) / 6;
    cy += ((ay + by) * d) / 6;
    xx += ((ax * ax + ax * bx + bx * bx) * d) / 12;
    yy += ((ay * ay + ay * by + by * by) * d) / 12;
    xy += ((2 * ax * ay + ax * by + bx * ay + 2 * bx * by) * d) / 24;
  }
  cx /= signedArea;
  cy /= signedArea;
  const sign = Math.sign(signedArea),
    area = Math.abs(signedArea);
  xx = xx * sign - area * cx * cx;
  yy = yy * sign - area * cy * cy;
  xy = xy * sign - area * cx * cy;
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy),
    cosine = Math.cos(angle),
    sine = Math.sin(angle);
  const tangent1 = add(scale(u, cosine), scale(v, sine));
  const tangent2 = cross(normal, tangent1);
  const point = add(origin, add(scale(u, cx), scale(v, cy)));
  const variance1 = cosine * cosine * xx + 2 * cosine * sine * xy + sine * sine * yy;
  const variance2 = sine * sine * xx - 2 * cosine * sine * xy + cosine * cosine * yy;
  const inertia1 = Math.max(variance2, 1e-16),
    inertia2 = Math.max(variance1, 1e-16);
  let extent1 = 0,
    extent2 = 0,
    radius = 0;
  for (const vertex of points) {
    const offset = subtract(vertex, point);
    extent1 = Math.max(extent1, Math.abs(dot(offset, tangent1)));
    extent2 = Math.max(extent2, Math.abs(dot(offset, tangent2)));
    radius = Math.max(radius, Math.hypot(...offset));
  }
  const polarInertia = inertia1 + inertia2;
  return {
    area,
    section: {
      inertia1,
      inertia2,
      point,
      polarInertia,
      sectionModulus1: inertia1 / Math.max(extent2, 1e-10),
      sectionModulus2: inertia2 / Math.max(extent1, 1e-10),
      tangent1,
      tangent2,
      torsionModulus: polarInertia / Math.max(radius, 1e-10),
    },
  };
}

function polygonIntersection(a: Face, b: Face, normal: Vec3): Array<Vec3> {
  const origin = mean(a.points);
  const u = unit(cross(normal, Math.abs(normal[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
  const v = cross(normal, u);
  const project = (point: Vec3): Point2 => [
    dot(subtract(point, origin), u),
    dot(subtract(point, origin), v),
  ];
  let subject = orderedFace(a.points, normal).map(project);
  const boundary = orderedFace(b.points, normal).map(project);
  for (let index = 0; index < boundary.length && subject.length; index++) {
    const start = boundary[index]!,
      end = boundary[(index + 1) % boundary.length]!;
    const side = (point: Point2) =>
      (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0]);
    const next: Array<Point2> = [];
    for (let vertex = 0; vertex < subject.length; vertex++) {
      const p = subject[vertex]!,
        q = subject[(vertex + 1) % subject.length]!,
        dp = side(p),
        dq = side(q);
      if (dp >= -EPSILON) {
        next.push(p);
      }
      if ((dp < -EPSILON && dq > EPSILON) || (dp > EPSILON && dq < -EPSILON)) {
        const t = dp / (dp - dq);
        next.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
    subject = next;
  }
  const planeOffset = dot(subtract(mean(b.points), origin), normal) / 2;
  return unique(
    subject.map(([x, y]) =>
      add(origin, add(scale(normal, planeOffset), add(scale(u, x), scale(v, y)))),
    ),
  );
}

function authorBonds(cells: Array<Cell>, base: DestructibleManifest): Array<BondDef> {
  const bonds: Array<BondDef> = [],
    byId = new Map(cells.map((cell) => [cell.fragment.id, cell]));
  const append = (a: FragmentDef, b: FragmentDef, points: Array<Vec3>, normal: Vec3) => {
    if (points.length < 3) {
      return;
    }
    const { area, section } = polygonSection(points, normal);
    if (!isResolvedBondSection(area, section)) {
      return;
    }
    const strength = Math.min(
      base.materials.find((material) => material.id === a.material)!.strength,
      base.materials.find((material) => material.id === b.material)!.strength,
    );
    const variance = 0.93 + ((((a.id * 73_856_093) ^ (b.id * 19_349_663)) >>> 0) % 101) / 1000;
    bonds.push({
      a: a.id,
      area,
      b: b.id,
      id: 0,
      normal,
      section,
      strength: strength * variance,
    });
  };
  for (const cell of cells) {
    for (const face of cell.faces) {
      if (face.neighbor !== undefined && face.neighbor > cell.fragment.id) {
        append(cell.fragment, byId.get(face.neighbor)!.fragment, face.points, faceNormal(face));
      }
    }
  }
  const surfaces = cells.map((cell) =>
    cell.faces
      .filter((face) => face.surface === 'exterior')
      .map((face) => ({ face, normal: faceNormal(face) })),
  );
  const buckets = new Map<string, Array<number>>();
  const oversized: Array<number> = [];
  const keysFor = (cell: Cell): Array<string> | null => {
    const low = cell.min.map((value) => Math.floor((value - 0.035) / 2));
    const high = cell.max.map((value) => Math.floor((value + 0.035) / 2));
    if ((high[0]! - low[0]! + 1) * (high[1]! - low[1]! + 1) * (high[2]! - low[2]! + 1) > 4096) {
      return null;
    }
    const keys: Array<string> = [];
    for (let x = low[0]!; x <= high[0]!; x++) {
      for (let y = low[1]!; y <= high[1]!; y++) {
        for (let z = low[2]!; z <= high[2]!; z++) {
          keys.push(`${x}:${y}:${z}`);
        }
      }
    }
    return keys;
  };
  const cellKeys = cells.map(keysFor);
  for (let index = 0; index < cells.length; index++) {
    const keys = cellKeys[index];
    if (!keys) {
      oversized.push(index);
      continue;
    }
    for (const key of keys) {
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(index);
      } else {
        buckets.set(key, [index]);
      }
    }
  }
  for (let a = 0; a < cells.length; a++) {
    const keys = cellKeys[a];
    const candidates = keys ? new Set(oversized) : new Set(cells.map((_, index) => index));
    for (const key of keys ?? []) {
      for (const index of buckets.get(key) ?? []) {
        candidates.add(index);
      }
    }
    for (const b of [...candidates].filter((index) => index > a).sort((x, y) => x - y)) {
      const ca = cells[a]!,
        cb = cells[b]!;
      if (
        ca.member === cb.member ||
        [0, 1, 2].some(
          (axis) => ca.max[axis]! < cb.min[axis]! - 0.035 || cb.max[axis]! < ca.min[axis]! - 0.035,
        )
      ) {
        continue;
      }
      let best: { area: number; normal: Vec3; points: Array<Vec3> } | undefined;
      for (const { face: fa, normal: na } of surfaces[a]!) {
        for (const { face: fb, normal: nb } of surfaces[b]!) {
          if (
            dot(na, nb) > -0.999999 ||
            Math.abs(dot(na, subtract(fb.points[0]!, fa.points[0]!))) > 0.035
          ) {
            continue;
          }
          const points = polygonIntersection(fa, fb, na);
          if (points.length < 3) {
            continue;
          }
          const area = polygonSection(points, na).area;
          if (area > (best?.area ?? 1e-6)) {
            best = { area, normal: na, points };
          }
        }
      }
      if (best) {
        append(ca.fragment, cb.fragment, best.points, best.normal);
      }
    }
  }
  bonds.sort((a, b) => a.a - b.a || a.b - b.b);
  bonds.forEach((bond, index) => {
    bond.id = index + 1;
  });
  return bonds;
}

export function fractureBoxMembers(
  base: Omit<DestructibleManifest, 'assetHash'>,
  members: Array<OrganicMember>,
): DestructibleManifest {
  const source = { ...base, assetHash: '' };
  const cells = members.flatMap((member, index) =>
    fractureMember(
      member,
      index,
      source.materials.find((material) => material.id === member.fragments[0]!.material)!.density,
    ),
  );
  cells.sort((a, b) => a.fragment.id - b.fragment.id);
  const manifest = {
    ...base,
    bonds: authorBonds(cells, source),
    fragments: cells.map((cell) => cell.fragment),
  };
  return { ...manifest, assetHash: hashOrganicManifest(manifest) };
}

export function createOrganicScenario(scenario: ScenarioId): DestructibleManifest {
  const base = createScenario(scenario);
  if (scenario !== 'building') {
    return base;
  }
  const members = memberGroups(base);
  const cells = members.flatMap((member, index) =>
    fractureMember(
      member,
      index,
      base.materials.find((material) => material.id === member.fragments[0]!.material)!.density,
    ),
  );
  cells.sort((a, b) => a.fragment.id - b.fragment.id);
  const { assetHash: _, ...content } = base;
  const manifest = {
    ...content,
    bonds: authorBonds(cells, base),
    fragments: cells.map((cell) => cell.fragment),
    name: 'Meridian / fractured concrete',
  };
  return { ...manifest, assetHash: hashOrganicManifest(manifest) };
}
