import {
  VERSIONS,
  type Rect,
  type Region,
  type RuntimeConfig,
  type ScenarioId,
  type TacticalMap,
  type TacticalNode,
  type Vec3,
} from '@blacksite/ai-schema';
import { insideObstacle, lineClear, distance } from '../../sim-core/src/math';
export const SCENARIOS: Array<{
  description: string;
  id: ScenarioId;
  name: string;
}> = [
  {
    description: 'Offset foundry buildings open onto a court through two corner approaches.',
    id: 'crossfire',
    name: 'Courtyard / Crossfire',
  },
  {
    description:
      'An offset vestibule, enclosed relay room, and service exits demand a deliberate entry.',
    id: 'breach',
    name: 'Threshold / Breach',
  },
  {
    description: 'Twelve connected chambers have staggered doors and competing search routes.',
    id: 'search',
    name: 'Blindside / Search',
  },
  {
    description: 'Protected recovery pockets feed zigzag approaches with relief cut-throughs.',
    id: 'casualty',
    name: 'Switchback / Casualty',
  },
  {
    description: 'Rack aisles, offset endcaps, and loading bays reward conserving ammunition.',
    id: 'low-ammo',
    name: 'Warehouse / Last magazine',
  },
  {
    description: 'A narrow S-bend competes with longer north and south service routes.',
    id: 'deadlock',
    name: 'Dogleg / Single file',
  },
];
export type ScenarioDefinition = {
  initialAmmo: number;
  initialHealth: (team: string, index: number) => number;
  map: TacticalMap;
};
export type TacticalAnchor = {
  id: string;
  kind: TacticalNode['kind'];
  x: number;
  z: number;
};
type Anchor = TacticalAnchor;
type Layout = {
  alphaZ: number;
  anchors: Array<Anchor>;
  bravoZ: number;
  objective: Vec3;
  obstacles: Array<Rect>;
  regions: Array<Region>;
};
const point = (x: number, z: number): Vec3 => ({ x, y: 0, z });
const block = (
  id: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  height = 3.3,
): Rect => ({ depth, height, id, width, x, z });
const wallX = (id: string, x: number, from: number, to: number, width = 1.2) =>
  block(id, x, (from + to) / 2, width, to - from);
const wallZ = (id: string, z: number, from: number, to: number, depth = 1.2) =>
  block(id, (from + to) / 2, z, to - from, depth);
