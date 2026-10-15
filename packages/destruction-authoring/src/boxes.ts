import type {
  BondDef,
  DestructibleManifest,
  ElementKind,
  FragmentDef,
  MaterialDef,
  Vec3,
} from '../../destruction-domain/src/index';
import { MATERIALS } from '../../destruction-testkit/src/index';
import { fractureBoxMembers, hashOrganicManifest, type OrganicMember } from '../../destruction-testkit/src/organic';
import { assertManifest } from './index';

export const DESTRUCTION_MATERIALS: ReadonlyArray<MaterialDef> = [
  ...MATERIALS.map((material) => ({ ...material })),
  {
    bendingStrength: 30e6,
    brittleness: 0.45,
    color: '#94734c',
    compressionStrength: 25e6,
    density: 600,
    friction: 0.7,
    id: 5,
    minDamageThreshold: 0.15,
    maxDamageThreshold: 1,
    name: 'Timber',
    poissonRatio: 0.25,
    shearStrength: 4e6,
    strength: 0.65,
    tensionStrength: 12e6,
    youngModulus: 9e9,
  },
  {
    bendingStrength: 250e6,
    brittleness: 0.12,
    color: '#68737a',
    compressionStrength: 250e6,
    density: 7850,
    friction: 0.6,
    id: 6,
    minDamageThreshold: 0.35,
    maxDamageThreshold: 1,
    name: 'Structural steel',
    poissonRatio: 0.3,
    shearStrength: 145e6,
    strength: 3,
    tensionStrength: 250e6,
    youngModulus: 200e9,
  },
];

const ELEMENT_MATERIALS: Readonly<Record<ElementKind, number>> = {
  column: 3,
  beam: 3,
  slab: 1,
  wall: 0,
  roof: 1,
  trim: 2,
  glass: 4,
};

export interface DestructibleBox {
  anchored?: boolean;
  element?: ElementKind;
  id: string;
  material?: number;
  max: Vec3;
  min: Vec3;
}

export interface BoxAuthoringOptions {
  cellSize?: number;
  storeyHeight?: number;
  baySize?: number;
  panelWidth?: number;
  id: string;
  materials?: ReadonlyArray<MaterialDef>;
  elementMaterials?: Partial<Record<ElementKind, number>>;
  maxFragments?: number;
}

