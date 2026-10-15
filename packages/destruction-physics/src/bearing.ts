import type RAPIER from "@dimforge/rapier3d-compat";
import { forEachContactManifold } from "./contact-snapshot";
import type {
  BondDef,
  FragmentDef,
  Vec3,
} from "../../destruction-domain/src/index";

export interface BearingPatch {
  receiver: RAPIER.Collider;
  supporter: RAPIER.Collider;
  /** World-space polygon on the contact plane, with normal pointing out of the receiver. */
  points: Vec3[];
  normal: Vec3;
}
export interface BearingPolygon {
  points: Vec3[];
  normal: Vec3;
}
const missingReferences = new WeakMap<object, Set<string>>();
const missingNullContexts = new Set<string>();
function reportMissing(kind: string, context: string, reference: { handle: number } | null | undefined): void {
  const key = `${kind}:${context}`;
  let reported = reference ? missingReferences.get(reference) : missingNullContexts;
  if (!reported && reference) missingReferences.set(reference, (reported = new Set()));
  if (reported!.has(key)) return;
  reported!.add(key);
  console.warn(`[Cascade bearing] Skipping missing ${kind}`, { context, handle: reference?.handle ?? null });
}

/** Native pair callbacks can outlive an endpoint removed earlier in this step. */
export function bearingColliderValid(
  collider: RAPIER.Collider | null | undefined,
  context: string,
): collider is RAPIER.Collider {
  if (collider?.isValid()) return true;
  reportMissing('collider', context, collider);
  return false;
}

