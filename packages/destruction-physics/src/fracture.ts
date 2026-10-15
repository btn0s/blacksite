import {
  MAX_FRACTURE_GENERATION,
  MAX_SECONDARY_DEFINITION_BYTES,
  type FragmentDef,
  type SecondaryFragmentDef,
  type Vec3,
} from '../../destruction-domain/src/index';

export const MIN_FRACTURE_VOLUME = 0.001;
export const MIN_FRACTURE_WIDTH = 0.055;
const MIN_CHILD_VOLUME = 0.000125;
const MIN_CHILD_WIDTH = 0.035;
export const MIN_IMPACT_VOLUME = 1e-7;
export const MIN_IMPACT_WIDTH = 0.004;
const MIN_IMPACT_OPENING = 0.015;
const CRATER_APEX = 3;
const CRATER_ALIGNED = 0.9;
const CRATER_FLOOR = 1.25;
const CRATER_GRAZING = 0.35;
const CRATER_OPENING_FIT = 0.9;
const CRATER_REPEAT_DEPTH = 1.25;
const CRATER_VOLUME_LIMIT = 4;
const MAX_VERTICES = 64;
const MAX_FACES = 128;
const MAX_HULL_SIZE = 32;
const WIDEST_COORDINATE = -2.2250738585072014e-308;
const MIN_EDGE = 1e-6;
const EPSILON = 1e-9;
const encoder = new TextEncoder();
type Face = { points: Array<Vec3>; surface: 'exterior' | 'fracture' };
type Plane = { normal: Vec3; offset: number };
type Cell = { faces: Array<Face>; fragment: FragmentDef };
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, n: number): Vec3 => [a[0] * n, a[1] * n, a[2] * n];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a));
const same = (a: Vec3, b: Vec3): boolean => Math.hypot(...sub(a, b)) <= EPSILON;
const mean = (points: Array<Vec3>): Vec3 => scale(points.reduce(add, [0, 0, 0]), 1 / points.length);
const unique = (points: Array<Vec3>): Array<Vec3> => {
  const result: Array<Vec3> = [];
  for (const point of points) {
    if (!result.some((other) => same(point, other))) {
      result.push(point);
    }
  }
  return result;
};

function normal(face: Face): Vec3 {
  let area: Vec3 = [0, 0, 0];
  for (let i = 1; i + 1 < face.points.length; i++) {
    area = add(
      area,
      cross(sub(face.points[i]!, face.points[0]!), sub(face.points[i + 1]!, face.points[0]!)),
    );
  }
  return unit(area);
}