const region = (
  id: string,
  name: string,
  x: number,
  z: number,
  neighbors: Array<string>,
): Region => ({
  center: point(x, z),
  id,
  name,
  neighbors,
});
const entry = (id: string, x: number, z: number): Anchor => ({ id, kind: 'entry', x, z });
const overwatch = (id: string, x: number, z: number): Anchor => ({ id, kind: 'overwatch', x, z });
function courtyard(): Layout {
  return {
    alphaZ: 0,
    anchors: [
      entry('west-turn', -16, -8),
      entry('north-court-entry', -5, -10),
      entry('south-court-entry', -5, 10),
      entry('east-turn', 16, 8),
      overwatch('court-west-angle', -4, 2),
      overwatch('court-east-angle', 3, 8),
    ],
    bravoZ: 0,
    objective: point(0, 5),
    obstacles: [
      block('west-foundry', -11, -4, 8, 16, 4.2),
      block('east-machine-hall', 10, 4, 8, 16, 4.2),
      block('north-service-house', -1, -16, 10, 4, 3.8),
      block('south-loading-house', 1, 16, 10, 4, 3.8),
      wallX('west-court-screen', -18, 0, 18),
      wallX('east-court-screen', 18, -18, 0),
      block('alpha-north-store', -21, -14, 6, 8),
      block('alpha-south-store', -21, 14, 6, 8),
      block('bravo-north-store', 21, -14, 6, 8),
      block('bravo-south-store', 21, 14, 6, 8),
      block('central-generator', -1, -2, 4, 4, 2.8),
      block('court-south-screen', -5.5, 7, 2, 5),
      block('court-north-screen', 5, -7, 2, 5),
      wallZ('east-corner-return', 2, 14, 16),
      block('court-offset-return', 3, 0.5, 2, 3),
    ],
    regions: [
      region('west-staging', 'West staging', -21, 0, ['north-turn', 'west-corner']),
      region('north-turn', 'North approach', -11, -14, ['west-staging', 'north-court']),
      region('north-court', 'North court', 1, -9, ['north-turn', 'relay-court', 'east-corner']),
      region('west-corner', 'West corner', -16, 6, ['west-staging', 'south-court']),
      region('south-court', 'South approach', -1, 10, ['west-corner', 'relay-court', 'south-turn']),
      region('relay-court', 'Relay court', 0, 5, ['north-court', 'south-court']),
      region('south-turn', 'South turn', 11, 14, ['south-court', 'east-staging']),
      region('east-corner', 'East corner', 16, -6, ['north-court', 'east-staging']),
      region('east-staging', 'East staging', 21, 0, ['east-corner', 'south-turn']),
    ],
  };
}
function breach(): Layout {
  return {
    alphaZ: 7,
    anchors: [
      entry('north-service-door', -2, -13.5),
      entry('staging-door', -14, -3),
      entry('front-door', -2, -5),
      entry('service-door', -2, 11),
      entry('back-door', 6, 9),
      entry('rear-door', 14, 4),
      overwatch('room-west-angle', 0, 1),
    ],
    bravoZ: -6,
    objective: point(6, 3),
    obstacles: [
      wallX('staging-upper-wall', -14, -18, -5),
      wallX('staging-lower-wall', -14, -1, 18),
      block('vestibule-baffle', -8, -4, 1.5, 6),
      wallX('entry-wall-upper', -2, -18, -15),
      wallX('entry-wall-middle', -2, -12, -7),
      wallX('entry-wall-lower', -2, -3, 9),
      wallX('service-return-wall', -2, 13, 18),
      wallZ('relay-room-north', -9, -2, 14),
      wallZ('relay-room-south-west', 9, -2, 4),
      wallZ('relay-room-south-east', 9, 8, 14),
      wallX('relay-room-east-upper', 14, -9, 2),
      wallX('relay-room-east-lower', 14, 6, 18),
      block('relay-equipment', 5, -1, 3, 3, 2.6),
      block('north-service-baffle', 5, -15, 3, 6),
      block('west-storage', -20, -13, 8, 10),
      block('east-loading-store', 21, 14, 6, 8),
      block('east-service-store', 21, -15, 6, 6),
      block('south-service-baffle', 6, 16, 3, 4),
      block('staging-short-return', -21, 1, 6, 1.2),
      wallZ('vestibule-return', 5, -14, -7),
      wallZ('room-south-return', 4, -2, 4.5),
      wallZ('vestibule-upper-return', -11, -9, -2),
    ],
    regions: [
      region('staging', 'Entry staging', -21, 7, ['vestibule', 'south-vestibule']),
      region('vestibule', 'Offset vestibule', -10, -3, ['staging', 'relay-room', 'north-service']),
      region('south-vestibule', 'Service vestibule', -7, 11, ['staging', 'back-exit']),
      region('north-service', 'North service', 8, -13, ['vestibule', 'rear-staging']),
      region('relay-room', 'Relay room', 6, 3, ['vestibule', 'back-exit', 'rear-staging']),
      region('back-exit', 'Back exit', 6, 11, ['south-vestibule', 'relay-room', 'rear-staging']),
      region('rear-staging', 'Rear staging', 21, -6, ['north-service', 'relay-room', 'back-exit']),
    ],
  };
}
function search(): Layout {
  const obstacles = [
    wallX('west-partition-a', -12, -18, -11),
    wallX('west-partition-b', -12, -7, 5),
    wallX('west-partition-c', -12, 9, 18),
    wallX('middle-partition-a', 0, -18, -3),
    wallX('middle-partition-b', 0, 1, 12),
    wallX('middle-partition-c', 0, 16, 18),
    wallX('east-partition-a', 12, -18, -13),
    wallX('east-partition-b', 12, -9, 3),
    wallX('east-partition-c', 12, 7, 18),
    wallZ('upper-transverse-a', -6, -24, -18),
    wallZ('upper-transverse-b', -6, -14, -6),
    wallZ('upper-transverse-c', -6, -2, 8),
    wallZ('upper-transverse-d', -6, 12, 24),
    wallZ('lower-transverse-a', 6, -24, -8),
    wallZ('lower-transverse-b', 6, -4, 4),
    wallZ('lower-transverse-c', 6, 8, 18),
    wallZ('lower-transverse-d', 6, 22, 24),
    block('west-room-lockers', -19, 1, 4, 3),
    block('north-room-lockers', -6, -12, 4, 3),
    block('south-room-lockers', 6, 12, 3, 4),
    block('east-room-lockers', 19, -12, 4, 3),
    block('lower-west-lockers', -6, 12, 3, 3),
    block('relay-room-console', 7, -2, 3, 3),
    block('middle-room-lockers', -6, 1, 3, 3),
    block('relay-room-return', 4, 1.3, 2, 2.2),
  ];
  const regions: Array<Region> = [];
  const centers = [
    [-20, -11],
    [-7, -9],
    [6, -11],
    [20, -9],
    [-20, -2],
    [-9, 0],
    [7, 3],
    [20, 0],
    [-19, 11],
    [-7, 9],
    [3, 11],
    [20, 11],
  ];
  const links = [
    [1, 4],
    [0, 5],
    [3, 6],
    [2, 7],
    [0, 5],
    [1, 4, 6, 9],
    [2, 5, 7, 10],
    [3, 6, 11],
    [9],
    [5, 8, 10],
    [6, 9],
    [7],
  ];
  centers.forEach(([x, z], index) =>
    regions.push(
      region(
        `chamber-${index}`,
        index === 6 ? 'Relay chamber' : `Chamber ${index + 1}`,
        x!,
        z!,
        links[index]!.map((next) => `chamber-${next}`),
      ),
    ),
  );
  return {
    alphaZ: -10,
    anchors: [
      entry('west-upper-door', -12, -9),
      entry('west-lower-door', -12, 7),
      entry('center-door', 0, -1),
      entry('center-lower-door', 0, 14),
      entry('east-upper-door', 12, -11),
      entry('east-lower-door', 12, 5),
      entry('upper-door-west', -16, -6),
      entry('upper-door-middle', -4, -6),
      entry('upper-door-east', 10, -6),
      entry('lower-door-west', -6, 6),
      entry('lower-door-middle', 6, 6),
      entry('lower-door-east', 20, 6),
    ],
    bravoZ: 10,
    objective: point(7, 3),
    obstacles,
    regions,
  };
}
function casualty(): Layout {
  return {
    alphaZ: 0,
    anchors: [
      entry('west-relief-gap', -14, -8.5),
      entry('west-switch-turn', -14, 6),
      entry('inner-relief-gap', -4, 11.5),
      entry('inner-upper-turn', -4, -5),
      entry('east-relief-gap', 7, -9.5),
      entry('east-switch-turn', 7, 7),
      entry('rear-relief-gap', 17, 10.5),
    ],
    bravoZ: 0,
    objective: point(1, -7),
    obstacles: [
      wallX('west-upper-barricade', -14, -18, -10),
      wallX('west-main-barricade', -14, -7, 4),
      wallX('inner-lower-barricade', -4, -3, 10),
      wallX('inner-return-barricade', -4, 13, 18),
      wallX('east-upper-barricade', 7, -18, -11),
      wallX('east-main-barricade', 7, -8, 5),
      wallX('rear-main-barricade', 17, -5, 9),
      wallX('rear-return-barricade', 17, 12, 18),
      block('recovery-north-shelter', -21, -14, 6, 8),
      block('recovery-south-shelter', -21, 14, 6, 8),
      block('rear-north-shelter', 21, -14, 6, 8),
      block('rear-south-shelter', 21, 16, 6, 4),
      block('zigzag-west-stop', -9, 8, 3, 4),
      block('zigzag-east-stop', 12, -9, 3, 4),
      block('relay-weather-shelter', 1, -12.5, 4, 7),
      block('south-triage-store', 1, 14, 4, 8),
      block('recovery-pocket-cover', -19, -3, 3, 2, 2.4),
      block('central-switch-stop', 1, 1, 5, 4),
      wallZ('west-switch-return', -2, -14, -9.5),
      wallZ('east-switch-return', 2.5, 10, 17),
      block('west-switch-inner-stop', -8, -3, 2, 5),
      block('upper-relief-sight-return', -6, -9, 3, 4),
    ],
    regions: [
      region('recovery', 'Recovery pocket', -21, 0, ['west-relief', 'west-switch']),
      region('west-relief', 'Upper relief', -10, -9, ['recovery', 'relay-pocket']),
      region('west-switch', 'West switchback', -10, 5, ['recovery', 'lower-relief']),
      region('lower-relief', 'Lower relief', -1, 8, ['west-switch', 'relay-pocket', 'east-switch']),
      region('relay-pocket', 'Relay pocket', 1, -7, ['west-relief', 'lower-relief', 'east-relief']),
      region('east-relief', 'East relief', 10, -5, ['relay-pocket', 'rear-pocket']),
      region('east-switch', 'East switchback', 11, 7, ['lower-relief', 'rear-pocket']),
      region('rear-pocket', 'Rear recovery', 21, 0, ['east-relief', 'east-switch']),
    ],
  };
}
function warehouse(): Layout {
  return {
    alphaZ: 0,
    anchors: [
      entry('west-upper-loading', -17, -7),
      entry('west-lower-loading', -17, 7),
      entry('east-upper-loading', 17, -7),
      entry('east-lower-loading', 17, 7),
      entry('north-crossover', 2, -9),
      entry('south-crossover', -2, 9),
      entry('center-crossover', 0, 0),
      overwatch('upper-aisle-angle', -2, -5),
      overwatch('lower-aisle-angle', 3, 5),
    ],
    bravoZ: 0,
    objective: point(0, 4),
    obstacles: [
      block('rack-north-west', -8, -9, 16, 3, 3.8),
      block('rack-north-east', 10, -9, 12, 3, 3.8),
      block('rack-center-west', -9, 0, 12, 3, 3.8),
      block('rack-center-east', 9, 0, 12, 3, 3.8),
      block('rack-south-west', -10, 9, 12, 3, 3.8),
      block('rack-south-east', 8, 9, 16, 3, 3.8),
      block('north-aisle-endcap', -5, -4.5, 2, 6),
      block('south-aisle-endcap', 6, 4.5, 2, 6),
      block('north-loading-baffle', 0, -15, 3, 6),
      block('south-loading-baffle', 0, 15, 3, 6),
      wallX('west-loading-screen', -18, -6, 6),
      wallX('east-loading-screen', 18, -6, 6),
      block('west-upper-store', -21, -14, 6, 8),
      block('west-lower-store', -21, 14, 6, 8),
      block('east-upper-store', 21, -14, 6, 8),
      block('east-lower-store', 21, 14, 6, 8),
      block('north-outer-endcap', -8, -12, 2, 3),
      block('south-outer-endcap', 8, 12, 2, 3),
    ],
    regions: [
      region('west-loading', 'West loading', -21, 0, ['upper-west-aisle', 'lower-west-aisle']),
      region('upper-west-aisle', 'West upper aisle', -10, -5, ['west-loading', 'north-crossover']),
      region('lower-west-aisle', 'West lower aisle', -10, 5, ['west-loading', 'relay-aisle']),
      region('north-crossover', 'North crossover', 2, -9, [
        'upper-west-aisle',
        'upper-east-aisle',
        'relay-aisle',
      ]),
      region('relay-aisle', 'Relay aisle', 0, 4, [
        'lower-west-aisle',
        'north-crossover',
        'south-crossover',
      ]),
      region('south-crossover', 'South crossover', -2, 9, ['relay-aisle', 'lower-east-aisle']),
      region('upper-east-aisle', 'East upper aisle', 10, -5, ['north-crossover', 'east-loading']),
      region('lower-east-aisle', 'East lower aisle', 11, 5, ['south-crossover', 'east-loading']),
      region('east-loading', 'East loading', 21, 0, ['upper-east-aisle', 'lower-east-aisle']),
    ],
  };
}
function dogleg(): Layout {
  return {
    alphaZ: -3,
    anchors: [
      entry('narrow-portal', -14, 0),
      entry('dogleg-first-turn', -1, 0),
      entry('dogleg-second-turn', 1.1, 5),
      entry('east-passage-mouth', 16, 5),
      entry('north-service-gap', -4, -14),
      entry('south-service-gap', 6, 14),
      overwatch('passage-angle', 11, 5),
    ],
    bravoZ: 6,
    objective: point(6, 5),
    obstacles: [
      block('west-upper-service-block', -8.5, -7.5, 13, 11, 4),
      block('east-upper-service-block', 8.5, -5, 13, 16, 4),
      block('west-lower-service-block', -8.5, 7.5, 13, 11, 4),
      block('east-lower-service-block', 8.5, 10, 13, 6, 4),
      block('west-portal-upper-jamb', -14, -1.35, 2, 1.4),
      block('west-portal-lower-jamb', -14, 1.35, 2, 1.4),
      block('connector-upper-plug', 0, -4, 4, 4),
      block('connector-lower-plug', 0, 11, 4, 8),
      block('dogleg-sight-baffle', -0.8, 1.5, 2.4, 0.8),
      block('north-reroute-chicane', -4, -16.5, 2, 3),
      block('south-reroute-chicane', 6, 16.5, 2, 3),
      block('north-reroute-return', 4, -14, 2, 2),
      block('south-reroute-return', -5, 14, 2, 2),
      block('west-upper-store', -21, -14, 6, 8),
      block('west-lower-store', -21, 14, 6, 8),
      block('east-upper-store', 21, -14, 6, 8),
      block('east-lower-store', 21, 16, 6, 4),
      wallX('east-entry-screen', 18, 2, 11),
    ],
    regions: [
      region('west-staging', 'Portal staging', -21, -3, [
        'west-throat',
        'north-service',
        'south-service',
      ]),
      region('west-throat', 'Single-file throat', -9, 0, ['west-staging', 'dogleg-connector']),
      region('dogleg-connector', 'Dogleg connector', 1.1, 3.8, ['west-throat', 'relay-passage']),
      region('north-service', 'North reroute', -8, -15, ['west-staging', 'north-return']),
      region('north-return', 'North return', 8, -15, ['north-service', 'east-staging']),
      region('south-service', 'South reroute', -8, 15, ['west-staging', 'south-return']),
      region('south-return', 'South return', 11, 15, ['south-service', 'east-staging']),
      region('relay-passage', 'Relay passage', 6, 5, ['dogleg-connector', 'east-staging']),
      region('east-staging', 'Return staging', 21, 6, [
        'relay-passage',
        'north-return',
        'south-return',
      ]),
    ],
  };
}
const layouts: Record<ScenarioId, () => Layout> = {
  breach,
  casualty,
  crossfire: courtyard,
  deadlock: dogleg,
  'low-ammo': warehouse,
  search,
};
export type TacticalBakeOptions = {
  spacing?: number;
};
export function bakeTacticalNodes(
  map: TacticalMap,
  anchors: Array<TacticalAnchor> = [],
  options: TacticalBakeOptions = {},
): Array<TacticalNode> {
  const spacing = Math.max(1, options.spacing ?? 3),
    reachX = Math.floor((map.width / 2 - 3) / spacing) * spacing,
    reachZ = Math.floor((map.depth / 2 - 3) / spacing) * spacing;
  const nodes: Array<TacticalNode> = [],
    coordinates = new Set<string>();
  const add = (id: string, position: Vec3, kind?: TacticalNode['kind']) => {
    const key = `${position.x}:${position.z}`;
    if (coordinates.has(key) || insideObstacle(map, position, 0.42)) {
      return;
    }
    coordinates.add(key);
    const nearestCover = Math.min(
      ...map.obstacles.map((rect) =>
        Math.hypot(
          Math.max(0, Math.abs(position.x - rect.x) - rect.width / 2),
          Math.max(0, Math.abs(position.z - rect.z) - rect.depth / 2),
        ),
      ),
    );
    const visibleRegions = map.regions.filter((region) =>
      lineClear(map, position, region.center, 0.25),
    );
    const regionId = [...(visibleRegions.length ? visibleRegions : map.regions)].sort(
      (a, b) =>
        distance(a.center, position) - distance(b.center, position) || a.id.localeCompare(b.id),
    )[0]!.id;
    nodes.push({
      capacity: 1,
      cover: Math.max(0.08, 1 - nearestCover / 5),
      exposure: Math.min(0.95, 0.25 + nearestCover / 8),
      id,
      kind: kind ?? (nearestCover < 2 ? 'cover' : 'search'),
      neighbors: [],
      position,
      regionId,
    });
  };
  for (const objective of map.objectives) {
    add(`objective:${objective.id}`, { ...objective.position }, 'objective');
  }
  for (const anchor of anchors) {
    add(`anchor:${anchor.id}`, point(anchor.x, anchor.z), anchor.kind);
  }
  for (const region of map.regions) {
    add(`region:${region.id}`, { ...region.center }, 'search');
  }
  for (const team of ['alpha', 'bravo'] as const) {
    map.spawns[team].forEach((position, i) => add(`rally:${team}:${i}`, { ...position }, 'rally'));
  }
  for (let x = -reachX; x <= reachX; x += spacing) {
    for (let z = -reachZ; z <= reachZ; z += spacing) {
      add(`slot:${x}:${z}`, point(x, z));
    }
  }
  for (const obstacle of map.obstacles) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        add(
          `corner:${obstacle.id}:${sx}:${sz}`,
          point(
            obstacle.x + sx * (obstacle.width / 2 + 0.55),
            obstacle.z + sz * (obstacle.depth / 2 + 0.55),
          ),
          'cover',
        );
      }
    }
  }
  for (const node of nodes) {
    node.neighbors = nodes
      .filter(
        (other) =>
          other !== node &&
          distance(node.position, other.position) <= 6.1 &&
          lineClear(map, node.position, other.position, 0.4),
      )
      .map((other) => other.id)
      .sort();
  }
  return nodes;
}
export function createScenario(id: ScenarioId, agentsPerTeam = 5): ScenarioDefinition {
  const make = layouts[id];
  if (!make) {
    throw new Error(`Unknown scenario: ${id}`);
  }
  const layout = make(),
    count = Math.max(1, Math.min(8, Math.floor(agentsPerTeam)));
  const spawns = (side: number, centerZ: number): Array<Vec3> =>
    Array.from({ length: count }, (_, index) =>
      point(
        side * (21 + (index % 2) * 1.4),
        centerZ + (Math.floor(index / 2) - (Math.ceil(count / 2) - 1) / 2) * 1.7,
      ),
    );
  const objectiveRegion = [...layout.regions].sort(
    (a, b) => distance(a.center, layout.objective) - distance(b.center, layout.objective),
  )[0]!.id;
  const map: TacticalMap = {
    depth: 36,
    id: `${id}-arena`,
    name: SCENARIOS.find((s) => s.id === id)!.name,
    nodes: [],
    objectives: [{ id: 'relay', position: layout.objective, regionId: objectiveRegion }],
    obstacles: layout.obstacles,
    regions: layout.regions,
    spawns: { alpha: spawns(-1, layout.alphaZ), bravo: spawns(1, layout.bravoZ) },
    version: `${VERSIONS.map}/${id}`,
    width: 48,
  };
  map.nodes = bakeTacticalNodes(map, layout.anchors);
  return {
    initialAmmo: id === 'low-ammo' ? 3 : 24,
    initialHealth: (_team, index) => (id === 'casualty' && index === 0 ? 28 : 100),
    map,
  };
}
export function scenarioConfig(
  id: ScenarioId,
  overrides: Partial<RuntimeConfig> = {},
): Partial<RuntimeConfig> {
  return { scenarioId: id, ...overrides };
}
