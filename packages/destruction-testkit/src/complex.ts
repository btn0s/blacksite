import type {
  DestructibleManifest,
  FragmentDef,
  LevelBox,
  LevelDef,
  Vec3,
} from '../../destruction-domain/src/index';
import { MATERIALS } from './index';
import { fractureBoxMembers, type OrganicMember } from './organic';

export const COMPLEX_STAIR_ROUTE: Array<Vec3> = [
  [0, 0.16, 2.1],
  [-7.15, 0.16, 2.1],
  [-9.05, 0.16, 2.1],
  [-9.05, 1.78, -1.95],
  [-7.15, 1.78, -1.95],
  [-7.15, 3.4, 2.1],
  [-5.3, 3.4, 2.1],
];

export type ComplexPropAsset =
  | 'utility_box_02'
  | 'metal_trash_can'
  | 'exterior_aircon_unit'
  | 'security_light'
  | 'Barrel_01'
  | 'plastic_crate_02'
  | 'cement_bag'
  | 'WetFloorSign_01'
  | 'hand_truck';

export interface ComplexProp {
  asset: ComplexPropAsset;
  collider?: Vec3;
  position: Vec3;
  scale?: number;
  yaw?: number;
}

export const COMPLEX_PROPS: Array<ComplexProp> = [
  {
    asset: 'utility_box_02',
    collider: [0.92, 1.12, 0.44],
    position: [-10.72, 0, -2.75],
    yaw: -Math.PI / 2,
  },
  {
    asset: 'utility_box_02',
    collider: [0.92, 1.12, 0.44],
    position: [-10.72, 0, -1.55],
    yaw: -Math.PI / 2,
  },
  { asset: 'exterior_aircon_unit', position: [-9.35, 7.22, -3.6], yaw: Math.PI },
  { asset: 'exterior_aircon_unit', position: [-7.55, 7.22, -3.6], yaw: Math.PI },
  { asset: 'exterior_aircon_unit', position: [-6.9, 0.32, -5.36], yaw: Math.PI },
  { asset: 'security_light', position: [-6.55, 2.95, 3.3] },
  { asset: 'security_light', position: [-9.2, 2.65, -5.1], yaw: Math.PI },
  { asset: 'metal_trash_can', collider: [0.6, 0.92, 0.6], position: [-5.35, 0, 7.05], yaw: 0.4 },
  { asset: 'metal_trash_can', collider: [0.6, 0.92, 0.6], position: [3.75, 0, 6.6], yaw: -0.9 },
  { asset: 'WetFloorSign_01', position: [1.55, 0.035, 3.75], yaw: -0.35 },
  { asset: 'Barrel_01', collider: [0.58, 0.88, 0.58], position: [9.1, 0, -9.85] },
  { asset: 'Barrel_01', collider: [0.58, 0.88, 0.58], position: [9.75, 0, -9.95], yaw: 1.2 },
  { asset: 'Barrel_01', collider: [0.58, 0.88, 0.58], position: [9.4, 0, -9.3], yaw: 2.3 },
  {
    asset: 'plastic_crate_02',
    collider: [0.52, 0.5, 0.42],
    position: [10.65, 0, -10.05],
    yaw: 0.05,
  },
  { asset: 'plastic_crate_02', position: [10.65, 0.25, -10.05], yaw: -0.08 },
  { asset: 'plastic_crate_02', collider: [0.52, 0.26, 0.42], position: [10.75, 0, -9.5], yaw: 0.3 },
  { asset: 'cement_bag', position: [8.05, 0, -10.05], yaw: Math.PI / 2 },
  { asset: 'cement_bag', position: [8.05, 0.16, -10.02], yaw: Math.PI / 2 + 0.1 },
  { asset: 'cement_bag', position: [8.55, 0, -10.05], yaw: Math.PI / 2 - 0.05 },
  { asset: 'cement_bag', position: [8.3, 0.31, -10.05], yaw: Math.PI / 2 + 0.25 },
  { asset: 'hand_truck', position: [11.25, 0, -8.7], yaw: -2.2 },
];