export function createDestructibleBoxes(
  boxes: ReadonlyArray<DestructibleBox>,
  options: BoxAuthoringOptions,
): {
  fragmentSource: ReadonlyMap<number, string>;
  manifest: DestructibleManifest;
} {
  let cellSize = options.cellSize ?? 0.75;
  const maxFragments = options.maxFragments ?? 2048;
  if (
    !Number.isFinite(cellSize) ||
    cellSize < 0.1 ||
    !Number.isSafeInteger(maxFragments) ||
    maxFragments < 1 ||
    maxFragments > 10_000
  ) {
    throw new Error('Invalid destruction authoring resolution or fragment budget');
  }
  if (!boxes.length) {
    throw new Error('Destruction authoring requires at least one box');
  }
  if (
    boxes.length > maxFragments ||
    boxes.some(
      (box) =>
        ![...box.min, ...box.max].every(Number.isFinite) ||
        box.min.some((value, axis) => value >= box.max[axis]!),
    )
  ) {
    throw new Error('Invalid destruction boxes or insufficient fragment budget');
  }
  if (options.cellSize === undefined) {
    const estimate = () =>
      boxes.reduce(
        (total, box) =>
          total +
          box.max.reduce(
            (cells, value, axis) =>
              cells * Math.max(1, Math.ceil((value - box.min[axis]!) / cellSize)),
            1,
          ),
        0,
      );
    while (estimate() > maxFragments) {
      cellSize *= 1.25;
    }
  }
  const materials = (options.materials ?? DESTRUCTION_MATERIALS).map((material) => ({
    health: material.strength,
    minDamageThreshold: 0.25,
    maxDamageThreshold: 1,
    ...material,
  }));
  const materialById = new Map(materials.map((material) => [material.id, material]));
  const fragmentSource = new Map<number, string>();
  const ids = new Set<string>();
  const members: Array<OrganicMember> = [];
  const chunks: Array<FragmentDef> = [];
  const memberChunks: Array<FragmentDef> = [];
  const grounded = new Set<number>();
  const regions: DestructibleManifest['regions'] = [];
  let nextId = 1, cellCount = 0;
  const storey = options.storeyHeight ?? 3.5;
  const bay = options.baySize ?? 6.5;
  const panel = options.panelWidth ?? 3.5;
  if (![storey, bay, panel].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Invalid member segmentation dimensions');
  }
  for (const [index, box] of [...boxes]
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .entries()) {
    const explicitMaterial = box.material === undefined ? undefined : materialById.get(box.material);
    const size = box.max.map((value, axis) => value - box.min[axis]!) as Vec3;
    const element = box.element ?? inferElement(size, explicitMaterial?.name ?? '');
    const materialId = box.material ?? options.elementMaterials?.[element] ?? ELEMENT_MATERIALS[element];
    const material = materialById.get(materialId);
    if (!box.id || ids.has(box.id) || !material) {
      throw new Error(`Invalid or duplicate destructible box, or unavailable material ${materialId}: ${box.id}`);
    }
    ids.add(box.id);
    const counts: Vec3 = [1, 1, 1];
    if (element === 'column') counts[1] = Math.max(1, Math.ceil(size[1] / storey));
    else if (element === 'slab' || element === 'roof') {
      counts[0] = Math.max(1, Math.ceil(size[0] / bay));
      counts[2] = Math.max(1, Math.ceil(size[2] / bay));
    } else if (element === 'wall' || element === 'glass') {
      const axis = size[0] >= size[2] ? 0 : 2;
      counts[axis] = Math.max(1, Math.ceil(size[axis] / panel));
      counts[1] = Math.max(1, Math.ceil(size[1] / storey));
    } else {
      const axis = size[0] >= size[2] ? 0 : 2;
      counts[axis] = Math.max(1, Math.ceil(size[axis] / bay));
    }
    const createChunk = (min: Vec3, max: Vec3, parent: number, depth: number): FragmentDef => {
      const size = max.map((value, axis) => value - min[axis]!) as Vec3;
      const id = nextId++;
      fragmentSource.set(id, box.id);
      return {
        aggregate: index, anchored: false, depth, element, id,
        initialHealth: 1,
        mass: size[0] * size[1] * size[2] * material.density,
        material: material.id, parent,
        position: min.map((value, axis) => value + size[axis]! / 2) as Vec3,
        region: index, size, support: depth === 1,
      };
    };
    const root = createChunk(box.min, box.max, -1, 0);
    chunks.push(root);
    for (let y = 0; y < counts[1]; y++) for (let z = 0; z < counts[2]; z++) for (let x = 0; x < counts[0]; x++) {
      const coordinate = [x, y, z];
      const min = box.min.map((value, axis) => value + coordinate[axis]! * size[axis]! / counts[axis]!) as Vec3;
      const max = min.map((value, axis) => value + size[axis]! / counts[axis]!) as Vec3;
      const member = createChunk(min, max, root.id, 1);
      chunks.push(member);
      memberChunks.push(member);
      if (box.anchored && y === 0) grounded.add(member.id);
      const count = member.size.map((value) => Math.max(1, Math.ceil(value / cellSize))) as Vec3;
      cellCount += count[0] * count[1] * count[2];
      if (cellCount > maxFragments) {
        throw new Error(`Destruction authoring exceeds ${maxFragments} leaf fragments; increase cellSize or author a smaller region`);
      }
      const cellSize3 = member.size.map((value, axis) => value / count[axis]!) as Vec3;
      const fragments: Array<FragmentDef> = [];
      for (let cy = 0; cy < count[1]; cy++) for (let cz = 0; cz < count[2]; cz++) for (let cx = 0; cx < count[0]; cx++) {
        const coordinate = [cx, cy, cz];
        const low = min.map((value, axis) => value + coordinate[axis]! * cellSize3[axis]!) as Vec3;
        const high = low.map((value, axis) => value + cellSize3[axis]!) as Vec3;
        fragments.push(createChunk(low, high, member.id, 2));
      }
      members.push({ fragments, min, max });
    }
    regions.push({ id: index, max: [...box.max], min: [...box.min], name: box.id });
  }
  // Fracture each member independently: children exactly cover their support ancestor.
  const organic = fractureBoxMembers({
    bonds: [], coordinateSystem: 'Y_UP_RH',
    fragments: members.flatMap((member) => member.fragments), materials,
    name: options.id, regions, scenario: 'building', schemaVersion: 1,
  }, members);
  const bonds: Array<BondDef> = [];
  for (let ai = 0; ai < memberChunks.length; ai++) {
    const a = memberChunks[ai]!;
    for (let bi = ai + 1; bi < memberChunks.length; bi++) {
      const b = memberChunks[bi]!;
      const contact = boxInterface(a, b);
      if (!contact) continue;
      bonds.push({ ...contact, a: a.id, b: b.id, id: bonds.length + 1, joint: true,
        strength: Math.min(materialById.get(a.material)!.strength, materialById.get(b.material)!.strength) });
    }
    if (grounded.has(a.id)) {
      const area = a.size[0] * a.size[2];
      const centroid: Vec3 = [a.position[0], a.position[1] - a.size[1] / 2, a.position[2]];
      bonds.push({ a: a.id, b: -1, id: bonds.length + 1, normal: [0, -1, 0], area, centroid,
        joint: true, section: rectangleSection(centroid, [1, 0, 0], [0, 0, 1], a.size[0], a.size[2]),
        strength: materialById.get(a.material)!.strength });
    }
  }
  const subsupportBonds = organic.bonds.map((bond) => ({ ...bond, centroid: bond.section!.point, joint: true }));
  // World contact patches for children are retained with the dormant subgraph, so ground
  // attachment survives an in-place demotion only where a child actually touches the base.
  const memberById = new Map(memberChunks.map((fragment) => [fragment.id, fragment]));
  for (const child of organic.fragments) {
    if (!grounded.has(child.parent!)) continue;
    const member = memberById.get(child.parent!)!;
    const base = member.position[1] - member.size[1] / 2;
    for (const face of child.shape!.faces) {
      const vertices = face.vertices.map((index) => child.shape!.vertices[index]!.map((value, axis) => value + child.position[axis]!) as Vec3);
      if (!vertices.every((point) => Math.abs(point[1] - base) < 1e-7)) continue;
      const contact = horizontalPolygonSection(vertices);
      subsupportBonds.push({ ...contact, a: child.id, b: -1, id: subsupportBonds.length + 1,
        joint: true, normal: [0, -1, 0], strength: materialById.get(child.material)!.strength });
    }
  }
  const content: Omit<DestructibleManifest, 'assetHash'> = {
    ...organic, depth: 2, supportDepth: 1, bonds, subsupportBonds,
    fragments: [...chunks, ...organic.fragments].sort((a, b) => a.id - b.id),
  };
  delete (content as Partial<DestructibleManifest>).assetHash;
  const manifest = { ...content, assetHash: hashOrganicManifest(content) };
  assertManifest(manifest, { requireSupported: false });
  return { fragmentSource, manifest };
}

