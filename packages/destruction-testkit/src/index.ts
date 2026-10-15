import type {
  BondDef,
  DestructibleManifest,
  FragmentDef,
  MaterialDef,
  RegionDef,
  ScenarioId,
  Vec3,
} from '../../destruction-domain/src/index';
import { createComplexScenario } from './complex';

export const MATERIALS: Array<MaterialDef> = [
  {
    bendingStrength: 3_500_000.0,
    brittleness: 0.82,
    color: '#b2afa6',
    compressionStrength: 28_000_000.0,
    density: 2350,
    friction: 0.72,
    id: 0,
    minDamageThreshold: 0.25,
    maxDamageThreshold: 1,
    name: 'Cast concrete',
    poissonRatio: 0.2,
    shearStrength: 2_500_000.0,
    strength: 1.2,
    tensionStrength: 2_000_000.0,
    youngModulus: 20_000_000_000.0,
  },
  {
    bendingStrength: 6_000_000.0,
    brittleness: 0.68,
    color: '#d0cbbf',
    compressionStrength: 32_000_000.0,
    density: 2280,
    friction: 0.8,
    id: 1,
    minDamageThreshold: 0.25,
    maxDamageThreshold: 1,
    name: 'Floor concrete',
    poissonRatio: 0.2,
    shearStrength: 3_500_000.0,
    strength: 1.35,
    tensionStrength: 3_200_000.0,
    youngModulus: 28_000_000_000.0,
  },
  {
    bendingStrength: 2_000_000.0,
    brittleness: 0.94,
    color: '#a17453',
    compressionStrength: 14_000_000.0,
    density: 1750,
    friction: 0.74,
    id: 2,
    minDamageThreshold: 0.15,
    maxDamageThreshold: 1,
    name: 'Terracotta infill',
    poissonRatio: 0.22,
    shearStrength: 1_600_000.0,
    strength: 0.78,
    tensionStrength: 1_200_000.0,
    youngModulus: 8_000_000_000.0,
  },
  {
    bendingStrength: 12_000_000.0,
    brittleness: 0.35,
    color: '#656966',
    compressionStrength: 45_000_000.0,
    density: 2600,
    friction: 0.7,
    id: 3,
    minDamageThreshold: 0.25,
    maxDamageThreshold: 1,
    name: 'Reinforced frame',
    poissonRatio: 0.22,
    shearStrength: 6_000_000.0,
    strength: 1.7,
    tensionStrength: 8_000_000.0,
    youngModulus: 35_000_000_000.0,
  },
  {
    bendingStrength: 5_000_000.0,
    brittleness: 1,
    color: '#718c8d',
    compressionStrength: 50_000_000.0,
    density: 1150,
    friction: 0.5,
    id: 4,
    minDamageThreshold: 0.05,
    maxDamageThreshold: 1,
    name: 'Facade glass',
    poissonRatio: 0.22,
    shearStrength: 5_000_000.0,
    strength: 0.42,
    tensionStrength: 8_000_000.0,
    youngModulus: 60_000_000_000.0,
  },
];

const MANIFEST_HASH_KEYS: Readonly<Record<string, ReadonlyArray<string>>> = {
  '': [
    'schemaVersion',
    'name',
    'scenario',
    'coordinateSystem',
    'fragments',
    'bonds',
    'materials',
    'regions',
    'level',
  ],
  bonds: ['id', 'a', 'b', 'area', 'strength', 'normal', 'section'],
  'bonds.section': [
    'point',
    'tangent1',
    'tangent2',
    'inertia1',
    'inertia2',
    'polarInertia',
    'sectionModulus1',
    'sectionModulus2',
    'torsionModulus',
  ],
  fragments: [
    'id',
    'position',
    'size',
    'mass',
    'material',
    'region',
    'anchored',
    'aggregate',
    'shape',
  ],
  'fragments.shape': ['vertices', 'faces', 'volume', 'inertia'],
  'fragments.shape.faces': ['surface', 'vertices'],
  level: ['spawn', 'camera', 'boxes', 'signs', 'lights'],
  'level.boxes': ['id', 'position', 'size', 'material', 'collidable', 'color', 'rotation'],
  'level.camera': ['position', 'target'],
  'level.lights': ['position', 'color', 'intensity', 'distance'],
  'level.signs': ['position', 'rotation', 'text', 'width', 'height', 'color', 'background'],
  'level.spawn': ['position', 'yaw'],
  materials: [
    'id',
    'youngModulus',
    'poissonRatio',
    'tensionStrength',
    'compressionStrength',
    'shearStrength',
    'bendingStrength',
    'name',
    'color',
    'density',
    'strength',
    'brittleness',
    'friction',
  ],
  regions: ['id', 'name', 'min', 'max'],
};
const CANTILEVER_BEAM_HASH_KEYS = [
  'id',
  'name',
  'color',
  'density',
  'strength',
  'brittleness',
  'friction',
  'youngModulus',
  'poissonRatio',
  'tensionStrength',
  'compressionStrength',
  'shearStrength',
  'bendingStrength',
];