export function bearingBodyValid(
  body: RAPIER.RigidBody | null | undefined,
  context: string,
): body is RAPIER.RigidBody {
  if (body?.isValid()) return true;
  reportMissing('body', context, body);
  return false;
}
export const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const sub = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const scale = (a: Vec3, k: number): Vec3 => [
  a[0] * k,
  a[1] * k,
  a[2] * k,
];
export const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a));
const tuple = (a: { x: number; y: number; z: number }): Vec3 => [a.x, a.y, a.z];
const rotate = (
  q: { x: number; y: number; z: number; w: number },
  v: Vec3,
): Vec3 => {
  const t = scale(cross([q.x, q.y, q.z], v), 2);
  return add(v, add(scale(t, q.w), cross([q.x, q.y, q.z], t)));
};
const basis = (normal: Vec3): [Vec3, Vec3] => {
  const u = unit(
    cross(normal, Math.abs(normal[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]),
  );
  return [u, cross(normal, u)];
};
/** Convex contact patch from native manifold samples; line/point contacts have no invented area. */
function hull(points: Vec3[], normal: Vec3): Vec3[] {
  if (points.length < 3) return [];
  const [u, v] = basis(normal),
    origin = points[0]!;
  const projected = points
    .map((p) => ({ p, x: dot(sub(p, origin), u), y: dot(sub(p, origin), v) }))
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .filter(
      (p, i, a) =>
        !i || Math.hypot(p.x - a[i - 1]!.x, p.y - a[i - 1]!.y) > 1e-7,
    );
  const turn = (
    a: (typeof projected)[number],
    b: (typeof projected)[number],
    c: (typeof projected)[number],
  ) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (source: typeof projected) => {
    const out: typeof projected = [];
    for (const p of source) {
      while (
        out.length > 1 &&
        turn(out[out.length - 2]!, out[out.length - 1]!, p) <= 1e-12
      )
        out.pop();
      out.push(p);
    }
    return out;
  };
  const a = half(projected),
    b = half([...projected].reverse());
  return [...a.slice(0, -1), ...b.slice(0, -1)].map((p) => p.p);
}

/** Read every native bearing patch outside pair-enumeration borrows; never truncate support area. */
export function bearingPatches(
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  colliders: readonly RAPIER.Collider[],
): BearingPatch[] {
  const result: BearingPatch[] = [];
  if (!bearingBodyValid(body, 'patch owner')) return result;
  const tolerance =
    world.integrationParameters.normalizedAllowedLinearError *
    world.integrationParameters.lengthUnit;
  for (const receiver of colliders) {
    if (!bearingColliderValid(receiver, 'patch receiver') || !receiver.isEnabled() || receiver.isSensor())
      continue;
    const candidates: RAPIER.Collider[] = [];
    world.contactPairsWith(receiver, (other) => {
      // The narrow phase may still hold a removed handle until its next step.
      if (bearingColliderValid(other, 'patch contact pair')) candidates.push(other);
    });
    if (!bearingBodyValid(body, 'patch owner after enumeration')) return result;
    if (!bearingColliderValid(receiver, 'patch receiver after enumeration')) continue;
    const p = tuple(receiver.translation()),
      q = receiver.rotation();
    for (const supporter of candidates) {
      if (
        !bearingColliderValid(supporter, 'patch supporter') ||
        !supporter.isEnabled() ||
        supporter.isSensor()
      )
        continue;
      const other = supporter.parent();
      // A genuinely parentless collider is permanent world geometry. A cached
      // parent wrapper whose native body was removed is not that case.
      if (other && !bearingBodyValid(other, 'patch supporter parent')) continue;
      if (
        other?.handle === body.handle ||
        other?.isDynamic() ||
        other?.isKinematic()
      )
        continue;
      const skin = receiver.contactSkin() + supporter.contactSkin() + tolerance;
      const fragments: Array<{ normal: Vec3; points: Vec3[] }> = [];
      forEachContactManifold(world, receiver, supporter, (manifold, flipped) => {
        const normal = scale(tuple(manifold.normal()), flipped ? -1 : 1);
        if (normal[1] >= 0) return;
        const points: Vec3[] = [];
        for (let i = 0; i < manifold.numContacts(); i++) {
          if (manifold.contactDist(i) > skin) continue;
          const local = flipped
            ? manifold.localContactPoint2(i)
            : manifold.localContactPoint1(i);
          if (local) points.push(add(p, rotate(q, tuple(local))));
        }
        fragments.push({ normal, points });
      });
      for (const fragment of fragments) {
        const points = hull(fragment.points, fragment.normal);
        if (points.length >= 3)
          result.push({ receiver, supporter, normal: fragment.normal, points });
      }
    }
  }
  return result;
}

/** Clip an asset-space contact polygon to one actual support chunk's convex volume. */
export function clipBearingPolygon(
  points: Vec3[],
  fragment: FragmentDef,
): Vec3[] {
  let polygon = points.map((p) => sub(p, fragment.position));
  const planes: Array<{ normal: Vec3; offset: number }> = [];
  if (fragment.shape)
    for (const face of fragment.shape.faces) {
      const vertices = face.vertices.map((i) => fragment.shape!.vertices[i]!);
      let area: Vec3 = [0, 0, 0];
      for (let i = 1; i + 1 < vertices.length; i++)
        area = add(
          area,
          cross(
            sub(vertices[i]!, vertices[0]!),
            sub(vertices[i + 1]!, vertices[0]!),
          ),
        );
      if (Math.hypot(...area) <= 1e-12) continue;
      const normal = unit(area);
      planes.push({ normal, offset: dot(normal, vertices[0]!) });
    }
  else
    for (let axis = 0; axis < 3; axis++)
      for (const sign of [-1, 1]) {
        const normal: Vec3 = [0, 0, 0];
        normal[axis] = sign;
        planes.push({ normal, offset: fragment.size[axis]! / 2 });
      }
  for (const plane of planes) {
    const next: Vec3[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!,
        b = polygon[(i + 1) % polygon.length]!;
      const da = dot(plane.normal, a) - plane.offset,
        db = dot(plane.normal, b) - plane.offset;
      if (da <= 1e-7) next.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0))
        next.push(add(a, scale(sub(b, a), da / (da - db))));
    }
    polygon = next;
    if (polygon.length < 3) return [];
  }
  return polygon.map((p) => add(p, fragment.position));
}

