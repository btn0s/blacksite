import type { Region, TacticalMap, TacticalNode, TeamId, Vec3 } from '@blacksite/ai-schema';
import type { TacticalSpatialQueries } from './index';
import type { NavigationMesh } from './navigation';

type Point = readonly [number, number, number];
type Sample = { island: number; links: Array<number>; point: Vec3; polygons: Array<number> };

export interface NavigationTacticsOptions {
  depth: number;
  id: string;
  name: string;
  nodeSpacing?: number;
  regionSpacing?: number;
  spawns: Record<TeamId, ReadonlyArray<Vec3>>;
  visibility?: (from: Readonly<Vec3>, to: Readonly<Vec3>) => boolean;
  width: number;
}

const DIRECTIONS: ReadonlyArray<Point> = [
  [1, 0, 0],
  [0, 0, 1],
  [-1, 0, 0],
  [0, 0, -1],
  [Math.SQRT1_2, 0, Math.SQRT1_2],
  [-Math.SQRT1_2, 0, Math.SQRT1_2],
  [-Math.SQRT1_2, 0, -Math.SQRT1_2],
  [Math.SQRT1_2, 0, -Math.SQRT1_2],
];
const EYE_HEIGHT = 1.4;
const COVER_RANGE = 4;
const point = (p: Readonly<Vec3>): Point => [p.x, p.y, p.z];
const vector = (p: Point): Vec3 => ({ x: p[0], y: p[1], z: p[2] });
const distance = (a: Readonly<Vec3>, b: Readonly<Vec3>) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const cell = (p: Vec3, spacing: number, island: number) =>
  `${island}:${Math.floor(p.x / spacing)}:${Math.floor(p.y / 1.5)}:${Math.floor(p.z / spacing)}`;
const pathLength = (start: Vec3, path: ReadonlyArray<Vec3>): number => {
  let length = 0,
    previous = start;
  for (const next of path) {
    length += distance(previous, next);
    previous = next;
  }
  return length;
};

function samplesFor(navigation: NavigationMesh, options: NavigationTacticsOptions): Array<Sample> {
  const cells = new Map<string, Array<Sample>>();
  const samples: Array<Sample> = [];
  const add = (p: Point, island: number, polygon?: number, links: Array<number> = []) => {
    const position = vector(p),
      key = cell(position, options.nodeSpacing ?? 3, island);
    const bucket = cells.get(key) ?? [];
    const existing = bucket.find(
      (sample) =>
        Math.abs(sample.point.y - position.y) < 0.65 &&
        navigation.canTraverse(point(sample.point), p) &&
        navigation.canTraverse(p, point(sample.point)),
    );
    if (existing) {
      if (polygon !== undefined) {
        existing.polygons.push(polygon);
      }
      existing.links.push(...links);
      return;
    }
    const sample = {
      island,
      links: [...links],
      point: position,
      polygons: polygon === undefined ? [] : [polygon],
    };
    bucket.push(sample);
    cells.set(key, bucket);
    samples.push(sample);
  };
  for (const sample of navigation.samplePoints()) {
    add(sample.point, sample.island, sample.node, sample.neighbors);
  }
  if (!samples.length) {
    for (const spawn of [...options.spawns.alpha, ...options.spawns.bravo]) {
      const projected = navigation.project(point(spawn));
      if (projected) {
        add(projected.position, projected.island);
      }
    }
  }
  if (!samples.length) {
    throw new Error('Warden tactical baking requires a navigable surface');
  }
  return samples.sort(
    (a, b) =>
      a.point.x - b.point.x ||
      a.point.z - b.point.z ||
      a.point.y - b.point.y ||
      a.island - b.island,
  );
}

