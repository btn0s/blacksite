import { AGENT_RADIUS, type Rect, type TacticalMap, type Vec3 } from '@blacksite/ai-schema';
export const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
export const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
export const quantize = (n: number) => Math.round(n * 1e6) / 1e6;
export const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
export function randomAt(seed: number, stream: string, tick: number, index = 0): number {
  let hash = (seed ^ Math.imul(tick, 0x9e_37_79_b1) ^ Math.imul(index, 0x85_eb_ca_6b)) >>> 0;
  for (let i = 0; i < stream.length; i++) {
    hash = Math.imul(hash ^ stream.charCodeAt(i), 0x01_00_01_93) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7f_eb_35_2d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x84_6c_a6_8b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x1_00_00_00_00;
}
export function segmentRectEntry(
  from: Vec3,
  to: Vec3,
  rect: Rect,
  clearance = 0,
): number | undefined {
  let entry = 0,
    exit = 1;
  for (const [start, delta, low, high] of [
    [
      from.x,
      to.x - from.x,
      rect.x - rect.width / 2 - clearance,
      rect.x + rect.width / 2 + clearance,
    ],
    [
      from.z,
      to.z - from.z,
      rect.z - rect.depth / 2 - clearance,
      rect.z + rect.depth / 2 + clearance,
    ],
  ] as const) {
    if (Math.abs(delta) < 1e-9) {
      if (start < low || start > high) {
        return undefined;
      }
    } else {
      const a = (low - start) / delta,
        b = (high - start) / delta;
      entry = Math.max(entry, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
      if (entry > exit) {
        return undefined;
      }
    }
  }
  return entry;
}
export function insideObstacle(
  map: TacticalMap,
  position: Vec3,
  clearance = AGENT_RADIUS,
): boolean {
  return (
    Math.abs(position.x) > map.width / 2 - clearance ||
    Math.abs(position.z) > map.depth / 2 - clearance ||
    map.obstacles.some(
      (rect) =>
        Math.abs(position.x - rect.x) < rect.width / 2 + clearance &&
        Math.abs(position.z - rect.z) < rect.depth / 2 + clearance,
    )
  );
}
export function lineClear(map: TacticalMap, from: Vec3, to: Vec3, clearance = 0): boolean {
  return !map.obstacles.some((rect) => {
    const entry = segmentRectEntry(from, to, rect, clearance);
    return entry !== undefined && from.y + (to.y - from.y) * entry <= rect.height;
  });
}
export function hashValue(value: unknown): string {
  const data = JSON.stringify(value);
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < data.length; i++) {
    hash = Math.imul(hash ^ data.charCodeAt(i), 0x01_00_01_93);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
