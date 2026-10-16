import { AGENT_RADIUS, type Rect, type TacticalMap, type Vec3 } from '@blacksite/ai-schema';
export interface TacticalSpatialQueries {
  canTraverse(from: Vec3, to: Vec3, clearance: number): boolean;
  findPath(start: Vec3, goal: Vec3, clearance: number): Array<Vec3>;
  hasLineOfSight(from: Vec3, to: Vec3, clearance: number): boolean;
  isWalkable(point: Vec3, clearance: number): boolean;
  tacticalPathCosts(start: Vec3, clearance: number): Map<string, number>;
}
const hostSpatialQueries = new WeakMap<Readonly<TacticalMap>, TacticalSpatialQueries>();
export function registerTacticalSpatialQueries(
  map: Readonly<TacticalMap>,
  spatial: TacticalSpatialQueries,
): void {
  hostSpatialQueries.set(map, spatial);
}
export function canTraverse(
  map: Readonly<TacticalMap>,
  from: Vec3,
  to: Vec3,
  clearance = 0.4,
): boolean {
  const spatial = hostSpatialQueries.get(map);
  return spatial
    ? spatial.canTraverse(from, to, clearance)
    : hasLineOfSight(map, from, to, clearance);
}
export const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
export const distanceSquared = (a: Vec3, b: Vec3) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
export function segmentIntersectsRect(from: Vec3, to: Vec3, rect: Rect, clearance = 0): boolean {
  let lo = 0,
    hi = 1;
  const axes: Array<[number, number, number, number]> = [
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
    [from.y, to.y - from.y, -clearance, rect.height + clearance],
  ];
  for (const [origin, delta, min, max] of axes) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < min || origin > max) {
        return false;
      }
      continue;
    }
    const a = (min - origin) / delta,
      b = (max - origin) / delta;
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
    if (lo > hi) {
      return false;
    }
  }
  return hi >= 0 && lo <= 1;
}
function obstacleBlocks(map: Readonly<TacticalMap>, from: Vec3, to: Vec3, clearance: number) {
  const minX = Math.min(from.x, to.x) - clearance,
    maxX = Math.max(from.x, to.x) + clearance,
    minZ = Math.min(from.z, to.z) - clearance,
    maxZ = Math.max(from.z, to.z) + clearance;
  for (const r of map.obstacles) {
    if (
      r.x + r.width / 2 < minX ||
      r.x - r.width / 2 > maxX ||
      r.z + r.depth / 2 < minZ ||
      r.z - r.depth / 2 > maxZ
    ) {
      continue;
    }
    if (segmentIntersectsRect(from, to, r, clearance)) {
      return true;
    }
  }
  return false;
}
export function segmentBlocked(
  map: Readonly<TacticalMap>,
  from: Vec3,
  to: Vec3,
  clearance = 0,
): boolean {
  const spatial = hostSpatialQueries.get(map);
  return spatial
    ? !spatial.hasLineOfSight(from, to, clearance)
    : obstacleBlocks(map, from, to, clearance);
}
export const hasLineOfSight = (map: Readonly<TacticalMap>, from: Vec3, to: Vec3, clearance = 0) =>
  !segmentBlocked(map, from, to, clearance);