export interface CompoundProp {
  at: Vec3;
  collider: Vec3;
  id: 'skip' | 'pallet-sheeted' | 'cable-drum';
  tint: number;
  yaw: number;
}

export const COMPOUND_PROPS: Array<CompoundProp> = [
  { at: [6.0, 0, -9.35], collider: [2.4, 1.310724, 1.334342], id: 'skip', tint: 0.8, yaw: 0.12 },
  {
    at: [7.35, 0, -8.05],
    collider: [1.25, 0.809019, 1.246859],
    id: 'pallet-sheeted',
    tint: 0.85,
    yaw: -0.4,
  },
  {
    at: [9.85, 0, -8.05],
    collider: [1.15, 1.149016, 0.787179],
    id: 'cable-drum',
    tint: 0.75,
    yaw: 0.6,
  },
];

export const COMPLEX_BOLLARDS: ReadonlyArray<readonly [number, number]> = [
  [-2.6, 7.5],
  [2.6, 7.5],
];

export const COMPLEX_LAMPS: Array<[number, number]> = [
  [-12.6, 2.6],
  [-12.6, -6.4],
  [12.9, 1.4],
  [12.9, 9.8],
  [-6.4, 13.6],
  [6.4, 13.6],
];

export function createComplexScenario(): DestructibleManifest {
  const fragments: Array<FragmentDef> = [],
    members: Array<OrganicMember> = [];
  const member = (
    min: Vec3,
    max: Vec3,
    grid: Vec3,
    material: number,
    region: number,
    anchored = false,
  ) => {
    const group: Array<FragmentDef> = [],
      aggregate = members.length;
    const size = min.map((value, axis) => (max[axis]! - value) / grid[axis]!) as Vec3;
    for (let x = 0; x < grid[0]; x++) {
      for (let y = 0; y < grid[1]; y++) {
        for (let z = 0; z < grid[2]; z++) {
          const position = [x, y, z].map(
            (step, axis) => min[axis]! + (step + 0.5) * size[axis]!,
          ) as Vec3;
          const fragment: FragmentDef = {
            aggregate,
            anchored,
            id: fragments.length + 1,
            mass: size[0] * size[1] * size[2] * MATERIALS[material]!.density,
            material,
            position,
            region,
            size: [...size],
          };
          fragments.push(fragment);
          group.push(fragment);
        }
      }
    }
    members.push({ fragments: group, max, min });
  };

  for (let floor = 0; floor < 3; floor++) {
    const top = 0.16 + floor * 3.24;
    member([-6, top - 0.26, -5], [6, top, 3], [12, 1, 8], 1, Math.min(floor, 1), floor === 0);
  }
  for (let floor = 0; floor < 2; floor++) {
    const bottom = 0.16 + floor * 3.24,
      top = bottom + 2.98;
    for (const x of [-5.43, 0, 5.43]) {
      for (const z of [-4.43, -0.8, 2.43]) {
        if (x === 0 && z === 2.43) {
          continue;
        }
        const columnZ = x === -5.43 && z === 2.43 ? 0.85 : z;
        member(
          [x - 0.25, bottom, columnZ - 0.25],
          [x + 0.25, top, columnZ + 0.25],
          [1, 4, 1],
          3,
          floor,
        );
      }
    }

    if (floor === 0) {
      for (const [left, right] of [
        [-6, -1.2],
        [1.2, 6],
      ] as const) {
        member([left, bottom, 2.68], [right, bottom + 0.94, 3], [6, 2, 1], 0, floor);
        member([left, bottom + 0.94, 2.8], [right, bottom + 2.3, 2.88], [6, 2, 1], 4, floor);
      }
    } else {
      member([-6, bottom, 2.68], [6, bottom + 0.94, 3], [12, 2, 1], 0, floor);
      member([-6, bottom + 0.94, 2.8], [6, bottom + 2.3, 2.88], [12, 2, 1], 4, floor);
    }
    member([-6, bottom + 2.3, 2.68], [6, top, 3], [12, 1, 1], 0, floor);

    member([-6, bottom, -5], [6, bottom + 1.82, -4.68], [12, 3, 1], 0, floor);
    member([-6, bottom + 1.82, -4.88], [6, bottom + 2.3, -4.8], [12, 1, 1], 4, floor);
    member([-6, bottom + 2.3, -5], [6, top, -4.68], [12, 1, 1], 0, floor);

    member([-6, bottom, -4.68], [-5.68, top, 1.4], [1, 4, 7], 0, floor);
    member([-6, bottom + 2.3, 1.4], [-5.68, top, 2.68], [1, 1, 2], 0, floor);

    if (floor === 1) {
      member([5.68, bottom, -4.68], [6, top, -0.4], [1, 4, 5], 0, floor);
      member([5.68, bottom, 1.4], [6, top, 2.68], [1, 4, 2], 0, floor);
      member([5.68, bottom + 2.3, -0.4], [6, top, 1.4], [1, 1, 3], 0, floor);
    } else {
      member([5.68, bottom, -4.68], [6, top, 2.68], [1, 4, 8], 0, floor);
    }
  }

  member([-6, 6.64, -5], [6, 7.14, -4.72], [12, 1, 1], 0, 1);
  member([-6, 6.64, 2.72], [6, 7.14, 3], [12, 1, 1], 0, 1);
  member([-6, 6.64, -4.72], [-5.72, 7.14, 2.72], [1, 1, 8], 0, 1);
  member([5.72, 6.64, -4.72], [6, 7.14, 2.72], [1, 1, 8], 0, 1);

  member([6, 3.14, -0.8], [8.6, 3.4, 1.8], [4, 1, 4], 1, 2);
  member([8.36, 3.4, -0.8], [8.6, 4.36, 1.8], [1, 2, 4], 0, 2);
  for (const [z0, z1] of [
    [-0.8, -0.56],
    [1.56, 1.8],
  ] as const) {
    member([6, 3.4, z0], [8.36, 4.36, z1], [4, 2, 1], 0, 2);
  }

  const level = createLevel();
  return fractureBoxMembers(
    {
      bonds: [],
      coordinateSystem: 'Y_UP_RH',
      fragments,
      level,
      materials: MATERIALS.map((material) => ({ ...material })),
      name: 'Sector 04 / municipal service annex',
      regions: [
        {
          id: 0,
          max: [6, 3.4, 3],
          min: [-6, -0.1, -5],
          name: 'Public hall / ground',
        },
        {
          id: 1,
          max: [6, 7.14, 3],
          min: [-6, 3.14, -5],
          name: 'Service offices / upper',
        },
        {
          id: 2,
          max: [8.6, 4.36, 1.8],
          min: [6, 3.14, -0.8],
          name: 'East cantilever gallery',
        },
      ],
      scenario: 'complex',
      schemaVersion: 1,
    },
    members,
  );
}