/** Integrate disjoint patches separately; never hull across the empty space between supporters. */
export function bearingBond(
  fragment: FragmentDef,
  polygons: readonly BearingPolygon[],
  strength: number,
): Omit<BondDef, "id"> | undefined {
  const parts = polygons
    .map((p) => {
      let vector: Vec3 = [0, 0, 0];
      for (let i = 1; i + 1 < p.points.length; i++)
        vector = add(
          vector,
          cross(
            sub(p.points[i]!, p.points[0]!),
            sub(p.points[i + 1]!, p.points[0]!),
          ),
        );
      return { ...p, area: Math.abs(dot(vector, p.normal)) / 2 };
    })
    .filter((p) => p.area > 1e-10);
  if (!parts.length) return;
  const area = parts.reduce((v, p) => v + p.area, 0),
    normal = unit(
      parts.reduce((v, p) => add(v, scale(p.normal, p.area)), [
        0, 0, 0,
      ] as Vec3),
    );
  const [u, v] = basis(normal),
    origin = parts[0]!.points[0]!;
  let firstX = 0,
    firstY = 0,
    secondX = 0,
    secondY = 0,
    product = 0,
    plane = 0;
  for (const part of parts) {
    const ps = part.points.map(
      (p) => [dot(sub(p, origin), u), dot(sub(p, origin), v)] as const,
    );
    let a = 0,
      x = 0,
      y = 0,
      xx = 0,
      yy = 0,
      xy = 0;
    for (let i = 0; i < ps.length; i++) {
      const [ax, ay] = ps[i]!,
        [bx, by] = ps[(i + 1) % ps.length]!,
        d = ax * by - bx * ay;
      a += d / 2;
      x += ((ax + bx) * d) / 6;
      y += ((ay + by) * d) / 6;
      xx += ((ax * ax + ax * bx + bx * bx) * d) / 12;
      yy += ((ay * ay + ay * by + by * by) * d) / 12;
      xy += ((2 * ax * ay + ax * by + bx * ay + 2 * bx * by) * d) / 24;
    }
    if (Math.abs(a) <= 1e-12) return;
    const weight = part.area / a;
    firstX += x * weight;
    firstY += y * weight;
    secondX += xx * weight;
    secondY += yy * weight;
    product += xy * weight;
    plane += part.area * dot(sub(part.points[0]!, origin), normal);
  }
  const cx = firstX / area,
    cy = firstY / area,
    centroid = add(
      origin,
      add(add(scale(u, cx), scale(v, cy)), scale(normal, plane / area)),
    );
  const xx = secondX - area * cx * cx,
    yy = secondY - area * cy * cy,
    xy = product - area * cx * cy;
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy),
    c = Math.cos(angle),
    s = Math.sin(angle);
  const tangent1 = add(scale(u, c), scale(v, s)),
    tangent2 = cross(normal, tangent1);
  const inertia1 = s * s * xx - 2 * s * c * xy + c * c * yy,
    inertia2 = c * c * xx + 2 * s * c * xy + s * s * yy;
  let extent1 = 0,
    extent2 = 0,
    radius = 0;
  for (const part of parts)
    for (const point of part.points) {
      const r = sub(point, centroid),
        x = Math.abs(dot(r, tangent1)),
        y = Math.abs(dot(r, tangent2));
      extent1 = Math.max(extent1, x);
      extent2 = Math.max(extent2, y);
      radius = Math.max(radius, Math.hypot(x, y));
    }
  if (
    !(inertia1 > 0 && inertia2 > 0 && extent1 > 0 && extent2 > 0 && radius > 0)
  )
    return;
  return {
    a: fragment.id,
    b: -1,
    area,
    centroid,
    normal,
    strength,
    joint: false,
    section: {
      point: centroid,
      tangent1,
      tangent2,
      inertia1,
      inertia2,
      polarInertia: inertia1 + inertia2,
      sectionModulus1: inertia1 / extent2,
      sectionModulus2: inertia2 / extent1,
      torsionModulus: (inertia1 + inertia2) / radius,
    },
  };
}