export function hasSuppressionLane(
  map: Readonly<TacticalMap>,
  from: Vec3,
  to: Vec3,
  reach = 3,
): boolean {
  const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  if (length <= reach) {
    return true;
  }
  const k = (length - reach) / length;
  return !segmentBlocked(map, from, {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    z: from.z + (to.z - from.z) * k,
  });
}
export function isWalkable(map: Readonly<TacticalMap>, point: Vec3, clearance = 0.38): boolean {
  const spatial = hostSpatialQueries.get(map);
  if (spatial) {
    return spatial.isWalkable(point, clearance);
  }
  return (
    Math.abs(point.x) <= map.width / 2 - clearance &&
    Math.abs(point.z) <= map.depth / 2 - clearance &&
    !map.obstacles.some(
      (r) =>
        Math.abs(point.x - r.x) <= r.width / 2 + clearance &&
        Math.abs(point.z - r.z) <= r.depth / 2 + clearance,
    )
  );
}
export function navigationClearance(
  map: Readonly<TacticalMap>,
  position: Vec3,
  preferred = 0.4,
): number {
  if (isWalkable(map, position, preferred)) {
    return preferred;
  }
  const physical = Math.min(preferred, AGENT_RADIUS - 1e-6);
  return isWalkable(map, position, physical) ? physical : preferred;
}
function comfortableStart(
  map: Readonly<TacticalMap>,
  start: Vec3,
  clearance: number,
): Vec3 | undefined {
  const from = { ...start, y: 0 };
  if (isWalkable(map, from, clearance)) {
    return from;
  }
  const physical = navigationClearance(map, from, clearance);
  if (physical >= clearance) {
    return undefined;
  }
  const directions: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [Math.SQRT1_2, Math.SQRT1_2],
    [-Math.SQRT1_2, Math.SQRT1_2],
    [-Math.SQRT1_2, -Math.SQRT1_2],
    [Math.SQRT1_2, -Math.SQRT1_2],
  ];
  for (const radius of [0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12]) {
    for (const [dx, dz] of directions) {
      const point = { x: from.x + dx * radius, y: 0, z: from.z + dz * radius };
      if (isWalkable(map, point, clearance) && hasLineOfSight(map, from, point, physical)) {
        return point;
      }
    }
  }
  return undefined;
}
type Edge = {
  cost: number;
  to: number;
};
type SourceCosts = {
  costs: Float64Array;
  from?: Vec3;
  previous: Int32Array;
};
type NavGraph = {
  edges: Array<Array<Edge>>;
  nodeIndices: Map<string, number>;
  points: Array<Vec3>;
  starts: Map<string, SourceCosts>;
  version: string;
};
const graphCache = new WeakMap<Readonly<TacticalMap>, Map<number, NavGraph>>();
function navigationGraph(map: Readonly<TacticalMap>, clearance: number): NavGraph {
  let variants = graphCache.get(map);
  if (!variants) {
    variants = new Map();
    graphCache.set(map, variants);
  }
  const cached = variants.get(clearance);
  if (cached?.version === map.version) {
    return cached;
  }
  const points: Array<Vec3> = [],
    nodeIndices = new Map<string, number>(),
    coordinateIndex = new Map<string, number>();
  const addPoint = (p: Vec3): number => {
    const key = `${p.x.toFixed(5)}:${p.z.toFixed(5)}`;
    const existing = coordinateIndex.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const index = points.length;
    points.push({ ...p, y: 0 });
    coordinateIndex.set(key, index);
    return index;
  };
  for (const node of map.nodes) {
    if (isWalkable(map, node.position, clearance)) {
      nodeIndices.set(node.id, addPoint(node.position));
    }
  }
  const margin = clearance + 0.08;
  for (const o of map.obstacles) {
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        const p = {
          x: o.x + x * (o.width / 2 + margin),
          y: 0,
          z: o.z + z * (o.depth / 2 + margin),
        };
        if (isWalkable(map, p, clearance)) {
          addPoint(p);
        }
      }
    }
  }
  const edges: Array<Array<Edge>> = points.map(() => []);
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (!hasLineOfSight(map, points[i]!, points[j]!, clearance)) {
        continue;
      }
      const cost = distance(points[i]!, points[j]!);
      edges[i]!.push({ cost, to: j });
      edges[j]!.push({ cost, to: i });
    }
  }
  const graph: NavGraph = { edges, nodeIndices, points, starts: new Map(), version: map.version };
  variants.set(clearance, graph);
  return graph;
}
class MinHeap {
  private costs: Array<number> = [];
  private indices: Array<number> = [];
  get size(): number {
    return this.costs.length;
  }
  private less(a: number, b: number): boolean {
    return (
      this.costs[a]! < this.costs[b]! ||
      (this.costs[a] === this.costs[b] && this.indices[a]! < this.indices[b]!)
    );
  }
  private swap(a: number, b: number): void {
    [this.costs[a], this.costs[b]] = [this.costs[b]!, this.costs[a]!];
    [this.indices[a], this.indices[b]] = [this.indices[b]!, this.indices[a]!];
  }
  push(cost: number, index: number): void {
    this.costs.push(cost);
    this.indices.push(index);
    let i = this.costs.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) {
        break;
      }
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.costs[0]!, this.indices[0]!];
    const lastCost = this.costs.pop()!,
      lastIndex = this.indices.pop()!;
    if (this.costs.length) {
      this.costs[0] = lastCost;
      this.indices[0] = lastIndex;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1,
          right = left + 1;
        let smallest = i;
        if (left < this.costs.length && this.less(left, smallest)) {
          smallest = left;
        }
        if (right < this.costs.length && this.less(right, smallest)) {
          smallest = right;
        }
        if (smallest === i) {
          break;
        }
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }
}
function costsFrom(
  map: Readonly<TacticalMap>,
  start: Vec3,
  clearance: number,
): SourceCosts & {
  graph: NavGraph;
} {
  const graph = navigationGraph(map, clearance),
    n = graph.points.length;
  const key = `${Object.is(start.x, -0) ? '-0' : start.x}:${Object.is(start.z, -0) ? '-0' : start.z}`;
  const cached = graph.starts.get(key);
  if (cached) {
    graph.starts.delete(key);
    graph.starts.set(key, cached);
    return { graph, ...cached };
  }
  const costs = new Float64Array(n).fill(Infinity),
    previous = new Int32Array(n).fill(-1),
    closed = new Uint8Array(n);
  const from = comfortableStart(map, start, clearance);
  if (!from) {
    return { costs, graph, previous };
  }
  const recoveryCost = distance(start, from);
  for (let i = 0; i < n; i++) {
    if (hasLineOfSight(map, from, graph.points[i]!, clearance)) {
      costs[i] = recoveryCost + distance(from, graph.points[i]!);
    }
  }
  const heap = new MinHeap();
  for (let i = 0; i < n; i++) {
    if (costs[i]! < Infinity) {
      heap.push(costs[i]!, i);
    }
  }
  for (let expansion = 0; expansion < Math.min(n, 512); expansion++) {
    let current = -1,
      best = Infinity;
    while (heap.size) {
      const [cost, index] = heap.pop();
      if (!closed[index] && cost === costs[index]) {
        current = index;
        best = cost;
        break;
      }
    }
    if (current < 0) {
      break;
    }
    closed[current] = 1;
    for (const edge of graph.edges[current]!) {
      if (!closed[edge.to] && best + edge.cost < costs[edge.to]!) {
        costs[edge.to] = best + edge.cost;
        previous[edge.to] = current;
        heap.push(costs[edge.to]!, edge.to);
      }
    }
  }
  if (graph.starts.size >= 64) {
    graph.starts.delete(graph.starts.keys().next().value!);
  }
  const result = { costs, from, previous };
  graph.starts.set(key, result);
  return { graph, ...result };
}
export function tacticalPathCosts(
  map: Readonly<TacticalMap>,
  start: Vec3,
  clearance = 0.4,
): Map<string, number> {
  const spatial = hostSpatialQueries.get(map);
  if (spatial) {
    return spatial.tacticalPathCosts(start, clearance);
  }
  const { costs, graph } = costsFrom(map, start, clearance);
  return new Map([...graph.nodeIndices].map(([id, index]) => [id, costs[index]!]));
}
export function findPath(
  map: Readonly<TacticalMap>,
  start: Vec3,
  goal: Vec3,
  clearance = 0.4,
): Array<Vec3> {
  const spatial = hostSpatialQueries.get(map);
  if (spatial) {
    return spatial.findPath(start, goal, clearance);
  }
  if (!isWalkable(map, goal, clearance)) {
    return [];
  }
  const original = { ...start, y: 0 },
    a = comfortableStart(map, original, clearance),
    b = { ...goal, y: 0 };
  if (!a) {
    return [];
  }
  const recovery = distance(original, a) > 0.00001 ? [a] : [];
  if (hasLineOfSight(map, a, b, clearance)) {
    return [...recovery, b];
  }
  const { costs, graph, previous } = costsFrom(map, start, clearance);
  let last = -1,
    best = Infinity;
  for (let i = 0; i < graph.points.length; i++) {
    const score = costs[i]! + distance(graph.points[i]!, b);
    if (score < best && hasLineOfSight(map, graph.points[i]!, b, clearance)) {
      best = score;
      last = i;
    }
  }
  if (last < 0) {
    return [];
  }
  const path: Array<Vec3> = [b];
  for (let cursor = last; cursor >= 0; cursor = previous[cursor]!) {
    if (distance(graph.points[cursor]!, path.at(-1)!) > 0.02) {
      path.push({ ...graph.points[cursor]! });
    }
  }
  path.reverse();
  const smoothed: Array<Vec3> = [];
  let origin = a,
    index = 0;
  while (index < path.length) {
    let next = index;
    while (next + 1 < path.length && hasLineOfSight(map, origin, path[next + 1]!, clearance)) {
      next++;
    }
    smoothed.push(path[next]!);
    origin = path[next]!;
    index = next + 1;
  }
  return [...recovery, ...smoothed];
}
export function distanceToSegment(point: Vec3, start: Vec3, end: Vec3): number {
  const dx = end.x - start.x,
    dz = end.z - start.z;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.z - start.z) * dz) / Math.max(1e-9, dx * dx + dz * dz),
    ),
  );
  return Math.hypot(point.x - start.x - dx * t, point.z - start.z - dz * t);
}

export {
  buildNavigationMesh,
  type NavigationMesh,
  type NavigationPoint,
  type NavigationGeometry,
  type NavigationBuildOptions,
  type NavigationProjection,
  type NavigationSample,
} from './navigation';
export { createNavigationCrowd, type NavigationCrowd, type NavigationCrowdAgent } from './crowd';
export { bakeNavigationTactics, type NavigationTacticsOptions } from './tactical-map';
