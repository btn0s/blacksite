import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { damagedEdgeGeometry } from './edges';
import type { FragmentDef, Vec3 } from '../../destruction-domain/src/index';

export type FragmentSurface = 'exterior' | 'fracture';

export function fragmentSurfaceGeometry(
  fragment: FragmentDef,
  surface: FragmentSurface,
): BufferGeometry | null {
  if (!fragment.shape) {
    if (surface === 'fracture') {
      return null;
    }
    const box = new BoxGeometry(...fragment.size);
    const geometry = box.toNonIndexed();
    box.dispose();
    const positions = geometry.getAttribute('position'),
      normals = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < positions.count; i++) {
      const p: Vec3 = [
        positions.getX(i) + fragment.position[0],
        positions.getY(i) + fragment.position[1],
        positions.getZ(i) + fragment.position[2],
      ];
      const n: Vec3 = [normals.getX(i), normals.getY(i), normals.getZ(i)];
      const [u, v] = projectedUV(p, n);
      uv.setXY(i, u, v);
    }
    return geometry;
  }
  const positions: Array<number> = [],
    normals: Array<number> = [],
    uvs: Array<number> = [];
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    normal = new Vector3();
  for (const face of fragment.shape.faces) {
    if (face.surface !== surface || face.vertices.length < 3) {
      continue;
    }
    const points = face.vertices.map((index) => {
      const point = fragment.shape!.vertices[index];
      if (!point) {
        throw new Error('Fragment surface references a missing vertex');
      }
      return point;
    });
    a.fromArray(points[0]!);
    normal.set(0, 0, 0);
    for (let i = 1; i < points.length - 1; i++) {
      b.fromArray(points[i]!).sub(a);
      c.fromArray(points[i + 1]!).sub(a);
      normal.add(b.cross(c));
    }
    normal.normalize();
    const n = normal.toArray() as Vec3;
    for (let i = 1; i < points.length - 1; i++) {
      for (const p of [points[0]!, points[i]!, points[i + 1]!]) {
        positions.push(...p);
        normals.push(...n);
        uvs.push(
          ...projectedUV(
            [p[0] + fragment.position[0], p[1] + fragment.position[1], p[2] + fragment.position[2]],
            n,
          ),
        );
      }
    }
  }
  if (!positions.length) {
    return null;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  return geometry;
}

export function fragmentEdgeGeometry(fragment: FragmentDef): BufferGeometry | null {
  if (!fragment.shape) return null;
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), normal = new Vector3();
  for (const face of fragment.shape.faces) {
    if (face.surface !== 'fracture' || face.vertices.length < 3) continue;
    const points = face.vertices.map(index => {
      const point = fragment.shape!.vertices[index];
      if (!point) throw new Error('Fragment surface references a missing vertex');
      return point;
    });
    a.fromArray(points[0]!);
    normal.set(0, 0, 0);
    for (let i = 1; i < points.length - 1; i++) {
      b.fromArray(points[i]!).sub(a);
      c.fromArray(points[i + 1]!).sub(a);
      normal.add(b.cross(c));
    }
    normal.normalize();
    const edge = damagedEdgeGeometry(points, normal.toArray() as Vec3, fragment.id, Math.min(0.025, Math.min(...fragment.size) * 0.08));
    if (!edge) continue;
    positions.push(...Array.from(edge.getAttribute('position').array));
    normals.push(...Array.from(edge.getAttribute('normal').array));
    uvs.push(...Array.from(edge.getAttribute('uv').array));
    edge.dispose();
  }
  if (!positions.length) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  return geometry;
}

function projectedUV(p: Vec3, normal: Vec3): [number, number] {
  const x = Math.abs(normal[0]),
    y = Math.abs(normal[1]),
    z = Math.abs(normal[2]);
  if (y >= x && y >= z) {
    return [p[0], -p[2]];
  }
  if (x >= z) {
    return [p[2], p[1]];
  }
  return [p[0], p[1]];
}