function makeRegions(
  nodes: Array<TacticalNode>,
  samples: Array<Sample>,
  spacing: number,
): Array<Region> {
  const indices = new Map(nodes.map((node, index) => [node.id, index]));
  const cells = samples.map((sample) => cell(sample.point, spacing, sample.island));
  const assigned = new Set<string>();
  const regions: Array<Region> = [];
  for (let index = 0; index < nodes.length; index++) {
    const first = nodes[index]!;
    if (assigned.has(first.id)) {
      continue;
    }
    const id = `region-${regions.length}`,
      members = [first];
    assigned.add(first.id);
    for (let cursor = 0; cursor < members.length; cursor++) {
      const member = members[cursor]!;
      member.regionId = id;
      for (const neighborId of member.neighbors) {
        const neighborIndex = indices.get(neighborId)!;
        if (assigned.has(neighborId) || cells[neighborIndex] !== cells[index]) {
          continue;
        }
        assigned.add(neighborId);
        members.push(nodes[neighborIndex]!);
      }
    }
    const center = members.reduce(
      (p, member) => ({
        x: p.x + member.position.x / members.length,
        y: p.y + member.position.y / members.length,
        z: p.z + member.position.z / members.length,
      }),
      { x: 0, y: 0, z: 0 },
    );
    const anchor = [...members].sort(
      (a, b) =>
        distance(a.position, center) - distance(b.position, center) || a.id.localeCompare(b.id),
    )[0]!;
    regions.push({ center: { ...anchor.position }, id, name: id, neighbors: [] });
  }
  const byId = new Map(regions.map((region) => [region.id, region]));
  for (const node of nodes) {
    const region = byId.get(node.regionId)!;
    for (const id of node.neighbors) {
      const neighbor = nodes[indices.get(id)!]!.regionId;
      if (neighbor !== region.id && !region.neighbors.includes(neighbor)) {
        region.neighbors.push(neighbor);
      }
    }
  }
  for (const region of regions) {
    region.neighbors.sort();
  }
  return regions;
}

function spatialFor(
  navigation: NavigationMesh,
  nodes: Array<TacticalNode>,
  visibility: (from: Vec3, to: Vec3) => boolean,
): TacticalSpatialQueries {
  let revision = navigation.revision;
  const paths = new Map<string, Array<Vec3>>();
  const fields = new Map<string, Map<string, number>>();
  const edges = new Map<string, number>();
  const indices = new Map(nodes.map((node, index) => [node.id, index]));
  const refresh = () => {
    if (revision === navigation.revision) {
      return;
    }
    revision = navigation.revision;
    paths.clear();
    fields.clear();
    edges.clear();
  };
  const findPath = (start: Vec3, goal: Vec3, clearance: number): Array<Vec3> => {
    refresh();
    if (!navigation.isWalkable(point(goal), clearance)) {
      return [];
    }
    const key = `${start.x}:${start.y}:${start.z}|${goal.x}:${goal.y}:${goal.z}|${clearance}`;
    const cached = paths.get(key);
    if (cached) {
      return cached.map((p) => ({ ...p }));
    }
    const path = navigation
      .path(point(start), point(goal))
      .map(vector)
      .filter((p, index) => index > 0 || distance(p, start) > 0.02);
    if (path.length === 0) {
      const projected = navigation.project(point(goal));
      if (projected && distance(start, vector(projected.position)) < 0.02) {
        path.push(vector(projected.position));
      }
    }
    if (paths.size >= 1024) {
      paths.delete(paths.keys().next().value!);
    }
    paths.set(key, path);
    return path.map((p) => ({ ...p }));
  };
  return {
    canTraverse: (from, to, clearance) => navigation.canTraverse(point(from), point(to), clearance),
    findPath,
    hasLineOfSight: visibility,
    isWalkable: (p, clearance) => navigation.isWalkable(point(p), clearance),
    tacticalPathCosts: (start, clearance) => {
      refresh();
      const key = `${start.x}:${start.y}:${start.z}|${clearance}`;
      const cached = fields.get(key);
      if (cached) {
        return new Map(cached);
      }
      const costs = new Float64Array(nodes.length).fill(Infinity);
      const closed = new Uint8Array(nodes.length);
      const island = navigation.project(point(start))?.island;
      const connections = nodes
        .filter(
          (node) =>
            island !== undefined && navigation.project(point(node.position))?.island === island,
        )
        .sort(
          (a, b) =>
            distance(start, a.position) - distance(start, b.position) || a.id.localeCompare(b.id),
        )
        .slice(0, 6);
      for (const node of connections) {
        const path = findPath(start, node.position, clearance);
        if (path.length) {
          costs[indices.get(node.id)!] = pathLength(start, path);
        }
      }
      for (let expansion = 0; expansion < nodes.length; expansion++) {
        let current = -1,
          best = Infinity;
        for (let index = 0; index < nodes.length; index++) {
          if (!closed[index] && costs[index]! < best) {
            current = index;
            best = costs[index]!;
          }
        }
        if (current < 0) {
          break;
        }
        closed[current] = 1;
        const node = nodes[current]!;
        for (const neighbor of node.neighbors) {
          const index = indices.get(neighbor)!;
          if (closed[index]) {
            continue;
          }
          const edgeKey = `${node.id}:${neighbor}:${clearance}`;
          let cost = edges.get(edgeKey);
          if (cost === undefined) {
            const path = findPath(node.position, nodes[index]!.position, clearance);
            cost = path.length ? pathLength(node.position, path) : Infinity;
            edges.set(edgeKey, cost);
          }
          costs[index] = Math.min(costs[index]!, best + cost);
        }
      }
      const result = new Map(nodes.map((node, index) => [node.id, costs[index]!]));
      if (fields.size >= 64) {
        fields.delete(fields.keys().next().value!);
      }
      fields.set(key, result);
      return new Map(result);
    },
  };
}

