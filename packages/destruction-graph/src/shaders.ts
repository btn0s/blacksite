import {
  BondState,
  TRANSFORM_STRIDE,
  type DamageProgramDescriptor,
  type DestructibleManifest,
  type FractureCommandBuffer,
  type FragmentDef,
  type Quat,
  type Vec3,
} from '../../destruction-domain/src/index';

/** Read-only view supplied to a Blast-style graph damage program. */
export interface GraphShaderContext {
  manifest: DestructibleManifest;
  activeChunks: Uint8Array;
  chunkHealth: Float32Array;
  states: Uint8Array;
  damage: Float32Array;
  endpointsA: Uint32Array;
  endpointsB: Uint32Array;
  rowOffsets: Uint32Array;
  bondIndices: Uint32Array;
  positions?: Float32Array;
}
const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
function falloff(desc: DamageProgramDescriptor, d: number): number {
  if (d <= desc.minRadius) return 1;
  if (d >= desc.maxRadius) return 0;
  return 1 - (d - desc.minRadius) / (desc.maxRadius - desc.minRadius);
}
function damageDistance(desc: DamageProgramDescriptor, point: Vec3): number {
  if (desc.type !== 'capsule' || !desc.end) return distance(point, desc.position);
  const v = subtract(desc.end, desc.position), w = subtract(point, desc.position);
  const t = Math.max(0, Math.min(1, dot(w, v) / (dot(v, v) || 1)));
  return distance(point, desc.position.map((x, i) => x + t * v[i]!) as Vec3);
}
/** Reference radial/capsule linear profile sampled at a bond centroid. */
export function damageFalloff(desc: DamageProgramDescriptor, point: Vec3): number {
  return falloff(desc, damageDistance(desc, point));
}
/** Chunk health samples the nearest point of its local AABB in its current pose. */
export function chunkDamageFalloff(desc: DamageProgramDescriptor, chunk: FragmentDef, center: Vec3, rotation?: Quat): number {
  const local = (point: Vec3): Vec3 => {
    const [x, y, z] = subtract(point, center);
    if (!rotation) return [x, y, z];
    const [qx, qy, qz, qw] = rotation;
    // Inverse rotation puts both the origin and capsule endpoint in the box frame.
    const tx = -2 * (qy * z - qz * y), ty = -2 * (qz * x - qx * z), tz = -2 * (qx * y - qy * x);
    return [x + qw * tx - qy * tz + qz * ty, y + qw * ty - qz * tx + qx * tz, z + qw * tz - qx * ty + qy * tx];
  };
  const min = chunk.size.map((value) => -value / 2) as Vec3;
  const max = chunk.size.map((value) => value / 2) as Vec3;
  if (chunk.shape?.vertices.length) {
    // Organic cells use a volume centroid, so their bounds need not be symmetric.
    min.fill(Infinity); max.fill(-Infinity);
    for (const vertex of chunk.shape.vertices) for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis]!, vertex[axis]!);
      max[axis] = Math.max(max[axis]!, vertex[axis]!);
    }
  }
  const origin = local(desc.position);
  const delta = desc.type === 'capsule' && desc.end ? subtract(local(desc.end), origin) : [0, 0, 0] as Vec3;
  const distanceSquared = (t: number): number => origin.reduce((sum, value, axis) => {
    const p = value + t * delta[axis]!;
    const clamped = Math.max(min[axis]!, Math.min(max[axis]!, p));
    return sum + (p - clamped) ** 2;
  }, 0);
  let squared = distanceSquared(0);
  if (desc.type === 'capsule' && desc.end) {
    // Segment-to-box distance: between box-plane crossings the squared clamp
    // distance is quadratic. Check its minimum on each interval, including ends.
    const cuts = [0, 1];
    for (let axis = 0; axis < 3; axis++) if (delta[axis] !== 0) {
      for (const bound of [min[axis]!, max[axis]!]) {
        const t = (bound - origin[axis]!) / delta[axis]!;
        if (t > 0 && t < 1) cuts.push(t);
      }
    }
    cuts.sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const lo = cuts[i - 1]!, hi = cuts[i]!, mid = (lo + hi) / 2;
      let linear = 0, quadratic = 0;
      for (let axis = 0; axis < 3; axis++) {
        const p = origin[axis]! + mid * delta[axis]!;
        if (p >= min[axis]! && p <= max[axis]!) continue;
        const bound = p < min[axis]! ? min[axis]! : max[axis]!;
        linear += delta[axis]! * (origin[axis]! - bound);
        quadratic += delta[axis]! ** 2;
      }
      const t = quadratic > 0 ? Math.max(lo, Math.min(hi, -linear / quadratic)) : lo;
      squared = Math.min(squared, distanceSquared(t));
    }
  }
  return falloff(desc, Math.sqrt(squared));
}
function position(ctx: GraphShaderContext, node: number): Vec3 {
  if (!ctx.positions) return ctx.manifest.fragments[node]!.position;
  const o = node * TRANSFORM_STRIDE;
  return [ctx.positions[o]!, ctx.positions[o + 1]!, ctx.positions[o + 2]!];
}
function rotate(ctx: GraphShaderContext, node: number, v: Vec3): Vec3 {
  if (!ctx.positions) return [...v];
  const o = node * TRANSFORM_STRIDE, q = ctx.positions;
  const x = q[o + 3]!, y = q[o + 4]!, z = q[o + 5]!, w = q[o + 6]!;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
function bondPosition(ctx: GraphShaderContext, index: number): Vec3 {
  const bond = ctx.manifest.bonds[index]!, a = ctx.endpointsA[index]!, b = ctx.endpointsB[index]!;
  const authored = bond.centroid ?? bond.section?.point;
  if (authored) {
    const offset = rotate(ctx, a, subtract(authored, ctx.manifest.fragments[a]!.position));
    return position(ctx, a).map((x, axis) => x + offset[axis]!) as Vec3;
  }
  const pa = position(ctx, a), pb = position(ctx, b);
  return pa.map((x, axis) => (x + pb[axis]!) / 2) as Vec3;
}
function normalized(ctx: GraphShaderContext, node: number, damage: number): number {
  const material = ctx.manifest.materials.find((m) => m.id === ctx.manifest.fragments[node]!.material);
  const health = material?.health ?? 1;
  const amount = health > 0 ? damage / health : 1;
  return amount > (material?.minDamageThreshold ?? 0) ? Math.min(amount, material?.maxDamageThreshold ?? 1) : 0;
}
function liveBond(ctx: GraphShaderContext, bond: number): boolean {
  return ctx.states[bond] !== BondState.Broken && ctx.damage[bond]! < 1 && !!ctx.activeChunks[ctx.endpointsA[bond]!] && (ctx.manifest.bonds[bond]!.b === -1 || !!ctx.activeChunks[ctx.endpointsB[bond]!]);
}
function empty(desc: DamageProgramDescriptor): FractureCommandBuffer {
  return { bonds: [], chunks: [], programs: [{ ...desc, position: [...desc.position], ...(desc.end ? { end: [...desc.end] } : {}), ...(desc.normal ? { normal: [...desc.normal] } : {}) }] };
}
function damageBond(ctx: GraphShaderContext, desc: DamageProgramDescriptor, result: FractureCommandBuffer, bond: number, weight: number): void {
  if (!(weight > 0) || !liveBond(ctx, bond)) return;
  const a = ctx.endpointsA[bond]!, b = ctx.endpointsB[bond]!;
  const health = Math.min(normalized(ctx, a, desc.damage), normalized(ctx, b, desc.damage)) * weight;
  if (health > 0) result.bonds.push({ bond, health, program: 0 });
}
function damageChunk(ctx: GraphShaderContext, desc: DamageProgramDescriptor, result: FractureCommandBuffer, chunk: number): void {
  if (!ctx.activeChunks[chunk] || !(ctx.chunkHealth[chunk]! > 0)) return;
  // Graph shaders fracture bonds throughout the falloff. In-place support demotion
  // is restricted to the full-damage core, with the material's threshold and cap.
  const o = chunk * TRANSFORM_STRIDE;
  const rotation: Quat | undefined = ctx.positions ? [ctx.positions[o + 3]!, ctx.positions[o + 4]!, ctx.positions[o + 5]!, ctx.positions[o + 6]!] : undefined;
  if (chunkDamageFalloff(desc, ctx.manifest.fragments[chunk]!, position(ctx, chunk), rotation) < 1) return;
  const health = normalized(ctx, chunk, desc.damage);
  if (health > 0) result.chunks.push({ chunk, health, program: 0 });
}
function closest(ctx: GraphShaderContext, desc: DamageProgramDescriptor): number {
  if (desc.chunk !== undefined && ctx.activeChunks[desc.chunk]) return desc.chunk;
  let nearest = -1, best = Infinity;
  for (let i = 0; i < ctx.activeChunks.length; i++) {
    if (!ctx.activeChunks[i]) continue;
    const d = distance(position(ctx, i), desc.position);
    if (d < best) { nearest = i; best = d; }
  }
  return nearest;
}
function radialProfile(ctx: GraphShaderContext, desc: DamageProgramDescriptor): FractureCommandBuffer {
  const result = empty(desc);
  for (let bond = 0; bond < ctx.manifest.bonds.length; bond++) {
    if (liveBond(ctx, bond)) damageBond(ctx, desc, result, bond, damageFalloff(desc, bondPosition(ctx, bond)));
  }
  // Cascade's explicit C1 extension: support health permits local in-place demotion.
  for (let chunk = 0; chunk < ctx.activeChunks.length; chunk++) {
    if (ctx.activeChunks[chunk]) damageChunk(ctx, desc, result, chunk);
  }
  return result;
}
export function radialGraphShader(ctx: GraphShaderContext, desc: DamageProgramDescriptor): FractureCommandBuffer {
  return radialProfile(ctx, { ...desc, type: 'radial' });
}
export function capsuleGraphShader(ctx: GraphShaderContext, desc: DamageProgramDescriptor): FractureCommandBuffer {
  if (!desc.end) throw new Error('Capsule damage requires both endpoints');
  return radialProfile(ctx, { ...desc, type: 'capsule' });
}
/** Blast's directional walk and 1 - abs(dot(direction, interfaceNormal)) shear weight. */
export function shearGraphShader(ctx: GraphShaderContext, desc: DamageProgramDescriptor): FractureCommandBuffer {
  const result = empty(desc), first = closest(ctx, desc);
  if (first < 0) return result;
  if (!desc.normal || !(Math.hypot(...desc.normal) > 0)) throw new Error('Shear damage requires a direction');
  const n = desc.normal, length = Math.hypot(...n);
  const normal = n.map((x) => x / length) as Vec3;
  damageChunk(ctx, desc, result, first);
  let node = first, maxDistance = 0;
  const visited = new Set<number>();
  const emitted = new Set<number>();
  while (node >= 0 && !visited.has(node)) {
    visited.add(node);
    let next = -1;
    for (let row = ctx.rowOffsets[node]!; row < ctx.rowOffsets[node + 1]!; row++) {
      const bond = ctx.bondIndices[row]!;
      if (!liveBond(ctx, bond)) continue;
      const center = bondPosition(ctx, bond);
      const ahead = dot(subtract(center, desc.position), normal);
      if (ahead > maxDistance && ctx.manifest.bonds[bond]!.b !== -1) {
        maxDistance = ahead;
        next = ctx.endpointsA[bond] === node ? ctx.endpointsB[bond]! : ctx.endpointsA[bond]!;
      }
      if (emitted.has(bond)) continue;
      emitted.add(bond);
      const shear = Math.abs(1 - Math.abs(dot(normal, rotate(ctx, ctx.endpointsA[bond]!, ctx.manifest.bonds[bond]!.normal))));
      damageBond(ctx, desc, result, bond, shear * damageFalloff(desc, center));
    }
    node = next;
  }
  return result;
}
/** Breadth-first bond traversal with distance accumulated along graph edges, including world bonds. */
export function impactSpreadGraphShader(ctx: GraphShaderContext, desc: DamageProgramDescriptor): FractureCommandBuffer {
  const result = empty(desc), first = closest(ctx, desc);
  if (first < 0) return result;
  const queue: Array<{ node: number; distance: number }> = [{ node: first, distance: 0 }];
  const visited = new Uint8Array(ctx.manifest.bonds.length), damaged = new Set<number>();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]!, p = position(ctx, current.node);
    if (!damaged.has(current.node)) {
      damageChunk(ctx, desc, result, current.node);
      damaged.add(current.node);
    }
    for (let row = ctx.rowOffsets[current.node]!; row < ctx.rowOffsets[current.node + 1]!; row++) {
      const bond = ctx.bondIndices[row]!;
      if (visited[bond] || !liveBond(ctx, bond)) continue;
      visited[bond] = 1;
      const other = ctx.endpointsA[bond] === current.node ? ctx.endpointsB[bond]! : ctx.endpointsA[bond]!;
      const world = ctx.manifest.bonds[bond]!.b === -1;
      const total = current.distance + distance(p, world ? bondPosition(ctx, bond) : position(ctx, other)) * (world ? 2 : 1);
      const weight = falloff(desc, total);
      damageBond(ctx, desc, result, bond, weight);
      if (weight > 0 && !world) queue.push({ node: other, distance: total });
    }
  }
  return result;
}
export function generateDamageProgram(ctx: GraphShaderContext, desc: DamageProgramDescriptor): FractureCommandBuffer {
  if (![desc.damage, desc.minRadius, desc.maxRadius, ...desc.position, ...(desc.end ?? []), ...(desc.normal ?? [])].every(Number.isFinite) || desc.damage < 0 || desc.minRadius < 0 || desc.maxRadius < desc.minRadius || !(desc.maxRadius > 0)) throw new Error('Invalid damage program descriptor');
  switch (desc.type) {
    case 'radial': return radialGraphShader(ctx, desc);
    case 'capsule': return capsuleGraphShader(ctx, desc);
    case 'shear': return shearGraphShader(ctx, desc);
    case 'impactSpread': return impactSpreadGraphShader(ctx, desc);
  }
}