function inferElement(size: Vec3, material: string): ElementKind {
  if (/glass/i.test(material)) return 'glass';
  if (size[1] >= Math.max(size[0], size[2]) * 1.5) return 'column';
  if (size[1] <= Math.min(size[0], size[2]) * 0.3) return 'slab';
  if (Math.min(size[0], size[2]) <= Math.min(size[1], Math.max(size[0], size[2])) * 0.35) return 'wall';
  return 'beam';
}

function rectangleSection(point: Vec3, tangent1: Vec3, tangent2: Vec3, width: number, height: number): NonNullable<BondDef['section']> {
  const area = width * height, inertia1 = area * height * height / 12, inertia2 = area * width * width / 12;
  return { point, tangent1, tangent2, inertia1, inertia2, polarInertia: inertia1 + inertia2,
    sectionModulus1: 2 * inertia1 / height, sectionModulus2: 2 * inertia2 / width,
    torsionModulus: (inertia1 + inertia2) / (Math.hypot(width, height) / 2) };
}

function boxInterface(a: FragmentDef, b: FragmentDef): Pick<BondDef, 'normal' | 'area' | 'centroid' | 'section'> | undefined {
  for (let axis = 0; axis < 3; axis++) {
    const separation = b.position[axis]! - a.position[axis]!;
    if (Math.abs(Math.abs(separation) - (a.size[axis]! + b.size[axis]!) / 2) > 0.035) continue;
    const others = [0, 1, 2].filter((value) => value !== axis);
    const lo = others.map((index) => Math.max(a.position[index]! - a.size[index]! / 2, b.position[index]! - b.size[index]! / 2));
    const hi = others.map((index) => Math.min(a.position[index]! + a.size[index]! / 2, b.position[index]! + b.size[index]! / 2));
    const width = hi[0]! - lo[0]!, height = hi[1]! - lo[1]!;
    if (width <= 1e-6 || height <= 1e-6) continue;
    const normal: Vec3 = [0, 0, 0], centroid: Vec3 = [0, 0, 0], tangent1: Vec3 = [0, 0, 0], tangent2: Vec3 = [0, 0, 0];
    normal[axis] = Math.sign(separation);
    centroid[axis] = a.position[axis]! + normal[axis]! * a.size[axis]! / 2;
    centroid[others[0]!] = (lo[0]! + hi[0]!) / 2;
    centroid[others[1]!] = (lo[1]! + hi[1]!) / 2;
    tangent1[others[0]!] = 1;
    tangent2[0] = normal[1] * tangent1[2] - normal[2] * tangent1[1];
    tangent2[1] = normal[2] * tangent1[0] - normal[0] * tangent1[2];
    tangent2[2] = normal[0] * tangent1[1] - normal[1] * tangent1[0];
    return { normal, area: width * height, centroid, section: rectangleSection(centroid, tangent1, tangent2, width, height) };
  }
}