function orderedManifestValue(value: unknown, path: string, scenario: ScenarioId): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => orderedManifestValue(item, path, scenario));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const record = value as Record<string, unknown>;
  const order =
    path === 'materials' && scenario === 'cantilever' && record.id === 5
      ? CANTILEVER_BEAM_HASH_KEYS
      : (MANIFEST_HASH_KEYS[path] ?? []);
  const keys = Object.keys(record).filter((key) => path !== '' || key !== 'assetHash');
  const ordered = [
    ...order.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !order.includes(key)).sort(),
  ];
  return Object.fromEntries(
    ordered.map((key) => [
      key,
      orderedManifestValue(record[key], path ? `${path}.${key}` : key, scenario),
    ]),
  );
}

export function hashManifest(manifest: Omit<DestructibleManifest, 'assetHash'>): string {
  let hash = 2_166_136_261;
  const source = JSON.stringify(orderedManifestValue(manifest, '', manifest.scenario));
  for (let i = 0; i < source.length; i++) {
    hash = Math.imul(hash ^ source.charCodeAt(i), 16_777_619);
  }
  return `cascade-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export { createOrganicScenario } from './organic';
export { createComplexScenario } from './complex';

export function generateContactBonds(
  fragments: Array<FragmentDef>,
  tolerance = 0.035,
): Array<BondDef> {
  const bonds: Array<BondDef> = [];
  for (let a = 0; a < fragments.length; a++) {
    for (let b = a + 1; b < fragments.length; b++) {
      const fa = fragments[a]!,
        fb = fragments[b]!;
      const overlap = [0, 1, 2].map(
        (axis) =>
          Math.min(
            fa.position[axis]! + fa.size[axis]! / 2,
            fb.position[axis]! + fb.size[axis]! / 2,
          ) -
          Math.max(
            fa.position[axis]! - fa.size[axis]! / 2,
            fb.position[axis]! - fb.size[axis]! / 2,
          ),
      );
      if (overlap.some((value) => value < -tolerance)) {
        continue;
      }
      const axis = overlap.indexOf(Math.min(...overlap));
      const other = [0, 1, 2].filter((value) => value !== axis);
      if (overlap[other[0]!]! < 0.045 || overlap[other[1]!]! < 0.045) {
        continue;
      }
      const normal: Vec3 = [0, 0, 0];
      normal[axis] = fb.position[axis]! >= fa.position[axis]! ? 1 : -1;
      const strength = Math.min(MATERIALS[fa.material]!.strength, MATERIALS[fb.material]!.strength);
      const variance = 0.93 + ((((fa.id * 73_856_093) ^ (fb.id * 19_349_663)) >>> 0) % 101) / 1000;
      bonds.push({
        a: fa.id,
        area: overlap[other[0]!]! * overlap[other[1]!]!,
        b: fb.id,
        id: bonds.length + 1,
        normal,
        strength: strength * variance,
      });
    }
  }
  return bonds;
}

class FixtureBuilder {
  fragments: Array<FragmentDef> = [];
  constructor(
    readonly scenario: ScenarioId,
    readonly name: string,
    readonly regions: Array<RegionDef>,
  ) {}
  add(
    position: Vec3,
    size: Vec3,
    material: number,
    region: number,
    anchored = false,
    aggregate = 0,
  ) {
    this.fragments.push({
      aggregate,
      anchored,
      id: this.fragments.length + 1,
      mass: size[0] * size[1] * size[2] * MATERIALS[material]!.density,
      material,
      position,
      region,
      size,
    });
  }
  build(): DestructibleManifest {
    const manifest = {
      bonds: generateContactBonds(this.fragments),
      coordinateSystem: 'Y_UP_RH' as const,
      fragments: this.fragments,
      materials: MATERIALS.map((m) => ({ ...m })),
      name: this.name,
      regions: this.regions,
      scenario: this.scenario,
      schemaVersion: 1 as const,
    };
    return { ...manifest, assetHash: hashManifest(manifest) };
  }
}

function building(): DestructibleManifest {
  const builder = new FixtureBuilder(
    'building',
    'Meridian / concrete frame',
    [0, 1, 2].map((floor) => ({
      id: floor,
      max: [5.1, floor === 2 ? 10 : floor * 3 + 3.5, 5.1] as Vec3,
      min: [-5.1, floor * 3 - 0.1, -5.1] as Vec3,
      name: ['Ground / foundation', 'Level 01', 'Level 02 / roof'][floor]!,
    })),
  );
  for (let level = 0; level <= 3; level++) {
    for (let x = 0; x < 10; x++) {
      for (let z = 0; z < 10; z++) {
        builder.add(
          [x - 4.5, level * 3 + 0.16, z - 4.5],
          [0.988, 0.24, 0.988],
          1,
          Math.min(level, 2),
          level === 0,
          level * 100 + Math.floor(x / 2) * 5 + Math.floor(z / 2),
        );
      }
    }
  }
  const pillars: Array<[number, number]> = [];
  for (const x of [-4.5, -1.5, 1.5, 4.5]) {
    for (const z of [-4.5, -1.5, 1.5, 4.5]) {
      pillars.push([x, z]);
    }
  }
  for (let floor = 0; floor < 3; floor++) {
    for (let pillar = 0; pillar < pillars.length; pillar++) {
      for (let row = 0; row < 5; row++) {
        const [x, z] = pillars[pillar]!;
        builder.add(
          [x, floor * 3 + 0.556 + row * 0.552, z],
          [0.46, 0.54, 0.46],
          3,
          floor,
          false,
          400 + floor * 20 + pillar,
        );
      }
    }
    for (let bay = 0; bay < 10; bay++) {
      if ([0, 3, 6, 9].includes(bay)) {
        continue;
      }
      const p = bay - 4.5;
      for (let row = 0; row < 5; row++) {
        const y = floor * 3 + 0.556 + row * 0.552;
        const sillOrLintel = row === 0 || row === 4;
        const material = sillOrLintel ? 2 : 4;
        builder.add(
          [p, y, -4.5],
          [0.988, 0.54, 0.22],
          material,
          floor,
          false,
          500 + floor * 40 + bay,
        );
        builder.add(
          [-4.5, y, p],
          [0.22, 0.54, 0.988],
          material,
          floor,
          false,
          510 + floor * 40 + bay,
        );
        if (sillOrLintel || [1, 2, 7, 8].includes(bay)) {
          builder.add(
            [p, y, 4.5],
            [0.988, 0.54, 0.22],
            material,
            floor,
            false,
            520 + floor * 40 + bay,
          );
        }
        if (sillOrLintel || [4, 5].includes(bay)) {
          builder.add(
            [4.5, y, p],
            [0.22, 0.54, 0.988],
            material,
            floor,
            false,
            530 + floor * 40 + bay,
          );
        }
      }
    }
  }
  for (let cell = 0; cell < 10; cell++) {
    builder.add([cell - 4.5, 9.565, -4.5], [0.988, 0.56, 0.24], 0, 2, false, 700);
    builder.add([cell - 4.5, 9.565, 4.5], [0.988, 0.56, 0.24], 0, 2, false, 701);
    if (cell !== 0 && cell !== 9) {
      builder.add([-4.5, 9.565, cell - 4.5], [0.24, 0.56, 0.988], 0, 2, false, 702);
      builder.add([4.5, 9.565, cell - 4.5], [0.24, 0.56, 0.988], 0, 2, false, 703);
    }
  }
  return builder.build();
}

function wall(): DestructibleManifest {
  const builder = new FixtureBuilder('wall', 'Wall / 1,000-cell fracture', [
    { id: 0, max: [0.1, 6.6, 0.5], min: [-7.1, 0, -0.5], name: 'West wall' },
    { id: 1, max: [7.1, 6.6, 0.5], min: [-0.1, 0, -0.5], name: 'East wall' },
  ]);
  for (let x = 0; x < 40; x++) {
    for (let y = 0; y < 25; y++) {
      builder.add(
        [x * 0.35 - 6.825, y * 0.26 + 0.13, 0],
        [0.344, 0.254, 0.32],
        y % 8 === 0 ? 1 : 0,
        x < 20 ? 0 : 1,
        y === 0,
        Math.floor(x / 4) * 10 + Math.floor(y / 4),
      );
    }
  }
  return builder.build();
}

function cantilever(): DestructibleManifest {
  const builder = new FixtureBuilder('cantilever', 'Cantilever / reinforced bending study', [
    {
      id: 0,
      max: [-3.8, 5.1, 2.1],
      min: [-5.1, 0, -2.1],
      name: 'Anchor pier',
    },
    {
      id: 1,
      max: [5.1, 5.1, 2.1],
      min: [-5.1, 3, -2.1],
      name: 'Unsupported span',
    },
  ]);
  for (let x = 0; x < 2; x++) {
    for (let y = 0; y < 8; y++) {
      for (let z = 0; z < 8; z++) {
        builder.add(
          [-4.75 + x * 0.5, 0.25 + y * 0.5, -1.75 + z * 0.5],
          [0.49, 0.49, 0.49],
          3,
          0,
          y === 0,
          Math.floor(y / 2) * 4 + Math.floor(z / 2),
        );
      }
    }
  }
  for (let x = 0; x < 20; x++) {
    for (let z = 0; z < 8; z++) {
      builder.add(
        [-4.75 + x * 0.5, 4.15, -1.75 + z * 0.5],
        [0.49, 0.29, 0.49],
        1,
        1,
        false,
        100 + Math.floor(x / 2) * 4 + Math.floor(z / 2),
      );
    }
  }
  for (let x = 0; x < 20; x++) {
    for (const z of [-1.75, 1.75]) {
      builder.add([-4.75 + x * 0.5, 4.55, z], [0.49, 0.49, 0.22], 2, 1, false, 200 + x);
    }
  }
  const manifest = builder.build();
  const beamMaterial: MaterialDef = {
    bendingStrength: 30e6,
    brittleness: 0.45,
    color: '#bcb7a9',
    compressionStrength: 50e6,
    density: 2500,
    friction: 0.8,
    id: 5,
    name: 'Prestressed concrete beam',
    poissonRatio: 0.2,
    shearStrength: 8e6,
    strength: 1.8,
    tensionStrength: 24e6,
    youngModulus: 35e9,
  };
  const previousMaterials = new Map(
    manifest.fragments.map((f) => [f.id, manifest.materials.find((m) => m.id === f.material)!]),
  );
  manifest.materials.push(beamMaterial);
  for (const fragment of manifest.fragments) {
    if (fragment.region === 1) {
      fragment.material = beamMaterial.id;
      fragment.mass = fragment.size[0] * fragment.size[1] * fragment.size[2] * beamMaterial.density;
    }
  }
  for (const bond of manifest.bonds) {
    const a = manifest.fragments.find((f) => f.id === bond.a)!,
      b = manifest.fragments.find((f) => f.id === bond.b)!;
    const previous = Math.min(
      previousMaterials.get(bond.a)!.strength,
      previousMaterials.get(bond.b)!.strength,
    );
    const next = Math.min(
      manifest.materials.find((m) => m.id === a.material)!.strength,
      manifest.materials.find((m) => m.id === b.material)!.strength,
    );
    bond.strength = (bond.strength / previous) * next;
  }
  const { assetHash: _, ...content } = manifest;
  manifest.assetHash = hashManifest(content);
  return manifest;
}

function bridge(): DestructibleManifest {
  const builder = new FixtureBuilder('bridge', 'Bridge / twin-pier span', [
    { id: 0, max: [-3.8, 4.1, 2.1], min: [-6, 0, -2.1], name: 'West pier' },
    { id: 1, max: [7.1, 4.9, 2.1], min: [-7.1, 3.4, -2.1], name: 'Deck' },
    { id: 2, max: [6, 4.1, 2.1], min: [3.8, 0, -2.1], name: 'East pier' },
  ]);
  for (const side of [-1, 1]) {
    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 7; y++) {
        for (let z = 0; z < 8; z++) {
          builder.add(
            [side * 4.75 + (x - 0.5) * 0.5, 0.25 + y * 0.5, -1.75 + z * 0.5],
            [0.49, 0.49, 0.49],
            3,
            side < 0 ? 0 : 2,
            y === 0,
            (side + 1) * 20 + Math.floor(y / 2) * 4 + Math.floor(z / 2),
          );
        }
      }
    }
  }
  for (let x = 0; x < 28; x++) {
    for (let z = 0; z < 8; z++) {
      builder.add(
        [-6.75 + x * 0.5, 3.65, -1.75 + z * 0.5],
        [0.49, 0.29, 0.49],
        1,
        1,
        false,
        100 + Math.floor(x / 2) * 4 + Math.floor(z / 2),
      );
    }
  }
  for (let x = 0; x < 28; x++) {
    for (const z of [-1.75, 1.75]) {
      builder.add([-6.75 + x * 0.5, 4.05, z], [0.49, 0.49, 0.22], 2, 1, false, 200 + x);
    }
  }
  return builder.build();
}

export function createScenario(id: ScenarioId): DestructibleManifest {
  switch (id) {
    case 'building':
      return building();
    case 'wall':
      return wall();
    case 'cantilever':
      return cantilever();
    case 'bridge':
      return bridge();
    case 'complex':
      return createComplexScenario();
    default:
      throw new Error(`Unknown scenario: ${String(id)}`);
  }
}