export function bakeNavigationTactics(
  navigation: NavigationMesh,
  options: NavigationTacticsOptions,
): { map: TacticalMap; spatial: TacticalSpatialQueries } {
  for (const [name, value] of Object.entries({
    depth: options.depth,
    nodeSpacing: options.nodeSpacing ?? 3,
    regionSpacing: options.regionSpacing ?? 9,
    width: options.width,
  })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid tactical map ${name}`);
    }
  }
  const samples = samplesFor(navigation, options);
  const visibility = (from: Vec3, to: Vec3) =>
    options.visibility
      ? options.visibility(from, to)
      : navigation.hasLineOfSight(point(from), point(to));
  const nodeForPolygon = new Map<number, string>();
  const nodes: Array<TacticalNode> = samples.map((sample, index) => {
    const position = sample.point,
      id = `nav-${index}`;
    for (const polygon of sample.polygons) {
      nodeForPolygon.set(polygon, id);
    }
    const eye = { ...position, y: position.y + EYE_HEIGHT };
    const cover =
      DIRECTIONS.reduce(
        (blocked, [x, , z]) =>
          blocked +
          Number(
            !visibility(eye, {
              x: eye.x + x * COVER_RANGE,
              y: eye.y,
              z: eye.z + z * COVER_RANGE,
            }),
          ),
        0,
      ) / DIRECTIONS.length;
    const clear = (x: number, z: number) =>
      navigation.canTraverse(point(position), [position.x + x, position.y, position.z + z], 0.35);
    const narrow =
      (!clear(0, 0.95) && !clear(0, -0.95) && clear(0.95, 0) && clear(-0.95, 0)) ||
      (!clear(0.95, 0) && !clear(-0.95, 0) && clear(0, 0.95) && clear(0, -0.95));
    return {
      capacity: 1,
      cover,
      exposure: 1 - cover,
      id,
      kind: narrow
        ? 'entry'
        : cover >= 0.25
          ? 'cover'
          : position.y - navigation.bounds[1] > 1.5
            ? 'overwatch'
            : 'search',
      neighbors: [],
      position: { ...position },
      regionId: '',
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (let index = 0; index < samples.length; index++) {
    const node = nodes[index]!;
    for (const link of samples[index]!.links) {
      const id = nodeForPolygon.get(link),
        neighbor = id && byId.get(id);
      if (!neighbor || neighbor.id === node.id || node.neighbors.includes(neighbor.id)) {
        continue;
      }
      if (!navigation.path(point(node.position), point(neighbor.position)).length) {
        continue;
      }
      node.neighbors.push(neighbor.id);
    }
    node.neighbors.sort();
  }
  const regions = makeRegions(nodes, samples, options.regionSpacing ?? 9);
  const spawns = { alpha: [] as Array<Vec3>, bravo: [] as Array<Vec3> };
  for (const team of ['alpha', 'bravo'] as const) {
    for (const spawn of options.spawns[team]) {
      const projected = navigation.project(point(spawn));
      if (!projected) {
        throw new Error(`Warden ${team} spawn is outside the navigation mesh`);
      }
      spawns[team].push(vector(projected.position));
    }
  }
  const authoredSpawns = [...spawns.alpha, ...spawns.bravo];
  const center = authoredSpawns.length
    ? authoredSpawns.reduce(
        (p, spawn) => ({
          x: p.x + spawn.x / authoredSpawns.length,
          y: p.y + spawn.y / authoredSpawns.length,
          z: p.z + spawn.z / authoredSpawns.length,
        }),
        { x: 0, y: 0, z: 0 },
      )
    : { x: 0, y: navigation.bounds[1], z: 0 };
  const objective = [...nodes].sort(
    (a, b) =>
      distance(a.position, center) - distance(b.position, center) || a.id.localeCompare(b.id),
  )[0]!;
  objective.kind = 'objective';
  const map: TacticalMap = {
    depth: options.depth,
    id: options.id,
    name: options.name,
    nodes,
    objectives: [
      { id: 'control', position: { ...objective.position }, regionId: objective.regionId },
    ],
    obstacles: [],
    regions,
    spawns,
    version: `navigation:${navigation.revision}`,
    width: options.width,
  };
  return { map, spatial: spatialFor(navigation, nodes, visibility) };
}