function createLevel(): LevelDef {
  const boxes: Array<LevelBox> = [];
  const box = (
    id: string,
    position: Vec3,
    size: Vec3,
    material: LevelBox['material'],
    collidable = true,
    color?: string,
  ) => {
    const result: LevelBox = {
      collidable,
      id,
      material,
      position,
      size,
      ...(color ? { color } : {}),
    };
    boxes.push(result);
    return result;
  };
  box('courtyard-paving', [0, -0.07, 3], [30, 0.14, 28], 'asphalt');
  box('front-approach-bed', [0, 0.001, 8.5], [5.64, 0.042, 11], 'asphalt', true, '#3b3d3a');
  const slab = 11 / 9,
    joint = 0.012;
  for (let index = 0; index < 9; index++) {
    box(
      `front-approach-${index}`,
      [0, 0.0005, 3 + (index + 0.5) * slab],
      [5.6, 0.069, slab - joint],
      'concrete',
    );
  }
  box('core-foundation', [-8.1, 0.03, -0.9], [4.2, 0.26, 7.8], 'concrete');
  box('core-west-wall', [-10.35, 3.55, -0.9], [0.3, 7.1, 7.8], 'boardConcrete');
  box('core-rear-wall', [-8.1, 3.55, -4.95], [4.8, 7.1, 0.3], 'boardConcrete');
  box('core-roof', [-8.025, 6.77, -0.9], [4.35, 0.26, 8.1], 'concrete');
  box('core-front-left', [-10.05, 3.55, 3.15], [0.6, 7.1, 0.3], 'boardConcrete');
  box('core-front-right', [-7.325, 3.55, 3.15], [2.65, 7.1, 0.3], 'boardConcrete');
  box('core-front-plinth', [-9.2, 0.57, 3.15], [1.1, 1.14, 0.3], 'boardConcrete');
  box('core-front-header', [-9.2, 6.63, 3.15], [1.1, 0.94, 0.3], 'boardConcrete');
  box('core-glazing', [-9.2, 3.65, 3.13], [1.1, 5.02, 0.075], 'glass');
  box('core-top-landing', [-8.1, 3.27, 2.2], [4.2, 0.26, 1.6], 'concrete');
  box('core-half-landing', [-8.1, 1.65, -2.05], [4.2, 0.26, 1.5], 'concrete');
  for (let step = 0; step < 9; step++) {
    const firstTop = 0.16 + (step + 1) * 0.18,
      secondTop = 1.78 + (step + 1) * 0.18;
    box(
      `stair-west-${step}`,
      [-9.05, (0.16 + firstTop) / 2, 1.25 - step * 0.3],
      [1.5, firstTop - 0.16, 0.3],
      'concrete',
    );
    box(
      `stair-east-${step}`,
      [-7.15, (1.52 + secondTop) / 2, -1.15 + step * 0.3],
      [1.5, secondTop - 1.52, 0.3],
      'concrete',
    );
    box(
      `nosing-west-${step}`,
      [-9.05, firstTop + 0.003, 1.385 - step * 0.3],
      [1.45, 0.006, 0.028],
      'paint',
      false,
      '#a99d67',
    );
    box(
      `nosing-east-${step}`,
      [-7.15, secondTop + 0.003, -1.285 + step * 0.3],
      [1.45, 0.006, 0.028],
      'paint',
      false,
      '#a99d67',
    );
  }
  const angle = Math.atan2(1.62, 2.7);
  const railA = box(
    'stair-west-handrail',
    [-9.86, 1.97, 0.05],
    [0.065, 0.065, Math.hypot(2.7, 1.62)],
    'metal',
    false,
    '#566458',
  );
  railA.rotation = [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
  const railB = box(
    'stair-east-handrail',
    [-6.32, 3.59, 0.05],
    [0.065, 0.065, Math.hypot(2.7, 1.62)],
    'metal',
    false,
    '#566458',
  );
  railB.rotation = [-Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
  box('half-landing-guard', [-8.1, 2.23, -2.72], [4.0, 0.9, 0.08], 'paint', true, '#53635c');
  box('top-landing-guard', [-9.2, 3.91, 1.39], [2, 1.02, 0.09], 'paint', true, '#53635c');
  box('core-service-door', [-8.1, 1.23, -4.78], [1.25, 2.14, 0.045], 'paint', false, '#526457');
  box('core-service-door-handle', [-7.63, 1.13, -4.73], [0.035, 0.18, 0.04], 'metal', false);
  box('core-conduit', [-10.16, 3.7, 1.8], [0.045, 5.7, 0.045], 'metal', false, '#787971');
  box('core-utility-box', [-10.14, 1.8, 1.8], [0.14, 0.5, 0.34], 'paint', false, '#4d6057');

  box('west-site-wall', [-14.2, 1.3, 3.25], [0.4, 2.6, 27.7], 'boardConcrete');
  box('rear-site-wall', [0, 1.4, -10.8], [29, 2.8, 0.4], 'boardConcrete');
  box('east-site-wall-a', [14.2, 1.3, -5.3], [0.4, 2.6, 10.6], 'boardConcrete');
  box('east-site-wall-b', [14.2, 1.3, 12.55], [0.4, 2.6, 9.1], 'boardConcrete');
  for (const side of [-1, 1]) {
    box(`south-site-wall-${side}`, [side * 8.875, 1.3, 16.9], [10.25, 2.6, 0.4], 'boardConcrete');
  }
  const palisade = (id: string, center: Vec3, span: number, alongX: boolean) => {
    const bars = Math.round(span / 0.16);
    for (let i = 0; i < bars; i++) {
      const t = -span / 2 + (i + 0.5) * (span / bars);
      box(
        `${id}-bar-${i}`,
        alongX ? [center[0] + t, 1.12, center[2]] : [center[0], 1.12, center[2] + t],
        [0.04, 2.24, 0.04],
        'metal',
        false,
        '#2c3330',
      );
    }
    for (const y of [0.32, 1.9]) {
      box(
        `${id}-rail-${y}`,
        [center[0] + (alongX ? 0 : 0.035), y, center[2] + (alongX ? 0.035 : 0)],
        alongX ? [span, 0.06, 0.03] : [0.03, 0.06, span],
        'metal',
        false,
        '#2c3330',
      );
    }
    box(
      `prop-collider-${id}`,
      [center[0], 1.12, center[2]],
      alongX ? [span, 2.24, 0.2] : [0.2, 2.24, span],
      'metal',
    );
  };
  palisade('gate-south', [0, 0, 16.9], 6.3, true);
  palisade('gate-east', [14.2, 0, 4], 8, false);
  box('bench-west-seat', [-7.9, 0.45, 7], [4.2, 0.18, 0.72], 'concrete');
  box('bench-west-foot-a', [-9.4, 0.18, 7], [0.35, 0.36, 0.58], 'concrete');
  box('bench-west-foot-b', [-6.4, 0.18, 7], [0.35, 0.36, 0.58], 'concrete');
  box('planter-east-n', [10.6, 0.52, 5.58], [2.8, 1.04, 0.16], 'boardConcrete');
  box('planter-east-s', [10.6, 0.52, 7.42], [2.8, 1.04, 0.16], 'boardConcrete');
  box('planter-east-w', [9.28, 0.52, 6.5], [0.16, 1.04, 1.68], 'boardConcrete');
  box('planter-east-e', [11.92, 0.52, 6.5], [0.16, 1.04, 1.68], 'boardConcrete');
  box('planter-soil', [10.6, 0.45, 6.5], [2.48, 0.9, 1.68], 'asphalt', true, '#3a3529');

  const bed = (id: string, x0: number, x1: number, z0: number, z1: number) => {
    const cx = (x0 + x1) / 2,
      cz = (z0 + z1) / 2,
      w = x1 - x0,
      d = z1 - z0,
      k = 0.14;
    box(`${id}-soil`, [cx, 0.05, cz], [w - 2 * k, 0.1, d - 2 * k], 'asphalt', true, '#3a3529');
    box(`${id}-kerb-a`, [cx, 0.09, z0 + k / 2], [w, 0.18, k], 'concrete');
    box(`${id}-kerb-b`, [cx, 0.09, z1 - k / 2], [w, 0.18, k], 'concrete');
    box(`${id}-kerb-c`, [x0 + k / 2, 0.09, cz], [k, 0.18, d - 2 * k], 'concrete');
    box(`${id}-kerb-d`, [x1 - k / 2, 0.09, cz], [k, 0.18, d - 2 * k], 'concrete');
  };
  bed('verge-west', -14, -11.6, 5, 12.4);
  bed('verge-east', 11.6, 14, -9.6, -1.4);
  bed('verge-rear', -9, 4.5, -10.6, -8.9);

  for (const [x, z] of COMPLEX_BOLLARDS) {
    box(`prop-collider-entry-bollard-${x}`, [x, 0.44, z], [0.15, 0.88, 0.15], 'metal');
  }
  for (const side of [-1, 1]) {
    box(
      `courtyard-drain-${side}`,
      [side * 5.17, 0.004, 4.6],
      [4.7, 0.008, 0.14],
      'metal',
      false,
      '#2f3433',
    );
  }
  COMPLEX_PROPS.forEach((prop, index) => {
    if (!prop.collider) {
      return;
    }
    const result = box(
      `prop-collider-${index}-${prop.asset}`,
      [prop.position[0], prop.position[1] + prop.collider[1] / 2, prop.position[2]],
      prop.collider,
      'metal',
    );
    const yaw = prop.yaw ?? 0;
    if (yaw) {
      result.rotation = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    }
  });
  for (const prop of COMPOUND_PROPS) {
    const result = box(
      `prop-collider-compound-${prop.id}`,
      [prop.at[0], prop.at[1] + prop.collider[1] / 2, prop.at[2]],
      prop.collider,
      'metal',
    );
    result.rotation = [0, Math.sin(prop.yaw / 2), 0, Math.cos(prop.yaw / 2)];
  }
  COMPLEX_LAMPS.forEach(([x, z], index) => {
    box(`lamp-plinth-${index}`, [x, 0.25, z], [0.34, 0.5, 0.34], 'concrete');
    box(`prop-collider-lamp-${index}`, [x, 2.95, z], [0.16, 4.9, 0.16], 'metal');
  });
  for (const side of [-1, 1]) {
    box(`gate-pier-${side}`, [side * 3.45, 2.3, 16.9], [0.6, 4.6, 0.9], 'boardConcrete');
  }
  box('gate-lintel', [0, 5.0, 16.9], [8.4, 0.8, 1.4], 'boardConcrete');
  for (const x of [-3.0, -1.0, 1.0, 3.0]) {
    box(`gate-fin-${x}`, [x, 5.65, 16.9], [0.3, 0.5, 2.6], 'concrete');
  }
  box('core-vent-stack', [-8.6, 7.6, -0.4], [1.3, 1.4, 1.7], 'boardConcrete');
  box('core-vent-louvre', [-8.6, 7.65, 0.47], [1.0, 0.8, 0.04], 'paint', false, '#46524b');
  box('core-intake-conduit', [-10.56, 2.1, -2.15], [0.07, 2.0, 0.07], 'metal', false, '#6d706a');
  box('core-intake-tray', [-10.58, 3.12, -2.15], [0.09, 0.07, 2.1], 'metal', false, '#6d706a');
  return {
    boxes,
    camera: { position: [21, 15, 25], target: [-0.8, 2.5, -0.1] },
    lights: [
      {
        color: '#ffdbac',
        distance: 6,
        intensity: 19,
        position: [-8.65, 3.075, 2.2],
      },
      {
        color: '#ffdfb8',
        distance: 8,
        intensity: 28,
        position: [-8.1, 6.575, -1.8],
      },
    ],
    signs: [
      {
        background: '#384842',
        color: '#d7d4c6',
        height: 0.91,
        position: [-7.26, 5.6, 3.307],
        text: 'SECTOR 04\nMUNICIPAL SERVICES',
        width: 2.15,
      },
      {
        background: '#b3b4a8',
        color: '#535b52',
        height: 0.82,
        position: [-7.26, 4.6, 3.307],
        text: 'SERVICE ANNEX\nPUBLIC ENTRANCE  →',
        width: 2.15,
      },
      {
        background: '#405448',
        color: '#dfd9b7',
        height: 0.475,
        position: [-7.3, 1.66, 2.987],
        rotation: [0, Math.PI, 0],
        text: 'STAIR  A\n01  ↑',
        width: 0.85,
      },
      {
        background: '#405448',
        color: '#dad8c2',
        height: 0.475,
        position: [-10.183, 3.35, -1.85],
        rotation: [0, Math.PI / 2, 0],
        text: '01\nSERVICE OFFICES',
        width: 0.85,
      },
      {
        background: '#405448',
        color: '#d9d5bc',
        height: 0.305,
        position: [-8.1, 1.57, -4.749],
        text: 'PLANT\nAUTHORIZED STAFF',
        width: 0.72,
      },
    ],
    spawn: { position: [0, 0.07, 11], yaw: 0 },
  };
}