function ordered(points: Array<Vec3>, direction: Vec3): Array<Vec3> {
  const center = mean(points);
  const tangent = unit(cross(direction, Math.abs(direction[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
  const bitangent = cross(direction, tangent);
  return points.slice().sort((a, b) => {
    const da = sub(a, center),
      db = sub(b, center);
    return (
      Math.atan2(dot(da, bitangent), dot(da, tangent)) -
      Math.atan2(dot(db, bitangent), dot(db, tangent))
    );
  });
}

function boxFaces(size: Vec3): Array<Face> {
  const result: Array<Face> = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1]) {
      const others = [0, 1, 2].filter((value) => value !== axis);
      const direction: Vec3 = [0, 0, 0];
      direction[axis] = sign;
      const points: Array<Vec3> = [];
      for (const first of [-1, 1]) {
        for (const second of [-1, 1]) {
          const point: Vec3 = [0, 0, 0];
          point[axis] = (sign * size[axis]!) / 2;
          point[others[0]!] = (first * size[others[0]!]!) / 2;
          point[others[1]!] = (second * size[others[1]!]!) / 2;
          points.push(point);
        }
      }
      result.push({ points: ordered(points, direction), surface: 'exterior' });
    }
  }
  return result;
}

function cut(faces: Array<Face>, direction: Vec3, offset: number): [Array<Face>, Array<Face>] {
  const halves: [Array<Face>, Array<Face>] = [[], []];
  const intersections: Array<Vec3> = [];
  for (const face of faces) {
    const polygons: [Array<Vec3>, Array<Vec3>] = [[], []];
    for (let i = 0; i < face.points.length; i++) {
      const a = face.points[i]!,
        b = face.points[(i + 1) % face.points.length]!;
      const da = dot(direction, a) - offset,
        db = dot(direction, b) - offset;
      if (Math.abs(da) <= EPSILON) {
        const onPlane = sub(a, scale(direction, da));
        polygons[0].push(onPlane);
        polygons[1].push(onPlane);
        intersections.push(onPlane);
      } else {
        polygons[da < 0 ? 0 : 1].push(a);
      }
      if ((da < -EPSILON && db > EPSILON) || (da > EPSILON && db < -EPSILON)) {
        const intersection = add(a, scale(sub(b, a), da / (da - db)));
        polygons[0].push(intersection);
        polygons[1].push(intersection);
        intersections.push(intersection);
      }
    }
    for (let side = 0; side < 2; side++) {
      const points = unique(polygons[side]!);
      if (points.length >= 3) {
        halves[side]!.push({ points, surface: face.surface });
      }
    }
  }
  const cap = unique(intersections);
  if (cap.length >= 3) {
    const points = ordered(cap, direction);
    halves[0].push({ points, surface: 'fracture' });
    halves[1].push({ points: points.slice().reverse(), surface: 'fracture' });
  }
  return halves;
}

function integrate(
  original: FragmentDef,
  faces: Array<Face>,
  density: number,
  minimumVolume = MIN_CHILD_VOLUME,
): FragmentDef | undefined {
  const vertices = unique(faces.flatMap((face) => face.points));
  if (vertices.length < 4 || vertices.length > MAX_VERTICES || faces.length > MAX_FACES) {
    return;
  }
  const origin = mean(vertices);
  let volume = 0,
    first: Vec3 = [0, 0, 0];
  const second: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  const components = [
    [0, 0],
    [1, 1],
    [2, 2],
    [0, 1],
    [0, 2],
    [1, 2],
  ] as const;
  for (const face of faces) {
    for (let i = 1; i + 1 < face.points.length; i++) {
      const points: [Vec3, Vec3, Vec3] = [
        sub(face.points[0]!, origin),
        sub(face.points[i]!, origin),
        sub(face.points[i + 1]!, origin),
      ];
      const tetraVolume = dot(points[0], cross(points[1], points[2])) / 6;
      volume += tetraVolume;
      const sum = points.reduce(add, [0, 0, 0]);
      first = add(first, scale(sum, tetraVolume / 4));
      components.forEach(([a, b], component) => {
        second[component]! +=
          (tetraVolume *
            (sum[a] * sum[b] + points.reduce((total, point) => total + point[a] * point[b], 0))) /
          20;
      });
    }
  }
  if (!(volume >= minimumVolume)) {
    return;
  }
  const localCenter = scale(first, 1 / volume),
    position = add(origin, localCenter);
  components.forEach(([a, b], i) => {
    second[i]! -= volume * localCenter[a] * localCenter[b];
  });
  const inertia: NonNullable<FragmentDef['shape']>['inertia'] = [
    density * (second[1] + second[2]),
    density * (second[0] + second[2]),
    density * (second[0] + second[1]),
    -density * second[3],
    -density * second[4],
    -density * second[5],
  ];
  const [xx, yy, zz, xy, xz, yz] = inertia;
  const determinant =
    xx * (yy * zz - yz * yz) - xy * (xy * zz - xz * yz) + xz * (xy * yz - xz * yy);
  if (!inertia.every(Number.isFinite) || xx <= 0 || xx * yy - xy * xy <= 0 || determinant <= 0) {
    return;
  }
  const centered = vertices.map((point) => sub(point, position));
  const size: Vec3 = [0, 0, 0];
  for (const point of centered) {
    for (let axis = 0; axis < 3; axis++) {
      size[axis] = Math.max(size[axis]!, 2 * Math.abs(point[axis]!));
    }
  }
  return {
    ...original,
    anchored: false,
    id: 0,
    mass: density * volume,
    position,
    shape: {
      faces: faces.map((face) => ({
        surface: face.surface,
        vertices: face.points.map((point) => vertices.findIndex((vertex) => same(vertex, point))),
      })),
      inertia,
      vertices: centered,
      volume,
    },
    size,
  };
}

function hull(fragment: FragmentDef): Array<Face> {
  return fragment.shape
    ? fragment.shape.faces.map((face) => ({
        points: face.vertices.map((index) => fragment.shape!.vertices[index]!),
        surface: face.surface,
      }))
    : boxFaces(fragment.size);
}

function halfSpace(direction: Vec3, origin: Vec3, offset: number): Plane {
  const length = Math.hypot(...direction);
  return {
    normal: scale(direction, 1 / length),
    offset: (dot(direction, origin) + offset) / length,
  };
}

function flip(plane: Plane): Plane {
  return { normal: scale(plane.normal, -1), offset: -plane.offset };
}

function clip(faces: Array<Face>, planes: Array<Plane>): Array<Face> {
  let result = faces;
  for (const plane of planes) {
    let low = Infinity;
    let high = -Infinity;
    for (const face of result) {
      for (const point of face.points) {
        const distance = dot(plane.normal, point) - plane.offset;
        low = Math.min(low, distance);
        high = Math.max(high, distance);
      }
    }
    if (high <= EPSILON) {
      continue;
    }
    if (low >= -EPSILON) {
      return [];
    }
    result = cut(result, plane.normal, plane.offset)[0];
  }
  return result;
}

/** Collision-only inward face offsets; rendered volume and authored mass properties stay intact. */
export function insetCollisionGeometry(fragment: FragmentDef, maximumInset: number): {
  vertices: Float32Array;
  /** Homothety about the authored COM wholly inside the inset collision hull. */
  safeScale: number;
} {
  const faces = hull(fragment);
  const points = unique(faces.flatMap((face) => face.points));
  let safeScale = 1;
  const planes = faces.map((face) => {
    const direction = normal(face);
    const projections = points.map((point) => dot(direction, point));
    const offset = dot(direction, face.points[0]!);
    // The 1% total width gap matches cuboid collision proxies. Limit each face
    // offset by the section inset and its distance to the interior mass centre,
    // so a thin or asymmetric chip keeps a non-degenerate collision hull.
    const inset = Math.min(maximumInset, (Math.max(...projections) - Math.min(...projections)) * 0.005, offset * 0.25);
    safeScale = Math.min(safeScale, (offset - inset) / offset);
    return { normal: direction, offset: offset - inset };
  });
  return { vertices: new Float32Array(unique(clip(faces, planes).flatMap((face) => face.points)).flat()), safeScale };
}

function definitionBytes(fragment: FragmentDef): number {
  const definition: SecondaryFragmentDef = {
    ...fragment,
    generation: MAX_FRACTURE_GENERATION,
    id: Number.MAX_SAFE_INTEGER,
    parentId: Number.MAX_SAFE_INTEGER,
    position: [WIDEST_COORDINATE, WIDEST_COORDINATE, WIDEST_COORDINATE],
    rootId: Number.MAX_SAFE_INTEGER,
  };
  return encoder.encode(JSON.stringify(definition)).byteLength;
}

function wellFormed(fragment: FragmentDef): boolean {
  const shape = fragment.shape;
  const size = fragment.size;
  if (
    !shape ||
    !(fragment.mass > 0 && fragment.mass <= 1e8) ||
    !fragment.position.every(Number.isFinite) ||
    !size.every((value) => value > 0 && value <= MAX_HULL_SIZE) ||
    !(shape.volume > 0 && shape.volume <= size[0] * size[1] * size[2] * 1.00001) ||
    !shape.inertia.every((value) => Number.isFinite(value) && Math.abs(value) <= 1e12) ||
    shape.vertices.length < 4 ||
    shape.vertices.length > MAX_VERTICES ||
    shape.faces.length < 4 ||
    shape.faces.length > MAX_FACES
  ) {
    return false;
  }
  const [xx, yy, zz, xy, xz, yz] = shape.inertia;
  const determinant = xx * yy * zz + 2 * xy * xz * yz - xx * yz * yz - yy * xz * xz - zz * xy * xy;
  if (
    !(xx > 0 && yy > 0 && zz > 0 && xx * yy > xy * xy && determinant > 0) ||
    Math.max(xx, yy, zz) > fragment.mass * dot(size, size)
  ) {
    return false;
  }
  const vertices = shape.vertices;
  for (let axis = 0; axis < 3; axis++) {
    const values = vertices.map((vertex) => vertex[axis]!);
    if (
      !values.every((value) => Number.isFinite(value) && Math.abs(value) <= size[axis]! + 1e-6) ||
      Math.max(...values) - Math.min(...values) > size[axis]! + 1e-6
    ) {
      return false;
    }
  }
  const tolerance = 1e-6 * Math.max(1, ...size);
  const edges = new Map<string, { count: number; orientation: number }>();
  let volume = 0;
  let first: Vec3 = [0, 0, 0];
  for (const face of shape.faces) {
    const indices = face.vertices;
    if (
      indices.length < 3 ||
      indices.length > MAX_VERTICES ||
      !indices.every((index) => Number.isInteger(index) && index >= 0 && index < vertices.length) ||
      new Set(indices).size !== indices.length ||
      (face.surface !== 'exterior' && face.surface !== 'fracture')
    ) {
      return false;
    }
    const points = indices.map((index) => vertices[index]!);
    let area: Vec3 = [0, 0, 0];
    for (let i = 1; i + 1 < points.length; i++) {
      area = add(area, cross(sub(points[i]!, points[0]!), sub(points[i + 1]!, points[0]!)));
      const tetra = dot(points[0]!, cross(points[i]!, points[i + 1]!)) / 6;
      volume += tetra;
      first = add(first, scale(add(add(points[0]!, points[i]!), points[i + 1]!), tetra / 4));
    }
    const length = Math.hypot(...area);
    if (!(length > 1e-12)) {
      return false;
    }
    const direction = scale(area, 1 / length);
    if (
      !points.every((point) => Math.abs(dot(direction, sub(point, points[0]!))) <= tolerance) ||
      !vertices.every((point) => dot(direction, sub(point, points[0]!)) <= tolerance)
    ) {
      return false;
    }
    indices.forEach((a, i) => {
      const b = indices[(i + 1) % indices.length]!;
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      const edge = edges.get(key) ?? { count: 0, orientation: 0 };
      edge.count++;
      edge.orientation += a < b ? 1 : -1;
      edges.set(key, edge);
    });
  }
  return (
    [...edges.values()].every((edge) => edge.count === 2 && edge.orientation === 0) &&
    volume > 0 &&
    Math.abs(volume - shape.volume) <= Math.max(1e-8, shape.volume * 1e-5) &&
    Math.hypot(...first) / volume <= tolerance * 10 &&
    definitionBytes(fragment) <= MAX_SECONDARY_DEFINITION_BYTES
  );
}

function piece(parent: FragmentDef, faces: Array<Face>, density: number): FragmentDef | undefined {
  if (faces.length < 4) {
    return;
  }
  const fragment = integrate(parent, faces, density, MIN_IMPACT_VOLUME);
  if (!fragment || !resolvedWidth(faces, MIN_IMPACT_WIDTH) || !wellFormed(fragment)) {
    return;
  }
  return fragment;
}

function openingFit(face: Face, normalVector: Vec3, origin: Vec3, u: Vec3, v: Vec3): number {
  const center = mean(face.points);
  let fit = Infinity;
  face.points.forEach((point, index) => {
    const next = face.points[(index + 1) % face.points.length]!;
    const edge = cross(sub(next, point), normalVector);
    const length = Math.hypot(...edge);
    if (length <= MIN_EDGE) {
      return;
    }
    const outward = scale(edge, (dot(edge, sub(point, center)) < 0 ? -1 : 1) / length);
    fit = Math.min(
      fit,
      dot(outward, sub(point, origin)) / (Math.abs(dot(outward, u)) + Math.abs(dot(outward, v))),
    );
  });
  return fit;
}

export function crossSectionArea(fragment: FragmentDef, normal: Vec3, offset: number): number {
  const length = Math.hypot(...normal);
  if (![...normal, offset].every(Number.isFinite) || !(length > EPSILON)) {
    return 0;
  }
  const direction = scale(normal, 1 / length);
  const level = offset / length;
  const points: Array<Vec3> = [];
  for (const face of hull(fragment)) {
    for (let i = 0; i < face.points.length; i++) {
      const a = face.points[i]!;
      const b = face.points[(i + 1) % face.points.length]!;
      const da = dot(direction, a) - level;
      const db = dot(direction, b) - level;
      if (Math.abs(da) <= EPSILON) {
        points.push(a);
      } else if ((da < -EPSILON && db > EPSILON) || (da > EPSILON && db < -EPSILON)) {
        points.push(add(a, scale(sub(b, a), da / (da - db))));
      }
    }
  }
  const section = unique(points);
  if (section.length < 3) {
    return 0;
  }
  const polygon = ordered(section, direction);
  const center = mean(polygon);
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    area += dot(
      direction,
      cross(sub(polygon[i]!, center), sub(polygon[(i + 1) % polygon.length]!, center)),
    );
  }
  return Math.abs(area) / 2;
}

