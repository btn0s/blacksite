import type { Vec3 } from './types';

export const clone = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (v: Vec3, s: number): Vec3 => ({ x: v.x * s, y: v.y * s, z: v.z * s });
export const length = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
export const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const finiteVector = (v: Vec3): boolean => !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
export const normalize = (v: Vec3): Vec3 => scale(v, 1 / length(v));

export function spreadDirection(direction: Vec3, angle: number, radiusDraw: number, azimuthDraw: number): Vec3 {
  const normal = normalize(direction);
  const reference = Math.abs(normal.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const right = normalize(cross(normal, reference));
  const up = cross(right, normal);
  const cosine = 1 - radiusDraw * (1 - Math.cos(angle));
  const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
  const azimuth = azimuthDraw * Math.PI * 2;
  return normalize(add(scale(normal, cosine), add(scale(right, sine * Math.cos(azimuth)), scale(up, sine * Math.sin(azimuth)))));
}