function horizontalPolygonSection(vertices: Array<Vec3>): { area: number; centroid: Vec3; section: NonNullable<BondDef['section']> } {
  let twiceArea = 0, cx = 0, cz = 0, xx = 0, zz = 0, xz = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!, b = vertices[(i + 1) % vertices.length]!;
    const d = a[0] * b[2] - b[0] * a[2];
    twiceArea += d;
    cx += (a[0] + b[0]) * d; cz += (a[2] + b[2]) * d;
    xx += (a[0] * a[0] + a[0] * b[0] + b[0] * b[0]) * d;
    zz += (a[2] * a[2] + a[2] * b[2] + b[2] * b[2]) * d;
    xz += (2 * a[0] * a[2] + a[0] * b[2] + b[0] * a[2] + 2 * b[0] * b[2]) * d;
  }
  cx /= 3 * twiceArea; cz /= 3 * twiceArea;
  const area = Math.abs(twiceArea) / 2, sign = Math.sign(twiceArea);
  const covarianceX = xx * sign / 12 - area * cx * cx;
  const covarianceZ = zz * sign / 12 - area * cz * cz;
  const covarianceXZ = xz * sign / 24 - area * cx * cz;
  const angle = 0.5 * Math.atan2(2 * covarianceXZ, covarianceX - covarianceZ);
  const c = Math.cos(angle), s = Math.sin(angle);
  const tangent1: Vec3 = [c, 0, s], tangent2: Vec3 = [-s, 0, c];
  const inertia1 = Math.max(1e-12, s * s * covarianceX - 2 * c * s * covarianceXZ + c * c * covarianceZ);
  const inertia2 = Math.max(1e-12, c * c * covarianceX + 2 * c * s * covarianceXZ + s * s * covarianceZ);
  const centroid: Vec3 = [cx, vertices[0]![1], cz];
  const extentX = Math.max(...vertices.map((point) => Math.abs((point[0] - cx) * c + (point[2] - cz) * s)));
  const extentZ = Math.max(...vertices.map((point) => Math.abs(-(point[0] - cx) * s + (point[2] - cz) * c)));
  return { area, centroid, section: { point: centroid, tangent1, tangent2,
    inertia1, inertia2, polarInertia: inertia1 + inertia2, sectionModulus1: inertia1 / extentZ,
    sectionModulus2: inertia2 / extentX, torsionModulus: (inertia1 + inertia2) / Math.hypot(extentX, extentZ) } };
}