export function fractureFragmentAtImpact(
  parent: FragmentDef,
  point: Vec3,
  direction: Vec3,
  radius: number,
  depth: number,
  seed: number,
): { axis: Vec3; detached: Array<FragmentDef>; retained: Array<FragmentDef> } | undefined {
  if (
    ![...point, ...direction, radius, depth, parent.mass, seed].every(Number.isFinite) ||
    radius < MIN_IMPACT_WIDTH ||
    depth < MIN_IMPACT_WIDTH ||
    Math.hypot(...direction) < EPSILON ||
    parent.mass <= 0 ||
    parent.size.some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    return;
  }
  if (
    parent.shape &&
    (parent.shape.vertices.length > MAX_VERTICES ||
      parent.shape.faces.length > MAX_FACES ||
      parent.shape.vertices.some((vertex) => !vertex.every(Number.isFinite)) ||
      parent.shape.faces.some(
        (face) =>
          face.vertices.length < 3 ||
          face.vertices.some((index) => !Number.isInteger(index) || !parent.shape!.vertices[index]),
      ))
  ) {
    return;
  }
  const source = hull(parent);
  const initial = integrate(parent, source, 1, MIN_IMPACT_VOLUME);
  if (!initial || !resolvedWidth(source, MIN_IMPACT_WIDTH)) {
    return;
  }
  const density = parent.mass / initial.shape!.volume;
  const tolerance = Math.max(EPSILON, Math.max(...initial.size) * 1e-6);
  const ray = unit(direction);
  const bounds = source.map((face) => {
    const outward = normal(face);
    return { face, normal: outward, offset: dot(outward, mean(face.points)) };
  });
  if (bounds.some((bound) => !bound.normal.every(Number.isFinite))) {
    return;
  }
  const entries: Array<{ approach: number; bound: (typeof bounds)[number]; distance: number }> = [];
  let exit = Infinity;
  for (const bound of bounds) {
    const approach = dot(bound.normal, ray);
    const distance = dot(bound.normal, point) - bound.offset;
    if (Math.abs(approach) <= EPSILON) {
      if (distance > tolerance) {
        return;
      }
    } else if (approach > 0) {
      exit = Math.min(exit, -distance / approach);
    } else {
      entries.push({ approach, bound, distance: -distance / approach });
    }
  }
  const entrance = Math.max(...entries.map((entry) => entry.distance));
  if (!entries.length || !(exit > Math.max(0, entrance) + EPSILON)) {
    return;
  }
  const entered = entries
    .filter((entry) => entry.distance >= entrance - tolerance)
    .reduce((best, entry) => (entry.approach < best.approach ? entry : best));
  const face = entered.bound;
  const inward = sub([0, 0, 0], face.normal);
  const incidence = dot(inward, ray);
  const axis =
    face.face.surface === 'fracture' && incidence < CRATER_ALIGNED
      ? unit(add(inward, ray))
      : inward;
  const grazing = Math.max(incidence, CRATER_GRAZING);
  const struck = add(point, scale(ray, entered.distance));
  const origin = sub(struck, scale(face.normal, dot(face.normal, struck) - face.offset));
  let thickness = Infinity;
  for (const bound of bounds) {
    const along = dot(bound.normal, axis);
    if (along > EPSILON) {
      thickness = Math.min(thickness, (bound.offset - dot(bound.normal, origin)) / along);
    }
  }
  if (!(thickness > tolerance) || !Number.isFinite(thickness)) {
    return;
  }
  const tangent = unit(cross(axis, Math.abs(axis[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
  const bitangent = cross(axis, tangent);
  let random = (seed + 0x6d_2b_79_f5) >>> 0;
  random = Math.imul(random ^ (random >>> 15), random | 1);
  random ^= random + Math.imul(random ^ (random >>> 7), random | 61);
  const angle = (((random ^ (random >>> 14)) >>> 0) / 4_294_967_296) * Math.PI * 2;
  const u = add(scale(tangent, Math.cos(angle)), scale(bitangent, Math.sin(angle)));
  const v = cross(axis, u);
  const lateral: Array<Vec3> = [u, v, scale(u, -1), scale(v, -1)];
  let half = (radius / Math.SQRT2) * Math.sqrt(grazing);
  if (face.face.surface === 'fracture') {
    half = Math.min(
      half,
      Math.max(
        MIN_IMPACT_OPENING,
        CRATER_OPENING_FIT * openingFit(face.face, face.normal, origin, u, v),
      ),
    );
  }
  const sink =
    face.face.surface === 'fracture'
      ? Math.min(depth * grazing, CRATER_REPEAT_DEPTH * half)
      : depth * grazing;
  const apex = sink * CRATER_APEX;
  const floorHalf = half * (1 - sink / apex);
  const wall = (side: number): Plane =>
    halfSpace(add(lateral[side]!, scale(axis, half / apex)), origin, half);
  const shaft = (side: number): Plane => halfSpace(lateral[side]!, origin, floorHalf);
  const floor = halfSpace(axis, origin, sink);
  for (const floored of thickness >= sink * CRATER_FLOOR ? [true, false] : [false]) {
    const surround = (side: number, active: Array<number>): FragmentDef | undefined =>
      piece(
        parent,
        clip(source, [
          flip(wall(side)),
          ...(floored ? [flip(shaft(side))] : []),
          ...active
            .filter((other) => other !== side && other !== (side + 2) % 4)
            .map((other) => halfSpace(sub(lateral[other]!, lateral[side]!), origin, 0)),
        ]),
        density,
      );
    let active = [0, 1, 2, 3];
    let sides = active.map((side) => surround(side, active));
    while (sides.some((side) => !side)) {
      const kept = active.filter((_, index) => sides[index]);
      sides = kept.map((side) => surround(side, kept));
      active = kept;
    }
    const crater = clip(source, [...active.map(wall), ...(floored ? [floor] : [])]);
    const chip = piece(parent, crater, density);
    const base = floored
      ? piece(parent, clip(source, [...active.map(shaft), flip(floor)]), density)
      : undefined;
    if (!chip || (floored && !base)) {
      continue;
    }
    const reach = floored ? sink : Math.min(thickness, apex);
    const rise = Math.min(
      0,
      ...crater.flatMap((side) => side.points.map((point) => dot(axis, sub(point, origin)))),
    );
    const nominal =
      (4 * half * half * apex * ((1 - rise / apex) ** 3 - (1 - reach / apex) ** 3)) / 3;
    if (chip.shape!.volume > nominal * CRATER_VOLUME_LIMIT) {
      return;
    }
    const retained = [...(sides as Array<FragmentDef>), ...(base ? [base] : [])];
    if (!retained.length) {
      return;
    }
    const chips: Array<Cell> = [{ faces: crater, fragment: chip }];
    for (const split of [u, v]) {
      for (const cell of chips.slice()) {
        const halves = cut(cell.faces, split, dot(split, cell.fragment.position));
        const children = halves.map((faces) => piece(parent, faces, density));
        if (children[0] && children[1]) {
          chips.splice(
            chips.indexOf(cell),
            1,
            ...halves.map((faces, index) => ({ faces, fragment: children[index]! })),
          );
        }
      }
    }
    return {
      axis,
      detached: chips.map((cell, index) => ({ ...cell.fragment, id: retained.length + index })),
      retained: retained.map((fragment, id) => ({ ...fragment, id })),
    };
  }
  return;
}

function resolvedWidth(faces: Array<Face>, minimum: number): boolean {
  const points = unique(faces.flatMap((face) => face.points));
  return faces.every((face) => {
    const direction = normal(face);
    const projections = points.map((point) => dot(point, direction));
    return Math.max(...projections) - Math.min(...projections) >= minimum;
  });
}

export function fractureFragment(parent: FragmentDef, seed: number): Array<FragmentDef> {
  const inputVolume = parent.shape?.volume ?? parent.size[0] * parent.size[1] * parent.size[2];
  if (
    !(inputVolume >= MIN_FRACTURE_VOLUME) ||
    !(parent.mass > 0) ||
    !Number.isFinite(parent.mass) ||
    (parent.shape &&
      (parent.shape.vertices.length > MAX_VERTICES || parent.shape.faces.length > MAX_FACES))
  ) {
    return [];
  }
  const faces = parent.shape
    ? parent.shape.faces.map((face) => ({
        points: face.vertices.map((index) => parent.shape!.vertices[index]!),
        surface: face.surface,
      }))
    : boxFaces(parent.size);
  if (!resolvedWidth(faces, MIN_FRACTURE_WIDTH)) {
    return [];
  }
  const initial = integrate(parent, faces, 1);
  if (!initial) {
    return [];
  }
  const density = parent.mass / initial.shape!.volume;
  const cells: Array<Cell> = [{ faces, fragment: initial }];
  const exhausted = new Set<Cell>();
  let randomState = seed >>> 0;
  const random = (): number => {
    randomState = (randomState + 0x6d_2b_79_f5) >>> 0;
    let value = Math.imul(randomState ^ (randomState >>> 15), randomState | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  const target = inputVolume >= 0.004 ? 4 : 2;
  while (cells.length < target) {
    const candidate = cells
      .filter((cell) => !exhausted.has(cell))
      .sort((a, b) => b.fragment.shape!.volume - a.fragment.shape!.volume)[0];
    if (!candidate) {
      break;
    }
    let split = false;
    const points = candidate.fragment.shape!.vertices;
    const spans = [0, 1, 2].map(
      (axis) =>
        Math.max(...points.map((point) => point[axis]!)) -
        Math.min(...points.map((point) => point[axis]!)),
    );
    const longest = spans.indexOf(Math.max(...spans));
    for (let attempt = 0; attempt < 6 && !split; attempt++) {
      const direction: Vec3 = [random() - 0.5, random() - 0.5, random() - 0.5];
      direction[longest] = 1;
      const n = unit(direction);
      const projections = points.map((point) => dot(n, point));
      const width = Math.max(...projections) - Math.min(...projections);
      const offset = dot(n, candidate.fragment.position) + (random() - 0.5) * width * 0.24;
      const halves = cut(candidate.faces, n, offset);
      const children = halves.map((half) => integrate(parent, half, density));
      if (
        children.every(
          (child) => child && child.shape!.volume >= candidate.fragment.shape!.volume * 0.14,
        ) &&
        halves.every((half) => resolvedWidth(half, MIN_CHILD_WIDTH))
      ) {
        cells.splice(
          cells.indexOf(candidate),
          1,
          ...halves.map((half, i) => ({ faces: half, fragment: children[i]! })),
        );
        split = true;
      }
    }
    if (!split) {
      exhausted.add(candidate);
    }
  }
  if (cells.length < 2) {
    return [];
  }
  return cells.map((cell, id) => ({ ...cell.fragment, id }));
}

/**
 * Splits a coarse structural cell into a regular grid of pieces no wider than `maxSize` on any
 * axis. This is the second level of the hierarchy: structure is authored at a coarse cell size
 * and refined to debris size where a landing or a blast breaks it loose. Pieces share the cell's
 * density and carry fracture faces on the cuts. Returns nothing when the cell is already fine.
 */
export function subdivideFragment(parent: FragmentDef, maxSize: number): Array<FragmentDef> {
  const inputVolume = parent.shape?.volume ?? parent.size[0] * parent.size[1] * parent.size[2];
  if (
    !(maxSize > 0) ||
    !(inputVolume >= MIN_FRACTURE_VOLUME) ||
    !(parent.mass > 0) ||
    !Number.isFinite(parent.mass) ||
    (parent.shape &&
      (parent.shape.vertices.length > MAX_VERTICES || parent.shape.faces.length > MAX_FACES))
  ) {
    return [];
  }
  const faces = hull(parent);
  const initial = integrate(parent, faces, 1);
  if (!initial) {
    return [];
  }
  const density = parent.mass / initial.shape!.volume;
  let pieces: Array<Array<Face>> = [faces];
  for (let axis = 0; axis < 3; axis++) {
    const direction: Vec3 = [0, 0, 0];
    direction[axis] = 1;
    const coordinates = faces.flatMap((face) => face.points.map((point) => point[axis]!));
    const low = Math.min(...coordinates),
      span = Math.max(...coordinates) - low;
    const parts = Math.ceil(span / maxSize - 1e-6);
    for (let k = 1; k < parts; k++) {
      const offset = low + (span * k) / parts;
      pieces = pieces.flatMap((current) => {
        const along = current.flatMap((face) => face.points.map((point) => point[axis]! - offset));
        if (Math.min(...along) >= -EPSILON || Math.max(...along) <= EPSILON) {
          return [current];
        }
        return cut(current, direction, offset);
      });
    }
  }
  if (pieces.length < 2) {
    return [];
  }
  const children: Array<FragmentDef> = [];
  for (const faces of pieces) {
    const child = piece(parent, faces, density);
    if (!child) {
      return [];
    }
    children.push({ ...child, id: children.length });
  }
  return children;
}
